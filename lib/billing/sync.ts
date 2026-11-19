/** From Stripe to `entitlement_grants`.
 *
 * Every path that changes an entitlement ends in `syncSubscription`: it
 * fetches the subscription from Stripe, works out which account owns it and
 * mirrors it with `upsert_provider_entitlement`. Events arrive out of order and
 * more than once; reading the live object instead of the event snapshot makes
 * the result the same whatever the order. Only two callers exist: the signed
 * webhook and the success page's server-side session lookup. A redirect or a
 * browser never changes an entitlement.
 *
 * Manual and promo grants are separate rows keyed by nothing Stripe knows, so
 * nothing here can touch them. */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { createLogger, isRpcMissing, withTimeout } from '../http';
import { accountExists } from '../entitlements';
import { deploymentSubjectIds } from '../product-scope';
import { billingConfig, premiumPriceIds, type BillingConfig } from './config';
import { stripeErrorCode, type StripeApi } from './stripe';

const log = createLogger('user/billing');

export interface BillingDeps {
  supabase: SupabaseClient;
  stripe: StripeApi;
  now?: () => number;
}

/** Something about the event can never be applied: an account the server
 * cannot resolve, a subscription that does not exist. Recorded on the event
 * and answered 200, so Stripe stops retrying. */
export class BillingPermanentError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'BillingPermanentError';
  }
}

/** The database routines of migration 039 are not installed yet. */
export class BillingMigrationError extends Error {
  constructor() {
    super('migration_required');
    this.name = 'BillingMigrationError';
  }
}

/** The text the buyer ticks in Checkout. Stored with the session id. */
export const WAIVER_TEXT =
  'I want Premium to start now and I understand that I lose my 14-day right of withdrawal for digital content.';

/** Subscription states `entitlement_grants.status` accepts from Stripe. */
const PROVIDER_STATUSES = new Set([
  'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused',
]);
/** States in which a subscription may still charge or open Premium. */
export const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

const USER_ID = /^[A-Za-z0-9-]{1,128}$/;

export const idOf = (value: unknown): string | null => {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id;
  return null;
};

const iso = (seconds: number | null | undefined): string | null =>
  typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

/** When the paid period ends. The API version this code pins keeps the period
 * on each subscription item; older versions kept it on the subscription. A
 * scheduled cancellation that comes first ends the subscription earlier. */
export function periodEnd(sub: Stripe.Subscription): string | null {
  const itemEnds = (sub.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === 'number');
  const legacy = (sub as unknown as { current_period_end?: unknown }).current_period_end;
  let end = itemEnds.length ? Math.max(...itemEnds) : typeof legacy === 'number' ? legacy : null;
  if (typeof sub.cancel_at === 'number' && (end === null || sub.cancel_at < end)) end = sub.cancel_at;
  return iso(end);
}

/** When the current period began: for a past_due subscription, the renewal
 * that failed. */
function periodStart(sub: Stripe.Subscription): string | null {
  const itemStarts = (sub.items?.data ?? [])
    .map((item) => item.current_period_start)
    .filter((value): value is number => typeof value === 'number');
  const legacy = (sub as unknown as { current_period_start?: unknown }).current_period_start;
  return iso(itemStarts.length ? Math.max(...itemStarts) : typeof legacy === 'number' ? legacy : null);
}

/** The `product` metadata devShark's checkout writes on every session and
 * subscription it creates. The Stripe account may sell other things, and
 * another product may write `supabase_user_id` too; this value is devShark's
 * alone (finding BILL-1). */
export const DEVSHARK_PRODUCT = 'devshark';

type WithMetadata = { metadata?: Stripe.Metadata | null };

/** The product the metadata names, or null when it names none, as on
 * subscriptions made before the marker existed. */
function markedProduct(object: WithMetadata): string | null {
  const value = object.metadata?.product;
  return typeof value === 'string' && value ? value : null;
}

/** Marked by devShark's checkout itself. */
const markedDevshark = (object: WithMetadata): boolean => markedProduct(object) === DEVSHARK_PRODUCT;

/** Made by devShark's checkout: its product marker, or, on a session or
 * subscription made before the marker, the account id it wrote. Another
 * product's marker wins over an account id. */
function fromDevsharkCheckout(object: WithMetadata): boolean {
  const product = markedProduct(object);
  if (product !== null) return product === DEVSHARK_PRODUCT;
  return typeof object.metadata?.supabase_user_id === 'string' && object.metadata.supabase_user_id.length > 0;
}

