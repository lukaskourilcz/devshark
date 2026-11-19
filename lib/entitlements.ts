/** The entitlement routes: what the signed-in account holds, and the admin
 * grants that open Premium by hand.
 *
 *   GET  /api/user?op=entitlement     → the caller's tier and plan line
 *   GET  /api/admin?op=entitlements   → recent grants, or one account's
 *   POST /api/admin?op=entitlements   → { action: 'grant' | 'revoke', ... }
 *
 * Manual grants are how Premium is tested before billing exists and how the
 * owner opens it for someone by hand afterwards. They live beside provider
 * grants in `entitlement_grants` and the billing webhook never touches them.
 * Every write goes through a service-role routine from migration 039. */

import type { VercelRequest, VercelResponse } from './vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger, isRpcMissing, jsonError, requireAuthSub, withTimeout } from './http';
import { authUndecided } from './auth';
import type { EntitlementResponse, EntitlementSource } from '../shared/tiers';

const logEvent = createLogger('entitlements');

const FREE: EntitlementResponse = {
  tier: 'free',
  source: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  inGrace: false,
  validUntil: null,
};

const SOURCES: readonly EntitlementSource[] = ['provider', 'manual', 'promo'];
const isoOrNull = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** The summary routine's JSON, read defensively into the wire shape. */
export function toEntitlementResponse(raw: unknown): EntitlementResponse {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const billing = { billingAccount: row.billingAccount === true, subscriptionLive: row.subscriptionLive === true };
  if (row.premium !== true) return { ...FREE, ...billing };
  const source = SOURCES.includes(row.source as EntitlementSource) ? (row.source as EntitlementSource) : null;
  return {
    tier: 'premium',
    source,
    currentPeriodEnd: isoOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd === true,
    inGrace: row.inGrace === true,
    validUntil: isoOrNull(row.validUntil),
    ...billing,
  };
}

/* ── GET /api/user?op=entitlement ──────────────────────────────────────── */

export async function handleEntitlement(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  const { data, error } = await withTimeout(supabase.rpc('entitlement_summary', { p_user: userId }));
  res.setHeader('Cache-Control', 'private, no-store');
  if (error) {
    // Before migration 039 nobody can hold a grant, so every account is free.
    if (isRpcMissing(error)) return res.json(FREE);
    // The plan is unknown, not free: a 503 the client retries, with the copy
    // the tier gate uses for the same failure (lib/access.ts).
    logEvent({ status: 503, kind: 'entitlement', reason: 'db_error' });
    return jsonError(res, 503, 'entitlement_unavailable', 'Could not check your plan. Try again in a moment.');
  }
  const body = toEntitlementResponse(data);
  logEvent({ status: 200, kind: 'entitlement', tier: body.tier, source: body.source });
  return res.json(body);
}

/* ── /api/admin?op=entitlements ────────────────────────────────────────── */

const USER_ID = /^[A-Za-z0-9-]{1,128}$/;
const GRANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 500;
const MAX_GRANT_DAYS = 5 * 366;

const GRANT_FIELDS =
  'id,user_id,source,plan,status,provider_subscription_id,current_period_end,cancel_at_period_end,valid_until,note,created_at,updated_at';

interface GrantRow {
  id: string;
  user_id: string;
  source: EntitlementSource;
  plan: string;
  status: string;
  provider_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  valid_until: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminGrant {
  id: string;
  userId: string;
  source: EntitlementSource;
  status: string;
  subscriptionId: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  validUntil: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const toAdminGrant = (row: GrantRow): AdminGrant => ({
  id: row.id,
  userId: row.user_id,
  source: row.source,
  status: row.status,
  subscriptionId: row.provider_subscription_id,
  currentPeriodEnd: row.current_period_end,
  cancelAtPeriodEnd: row.cancel_at_period_end === true,
  validUntil: row.valid_until,
  note: row.note,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** A `validUntil` from the admin form: absent or null means open-ended; a
 * value must be a date in the future and at most five years away. */
export function parseValidUntil(value: unknown, now = Date.now()): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || value.length > 40) return { ok: false };
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= now || time > now + MAX_GRANT_DAYS * 86_400_000) return { ok: false };
  return { ok: true, value: new Date(time).toISOString() };
}

/** A Supabase Auth account id, as supabase-js checks it before it asks Auth. */
const AUTH_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Whether the account exists: `unknown` when Supabase Auth did not answer
 * (a timeout, no connection, a 5xx or its own rate limit). An unconfigured
 * admin API (local development) cannot tell either, and reads as `exists`, so
 * it does not block a grant.
 *
 * An id that is not a lowercase UUID names no account. supabase-js throws for
 * one before asking Auth, and a catch meant for an Auth that does not answer
 * read that as "exists": a mistyped id got a Premium grant nobody holds. */
async function lookupAccount(supabase: SupabaseClient, userId: string): Promise<'exists' | 'missing' | 'unknown'> {
  if (!AUTH_USER_ID.test(userId)) return 'missing';
  try {
    const { data, error } = await withTimeout(supabase.auth.admin.getUserById(userId));
    if (error) {
      if (/not.?found|invalid/i.test(error.message ?? '')) return 'missing';
      return authUndecided(error) ? 'unknown' : 'exists';
    }
    return data?.user ? 'exists' : 'missing';
  } catch {
    return 'unknown';
  }
}

/** The billing webhook's question before it mirrors a subscription
 * (`lib/billing/sync.ts`): an Auth that does not answer must not drop a paid
 * subscription, so only a definite "no such account" is false. The admin grant
 * asks `lookupAccount` and waits for Auth instead. */
export async function accountExists(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await lookupAccount(supabase, userId)) !== 'missing';
}

