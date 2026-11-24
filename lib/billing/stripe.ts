/** The Stripe client and the webhook signature check.
 *
 * The server creates Checkout Sessions and verifies payment state. Stripe.js
 * mounts a Stripe-hosted payment iframe; card details never reach devShark. */

import Stripe from 'stripe';
import { rawBodyCandidates } from '../raw-body';
/** @public The isolated billing harness also reads these candidates. */
export { rawBodyCandidates } from '../raw-body';
import type { VercelRequest } from '../vercel-types.js';
import type { BillingConfig } from './config';

/** The part of the Stripe client the billing code calls. Tests hand in a fake
 * with the same shape through `setStripeForTests`, so no test reaches Stripe. */
export type StripeApi = Pick<
  Stripe,
  'customers' | 'checkout' | 'billingPortal' | 'subscriptions' | 'invoices' | 'invoicePayments' | 'charges' | 'refunds'
>;

/** One Stripe call's limits. A timed-out call is retried by stripe-node after
 * half a second, so a hung call costs 2 × 4 s + 0.5 s = 8.5 s, inside the
 * ten-second function budget (vercel.json), and the handler still answers
 * instead of being cut off without a response. POSTs carry an idempotency key
 * on the retry, so a retried create is never made twice. */
/** @public Fresh-module contract reader: scripts/test-billing.ts accesses this through its isolated loader. */
export const STRIPE_TIMEOUT_MS = 4000;
/** @public Fresh-module contract reader: scripts/test-billing.ts accesses this through its isolated loader. */
export const STRIPE_NETWORK_RETRIES = 1;
/** stripe-node's wait before its first retry. */
/** @public Fresh-module contract reader: scripts/test-billing.ts accesses this through its isolated loader. */
export const STRIPE_RETRY_DELAY_MS = 500;

let testClient: StripeApi | null = null;
let cached: { key: string; client: StripeApi } | null = null;

/** Replace the Stripe client (tests only); null restores the real one. */
/** @public Fresh-module contract reader: scripts/test-billing.ts accesses this through its isolated loader. */
export function setStripeForTests(client: StripeApi | null): void {
  testClient = client;
}

/** The Stripe client for the configured key, or null without one. */
export function stripeFor(config: BillingConfig): StripeApi | null {
  if (testClient) return testClient;
  if (!config.secretKey) return null;
  if (cached?.key !== config.secretKey) {
    cached = {
      key: config.secretKey,
      client: new Stripe(config.secretKey, {
        // Current Checkout Studio header, verified in the account on 12 Oct 2026.
        apiVersion: '2026-09-30.endive; custom_checkout_payment_form_preview=v1' as Stripe.LatestApiVersion,
        maxNetworkRetries: STRIPE_NETWORK_RETRIES,
        timeout: STRIPE_TIMEOUT_MS,
        appInfo: { name: 'devShark', url: config.origin },
      }),
    };
  }
  return cached.client;
}

/** A Stripe API error, read without trusting its shape. */
export function stripeErrorCode(error: unknown): { status: number | null; code: string | null; type: string | null } {
  const e = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
  return {
    status: typeof e.statusCode === 'number' ? e.statusCode : null,
    code: typeof e.code === 'string' ? e.code : null,
    type: typeof e.type === 'string' ? e.type : null,
  };
}

/** Verify `Stripe-Signature` against the raw body and return the event, or
 * null when no candidate verifies. Uses Stripe's own verifier (HMAC-SHA256,
 * constant-time comparison, five-minute tolerance). */
export async function verifyStripeEvent(req: VercelRequest, secret: string): Promise<Stripe.Event | null> {
  const header = req.headers['stripe-signature'];
  const signature = Array.isArray(header) ? header[0] : header;
  if (typeof signature !== 'string' || signature.length === 0 || signature.length > 2000) return null;
  for (const candidate of await rawBodyCandidates(req)) {
    try {
      const event = Stripe.webhooks.constructEvent(candidate, signature, secret);
      if (event && event.object === 'event' && typeof event.id === 'string' && event.id.length > 0
        && typeof event.type === 'string' && event.type.length > 0
        && event.data && typeof event.data === 'object' && !Array.isArray(event.data)) return event;
      return null;
    } catch {
      // Try the next candidate; none verifying means the request is refused.
    }
  }
  return null;
}

/** Read the complete Stripe list before a caller changes its status filter. */
export async function listStripeObjects<T extends { id: string }>(
  load: (page: { limit: number; starting_after?: string }) => PromiseLike<{ data: T[]; has_more: boolean }>,
): Promise<T[]> {
  const rows: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await load(cursor ? { limit: 100, starting_after: cursor } : { limit: 100 });
    rows.push(...page.data);
    if (!page.has_more) return rows;
    const next = page.data[page.data.length - 1]?.id;
    if (!next || cursors.has(next)) throw new Error('stripe_list_incomplete');
    cursors.add(next);
    cursor = next;
  }
}
