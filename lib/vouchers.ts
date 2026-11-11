/** Premium vouchers (migration 045): the learner's redemption and the owner's
 * codes.
 *
 *   POST /api/user?op=voucher     → { code }: open Premium for the caller
 *   GET  /api/admin?op=vouchers   → the owner's vouchers, newest first
 *   POST /api/admin?op=vouchers   → { action: 'create' | 'revoke', ... }
 *
 * Billing stays off until the owner's Stripe account exists, so a voucher is
 * how Premium opens for someone in the meantime, and afterwards for a gift or
 * a campaign. A redemption writes a promo grant through
 * `redeem_premium_voucher`; `is_premium` counts it like any other grant, so
 * nothing here decides what Premium opens (`shared/tiers.ts` does).
 *
 * A code can be guessed, so the redemption is rate-limited per account and per
 * address, and an unknown, expired, used-up or revoked code all get the same
 * answer. The plain code exists only in the request that carries it and, for
 * the owner, in the one answer that creates it: the database keeps its
 * SHA-256, and no log line names the code, its hash or its hint. */

import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { createLogger, isRpcMissing, jsonError, requireAuthResult, withTimeout } from './http';
import { enforceRateLimit, RATE_LIMITS } from './rate-limit';
import { adminSubject } from './admin-auth';
import { parseValidUntil } from './entitlements';
import {
  CUSTOM_VOUCHER_CODE,
  VOUCHER_ALPHABET,
  VOUCHER_ALREADY_REDEEMED,
  VOUCHER_CODE_LENGTH,
  VOUCHER_INVALID,
  VOUCHER_UNAVAILABLE,
  formatVoucherCode,
  normalizeVoucherCode,
  voucherHint,
  voucherState,
  type AdminVoucher,
  type CreatedVoucher,
  type VoucherRedeemResponse,
} from '../shared/vouchers';

const logEvent = createLogger('vouchers');

/** SHA-256 of a normalised code, in hex: the only form the database keeps. */
export const voucherHash = (code: string): string => createHash('sha256').update(code, 'utf8').digest('hex');

/** Twelve characters of Crockford base32 from the system's random source:
 * 60 bits. 256 is a multiple of 32, so masking a byte keeps every character
 * equally likely. */
