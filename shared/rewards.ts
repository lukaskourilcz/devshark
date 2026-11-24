/** Rewards: the merchandise catalogue, the crown, and the rules that keep both
 * away from anything a learner earns.
 *
 * Five physical items and one cosmetic. The physical ones are real objects that
 * cost real money to make and post, so this module describes them and refuses
 * to invent the parts nobody has supplied yet. A price, a currency, a shipping
 * region and a stock figure are **configuration**, entered once a supplier has
 * quoted them; until then every item reports `unconfigured` and cannot be
 * ordered by anyone, through any route. There is no placeholder price and no
 * pretend checkout — see `docs/rewards-launch.md` for what has to be obtained.
 * Spreadshop (sprd.net AG) prints and ships the merchandise. It cannot issue
 * discount codes, so coins redeem a whole item and never buy a discount.
 *
 * The crown is different: it is an SVG this repository draws, it ships nothing,
 * and it costs tokens alone.
 *
 * Product copy calls the tokens this module counts coins. The tables, the ops
 * and the identifiers here keep the `token` spelling.
 *
 * The invariant that outranks all of this, and the one bounded exception to it.
 *
 * **devShark is freemium, and rewards never touch learning.** `shared/tiers.ts`
 * is the only place that says what the free tier includes and what Premium
 * opens; the server refuses locked content with 402 and the client only
 * mirrors it. Premium changes which content a learner may start and nothing
 * else. Coins, the crown, Shark Cards and badges change even less:
 * buying, owning and equipping change no access, no content, no grading, no
 * explanation, no XP amount, no score, no rank, no leaderboard position, no
 * matchmaking and no prerequisite. The crown is a picture.
 *
 * The exception is **streak protection**, and it is written down here rather
 * than left implicit because it is real. Two protections a month are granted
 * free, and one bridges a missed day so a streak continues instead of resetting
 * — that has been true since migration 024, long before any of it was for sale.
 * Extra protections may now be bought, and four things keep the exception
 * bounded:
 *
 *   * The currency is coins (tokens in code), earned from verified XP at 10%,
 *     doubled on Premium, and from learning milestones. No money buys a
 *     protection: it has no cash price, and a subscription only changes how
 *     fast learning earns the coins. The path is learn more, then protect a
 *     streak.
 *   * The ceiling never rises. Buying restores the same two-a-month budget and
 *     never exceeds it, so nobody can hold a deeper reserve than a learner who
 *     spends nothing.
 *   * A protection changes the day count of a streak and nothing else: no XP,
 *     no score, no rank, no badge, no access, no content.
 *   * No leaderboard in this product ranks by streak. Every one of them ranks
 *     by correct answers and accuracy, so a protected streak moves nobody up
 *     anything.
 *
 * And the reverse direction is not an exception at all: finishing a whole
 * learning path earns the merchandise package. A reward *for* learning is not a
 * purchase that affects learning, and it changes no progress. The package is
 * paused with the rest of merchandise until next quarter (`MERCH_ENABLED`). */

/* ── the switch ────────────────────────────────────────────────────────── */

/**
 * Merchandise, on or off, for the whole product (owner decision 10, 1 October
 * 2026). No package has shipped yet and the first one comes next quarter, so
 * until then nothing shows or sells merchandise: not the shop's merchandise
 * section, not coin redemption, not the package a finished learning path
 * earns, not the Premium list, the marketing copy or the Terms. The server
 * answers every merchandise order and every path-package claim with 404
 * `merch_unavailable` while it is off, whatever the owner's shop settings say.
 *
 * The tables, the routines and the admin console stay as they are, and
 * account deletion still erases any order. Turning merchandise back on is this
 * one line, plus the copy and the Terms that were taken out with it.
 *
 * Typed `boolean` rather than the literal, so the code behind it stays checked.
 */
export const MERCH_ENABLED: boolean = false;

/* ── the catalogue ─────────────────────────────────────────────────────── */

/** `hoodie` arrived with migration 043 (#229). `cap` stays in the catalogue
 * unpriced: the owner's Spreadshop sells no cap yet. */
export const MERCH_SKUS = ['sticker-set', 'mug', 't-shirt', 'hoodie', 'cap'] as const;
export type MerchSku = (typeof MERCH_SKUS)[number];
export const isMerchSku = (value: unknown): value is MerchSku =>
  typeof value === 'string' && (MERCH_SKUS as readonly string[]).includes(value);

/** T-shirt and hoodie sizes. The only variant axis any item has, kept small on
 * purpose: every extra variant is a monthly cap somebody has to set. */
export const SHIRT_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;

export interface MerchItem {
  sku: MerchSku;
  /** Variant values the item accepts, or an empty list when it has none. */
  variants: readonly string[];
  /** Whether ordering it means posting something to an address. */
  shipped: true;
}

