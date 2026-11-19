/** The launch offer (owner decision, 28 September 2026): 55 % off Premium,
 * monthly and yearly, for the lifetime of every subscription started between
 * Sunday 4 October 2026 00:00 and Monday 30 November 2026 23:59:59, Prague time.
 *
 * One module for the server and the browser. The server decides whether
 * Checkout carries the Stripe coupon (lib/billing/handlers.ts); the browser
 * decides whether /premium, the plan table, the upgrade sheet and the Terms
 * show the offer. Both read the window and the prices from here, so no page
 * carries its own copy of a date or a discounted price.
 *
 * The offer is on only when all three hold:
 *   - the instant is inside the window,
 *   - Checkout sells Premium (BILLING_ENABLED and a complete Stripe setup),
 *   - the coupon's id is set in STRIPE_COUPON_LAUNCH.
 * Without the coupon nothing about the offer renders and Checkout charges the
 * regular price, so the code is inert until the owner sets the variable.
 *
 * Pure on purpose: it imports nothing from `lib/` or the client. */

import { PREMIUM_PRICE } from './tiers';

/** The server variable holding the Stripe coupon id (55 % off, duration
 * forever, redeem_by the end of the window). Server only; never sent to the
 * browser. */
export const LAUNCH_COUPON_ENV = 'STRIPE_COUPON_LAUNCH';

/** Stripe coupon ids: letters, digits, `_` and `-`. Anything else is treated
 * as unset rather than sent to Stripe. */
const LAUNCH_COUPON_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const LAUNCH_OFFER = {
  id: 'launch-55',
  percentOff: 55,
  /** 4 Oct 2026 00:00:00 in Prague (CEST, UTC+2). */
  startsAt: Date.parse('2026-10-03T22:00:00Z'),
  /** The first instant after the offer: 1 Dec 2026 00:00:00 in Prague (CET,
   * UTC+1, after the change from CEST on 25 October). The last instant of the
   * offer is 30 Nov 2026 23:59:59.999. */
  endsBefore: Date.parse('2026-11-30T23:00:00Z'),
  timeZone: 'Europe/Prague',
} as const;

/** The offer's last whole second as a Unix timestamp: the coupon's
 * `redeem_by` (30 Nov 2026 23:59:59 CET). */
export const LAUNCH_REDEEM_BY = Math.floor(LAUNCH_OFFER.endsBefore / 1000) - 1;

/** Whether an instant falls inside the window: from the start, inclusive, to
 * the first instant after the end, exclusive. */
export function launchWindowOpen(now: number): boolean {
  return Number.isFinite(now) && now >= LAUNCH_OFFER.startsAt && now < LAUNCH_OFFER.endsBefore;
}

/** A usable coupon id from the environment value, or null. */
export function launchCouponId(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  return value && LAUNCH_COUPON_ID.test(value) ? value : null;
}

/** The coupon Checkout applies now, or null: inside the window, with billing
 * on and the coupon set. */
export function activeLaunchCoupon({ now, checkoutEnabled, coupon }: { now: number; checkoutEnabled: boolean; coupon: string | null }): string | null {
  return checkoutEnabled && coupon !== null && launchWindowOpen(now) ? coupon : null;
}

/** "3.99" → 399. The display prices are strings with two decimals. */
const toCents = (price: string): number => {
  const match = /^(\d+)\.(\d{2})$/.exec(price);
  if (!match) throw new Error(`price_format:${price}`);
  return Number(match[1]) * 100 + Number(match[2]);
};
const fromCents = (cents: number): string => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

/** The price after a percentage off, rounded to the cent the way Stripe
 * rounds a percentage coupon: the discount is rounded, then subtracted.
 * 4.99 → 2.25 and 59.88 → 26.95 at 55 %. */
export function discountedPrice(regular: string, percentOff: number = LAUNCH_OFFER.percentOff): string {
  const cents = toCents(regular);
  return fromCents(cents - Math.round((cents * percentOff) / 100));
}

/** What the yearly plan saves against twelve months of the monthly plan, as
 * a price string: 4.99 × 12 − 59.88 = 0.00 at the regular prices, and
 * 2.25 × 12 − 26.95 = 0.05 at the launch prices. Worked out in cents, so no
 * float holds money, and never below zero. /premium prints it next to the
 * yearly price it is true for (owner decision 11). */
export function annualSaving(monthly: string, annual: string): string {
  return fromCents(Math.max(0, toCents(monthly) * 12 - toCents(annual)));
}

/** A date in the offer's time zone: "30 Nov 2026" (short) or "30 November 2026". */
function launchDate(instant: number, month: 'short' | 'long' = 'short'): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month, year: 'numeric', timeZone: LAUNCH_OFFER.timeZone }).format(instant);
}

/** Everything a page prints about the offer, derived from PREMIUM_PRICE and
 * LAUNCH_OFFER.
 *
 * Framing (coordinator decision, 28 September 2026): an introductory launch
 * price, not a reduction. Premium was never sold before the offer (billing
 * was off), so there is no earlier price to cite and no "lowest price in
 * the last 30 days" line (EU Price Indication Directive art. 6a, Czech
 * consumer-protection act § 12a). The pages state
 * the launch price and name the regular price as the one that applies to
 * subscriptions started from 1 December 2026. */
export function launchOfferDisplay() {
  const offerMonthly = discountedPrice(PREMIUM_PRICE.monthly);
  const offerAnnual = discountedPrice(PREMIUM_PRICE.annual);
  return {
    percent: LAUNCH_OFFER.percentOff,
    symbol: PREMIUM_PRICE.symbol,
    currency: PREMIUM_PRICE.currency,
    monthly: PREMIUM_PRICE.monthly,
    annual: PREMIUM_PRICE.annual,
    offerMonthly,
    offerAnnual,
    /** The yearly saving at the launch prices: "0.05". */
    offerAnnualSaving: annualSaving(offerMonthly, offerAnnual),
    /** "4 October 2026" */
    startDate: launchDate(LAUNCH_OFFER.startsAt, 'long'),
    /** "30 November 2026" */
    endDate: launchDate(LAUNCH_OFFER.endsBefore - 1, 'long'),
    /** "30 Nov 2026" */
    endDateShort: launchDate(LAUNCH_OFFER.endsBefore - 1, 'short'),
    /** "1 Dec 2026": the first day of the regular price. */
    regularFrom: launchDate(LAUNCH_OFFER.endsBefore, 'short'),
    /** "1 December 2026" */
    regularFromLong: launchDate(LAUNCH_OFFER.endsBefore, 'long'),
  };
}
export type LaunchOfferDisplay = ReturnType<typeof launchOfferDisplay>;
