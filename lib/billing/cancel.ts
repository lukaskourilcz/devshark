/** The public cancellation and withdrawal (`/premium/cancel`, § 312k BGB and
 * the EU withdrawal button). No sign-in needed: the buyer names the email of
 * the subscription and confirms. The server acts on an address only once the
 * person who typed it has shown they read its mail: a signed-in owner of the
 * address at once, anyone else through a single-use link sent to it
 * (`handleBillingCancel`). Then it finds the Stripe customers with that email
 * and acts on their devShark subscriptions:
 *
 *   cancel    the subscription ends at the end of the paid period.
 *   withdraw  within 14 days of the account's first payment, and once per
 *             account: every payment of the subscription is refunded in full,
 *             it ends now and the grant is revoked (the owner's voluntary
 *             refund policy, so nobody argues about the waiver). Otherwise a
 *             withdrawal is a cancellation.
 *
 * Nothing on the page says whether an address has a subscription before its
 * mail was read; the details go by email to the address on the subscription. */

import type Stripe from 'stripe';
import { isRpcMissing, logEvent, withTimeout } from '../http';
import type { BillingConfig } from './config';
import { sendEmail as sendSharedEmail } from '../email/resend';
import { renderStoredEmail } from '../email/templates';
import { fallbackEmailTemplate, renderEmailTemplate, type EmailTemplateId } from '../../shared/email-templates';
import {
  allSubscriptionsOf,
  BillingMigrationError,
  BillingPermanentError,
  customerOwner,
  endsInsteadOfRenewing,
  expireOpenCheckouts,
  idOf,
  isDevsharkSubscription,
  LIVE_SUBSCRIPTION_STATUSES,
  periodEnd,
  revokeSubscription,
  syncSubscription,
  type BillingDeps,
} from './sync';
import { stripeErrorCode } from './stripe';

export type CancelAction = 'cancel' | 'withdraw';
export const WITHDRAWAL_DAYS = 14;
/** The Stripe customer metadata key that remembers a voluntary refund, so an
 * account deleted and made again with the same address does not get a
 * second one. */
export const REFUND_MARK = 'devshark_voluntary_refund';

export interface CancelEffect {
  subscriptionId: string;
  customerEmail: string | null;
  /** The subscription ended now (a withdrawal) rather than at period end. */
  withdrawn: boolean;
  refunded: boolean;
  /** When Premium ends. */
  endsAt: string | null;
}

const log = (event: Record<string, unknown>) => logEvent('user/billing-cancel', event);

/** A devShark subscription: written by our checkout, or billing one of our
 * Prices. Anything else on a shared Stripe account is left alone. Broader than
 * `billsPremium` on purpose: a subscription our checkout made can always be
 * cancelled here, whatever it bills now. */
const isOurs = (sub: Stripe.Subscription, config: BillingConfig): boolean => isDevsharkSubscription(sub, config);

/** Mirror the change now so the Profile shows it at once. The webhook that
 * follows does the same; a failure here is logged and left to it. */
async function mirror(run: () => Promise<unknown>, subscriptionId: string) {
  try {
    await run();
  } catch (error) {
    log({ level: 'warn', kind: 'mirror_deferred', reason: error instanceof BillingPermanentError ? error.code : 'error', subscription: subscriptionId });
  }
}

async function cancelAtPeriodEnd(deps: BillingDeps, sub: Stripe.Subscription, email: string | null): Promise<CancelEffect> {
  const updated = endsInsteadOfRenewing(sub)
    ? sub
    : await deps.stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
  await mirror(() => syncSubscription(deps, sub.id), sub.id);
  return { subscriptionId: sub.id, customerEmail: email, withdrawn: false, refunded: false, endsAt: periodEnd(updated) };
}

/** When the account first paid anything: the earliest paid invoice of every
 * Stripe customer that shares the address, so a second subscription, or an
 * account deleted and made again, does not start a new refund window
 * (finding integrity-2). Milliseconds, or null before any payment. */
async function firstPaymentAt(deps: BillingDeps, customerIds: readonly string[]): Promise<number | null> {
  let first: number | null = null;
  const lists = await Promise.all([...new Set(customerIds)].map((customer) =>
    deps.stripe.invoices.list({ customer, status: 'paid', limit: 100 })));
  for (const invoices of lists) {
    for (const invoice of invoices.data) {
      const paidAt = invoice.status_transitions?.paid_at;
      if (typeof paidAt === 'number' && (first === null || paidAt < first)) first = paidAt;
    }
  }
  return first === null ? null : first * 1000;
}

/** Take the account's one voluntary refund for this subscription. False when
 * the account took it for another subscription, when a customer that shares
 * the address carries the mark of one, or when the account is unknown. */
