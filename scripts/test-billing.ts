/* Billing contract (#221).
 *
 * Runs the real billing handlers against a fake Stripe API and an in-memory
 * model of the migration 039 routines. Nothing reaches Stripe: the client is
 * replaced through `setStripeForTests`, and sign-in is answered by a small
 * local Auth stand-in.
 *
 * The webhook payloads in scripts/fixtures/billing/ cover the nine subscribed
 * event types. They were written from Stripe's API reference for the pinned
 * version (2026-08-26.dahlia), not captured, because no Stripe account exists
 * yet; once the owner's sandbox exists, replace them with `stripe trigger`
 * captures (NEEDED.md). Each test signs its payload with
 * `stripe.webhooks.generateTestHeaderString`, the way Stripe signs a delivery.
 *
 * `runBillingSuite` takes the database as a parameter, so the same assertions
 * also run against a real Postgres holding migration 039 (the run recorded in
 * docs/release-acceptance.md). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

/* ── Environment ─────────────────────────────────────────────────────────── */

export const WEBHOOK_SECRET = 'whsec_devshark_contract_test';
export const PRICES = { monthly: 'price_1FixturePremiumMonthly', annual: 'price_1FixturePremiumAnnual' };

const BASE_ENV = {
  BILLING_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_devshark_contract_never_sent',
  VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_devshark_contract_never_sent',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_PREMIUM_MONTHLY: PRICES.monthly,
  STRIPE_PRICE_PREMIUM_ANNUAL: PRICES.annual,
  STRIPE_MANAGED_PAYMENTS: 'true',
  PUBLIC_ORIGIN: 'https://devshark.app',
};

function applyEnv(overrides: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Sign-in for the handlers: a local stand-in for Supabase Auth's /user. */
export const TOKENS = new Map<string, { id: string; email: string }>();

export async function startAuthStandIn(): Promise<Server> {
  const server = createServer((req, res) => {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = TOKENS.get(token);
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/auth/v1/user') && user) {
      res.end(JSON.stringify({ id: user.id, email: user.email, email_confirmed_at: '2026-01-01T00:00:00Z', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} }));
      return;
    }
    res.statusCode = 401;
    res.end(JSON.stringify({ message: 'invalid token' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  // lib/auth.ts reads these when it loads, so set them before loading it.
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-contract-test';
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VITE_SUPABASE_ANON_KEY;
  delete process.env.NODE_ENV;
  delete process.env.VERCEL_ENV;
  delete process.env.RESEND_API_KEY;
  return server;
}

export async function loadLib() {
  const [stripe, handlers, config, cancel, sync, entitlements, http] = await Promise.all([
    import('../lib/billing/stripe'),
    import('../lib/billing/handlers'),
    import('../lib/billing/config'),
    import('../lib/billing/cancel'),
    import('../lib/billing/sync'),
    import('../lib/entitlements'),
    import('../lib/http'),
  ]);
  return {
    ...stripe, ...handlers, ...config, ...cancel, ...sync,
    toEntitlementResponse: entitlements.toEntitlementResponse,
    UpstreamTimeoutError: http.UpstreamTimeoutError,
  };
}
type Lib = Awaited<ReturnType<typeof loadLib>>;

/* ── The database ────────────────────────────────────────────────────────── */

export interface GrantView {
  source: string;
  status: string;
  subscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  note: string | null;
}

export interface Backend {
  name: string;
  supabase: SupabaseClient;
  addUser(id: string, email: string): Promise<void> | void;
  grants(userId: string): Promise<GrantView[]>;
  event(id: string): Promise<{ processed: boolean; error: string | null; attempts: number } | null>;
  consent(sessionId: string): Promise<{ userId: string; subscriptionId: string | null; waiverText: string } | null>;
  /** Expire every open cancellation link, as an hour passing would. */
  expireCancelLinks(): Promise<void> | void;
  /** The subscriptions whose Premium benefits were taken back, in call order;
   * null where the backend cannot tell (the database runs the routine). */
  benefitRevocations(): string[] | null;
}

type Row = {
  id: string; user_id: string; source: string; status: string; provider_subscription_id: string | null;
  provider_price_id: string | null; current_period_end: string | null; cancel_at_period_end: boolean;
  valid_until: string | null; note: string | null; updated_at: number; past_due_since: string | null;
};

/** An in-memory model of the migration 039 routines the billing code calls,
 * as migration 053 restates them. The rules mirror the SQL; the Postgres run
 * and supabase/tests/16x prove the SQL itself. */
export function memoryBackend(): Backend {
  const users = new Map<string, string>();
  const grants: Row[] = [];
  const customers = new Map<string, string>();
  const events = new Map<string, { processed_at: number | null; attempted_at: number | null; attempts: number; error: string | null }>();
  const consents = new Map<string, { user_id: string; provider_subscription_id: string | null; waiver_text: string }>();
  const refundClaims = new Map<string, string>();
  const cancelRequests = new Map<string, { email: string; action: string; requested_at: number; expires_at: number; used_at: number | null }>();
  const revocations: string[] = [];
  let seq = 0;
  const live = (g: Row) => {
    const now = Date.now();
    if (g.source !== 'provider') return g.status === 'active' && (!g.valid_until || Date.parse(g.valid_until) > now);
    return g.status === 'active' || g.status === 'trialing'
      || (g.status === 'past_due' && !!g.past_due_since && Date.parse(g.past_due_since) + 7 * 86_400_000 > now);
  };
  // Migration 053: a subscription that can still charge, Premium or not.
  const charging = (g: Row) => g.source === 'provider' && ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(g.status);
  const requestView = (row: { email: string; action: string; requested_at: number; expires_at: number }) => ({
    email: row.email, action: row.action, requestedAt: new Date(row.requested_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
  });
  const ok = (data: unknown) => ({ data, error: null });
  const fail = (message: string) => ({ data: null, error: { message } });
  const missing = (name: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } });
  const routines: Record<string, (a: Record<string, any>) => { data: unknown; error: { message: string } | null }> = {
    is_premium: (a) => ok(grants.some((g) => g.user_id === a.p_user && live(g))),
    entitlement_summary: (a) => {
      const best = grants.filter((g) => g.user_id === a.p_user && live(g)).sort((x, y) => {
        const end = (g: Row) => (g.source === 'provider' ? g.current_period_end : g.valid_until);
        const ex = end(x); const ey = end(y);
        if (ex === null || ey === null) return ex === ey ? 0 : ex === null ? -1 : 1;
        return Date.parse(ey) - Date.parse(ex) || Number(y.source === 'provider') - Number(x.source === 'provider');
      })[0];
      const billing = {
        billingAccount: customers.has(a.p_user),
        subscriptionLive: grants.some((g) => g.user_id === a.p_user && charging(g)),
      };
      return ok(best
        ? { premium: true, source: best.source, status: best.status, currentPeriodEnd: best.current_period_end, cancelAtPeriodEnd: best.cancel_at_period_end, validUntil: best.valid_until, inGrace: best.source === 'provider' && best.status === 'past_due', ...billing }
        : { premium: false, ...billing });
    },
    record_billing_event: (a) => {
      const now = Date.now();
      const row = events.get(a.p_event_id);
      if (!row) { events.set(a.p_event_id, { processed_at: null, attempted_at: now, attempts: 1, error: null }); return ok(true); }
      if (row.processed_at === null && (row.attempted_at === null || row.attempted_at < now - 60_000)) {
        row.attempted_at = now; row.attempts += 1; return ok(true);
      }
      return ok(false);
    },
    finish_billing_event: (a) => {
      const row = events.get(a.p_event_id);
      if (!row) return ok(false);
      row.processed_at = Date.now(); row.error = a.p_error ?? null; return ok(true);
    },
    release_billing_event: (a) => {
      const row = events.get(a.p_event_id);
      if (!row || row.processed_at !== null) return ok(false);
      row.attempted_at = null; row.error = a.p_error ?? null; return ok(true);
    },
    link_billing_customer: (a) => {
      // Migration 053: never for an account Auth does not have.
      if (!users.has(a.p_user_id)) return fail('unknown_account');
      for (const [user, customer] of customers) {
        if (customer === a.p_provider_customer_id && user !== a.p_user_id) return fail('billing_customer_conflict');
      }
      customers.set(a.p_user_id, a.p_provider_customer_id); return ok(true);
    },
    billing_customer_owner: (a) => ok([...customers].find(([, c]) => c === a.p_provider_customer_id)?.[0] ?? null),
    billing_account: (a) => ok({
      customerId: customers.get(a.p_user_id) ?? null,
      providerLive: grants.some((g) => g.user_id === a.p_user_id && charging(g)),
      liveSubscriptionIds: grants.filter((g) => g.user_id === a.p_user_id && charging(g)).map((g) => g.provider_subscription_id),
    }),
    upsert_provider_entitlement: (a) => {
      if (!users.has(a.p_user_id)) return fail('unknown_account');
      const existing = grants.find((g) => g.provider_subscription_id === a.p_subscription_id);
      if (existing && existing.user_id !== a.p_user_id) return fail('subscription_owner_conflict');
      const since = a.p_status === 'past_due' ? (a.p_past_due_since ?? new Date().toISOString()) : null;
      if (existing) {
        const status = existing.status === 'revoked' ? 'revoked' : a.p_status;
        // The first failure seen stands while the grant stays past_due.
        existing.past_due_since = status !== 'past_due' ? null : existing.status === 'past_due' && existing.past_due_since ? existing.past_due_since : since;
        existing.status = status;
        existing.provider_price_id = a.p_price_id; existing.current_period_end = a.p_current_period_end;
        existing.cancel_at_period_end = Boolean(a.p_cancel_at_period_end); existing.note = a.p_note ?? existing.note;
        existing.updated_at = Date.now(); return ok(existing.id);
      }
      const row: Row = {
        id: `grant-${++seq}`, user_id: a.p_user_id, source: 'provider', status: a.p_status, provider_subscription_id: a.p_subscription_id,
        provider_price_id: a.p_price_id, current_period_end: a.p_current_period_end, cancel_at_period_end: Boolean(a.p_cancel_at_period_end),
        valid_until: null, note: a.p_note ?? null, updated_at: Date.now(), past_due_since: since,
      };
      grants.push(row); return ok(row.id);
    },
    grant_manual_entitlement: (a) => {
      const row: Row = {
        id: `grant-${++seq}`, user_id: a.p_user_id, source: 'manual', status: 'active', provider_subscription_id: null, provider_price_id: null,
        current_period_end: null, cancel_at_period_end: false, valid_until: a.p_valid_until ?? null, note: a.p_note, updated_at: Date.now(),
        past_due_since: null,
      };
      grants.push(row); return ok(row.id);
    },
    claim_voluntary_refund: (a) => {
      if (!customers.has(a.p_user_id)) return ok(false);
      const taken = refundClaims.get(a.p_user_id);
      if (taken && taken !== a.p_subscription_id) return ok(false);
      refundClaims.set(a.p_user_id, a.p_subscription_id); return ok(true);
    },
    create_billing_cancel_request: (a) => {
      const now = Date.now();
      const recent = [...cancelRequests.values()].filter((r) => r.email.toLowerCase() === String(a.p_email).toLowerCase() && r.requested_at > now - 3_600_000).length;
      if (recent >= (a.p_max_per_hour ?? 3)) return ok(false);
      const asked = a.p_requested_at ? Date.parse(a.p_requested_at) : NaN;
      const requestedAt = Number.isFinite(asked) && Math.abs(asked - now) <= 300_000 ? asked : now;
      cancelRequests.set(a.p_token_hash, { email: a.p_email, action: a.p_action, requested_at: requestedAt, expires_at: now + (a.p_ttl_minutes ?? 60) * 60_000, used_at: null });
      return ok(true);
    },
    review_billing_cancel_request: (a) => {
      const row = cancelRequests.get(a.p_token_hash);
      return ok(row && row.used_at === null && row.expires_at > Date.now() ? requestView(row) : null);
    },
    consume_billing_cancel_request: (a) => {
      const row = cancelRequests.get(a.p_token_hash);
      if (!row || row.used_at !== null || row.expires_at <= Date.now()) return ok(null);
      row.used_at = Date.now(); return ok(requestView(row));
    },
    release_billing_cancel_request: (a) => {
      const row = cancelRequests.get(a.p_token_hash);
      if (!row || row.used_at === null || row.expires_at <= Date.now()) return ok(false);
      row.used_at = null; return ok(true);
    },
    revoke_premium_benefits: (a) => {
      revocations.push(a.p_subscription_id);
      return ok({ cancelledOrders: 0, owed: 0, debited: 0 });
    },
    record_checkout_consent: (a) => {
      const existing = consents.get(a.p_session_id);
      if (existing && existing.user_id !== a.p_user_id) return fail('checkout_consent_conflict');
      if (existing) { existing.provider_subscription_id ??= a.p_subscription_id; return ok(true); }
      consents.set(a.p_session_id, { user_id: a.p_user_id, provider_subscription_id: a.p_subscription_id, waiver_text: a.p_waiver_text });
      return ok(true);
    },
  };
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) =>
      // A routine that is not installed answers the way PostgREST 12 does.
      routines[name] ? routines[name](args) : missing(name),
    // The one table read the billing code makes: an event row's state.
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => {
            if (table !== 'billing_events') return fail(`no table ${table}`);
            const row = events.get(id);
            return ok(row ? { processed_at: row.processed_at === null ? null : new Date(row.processed_at).toISOString() } : null);
          },
        }),
      }),
    }),
    auth: {
      admin: {
        getUserById: async (id: string) => users.has(id)
          ? { data: { user: { id, email: users.get(id) } }, error: null }
          : { data: { user: null }, error: { message: 'User not found', status: 404 } },
      },
    },
  } as unknown as SupabaseClient;
  return {
    name: 'memory',
    supabase,
    addUser: (id, email) => { users.set(id, email); },
    grants: async (userId) => grants.filter((g) => g.user_id === userId).map((g) => ({
      source: g.source, status: g.status, subscriptionId: g.provider_subscription_id, cancelAtPeriodEnd: g.cancel_at_period_end, note: g.note,
    })),
    event: async (id) => {
      const row = events.get(id);
      return row ? { processed: row.processed_at !== null, error: row.error, attempts: row.attempts } : null;
    },
    consent: async (sessionId) => {
      const row = consents.get(sessionId);
      return row ? { userId: row.user_id, subscriptionId: row.provider_subscription_id, waiverText: row.waiver_text } : null;
    },
    expireCancelLinks: () => { for (const row of cancelRequests.values()) row.expires_at = Date.now() - 1; },
    benefitRevocations: () => [...revocations],
  };
}

