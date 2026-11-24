/** The wallet, the shop and the crown. Mounted as `op=` branches on
 * `api/user/[op].ts`, so the twelve-function budget is unchanged.
 *
 * Everything valuable is decided here and recorded in the ledger of migration
 * 028. A browser can ask for a balance, ask to spend one and ask what an order
 * costs; it can never assert any of the three. In particular:
 *
 *   - balances come from `token_balances`, written only by the ledger routines;
 *   - prices come from the owner's configuration, never from the request;
 *   - payment is established by the provider's signed webhook, never by a
 *     redirect the browser followed or a flag it set;
 *   - an unconfigured item cannot be ordered by anyone, through any route,
 *     regardless of what the shop UI happens to be showing.
 *
 * None of it touches learning. A balance buys a picture or a mug. Product copy
 * calls the balance coins; the code keeps the `token` spelling. What earns
 * coins lives in `./coins.ts` (step D8, migration 041). */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { isRpcMissing, jsonError, createLogger, requireAuthResult, requireAuthSub, withTimeout, unstorableText } from '../http';
import { rawBodyCandidates } from '../raw-body';
import { getGameSettings } from '../settings-store';
import { adminSubject, requireAdmin } from '../admin-auth';
import { claimPaymentDelivery, enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { deploymentSubjectIds } from '../product-scope';
import { refuseLocked } from '../access';
import { isScopeSubject } from '../../shared/subject-catalog';
import { settleFinishedMonth, settleMilestones, type MilestoneReport } from './coins';
import { accountCreatedAt, creditReferral, type ReferralCreditStatus } from './referral';
import {
  MERCH_ENABLED,
  REFERRAL_SIGNUP_WINDOW_HOURS,
  crownAvailable,
  streakProtectionAvailable,
  STREAK_PROTECTION_CAP,
  isMerchSku,
  isOrderState,
  merchAvailability,
  merchItem,
  merchMarginMinor,
  validateAddress,
  type CoinSettings,
  type MerchAvailability,
  type MerchSku,
} from '../../shared/rewards';

// The XP credit moved to ./coins.ts; the handlers that record verified XP
// still import it from here.
export { creditVerifiedXp } from './coins';

const logEvent = createLogger('rewards');

const newId = (): string => randomBytes(24).toString('base64url').slice(0, 32);
const migrationRequired = (res: VercelResponse) =>
  jsonError(res, 503, 'migration_required', 'Rewards migration 028 is not installed');

/** The answer to a merchandise request while `MERCH_ENABLED` is off (owner
 * decision 10): the path-package claim in lib/learning-paths/handlers.ts gives
 * the same one. 404 rather than 409, because there is nothing to order. */
export const merchUnavailable = (res: VercelResponse) =>
  jsonError(res, 404, 'merch_unavailable', 'Merchandise is not available yet');

/** The subject a wallet belongs to. Wallets are per subject, as they have
 * always been; the deployment decides which one a request may touch. */
function walletSubject(req: VercelRequest): string | null {
  const raw = typeof req.query.subject === 'string' ? req.query.subject : (req.body as { subject?: unknown } | null)?.subject;
  const allowed = deploymentSubjectIds();
  if (typeof raw === 'string' && isScopeSubject(raw) && allowed.includes(raw)) return raw;
  return allowed[0] ?? null;
}

/* ── settlements this instance has seen final (#587, server item 7) ──── */

/**
 * A wallet read runs four one-time routines before it reads the balance. Two
 * of them reach a state no later call can change, and a warm instance that
 * has seen that state skips them for the account, for at most
 * SETTLED_TTL_MS. The database stays the authority: a miss only costs the
 * call, and nothing here ever grants.
 *
 *  - The welcome grant is one ledger event per account (`signup:<account>`,
 *    migration 028). Once `grant_signup_tokens` answered true (granted now)
 *    or false (already in the ledger), every later call answers false and
 *    credits nothing.
 *  - The account's own invitation (`credit_referral`, migration 042) is
 *    settled for good once it answers `already`, `credited`, `capped` or
 *    `orphaned` (the referral row's `credited_at` is set and never cleared
 *    while the account exists). `none` (no invitation) is final only when
 *    `record_referral` can no longer bind one: it refuses an account older
 *    than REFERRAL_SIGNUP_WINDOW_HOURS by the creation time Auth reported, or
 *    one Auth reported none for. An hour of margin covers clock skew.
 *    `waiting` and `off` are asked again every time.
 *
 * The bound, for the owner: the rows behind these answers disappear only
 * with the account (`delete_user_data`). Should an erasure remove them while
 * the sign-in identity survives (the deletion's Auth step failed), this
 * instance would skip a welcome grant the database would pay again, for at
 * most ten minutes. Keyed by account id, at most SETTLED_LIMIT entries per
 * map, the oldest dropped first.
 */
const SETTLED_TTL_MS = 10 * 60_000;
const SETTLED_LIMIT = 5_000;
const REFERRAL_WINDOW_MARGIN_MS = 60 * 60_000;
const welcomeSettled = new Map<string, number>();
const referralSettled = new Map<string, number>();
const FINAL_REFERRAL: ReadonlySet<ReferralCreditStatus> = new Set(['already', 'credited', 'capped', 'orphaned']);

function seenSettled(map: Map<string, number>, userId: string, now = Date.now()): boolean {
  const until = map.get(userId);
  if (until === undefined) return false;
  if (until > now) return true;
  map.delete(userId);
  return false;
}

function rememberSettled(map: Map<string, number>, userId: string, now = Date.now()): void {
  map.delete(userId);
  while (map.size >= SETTLED_LIMIT) map.delete(map.keys().next().value!);
  map.set(userId, now + SETTLED_TTL_MS);
}

/** Whether `credit_referral`'s answer can never change for this account. */
export function referralFinal(status: ReferralCreditStatus | null, createdAt: string | null, now = Date.now()): boolean {
  if (status === null) return false;
  if (FINAL_REFERRAL.has(status)) return true;
  if (status !== 'none') return false;
  if (createdAt === null) return true;
  return Date.parse(createdAt) < now - REFERRAL_SIGNUP_WINDOW_HOURS * 3_600_000 - REFERRAL_WINDOW_MARGIN_MS;
}

/** Forget what this instance remembered, for one account or for all: the
 * contracts use it. */
export function forgetWalletSettlements(userId?: string): void {
  if (userId === undefined) {
    welcomeSettled.clear();
    referralSettled.clear();
    return;
  }
  welcomeSettled.delete(userId);
  referralSettled.delete(userId);
}

/* ── GET/POST ?op=wallet ───────────────────────────────────────────────── */

/**
 * The balance, the recent ledger entries behind it, what the learner owns,
 * and how to earn more.
 *
 * The entries are the point: a wallet whose owner cannot see why it holds what
 * it holds is the thing this replaced.
 *
 * A read also settles, before it answers, the credits that have no request of
 * their own: the one-time welcome grant (an event id derived from the account,
 * so a second device grants nothing), the top three of a month that has just
 * ended, any Premium milestone the learner's verified progress has reached,
 * and the learner's own invitation once a Learn level is passed (#228). Each
 * is idempotent, so reading twice credits nothing.
 */
export async function handleWallet(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  const userId = auth.sub;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  const subject = walletSubject(req);
  if (!subject) return jsonError(res, 400, 'bad_request', 'Unknown subject');

  if (req.method === 'GET') {
    const settings = await getGameSettings();
    const coins = settings.coins;
    // A routine this instance has seen final for the account is skipped
    // (see "settlements this instance has seen final" above).
    const [welcome, , milestones, referral] = await Promise.all([
      coins.welcomeGrant > 0 && !seenSettled(welcomeSettled, userId)
        ? withTimeout(
            supabase.rpc('grant_signup_tokens', { p_user_id: userId, p_subject: subject, p_amount: coins.welcomeGrant }),
          ).catch(() => null)
        : Promise.resolve(null),
      settleFinishedMonth(supabase, subject),
      settleMilestones(supabase, userId, subject),
      // An invitation whose first level was passed outside a Learn completion
      // (or whose credit failed there) settles here (#228).
      seenSettled(referralSettled, userId) ? Promise.resolve(null) : creditReferral(supabase, userId, subject),
    ]);
    if (welcome?.error && isRpcMissing(welcome.error)) return migrationRequired(res);
    if (welcome && !welcome.error && typeof welcome.data === 'boolean') rememberSettled(welcomeSettled, userId);
    if (referralFinal(referral, accountCreatedAt(auth.payload))) rememberSettled(referralSettled, userId);

    const [balance, entries, cosmetics] = await Promise.all([
      withTimeout(supabase.from('token_balances').select('balance').eq('user_id', userId).eq('subject', subject).maybeSingle()),
      withTimeout(
        supabase.from('token_ledger').select('event_id,amount,reason,reference,created_at')
          .eq('user_id', userId).eq('subject', subject).order('created_at', { ascending: false }).limit(25),
      ),
      withTimeout(supabase.from('cosmetic_entitlements').select('cosmetic_id,equipped').eq('user_id', userId)),
    ]);
    if (balance.error && isRpcMissing(balance.error)) return migrationRequired(res);
    // A failed cosmetics read is not "owns nothing": the screen would offer
    // the crown for sale again and take it off the avatar.
    if (balance.error || entries.error || cosmetics.error) return jsonError(res, 500, 'db_error', 'Could not load your coins');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      subject,
      balance: Number(balance.data?.balance ?? 0),
      entries: (entries.data ?? []).map((row) => ({
        eventId: String(row.event_id),
        amount: Number(row.amount),
        reason: String(row.reason),
        reference: row.reference == null ? null : String(row.reference),
        createdAt: String(row.created_at),
      })),
      cosmetics: (cosmetics.data ?? []).map((row) => ({
        id: String(row.cosmetic_id),
        equipped: row.equipped === true,
      })),
      // True only on the read that granted it, so the browser can say so once.
      welcome: { granted: welcome?.data === true, coins: coins.welcomeGrant },
      earn: earnSummary(coins, milestones),
    });
  }

  // POST: a body without a claim is the old sign-up claim and is answered the
  // same way as before, from the same idempotent routine. Opening a social
  // profile no longer pays (design audit P0.3): an older browser that still
  // reports one is told nothing was granted, and the ledger keeps the reason
  // for the credits already made.
  if (req.method === 'POST') {
    const body = (req.body || {}) as { claim?: unknown; platform?: unknown };
    if (body.claim === 'social') {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ granted: false, coins: 0 });
    }
    if (body.claim !== undefined) return jsonError(res, 400, 'bad_request', 'Unknown claim');
    const settings = await getGameSettings();
    const granted = await withTimeout(
      supabase.rpc('grant_signup_tokens', { p_user_id: userId, p_subject: subject, p_amount: settings.coins.welcomeGrant }),
    );
    if (granted.error) {
      if (isRpcMissing(granted.error)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not grant the welcome coins');
    }
    const balance = await withTimeout(
      supabase.from('token_balances').select('balance').eq('user_id', userId).eq('subject', subject).maybeSingle(),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ granted: granted.data === true, balance: Number(balance.data?.balance ?? 0) });
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/** "How to earn" for the Rewards screen: the rules as configured, and the
 * learner's progress toward each milestone. `progress` is null when migration
 * 041 is not installed yet, and the screen then shows the rules alone. */