async function claimRefund(deps: BillingDeps, sub: Stripe.Subscription, customers: readonly Stripe.Customer[]): Promise<boolean> {
  const marked = customers.some((customer) => {
    const mark = customer.metadata?.[REFUND_MARK];
    return typeof mark === 'string' && mark.length > 0 && mark !== sub.id;
  });
  if (marked) return false;
  const customerId = idOf(sub.customer);
  const fromMetadata = typeof sub.metadata?.supabase_user_id === 'string' && sub.metadata.supabase_user_id ? sub.metadata.supabase_user_id : null;
  const userId = fromMetadata ?? (customerId ? await customerOwner(deps, customerId) : null);
  if (!userId) return false;
  const { data, error } = await withTimeout(deps.supabase.rpc('claim_voluntary_refund', { p_user_id: userId, p_subscription_id: sub.id }));
  if (error) {
    if (isRpcMissing(error)) throw new BillingMigrationError();
    throw new Error('db_error: claim_voluntary_refund');
  }
  if (data !== true) return false;
  if (customerId) await deps.stripe.customers.update(customerId, { metadata: { [REFUND_MARK]: sub.id } });
  return true;
}

async function withdraw(
  deps: BillingDeps,
  sub: Stripe.Subscription,
  email: string | null,
  customers: readonly Stripe.Customer[],
  firstPaidOf: (customerIds: readonly string[]) => Promise<number | null>,
): Promise<CancelEffect> {
  const now = deps.now?.() ?? Date.now();
  const customerIds = [...customers.map((customer) => customer.id), idOf(sub.customer)].filter((id): id is string => Boolean(id));
  const firstPaid = await firstPaidOf(customerIds);
  if (firstPaid !== null && now - firstPaid > WITHDRAWAL_DAYS * 86_400_000) {
    // The withdrawal period is over: the request still ends the subscription.
    return cancelAtPeriodEnd(deps, sub, email);
  }
  const invoices = await deps.stripe.invoices.list({ subscription: sub.id, status: 'paid', limit: 100 });
  const charged = invoices.data.filter((invoice) => invoice.amount_paid > 0);
  // Money to give back: the account's one voluntary refund. Taken already, it
  // is a cancellation at the end of the paid period.
  if (charged.length > 0 && !(await claimRefund(deps, sub, customers))) {
    log({ status: 200, kind: 'withdraw', reason: 'refund_already_used' });
    return cancelAtPeriodEnd(deps, sub, email);
  }

  let refunded = false;
  for (const invoice of charged) {
    const payments = await deps.stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 10 });
    for (const payment of payments.data) {
      const paymentIntent = idOf(payment.payment?.payment_intent);
      const charge = idOf(payment.payment?.charge);
      if (!paymentIntent && !charge) continue;
      try {
        await deps.stripe.refunds.create(
          {
            ...(paymentIntent ? { payment_intent: paymentIntent } : { charge: charge! }),
            reason: 'requested_by_customer',
            metadata: { devshark: 'withdrawal', subscription: sub.id },
          },
          { idempotencyKey: `devshark-withdraw-${payment.id}` },
        );
        refunded = true;
      } catch (error) {
        if (stripeErrorCode(error).code !== 'charge_already_refunded') throw error;
        refunded = true;
      }
    }
  }
  const received = new Date(now).toISOString().slice(0, 10);
  const note = refunded
    ? `Revoked: withdrawal within ${WITHDRAWAL_DAYS} days of the first payment, refunded in full (${received}).`
    : `Revoked: withdrawal before any payment (${received}).`;
  await deps.stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false }).catch((error: unknown) => {
    if (stripeErrorCode(error).code !== 'resource_missing') throw error;
  });
  await mirror(() => revokeSubscription(deps, sub.id, note), sub.id);
  return { subscriptionId: sub.id, customerEmail: email, withdrawn: true, refunded, endsAt: new Date(now).toISOString() };
}

/** Act on every live devShark subscription of the customers with this email. */
export async function cancelByEmail(
  deps: BillingDeps,
  config: BillingConfig,
  email: string,
  action: CancelAction,
): Promise<CancelEffect[]> {
  const addresses = [...new Set([email, email.toLowerCase()])];
  const customers = new Map<string, Stripe.Customer>();
  // The reads run together; the changes below stay one after another.
  const found = await Promise.all(addresses.map((address) => deps.stripe.customers.list({ email: address, limit: 10 })));
  for (const list of found) for (const customer of list.data) customers.set(customer.id, customer);
  const effects: CancelEffect[] = [];
  const all = [...customers.values()];
  const subsOf = await Promise.all(all.map((customer) => allSubscriptionsOf(deps, customer.id)));
  // Every subscription here belongs to one of these customers, so the first
  // payment is the same answer for each: read the invoices once.
  const firstPaid = new Map<string, Promise<number | null>>();
  const firstPaidOf = (customerIds: readonly string[]) => {
    const key = [...new Set(customerIds)].sort().join(',');
    let found = firstPaid.get(key);
    if (!found) {
      found = firstPaymentAt(deps, customerIds);
      firstPaid.set(key, found);
    }
    return found;
  };
  for (const [index, customer] of all.entries()) {
    for (const sub of subsOf[index]) {
      if (!LIVE_SUBSCRIPTION_STATUSES.has(sub.status) || !isOurs(sub, config)) continue;
      effects.push(
        action === 'withdraw'
          ? await withdraw(deps, sub, customer.email ?? null, all, firstPaidOf)
          : await cancelAtPeriodEnd(deps, sub, customer.email ?? null),
      );
    }
  }
  log({ status: 200, kind: action, matched: effects.length > 0 ? 'some' : 'none' });
  return effects;
}

