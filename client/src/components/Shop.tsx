// Rewards (the /shop route; the navigation says Rewards since #227).
//
// Coins are the server ledger of migration 028: product copy says coins, the
// API keeps `token`. The balance, the ledger lines, the prices, the stock and
// the orders all come from the server. Nothing on this page computes what
// anything costs or what anything earns, and nothing on it can credit a coin:
// it asks, and the server decides and records.
//
// Sections, in order: the wallet with
// its last 25 ledger lines, "How to earn" with live progress, "Invite a
// friend" (#228), merchandise, the crown and streak protection, orders and
// claims, and "Find devShark elsewhere". Redeeming merchandise is Premium
// only: a free account sees the items and the upgrade sheet, and the server
// answers a redemption with 402. Buying is Spreadshop's (#229): each tile links
// to the item in the devShark shop there when client/product-catalog.ts has
// its URL, and a tile shows a mockup only when the build found one under
// client/public/merch.
//
// Merchandise is paused until next quarter (owner decision 10): while
// MERCH_ENABLED in shared/rewards.ts is false the merchandise section, the
// redemption form and "Orders and claims" do not render, and the orders are
// never fetched. The crown and streak protection stay.
//
// Nothing here changes access, content, XP, scores, ranks or leaderboards.
// The one exception is bounded in shared/rewards.ts: a streak protection
// changes the day count of a streak and nothing else. Premium, which decides
// what a learner may open, is sold on /premium and never for coins.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/VStack';
import { Grid } from '@astryxdesign/core/Grid';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { AppToast } from './ui/AppToast';
import { Crown } from './ui/Crown';
import { CoinIcon, ShieldIcon } from './ui/icons';
import { LockedButton } from './ui/LockedButton';
import { Kicker } from './landing/LandingKit';
import { ReferralInvite } from './ReferralInvite';
import { PageHeader } from './ui/PageHeader';
import { StatePanel } from './ui/StatePanel';
import { useT } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useAuth } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import { friendlyError } from '../lib/api';
import { entitlementQuery, useEntitlement } from '../lib/entitlement';
import { useGameConfig } from '../lib/gameConfig';
import { openUpgradeSheet } from '../lib/upgradeSheet';
import { openSignIn } from '../lib/signInDialog';
import { categoryLabelKey } from '../lib/categories';
import { referralQuery } from '../lib/referral';
import { readOnce, settled, useFirstData } from '../lib/routeData';
import {
  useWallet,
  walletQuery,
  type EarnSummary,
  type ShopItem,
  type WalletEntry,
} from '../lib/rewards';
import {
  formatMoney,
  ordersQuery,
  shopQuery,
  useCosmeticMutation,
  useOrderMutation,
  useOrders,
  useShop,
  useProtectionMutation,
} from '../lib/rewardsShop';
import { MERCH_IMAGES } from '../lib/merchImages';
import { MERCH_SHOP } from '../../product-catalog';
import { EVOLVING_CHALLENGES } from '../../../shared/evolving';
import { MERCH_ENABLED, SHIRT_SIZES, type MerchPromo, type MerchSku, type ShippingAddress } from '../../../shared/rewards';
import './Rewards.css';

type TFn = ReturnType<typeof useT>;

const skuNameKey = (sku: MerchSku) => `shop.merch.${sku}.name` as TranslationKey;
const skuBlurbKey = (sku: MerchSku) => `shop.merch.${sku}.blurb` as TranslationKey;
const skuAltKey = (sku: MerchSku) => `shop.merch.${sku}.alt` as TranslationKey;

/** Where each field of the redemption form points the browser's autofill. */
const ADDRESS_AUTOCOMPLETE: Record<keyof ShippingAddress, string> = {
  name: 'shipping name',
  line1: 'shipping address-line1',
  line2: 'shipping address-line2',
  city: 'shipping address-level2',
  postalCode: 'shipping postal-code',
  country: 'shipping country',
};

const EMPTY_ADDRESS: ShippingAddress = { name: '', line1: '', line2: '', city: '', postalCode: '', country: '' };
const LEDGER_PREVIEW = 5;

const projectTitle = (id: string): string => EVOLVING_CHALLENGES.find((one) => one.id === id)?.title ?? id;
const percent = (rate: number): string => String(Math.round(rate * 1000) / 10);

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, index - 1, 1)));
}

/** What a ledger line was for, from its reason and the reference the server
 * wrote beside it. */