/** Whether the subscription bills a devShark Premium Price. The Stripe account
 * may sell other things, and a subscription for one of them on a customer
 * devShark created must not open Premium (finding integrity-7). Another
 * product's marker says no whatever the Price. With no Price configured at
 * all the question cannot be asked, and the checkout's metadata decides. */
function billsPremium(sub: Stripe.Subscription, config: BillingConfig = billingConfig()): boolean {
  if (markedProduct(sub) !== null && !markedDevshark(sub)) return false;
  const ours = premiumPriceIds(config);
  if (ours.size === 0) return fromDevsharkCheckout(sub);
  return (sub.items?.data ?? []).some((item) => ours.has(idOf(item.price) ?? ''));
}

/** A devShark subscription: it bills a devShark Premium Price or devShark's
 * checkout made it. Anything else on a shared Stripe account is left alone. */
export const isDevsharkSubscription = (sub: Stripe.Subscription, config: BillingConfig = billingConfig()): boolean =>
  billsPremium(sub, config) || fromDevsharkCheckout(sub);

/** Whether the subscription is set to end instead of renewing. */
export const endsInsteadOfRenewing = (sub: Stripe.Subscription): boolean =>
  sub.cancel_at_period_end === true || (typeof sub.cancel_at === 'number' && sub.status !== 'canceled');

const priceOf = (sub: Stripe.Subscription): string | null => idOf(sub.items?.data?.[0]?.price) ?? null;

/** The subscription an invoice bills, in this API version's shape or the older one. */
function subscriptionOfInvoice(invoice: Stripe.Invoice): string | null {
  const parent = invoice.parent?.subscription_details?.subscription;
  return idOf(parent) ?? idOf((invoice as unknown as { subscription?: unknown }).subscription);
}

async function rpc<T>(deps: BillingDeps, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await withTimeout(deps.supabase.rpc(name, args));
  if (error) {
    if (isRpcMissing(error)) throw new BillingMigrationError();
    const message = error.message ?? 'db_error';
    // Migration 053: the account was deleted between the check and the write.
    if (/\bunknown_account\b/.test(message)) throw new BillingPermanentError('unknown_user', name);
    if (/_conflict/.test(message)) throw new BillingPermanentError(message.match(/[a-z_]+_conflict/)?.[0] ?? 'conflict');
    throw new Error(`db_error: ${name}`);
  }
  return data as T;
}

export const customerOwner = (deps: BillingDeps, customerId: string) =>
  rpc<string | null>(deps, 'billing_customer_owner', { p_provider_customer_id: customerId });

export const linkCustomer = (deps: BillingDeps, userId: string, customerId: string) =>
  rpc<boolean>(deps, 'link_billing_customer', { p_user_id: userId, p_provider_customer_id: customerId });

export interface BillingAccount {
  customerId: string | null;
  /** A subscription of the account can still charge (migration 053). */
  providerLive: boolean;
  /** Those subscriptions, oldest first; empty before migration 053. */
  liveSubscriptionIds: string[];
}

export async function billingAccount(deps: BillingDeps, userId: string): Promise<BillingAccount> {
  const raw = await rpc<Record<string, unknown> | null>(deps, 'billing_account', { p_user_id: userId });
  const live = Array.isArray(raw?.liveSubscriptionIds) ? (raw.liveSubscriptionIds as unknown[]) : [];
  return {
    customerId: typeof raw?.customerId === 'string' && raw.customerId ? raw.customerId : null,
    providerLive: raw?.providerLive === true,
    liveSubscriptionIds: live.filter((id): id is string => typeof id === 'string'),
  };
}

/** Which account a subscription belongs to. The id written into the
 * subscription's metadata at checkout comes first; the customer link and the
 * caller's hint (the session's client_reference_id) back it up. Two sources
 * that disagree, or an account that does not exist, cannot be applied. */