function earnSummary(coins: CoinSettings, report: MilestoneReport | null) {
  return {
    rules: {
      xpRate: coins.xpRate,
      premiumMultiplier: coins.premiumMultiplier,
      dailyXpCap: coins.dailyXpCap,
      welcomeGrant: coins.welcomeGrant,
      streakMilestones: coins.streakMilestones,
      topicComplete: coins.topicComplete,
      projectComplete: coins.projectComplete,
      shortPathComplete: coins.shortPathComplete,
      monthTop: coins.monthTop,
      socialVisitGrant: coins.socialVisitGrant,
      referralGrant: coins.referralGrant,
      referralCap: coins.referralCap,
    },
    progress: report
      ? {
          premium: report.premium,
          todayXpCoins: report.todayXpCoins,
          streak: report.streak,
          topics: report.topics,
          projects: report.projects,
          earned: report.earned,
        }
      : null,
  };
}

/* ── GET ?op=shop ──────────────────────────────────────────────────────── */

/** The catalogue as this deployment can actually sell it: every item with its
 * availability, and a price only where one has been configured. While
 * merchandise is paused (`MERCH_ENABLED`) the list is empty and the shop is
 * reported off: the crown and streak protection are all there is to buy.
 * `merchOn` is the switch, a parameter only so the contracts can drive the
 * code that comes back with it. */