export const MERCH_CATALOGUE: readonly MerchItem[] = [
  { sku: 'sticker-set', variants: [], shipped: true },
  { sku: 'mug', variants: [], shipped: true },
  { sku: 't-shirt', variants: SHIRT_SIZES, shipped: true },
  { sku: 'hoodie', variants: SHIRT_SIZES, shipped: true },
  { sku: 'cap', variants: [], shipped: true },
];

export const merchItem = (sku: string): MerchItem | undefined =>
  MERCH_CATALOGUE.find((item) => item.sku === sku);

/** Spreadshop's own promotion in the devShark shop (#229), as /api/settings
 * reports it (lib/rewards/spreadshop.ts reads it). Spreadshop runs it on cash
 * purchases in its shop; coins never buy a discount. */
export interface MerchPromo {
  /** Spreadshop's own text, in the shop's language. */
  description: string;
  /** The code a buyer enters at the Spreadshop checkout, when it names one. */
  code: string | null;
  /** ISO-8601 in UTC: the last moment the promotion applies. */
  validUntil: string;
}

/* ── what a supplier has to tell us before anything can be sold ────────── */

/**
 * The commercial facts for one item. Every field is owner-entered from a real
 * quote; none of it has a default, because a default here would be a made-up
 * price on a real product.
 *
 * With Spreadshop (#229): `unitCostMinor` is the base price the owner pays to
 * order the item from the shop preview, print and packaging are inside it (0),
 * `shippingCostMinor` is the postage the Spreadshop checkout shows, `priceMinor`
 * is the retail price in the devShark shop, and `vendor` is `sprd.net AG`.
 */
export interface MerchPricing {
  /** Minor units (cents, haléře) so no float ever holds money. */
  unitCostMinor: number;
  printCostMinor: number;
  shippingCostMinor: number;
  packagingCostMinor: number;
  /** What the learner pays in cash, minor units. */
  priceMinor: number;
  /** ISO 4217. One currency per deployment for now. */
  currency: string;
  /** Whether tax is already inside `priceMinor`. */
  taxIncluded: boolean;
  /** Token price, when the item may also be redeemed with tokens. */
  tokenPrice?: number;
  /** ISO 3166-1 alpha-2 codes this item may be posted to. */
  regions: string[];
  /** Who supplies it, for the audit trail. */
  vendor: string;
  /** ISO date these figures took effect. */
  effectiveFrom: string;
}

export interface MerchSettings {
  /** The whole shop, off until the owner turns it on. Turning it on with any
   * item unconfigured still leaves that item unavailable. */
  enabled: boolean;
  /** Cash checkout, separately gated: token redemption can run without it. */
  cashCheckoutEnabled: boolean;
  /** Visibly marked in the UI when true, so a test order is never mistaken for
   * a real one. */
  testMode: boolean;
  /** Per-SKU commercial facts. A missing entry means unconfigured. */
  pricing: Partial<Record<MerchSku, MerchPricing>>;
  /** Token price of the crown. Cosmetic, so this one may ship with a value. */
  crownTokenPrice: number;
  /** Token price of one streak protection. Consumable and capped at two, so it
   * is priced far below the crown: roughly a fortnight of steady learning
   * rather than a season of it. */
  streakProtectionTokenPrice: number;
  /** Where the returns and delivery policy lives, shown beside every item. */
  policyUrl: string;
}

export const DEFAULT_MERCH_SETTINGS: MerchSettings = {
  enabled: false,
  cashCheckoutEnabled: false,
  testMode: true,
  pricing: {},
  crownTokenPrice: 1200,
  streakProtectionTokenPrice: 250,
  policyUrl: '',
};

/** How many protections a learner may hold at once. Granted monthly, and the
 * ceiling a purchase restores toward but never past. */
export const STREAK_PROTECTION_CAP = 2;

/** Whether extra protections may be bought. Like the crown it needs no
 * supplier, only a price and a wallet to pay it from. */
export const streakProtectionAvailable = (settings: MerchSettings): boolean =>
  settings.streakProtectionTokenPrice > 0;

/* ── availability ──────────────────────────────────────────────────────── */

/**
 * Why an item cannot be ordered, or `available`.
 *
 * `unconfigured` is the honest default and the one the catalogue ships in: we
 * do not know what this costs to make, so we are not going to name a price.
 */
export type MerchAvailability =
  | 'available'
  | 'unconfigured'
  | 'shop_disabled'
  | 'out_of_region'
  | 'out_of_stock';