async function resolveAccount(deps: BillingDeps, sub: Stripe.Subscription, hint: string | null): Promise<string> {
  const fromMetadata = typeof sub.metadata?.supabase_user_id === 'string' ? sub.metadata.supabase_user_id : null;
  const customerId = idOf(sub.customer);
  const owner = customerId ? await customerOwner(deps, customerId) : null;
  const userId = fromMetadata ?? hint ?? owner;
  if (!userId || !USER_ID.test(userId)) throw new BillingPermanentError('unknown_user', sub.id);
  for (const other of [hint, owner]) {
    if (other && other !== userId) throw new BillingPermanentError('owner_conflict', sub.id);
  }
  if (!(await accountExists(deps.supabase, userId))) throw new BillingPermanentError('unknown_user', sub.id);
  return userId;
}

/** Whether Auth says this account does not exist: an answer about this very
 * id. `accountExists` also reads a rejected key ("invalid") as missing, which
 * is safe for a write it skips but not for a subscription it would end. */
async function accountGone(deps: BillingDeps, userId: string): Promise<boolean> {
  try {
    const { error } = await withTimeout(deps.supabase.auth.admin.getUserById(userId));
    if (!error) return false;
    const e = error as unknown as { status?: unknown; code?: unknown; message?: unknown };
    return e.status === 404 || e.code === 'user_not_found' || /user not found/i.test(String(e.message ?? ''));
  } catch {
    return false;
  }
}

/** A subscription devShark's checkout made for an account that was deleted
 * before it was paid (finding BILL-3): nobody can use it and nothing else
 * would stop it, so it ends at Stripe now, without a new invoice or a
 * proration. Only the product marker counts here, never an account id alone,
 * which another product may write too. Nothing is refunded; that is the
 * owner's call, and the log line says so. */
async function endOrphanedSubscription(deps: BillingDeps, sub: Stripe.Subscription): Promise<void> {
  if (!markedDevshark(sub) || !LIVE_SUBSCRIPTION_STATUSES.has(sub.status)) return;
  const userId = sub.metadata?.supabase_user_id;
  if (typeof userId !== 'string' || !USER_ID.test(userId) || !(await accountGone(deps, userId))) return;
  try {
    await deps.stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
  } catch (error) {
    if (stripeErrorCode(error).code !== 'resource_missing') throw error;
  }
  log({
    level: 'warn',
    status: 200,
    kind: 'orphaned_subscription_ended',
    subscription: sub.id,
    action: 'Its account no longer exists. The subscription is cancelled; refund its payment in the Stripe dashboard if one was taken.',
  });
}

/** `resolveAccount`, and a devShark subscription whose account is gone is
 * ended on the way (BILL-3). */
async function accountFor(deps: BillingDeps, sub: Stripe.Subscription, hint: string | null): Promise<string> {
  try {
    return await resolveAccount(deps, sub, hint);
  } catch (error) {
    if (error instanceof BillingPermanentError && error.code === 'unknown_user') await endOrphanedSubscription(deps, sub);
    throw error;
  }
}

async function retrieveSubscription(deps: BillingDeps, subscriptionId: string): Promise<Stripe.Subscription> {
  try {
    return await deps.stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    if (stripeErrorCode(error).code === 'resource_missing') throw new BillingPermanentError('subscription_missing', subscriptionId);
    throw error;
  }
}