export async function handleShopCatalogue(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient | null,
  merchOn: boolean = MERCH_ENABLED,
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const settings = await getGameSettings();
  const merch = settings.merch;
  const region = typeof req.query.region === 'string' ? req.query.region.toUpperCase() : null;

  const stockRows = supabase && merchOn
    ? await withTimeout(supabase.from('merch_stock').select('sku,variant,on_hand,reserved'))
    : { data: [], error: null };
  const freeStock = new Map<string, number>();
  for (const row of (stockRows.data ?? []) as { sku: string; variant: string; on_hand: number; reserved: number }[]) {
    freeStock.set(`${row.sku}|${row.variant}`, Math.max(0, Number(row.on_hand) - Number(row.reserved)));
  }

  const { MERCH_CATALOGUE } = await import('../../shared/rewards');
  const items = (merchOn ? MERCH_CATALOGUE : []).map((item) => {
    const pricing = merch.pricing[item.sku];
    const variants = item.variants.length > 0 ? item.variants : [''];
    const stock = variants.reduce((total, variant) => total + (freeStock.get(`${item.sku}|${variant}`) ?? 0), 0);
    const availability: MerchAvailability = merchAvailability({
      sku: item.sku,
      settings: merch,
      region,
      stock: stockRows.data ? stock : null,
    });
    return {
      sku: item.sku,
      variants: item.variants,
      availability,
      // A price is published only when a real quote produced it.
      price: pricing
        ? {
            minor: pricing.priceMinor,
            currency: pricing.currency,
            taxIncluded: pricing.taxIncluded,
            tokenPrice: pricing.tokenPrice ?? null,
            regions: pricing.regions,
          }
        : null,
      variantStock: variants.map((variant) => ({ variant, free: freeStock.get(`${item.sku}|${variant}`) ?? 0 })),
    };
  });

  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({
    enabled: merchOn && merch.enabled,
    cashCheckoutEnabled: merchOn && merch.cashCheckoutEnabled,
    testMode: merch.testMode,
    policyUrl: merch.policyUrl,
    items,
    crown: { available: crownAvailable(merch), tokenPrice: merch.crownTokenPrice },
    // Consumable rather than owned, so the shop shows a cap and a balance
    // instead of an owned/not-owned state.
    protection: {
      available: streakProtectionAvailable(merch),
      tokenPrice: merch.streakProtectionTokenPrice,
      cap: STREAK_PROTECTION_CAP,
    },
  });
}

/* ── GET/POST/DELETE ?op=orders ────────────────────────────────────────── */

interface RequestedLine {
  sku: MerchSku;
  variant: string;
  quantity: number;
}