/* ── A fake Stripe API ───────────────────────────────────────────────────── */

const FIXTURES = join(process.cwd(), 'scripts/fixtures/billing');
const FIXTURE_TYPES = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'radar.early_fraud_warning.created',
] as const;
type FixtureType = (typeof FIXTURE_TYPES)[number];

/** The ids the fixtures use, rewritten per scenario. */
const FIXTURE_IDS = {
  user: '00000000-0000-4000-8000-00000000f1a1',
  sub: 'sub_1FixturePremium0001',
  cus: 'cus_FixturePremium01',
  cs: 'cs_test_a1FixturePremiumCheckout0001',
  inv: 'in_1FixturePremium0001',
  pi: 'pi_3FixturePremium0001',
  ch: 'ch_3FixturePremium0001',
  dp: 'dp_1FixturePremium0001',
  efw: 'issfr_1FixturePremium0001',
};
type Ids = typeof FIXTURE_IDS;

export function idsFor(tag: string, userId: string): Ids {
  return {
    user: userId, sub: `sub_${tag}`, cus: `cus_${tag}`, cs: `cs_test_${tag}Session0001`, inv: `in_${tag}`,
    pi: `pi_${tag}`, ch: `ch_${tag}`, dp: `dp_${tag}`, efw: `issfr_${tag}`,
  };
}

/** A fixture as Stripe would send it for these ids: indented JSON. */
export function eventText(type: FixtureType, ids: Ids, eventSuffix: string): string {
  let text = readFileSync(join(FIXTURES, `${type}.json`), 'utf8');
  for (const key of Object.keys(FIXTURE_IDS) as (keyof Ids)[]) text = text.split(FIXTURE_IDS[key]).join(ids[key]);
  const event = JSON.parse(text) as { id: string };
  event.id = `${event.id}_${eventSuffix}`;
  return JSON.stringify(event, null, 2);
}
const fixtureObject = (type: FixtureType, ids: Ids) =>
  structuredClone((JSON.parse(eventText(type, ids, 'x')) as { data: { object: any } }).data.object);

const stripeError = (statusCode: number, code: string, message = code) =>
  Object.assign(new Error(message), { statusCode, code, type: statusCode >= 500 ? 'StripeAPIError' : 'StripeInvalidRequestError' });

const DAY = 86_400;
const nowSeconds = () => Math.floor(Date.now() / 1000);

type SubShape = { status?: string; periodEnd?: number; periodStart?: number; cancel?: boolean; metadataUser?: string | null; price?: string };

export class FakeStripe {
  customers = new Map<string, any>();
  subs = new Map<string, any>();
  sessions = new Map<string, any>();
  invoices = new Map<string, any>();
  charges = new Map<string, any>();
  invoicePayments: any[] = [];
  refunds: Array<{ params: any; key?: string }> = [];
  createdSessions: any[] = [];
  portalSessions: any[] = [];
  customerCreates: Array<{ params: any; key?: string }> = [];
  cancels: Array<{ id: string; params: any }> = [];
  /** Runs inside `checkout.sessions.expire` before the status is checked, to
   * stand for a buyer paying in another tab at that moment. */
  onExpire: ((session: any) => void) | null = null;
  calls = 0;
  failNext = new Map<string, unknown>();
  private seq = 0;
  private keys = new Map<string, any>();

  private call(name: string) {
    this.calls += 1;
    const failure = this.failNext.get(name);
    if (failure) { this.failNext.delete(name); throw failure; }
  }
  private get<T>(map: Map<string, T>, id: string, what: string): T {
    const value = map.get(id);
    if (!value) throw stripeError(404, 'resource_missing', `No such ${what}: '${id}'`);
    return structuredClone(value);
  }

  /** Seed a customer and a live subscription from the fixtures. A second
   * seed with the same customer id adds a subscription to that customer. */
  seed(ids: Ids, email: string, sub: SubShape = {}) {
    const known = this.customers.get(ids.cus);
    this.customers.set(ids.cus, { id: ids.cus, object: 'customer', email, metadata: { ...(known?.metadata ?? {}), supabase_user_id: ids.user } });
    this.setSub(ids, sub);
    this.sessions.set(ids.cs, fixtureObject('checkout.session.completed', ids));
    const invoice = fixtureObject('invoice.paid', ids);
    invoice.status_transitions.paid_at = nowSeconds();
    this.invoices.set(ids.inv, invoice);
    this.charges.set(ids.ch, { ...fixtureObject('charge.refunded', ids), refunded: false, amount_refunded: 0 });
    this.invoicePayments.push({
      id: `inpay_${ids.inv.slice(3)}`, object: 'invoice_payment', amount_paid: 399, currency: 'eur', invoice: ids.inv, is_default: true,
      livemode: false, payment: { type: 'payment_intent', payment_intent: ids.pi }, status: 'paid',
      status_transitions: { canceled_at: null, paid_at: nowSeconds() },
    });
  }
  setSub(ids: Ids, sub: SubShape = {}) {
    const fresh = !this.subs.has(ids.sub);
    const base = this.subs.get(ids.sub) ?? fixtureObject('customer.subscription.created', ids);
    if (sub.status) base.status = sub.status;
    if (sub.periodEnd !== undefined) base.items.data[0].current_period_end = sub.periodEnd;
    else if (fresh) base.items.data[0].current_period_end = nowSeconds() + 30 * DAY;
    if (sub.periodStart !== undefined) base.items.data[0].current_period_start = sub.periodStart;
    else if (fresh) base.items.data[0].current_period_start = nowSeconds() - DAY;
    if (sub.price !== undefined) base.items.data[0].price = { ...base.items.data[0].price, id: sub.price, product: sub.price.startsWith('price_1Fixture') ? base.items.data[0].price.product : 'prod_SomethingElse' };
    if (sub.cancel !== undefined) base.cancel_at_period_end = sub.cancel;
    if (sub.metadataUser === null) base.metadata = {};
    else if (sub.metadataUser) base.metadata = { supabase_user_id: sub.metadataUser };
    this.subs.set(ids.sub, base);
  }

  api(): any {
    return {
      customers: {
        create: async (params: any, options?: { idempotencyKey?: string }) => {
          this.call('customers.create');
          this.customerCreates.push({ params, key: options?.idempotencyKey });
          if (options?.idempotencyKey && this.keys.has(options.idempotencyKey)) return this.keys.get(options.idempotencyKey);
          const customer = { id: `cus_new${++this.seq}`, object: 'customer', email: params.email ?? null, metadata: params.metadata ?? {} };
          this.customers.set(customer.id, customer);
          if (options?.idempotencyKey) this.keys.set(options.idempotencyKey, customer);
          return customer;
        },
        list: async (params: { email?: string }) => {
          this.call('customers.list');
          return { object: 'list', data: [...this.customers.values()].filter((c) => c.email === params.email).map((c) => structuredClone(c)), has_more: false };
        },
        update: async (id: string, params: { metadata?: Record<string, string> }) => {
          this.call('customers.update');
          const customer = this.customers.get(id);
          if (!customer) throw stripeError(404, 'resource_missing');
          customer.metadata = { ...(customer.metadata ?? {}), ...(params.metadata ?? {}) };
          return structuredClone(customer);
        },
      },
      checkout: {
        sessions: {
          create: async (params: any) => {
            this.call('checkout.sessions.create');
            if (!this.customers.has(params.customer)) throw stripeError(400, 'resource_missing', `No such customer: '${params.customer}'`);
            this.createdSessions.push(params);
            const id = `cs_test_created${++this.seq}Session`;
            const session = {
              id, client_secret: id + '_secret_test', ui_mode: params.ui_mode, expires_at: Math.floor(Date.now() / 1000) + 86400, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', payment_status: 'unpaid',
              mode: params.mode, customer: params.customer, client_reference_id: params.client_reference_id, metadata: params.metadata ?? {}, subscription: null,
            };
            this.sessions.set(id, session);
            return structuredClone(session);
          },
          retrieve: async (id: string) => { this.call('checkout.sessions.retrieve'); return this.get(this.sessions, id, 'checkout.session'); },
          list: async (params: { customer?: string; status?: string }) => {
            this.call('checkout.sessions.list');
            if (params.customer && !this.customers.has(params.customer)) throw stripeError(400, 'resource_missing', `No such customer: '${params.customer}'`);
            const data = [...this.sessions.values()].filter((s) =>
              (!params.customer || s.customer === params.customer) && (!params.status || s.status === params.status));
            return { object: 'list', data: structuredClone(data), has_more: false };
          },
          expire: async (id: string) => {
            this.call('checkout.sessions.expire');
            const session = this.sessions.get(id);
            if (!session) throw stripeError(404, 'resource_missing');
            this.onExpire?.(session);
            if (session.status !== 'open') {
              // Stripe's answer for a session that is no longer open.
              throw Object.assign(new Error('Only Checkout Sessions with a status in ["open"] can be expired.'), { statusCode: 400, type: 'StripeInvalidRequestError' });
            }
            session.status = 'expired';
            return structuredClone(session);
          },
        },
      },
      billingPortal: {
        sessions: {
          create: async (params: any) => {
            this.call('billingPortal.sessions.create');
            if (!this.customers.has(params.customer)) throw stripeError(400, 'resource_missing');
            this.portalSessions.push(params);
            return { id: 'bps_test', object: 'billing_portal.session', url: 'https://billing.stripe.com/p/session/test_contract' };
          },
        },
      },
      subscriptions: {
        retrieve: async (id: string) => { this.call('subscriptions.retrieve'); return this.get(this.subs, id, 'subscription'); },
        update: async (id: string, params: any) => {
          this.call('subscriptions.update');
          const sub = this.subs.get(id);
          if (!sub) throw stripeError(404, 'resource_missing');
          if (params.cancel_at_period_end !== undefined) sub.cancel_at_period_end = params.cancel_at_period_end;
          return structuredClone(sub);
        },
        cancel: async (id: string, params?: any) => {
          this.call('subscriptions.cancel');
          this.cancels.push({ id, params });
          const sub = this.subs.get(id);
          if (!sub) throw stripeError(404, 'resource_missing');
          sub.status = 'canceled'; sub.canceled_at = nowSeconds(); sub.ended_at = nowSeconds();
          return structuredClone(sub);
        },
        list: async (params: { customer: string; limit?: number; starting_after?: string }) => {
          this.call('subscriptions.list');
          // Pages the way Stripe does: `limit` per page (10 by default),
          // continued after `starting_after`.
          const all = [...this.subs.values()].filter((s) => s.customer === params.customer);
          const from = params.starting_after ? all.findIndex((s) => s.id === params.starting_after) + 1 : 0;
          const page = all.slice(from, from + (params.limit ?? 10));
          return { object: 'list', data: page.map((s) => structuredClone(s)), has_more: from + page.length < all.length };
        },
      },
      invoices: {
        retrieve: async (id: string) => { this.call('invoices.retrieve'); return this.get(this.invoices, id, 'invoice'); },
        list: async (params: { subscription?: string; customer?: string; status?: string }) => {
          this.call('invoices.list');
          const data = [...this.invoices.values()].filter((inv) =>
            (!params.subscription || inv.parent?.subscription_details?.subscription === params.subscription)
            && (!params.customer || inv.customer === params.customer)
            && (!params.status || inv.status === params.status));
          return { object: 'list', data: structuredClone(data), has_more: false };
        },
      },
      invoicePayments: {
        list: async (params: any) => {
          this.call('invoicePayments.list');
          const data = this.invoicePayments.filter((p) =>
            (params.payment ? p.payment.payment_intent === params.payment.payment_intent : true)
            && (params.invoice ? p.invoice === params.invoice : true)
            && (params.status ? p.status === params.status : true));
          const expand = (params.expand ?? []).includes('data.invoice');
          return { object: 'list', data: data.map((p) => ({ ...structuredClone(p), invoice: expand ? structuredClone(this.invoices.get(p.invoice)) : p.invoice })), has_more: false };
        },
      },
      charges: {
        retrieve: async (id: string) => { this.call('charges.retrieve'); return this.get(this.charges, id, 'charge'); },
      },
      refunds: {
        create: async (params: any, options?: { idempotencyKey?: string }) => {
          this.call('refunds.create');
          if (!options?.idempotencyKey || !this.refunds.some((r) => r.key === options.idempotencyKey)) {
            this.refunds.push({ params, key: options?.idempotencyKey });
          }
          return { id: `re_${++this.seq}`, object: 'refund', status: 'succeeded' };
        },
      },
    };
  }
}