export function ledgerLabel(entry: Pick<WalletEntry, 'reason' | 'reference'>, t: TFn): string {
  const reference = entry.reference ?? '';
  const [head, ...rest] = reference.split(':');
  if (entry.reason === 'verified-xp') {
    if (head === 'quiz') return t('rewards.ledger.quiz');
    if (head === 'learn') return t('rewards.ledger.learn');
    if (head === 'coding') return t('rewards.ledger.coding');
    if (head === 'challenge') return t('rewards.ledger.challenge');
  }
  if (entry.reason === 'milestone') {
    const value = rest.join(':');
    if (head === 'streak') return t('rewards.ledger.streak', { days: value });
    if (head === 'topic') return t('rewards.ledger.topic', { topic: t(categoryLabelKey(value)) });
    if (head === 'project') return t('rewards.ledger.project', { project: projectTitle(value) });
    if (head === 'month-top') return t('rewards.ledger.monthTop', { month: monthLabel(value) });
  }
  if (entry.reason === 'referral') {
    return reference === 'referral:friend' ? t('rewards.ledger.referralFriend') : t('rewards.ledger.referralInvited');
  }
  if (entry.reason === 'purchase') {
    if (reference === 'crown') return t('rewards.ledger.crown');
    if (reference === 'streak-protection') return t('rewards.ledger.protection');
    return t('rewards.ledger.merch');
  }
  return t(`shop.reason.${entry.reason}` as TranslationKey);
}

/* ── the wallet ────────────────────────────────────────────────────────── */

/** `restoring`: a stored session is still being restored, so the learner is
 * not known to be signed out yet and is shown loading, not asked to sign in. */
function Wallet({ signedIn, restoring = false }: { signedIn: boolean; restoring?: boolean }) {
  const t = useT();
  const wallet = useWallet(signedIn, { held: true });
  const [showAll, setShowAll] = useState(false);
  const entries = wallet.data?.entries ?? [];
  const visible = showAll ? entries : entries.slice(0, LEDGER_PREVIEW);
  const loading = restoring || (signedIn && wallet.isPending);

  return (
    <section className="rw-wallet ss-raised" aria-labelledby="rw-wallet-title" aria-busy={loading || undefined}>
      <div className="rw-wallet__head">
        <CoinIcon size={44} />
        <div className="rw-wallet__balance">
          {/* The h1 says Coins and the number says coins: the label names
              the section for a screen reader only (UX audit money-12). */}
          <h2 id="rw-wallet-title" className="ss-sr-only">{t('shop.balanceLabel')}</h2>
          {/* Signed out, the inline state stands where the balance goes, so
              no '—' poses as a number (money-05). */}
          {!signedIn && !restoring ? (
            <StatePanel inline body={t('shop.signInForWallet')} signIn />
          ) : (
            <p className="rw-wallet__amount">
              <strong>{signedIn && wallet.data ? wallet.data.balance.toLocaleString('en-GB') : '—'}</strong>
              <span>{t('shop.tokensUnit')}</span>
            </p>
          )}
        </div>
      </div>

      {loading && <p className="rw-muted" role="status">{t('common.loading')}</p>}
      {signedIn && wallet.isError && !wallet.data && (
        <div className="rw-inline-error" role="alert">
          <span>{t('rewards.walletError')}</span>
          <Button variant="ghost" size="sm" label={t('quiz.retry')} onClick={() => void wallet.refetch()} />
        </div>
      )}
      {signedIn && wallet.data && entries.length === 0 && <p className="rw-muted">{t('rewards.ledgerEmpty')}</p>}
      {signedIn && entries.length > 0 && (
        <>
          <h3 className="rw-label rw-ledger-title">{t('rewards.ledgerTitle')}</h3>
          <ul className="ss-ledger rw-ledger" id="rw-ledger">
            {visible.map((entry) => (
              <li key={entry.eventId}>
                <span>{ledgerLabel(entry, t)}</span>
                <span className={entry.amount > 0 ? 'ss-ledger__in' : 'ss-ledger__out'}>
                  {entry.amount > 0 ? '+' : '−'}{Math.abs(entry.amount).toLocaleString('en-GB')}
                </span>
              </li>
            ))}
          </ul>
          {entries.length > LEDGER_PREVIEW && (
            <Button
              variant="ghost"
              className="rw-ledger-toggle"
              aria-expanded={showAll}
              aria-controls="rw-ledger"
              onClick={() => setShowAll((open) => !open)}
              label={showAll ? t('rewards.ledgerShowFewer') : t('rewards.ledgerShowAll', { n: entries.length })}
            />
          )}
        </>
      )}
    </section>
  );
}

/* ── how to earn ───────────────────────────────────────────────────────── */