/** Cancel every live devShark subscription of an account that is being
 * deleted, at once, so a deleted account is never charged again. Its open
 * Checkout Sessions are expired first, so none can start a subscription after
 * the account is gone (finding BILL-3). One paid in that very moment is ended
 * by the webhook, which finds no account for it. */
export async function cancelForDeletedAccount(
  deps: BillingDeps,
  config: BillingConfig,
  customerId: string,
): Promise<{ ended: number; expired: number }> {
  const { expired } = await expireOpenCheckouts(deps, customerId);
  const subs = await allSubscriptionsOf(deps, customerId);
  let ended = 0;
  for (const sub of subs) {
    if (!LIVE_SUBSCRIPTION_STATUSES.has(sub.status) || !isOurs(sub, config)) continue;
    try {
      await deps.stripe.subscriptions.cancel(sub.id, { invoice_now: false, prorate: false });
    } catch (error) {
      // Ended between the list and the cancel: nothing left to stop. Thrown on,
      // it would read as "no customer" and leave the rest of the list charging
      // an account that is about to be deleted.
      if (stripeErrorCode(error).code !== 'resource_missing') throw error;
      continue;
    }
    ended += 1;
  }
  return { ended, expired };
}

/* ── The emails (Resend) ────────────────────────────────────────────────── */

/** How long a confirmation link works. */
export const CANCEL_LINK_MINUTES = 60;

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
const longTime = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso));

/** Which template one effect's receipt uses, with its variables. */
function receipt(effect: CancelEffect, receivedAt: string, origin: string): { id: EmailTemplateId; variables: Record<string, string> } {
  if (effect.withdrawn) {
    return { id: 'withdrawn', variables: { received_at: longTime(receivedAt), refund_note: effect.refunded
      ? 'Your subscription ended at once and we refunded your payment in full. Your bank may take 5 to 10 days to show it.'
      : 'Your subscription ended at once. You were not charged.' } };
  }
  return { id: 'cancelled', variables: { received_at: longTime(receivedAt), profile_url: `${origin}/profile`,
    ends_at: effect.endsAt ? longDate(effect.endsAt) : 'the end of the period you paid for' } };
}

/** The link that confirms a request made on the page. The token sits after
 * `#`, so it never reaches a server log or a Referer header. */
function confirmation(action: CancelAction, token: string, receivedAt: string, origin: string): { id: EmailTemplateId; variables: Record<string, string> } {
  return { id: action === 'withdraw' ? 'withdraw_link' : 'cancel_link', variables: {
    received_at: longTime(receivedAt), minutes: String(CANCEL_LINK_MINUTES), link: `${origin}/premium/cancel#confirm=${token}` } };
}

const fallback = ({ id, variables }: { id: EmailTemplateId; variables: Record<string, string> }) => {
  const { subject, text } = renderEmailTemplate(fallbackEmailTemplate(id), variables);
  return { subject, text };
};

/** The receipt for one effect in the code's own wording (the template fallback). Exported for the tests. */
export function cancellationEmail(effect: CancelEffect, receivedAt: string, origin: string): { subject: string; text: string } {
  return fallback(receipt(effect, receivedAt, origin));
}

/** The confirmation link email in the code's own wording. Exported for the tests. */
export function cancellationLinkEmail(action: CancelAction, token: string, receivedAt: string, origin: string): { subject: string; text: string } {
  return fallback(confirmation(action, token, receivedAt, origin));
}

/** Through the shared Resend sender (lib/email/resend.ts). */
async function sendEmail(config: BillingConfig, to: string, email: { id: EmailTemplateId; variables: Record<string, string> }, fetchImpl: typeof fetch): Promise<boolean> {
  if (!config.email) return false;
  // The administration's saved wording (lib/email/templates.ts), or the code's when none is saved.
  return sendSharedEmail(config.email, to, await renderStoredEmail(email.id, email.variables), fetchImpl);
}

export async function sendCancellationEmail(
  config: BillingConfig,
  effect: CancelEffect,
  receivedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!effect.customerEmail) return false;
  return sendEmail(config, effect.customerEmail, receipt(effect, receivedAt, config.origin), fetchImpl);
}

export async function sendCancellationLinkEmail(
  config: BillingConfig,
  to: string,
  action: CancelAction,
  token: string,
  receivedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  return sendEmail(config, to, confirmation(action, token, receivedAt, config.origin), fetchImpl);
}