export function generateVoucherCode(): string {
  const bytes = randomBytes(VOUCHER_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += VOUCHER_ALPHABET[byte & 31];
  return code;
}

/* ── POST /api/user?op=voucher ─────────────────────────────────────────── */

const invalidCode = (res: VercelResponse) =>
  jsonError(res, 400, VOUCHER_INVALID, 'This code does not open Premium. Check it and try again.');

export async function handleVoucherRedeem(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  res.setHeader('Cache-Control', 'private, no-store');
  // Every attempt counts, a malformed one and a success included, and it
  // counts before anything is looked up.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.voucherRedeem, `user:${auth.sub}`))) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.voucherRedeemAddress))) return;

  const body = (req.body || {}) as { code?: unknown };
  if (typeof body.code !== 'string') return jsonError(res, 400, 'bad_request', 'code is required');
  const code = normalizeVoucherCode(body.code);
  // A code that cannot exist gets the answer an unknown one gets.
  if (!code) {
    logEvent({ status: 400, kind: 'voucher_redeem', outcome: 'invalid' });
    return invalidCode(res);
  }

  const redeemed = await withTimeout(
    supabase.rpc('redeem_premium_voucher', { p_user_id: auth.sub, p_code_hash: voucherHash(code) }),
  ).catch(() => null);
  if (!redeemed) return jsonError(res, 504, 'upstream_timeout', 'The voucher could not be checked. Try again in a moment.');
  if (redeemed.error) {
    if (isRpcMissing(redeemed.error)) {
      logEvent({ status: 503, kind: 'voucher_redeem', reason: 'migration_missing' });
      return jsonError(res, 503, VOUCHER_UNAVAILABLE, 'Vouchers are not available yet. Try again later.');
    }
    logEvent({ status: 500, kind: 'voucher_redeem', reason: 'db_error' });
    return jsonError(res, 500, 'db_error', 'The voucher could not be checked. Try again in a moment.');
  }

  const answer = (redeemed.data && typeof redeemed.data === 'object' ? redeemed.data : {}) as { status?: unknown; validUntil?: unknown };
  if (answer.status === 'redeemed') {
    const validUntil = typeof answer.validUntil === 'string' && Number.isFinite(Date.parse(answer.validUntil))
      ? new Date(answer.validUntil).toISOString()
      : null;
    logEvent({ status: 200, kind: 'voucher_redeem', outcome: 'redeemed', openEnded: validUntil === null });
    const result: VoucherRedeemResponse = { status: 'redeemed', validUntil };
    return res.json(result);
  }
  if (answer.status === 'already') {
    logEvent({ status: 409, kind: 'voucher_redeem', outcome: 'already' });
    return jsonError(res, 409, VOUCHER_ALREADY_REDEEMED, 'You already redeemed this voucher.');
  }
  logEvent({ status: 400, kind: 'voucher_redeem', outcome: 'invalid' });
  return invalidCode(res);
}

/* ── /api/admin?op=vouchers ────────────────────────────────────────────── */

const VOUCHER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 500;
const MAX_PREMIUM_DAYS = 5 * 366;
const MAX_REDEMPTIONS = 10_000;
/** How many fresh codes to try when one is taken already. At 60 bits a second
 * try never happens in practice; the bound keeps a fault from looping. */
const CREATE_ATTEMPTS = 3;

const isoOrNull = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** A voucher as the 045 routines answer it, read defensively. */
export function toAdminVoucher(raw: unknown, now: number = Date.now()): AdminVoucher | null {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.hint !== 'string') return null;
  const voucher = {
    id: row.id,
    hint: row.hint,
    note: typeof row.note === 'string' ? row.note : '',
    premiumDays: typeof row.premiumDays === 'number' ? row.premiumDays : null,
    maxRedemptions: Number(row.maxRedemptions ?? 0),
    redeemedCount: Number(row.redeemedCount ?? 0),
    redeemableUntil: isoOrNull(row.redeemableUntil),
    active: row.active === true,
    createdAt: isoOrNull(row.createdAt) ?? new Date(0).toISOString(),
    revokedAt: isoOrNull(row.revokedAt),
  };
  return { ...voucher, state: voucherState(voucher, now) };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** The create form, checked the way the routine checks it again. */
export function parseVoucherForm(body: Record<string, unknown>, now: number = Date.now()): Parsed<{
  note: string;
  premiumDays: number | null;
  maxRedemptions: number;
  redeemableUntil: string | null;
  code: string | null;
}> {
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length === 0 || note.length > MAX_NOTE) {
    return { ok: false, message: 'A note of up to 500 characters is required: who the code is for and why' };
  }
  // Postgres text cannot hold U+0000: the routine call answered 500.
  if (note.includes('\u0000')) return { ok: false, message: 'The note cannot contain a null character' };
  const days = body.premiumDays;
  if (days !== undefined && days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= MAX_PREMIUM_DAYS)) {
    return { ok: false, message: 'premiumDays is a whole number of days up to five years, or null for no end' };
  }
  const uses = body.maxRedemptions ?? 1;
  if (!(Number.isInteger(uses) && (uses as number) >= 1 && (uses as number) <= MAX_REDEMPTIONS)) {
    return { ok: false, message: 'maxRedemptions is a whole number from 1 to 10,000' };
  }
  const until = parseValidUntil(body.redeemableUntil, now);
  if (!until.ok) return { ok: false, message: 'redeemableUntil must be a future date within five years, or empty' };
  let code: string | null = null;
  if (body.code !== undefined && body.code !== null && body.code !== '') {
    code = normalizeVoucherCode(body.code);
    if (!code) {
      return { ok: false, message: `A custom code is ${CUSTOM_VOUCHER_CODE.min} to ${CUSTOM_VOUCHER_CODE.max} letters and digits` };
    }
  }
  return {
    ok: true,
    value: { note, premiumDays: (days as number | null | undefined) ?? null, maxRedemptions: uses as number, redeemableUntil: until.value, code },
  };
}

const migrationRequired = (res: VercelResponse) =>
  jsonError(res, 503, 'migration_required', 'Voucher migration 045 is not installed');

/** Who made an admin write, for its log line: the verified admin account, or
 * the legacy password, which names nobody (api/admin logs the same `by`). */
const adminActor = (req: VercelRequest): string => adminSubject(req) ?? 'legacy-password';