interface EarnRow {
  key: string;
  label: string;
  detail?: string;
  /** The right-hand figure: "+25", "Earned", "Today: 40 of 400". */
  figure?: string;
  done?: boolean;
}

/** The five rows of "How to earn" (design audit P1.3): learning with today's
 * progress, the welcome coins, the streak milestones, finishing a topic or a
 * project, and the month's top three. Pure, so the tests can read it. */
export function earnRows(earn: EarnSummary, t: TFn, welcomeReceived: boolean): EarnRow[] {
  const { rules, progress } = earn;
  const earned = new Set(progress?.earned ?? []);
  // "7, 30 and 100": the app ships English only.
  const list = (values: number[]) => {
    const words = values.map((value) => value.toLocaleString('en-GB'));
    return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  };
  const rows: EarnRow[] = [{
    key: 'xp',
    label: t('rewards.earn.xp'),
    detail: t('rewards.earn.xpDetail', {
      rate: percent(rules.xpRate),
      premiumRate: percent(rules.xpRate * rules.premiumMultiplier),
      cap: rules.dailyXpCap,
    }),
    figure: progress ? t('rewards.earn.xpToday', { n: progress.todayXpCoins, cap: rules.dailyXpCap }) : undefined,
  }];
  if (rules.welcomeGrant > 0) {
    rows.push({
      key: 'welcome',
      label: t('rewards.earn.welcome'),
      detail: t('rewards.earn.welcomeDetail'),
      figure: welcomeReceived ? t('rewards.earn.received') : t('rewards.earn.coins', { n: rules.welcomeGrant }),
      done: welcomeReceived,
    });
  }
  const streaks = rules.streakMilestones.filter((milestone) => milestone.coins > 0);
  if (streaks.length > 0) {
    const next = streaks.find((milestone) => !earned.has(`streak:${milestone.days}`));
    rows.push({
      key: 'streak',
      label: t('rewards.earn.streaks'),
      detail: t('rewards.earn.streaksDetail', {
        days: list(streaks.map((milestone) => milestone.days)),
        coins: list(streaks.map((milestone) => milestone.coins)),
      }),
      figure: !next
        ? t('rewards.earn.done')
        : progress ? t('rewards.earn.streakNext', { n: Math.min(progress.streak, next.days), days: next.days }) : undefined,
      done: !next,
    });
  }
  if (rules.topicComplete + rules.projectComplete + rules.shortPathComplete > 0) {
    rows.push({
      key: 'finish',
      label: t('rewards.earn.finish'),
      detail: t('rewards.earn.finishDetail', {
        topic: rules.topicComplete,
        project: rules.projectComplete,
        short: rules.shortPathComplete,
      }),
      figure: earned.size > 0
        ? t('rewards.earn.finishedCount', { n: [...earned].filter((ref) => ref.startsWith('topic:') || ref.startsWith('project:')).length })
        : undefined,
    });
  }
  const [first = 0, second = 0, third = 0] = rules.monthTop;
  if (first + second + third > 0) {
    rows.push({
      key: 'month-top',
      label: t('rewards.earn.monthTop'),
      detail: t('rewards.earn.monthTopDetail', { first, second, third }),
    });
  }
  return rows;
}

function HowToEarn({ earn, welcomeReceived, premium }: { earn: EarnSummary; welcomeReceived: boolean; premium: boolean }) {
  const t = useT();
  const rows = earnRows(earn, t, welcomeReceived);
  return (
    <section className="rw-section" aria-labelledby="rw-earn-title">
      <Kicker as="h2" id="rw-earn-title">{t('rewards.earnTitle')}</Kicker>
      <ul className="rw-earn">
        {rows.map((row) => (
          <li key={row.key} className={row.done ? 'rw-earn__row is-done' : 'rw-earn__row'}>
            <div className="rw-earn__main">
              <span className="rw-earn__label">{row.label}</span>
              {row.detail && <span className="rw-earn__detail">{row.detail}</span>}
            </div>
            <div className="rw-earn__meta">
              {row.figure && <span className={row.done ? 'rw-earn__figure is-done' : 'rw-earn__figure'}>{row.figure}</span>}
            </div>
          </li>
        ))}
      </ul>
      {/* One line says which rows pay Premium members, with the page's one
          "See what Premium includes" at its end: plain text under the ruled
          list, not a dashed box between two lists (UX audit money-14). */}
      <div className="rw-earn__note">
        <p className="rw-muted">{t('rewards.earn.premiumNote')}</p>
        {!premium && (
          <Button variant="ghost" className="ss-action" label={t('rewards.seePremium')} onClick={() => openUpgradeSheet({})} />
        )}
      </div>
    </section>
  );
}