export async function handleAdminEntitlements(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Admin backend (Supabase) is not configured');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    if (userId && !USER_ID.test(userId)) return jsonError(res, 400, 'bad_request', 'userId is not a valid account id');
    let query = supabase.from('entitlement_grants').select(GRANT_FIELDS).order('updated_at', { ascending: false }).limit(200);
    if (userId) query = query.eq('user_id', userId);
    const [rows, premium] = await Promise.all([
      withTimeout(query),
      userId ? withTimeout(supabase.rpc('is_premium', { p_user: userId })) : Promise.resolve(null),
    ]);
    if (rows.error) {
      if (isRpcMissing(rows.error) || /entitlement_grants/.test(rows.error.message ?? '')) {
        return jsonError(res, 503, 'migration_required', 'Entitlement migration 039 is not installed');
      }
      return jsonError(res, 500, 'db_error', 'Could not load grants');
    }
    // An account's plan that could not be read is not "not Premium": the
    // owner would grant Premium to someone who holds it, or tell them they do
    // not.
    if (premium?.error) {
      if (isRpcMissing(premium.error)) return jsonError(res, 503, 'migration_required', 'Entitlement migration 039 is not installed');
      return jsonError(res, 503, 'entitlement_unavailable', "Could not check this account's plan. Try again in a moment.");
    }
    return res.json({
      grants: ((rows.data ?? []) as GrantRow[]).map(toAdminGrant),
      ...(userId ? { userId, premium: premium?.data === true } : {}),
    });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as { action?: unknown; userId?: unknown; validUntil?: unknown; note?: unknown; grantId?: unknown };
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!USER_ID.test(userId)) return jsonError(res, 400, 'bad_request', 'userId is required');
    const note = typeof body.note === 'string' ? body.note.trim() : '';

    if (body.action === 'grant') {
      if (note.length === 0 || note.length > MAX_NOTE) {
        return jsonError(res, 400, 'bad_request', 'A note of up to 500 characters is required: who granted it and why');
      }
      const validUntil = parseValidUntil(body.validUntil);
      if (!validUntil.ok) return jsonError(res, 400, 'bad_request', 'validUntil must be a future date within five years, or empty');
      // An entitlement grant has no foreign key to the account, so a grant
      // made while Auth cannot answer could open Premium for an id nobody holds.
      const account = await lookupAccount(supabase, userId);
      if (account === 'missing') return jsonError(res, 404, 'not_found', 'No account with that id');
      if (account === 'unknown') return jsonError(res, 503, 'auth_unavailable', 'Could not check that account. Try again in a moment.');
      const granted = await withTimeout(supabase.rpc('grant_manual_entitlement', {
        p_user_id: userId,
        p_valid_until: validUntil.value,
        p_note: note,
      }));
      if (granted.error) {
        if (isRpcMissing(granted.error)) return jsonError(res, 503, 'migration_required', 'Entitlement migration 039 is not installed');
        return jsonError(res, 500, 'db_error', 'Could not record the grant');
      }
      logEvent({ status: 200, kind: 'grant', openEnded: validUntil.value === null });
      return res.json({ ok: true, grantId: granted.data, userId, validUntil: validUntil.value });
    }

    if (body.action === 'revoke') {
      const grantId = typeof body.grantId === 'string' && body.grantId ? body.grantId : null;
      if (grantId !== null && !GRANT_ID.test(grantId)) return jsonError(res, 400, 'bad_request', 'grantId is not a valid grant id');
      if (note.length > MAX_NOTE) return jsonError(res, 400, 'bad_request', 'The note is limited to 500 characters');
      const revoked = await withTimeout(supabase.rpc('revoke_manual_entitlement', {
        p_user_id: userId,
        p_grant_id: grantId,
        p_note: note || null,
      }));
      if (revoked.error) {
        if (isRpcMissing(revoked.error)) return jsonError(res, 503, 'migration_required', 'Entitlement migration 039 is not installed');
        return jsonError(res, 500, 'db_error', 'Could not revoke the grant');
      }
      logEvent({ status: 200, kind: 'revoke', revoked: Number(revoked.data ?? 0) });
      return res.json({ ok: true, userId, revoked: Number(revoked.data ?? 0) });
    }

    return jsonError(res, 400, 'bad_request', "action must be 'grant' or 'revoke'");
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}