export async function handleAdminVouchers(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Admin backend (Supabase) is not configured');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const listed = await withTimeout(supabase.rpc('list_premium_vouchers', { p_limit: 200 }));
    if (listed.error) {
      if (isRpcMissing(listed.error)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not load the vouchers');
    }
    const now = Date.now();
    const vouchers = (Array.isArray(listed.data) ? listed.data : [])
      .map((row) => toAdminVoucher(row, now))
      .filter((voucher): voucher is AdminVoucher => voucher !== null);
    return res.json({ vouchers });
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Record<string, unknown>;

    if (body.action === 'create') {
      const form = parseVoucherForm(body);
      if (!form.ok) return jsonError(res, 400, 'bad_request', form.message);
      const { note, premiumDays, maxRedemptions, redeemableUntil, code: custom } = form.value;
      for (let attempt = 0; attempt < (custom ? 1 : CREATE_ATTEMPTS); attempt++) {
        const code = custom ?? generateVoucherCode();
        const created = await withTimeout(supabase.rpc('create_premium_voucher', {
          p_code_hash: voucherHash(code),
          p_code_hint: voucherHint(code),
          p_note: note,
          p_premium_days: premiumDays,
          p_max_redemptions: maxRedemptions,
          p_redeemable_until: redeemableUntil,
          p_created_by: adminSubject(req),
        }));
        if (created.error) {
          if (isRpcMissing(created.error)) return migrationRequired(res);
          // The form checked the end date against this server's clock; the
          // database checks it again against its own, and a date a moment
          // ahead can pass the first and fail the second.
          if (/premium_voucher_in_past/.test(created.error.message ?? '')) {
            return jsonError(res, 400, 'bad_request', 'redeemableUntil must be a future date within five years, or empty');
          }
          logEvent({ status: 500, kind: 'voucher_create', reason: 'db_error', by: adminActor(req) });
          return jsonError(res, 500, 'db_error', 'Could not create the voucher');
        }
        if (created.data === null) continue; // the code exists already
        const voucher = toAdminVoucher(created.data);
        if (!voucher) return jsonError(res, 500, 'db_error', 'Could not create the voucher');
        logEvent({ status: 200, kind: 'voucher_create', by: adminActor(req), voucherId: voucher.id, custom: custom !== null, openEnded: premiumDays === null, uses: maxRedemptions });
        const answer: CreatedVoucher = { voucher, code: formatVoucherCode(code) };
        return res.json(answer);
      }
      if (custom) return jsonError(res, 409, 'voucher_exists', 'That code is in use already. Choose another one.');
      logEvent({ status: 500, kind: 'voucher_create', reason: 'no_free_code', by: adminActor(req) });
      return jsonError(res, 500, 'db_error', 'Could not create the voucher');
    }

    if (body.action === 'limit') {
      const voucherId = typeof body.voucherId === 'string' ? body.voucherId : '';
      if (!VOUCHER_ID.test(voucherId)) return jsonError(res, 400, 'bad_request', 'voucherId is not a valid voucher id');
      const maximum = body.maxRedemptions;
      if (!Number.isInteger(maximum) || (maximum as number) < 1 || (maximum as number) > MAX_REDEMPTIONS) {
        return jsonError(res, 400, 'bad_request', 'Maximum uses must be a whole number from 1 to 10,000');
      }
      // A single UPDATE holds the same row lock as redemption. The existing
      // CHECK keeps the new cap at least redeemed_count, including a racing
      // redemption; no count is reset and existing grants never change.
      const changed = await withTimeout(supabase.from('premium_vouchers')
        .update({ max_redemptions: maximum }).eq('id', voucherId).select('id').maybeSingle());
      if (changed.error) return jsonError(res, changed.error.code === '23514' ? 400 : 503,
        changed.error.code === '23514' ? 'invalid_limit' : 'voucher_unavailable',
        changed.error.code === '23514' ? 'The limit cannot be lower than the number of accounts that already redeemed the voucher.' : 'The limit could not be saved. Try again.');
      if (!changed.data) return jsonError(res, 404, 'not_found', 'No voucher with that id');
      logEvent({ status: 200, kind: 'voucher_limit', by: adminActor(req), voucherId, maximum });
      return res.json({ ok: true });
    }

    if (body.action === 'revoke') {
      const voucherId = typeof body.voucherId === 'string' ? body.voucherId : '';
      if (!VOUCHER_ID.test(voucherId)) return jsonError(res, 400, 'bad_request', 'voucherId is not a valid voucher id');
      const revoked = await withTimeout(supabase.rpc('revoke_premium_voucher', { p_voucher_id: voucherId }));
      if (revoked.error) {
        if (isRpcMissing(revoked.error)) return migrationRequired(res);
        return jsonError(res, 500, 'db_error', 'Could not revoke the voucher');
      }
      const voucher = revoked.data === null ? null : toAdminVoucher(revoked.data);
      if (!voucher) return jsonError(res, 404, 'not_found', 'No voucher with that id');
      logEvent({ status: 200, kind: 'voucher_revoke', by: adminActor(req), voucherId: voucher.id });
      return res.json({ voucher });
    }

    return jsonError(res, 400, 'bad_request', "action must be 'create', 'limit' or 'revoke'");
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}