/* ── the crown and streak protection ───────────────────────────────────── */

/** One coin item: a 44px icon, the name over its blurb, and the price with
 * its action. When the coins fall short the row says by how much under the
 * price, and the button names that line as its description (UX audit
 * money-07), as merchandise says "Not enough coins". `price` is null for an
 * item already owned (the crown), which has no price to show. */
function SpendRow({ icon, name, blurb, price, balance, action }: {
  icon: React.ReactNode;
  name: string;
  blurb: string;
  price: number | null;
  /** The learner's coins, or null while they are unknown. */
  balance: number | null;
  action: React.ReactNode | ((describedBy: string | undefined) => React.ReactNode);
}) {
  const t = useT();
  const shortId = useId();
  const short = price !== null && balance !== null && balance < price ? price - balance : 0;
  const describedBy = short > 0 ? shortId : undefined;
  return (
    <li className="rw-spend__row">
      <span className="rw-spend__icon" aria-hidden="true">{icon}</span>
      <h3 className="rw-spend__name">{name}</h3>
      <p className="rw-spend__blurb">{blurb}</p>
      <div className="rw-spend__action">
        {price !== null && (
          <span className="rw-spend__price">
            <strong>{t('shop.tokenPrice', { n: price.toLocaleString('en-GB') })}</strong>
            {short > 0 && <span id={shortId} className="rw-spend__short">{t('shop.shortBy', { n: short.toLocaleString('en-GB') })}</span>}
          </span>
        )}
        {typeof action === 'function' ? action(describedBy) : action}
      </div>
    </li>
  );
}

/* ── merchandise ───────────────────────────────────────────────────────── */

/** One merchandise tile: the mockup when the build found one, the item, a
 * link to buy it in the devShark shop on Spreadshop when its URL is set, and
 * redemption with coins. The coin price shows only when the owner set one,
 * and the tile says why it cannot be redeemed when it cannot. On a free
 * account the Redeem button stays focusable, reads "Premium" beside it and
 * opens the upgrade sheet. */