export interface SyncResult {
  userId: string;
  subscriptionId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

/** How many times a mirror reads the subscription again after writing it. */
const MIRROR_REREADS = 2;

/** Mirror one subscription into its provider grant. `revoke` writes the grant
 * as revoked with that note (a full refund, a dispute, a withdrawal); a revoked
 * grant stays revoked whatever Stripe says later.
 *
 * Only a subscription that bills a devShark Premium Price opens Premium. One
 * that devShark's checkout created and that no longer bills such a Price (a
 * plan switched to another product) is written as canceled, so Premium ends
 * and a switch back opens it again. Any other subscription is not devShark's:
 * it is refused as permanent, which records the event with the reason, and a
 * revocation does not make it devShark's. A devShark subscription whose
 * account was deleted is ended at Stripe (BILL-3) and recorded as
 * unknown_user.
 *
 * Stripe sends the events of one change within the same second, and each
 * delivery reads the live subscription, so the order they arrive in does not
 * matter. Two deliveries running at once still can: one that read the state
 * before a payment went through may write it after another delivery wrote the
 * paid state, and a paid subscription would stay "incomplete" until the next
 * renewal. So after writing, the mirror reads the subscription again and
 * writes once more when it moved on. The last write of every delivery then
 * follows a read made after it wrote. */
export async function syncSubscription(
  deps: BillingDeps,
  subscriptionId: string,
  options: { userHint?: string | null; revoke?: string | null } = {},
): Promise<SyncResult> {
  let sub = await retrieveSubscription(deps, subscriptionId);
  if (!billsPremium(sub) && !fromDevsharkCheckout(sub)) throw new BillingPermanentError('not_devshark_price', sub.id);
  const userId = await accountFor(deps, sub, options.userHint ?? null);
  const customerId = idOf(sub.customer);
  if (customerId) await linkCustomer(deps, userId, customerId);
  const today = day(Math.floor((deps.now?.() ?? Date.now()) / 1000));
  let mirror = mirrorOf(sub, userId, options.revoke ?? null, today);
  await rpc(deps, 'upsert_provider_entitlement', mirror.args);
  // A revoked grant stays revoked whatever is read later.
  if (!options.revoke) {
    for (let pass = 0; pass < MIRROR_REREADS; pass += 1) {
      sub = await retrieveSubscription(deps, subscriptionId);
      const fresh = mirrorOf(sub, userId, null, today);
      if (JSON.stringify(fresh.args) === JSON.stringify(mirror.args)) break;
      mirror = fresh;
      await rpc(deps, 'upsert_provider_entitlement', mirror.args);
    }
  }
  return mirror.result;
}

/** The provider grant one read of a subscription writes. */
function mirrorOf(sub: Stripe.Subscription, userId: string, revoke: string | null, today: string) {
  const premium = billsPremium(sub);
  const status = revoke ? 'revoked' : premium ? sub.status : 'canceled';
  if (status !== 'revoked' && !PROVIDER_STATUSES.has(status)) throw new BillingPermanentError('unknown_status', `${sub.id} ${status}`);
  const currentPeriodEnd = periodEnd(sub);
  const cancelAtPeriodEnd = endsInsteadOfRenewing(sub);
  const note = revoke ?? (premium ? null : `Ended: the subscription no longer bills a devShark Premium price (${today}).`);
  return {
    args: {
      p_user_id: userId,
      p_subscription_id: sub.id,
      p_status: status,
      p_price_id: priceOf(sub),
      p_current_period_end: currentPeriodEnd,
      p_cancel_at_period_end: cancelAtPeriodEnd,
      p_note: note,
      // The grace window of a failed renewal runs from the start of the unpaid
      // period; the database keeps the first value it sees (finding product-3).
      p_past_due_since: status === 'past_due' ? periodStart(sub) : null,
    },
    result: { userId, subscriptionId: sub.id, status, currentPeriodEnd, cancelAtPeriodEnd } satisfies SyncResult,
  };
}

/** The subscription a payment paid for, found through its invoice. */
async function subscriptionForPayment(
  deps: BillingDeps,
  paymentIntentId: string | null,
  chargeId: string | null,
): Promise<string | null> {
  if (paymentIntentId) {
    const payments = await deps.stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
      limit: 1,
      expand: ['data.invoice'],
    });
    const invoice = payments.data[0]?.invoice;
    if (invoice && typeof invoice === 'object' && !('deleted' in invoice && invoice.deleted)) {
      const found = subscriptionOfInvoice(invoice as Stripe.Invoice);
      if (found) return found;
    } else if (typeof invoice === 'string') {
      const found = subscriptionOfInvoice(await deps.stripe.invoices.retrieve(invoice));
      if (found) return found;
    }
  }
  if (chargeId) {
    // Older API versions name the invoice on the charge itself.
    const charge = await deps.stripe.charges.retrieve(chargeId);
    const invoiceId = idOf((charge as unknown as { invoice?: unknown }).invoice);
    if (invoiceId) return subscriptionOfInvoice(await deps.stripe.invoices.retrieve(invoiceId));
  }
  return null;
}

/** End a subscription now and revoke its grant: a full refund, a dispute, an
 * early fraud warning or a withdrawal. Refunds, disputes and fraud warnings
 * are events of the whole Stripe account, so nothing happens unless the
 * subscription is devShark's and its account exists (finding BILL-1); anything
 * else is refused as permanent before Stripe is asked to change anything.
 * `before` runs once that is settled and before the cancellation: the refund
 * of an early fraud warning. Cancelling at Stripe stops further charges; the
 * grant is written revoked with the reason in its note. Then what Premium
 * paid out while the subscription was live is taken back. */