/* ── Requests and responses ──────────────────────────────────────────────── */

export function mockRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, unknown>,
    body: undefined as any,
    headersSent: false,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; this.headersSent = true; return this; },
    send(body: unknown) { this.body = body; this.headersSent = true; return this; },
    end() { this.headersSent = true; },
    setHeader(name: string, value: unknown) { this.headers[name.toLowerCase()] = value; return this; },
    redirect() { return this; },
  };
}

let ipSeq = 0;
const freshIp = () => `10.20.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

/** A webhook delivery. `stream` replays the raw bytes the way Vercel's
 * runtime does; `string`, `buffer` and `parsed` are what other runtimes hand
 * a handler. */
function webhookReq(raw: string, signature: string | null, mode: 'stream' | 'string' | 'buffer' | 'parsed' = 'stream') {
  const base = {
    method: 'POST',
    url: '/api/user/billing-webhook',
    headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}), 'x-forwarded-for': freshIp() },
    query: { op: 'billing-webhook' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  const body = mode === 'string' ? raw : mode === 'buffer' ? Buffer.from(raw) : JSON.parse(raw);
  if (mode !== 'stream') return { ...base, body };
  return Object.assign(Readable.from([Buffer.from(raw)]), base, { body });
}

function apiReq(method: string, op: string, { token, body, query = {}, ip }: { token?: string; body?: unknown; query?: Record<string, string>; ip?: string } = {}) {
  return {
    method,
    url: `/api/user/${op}`,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': ip ?? freshIp() },
    query: { op, ...query },
    body,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

const sign = (raw: string, secret = WEBHOOK_SECRET) => Stripe.webhooks.generateTestHeaderString({ payload: raw, secret });

/* ── The suite ───────────────────────────────────────────────────────────── */

let userSeq = 0;
const newUserId = () => `00000000-0000-4000-8000-${String(++userSeq).padStart(12, '0')}`;

export async function runBillingSuite(db: Backend, lib: Lib): Promise<number> {
  let checks = 0;
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
      checks += 1;
    } catch (error) {
      console.error(`[${db.name}] ${name}`);
      throw error;
    }
  };
  applyEnv();
  const stripe = new FakeStripe();
  lib.setStripeForTests(stripe.api() as never);
  const supabase = db.supabase;

  const deliver = async (raw: string, mode: 'stream' | 'string' | 'buffer' | 'parsed' = 'stream', signature: string | null = sign(raw)) => {
    const res = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, signature, mode) as never, res as never, supabase);
    return res;
  };
  const premium = async (userId: string) => {
    const { data, error } = await supabase.rpc('is_premium', { p_user: userId });
    assert.equal(error, null);
    return data === true;
  };
  const summary = async (userId: string) => lib.toEntitlementResponse(
    (await supabase.rpc('entitlement_summary', { p_user: userId })).data,
  );
  const account = async (tag: string, sub: Parameters<FakeStripe['seed']>[2] = {}) => {
    const userId = newUserId();
    const email = `${tag.toLowerCase()}@example.com`;
    await db.addUser(userId, email);
    const token = `token-${tag}`;
    TOKENS.set(token, { id: userId, email });
    const ids = idsFor(tag, userId);
    stripe.seed(ids, email, sub);
    return { userId, email, token, ids };
  };
  const providerGrant = async (userId: string) => (await db.grants(userId)).find((g) => g.source === 'provider');
  /** The structured log lines written while `run` runs. */
  const logged = async (run: () => Promise<unknown>) => {
    const lines: Array<Record<string, unknown>> = [];
    const real = console.log;
    console.log = (...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg !== 'string' || !arg.startsWith('{')) continue;
        try { lines.push(JSON.parse(arg)); } catch { /* not a log line */ }
      }
      real(...args);
    };
    try {
      await run();
    } finally {
      console.log = real;
    }
    return lines;
  };

  /* Signatures ------------------------------------------------------------ */

  await check('unsigned, wrongly signed and tampered payloads answer 400', async () => {
    const a = await account('Sig1');
    const raw = eventText('customer.subscription.created', a.ids, 'sig');
    for (const res of [
      await deliver(raw, 'stream', null),
      await deliver(raw, 'stream', sign(raw, 'whsec_someone_else')),
      await deliver(raw.replace('"active"', '"trialing"'), 'stream', sign(raw)),
      await deliver(raw, 'stream', 't=1,v1=00'),
    ]) {
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'bad_signature');
    }
    assert.equal(await db.event(`evt_1FixtureSubscriptionCreated_sig`), null, 'an unsigned event is never recorded');
    assert.equal(await premium(a.userId), false);
    const old = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await deliver(raw)).statusCode, 503, 'no secret, no webhook');
    process.env.STRIPE_WEBHOOK_SECRET = old;
  });

  await check('a hung Stripe call and its retry fit inside the function budget', async () => {
    // Seven seconds and a retry was 14.5 s against a 10 s function: the
    // platform cut the request off before the handler could answer.
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { functions: Record<string, { maxDuration?: number }> };
    const budget = (vercel.functions['api/**/*.ts']?.maxDuration ?? 10) * 1000;
    const worst = lib.STRIPE_TIMEOUT_MS * (lib.STRIPE_NETWORK_RETRIES + 1) + lib.STRIPE_RETRY_DELAY_MS * lib.STRIPE_NETWORK_RETRIES;
    assert.ok(worst <= budget - 1000, `${worst} ms leaves the handler no time to answer within ${budget} ms`);
  });

  await check('the raw body verifies however the runtime hands it over', async () => {
    for (const mode of ['stream', 'string', 'buffer', 'parsed'] as const) {
      const a = await account(`Raw${mode}`);
      const res = await deliver(eventText('customer.subscription.created', a.ids, `raw${mode}`), mode);
      assert.equal(res.statusCode, 200, mode);
      assert.equal(await premium(a.userId), true, mode);
    }
    const raw = eventText('invoice.paid', idsFor('RawX', newUserId()), 'rawx');
    const candidates = await lib.rawBodyCandidates(webhookReq(raw, 'x', 'stream') as never);
    assert.equal(candidates[0], raw, 'the replayed bytes come first');
    // A runtime that read the stream already (a body parser) hands over an
    // ended stream: the body is used at once, without waiting for events
    // that never come.
    const consumed = webhookReq(raw, 'x', 'stream') as unknown as Readable;
    for await (const chunk of consumed) void chunk;
    const started = Date.now();
    const fallback = await lib.rawBodyCandidates(consumed as never);
    assert.ok(Date.now() - started < 500, `an ended stream waited ${Date.now() - started} ms`);
    assert.equal(JSON.parse(fallback[0]).id, JSON.parse(raw).id);
  });

  /* The subscription lifecycle, including a local billing simulation ------ */

  await check('checkout.session.completed opens Premium, links the customer and keeps the consent', async () => {
    const a = await account('Life1');
    const raw = eventText('checkout.session.completed', a.ids, 'life1');
    const res = await deliver(raw);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'applied');
    assert.equal(await premium(a.userId), true);
    const consent = await db.consent(a.ids.cs);
    assert.equal(consent?.userId, a.userId);
    assert.equal(consent?.subscriptionId, a.ids.sub);
    assert.match(consent?.waiverText ?? '', /lose my 14-day right of withdrawal for digital content/);
    assert.equal((await supabase.rpc('billing_customer_owner', { p_provider_customer_id: a.ids.cus })).data, a.userId);
    assert.deepEqual(await db.event('evt_1FixtureCheckoutCompleted_life1'), { processed: true, error: null, attempts: 1 });

    // A second delivery of the same event is a no-op: no Stripe call, no change.
    const before = stripe.calls;
    const again = await deliver(raw);
    assert.equal(again.statusCode, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(stripe.calls, before, 'a duplicate never reaches Stripe');
    assert.equal((await db.grants(a.userId)).length, 1);

    // Renewal: invoice.paid mirrors the new period from the live object.
    const renewed = nowSeconds() + 60 * DAY;
    stripe.setSub(a.ids, { periodEnd: renewed });
    assert.equal((await deliver(eventText('invoice.paid', a.ids, 'life1'))).statusCode, 200);
    assert.equal((await summary(a.userId)).currentPeriodEnd, new Date(renewed * 1000).toISOString());

    // Cancel at period end: Premium stays open and the plan line says so.
    stripe.setSub(a.ids, { cancel: true });
    await deliver(eventText('customer.subscription.updated', a.ids, 'life1'));
    assert.equal(await premium(a.userId), true);
    assert.equal((await summary(a.userId)).cancelAtPeriodEnd, true);
    // Whatever grant wins the line, the plan says a subscription is live and
    // the account has a billing customer (finding product-10).
    await supabase.rpc('grant_manual_entitlement', { p_user_id: a.userId, p_valid_until: null, p_note: 'longer than the paid period' });
    const both = await summary(a.userId);
    assert.deepEqual([both.source, both.billingAccount, both.subscriptionLive], ['manual', true, true]);
    stripe.setSub(a.ids, { status: 'canceled' });
    await deliver(eventText('customer.subscription.deleted', a.ids, 'life1end'));
    const ended = await summary(a.userId);
    assert.deepEqual([ended.billingAccount, ended.subscriptionLive], [true, false], 'the invoices stay reachable after the subscription ended');
  });

  await check('past_due keeps Premium for seven days from the failed renewal, not from the period end', async () => {
    // Stripe opens the next period when it creates the renewal invoice, so a
    // failed renewal already carries the next period's end, weeks ahead. The
    // grace runs from the start of that unpaid period (finding product-3).
    const a = await account('Grace1');
    await deliver(eventText('customer.subscription.created', a.ids, 'grace0'));
    stripe.setSub(a.ids, { status: 'past_due', periodStart: nowSeconds() - 3 * DAY, periodEnd: nowSeconds() + 27 * DAY });
    assert.equal((await deliver(eventText('invoice.payment_failed', a.ids, 'grace1'))).statusCode, 200);
    assert.equal(await premium(a.userId), true, 'day 3 of the grace window');
    assert.equal((await summary(a.userId)).inGrace, true);
    // Another retry reports the same unpaid period; a later event never moves
    // the start of the window forward.
    stripe.setSub(a.ids, { status: 'past_due', periodStart: nowSeconds() - DAY });
    await deliver(eventText('customer.subscription.updated', a.ids, 'grace1b'));
    assert.equal(await premium(a.userId), true);
    const late = await account('Grace2');
    await deliver(eventText('customer.subscription.created', late.ids, 'grace2a'));
    stripe.setSub(late.ids, { status: 'past_due', periodStart: nowSeconds() - 8 * DAY, periodEnd: nowSeconds() + 22 * DAY });
    await deliver(eventText('invoice.payment_failed', late.ids, 'grace2'));
    assert.equal(await premium(late.userId), false, 'day 8: the grace window is over though the period runs for 22 more days');
    // Paying opens it again, and a later failure starts a new window.
    stripe.setSub(late.ids, { status: 'active', periodStart: nowSeconds(), periodEnd: nowSeconds() + 30 * DAY });
    await deliver(eventText('invoice.paid', late.ids, 'grace2b'));
    assert.equal(await premium(late.userId), true);
    stripe.setSub(late.ids, { status: 'past_due', periodStart: nowSeconds() - DAY });
    await deliver(eventText('customer.subscription.updated', late.ids, 'grace2c'));
    assert.equal(await premium(late.userId), true, 'a new failure has its own seven days');
    stripe.setSub(a.ids, { status: 'canceled' });
    await deliver(eventText('customer.subscription.deleted', a.ids, 'grace3'));
    assert.equal(await premium(a.userId), false);
    assert.equal((await providerGrant(a.userId))?.status, 'canceled');
  });

  await check('only a subscription that bills a devShark Premium price opens Premium', async () => {
    // Another product on the same Stripe account, on a customer devShark
    // created: no Premium, and the event is recorded with the reason
    // (finding integrity-7).
    const other = await account('Price1', { metadataUser: null, price: 'price_1OtherProductMonthly' });
    await supabase.rpc('link_billing_customer', { p_user_id: other.userId, p_provider_customer_id: other.ids.cus });
    const res = await deliver(eventText('customer.subscription.created', other.ids, 'price1'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'recorded');
    assert.equal(res.body.reason, 'not_devshark_price');
    assert.equal(await premium(other.userId), false);
    assert.deepEqual(await db.grants(other.userId), []);
    // A devShark subscription switched to another product's price ends
    // Premium, and switching back opens it again.
    const switched = await account('Price2');
    await deliver(eventText('customer.subscription.created', switched.ids, 'price2a'));
    assert.equal(await premium(switched.userId), true);
    stripe.setSub(switched.ids, { price: 'price_1OtherProductMonthly' });
    await deliver(eventText('customer.subscription.updated', switched.ids, 'price2b'));
    assert.equal(await premium(switched.userId), false);
    assert.equal((await providerGrant(switched.userId))?.status, 'canceled');
    assert.match((await providerGrant(switched.userId))?.note ?? '', /no longer bills a devShark Premium price/);
    stripe.setSub(switched.ids, { price: PRICES.annual });
    await deliver(eventText('customer.subscription.updated', switched.ids, 'price2c'));
    assert.equal(await premium(switched.userId), true);
    // After a price change, the earlier Price keeps its subscribers Premium
    // once it is listed as legacy.
    const legacy = await account('Price3', { price: 'price_1OlderPremiumMonthly' });
    await deliver(eventText('customer.subscription.created', legacy.ids, 'price3a'));
    assert.equal(await premium(legacy.userId), false);
    applyEnv({ STRIPE_PRICE_PREMIUM_LEGACY: 'price_1OlderPremiumMonthly' });
    await deliver(eventText('customer.subscription.updated', legacy.ids, 'price3b'));
    assert.equal(await premium(legacy.userId), true);
    applyEnv({ STRIPE_PRICE_PREMIUM_LEGACY: undefined });
  });

  await check('deleted before created ends canceled', async () => {
    const a = await account('Order1', { status: 'canceled' });
    assert.equal((await deliver(eventText('customer.subscription.deleted', a.ids, 'order1'))).statusCode, 200);
    assert.equal((await deliver(eventText('customer.subscription.created', a.ids, 'order1'))).statusCode, 200);
    assert.equal(await premium(a.userId), false);
    const grants = await db.grants(a.userId);
    assert.equal(grants.length, 1);
    assert.equal(grants[0].status, 'canceled');
  });

  await check('a delivery that read the state before a payment went through does not leave it unpaid', async () => {
    // Two deliveries of one change run at once: this one read "incomplete",
    // the payment went through, another delivery wrote "active", and only
    // then did this one write what it had read.
    const a = await account('Race2', { status: 'incomplete' });
    let moved = false;
    const racing = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'upsert_provider_entitlement' && !moved) {
          moved = true;
          stripe.setSub(a.ids, { status: 'active' });
        }
        return supabase.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    const raw = eventText('customer.subscription.created', a.ids, 'race2');
    const res = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, res as never, racing);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'applied');
    assert.equal((await providerGrant(a.userId))?.status, 'active', 'the last write follows a read made after it');
    assert.equal(await premium(a.userId), true);
  });

  await check('an unknown user is recorded and answered 200', async () => {
    const ghost = newUserId();
    const ids = idsFor('Ghost1', ghost);
    stripe.seed(ids, 'ghost@example.com');
    const res = await deliver(eventText('customer.subscription.created', ids, 'ghost1'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'recorded');
    assert.equal(res.body.reason, 'unknown_user');
    const event = await db.event('evt_1FixtureSubscriptionCreated_ghost1');
    assert.equal(event?.processed, true);
    assert.match(event?.error ?? '', /^unknown_user/);
    assert.deepEqual(await db.grants(ghost), []);
    // No account id anywhere is just as unknown.
    const nobody = idsFor('Ghost2', newUserId());
    stripe.seed(nobody, 'nobody@example.com', { metadataUser: null });
    assert.equal((await deliver(eventText('customer.subscription.updated', nobody, 'ghost2'))).body.reason, 'unknown_user');
  });

  await check('a delivery that arrives while another still processes the event asks Stripe to retry', async () => {
    const a = await account('Inflight1');
    const raw = eventText('customer.subscription.created', a.ids, 'inflight1');
    // The first delivery is still working on the event when the second lands.
    let second: ReturnType<typeof mockRes> | null = null;
    const busy = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'upsert_provider_entitlement' && !second) {
          second = await deliver(raw);
          throw new Error('the first delivery fails after all');
        }
        return supabase.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    const first = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, first as never, busy);
    assert.equal(first.statusCode, 500);
    assert.ok(second);
    const overlapping = second as ReturnType<typeof mockRes>;
    assert.deepEqual([overlapping.statusCode, overlapping.body.error?.code], [409, 'event_in_progress'], 'not a 200 that ends Stripe’s retries');
    // Stripe's retry then applies it.
    const retried = await deliver(raw);
    assert.deepEqual([retried.statusCode, retried.body.outcome], [200, 'applied']);
    assert.equal(await premium(a.userId), true);
    assert.equal((await deliver(raw)).body.duplicate, true, 'a processed event stays a 200 duplicate');
  });

  await check('an event applied but not closed says so in the log', async () => {
    const a = await account('Finish1');
    const unclosed = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => name === 'finish_billing_event'
        ? { data: null, error: { code: 'XX000', message: 'boom' } }
        : supabase.rpc(name, args),
    } as unknown as SupabaseClient;
    const raw = eventText('customer.subscription.created', a.ids, 'finish1');
    const res = mockRes();
    const lines = await logged(() => lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, res as never, unclosed));
    assert.equal(res.statusCode, 200);
    assert.equal(await premium(a.userId), true);
    assert.ok(lines.some((line) => line.reason === 'finish_failed' && line.level === 'warn'), 'the open row is logged');
  });

  await check('a failure part-way is retried by the next delivery', async () => {
    const a = await account('Retry1');
    const raw = eventText('customer.subscription.created', a.ids, 'retry1');
    stripe.failNext.set('subscriptions.retrieve', stripeError(500, 'api_error'));
    const failed = await deliver(raw);
    assert.equal(failed.statusCode, 500);
    const event = await db.event('evt_1FixtureSubscriptionCreated_retry1');
    assert.equal(event?.processed, false);
    assert.equal(event?.error, 'api_error');
    const retried = await deliver(raw);
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.body.outcome, 'applied');
    assert.equal(await premium(a.userId), true);
    assert.equal((await db.event('evt_1FixtureSubscriptionCreated_retry1'))?.attempts, 2);
  });

  /* Refunds, disputes and fraud warnings revoke ---------------------------- */

  await check('a full refund revokes, cancels the subscription and stays revoked', async () => {
    const a = await account('Refund1');
    await deliver(eventText('checkout.session.completed', a.ids, 'refund0'));
    assert.equal(await premium(a.userId), true);
    stripe.charges.get(a.ids.ch).refunded = true;
    stripe.charges.get(a.ids.ch).amount_refunded = 399;
    const res = await deliver(eventText('charge.refunded', a.ids, 'refund1'));
    assert.equal(res.statusCode, 200);
    assert.equal(await premium(a.userId), false);
    const grant = await providerGrant(a.userId);
    assert.equal(grant?.status, 'revoked');
    assert.match(grant?.note ?? '', /refunded in full/);
    assert.equal(stripe.subs.get(a.ids.sub).status, 'canceled', 'no further charges');
    // Stripe reporting the subscription active again changes nothing.
    stripe.setSub(a.ids, { status: 'active' });
    await deliver(eventText('customer.subscription.updated', a.ids, 'refund2'));
    assert.equal((await providerGrant(a.userId))?.status, 'revoked');
    assert.equal(await premium(a.userId), false);
  });

  await check('a partial refund only logs', async () => {
    const a = await account('Partial1');
    await deliver(eventText('customer.subscription.created', a.ids, 'partial0'));
    stripe.charges.get(a.ids.ch).amount_refunded = 100;
    const res = await deliver(eventText('charge.refunded', a.ids, 'partial1'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.outcome, 'ignored');
    assert.equal(await premium(a.userId), true);
    assert.equal(stripe.subs.get(a.ids.sub).status, 'active');
  });

  await check('a dispute revokes at once with a note', async () => {
    const a = await account('Dispute1');
    await deliver(eventText('customer.subscription.created', a.ids, 'dispute0'));
    const res = await deliver(eventText('charge.dispute.created', a.ids, 'dispute1'));
    assert.equal(res.statusCode, 200);
    assert.equal(await premium(a.userId), false);
    const grant = await providerGrant(a.userId);
    assert.equal(grant?.status, 'revoked');
    assert.match(grant?.note ?? '', new RegExp(`dispute ${a.ids.dp}`));
  });

  await check('an early fraud warning refunds once and revokes', async () => {
    const a = await account('Fraud1');
    await deliver(eventText('customer.subscription.created', a.ids, 'fraud0'));
    const raw = eventText('radar.early_fraud_warning.created', a.ids, 'fraud1');
    assert.equal((await deliver(raw)).statusCode, 200);
    assert.equal(await premium(a.userId), false);
    const refunds = stripe.refunds.filter((r) => r.params.charge === a.ids.ch);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].params.reason, 'fraudulent');
    assert.equal(refunds[0].key, `devshark-efw-${a.ids.efw}`);
    await deliver(raw);
    assert.equal(stripe.refunds.filter((r) => r.params.charge === a.ids.ch).length, 1, 'a redelivery refunds nothing more');
  });

  await check('a refund, a dispute or a fraud warning on another product’s subscription changes nothing at Stripe', async () => {
    // The three events belong to the whole Stripe account (finding BILL-1).
    // Another product: no devShark marker, another Price, a customer devShark
    // never linked.
    for (const kind of ['charge.refunded', 'charge.dispute.created', 'radar.early_fraud_warning.created'] as const) {
      const tag = `Foreign${kind.replace(/\W/g, '')}`;
      const ids = idsFor(tag, newUserId());
      stripe.seed(ids, `${tag.toLowerCase()}@example.com`, { metadataUser: null, price: 'price_1OtherProductMonthly' });
      stripe.customers.get(ids.cus).metadata = {};
      if (kind === 'charge.refunded') {
        stripe.charges.get(ids.ch).refunded = true;
        stripe.charges.get(ids.ch).amount_refunded = 399;
      }
      const cancels = stripe.cancels.length;
      const res = await deliver(eventText(kind, ids, tag.toLowerCase()));
      assert.equal(res.statusCode, 200, kind);
      assert.deepEqual([res.body.outcome, res.body.reason], ['recorded', 'not_devshark_price'], kind);
      assert.equal(stripe.subs.get(ids.sub).status, 'active', `${kind}: the other product’s subscription keeps running`);
      assert.equal(stripe.cancels.length, cancels, `${kind}: nothing is cancelled`);
      assert.equal(stripe.refunds.some((r) => r.params.charge === ids.ch), false, `${kind}: nothing is refunded`);
    }
    // Another product's marker wins, even over an account id devShark knows.
    const marked = await account('Foreign2', { price: 'price_1OtherProductMonthly' });
    stripe.subs.get(marked.ids.sub).metadata = { product: 'otherproduct', supabase_user_id: marked.userId };
    const disputed = await deliver(eventText('charge.dispute.created', marked.ids, 'foreign2'));
    assert.equal(disputed.body.reason, 'not_devshark_price');
    assert.equal(stripe.subs.get(marked.ids.sub).status, 'active');
    assert.deepEqual(await db.grants(marked.userId), []);
    // A devShark Price that maps to no account here: nothing is refunded or
    // cancelled either.
    const unowned = idsFor('Foreign3', newUserId());
    stripe.seed(unowned, 'foreign3@example.com', { metadataUser: null });
    stripe.customers.get(unowned.cus).metadata = {};
    const warned = await deliver(eventText('radar.early_fraud_warning.created', unowned, 'foreign3'));
    assert.deepEqual([warned.statusCode, warned.body.reason], [200, 'unknown_user']);
    assert.equal(stripe.subs.get(unowned.sub).status, 'active');
    assert.equal(stripe.refunds.some((r) => r.params.charge === unowned.ch), false, 'no refund before the account is known');
  });

  await check('a manual grant survives every provider event', async () => {
    const a = await account('Manual1');
    await supabase.rpc('grant_manual_entitlement', { p_user_id: a.userId, p_valid_until: null, p_note: 'contract test' });
    stripe.charges.get(a.ids.ch).refunded = true;
    for (const type of FIXTURE_TYPES) {
      if (type === 'customer.subscription.deleted') stripe.setSub(a.ids, { status: 'canceled' });
      const res = await deliver(eventText(type, a.ids, `manual${type.replace(/\W/g, '')}`));
      assert.equal(res.statusCode, 200, type);
      assert.equal(await premium(a.userId), true, `still Premium after ${type}`);
      const manual = (await db.grants(a.userId)).filter((g) => g.source === 'manual');
      assert.equal(manual.length, 1);
      assert.equal(manual[0].status, 'active', `manual grant untouched by ${type}`);
    }
    assert.equal((await providerGrant(a.userId))?.status, 'revoked', 'the provider grant took the revocations');
  });

  /* Checkout --------------------------------------------------------------- */

  const checkout = async (token: string | undefined, body: unknown) => {
    const res = mockRes();
    await lib.handleBillingCheckout(apiReq('POST', 'billing-checkout', { token, body: { ...(body as object), consent: true } }) as never, res as never, supabase);
    return res;
  };

  await check('checkout refuses anonymous callers, bad plans and a closed shop', async () => {
    const a = await account('Checkout0');
    assert.equal((await checkout(undefined, { plan: 'monthly' })).statusCode, 401);
    assert.equal((await checkout(a.token, { plan: 'lifetime' })).statusCode, 400);
    applyEnv({ BILLING_ENABLED: 'false' });
    const closed = await checkout(a.token, { plan: 'monthly' });
    assert.equal(closed.statusCode, 503);
    assert.equal(closed.body.error.code, 'billing_disabled');
    applyEnv({ STRIPE_MANAGED_PAYMENTS: undefined });
    assert.equal((await checkout(a.token, { plan: 'monthly' })).body.error.code, 'billing_disabled', 'the tax mode is the owner’s explicit choice');
    applyEnv();
  });

  await check('checkout creates one customer and a Checkout Session with the legal terms', async () => {
    const userId = newUserId();
    await db.addUser(userId, 'buyer@example.com');
    TOKENS.set('token-Buyer', { id: userId, email: 'buyer@example.com' });
    const res = await checkout('token-Buyer', { plan: 'monthly' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.client_secret, /^cs_test_.*_secret_test$/);
    assert.equal(res.body.ui_mode, 'embedded_page');
    assert.equal(res.body.url, undefined);
    const params = stripe.createdSessions.at(-1);
    assert.equal(params.mode, 'subscription');
    assert.equal(params.client_reference_id, userId);
    assert.deepEqual(params.line_items, [{ price: PRICES.monthly, quantity: 1 }]);
    assert.equal(params.subscription_data.metadata.supabase_user_id, userId);
    assert.equal(params.subscription_data.metadata.product, 'devshark', 'the subscription carries devShark’s own marker (finding BILL-1)');
    assert.equal(params.metadata.product, 'devshark', 'and so does the session');
    assert.equal(params.return_url, 'https://devshark.app/premium/success?session_id={CHECKOUT_SESSION_ID}');
    assert.equal(params.success_url, undefined);
    assert.equal(params.cancel_url, undefined);
    assert.equal(params.ui_mode, 'embedded_page');
    assert.equal(params.consent_collection, undefined);
    assert.equal(params.metadata.checkout_consent_version, 'devshark-checkout-form-v1');
    assert.match(params.metadata.checkout_consent_text, /^I want Premium to start now and I understand that I lose my 14-day right of withdrawal for digital content\./);
    assert.match(lib.checkoutText('monthly', 'https://devshark.app').submit.message, /applicable VAT added at checkout, renewed every month until you cancel/);
    assert.equal(params.submit_type, 'auto');
    assert.equal(params.payment_method_collection, undefined, 'Managed Payments controls payment collection');
    assert.deepEqual(params.phone_number_collection, { enabled: false });
    assert.equal(params.billing_address_collection, 'auto');
    assert.equal(params.allow_promotion_codes, true);
    assert.equal(params.locale, 'auto');
    assert.deepEqual(params.managed_payments, { enabled: true });
    assert.equal(params.automatic_tax, undefined, 'Managed Payments computes the tax itself');
    const customer = stripe.customerCreates.at(-1);
    assert.equal(customer?.key, `devshark-customer-${userId}`);
    assert.equal(customer?.params.email, 'buyer@example.com');
    const linked = (await supabase.rpc('billing_account', { p_user_id: userId })).data as { customerId: string };
    assert.ok(linked.customerId, 'the customer is linked to the account');

    // A second checkout reuses the customer; the annual plan takes its Price.
    const creates = stripe.customerCreates.length;
    await checkout('token-Buyer', { plan: 'annual' });
    assert.equal(stripe.customerCreates.length, creates);
    assert.deepEqual(stripe.createdSessions.at(-1).line_items, [{ price: PRICES.annual, quantity: 1 }]);
    assert.match(lib.checkoutText('annual', 'https://devshark.app').submit.message, /renewed every year/);

    // Plain Stripe with Stripe Tax behind the same flag.
    applyEnv({ STRIPE_MANAGED_PAYMENTS: 'false' });
    await checkout('token-Buyer', { plan: 'monthly' });
    const plain = stripe.createdSessions.at(-1);
    assert.deepEqual(plain.automatic_tax, { enabled: true });
    assert.deepEqual(plain.customer_update, { address: 'auto', name: 'auto' });
    assert.equal(plain.managed_payments, undefined);
    applyEnv();
  });

  await check('embedded checkout requires explicit consent before making a Stripe request', async () => {
    const a = await account('FormConsent');
    for (const consent of [undefined, false, 'true', 1]) {
      const calls = stripe.calls;
      const res = mockRes();
      await lib.handleBillingCheckout(apiReq('POST', 'billing-checkout', { token: a.token, body: { plan: 'monthly', consent } }) as never, res as never, supabase);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, 'checkout_consent_required');
      assert.equal(stripe.calls, calls, 'no customer, order or payment without consent');
    }
  });

  await check('the launch coupon rides on Checkout only inside its window, with billing on and the coupon set', async () => {
    const INSIDE = Date.parse('2026-10-10T10:00:00Z');
    const BEFORE = Date.parse('2026-10-03T21:59:59.999Z'); // 3 Oct 23:59:59.999 in Prague
    const START = Date.parse('2026-10-03T22:00:00Z'); // 4 Oct 00:00 in Prague
    const LAST = Date.parse('2026-11-30T22:59:59.999Z'); // 2 Nov 23:59:59.999 in Prague
    const AFTER = Date.parse('2026-11-30T23:00:00Z'); // 3 Nov 00:00 in Prague
    const withCoupon = lib.billingConfig({ ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'launch55' });
    const params = (config: ReturnType<typeof lib.billingConfig>, now: number, plan: 'monthly' | 'annual' = 'monthly') =>
      lib.checkoutSessionParams(config, plan, 'user-launch', 'cus_launch', now);
    // Stripe types `submit` as `'' | { message }`, where '' unsets it.
    const submitText = (session: ReturnType<typeof params>) => {
      return lib.checkoutText(session.metadata?.plan as 'monthly' | 'annual', 'https://devshark.app', session.metadata?.offer === 'launch-55').submit.message;
    };

    for (const plan of ['monthly', 'annual'] as const) {
      const inside = params(withCoupon, INSIDE, plan);
      assert.deepEqual(inside.discounts, [{ coupon: 'launch55' }], `${plan}: the coupon applies`);
      assert.equal(inside.allow_promotion_codes, undefined, 'Stripe takes discounts or allow_promotion_codes, never both');
      assert.equal(inside.subscription_data?.metadata?.offer, 'launch-55');
      assert.equal(inside.metadata?.offer, 'launch-55');
      assert.match(submitText(inside), /launch price, 55% below the regular price, applies to every renewal for as long as this subscription runs/);
      assert.deepEqual(inside.managed_payments, { enabled: true }, 'Managed Payments keeps the coupon');
    }
    for (const [label, now, on] of [['before', BEFORE, false], ['start', START, true], ['last', LAST, true], ['after', AFTER, false]] as const) {
      const one = params(withCoupon, now);
      assert.equal(Boolean(one.discounts), on, `${label}: discount ${on ? 'applies' : 'does not apply'}`);
      assert.equal(one.allow_promotion_codes, on ? undefined : true, `${label}: promotion codes ${on ? 'off' : 'on'}`);
    }
    // Outside the window the session is exactly today's.
    const outside = params(withCoupon, Date.parse('2026-09-28T12:00:00Z'));
    assert.deepEqual(outside, params(lib.billingConfig({ ...BASE_ENV }), Date.parse('2026-09-28T12:00:00Z')), 'the coupon env var alone changes nothing');
    assert.equal(outside.expires_at, undefined);
    assert.doesNotMatch(submitText(outside), /launch/);
    // No coupon, a malformed coupon or billing off: no discount, even inside.
    assert.equal(params(lib.billingConfig({ ...BASE_ENV }), INSIDE).discounts, undefined, 'env missing: inactive');
    assert.equal(params(lib.billingConfig({ ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'bad coupon/id' }), INSIDE).discounts, undefined, 'a malformed id is unset');
    assert.equal(lib.launchCoupon(lib.billingConfig({ ...BASE_ENV, BILLING_ENABLED: 'false', STRIPE_COUPON_LAUNCH: 'launch55' }), INSIDE), null, 'billing off: inactive');
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'launch55' }, INSIDE).launchOffer, true);
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'launch55' }, BEFORE).launchOffer, false);
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV }, INSIDE).launchOffer, false);
    assert.doesNotMatch(JSON.stringify(lib.publicBillingSettings({ ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'launch55' }, INSIDE)), /launch55/, 'the coupon id stays on the server');

    // The test-mode clock lets the owner try the launch Checkout before
    // 4 October on a Preview; a live key ignores it.
    const today = Date.parse('2026-09-28T12:00:00Z');
    const testClock = { ...BASE_ENV, STRIPE_COUPON_LAUNCH: 'launch55', LAUNCH_OFFER_TEST_NOW: '2026-10-10T10:00:00Z' };
    assert.deepEqual(params(lib.billingConfig(testClock), today).discounts, [{ coupon: 'launch55' }], 'test key: the test clock decides');
    assert.deepEqual(params(lib.billingConfig({ ...testClock, STRIPE_SECRET_KEY: 'rk_test_fixture' }), today).discounts, [{ coupon: 'launch55' }], 'restricted test key: the same test clock');
    const restrictedLive = lib.billingConfig({ ...testClock, STRIPE_SECRET_KEY: 'rk_live_fixture', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' });
    assert.equal(restrictedLive.checkoutEnabled, true, 'restricted live key requires its matching public live key');
    assert.equal(restrictedLive.launchTestNow, null, 'restricted live key never reads a test clock');
    assert.equal(lib.billingConfig({ ...testClock, STRIPE_SECRET_KEY: 'rk_live_fixture' }).checkoutEnabled, false, 'mixed live/test keys keep sales closed');
    assert.equal(params(lib.billingConfig({ ...testClock, STRIPE_SECRET_KEY: 'sk_live_devshark_never_sent' }), today).discounts, undefined, 'live key: the real clock decides');
    assert.equal(params(lib.billingConfig({ ...testClock, LAUNCH_OFFER_TEST_NOW: 'not a date' }), today).discounts, undefined);

    // A discounted session closes when the offer does, within Stripe's 30 min to 24 h.
    assert.equal(params(withCoupon, INSIDE).expires_at, Math.floor(INSIDE / 1000) + 24 * 3600 - 60, 'far from the end: about 24 hours');
    const lateEvening = Date.parse('2026-11-30T20:00:00Z');
    assert.equal(params(withCoupon, lateEvening).expires_at, Math.floor(AFTER / 1000), 'on the last evening: closes at the end');
    const lastMinutes = Date.parse('2026-11-30T22:50:00Z');
    assert.equal(params(withCoupon, lastMinutes).expires_at, Math.floor(lastMinutes / 1000) + 31 * 60, 'in the last half hour: Stripe’s minimum');

    // Through the handler: the coupon env var is set, and the clock decides.
    const userId = newUserId();
    await db.addUser(userId, 'launch@example.com');
    TOKENS.set('token-Launch', { id: userId, email: 'launch@example.com' });
    const realNow = Date.now;
    try {
      applyEnv({ STRIPE_COUPON_LAUNCH: 'launch55' });
      Date.now = () => Date.parse('2026-09-28T12:00:00Z');
      assert.equal((await checkout('token-Launch', { plan: 'annual' })).statusCode, 200);
      assert.equal(stripe.createdSessions.at(-1).discounts, undefined, 'today, 28 Sep: regular price');
      assert.equal(stripe.createdSessions.at(-1).allow_promotion_codes, true);
      Date.now = () => INSIDE;
      assert.equal((await checkout('token-Launch', { plan: 'annual' })).statusCode, 200);
      assert.deepEqual(stripe.createdSessions.at(-1).discounts, [{ coupon: 'launch55' }], 'inside the window: the coupon');
      applyEnv({ STRIPE_COUPON_LAUNCH: 'launch55', BILLING_ENABLED: 'false' });
      assert.equal((await checkout('token-Launch', { plan: 'annual' })).statusCode, 503, 'billing off sells nothing, coupon or not');
    } finally {
      Date.now = realNow;
      applyEnv();
    }
  });

  await check('a live subscription is sent to the portal, and a deleted customer is replaced', async () => {
    const live = await account('Checkout1');
    await deliver(eventText('checkout.session.completed', live.ids, 'checkout1'));
    const refused = await checkout(live.token, { plan: 'monthly' });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.body.error.code, 'already_premium');

    const gone = await account('Checkout2');
    await supabase.rpc('link_billing_customer', { p_user_id: gone.userId, p_provider_customer_id: 'cus_goneCheckout2' });
    const res = await checkout(gone.token, { plan: 'monthly' });
    assert.equal(res.statusCode, 200);
    const relinked = (await supabase.rpc('billing_account', { p_user_id: gone.userId })).data as { customerId: string };
    assert.notEqual(relinked.customerId, 'cus_goneCheckout2');
  });

  await check('a subscription that can still charge sends the account to the portal, not to a second checkout', async () => {
    // Past the 7-day grace, unpaid or paused: no Premium, but Stripe can still
    // charge it (finding BILL-2).
    const states: Array<[string, Parameters<FakeStripe['setSub']>[1]]> = [
      ['Second1', { status: 'past_due', periodStart: nowSeconds() - 8 * DAY, periodEnd: nowSeconds() + 22 * DAY }],
      ['Second2', { status: 'unpaid' }],
      ['Second3', { status: 'paused' }],
    ];
    for (const [tag, shape] of states) {
      const a = await account(tag);
      await deliver(eventText('customer.subscription.created', a.ids, `${tag}a`));
      stripe.setSub(a.ids, shape);
      await deliver(eventText('customer.subscription.updated', a.ids, `${tag}b`));
      assert.equal(await premium(a.userId), false, `${tag}: no Premium`);
      const plan = await summary(a.userId);
      assert.deepEqual([plan.tier, plan.subscriptionLive], ['free', true], `${tag}: the browser offers Manage billing`);
      const sessions = stripe.createdSessions.length;
      const res = await checkout(a.token, { plan: 'monthly' });
      assert.equal(res.statusCode, 409, `${tag}: a second checkout is refused`);
      assert.equal(res.body.error.code, 'already_premium');
      assert.equal(stripe.createdSessions.length, sessions, `${tag}: no second Checkout Session`);
    }

    // Stripe knows before the webhook arrives.
    const early = await account('Second4');
    await supabase.rpc('link_billing_customer', { p_user_id: early.userId, p_provider_customer_id: early.ids.cus });
    const sessions = stripe.createdSessions.length;
    const refused = await checkout(early.token, { plan: 'annual' });
    assert.equal(refused.statusCode, 409, 'a subscription Stripe already has blocks checkout');
    assert.equal(stripe.createdSessions.length, sessions);
  });

  await check('a live subscription behind many abandoned attempts still blocks checkout and ends with the account', async () => {
    const a = await account('Crowded');
    await supabase.rpc('link_billing_customer', { p_user_id: a.userId, p_provider_customer_id: a.ids.cus });
    // 120 abandoned attempts listed before the live one: more than one page.
    const live = stripe.subs.get(a.ids.sub);
    stripe.subs.delete(a.ids.sub);
    for (let i = 0; i < 120; i += 1) {
      stripe.subs.set(`sub_CrowdedExpired${i}`, { ...structuredClone(live), id: `sub_CrowdedExpired${i}`, status: 'incomplete_expired' });
    }
    stripe.subs.set(a.ids.sub, live);
    const sessions = stripe.createdSessions.length;
    const refused = await checkout(a.token, { plan: 'monthly' });
    assert.equal(refused.statusCode, 409, 'the live subscription past the first page blocks a second checkout');
    assert.equal(stripe.createdSessions.length, sessions);
    const { ended } = await lib.cancelForDeletedAccount({ stripe: stripe.api(), supabase } as never, lib.billingConfig(), a.ids.cus);
    assert.equal(ended, 1, 'account deletion ends the live subscription past the first page');
    assert.equal(stripe.subs.get(a.ids.sub).status, 'canceled');
  });

  await check('only the newest Checkout Session can be paid, and one paid a moment ago blocks another', async () => {
    const userId = newUserId();
    await db.addUser(userId, 'twotabs@example.com');
    TOKENS.set('token-TwoTabs', { id: userId, email: 'twotabs@example.com' });
    const first = await checkout('token-TwoTabs', { plan: 'monthly' });
    assert.equal(first.statusCode, 200);
    const firstId = first.body.session_id;
    assert.equal(stripe.sessions.get(firstId).status, 'open');
    const second = await checkout('token-TwoTabs', { plan: 'annual' });
    assert.equal(second.statusCode, 200);
    const secondId = second.body.session_id;
    assert.equal(stripe.sessions.get(firstId).status, 'expired', 'the first tab’s Checkout can no longer be paid');
    assert.equal(stripe.sessions.get(secondId).status, 'open');
    const customer = stripe.sessions.get(secondId).customer;
    assert.equal([...stripe.sessions.values()].filter((s) => s.customer === customer && s.status === 'open').length, 1);

    // The buyer pays the open session in one tab while the other starts again.
    stripe.onExpire = (session) => { session.status = 'complete'; };
    const sessions = stripe.createdSessions.length;
    const third = await checkout('token-TwoTabs', { plan: 'monthly' });
    stripe.onExpire = null;
    assert.equal(third.statusCode, 409, 'a session paid just now blocks another');
    assert.equal(third.body.error.code, 'already_premium');
    assert.equal(stripe.createdSessions.length, sessions);
  });

  await check('a second subscription on one account is logged for the owner and nothing is refunded', async () => {
    const two = await account('Second5');
    await deliver(eventText('customer.subscription.created', two.ids, 'second5a'));
    const again = { ...idsFor('Second5b', two.userId), cus: two.ids.cus };
    stripe.seed(again, two.email);
    const lines = await logged(() => deliver(eventText('customer.subscription.created', again, 'second5b')));
    const warning = lines.find((line) => line.kind === 'second_subscription');
    assert.ok(warning, 'the webhook warns about the second subscription');
    assert.equal(warning.level, 'warn');
    assert.equal(warning.subscription, again.sub);
    assert.deepEqual(warning.others, [two.ids.sub]);
    assert.match(String(warning.action), /Nothing was refunded/);
    assert.equal(stripe.subs.get(two.ids.sub).status, 'active');
    assert.equal(stripe.subs.get(again.sub).status, 'active');
    assert.equal(stripe.refunds.some((r) => r.params.payment_intent === again.pi || r.params.charge === again.ch), false);
    // The completed Checkout says the same.
    const completed = await logged(() => deliver(eventText('checkout.session.completed', again, 'second5c')));
    assert.ok(completed.some((line) => line.kind === 'second_subscription' && line.subscription === again.sub));
    // One subscription alone is no warning.
    const one = await account('Second6');
    const quiet = await logged(() => deliver(eventText('checkout.session.completed', one.ids, 'second6')));
    assert.equal(quiet.some((line) => line.kind === 'second_subscription'), false);
  });

  /* The success page's session lookup -------------------------------------- */

  const lookup = async (token: string | undefined, sessionId: string) => {
    const res = mockRes();
    await lib.handleBillingCheckout(apiReq('GET', 'billing-checkout', { token, query: { session_id: sessionId } }) as never, res as never, supabase);
    return res;
  };

  await check('the success page applies its own completed session and nobody else’s', async () => {
    const a = await account('Success1');
    const b = await account('Success2');
    assert.equal((await lookup(undefined, a.ids.cs)).statusCode, 401);
    assert.equal((await lookup(a.token, 'cs_live_bad!')).statusCode, 400);
    assert.equal((await lookup(b.token, a.ids.cs)).statusCode, 404, 'another account’s session reads as missing');
    assert.equal((await lookup(a.token, 'cs_test_doesNotExist001')).statusCode, 404);

    stripe.sessions.get(a.ids.cs).status = 'open';
    stripe.sessions.get(a.ids.cs).payment_status = 'unpaid';
    const pending = await lookup(a.token, a.ids.cs);
    assert.equal(pending.statusCode, 200);
    assert.equal(pending.body.status, 'pending');
    assert.equal(pending.body.entitlement.tier, 'free');

    stripe.sessions.get(a.ids.cs).status = 'complete';
    stripe.sessions.get(a.ids.cs).payment_status = 'paid';
    const done = await lookup(a.token, a.ids.cs);
    assert.equal(done.statusCode, 200);
    assert.equal(done.body.status, 'complete');
    assert.equal(done.body.entitlement.tier, 'premium');
    assert.equal((await db.consent(a.ids.cs))?.userId, a.userId);

    // The webhook arriving afterwards changes nothing.
    await deliver(eventText('checkout.session.completed', a.ids, 'success1'));
    assert.equal((await db.grants(a.userId)).length, 1);
  });

  await check('embedded checkout keeps the server-written consent when Stripe has no consent_collection', async () => {
    const a = await account('FormReceipt');
    const session = stripe.sessions.get(a.ids.cs);
    session.consent = null;
    session.metadata = { product: 'devshark', supabase_user_id: a.userId, checkout_consent_version: 'devshark-checkout-form-v1', checkout_consent_at: '2026-09-20T10:00:00.000Z', checkout_consent_text: 'The Terms and immediate-start waiver accepted before payment.' };
    const res = await lookup(a.token, a.ids.cs);
    assert.equal(res.statusCode, 200);
    assert.equal((await db.consent(a.ids.cs))?.waiverText, session.metadata.checkout_consent_text);
    assert.equal((await db.consent(a.ids.cs))?.userId, a.userId);
    assert.equal(res.body.entitlement.tier, 'premium');
  });

  /* The Customer Portal ---------------------------------------------------- */

  await check('the portal needs a billing account and returns to the profile', async () => {
    const fresh = await account('Portal0');
    const portal = async (token?: string) => {
      const res = mockRes();
      await lib.handleBillingPortal(apiReq('POST', 'billing-portal', { token }) as never, res as never, supabase);
      return res;
    };
    assert.equal((await portal()).statusCode, 401);
    const none = await portal(fresh.token);
    assert.equal(none.statusCode, 404);
    assert.equal(none.body.error.code, 'no_billing_account');
    const payer = await account('Portal1');
    await deliver(eventText('checkout.session.completed', payer.ids, 'portal1'));
    const res = await portal(payer.token);
    assert.equal(res.statusCode, 200);
    assert.match(res.body.url, /^https:\/\/billing\.stripe\.com\//);
    assert.deepEqual(stripe.portalSessions.at(-1), { customer: payer.ids.cus, return_url: 'https://devshark.app/profile' });
  });

  await check('a database timeout answers 503 upstream_timeout, not the payment provider’s 502', async () => {
    const payer = await account('Timeout1');
    await deliver(eventText('checkout.session.completed', payer.ids, 'timeout1'));
    const slow = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'billing_account' || name === 'entitlement_summary') throw new lib.UpstreamTimeoutError();
        return supabase.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    const portal = mockRes();
    await lib.handleBillingPortal(apiReq('POST', 'billing-portal', { token: payer.token }) as never, portal as never, slow);
    assert.deepEqual([portal.statusCode, portal.body.error.code], [503, 'upstream_timeout']);
    const lookup = mockRes();
    await lib.handleBillingCheckout(apiReq('GET', 'billing-checkout', { token: payer.token, query: { session_id: payer.ids.cs } }) as never, lookup as never, slow);
    assert.deepEqual([lookup.statusCode, lookup.body.error.code], [503, 'upstream_timeout']);
  });

  /* The public cancellation page ------------------------------------------- */

  const cancel = async (body: Record<string, unknown>, options: { token?: string; ip?: string } = {}) => {
    const res = mockRes();
    await lib.handleBillingCancel(apiReq('POST', 'billing-cancel', { body, ...options }) as never, res as never, supabase);
    return res;
  };

  // The link emails go through Resend's API; this stands in for it.
  const mail: Array<{ to: string[]; subject: string; text: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === 'https://api.resend.com/emails') {
      mail.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response('{"id":"email_test"}', { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  const withResend = { RESEND_API_KEY: 're_test_contract', RESEND_FROM: 'devShark <noreply@devshark.app>' };
  const linkIn = (text: string) => /\/premium\/cancel#confirm=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? null;

  await check('an anonymous request changes nothing and asks nothing of Stripe', async () => {
    assert.equal((await cancel({ email: 'not-an-email', action: 'cancel', step: 'request' })).body.error.code, 'bad_email');
    // Postgres text refuses U+0000: the recorded request answered 500.
    for (const email of ['some\u0000one@example.com', 'some\u0007one@example.com']) {
      const refused = await cancel({ email, action: 'cancel', step: 'request' });
      assert.deepEqual([refused.statusCode, refused.body.error?.code], [400, 'bad_email'], JSON.stringify(email));
    }
    const calls = stripe.calls;
    const first = await cancel({ email: 'someone@example.com', action: 'cancel', step: 'request' });
    assert.deepEqual(first.body, { step: 'confirm', action: 'cancel', email: 'someone@example.com' });
    assert.equal(stripe.calls, calls, 'step one looks nothing up');

    // Without an email provider nobody can prove the address is theirs: the
    // page asks for the sign-in, and nothing changes.
    const k = await account('Cancel1');
    const signIn = await cancel({ email: k.email, action: 'withdraw', step: 'confirm' });
    assert.equal(signIn.statusCode, 200);
    assert.equal(signIn.body.confirmBy, 'sign-in');
    assert.equal(stripe.calls, calls, 'no provider call before the address is proven');
    assert.equal(stripe.subs.get(k.ids.sub).status, 'active');
    assert.equal(stripe.subs.get(k.ids.sub).cancel_at_period_end, false);
    assert.equal(stripe.refunds.some((r) => r.params.payment_intent === k.ids.pi), false, 'nothing is refunded');

    // With one, the address gets a link, and the answer is the same whether or
    // not a subscription uses it.
    applyEnv(withResend);
    const started = Date.now();
    const unknown = await cancel({ email: 'nobody-here@example.com', action: 'withdraw', step: 'confirm' });
    assert.ok(Date.now() - started >= 850, 'the confirm step keeps its time floor');
    const known = await cancel({ email: k.email.toUpperCase(), action: 'withdraw', step: 'confirm' });
    assert.equal(unknown.statusCode, 200);
    assert.equal(known.statusCode, 200);
    assert.equal(known.body.confirmBy, 'email');
    const shape = (body: Record<string, unknown>) => Object.fromEntries(Object.entries(body).filter(([key]) => !['email', 'receivedAt'].includes(key)));
    assert.deepEqual(shape(unknown.body), shape(known.body), 'the same answer either way');
    assert.equal(known.body.details, undefined, 'an anonymous caller sees no details');
    assert.equal(stripe.calls, calls, 'still no provider call');
    assert.equal(stripe.subs.get(k.ids.sub).status, 'active', 'a request alone ends nothing');
    assert.deepEqual(mail.at(-1)?.to, [k.email.toUpperCase()], 'the link goes to the address that was typed');
    assert.match(mail.at(-1)?.subject ?? '', /Confirm your devShark Premium withdrawal/);
    applyEnv({ RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  });

  await check('the emailed link acts once, and only before it expires', async () => {
    applyEnv(withResend);
    const k = await account('Link1');
    await deliver(eventText('customer.subscription.created', k.ids, 'link1'));
    const asked = await cancel({ email: k.email, action: 'cancel', step: 'confirm' });
    assert.equal(asked.body.confirmBy, 'email');
    assert.equal(asked.body.expiresInMinutes, 60);
    const token = linkIn(mail.at(-1)?.text ?? '');
    assert.ok(token, 'the email carries the link');
    assert.equal((await cancel({ step: 'review', token: 'short' })).statusCode, 400);
    assert.equal((await cancel({ step: 'review', token: 'A'.repeat(43) })).statusCode, 410, 'an unknown link reads as expired');
    const review = await cancel({ step: 'review', token });
    assert.equal(review.statusCode, 200);
    assert.deepEqual([review.body.action, review.body.email], ['cancel', k.email]);
    assert.equal(stripe.subs.get(k.ids.sub).cancel_at_period_end, false, 'looking at the link changes nothing');
    const done = await cancel({ step: 'execute', token });
    assert.equal(done.statusCode, 200);
    assert.equal(done.body.confirmed, true);
    assert.equal(done.body.receivedAt, asked.body.receivedAt, 'the receipt keeps the time of the request');
    assert.deepEqual(done.body.details.map((d: { withdrawn: boolean }) => d.withdrawn), [false]);
    assert.equal(stripe.subs.get(k.ids.sub).cancel_at_period_end, true);
    assert.equal(await premium(k.userId), true, 'cancel keeps Premium to the period end');
    assert.equal((await cancel({ step: 'execute', token })).statusCode, 410, 'a link works once');
    // An outage after the link was used hands it back, so it works again.
    const o = await account('Link2');
    await cancel({ email: o.email, action: 'cancel', step: 'confirm' });
    const again = linkIn(mail.at(-1)?.text ?? '')!;
    stripe.failNext.set('customers.list', stripeError(500, 'api_error'));
    const outage = await cancel({ step: 'execute', token: again });
    assert.equal(outage.statusCode, 502);
    assert.equal(outage.body.error.code, 'billing_unavailable');
    assert.equal((await cancel({ step: 'execute', token: again })).statusCode, 200, 'the same link works after the outage');
    // An expired link does nothing.
    const x = await account('Link3');
    await cancel({ email: x.email, action: 'withdraw', step: 'confirm' });
    const stale = linkIn(mail.at(-1)?.text ?? '')!;
    await db.expireCancelLinks();
    assert.equal((await cancel({ step: 'execute', token: stale })).statusCode, 410);
    assert.equal(stripe.subs.get(x.ids.sub).status, 'active');
    applyEnv({ RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  });

  await check('an address gets at most three links an hour, and the page cannot tell', async () => {
    applyEnv(withResend);
    const sent = mail.length;
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await cancel({ email: 'flood@example.com', action: 'cancel', step: 'confirm' }));
    assert.deepEqual(answers.map((res) => [res.statusCode, res.body.confirmBy]), Array(4).fill([200, 'email']));
    assert.equal(mail.length - sent, 3, 'the fourth request sends nothing');
    applyEnv({ RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  });

  await check('a database timeout on the cancel link answers 503 upstream_timeout, not 500', async () => {
    applyEnv(withResend);
    const slow = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name.endsWith('billing_cancel_request')) throw new lib.UpstreamTimeoutError();
        return supabase.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    const post = async (body: Record<string, unknown>) => {
      const res = mockRes();
      await lib.handleBillingCancel(apiReq('POST', 'billing-cancel', { body }) as never, res as never, slow);
      return res;
    };
    for (const res of [
      await post({ email: 'slowdb@example.com', action: 'cancel', step: 'confirm' }),
      await post({ step: 'review', token: 'B'.repeat(43) }),
      await post({ step: 'execute', token: 'B'.repeat(43) }),
    ]) {
      assert.deepEqual([res.statusCode, res.body.error.code], [503, 'upstream_timeout']);
    }
    applyEnv({ RESEND_API_KEY: undefined, RESEND_FROM: undefined });
  });

  await check('a signed-in owner acts at once and sees the effective date; cancel keeps Premium to the period end', async () => {
    const k = await account('Cancel2');
    await deliver(eventText('customer.subscription.created', k.ids, 'cancel2'));
    const res = await cancel({ email: k.email, action: 'cancel', step: 'confirm' }, { token: k.token });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.details.length, 1);
    assert.equal(res.body.details[0].withdrawn, false);
    assert.equal(res.body.details[0].endsAt, new Date(stripe.subs.get(k.ids.sub).items.data[0].current_period_end * 1000).toISOString());
    assert.equal(await premium(k.userId), true);
    assert.equal((await summary(k.userId)).cancelAtPeriodEnd, true);
    // A signed-in account naming someone else's address is anonymous for it.
    const other = await account('Cancel3');
    const foreign = await cancel({ email: other.email, action: 'cancel', step: 'confirm' }, { token: k.token });
    assert.equal(foreign.body.details, undefined);
    assert.equal(foreign.body.confirmBy, 'sign-in');
    assert.equal(stripe.subs.get(other.ids.sub).cancel_at_period_end, false, 'and changes nothing');
  });

  await check('a withdrawal within 14 days refunds in full, revokes and takes back Premium’s coins; later it only cancels', async () => {
    const w = await account('Withdraw1');
    await deliver(eventText('customer.subscription.created', w.ids, 'withdraw1'));
    stripe.invoices.get(w.ids.inv).status_transitions.paid_at = nowSeconds() - 3 * DAY;
    const res = await cancel({ email: w.email, action: 'withdraw', step: 'confirm' }, { token: w.token });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.details.map((d: { withdrawn: boolean; refunded: boolean }) => [d.withdrawn, d.refunded]), [[true, true]]);
    const refund = stripe.refunds.find((r) => r.params.payment_intent === w.ids.pi);
    assert.equal(refund?.params.reason, 'requested_by_customer');
    assert.equal(refund?.key, `devshark-withdraw-inpay_${w.ids.inv.slice(3)}`);
    assert.equal(stripe.subs.get(w.ids.sub).status, 'canceled');
    assert.equal(await premium(w.userId), false);
    assert.equal((await providerGrant(w.userId))?.status, 'revoked');
    const revoked = db.benefitRevocations();
    if (revoked) assert.ok(revoked.includes(w.ids.sub), 'the revocation takes back what Premium paid (finding integrity-3)');

    const late = await account('Withdraw2');
    await deliver(eventText('customer.subscription.created', late.ids, 'withdraw2'));
    stripe.invoices.get(late.ids.inv).status_transitions.paid_at = nowSeconds() - 20 * DAY;
    const lateRes = await cancel({ email: late.email, action: 'withdraw', step: 'confirm' }, { token: late.token });
    assert.equal(lateRes.body.details[0].withdrawn, false);
    assert.equal(stripe.refunds.some((r) => r.params.payment_intent === late.ids.pi), false);
    assert.equal(stripe.subs.get(late.ids.sub).cancel_at_period_end, true);
    assert.equal(await premium(late.userId), true);
  });

  await check('the voluntary refund is taken once per account, whatever the subscription', async () => {
    // Withdraw on day 3, subscribe again at once, withdraw again: the second
    // subscription starts no new refund window (finding integrity-2).
    const r = await account('Again1');
    await deliver(eventText('customer.subscription.created', r.ids, 'again1'));
    stripe.invoices.get(r.ids.inv).status_transitions.paid_at = nowSeconds() - 3 * DAY;
    const first = await cancel({ email: r.email, action: 'withdraw', step: 'confirm' }, { token: r.token });
    assert.deepEqual(first.body.details.map((d: { refunded: boolean }) => d.refunded), [true]);
    const second = { ...idsFor('Again1b', r.userId), cus: r.ids.cus };
    stripe.seed(second, r.email);
    await deliver(eventText('customer.subscription.created', second, 'again1b'));
    assert.equal(await premium(r.userId), true, 'the new subscription opens Premium');
    const again = await cancel({ email: r.email, action: 'withdraw', step: 'confirm' }, { token: r.token });
    assert.deepEqual(again.body.details.map((d: { withdrawn: boolean; refunded: boolean }) => [d.withdrawn, d.refunded]), [[false, false]]);
    assert.equal(stripe.refunds.some((x) => x.params.payment_intent === second.pi), false, 'no second refund');
    assert.equal(stripe.subs.get(second.sub).cancel_at_period_end, true, 'it ends at the end of the paid period instead');
    assert.equal(await premium(r.userId), true);
    // A new account on the same address finds the refund used on its Stripe
    // customer, even with its first payment today.
    const reborn = newUserId();
    await db.addUser(reborn, 'again2@example.com');
    TOKENS.set('token-Again2', { id: reborn, email: 'again2@example.com' });
    const old = await account('Again2x');
    stripe.customers.get(old.ids.cus).email = 'again2@example.com';
    stripe.customers.get(old.ids.cus).metadata.devshark_voluntary_refund = 'sub_Earlier';
    const fresh = idsFor('Again2', reborn);
    stripe.seed(fresh, 'again2@example.com');
    await deliver(eventText('customer.subscription.created', fresh, 'again2'));
    const reRes = await cancel({ email: 'again2@example.com', action: 'withdraw', step: 'confirm' }, { token: 'token-Again2' });
    assert.equal(reRes.body.details.some((d: { refunded: boolean }) => d.refunded), false);
    assert.equal(stripe.refunds.some((x) => x.params.payment_intent === fresh.pi), false);
  });

  await check('the confirm step is limited to five an hour per address, and an owner’s request survives an outage', async () => {
    const ip = '10.99.0.1';
    for (let i = 0; i < 5; i++) {
      assert.equal((await cancel({ email: `limit${i}@example.com`, action: 'cancel', step: 'confirm' }, { ip })).statusCode, 200);
    }
    const limited = await cancel({ email: 'limit5@example.com', action: 'cancel', step: 'confirm' }, { ip });
    assert.equal(limited.statusCode, 429);
    const k = await account('Outage1');
    stripe.failNext.set('customers.list', stripeError(500, 'api_error'));
    const outage = await cancel({ email: k.email, action: 'cancel', step: 'confirm' }, { token: k.token });
    assert.equal(outage.statusCode, 502);
    assert.equal(outage.body.error.code, 'billing_unavailable');
  });

  await check('a refund, a dispute and a fraud warning take back what Premium paid; a failure there is retried', async () => {
    const d = await account('Benefit1');
    await deliver(eventText('customer.subscription.created', d.ids, 'benefit0'));
    assert.equal((await deliver(eventText('charge.dispute.created', d.ids, 'benefit1'))).statusCode, 200);
    const revoked = db.benefitRevocations();
    if (revoked) assert.equal(revoked.at(-1), d.ids.sub);
    // The routine failing hands the event back, so Stripe delivers it again.
    const f = await account('Benefit2');
    await deliver(eventText('customer.subscription.created', f.ids, 'benefit2'));
    const failing = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => name === 'revoke_premium_benefits'
        ? { data: null, error: { code: 'XX000', message: 'boom' } }
        : supabase.rpc(name, args),
    } as unknown as SupabaseClient;
    const raw = eventText('charge.dispute.created', f.ids, 'benefit3');
    const res = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, res as never, failing);
    assert.equal(res.statusCode, 500);
    assert.equal((await db.event('evt_1FixtureChargeDisputeCreated_benefit3'))?.processed, false);
    assert.equal((await deliver(raw)).statusCode, 200, 'the retry completes');
    // Before migration 041 there is nothing to take back, and the revocation stands.
    const m = await account('Benefit3');
    await deliver(eventText('customer.subscription.created', m.ids, 'benefit4'));
    const before041 = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => name === 'revoke_premium_benefits'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.revoke_premium_benefits(p_subject, p_subscription_id) in the schema cache' } }
        : supabase.rpc(name, args),
    } as unknown as SupabaseClient;
    const raw2 = eventText('charge.dispute.created', m.ids, 'benefit5');
    const res2 = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw2, sign(raw2)) as never, res2 as never, before041);
    assert.equal(res2.statusCode, 200);
    assert.equal((await providerGrant(m.userId))?.status, 'revoked');
  });

  /* Account deletion, settings, email --------------------------------------- */

  await check('deleting an account ends its subscriptions first', async () => {
    const d = await account('Delete1');
    await deliver(eventText('checkout.session.completed', d.ids, 'delete1'));
    assert.equal(await lib.endBillingForDeletedAccount(supabase, d.userId), true);
    assert.equal(stripe.subs.get(d.ids.sub).status, 'canceled');
    assert.equal(await lib.endBillingForDeletedAccount(supabase, newUserId()), true, 'no customer, nothing to end');
    const e = await account('Delete2');
    await deliver(eventText('checkout.session.completed', e.ids, 'delete2'));
    stripe.failNext.set('subscriptions.list', stripeError(500, 'api_error'));
    assert.equal(await lib.endBillingForDeletedAccount(supabase, e.userId), false, 'an outage stops the deletion');
    // One subscription gone at Stripe between the list and its cancel does
    // not leave the next one charging the deleted account.
    const f = await account('Delete5');
    await deliver(eventText('checkout.session.completed', f.ids, 'delete5'));
    const second = { ...f.ids, sub: `${f.ids.sub}b` };
    stripe.setSub(second);
    stripe.failNext.set('subscriptions.cancel', stripeError(404, 'resource_missing'));
    assert.equal(await lib.endBillingForDeletedAccount(supabase, f.userId), true);
    assert.equal(stripe.subs.get(second.sub).status, 'canceled', 'the other subscription is ended too');
  });

  await check('deleting an account expires its open Checkout, so nothing can be paid for it later', async () => {
    const userId = newUserId();
    await db.addUser(userId, 'delete3@example.com');
    TOKENS.set('token-Delete3', { id: userId, email: 'delete3@example.com' });
    const opened = await checkout('token-Delete3', { plan: 'monthly' });
    assert.equal(opened.statusCode, 200);
    const sessionId = opened.body.session_id;
    assert.equal(await lib.endBillingForDeletedAccount(supabase, userId), true);
    assert.equal(stripe.sessions.get(sessionId).status, 'expired', 'the Checkout opened before the deletion is closed (finding BILL-3)');
    // An outage while listing the sessions stops the deletion.
    const other = newUserId();
    await db.addUser(other, 'delete4@example.com');
    TOKENS.set('token-Delete4', { id: other, email: 'delete4@example.com' });
    assert.equal((await checkout('token-Delete4', { plan: 'annual' })).statusCode, 200);
    stripe.failNext.set('checkout.sessions.list', stripeError(500, 'api_error'));
    assert.equal(await lib.endBillingForDeletedAccount(supabase, other), false);
  });

  await check('a Checkout paid after the account was deleted ends its subscription and records nothing for the id', async () => {
    // The account opened Checkout, was deleted, and the buyer paid anyway: it
    // is no longer in Auth (finding BILL-3).
    const gone = idsFor('Gone1', newUserId());
    stripe.seed(gone, 'gone1@example.com');
    const res = await deliver(eventText('checkout.session.completed', gone, 'gone1'));
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.outcome, res.body.reason], ['recorded', 'unknown_user']);
    assert.equal(stripe.subs.get(gone.sub).status, 'canceled', 'the subscription is ended');
    assert.deepEqual(stripe.cancels.filter((c) => c.id === gone.sub).map((c) => c.params), [{ invoice_now: false, prorate: false }],
      'at once, without a final invoice or a proration');
    assert.equal((await supabase.rpc('billing_customer_owner', { p_provider_customer_id: gone.cus })).data, null, 'no customer link for the erased id');
    assert.equal(await db.consent(gone.cs), null, 'no consent row for the erased id');
    assert.deepEqual(await db.grants(gone.user), []);
    for (const type of ['customer.subscription.created', 'invoice.paid'] as const) {
      const later = await deliver(eventText(type, gone, `gone1${type.replace(/\W/g, '')}`));
      assert.deepEqual([later.statusCode, later.body.reason], [200, 'unknown_user'], type);
    }
    assert.equal(stripe.cancels.filter((c) => c.id === gone.sub).length, 1, 'cancelled once');

    // An account id alone, without devShark's marker, may be another
    // product's: it is recorded and left running.
    const legacy = idsFor('Gone2', newUserId());
    stripe.seed(legacy, 'gone2@example.com', { metadataUser: legacy.user });
    const unmarked = await deliver(eventText('customer.subscription.created', legacy, 'gone2'));
    assert.equal(unmarked.body.reason, 'unknown_user');
    assert.equal(stripe.subs.get(legacy.sub).status, 'active');

    // An Auth outage or a rejected key is not a deleted account.
    const kept = await account('Gone3');
    const authDown = {
      ...supabase,
      auth: { admin: { getUserById: async () => ({ data: { user: null }, error: { message: 'Invalid API key', status: 401 } }) } },
    } as unknown as SupabaseClient;
    const raw = eventText('customer.subscription.created', kept.ids, 'gone3');
    const down = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, down as never, authDown);
    assert.equal(down.statusCode, 200);
    assert.equal(stripe.subs.get(kept.ids.sub).status, 'active', 'a subscription is never ended on an Auth error');
  });

  await check('a write that races the account deletion is recorded, not retried for three days', async () => {
    // Migration 053 refuses a billing write for an account Auth no longer
    // has; the webhook records that like any unknown account (finding PROF-4).
    const a = await account('Race1');
    const racing = {
      ...supabase,
      rpc: async (name: string, args: Record<string, unknown>) => ['link_billing_customer', 'upsert_provider_entitlement'].includes(name)
        ? { data: null, error: { code: 'P0001', message: 'unknown_account' } }
        : supabase.rpc(name, args),
    } as unknown as SupabaseClient;
    const raw = eventText('customer.subscription.deleted', a.ids, 'race1');
    const res = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, res as never, racing);
    assert.equal(res.statusCode, 200);
    assert.deepEqual([res.body.outcome, res.body.reason], ['recorded', 'unknown_user']);
    assert.match((await db.event('evt_1FixtureSubscriptionDeleted_race1'))?.error ?? '', /^unknown_user/);
  });

  await check('before migration 039 billing names the migration, and account deletion goes ahead', async () => {
    // PostgREST's answer for every 039 routine on a database that lacks them.
    const before039 = {
      rpc: async (name: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name} in the schema cache` } }),
      auth: { admin: { getUserById: async (id: string) => ({ data: { user: { id, email: 'before039@example.com' } }, error: null }) } },
    } as unknown as SupabaseClient;
    const userId = newUserId();
    TOKENS.set('token-Before039', { id: userId, email: 'before039@example.com' });
    const res = mockRes();
    await lib.handleBillingCheckout(apiReq('POST', 'billing-checkout', { token: 'token-Before039', body: { plan: 'monthly', consent: true } }) as never, res as never, before039);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'migration_required');
    const raw = eventText('customer.subscription.created', idsFor('Before039', userId), 'before039');
    const hook = mockRes();
    await lib.handleBillingWebhook(webhookReq(raw, sign(raw)) as never, hook as never, before039);
    assert.equal(hook.statusCode, 503);
    assert.equal(hook.body.error.code, 'migration_required');
    const calls = stripe.calls;
    assert.equal(await lib.endBillingForDeletedAccount(before039, userId), true, 'no billing tables, nothing to end');
    assert.equal(stripe.calls, calls, 'and nothing reaches Stripe');
  });

  await check('settings expose the two switches and the seller, and the origin is never taken from a guess', async () => {
    assert.deepEqual(lib.publicBillingSettings({}), { enabled: false, cancellable: false, cancelByEmail: false, seller: null, launchOffer: false });
    assert.deepEqual(lib.publicBillingSettings({ ...BASE_ENV }), { enabled: true, cancellable: true, cancelByEmail: false, seller: 'link', launchOffer: false });
    assert.deepEqual(lib.publicBillingSettings({ ...BASE_ENV, BILLING_ENABLED: 'false' }), { enabled: false, cancellable: true, cancelByEmail: false, seller: 'link', launchOffer: false });
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV, RESEND_API_KEY: 're_x' }).cancelByEmail, true, 'the page can email its link');
    assert.equal(lib.publicBillingSettings({ RESEND_API_KEY: 're_x' }).cancelByEmail, false, 'not without Stripe');
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV, STRIPE_MANAGED_PAYMENTS: 'false' }).seller, 'trader', 'plain Stripe: the trader sells');
    assert.equal(lib.publicBillingSettings({ ...BASE_ENV, STRIPE_MANAGED_PAYMENTS: undefined }).seller, null, 'unsaid: the Terms name no seller');
    assert.equal(lib.parseOrigin('javascript:alert(1)'), lib.DEFAULT_PUBLIC_ORIGIN);
    assert.equal(lib.parseOrigin('http://evil.example'), lib.DEFAULT_PUBLIC_ORIGIN);
    assert.equal(lib.parseOrigin('http://localhost:5173/path'), 'http://localhost:5173');
    assert.equal(lib.billingConfig({ ...BASE_ENV, STRIPE_MANAGED_PAYMENTS: 'yes' }).checkoutEnabled, false);
  });

  await check('the confirmation email names the date and goes to the subscription address', async () => {
    const effect = { subscriptionId: 'sub_x', customerEmail: 'payer@example.com', withdrawn: false, refunded: false, endsAt: '2026-11-12T10:00:00.000Z' };
    const mail = lib.cancellationEmail(effect, '2026-09-25T14:32:00.000Z', 'https://devshark.app');
    assert.match(mail.text, /We received your cancellation on 25 September 2026 at 14:32 UTC\./);
    assert.match(mail.text, /Premium stays open until 12 November 2026\. You will not be charged again\./);
    assert.match(lib.cancellationEmail({ ...effect, withdrawn: true, refunded: true }, '2026-09-25T14:32:00.000Z', 'https://devshark.app').text, /refunded your payment in full/);
    const sent: Array<{ url: string; body: any }> = [];
    const fakeFetch = (async (url: string, init: { body: string }) => { sent.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; }) as never;
    const config = lib.billingConfig({ ...BASE_ENV, RESEND_API_KEY: 're_test' });
    assert.equal(await lib.sendCancellationEmail(config, effect, '2026-09-25T14:32:00.000Z', fakeFetch), true);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(sent[0].body.to, ['payer@example.com']);
    // The shared sender (lib/email/resend.ts): noreply@ sends, replies go to support@ (owner, 12 November 2026).
    assert.equal(sent[0].body.from, 'devShark <noreply@devshark.app>');
    assert.equal(sent[0].body.reply_to, 'support@devshark.app');
    assert.equal(await lib.sendCancellationEmail(lib.billingConfig({ ...BASE_ENV }), effect, '2026-09-25T14:32:00.000Z', fakeFetch), false, 'no key, no email');
    const link = lib.cancellationLinkEmail('withdraw', 'T'.repeat(43), '2026-09-25T14:32:00.000Z', 'https://devshark.app');
    assert.equal(link.subject, 'Confirm your devShark Premium withdrawal');
    assert.match(link.text, /On 25 September 2026 at 14:32 UTC someone asked on devshark\.app to withdraw from the devShark Premium subscription of this email address\./);
    assert.match(link.text, /https:\/\/devshark\.app\/premium\/cancel#confirm=T{43}/, 'the token rides after #, never in a request line');
    assert.match(link.text, /Nothing changes until you confirm\./);
  });

  lib.setStripeForTests(null);
  globalThis.fetch = realFetch;
  return checks;
}

async function main() {
  const auth = await startAuthStandIn();
  try {
    const lib = await loadLib();
    const checks = await runBillingSuite(memoryBackend(), lib);
    console.log(`Billing contract passed (${checks} checks): signatures over the raw body, nine event types, duplicates, order, unknown accounts, retries, refunds, disputes, fraud warnings, manual grants, checkout, the success lookup, the portal, the public cancel page, account deletion and the switches.`);
  } finally {
    auth.close();
  }
}

if (!process.env.BILLING_SUITE_EXTERNAL) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