function parseLines(raw: unknown): RequestedLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 10) return null;
  const lines: RequestedLine[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>;
    if (!isMerchSku(row.sku)) return null;
    const item = merchItem(row.sku)!;
    const variant = typeof row.variant === 'string' ? row.variant : '';
    // The item's own sizes (t-shirt and hoodie), or none at all.
    if (item.variants.length > 0) {
      if (!item.variants.includes(variant)) return null;
    } else if (variant !== '') return null;
    // One line per item and size: merch_order_items keys on (order, sku,
    // variant), so a repeated line failed the insert with 23505 (a 500), and
    // it would also step past the five-per-line cap.
    const key = `${row.sku}|${variant}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 5) return null;
    lines.push({ sku: row.sku, variant, quantity });
  }
  return lines;
}

/** A learner's merchandise orders: list, place, cancel. While merchandise is
 * paused (`MERCH_ENABLED`, owner decision 10) listing and placing answer 404
 * `merch_unavailable`; cancelling stays, so an order from before the pause can
 * still be stopped and its coins returned. `merchOn` is the switch, a
 * parameter only so the contracts can drive the code that comes back with it. */
export async function handleOrders(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient | null,
  merchOn: boolean = MERCH_ENABLED,
) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!merchOn && (req.method === 'GET' || req.method === 'POST')) return merchUnavailable(res);
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  if (req.method === 'GET') {
    const orders = await withTimeout(
      supabase.from('merch_orders')
        .select('order_id,payment_kind,state,total_minor,currency,token_total,ship_country,carrier,tracking_ref,test_mode,created_at')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(30),
    );
    if (orders.error) {
      if (isRpcMissing(orders.error)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not load your orders');
    }
    const ids = (orders.data ?? []).map((row) => String(row.order_id));
    const [items, claims] = ids.length
      ? await Promise.all([
          withTimeout(supabase.from('merch_order_items').select('order_id,sku,variant,quantity').in('order_id', ids)),
          // A learning-path package is claimed, not paid for (#229).
          withTimeout(supabase.from('path_reward_claims').select('order_id').eq('user_id', userId).in('order_id', ids)),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    // A failed read is not an order without items or a package.
    if (items.error || claims.error) return jsonError(res, 500, 'db_error', 'Could not load your orders');
    const packages = new Set(((claims.data ?? []) as { order_id: string | null }[]).map((row) => String(row.order_id)));
    const byOrder = new Map<string, { sku: string; variant: string; quantity: number }[]>();
    for (const row of (items.data ?? []) as { order_id: string; sku: string; variant: string; quantity: number }[]) {
      const list = byOrder.get(row.order_id) ?? [];
      list.push({ sku: row.sku, variant: row.variant, quantity: Number(row.quantity) });
      byOrder.set(row.order_id, list);
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      orders: (orders.data ?? []).map((row) => ({
        orderId: String(row.order_id),
        paymentKind: String(row.payment_kind),
        state: String(row.state),
        totalMinor: row.total_minor == null ? null : Number(row.total_minor),
        currency: row.currency == null ? null : String(row.currency),
        tokenTotal: row.token_total == null ? null : Number(row.token_total),
        country: String(row.ship_country),
        carrier: row.carrier == null ? null : String(row.carrier),
        trackingRef: row.tracking_ref == null ? null : String(row.tracking_ref),
        testMode: row.test_mode === true,
        createdAt: String(row.created_at),
        package: packages.has(String(row.order_id)),
        items: byOrder.get(String(row.order_id)) ?? [],
      })),
    });
  }

  if (req.method === 'POST') {
    const settings = await getGameSettings();
    const merch = settings.merch;
    if (!merch.enabled) return jsonError(res, 409, 'shop_disabled', 'The shop is not open');

    const body = (req.body || {}) as Record<string, unknown>;
    const lines = parseLines(body.items);
    if (!lines) return jsonError(res, 400, 'bad_request', 'Choose between one and ten valid items');
    // Shipped merchandise is Premium only (handoff section 7.3): a free account
    // is answered with the 402 that opens the upgrade sheet, before it is asked
    // for an address. The crown and streak protection stay open to everyone.
    if (await refuseLocked(res, userId, { kind: 'merch-redemption', sku: lines[0].sku })) return;
    const address = validateAddress(body.address);
    if (!address.ok) return jsonError(res, 400, 'bad_address', `Check the ${address.field} on your address`);
    const paymentKind = body.paymentKind === 'cash' ? 'cash' : 'tokens';
    if (paymentKind === 'cash' && !merch.cashCheckoutEnabled) {
      return jsonError(res, 409, 'checkout_unavailable', 'Paying with money is not configured yet');
    }
    const subject = walletSubject(req);
    if (!subject) return jsonError(res, 400, 'bad_request', 'Unknown subject');

    // The server prices the order from its own configuration. Anything the
    // request said about money is ignored, not validated.
    let totalMinor = 0;
    let tokenTotal = 0;
    let currency: string | null = null;
    const priced: Record<string, unknown>[] = [];
    for (const line of lines) {
      const pricing = merch.pricing[line.sku];
      if (!pricing) return jsonError(res, 409, 'unconfigured', 'That item is not on sale yet');
      if (!pricing.regions.includes(address.address.country)) {
        return jsonError(res, 409, 'out_of_region', 'That item cannot be posted to your country yet');
      }
      if (currency === null) currency = pricing.currency;
      else if (currency !== pricing.currency) {
        return jsonError(res, 409, 'mixed_currency', 'Those items are priced in different currencies');
      }
      if (paymentKind === 'tokens' && !pricing.tokenPrice) {
        return jsonError(res, 409, 'tokens_unavailable', 'That item cannot be redeemed with coins');
      }
      totalMinor += pricing.priceMinor * line.quantity;
      tokenTotal += (pricing.tokenPrice ?? 0) * line.quantity;
      priced.push({
        sku: line.sku,
        variant: line.variant,
        quantity: line.quantity,
        unitMinor: pricing.priceMinor,
        unitTokens: pricing.tokenPrice ?? null,
      });
    }

    const orderId = newId();
    const created = await withTimeout(
      supabase.rpc('create_merch_order', {
        p_order_id: orderId,
        p_user_id: userId,
        p_payment_kind: paymentKind,
        p_items: priced,
        p_total_minor: totalMinor,
        p_currency: currency,
        p_token_total: paymentKind === 'tokens' ? tokenTotal : null,
        p_subject: subject,
        p_ship: address.address,
        p_test_mode: merch.testMode,
      }),
    );
    if (created.error) {
      if (isRpcMissing(created.error)) return migrationRequired(res);
      const message = created.error.message ?? '';
      if (/out_of_stock/i.test(message)) return jsonError(res, 409, 'out_of_stock', 'That is out of stock');
      if (/insufficient_tokens/i.test(message)) return jsonError(res, 409, 'insufficient_tokens', 'You do not have enough coins');
      return jsonError(res, 500, 'db_error', 'Could not place the order');
    }
    logEvent({ status: 200, kind: 'order_created', paymentKind, testMode: merch.testMode });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      orderId,
      state: paymentKind === 'tokens' ? 'paid' : 'awaiting_payment',
      totalMinor,
      currency,
      tokenTotal: paymentKind === 'tokens' ? tokenTotal : null,
      testMode: merch.testMode,
    });
  }

  // Cancelling: the owner's own order, and only while it can still be stopped.
  if (req.method === 'DELETE') {
    const orderId = typeof req.query.id === 'string' ? req.query.id : '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(orderId)) return jsonError(res, 400, 'bad_request', 'An order is required');
    const subject = walletSubject(req);
    const cancelled = await withTimeout(
      supabase.rpc('cancel_merch_order', { p_order_id: orderId, p_user_id: userId, p_subject: subject }),
    );
    if (cancelled.error) {
      if (isRpcMissing(cancelled.error)) return migrationRequired(res);
      const message = cancelled.error.message ?? '';
      if (/order_not_owned/i.test(message)) return jsonError(res, 403, 'forbidden', 'That order belongs to another account');
      if (/order_not_cancellable/i.test(message)) {
        return jsonError(res, 409, 'not_cancellable', 'That order has already gone to the supplier');
      }
      if (/unknown_order/i.test(message)) return jsonError(res, 404, 'not_found', 'Unknown order');
      return jsonError(res, 500, 'db_error', 'Could not cancel the order');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ outcome: String(cancelled.data ?? 'cancelled') });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/* ── POST ?op=cosmetic ─────────────────────────────────────────────────── */

/** Buy or equip the crown. The purchase is one transaction: the debit and the
 * entitlement land together or neither does. */
export async function handleCosmetic(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  const body = (req.body || {}) as Record<string, unknown>;
  if (body.id !== 'crown') return jsonError(res, 400, 'bad_request', 'Unknown cosmetic');
  // No op is a purchase; any op but equip or unequip is a mistake, and a
  // misspelt "equip" must not spend the learner's coins.
  if (body.op !== undefined && body.op !== 'equip' && body.op !== 'unequip') {
    return jsonError(res, 400, 'bad_request', 'Unknown cosmetic operation');
  }
  const subject = walletSubject(req);
  if (!subject) return jsonError(res, 400, 'bad_request', 'Unknown subject');
  const settings = await getGameSettings();

  if (body.op === 'equip' || body.op === 'unequip') {
    const changed = await withTimeout(
      supabase.rpc('equip_cosmetic', { p_user_id: userId, p_cosmetic_id: 'crown', p_equipped: body.op === 'equip' }),
    );
    if (changed.error) {
      if (isRpcMissing(changed.error)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not change what you are wearing');
    }
    if (changed.data !== true) return jsonError(res, 409, 'not_owned', 'You do not own that yet');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ equipped: body.op === 'equip' });
  }

  if (!crownAvailable(settings.merch)) return jsonError(res, 409, 'unavailable', 'The crown is not on sale');
  const bought = await withTimeout(
    supabase.rpc('purchase_cosmetic', {
      p_user_id: userId, p_cosmetic_id: 'crown', p_subject: subject, p_price: settings.merch.crownTokenPrice,
    }),
  );
  if (bought.error) {
    if (isRpcMissing(bought.error)) return migrationRequired(res);
    if (/insufficient_tokens/i.test(bought.error.message ?? '')) {
      // Two purchases at once (two tabs or devices) both pass the routine's
      // ownership check; the second waits on the wallet lock, then sees the
      // balance the first one spent and raises. The crown was bought once,
      // so say so instead of "not enough coins".
      const owned = await withTimeout(
        supabase.from('cosmetic_entitlements').select('cosmetic_id')
          .eq('user_id', userId).eq('cosmetic_id', 'crown').maybeSingle(),
      );
      if (!owned.error && owned.data) {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ owned: true, alreadyOwned: true });
      }
      return jsonError(res, 409, 'insufficient_tokens', 'You do not have enough coins');
    }
    return jsonError(res, 500, 'db_error', 'Could not complete the purchase');
  }
  logEvent({ status: 200, kind: 'cosmetic_bought' });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ owned: true, alreadyOwned: bought.data !== true });
}

/* ── POST ?op=protection ───────────────────────────────────────────────── */

/**
 * Buy one streak protection with earned tokens.
 *
 * The whole decision is the database's: whether there is room under the cap,
 * whether the wallet covers it, and how much the budget becomes. This function
 * supplies the price from settings — never from the request — and reports what
 * happened.
 *
 * At the cap it is not an error and not a charge. Asking for a third protection
 * when two are already in hand returns the budget unchanged, because the point
 * of the cap is that no amount of currency buys a deeper reserve than a learner
 * who spends nothing has.
 */
export async function handleStreakProtection(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  const subject = walletSubject(req);
  if (!subject) return jsonError(res, 400, 'bad_request', 'Unknown subject');
  const settings = await getGameSettings();
  if (!streakProtectionAvailable(settings.merch)) {
    return jsonError(res, 409, 'unavailable', 'Streak protection is not on sale');
  }

  const bought = await withTimeout(
    supabase.rpc('purchase_streak_protection', {
      p_user_id: userId,
      p_subject: subject,
      p_price: settings.merch.streakProtectionTokenPrice,
    }),
  );
  if (bought.error) {
    if (isRpcMissing(bought.error)) return migrationRequired(res);
    if (/insufficient_tokens/i.test(bought.error.message ?? '')) {
      return jsonError(res, 409, 'insufficient_tokens', 'You do not have enough coins');
    }
    return jsonError(res, 500, 'db_error', 'Could not complete the purchase');
  }
  const row = Array.isArray(bought.data) ? bought.data[0] : bought.data;
  logEvent({ status: 200, kind: 'protection_bought', charged: row?.bought === true });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({
    bought: row?.bought === true,
    remaining: Number(row?.remaining ?? 0),
    period: String(row?.period ?? ''),
    shieldUntil: row?.shield_until ?? null,
    shieldSupported: true,
  });
}

/* ── POST ?op=payment-webhook ──────────────────────────────────────────── */

/**
 * The payment provider's callback. This is the only thing in the product that
 * may mark an order paid.
 *
 * The signature is checked first, in constant time, against a secret that lives
 * only in the server environment. A redirect the browser followed proves
 * nothing and is not accepted here or anywhere else; nor is a body without a
 * valid signature, however plausible it looks. Duplicate and out-of-order
 * deliveries are ordinary and handled: the state only moves forward, and a
 * second delivery of an event finds its work already done.
 */
/** What a signed event may do to the order it names, decided from the event
 * and the order's own row — never from the event alone. Pure, so the launch
 * contracts can prove the table. */
export type WebhookDecision =
  | { action: 'paid' }
  | { action: 'cancel' }
  | { action: 'ignore'; reason: 'stale' | 'unhandled' }
  | { action: 'refuse'; reason: 'amount_unreadable' | 'amount_mismatch' | 'currency_mismatch' };

export function webhookDecision(
  event: { type?: unknown; amountMinor?: unknown; currency?: unknown },
  order: { state: string; totalMinor: number | null; currency: string | null },
): WebhookDecision {
  if (event.type === 'payment.succeeded') {
    // A payment is only a payment for the amount the server asked for. An
    // event that names no amount, a different amount, or another currency is
    // refused with a status the provider will retry and a person will see.
    const amount = Number.isInteger(event.amountMinor) ? Number(event.amountMinor) : null;
    const currency = typeof event.currency === 'string' && /^[A-Z]{3}$/.test(event.currency) ? event.currency : null;
    if (amount === null || currency === null) return { action: 'refuse', reason: 'amount_unreadable' };
    if (order.totalMinor === null || amount !== order.totalMinor) return { action: 'refuse', reason: 'amount_mismatch' };
    if (order.currency === null || currency !== order.currency) return { action: 'refuse', reason: 'currency_mismatch' };
    return { action: 'paid' };
  }
  if (event.type === 'payment.failed' || event.type === 'checkout.expired') {
    // A failure or expiry describes a checkout that never paid. Once the order
    // is paid — say, a first checkout expired after a second one succeeded —
    // it says nothing about this order and must not cancel it.
    return order.state === 'awaiting_payment' ? { action: 'cancel' } : { action: 'ignore', reason: 'stale' };
  }
  if (event.type === 'payment.refunded') {
    return order.state === 'awaiting_payment' || order.state === 'paid' ? { action: 'cancel' } : { action: 'ignore', reason: 'stale' };
  }
  return { action: 'ignore', reason: 'unhandled' };
}

export async function handlePaymentWebhook(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const provider = process.env.PAYMENT_PROVIDER;
  if (!secret || !provider) {
    // Nothing is configured, so nothing can be paid for. Saying so is better
    // than a 404 that looks like a routing mistake to whoever is wiring it up.
    return jsonError(res, 503, 'not_configured', 'No payment provider is configured');
  }
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  const signature = req.headers['x-payment-signature'];
  const given = Buffer.from(typeof signature === 'string' ? signature : '', 'utf8');
  const candidates = given.length === 64 ? await rawBodyCandidates(req) : [];
  const raw = candidates.find((candidate) => {
    const expected = createHmac('sha256', secret).update(candidate).digest('hex');
    return timingSafeEqual(given, Buffer.from(expected, 'ascii'));
  });
  if (raw === undefined) {
    logEvent({ status: 401, kind: 'webhook_rejected' });
    return jsonError(res, 401, 'bad_signature', 'Signature did not verify');
  }

  // A signed body that is not a JSON object (text, `null`, an array) is a
  // malformed event: 400, never the TypeError or SyntaxError a 500 would
  // send back for the provider to retry forever.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonError(res, 400, 'bad_request', 'The event is not a JSON object');
  }
  const event = parsed as Record<string, unknown>;
  const orderId = typeof event.orderId === 'string' ? event.orderId : '';
  // Cut by code points so an emoji is not split, and refuse U+0000, which a
  // Postgres text column cannot hold.
  const providerRef = typeof event.providerRef === 'string' ? Array.from(event.providerRef).slice(0, 200).join('') : '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(orderId) || providerRef.length === 0 || unstorableText(providerRef)) {
    return jsonError(res, 400, 'bad_request', 'The event names no order');
  }

  const finish = await claimPaymentDelivery(createHash('sha256').update(raw).digest('hex'));
  if (!finish) return res.json({ applied: false, duplicate: true });
  let completed = false;
  async function accepted(applied: boolean) {
    await finish!(true);
    completed = true;
    return res.json({ applied });
  }
  try {
    return await applyPaymentDelivery(res, supabase, provider, event, orderId, providerRef, accepted);
  } finally {
    if (!completed) {
      // A failed request remains retryable when the short lease expires even if Redis is down.
      await finish(false).catch(() => logEvent({ level: 'warn', kind: 'payment_claim_release_failed' }));
    }
  }
}

async function applyPaymentDelivery(
  res: VercelResponse, supabase: SupabaseClient, provider: string, event: Record<string, unknown>,
  orderId: string, providerRef: string, accepted: (applied: boolean) => Promise<unknown>,
) {
  // The order's own row decides what the event may do. The event is signed,
  // so it is genuine; it is not, on its own, right about the amount or about
  // which checkout it describes.
  const row = await withTimeout(
    supabase.from('merch_orders').select('state,total_minor,currency').eq('order_id', orderId).maybeSingle(),
  );
  if (row.error) {
    if (isRpcMissing(row.error)) return migrationRequired(res);
    return jsonError(res, 500, 'db_error', 'Could not read the order');
  }
  if (!row.data) return jsonError(res, 404, 'not_found', 'Unknown order');
  const decision = webhookDecision(event, {
    state: String(row.data.state),
    totalMinor: Number.isInteger(row.data.total_minor) ? Number(row.data.total_minor) : null,
    currency: typeof row.data.currency === 'string' ? row.data.currency : null,
  });

  if (decision.action === 'refuse') {
    // 409, not 200: the provider keeps retrying and the mismatch stays
    // visible, which beats quietly marking an order paid for the wrong sum.
    logEvent({ status: 409, kind: 'webhook_refused', reason: decision.reason });
    return jsonError(res, 409, decision.reason, 'The event does not match the order');
  }

  if (decision.action === 'paid') {
    const paid = await withTimeout(
      supabase.rpc('mark_merch_order_paid', { p_order_id: orderId, p_provider: provider, p_provider_ref: providerRef }),
    );
    if (paid.error) {
      if (isRpcMissing(paid.error)) return migrationRequired(res);
      if (/unknown_order/i.test(paid.error.message ?? '')) return jsonError(res, 404, 'not_found', 'Unknown order');
      // The provider reference is unique per provider: one already recorded
      // on another order is a mismatch to look at, refused like the others
      // rather than a 500.
      if (paid.error.code === '23505') {
        logEvent({ status: 409, kind: 'webhook_refused', reason: 'provider_ref_conflict' });
        return jsonError(res, 409, 'provider_ref_conflict', 'The event does not match the order');
      }
      return jsonError(res, 500, 'db_error', 'Could not record the payment');
    }
    logEvent({ status: 200, kind: 'webhook_paid', applied: paid.data === true });
    return accepted(paid.data === true);
  }

  if (decision.action === 'cancel') {
    const cancelled = await withTimeout(
      supabase.rpc('cancel_merch_order', { p_order_id: orderId, p_user_id: null, p_subject: deploymentSubjectIds()[0] }),
    );
    if (cancelled.error) {
      if (isRpcMissing(cancelled.error)) return migrationRequired(res);
      const message = cancelled.error.message ?? '';
      if (!/order_not_cancellable|unknown_order/i.test(message)) {
        return jsonError(res, 500, 'db_error', 'Could not reconcile the payment');
      }
    }
    logEvent({ status: 200, kind: 'webhook_reconciled', type: String(event.type) });
    return accepted(true);
  }

  // An event we do not act on is still a delivered event: 200 so the provider
  // stops retrying, and a log line so it is visible. A stale negative event
  // about an order that has since been paid lands here too.
  logEvent({ status: 200, kind: 'webhook_ignored', type: String(event.type ?? 'unknown'), reason: decision.reason });
  return accepted(false);
}

/* ── GET/POST ?op=fulfilment (admin) ───────────────────────────────────── */

interface FulfilmentRow {
  order_id: string;
  state: string;
  created_at: string;
  [column: string]: unknown;
}

/** A routine refusal of an order change, answered as what it is; anything
 * else is a fault, answered with the safe 500 and no database text. */
function orderChangeRefused(
  res: VercelResponse,
  message: string | undefined,
  conflict: { reason: RegExp; code: string; message: string },
  fault: Record<string, unknown>,
) {
  if (/\bunknown_order\b/.test(message ?? '')) return jsonError(res, 404, 'not_found', 'No order with that id');
  if (conflict.reason.test(message ?? '')) return jsonError(res, 409, conflict.code, conflict.message);
  logEvent({ status: 500, ...fault, error: message });
  return jsonError(res, 500, 'db_error', 'Could not update the order');
}

/** A carrier or tracking reference: at most `max` code points, so an emoji is
 * never split, or null for anything but a string. */
const fulfilmentText = (value: unknown, max: number): string | null =>
  typeof value === 'string' ? Array.from(value).slice(0, max).join('') : null;

/**
 * Operations: read the orders waiting to go out, hand them to the supplier,
 * record a shipment, and cancel or refund one. With Spreadshop (#229) the
 * supplier step is the owner ordering the item at base price from the shop
 * preview, shipped to the address below; `submit` records that, and `ship`
 * records the carrier and tracking. The same op sets the monthly caps.
 *
 * Admin-only through the existing authorization, and deliberately narrow: it
 * shows an operator what they need to pack a parcel and nothing more. Addresses
 * are returned here because a picking list needs them, and they are never
 * logged or sent to analytics.
 *
 * The admin gate's own bucket comes first, as in api/admin: the route's write
 * limit skips a GET, and the gate can fall back to the legacy password.
 */
export async function handleFulfilment(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.admin))) return;
  if (!(await requireAdmin(req, res))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  const by = adminSubject(req);

  if (req.method === 'GET') {
    // `queue` (the default) is the picking list: paid redemptions and claimed
    // learning-path packages, which migration 035 leaves awaiting payment at
    // a total of zero. Any other view is one order state.
    const view = typeof req.query.state === 'string' ? req.query.state : 'queue';
    if (view !== 'queue' && !isOrderState(view)) return jsonError(res, 400, 'bad_request', 'Unknown order state');
    const columns = 'order_id,payment_kind,state,total_minor,currency,token_total,ship_name,ship_line1,ship_line2,'
      + 'ship_city,ship_postal,ship_country,carrier,tracking_ref,test_mode,created_at,updated_at';
    const [primary, unpaid, stock] = await Promise.all([
      withTimeout(
        supabase.from('merch_orders').select(columns).eq('state', view === 'queue' ? 'paid' : view)
          .order('created_at').limit(100),
      ),
      view === 'queue'
        ? withTimeout(
            supabase.from('merch_orders').select(columns).eq('state', 'awaiting_payment').like('order_id', 'reward-%')
              .order('created_at').limit(100),
          )
        : Promise.resolve({ data: [], error: null }),
      withTimeout(supabase.from('merch_stock').select('sku,variant,on_hand,reserved,updated_at').order('sku').order('variant')),
    ]);
    const failed = primary.error ?? unpaid.error;
    if (failed) {
      if (isRpcMissing(failed)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not load the queue');
    }
    const rows = [...((primary.data ?? []) as unknown as FulfilmentRow[]), ...((unpaid.data ?? []) as unknown as FulfilmentRow[])];
    const ids = rows.map((row) => String(row.order_id));
    const [items, claims] = ids.length
      ? await Promise.all([
          withTimeout(supabase.from('merch_order_items').select('order_id,sku,variant,quantity').in('order_id', ids)),
          withTimeout(supabase.from('path_reward_claims').select('order_id').in('order_id', ids)),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    // A failed claims read would drop every claimed package from the picking
    // list, and a failed items read would list parcels with nothing in them.
    if (items.error || claims.error) return jsonError(res, 500, 'db_error', 'Could not load the queue');
    // A package is an order a path claim points at, never a guess from its id.
    const packages = new Set(((claims.data ?? []) as { order_id: string | null }[]).map((row) => String(row.order_id)));
    const orders = rows
      .filter((row) => row.state !== 'awaiting_payment' || view !== 'queue' || packages.has(String(row.order_id)))
      .map((row) => ({ ...row, package: packages.has(String(row.order_id)) }))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({
      orders,
      items: items.data ?? [],
      // The month's budget per SKU and size. Absent rows mean nothing may be
      // redeemed; `stock.error` alone (028 missing) leaves the list empty.
      stock: ((stock.data ?? []) as { sku: string; variant: string; on_hand: number; reserved: number; updated_at: string }[])
        .map((row) => ({
          sku: row.sku,
          variant: row.variant,
          onHand: Number(row.on_hand),
          reserved: Number(row.reserved),
          updatedAt: String(row.updated_at),
        })),
    });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;

    // The monthly cap: how many units of one SKU and size the owner will
    // still post (migration 043). The database refuses a figure below what
    // paid orders already reserve.
    if (body.op === 'stock') {
      const item = isMerchSku(body.sku) ? merchItem(body.sku) : undefined;
      const variant = typeof body.variant === 'string' ? body.variant : '';
      const onHand = body.onHand;
      if (!item) return jsonError(res, 400, 'bad_request', 'Unknown item');
      if (item.variants.length > 0 ? !item.variants.includes(variant) : variant !== '') {
        return jsonError(res, 400, 'bad_request', 'Unknown size for that item');
      }
      if (typeof onHand !== 'number' || !Number.isInteger(onHand) || onHand < 0 || onHand > 100_000) {
        return jsonError(res, 400, 'bad_request', 'The cap must be a whole number from 0 to 100000');
      }
      const set = await withTimeout(
        supabase.rpc('set_merch_stock', { p_sku: item.sku, p_variant: variant, p_on_hand: onHand }),
      );
      if (set.error) {
        if (isRpcMissing(set.error)) {
          return jsonError(res, 503, 'migration_required', 'Merchandise migration 043 is not installed');
        }
        if (/below_reserved/i.test(set.error.message ?? '')) {
          return jsonError(res, 409, 'below_reserved', 'Paid orders already hold more units than that');
        }
        return jsonError(res, 500, 'db_error', 'Could not save the cap');
      }
      const row = (set.data ?? {}) as { sku?: string; variant?: string; onHand?: number; reserved?: number };
      logEvent({ status: 200, kind: 'merch_stock_set', by, sku: item.sku });
      return res.json({
        stock: { sku: row.sku ?? item.sku, variant: row.variant ?? variant, onHand: Number(row.onHand ?? onHand), reserved: Number(row.reserved ?? 0) },
      });
    }

    const orderId = typeof body.orderId === 'string' ? body.orderId : '';
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(orderId)) return jsonError(res, 400, 'bad_request', 'An order is required');

    if (body.op === 'cancel') {
      const subject = deploymentSubjectIds()[0];
      const cancelled = await withTimeout(
        supabase.rpc('cancel_merch_order', { p_order_id: orderId, p_user_id: null, p_subject: subject }),
      );
      if (cancelled.error) {
        if (isRpcMissing(cancelled.error)) return migrationRequired(res);
        return orderChangeRefused(
          res, cancelled.error.message,
          { reason: /\border_not_cancellable\b/, code: 'not_cancellable', message: 'This order can no longer be cancelled' },
          { kind: 'order_cancel_failed', by, orderId },
        );
      }
      logEvent({ status: 200, kind: 'order_cancelled_by_admin', by, orderId });
      return res.json({ outcome: String(cancelled.data ?? 'cancelled') });
    }

    const state = body.op === 'ship' ? 'shipped' : body.op === 'submit' ? 'submitted' : null;
    if (!state) return jsonError(res, 400, 'bad_request', 'Unknown operation');
    const carrier = fulfilmentText(body.carrier, 60);
    const tracking = fulfilmentText(body.trackingRef, 120);
    // Postgres text cannot hold U+0000: refused here rather than raised there.
    if (unstorableText(carrier) || unstorableText(tracking)) {
      return jsonError(res, 400, 'bad_request', 'The carrier and tracking reference cannot contain a null character');
    }
    const advanced = await withTimeout(
      supabase.rpc('advance_merch_order', {
        p_order_id: orderId, p_state: state, p_carrier: carrier, p_tracking: tracking,
      }),
    );
    if (advanced.error) {
      if (isRpcMissing(advanced.error)) return migrationRequired(res);
      return orderChangeRefused(
        res, advanced.error.message,
        { reason: /\border_not_paid\b/, code: 'invalid_transition', message: 'The order is not paid, so it cannot move on yet' },
        { kind: 'order_advance_failed', by, orderId, state },
      );
    }
    logEvent({ status: 200, kind: 'order_advanced', by, orderId, state });
    return res.json({ applied: advanced.data === true });
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/** The margin each configured item implies, for the readiness report. Shown
 * rather than hidden, including when it is negative. */
export async function merchMargins(): Promise<{ sku: MerchSku; marginMinor: number; currency: string }[]> {
  const settings = await getGameSettings();
  return Object.entries(settings.merch.pricing).flatMap(([sku, pricing]) =>
    pricing && isMerchSku(sku)
      ? [{ sku, marginMinor: merchMarginMinor(pricing), currency: pricing.currency }]
      : [],
  );
}