export function merchAvailability(input: {
  sku: MerchSku;
  settings: MerchSettings;
  /** The learner's region, when known. */
  region?: string | null;
  /** Units free to reserve, when stock is tracked. */
  stock?: number | null;
}): MerchAvailability {
  const pricing = input.settings.pricing[input.sku];
  if (!pricing) return 'unconfigured';
  if (!input.settings.enabled) return 'shop_disabled';
  if (pricing.regions.length === 0) return 'unconfigured';
  if (input.region && !pricing.regions.includes(input.region.toUpperCase())) return 'out_of_region';
  if (input.stock !== undefined && input.stock !== null && input.stock <= 0) return 'out_of_stock';
  return 'available';
}

/** Whether coin redemption is open: merchandise is on (`MERCH_ENABLED`), the
 * shop is on and at least one item has a coin price. Pages that mention
 * redeeming coins for merchandise show that line only while this holds
 * (design audit P0.1). */
export const merchRedemptionOpen = (settings: MerchSettings, merchOn: boolean = MERCH_ENABLED): boolean =>
  merchOn && settings.enabled && Object.values(settings.pricing).some((pricing) => typeof pricing?.tokenPrice === 'number' && pricing.tokenPrice > 0);

/** Whether the crown can be bought. Cosmetic, so it needs no supplier — only
 * the wallet the price is paid from. */
export const crownAvailable = (settings: MerchSettings): boolean => settings.crownTokenPrice > 0;

/** The margin a quote implies, in minor units. Negative means the item loses
 * money at that price, which the readiness report shows rather than hides. */
export const merchMarginMinor = (pricing: MerchPricing): number =>
  pricing.priceMinor
  - pricing.unitCostMinor
  - pricing.printCostMinor
  - pricing.shippingCostMinor
  - pricing.packagingCostMinor;

/* ── the wallet ────────────────────────────────────────────────────────── */

/** Tokens earned per unit of verified XP. The server applies this to XP it
 * awarded itself; a browser's claim about its own XP is never an input. */
const TOKENS_PER_XP = 0.1;
const SIGNUP_TOKEN_GRANT = 200;

export const tokensForVerifiedXp = (xp: number): number =>
  Number.isFinite(xp) && xp > 0 ? Math.floor(xp * TOKENS_PER_XP) : 0;

/* ── coins: what earns them ────────────────────────────────────────────── */

/**
 * The earning rules (docs/product-architecture.md, "Coins"). These are the
 * defaults; `lib/settings-store.ts` mirrors them as `coins` in the game
 * settings, so the owner can tune a rate in `/dev` without a deploy. Every
 * credit is a ledger entry written by a service-role routine of migration 041
 * under a deterministic event id, so replaying an award, a milestone or a
 * grant credits nothing. A browser never names an amount.
 */
export interface CoinSettings {
  /** Coins per verified XP, for every account. */
  xpRate: number;
  /** Premium multiplies the XP credit, at credit time. */
  premiumMultiplier: number;
  /** Most coins one account earns from XP in one UTC day, after the
   * multiplier. Milestones sit outside it. */
  dailyXpCap: number;
  /** The one-time welcome grant, on the first wallet read. */
  welcomeGrant: number;
  /** Premium: a live streak of `days` pays `coins`, once per account. */
  streakMilestones: { days: number; coins: number }[];
  /** Premium: every level of a Learn topic passed. */
  topicComplete: number;
  /** Premium: every stage of an evolving project passed. */
  projectComplete: number;
  /** Premium: every level of a short path passed. */
  shortPathComplete: number;
  /** Premium: ranks one to three on the board of a finished calendar month. */
  monthTop: number[];
  /**
   * Retired by design audit P0.3: the server no longer pays for opening a
   * social profile, whatever this says. The field stays so saved settings
   * still parse. It was: coins for opening one of devShark's social profiles. Zero by default, and
   * zero is the recommendation: Meta's spam rules forbid "offering to provide
   * anything of monetary value in exchange for engagement", coins buy
   * merchandise, and no platform can tell anyone whether a click became a
   * follow. The owner may set it knowing that (handoff section 1, item 2).
   * When it is above zero the copy says "thanks for visiting", never
   * "follow to earn".
   */
  socialVisitGrant: number;
  /** Every account: coins to the inviter and to the invited friend, once,
   * when the friend passes a first Learn level (step D8b, migration 042). 0
   * turns invitations off. */
  referralGrant: number;
  /** Most friends one inviter is paid for. Past it the friend is still paid. */
  referralCap: number;
}

export const DEFAULT_COIN_SETTINGS: CoinSettings = {
  xpRate: TOKENS_PER_XP,
  premiumMultiplier: 2,
  dailyXpCap: 400,
  welcomeGrant: SIGNUP_TOKEN_GRANT,
  streakMilestones: [
    { days: 7, coins: 25 },
    { days: 30, coins: 100 },
    { days: 100, coins: 300 },
  ],
  topicComplete: 100,
  projectComplete: 150,
  shortPathComplete: 50,
  monthTop: [300, 200, 100],
  socialVisitGrant: 0,
  referralGrant: 100,
  referralCap: 20,
};