export async function revokeSubscription(
  deps: BillingDeps,
  subscriptionId: string,
  note: string,
  { before }: { before?: () => Promise<void> } = {},
): Promise<SyncResult> {
  const sub = await retrieveSubscription(deps, subscriptionId);
  if (!isDevsharkSubscription(sub)) throw new BillingPermanentError('not_devshark_price', sub.id);
  await accountFor(deps, sub, null);
  if (before) await before();
  if (sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
    try {
      await deps.stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
    } catch (error) {
      // Already ended between the read and the cancel: nothing left to stop.
      if (stripeErrorCode(error).code !== 'resource_missing') throw error;
    }
  }
  const result = await syncSubscription(deps, subscriptionId, { revoke: note.slice(0, 500) });
  await takeBackPremiumBenefits(deps, result.subscriptionId);
  return result;
}

/** A refunded, disputed or withdrawn subscription keeps nothing that only
 * Premium paid for (finding integrity-3). Migration 041's
 * revoke_premium_benefits cancels the coin redemptions still waiting for
 * fulfilment that were placed while the grant was live, which returns their
 * coins, then debits the milestone coins and the Premium doubling credited in
 * that time. It does nothing while another grant keeps the account Premium,
 * and a second call changes nothing. A failure is thrown, so the webhook
 * answers 500 and Stripe delivers the event again. */
async function takeBackPremiumBenefits(deps: BillingDeps, subscriptionId: string): Promise<void> {
  const subject = deploymentSubjectIds()[0] ?? 'webdev';
  const { data, error } = await withTimeout(
    deps.supabase.rpc('revoke_premium_benefits', { p_subscription_id: subscriptionId, p_subject: subject }),
  );
  if (error) {
    // Before 041 no coin was ever doubled or paid as a milestone.
    if (isRpcMissing(error)) return;
    throw new Error('db_error: revoke_premium_benefits');
  }
  const outcome = (data ?? {}) as { cancelledOrders?: unknown; debited?: unknown; skipped?: unknown };
  log({
    status: 200,
    kind: 'premium_benefits_revoked',
    cancelled_orders: Number(outcome.cancelledOrders ?? 0),
    debited: Number(outcome.debited ?? 0),
    ...(typeof outcome.skipped === 'string' ? { skipped: outcome.skipped } : {}),
  });
}

const day = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/* ── Checkout sessions ──────────────────────────────────────────────────── */

export interface SessionOutcome {
  status: 'complete' | 'pending' | 'expired';
  sync: SyncResult | null;
}

/** Apply a completed Checkout Session: link the customer, keep the consent
 * with the session id, mirror the subscription. Shared by the webhook and the
 * success page, and idempotent, so both may run for one session. */
export const CHECKOUT_CONSENT_VERSION = 'devshark-checkout-form-v1';

export async function applyCheckoutSession(
  deps: BillingDeps,
  session: Stripe.Checkout.Session,
  acceptedAtSeconds: number,
): Promise<SessionOutcome> {
  if (session.mode !== 'subscription') throw new BillingPermanentError('not_a_subscription', session.id);
  if (session.status === 'expired') return { status: 'expired', sync: null };
  const subscriptionId = idOf(session.subscription);
  if (session.status !== 'complete' || session.payment_status === 'unpaid' || !subscriptionId) {
    return { status: 'pending', sync: null };
  }
  const userId = session.client_reference_id;
  if (!userId || !USER_ID.test(userId)) throw new BillingPermanentError('unknown_user', session.id);
  if (!(await accountExists(deps.supabase, userId))) {
    // Deleted after it opened Checkout (finding BILL-3): no customer link and
    // no consent row for the erased id. Mirroring ends the subscription at
    // Stripe and records unknown_user.
    await syncSubscription(deps, subscriptionId, { userHint: userId });
    throw new BillingPermanentError('unknown_user', session.id);
  }
  const customerId = idOf(session.customer);
  if (customerId) await linkCustomer(deps, userId, customerId);
  const formConsent = session.metadata?.checkout_consent_version === CHECKOUT_CONSENT_VERSION
    && session.metadata.product === DEVSHARK_PRODUCT
    && session.metadata.supabase_user_id === userId;
  const consentAt = formConsent ? Date.parse(session.metadata!.checkout_consent_at ?? '') : NaN;
  const validFormConsent = formConsent && Number.isFinite(consentAt) && consentAt > 0 && consentAt < (acceptedAtSeconds + 1) * 1000;
  if (session.consent?.terms_of_service === 'accepted' || validFormConsent) {
    await rpc(deps, 'record_checkout_consent', {
      p_session_id: session.id,
      p_user_id: userId,
      p_subscription_id: subscriptionId,
      p_waiver_text: (validFormConsent ? session.metadata!.checkout_consent_text || WAIVER_TEXT : session.custom_text?.terms_of_service_acceptance?.message || WAIVER_TEXT).slice(0, 1200),
      p_accepted_at: new Date(validFormConsent ? consentAt : acceptedAtSeconds * 1000).toISOString(),
    });
  }
  return { status: 'complete', sync: await syncSubscription(deps, subscriptionId, { userHint: userId }) };
}