export function MerchCard({
  item,
  onOrder,
  busy,
  premiumLocked,
  balance,
  image = MERCH_IMAGES[item.sku],
  productUrl = MERCH_SHOP.products[item.sku],
}: {
  item: ShopItem;
  onOrder: (sku: MerchSku, variant: string) => void;
  busy: boolean;
  premiumLocked: boolean;
  /** The learner's coins, or null while they are unknown (the server decides). */
  balance: number | null;
  /** The mockup under /merch, when one exists. */
  image?: string;
  /** The item's page in the devShark shop, when the owner has set it. */
  productUrl?: string | null;
}) {
  const t = useT();
  const coinsId = useId();
  const freeIn = (size: string) => item.variantStock.find((row) => row.variant === size)?.free ?? 0;
  // Start on a size that can still be sent this month.
  const [variant, setVariant] = useState(item.variants.find((size) => freeIn(size) > 0) ?? item.variants[0] ?? '');
  const orderable = item.availability === 'available';
  const sizeGone = item.variants.length > 0 && freeIn(variant) <= 0;
  const tokenPrice = item.price?.tokenPrice ?? null;
  const short = orderable && balance !== null && tokenPrice !== null && balance < tokenPrice;

  return (
    <article className="rw-merch ss-raised">
      {image && (
        <div className="rw-merch__media">
          <img src={image} alt={t(skuAltKey(item.sku))} width={600} height={600} loading="lazy" decoding="async" />
        </div>
      )}
      <div className="rw-merch__body">
        <h3 className="rw-merch__name">{t(skuNameKey(item.sku))}</h3>
        <p className="rw-muted">{t(skuBlurbKey(item.sku))}</p>
        {productUrl && (
          <a className="rw-merch__buy" href={productUrl} target="_blank" rel="noopener noreferrer">
            {t('shop.buyAtShop')}
            <span aria-hidden="true">&nbsp;↗</span>
            <span className="ss-sr-only"> {t('rewards.social.newTab')}</span>
          </a>
        )}

        <div className="rw-merch__coins" role="group" aria-labelledby={coinsId}>
          <div className="rw-merch__price">
            <span id={coinsId} className="rw-label">{t('shop.withCoins')}</span>
            {tokenPrice !== null && <strong>{t('shop.tokenPrice', { n: tokenPrice.toLocaleString('en-GB') })}</strong>}
            {!orderable && <span className="ss-tag">{t(`shop.availability.${item.availability}` as TranslationKey)}</span>}
            {orderable && tokenPrice === null && <span className="rw-muted">{t('shop.noCoinPrice')}</span>}
          </div>

          {item.variants.length > 0 && orderable && (
            <div className="rw-merch__size">
              <label className="ss-field-label" htmlFor={`size-${item.sku}`}>{t('shop.sizeLabel')}</label>
              <select
                id={`size-${item.sku}`}
                className="ss-select"
                value={variant}
                disabled={premiumLocked}
                onChange={(event) => setVariant(event.target.value)}
              >
                {item.variants.map((one) => (
                  <option key={one} value={one} disabled={freeIn(one) <= 0}>
                    {one}{freeIn(one) <= 0 ? ` (${t('shop.availability.out_of_stock')})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {premiumLocked ? (
            <div className="rw-merch-lock">
              <LockedButton
                variant="secondary"
                label={t('shop.order')}
                aria-describedby="rw-merch-premium"
                onClick={() => openUpgradeSheet({ kind: 'merch-redemption', ref: item.sku })}
              />
              <span className="ss-tag">{t('premium.badge')}</span>
            </div>
          ) : (
            <>
              <Button
                variant="primary"
                id={`redeem-${item.sku}`}
                label={t('shop.order')}
                isDisabled={!orderable || busy || short || tokenPrice === null || sizeGone}
                onClick={() => onOrder(item.sku, variant)}
              />
              {short && <p className="rw-muted rw-merch__note">{t('shop.insufficient')}</p>}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** Spreadshop's own offer this month, when the server read one and the shop
 * link is set. Coins have nothing to do with it, and the note says so. */
export function MerchPromoNote({ promo }: { promo: MerchPromo }) {
  const t = useT();
  const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(promo.validUntil));
  return (
    <div className="rw-promo" role="note">
      <p>
        {promo.code
          ? t('shop.promo', { description: promo.description, code: promo.code, date })
          : t('shop.promoNoCode', { description: promo.description, date })}
      </p>
      <p className="rw-muted">{t('shop.promoNote')}</p>
    </div>
  );
}

/** The catalogue, and a signed-in account's coins, orders, plan and invite, in
 * the cache before the first render: the test-mode notice and the items used
 * to arrive after the page and push the wallet down. */
function useRewardsFirstData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  useFirstData(`rewards ${user?.id ?? ''}`, () => settled([
    readOnce(queryClient, shopQuery),
    user ? readOnce(queryClient, walletQuery) : null,
    user && MERCH_ENABLED ? readOnce(queryClient, ordersQuery) : null,
    user ? readOnce(queryClient, entitlementQuery(user.id)) : null,
    user ? readOnce(queryClient, referralQuery) : null,
  ]));
}

function Shop() {
  useRewardsFirstData();
  const t = useT();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  // On a direct load the session is restored after the page mounts: until
  // then the wallet and the invite say loading, not "Sign in", which flashed
  // at a signed-in learner (the saved challenges on /collection wait too).
  const restoring = authLoading && !isAuthenticated;
  // Every read below is one the first-data hold made (useRewardsFirstData).
  const { tier } = useEntitlement({ held: true });
  const config = useGameConfig();
  const shop = useShop(true, { held: true });
  const wallet = useWallet(isAuthenticated, { held: true });
  const orders = useOrders(isAuthenticated && MERCH_ENABLED, { held: true });
  const cosmetic = useCosmeticMutation();
  const protection = useProtectionMutation();
  const order = useOrderMutation();

  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  // Set at the press, not from isPending: the mutation's state reaches React a
  // task after the click, so a double click on Buy sent two purchases and a
  // streak protection charged its coins twice. Held until the wallet re-read
  // lands, so the row stays busy while it still shows the old balance.
  // `say` reports the outcome only while the account that spent is still the
  // one here: a purchase answered after a sign-out is not news for the next
  // person (lib/accountData.ts).
  const spending = useRef(false);
  type Say = (msg: string, ok: boolean) => void;
  const spend = (run: (say: Say) => Promise<unknown>) => {
    if (spending.current) return;
    spending.current = true;
    const epoch = accountEpoch();
    const say: Say = (msg, ok) => { if (accountEpoch() === epoch) setToast({ msg, ok }); };
    void run(say).finally(() => { spending.current = false; });
  };
  const [checkout, setCheckout] = useState<{ sku: MerchSku; variant: string } | null>(null);
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_ADDRESS);
  const checkoutHeading = useRef<HTMLHeadingElement>(null);
  const checkoutSku = checkout?.sku ?? null;

  // The form opens below every tile, off screen on a phone: take the reader
  // (and a screen reader's focus) to it, and back to the tile when it closes.
  useEffect(() => {
    if (!checkoutSku) return;
    const heading = checkoutHeading.current;
    heading?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    heading?.focus({ preventScroll: true });
  }, [checkoutSku]);
  const closeCheckout = () => {
    const sku = checkout?.sku;
    setCheckout(null);
    if (sku) window.setTimeout(() => document.getElementById(`redeem-${sku}`)?.focus(), 0);
  };

  // Links out to the devShark shop on Spreadshop, from client/product-catalog.ts.
  const shopLinked = Boolean(MERCH_SHOP.shopUrl) || Object.values(MERCH_SHOP.products).some(Boolean);

  const merchOpen = MERCH_ENABLED
    && shop.data?.enabled === true
    && shop.data.items.some((item) => item.availability === 'available' && typeof item.price?.tokenPrice === 'number');

  // Merchandise is Premium only. While the plan is still loading the server
  // decides: a 402 opens the upgrade sheet on its own.
  const premium = tier === 'premium' || wallet.data?.earn?.progress?.premium === true;
  const merchLocked = tier === 'free' && !premium;
  const earn: EarnSummary = wallet.data?.earn ?? { rules: config.coins, progress: null };
  const welcomeReceived = (wallet.data?.entries ?? []).some((entry) => entry.reason === 'signup');

  const balance = wallet.data?.balance ?? 0;
  // The balance only once it is known: a row says how many coins are missing
  // against a real number, never against the 0 above.
  const knownBalance = isAuthenticated && wallet.data ? wallet.data.balance : null;
  // Signed out, Buy says what it needs and asks for it, instead of sitting
  // disabled without a reason (UX audit money-05). Secondary: the wallet's
  // Sign in above is the screen's primary.
  const signedOut = !isAuthenticated && !restoring;
  const signInToBuy = (
    <Button variant="secondary" label={t('shop.signInToBuy')} aria-haspopup="dialog" onClick={() => openSignIn()} />
  );
  const ownsCrown = useMemo(
    () => (wallet.data?.cosmetics ?? []).some((one) => one.id === 'crown'),
    [wallet.data],
  );
  const wearingCrown = useMemo(
    () => (wallet.data?.cosmetics ?? []).some((one) => one.id === 'crown' && one.equipped),
    [wallet.data],
  );

  const submitOrder = (paymentKind: 'tokens' | 'cash') => {
    if (!checkout) return;
    const items = [{ ...checkout, quantity: 1 }];
    spend(async (say) => {
      try {
        const result = await order.mutateAsync({ items, address, paymentKind });
        closeCheckout();
        setAddress(EMPTY_ADDRESS);
        say(result.state === 'paid' ? t('shop.orderPlaced') : t('shop.orderAwaitingPayment'), true);
      } catch (error) {
        say(friendlyError(error), false);
      }
    });
  };

  const buyCrown = () => spend(async (say) => {
    try {
      await cosmetic.mutateAsync({ op: 'buy' });
      say(t('shop.crownBought'), true);
    } catch (error) {
      say(friendlyError(error), false);
    }
  });

  // A refused Wear or Take it off used to say nothing: the button came back
  // and the crown stayed where it was.
  const wearCrown = (op: 'equip' | 'unequip') => spend(async (say) => {
    try {
      await cosmetic.mutateAsync({ op });
    } catch (error) {
      say(friendlyError(error), false);
    }
  });

  const buyProtection = () => spend(async (say) => {
    try {
      const result = await protection.mutateAsync();
      // At the cap nothing was charged, and saying "bought" would be a lie
      // about a balance that did not move.
      say(result.bought
        ? t('shop.protectionBought', { n: result.remaining })
        : t('shop.protectionAtCap', { n: result.remaining }), true);
    } catch (error) {
      say(friendlyError(error), false);
    }
  });

  // The page fills the route's narrow 800px column (components/ui/pageWidth.ts),
  // which centres it; it sets no width of its own (UX audit money-01).
  // The editorial header every money page has (UX audit money-08): fin,
  // kicker, h1. The lead adds what the sections below do not say (money-12).
  return (
    <article className="ss-info-page">
    <PageHeader kicker={t('shop.kicker')} title={t('shop.title')} lead={`${t('shop.subtitle')}${merchOpen ? ` ${t('shop.subtitleMerch')}` : ''}`} />
    <VStack gap={5} width="100%">

      {/* Test mode is for the owner's staging checks; production never shows it. */}
      {!import.meta.env.PROD && shop.data?.testMode && <Banner status="warning" title={t('shop.testMode')} />}

      {/* The wallet. The recent movements sit beside the balance because a
          balance nobody can account for is what this replaced. */}
      <Wallet signedIn={isAuthenticated} restoring={restoring} />

      <HowToEarn earn={earn} welcomeReceived={welcomeReceived} premium={premium} />

      {/* The crown and streak protection: every account, coins only. Two
          rows of one ruled list, like How to earn, built the same way so they
          stand at one height on every width (UX audit money-02).
          Streak protection is consumable, capped, and the one thing sold here
          that touches learning at all (the bounded exception in
          shared/rewards.ts): it costs coins earned by learning, restores the
          same two-a-month budget and never exceeds it, and no leaderboard in
          this product ranks by streak. */}
      {(shop.data?.crown.available || shop.data?.protection?.available) && (
        <section className="rw-section" aria-labelledby="rw-spend-title">
          <Kicker as="h2" id="rw-spend-title">{t('shop.crownSection')}</Kicker>
          <ul className="rw-spend">
            {shop.data?.crown.available && (
              <SpendRow
                icon={<Crown size={44} />}
                name={t('shop.crownName')}
                blurb={t('shop.crownBlurb')}
                price={ownsCrown ? null : shop.data.crown.tokenPrice}
                balance={knownBalance}
                action={ownsCrown ? (
                  <Button
                    variant="secondary"
                    label={t(wearingCrown ? 'shop.crownRemove' : 'shop.crownWear')}
                    isDisabled={cosmetic.isPending}
                    onClick={() => wearCrown(wearingCrown ? 'unequip' : 'equip')}
                  />
                ) : signedOut ? signInToBuy : (describedBy) => (
                  <Button
                    variant="primary"
                    label={t('shop.buy')}
                    aria-describedby={describedBy}
                    isDisabled={!isAuthenticated || cosmetic.isPending || balance < shop.data!.crown.tokenPrice}
                    onClick={buyCrown}
                  />
                )}
              />
            )}
            {shop.data?.protection?.available && (
              <SpendRow
                icon={<span className="rw-spend__shield"><ShieldIcon size={44} /></span>}
                name={t('shop.protectionName')}
                blurb={t('shop.protectionBlurb', { cap: shop.data.protection.cap })}
                price={shop.data.protection.tokenPrice}
                balance={knownBalance}
                action={signedOut ? signInToBuy : (describedBy) => (
                  <Button
                    variant="primary"
                    label={t('shop.buy')}
                    aria-describedby={describedBy}
                    isDisabled={!isAuthenticated || protection.isPending || balance < shop.data!.protection!.tokenPrice}
                    onClick={buyProtection}
                  />
                )}
              />
            )}
          </ul>
        </section>
      )}

      <ReferralInvite signedIn={isAuthenticated} restoring={restoring} />

      {shop.isLoading && <Text type="supporting" color="secondary" role="status">{t('common.loading')}</Text>}
      {/* A failed background re-read keeps the catalogue it had: the crown and
          streak protection above still show it, so no error goes with them. */}
      {shop.isError && !shop.data && (
        <div className="rw-inline-error" role="alert">
          <span>{t('shop.loadError')}</span>
          <Button variant="ghost" size="sm" label={t('quiz.retry')} onClick={() => void shop.refetch()} />
        </div>
      )}

      {/* Merchandise. Premium members redeem coins for it. The section, its
          intro and the redemption form exist only once redemption is open and
          at least one item can be redeemed (design audit P0.1). */}
      {merchOpen && (
        <section className="rw-section" aria-labelledby="rw-merch-title">
          <Kicker as="h2" id="rw-merch-title">{t('shop.merchSection')}</Kicker>
          {shopLinked && (
            <div className="rw-merch-intro">
              <p className="rw-muted">{t('shop.shopIntro')}</p>
              {MERCH_SHOP.shopUrl && (
                <Button
                  variant="secondary"
                  href={MERCH_SHOP.shopUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  label={`${t('shop.visitShop')} ${t('rewards.social.newTab')}`}
                >
                  {t('shop.visitShop')}<span aria-hidden="true">&nbsp;↗</span>
                </Button>
              )}
            </div>
          )}
          {shopLinked && config.merchPromo && <MerchPromoNote promo={config.merchPromo} />}
          {merchLocked && (
            <div className="rw-premium-note" id="rw-merch-premium">
              <p>{t('rewards.merchPremium')}</p>
            </div>
          )}
          <Grid columns={{ minWidth: 240, max: 3 }} gap={2} width="100%">
            {/* An item nobody has priced or switched on yet is not shown at all. */}
            {(shop.data?.items ?? []).filter((item) => item.availability !== 'unconfigured' && item.availability !== 'shop_disabled').map((item) => (
              <MerchCard
                key={item.sku}
                item={item}
                busy={order.isPending}
                premiumLocked={merchLocked}
                balance={isAuthenticated && wallet.data ? balance : null}
                onOrder={(sku, variant) => setCheckout({ sku, variant })}
              />
            ))}
          </Grid>
          {shop.data?.policyUrl && (
            <a className="cd-link" href={shop.data.policyUrl} target="_blank" rel="noreferrer">
              {t('shop.policyLink')}
            </a>
          )}
        </section>
      )}

      {/* Redeeming. Only the fields a parcel needs, and nothing beyond them. */}
      {merchOpen && checkout && (
        <form
          className="rw-checkout ss-raised"
          aria-labelledby="rw-checkout-title"
          onSubmit={(event) => {
            event.preventDefault();
            submitOrder('tokens');
          }}
        >
          <h3 id="rw-checkout-title" ref={checkoutHeading} tabIndex={-1} className="rw-checkout__title">
            {t('shop.checkoutTitle', { item: t(skuNameKey(checkout.sku)) })}
            {checkout.variant ? ` (${checkout.variant})` : ''}
          </h3>
          {([
            ['name', 'shop.address.name'],
            ['line1', 'shop.address.line1'],
            ['line2', 'shop.address.line2'],
            ['city', 'shop.address.city'],
            ['postalCode', 'shop.address.postalCode'],
            ['country', 'shop.address.country'],
          ] as const).map(([field, key]) => (
            <div key={field} className="rw-checkout__field">
              <label className="ss-field-label" htmlFor={`addr-${field}`}>{t(key)}</label>
              <input
                id={`addr-${field}`}
                className="ss-input"
                autoComplete={ADDRESS_AUTOCOMPLETE[field]}
                required={field !== 'line2'}
                maxLength={field === 'country' ? 2 : 120}
                value={address[field] ?? ''}
                onChange={(event) => setAddress((current) => ({ ...current, [field]: event.target.value }))}
              />
            </div>
          ))}
          <p className="rw-muted rw-checkout__note">{t('shop.addressNote')}</p>
          <div className="rw-checkout__actions">
            <Button type="submit" variant="primary" label={t('shop.payWithTokens')} isDisabled={order.isPending} />
            {shop.data?.cashCheckoutEnabled && (
              <Button variant="secondary" label={t('shop.payWithMoney')} isDisabled={order.isPending} onClick={() => submitOrder('cash')} />
            )}
            <Button variant="ghost" label={t('shop.cancelCheckout')} onClick={closeCheckout} />
          </div>
        </form>
      )}

      {/* Orders and claims: coin redemptions and the learning-path package. */}
      {MERCH_ENABLED && isAuthenticated && (orders.data?.orders.length ?? 0) > 0 && (
        <section className="rw-section" aria-labelledby="rw-orders-title">
          <Kicker as="h2" id="rw-orders-title">{t('shop.ordersSection')}</Kicker>
          <ul className="ss-orders">
            {orders.data!.orders.map((one) => (
              <li key={one.orderId}>
                <span className="ss-orders__items">
                  {one.items.map((line) => `${t(skuNameKey(line.sku as MerchSku))}${line.variant ? ` (${line.variant})` : ''} ×${line.quantity}`).join(', ')}
                </span>
                <span className="ss-orders__state">
                  {one.package && one.state === 'awaiting_payment'
                    ? t('shop.state.package')
                    : t(`shop.state.${one.state}` as TranslationKey)}
                </span>
                {one.tokenTotal !== null && one.tokenTotal > 0 && (
                  <span>{t('shop.tokenPrice', { n: one.tokenTotal.toLocaleString('en-GB') })}</span>
                )}
                {one.tokenTotal === null && one.totalMinor !== null && one.currency && (
                  <span>{formatMoney(one.totalMinor, one.currency)}</span>
                )}
                {one.trackingRef && <span>{one.carrier} · {one.trackingRef}</span>}
                {one.testMode && <Badge variant="neutral" label={t('shop.testOrder')} />}
              </li>
            ))}
          </ul>
        </section>
      )}


      <AppToast
        open={!!toast}
        onClose={() => setToast(null)}
        severity={toast?.ok ? 'success' : 'error'}
        autoHideDuration={4000}
        message={toast?.msg ?? ''}
      />
    </VStack>
    </article>
  );
}

export default Shop;
export { SHIRT_SIZES };