/* ── invitations (step D8b, #228) ──────────────────────────────────────── */

/** An invite code: eight letters of Crockford's base32 in lower case (no i,
 * l, o or u). Migration 042 draws it; the invite link is `/?ref=<code>`. */
const REFERRAL_CODE_RE = /^[0-9a-hjkmnp-tv-z]{8}$/;
export const isReferralCode = (value: unknown): value is string =>
  typeof value === 'string' && REFERRAL_CODE_RE.test(value);

/** A code binds only to an account Supabase Auth created this recently, so
 * an invitation belongs to a sign-up and an older account cannot claim one. */
export const REFERRAL_SIGNUP_WINDOW_HOURS = 48;

/** The three profiles "Find devShark elsewhere" links to. The URLs live in
 * `client/product-catalog.ts` and nowhere else. */
export const SOCIAL_PLATFORMS = ['linkedin', 'instagram', 'threads'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** What one XP award credits before the daily cap: the rate, then the Premium
 * multiplier. `credit_verified_xp_tokens` does the same sum in the database,
 * which is the one that counts; this copy is for tests and for display. */
export function coinsForVerifiedXp(xp: number, premium: boolean, settings: CoinSettings = DEFAULT_COIN_SETTINGS): number {
  if (!Number.isFinite(xp) || xp <= 0) return 0;
  return Math.floor(xp * settings.xpRate) * (premium ? settings.premiumMultiplier : 1);
}

/** What the day's cap still allows. */
export const coinsUnderDailyCap = (amount: number, earnedToday: number, settings: CoinSettings = DEFAULT_COIN_SETTINGS): number =>
  Math.max(0, Math.min(amount, settings.dailyXpCap - earnedToday));

/* ── orders ────────────────────────────────────────────────────────────── */

/**
 * Order states, in the order they occur.
 *
 * `awaiting_payment` exists only for cash: a token order is paid at creation,
 * atomically, or it does not exist. Payment is established by the provider's
 * signed webhook and by nothing else — not a redirect, not a client flag.
 */
const ORDER_STATES = [
  'awaiting_payment',
  'paid',
  'submitted',
  'shipped',
  'cancelled',
  'refunded',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];
export const isOrderState = (value: unknown): value is OrderState =>
  typeof value === 'string' && (ORDER_STATES as readonly string[]).includes(value);

/** The shipping details an order needs, and nothing beyond them. No phone
 * number, no date of birth, no account of what the learner studied. */
export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
}

export const MAX_ADDRESS_FIELD = 120;

/** The 249 officially assigned ISO 3166-1 alpha-2 codes. User-assigned and
 * reserved codes (XK, EU, UK, ZZ) are not among them. Which of these a parcel
 * can go to is a separate question, answered by each item's `regions`. */
const ISO_COUNTRY_CODES = new Set((
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ '
  + 'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR '
  + 'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP '
  + 'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT '
  + 'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW '
  + 'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ '
  + 'UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' '));

/** Bounds and basic shape only. A real address check belongs to the carrier;
 * this refuses the obviously wrong before anything is charged: an empty or
 * overlong field, or a country that is not an ISO 3166-1 alpha-2 code. */
export function validateAddress(value: unknown): { ok: true; address: ShippingAddress } | { ok: false; field: string } {
  const raw = (value ?? {}) as Record<string, unknown>;
  const text = (key: string, required: boolean): string | null => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null || candidate === '') return required ? null : '';
    if (typeof candidate !== 'string') return null;
    const trimmed = candidate.trim();
    if (trimmed.length === 0) return required ? null : '';
    if (trimmed.length > MAX_ADDRESS_FIELD) return null;
    // Postgres text cannot hold U+0000: the order insert answered 500.
    if (trimmed.includes('\u0000')) return null;
    return trimmed;
  };
  const name = text('name', true);
  if (name === null) return { ok: false, field: 'name' };
  const line1 = text('line1', true);
  if (line1 === null) return { ok: false, field: 'line1' };
  const line2 = text('line2', false);
  if (line2 === null) return { ok: false, field: 'line2' };
  const city = text('city', true);
  if (city === null) return { ok: false, field: 'city' };
  const postalCode = text('postalCode', true);
  if (postalCode === null) return { ok: false, field: 'postalCode' };
  const country = typeof raw.country === 'string' ? raw.country.trim().toUpperCase() : '';
  if (!ISO_COUNTRY_CODES.has(country)) return { ok: false, field: 'country' };
  return {
    ok: true,
    address: { name, line1, ...(line2 ? { line2 } : {}), city, postalCode, country },
  };
}