/** Every subscription of one customer, in every state, page by page. With
 * `status: 'all'` Stripe lists ended ones too, newest first, so a customer
 * with many abandoned attempts (`incomplete_expired`) could push a live
 * subscription past one page, and the second-checkout guard, the cancel page
 * and account deletion would not see it. */
export async function allSubscriptionsOf(deps: BillingDeps, customerId: string): Promise<Stripe.Subscription[]> {
  const subs: Stripe.Subscription[] = [];
  let startingAfter: string | undefined;
  // Ten pages of 100 is far beyond any real customer; the cap only bounds a
  // runaway list.
  for (let page = 0; page < 10; page += 1) {
    const list = await deps.stripe.subscriptions.list({
      customer: customerId, status: 'all', limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subs.push(...list.data);
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return subs;
}

/** The customer's devShark subscriptions that can still charge, as Stripe has
 * them right now, before any webhook about them arrived. A customer Stripe no
 * longer has holds none. */
export async function liveDevsharkSubscriptions(deps: BillingDeps, customerId: string): Promise<Stripe.Subscription[]> {
  try {
    const subs = await allSubscriptionsOf(deps, customerId);
    return subs.filter((sub) => LIVE_SUBSCRIPTION_STATUSES.has(sub.status) && isDevsharkSubscription(sub));
  } catch (error) {
    if (stripeErrorCode(error).code === 'resource_missing') return [];
    throw error;
  }
}

/** Expire the customer's open devShark Checkout Sessions, so none of them can
 * be paid any more (findings BILL-2 and BILL-3). `completed` says one was paid
 * between the list and its expiry, in another tab a moment ago. */
export async function expireOpenCheckouts(deps: BillingDeps, customerId: string): Promise<{ expired: number; completed: boolean }> {
  let open: Stripe.Checkout.Session[];
  try {
    open = (await deps.stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })).data;
  } catch (error) {
    if (stripeErrorCode(error).code === 'resource_missing') return { expired: 0, completed: false };
    throw error;
  }
  let expired = 0;
  let completed = false;
  for (const session of open) {
    if (session.status !== 'open' || !fromDevsharkCheckout(session)) continue;
    try {
      await deps.stripe.checkout.sessions.expire(session.id);
      expired += 1;
    } catch (error) {
      // Stripe refuses to expire a session that is no longer open; anything
      // else is an outage.
      const { status } = stripeErrorCode(error);
      if (status === null || status >= 500) throw error;
      const now = await deps.stripe.checkout.sessions.retrieve(session.id);
      if (now.status === 'complete') completed = true;
      else if (now.status !== 'expired') throw error;
    }
  }
  return { expired, completed };
}

/** Two subscriptions that can both charge one account: a second checkout was
 * paid before the first ended (finding BILL-2). Refunding one is the owner's
 * decision, so this only says so, clearly. A failed read never fails the
 * event. */
async function warnOnSecondSubscription(deps: BillingDeps, sync: SyncResult): Promise<void> {
  if (!LIVE_SUBSCRIPTION_STATUSES.has(sync.status)) return;
  try {
    const others = (await billingAccount(deps, sync.userId)).liveSubscriptionIds.filter((id) => id !== sync.subscriptionId);
    if (others.length === 0) return;
    log({
      level: 'warn',
      status: 200,
      kind: 'second_subscription',
      subscription: sync.subscriptionId,
      others,
      action: 'This account has more than one subscription that can charge it. Nothing was refunded: check them in the Stripe dashboard.',
    });
  } catch {
    // The subscription is mirrored; the warning is best effort.
  }
}

/* ── Webhook events ─────────────────────────────────────────────────────── */

export interface EventOutcome {
  outcome: 'applied' | 'ignored';
  /** Why nothing changed, kept on the event row for the operator. */
  note?: string;
  sync?: SyncResult;
}

export async function processBillingEvent(deps: BillingDeps, event: Stripe.Event): Promise<EventOutcome> {
  const object = event.data.object as unknown as Record<string, unknown>;
  switch (event.type) {
    case 'checkout.session.completed': {
      const id = idOf(object);
      if (!id) throw new BillingPermanentError('malformed_event');
      const session = await deps.stripe.checkout.sessions.retrieve(id);
      if (session.mode !== 'subscription') return { outcome: 'ignored', note: 'not_a_subscription' };
      const applied = await applyCheckoutSession(deps, session, event.created);
      if (!applied.sync) return { outcome: 'ignored', note: `session_${applied.status}` };
      await warnOnSecondSubscription(deps, applied.sync);
      return { outcome: 'applied', sync: applied.sync };
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const id = idOf(object);
      if (!id) throw new BillingPermanentError('malformed_event');
      const sync = await syncSubscription(deps, id);
      if (event.type === 'customer.subscription.created') await warnOnSecondSubscription(deps, sync);
      return { outcome: 'applied', sync };
    }
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const id = idOf(object);
      if (!id) throw new BillingPermanentError('malformed_event');
      const invoice = await deps.stripe.invoices.retrieve(id);
      const subscriptionId = subscriptionOfInvoice(invoice);
      if (!subscriptionId) return { outcome: 'ignored', note: 'not_a_subscription' };
      return { outcome: 'applied', sync: await syncSubscription(deps, subscriptionId) };
    }
    case 'charge.refunded': {
      const id = idOf(object);
      if (!id) throw new BillingPermanentError('malformed_event');
      const charge = await deps.stripe.charges.retrieve(id);
      const full = charge.refunded === true || (charge.amount_captured > 0 && charge.amount_refunded >= charge.amount_captured);
      // A partial refund is a goodwill gesture; Premium stays as it is.
      if (!full) return { outcome: 'ignored', note: 'partial_refund' };
      const subscriptionId = await subscriptionForPayment(deps, idOf(charge.payment_intent), charge.id);
      if (!subscriptionId) return { outcome: 'ignored', note: 'not_a_subscription' };
      const note = `Revoked: charge ${charge.id} was refunded in full (${day(event.created)}).`;
      return { outcome: 'applied', sync: await revokeSubscription(deps, subscriptionId, note) };
    }
    case 'charge.dispute.created': {
      const dispute = object as unknown as Stripe.Dispute;
      const subscriptionId = await subscriptionForPayment(deps, idOf(dispute.payment_intent), idOf(dispute.charge));
      if (!subscriptionId) return { outcome: 'ignored', note: 'not_a_subscription' };
      const note = `Revoked: dispute ${dispute.id} opened on charge ${idOf(dispute.charge) ?? 'unknown'} (${day(event.created)}).`;
      return { outcome: 'applied', sync: await revokeSubscription(deps, subscriptionId, note) };
    }
    case 'radar.early_fraud_warning.created': {
      const warning = object as unknown as Stripe.Radar.EarlyFraudWarning;
      const chargeId = idOf(warning.charge);
      const subscriptionId = await subscriptionForPayment(deps, idOf(warning.payment_intent), chargeId);
      if (!subscriptionId) return { outcome: 'ignored', note: 'not_a_subscription' };
      // A refund costs less than the dispute that usually follows a warning.
      // It runs only once the subscription is known to be devShark's.
      const refund = warning.actionable && chargeId
        ? async () => {
          try {
            await deps.stripe.refunds.create(
              { charge: chargeId, reason: 'fraudulent', metadata: { early_fraud_warning: warning.id } },
              { idempotencyKey: `devshark-efw-${warning.id}` },
            );
          } catch (error) {
            if (stripeErrorCode(error).code !== 'charge_already_refunded') throw error;
          }
        }
        : undefined;
      const note = `Revoked: early fraud warning ${warning.id} on charge ${chargeId ?? 'unknown'}, refunded (${day(event.created)}).`;
      return { outcome: 'applied', sync: await revokeSubscription(deps, subscriptionId, note, { before: refund }) };
    }
    default:
      return { outcome: 'ignored', note: 'unhandled_type' };
  }
}
