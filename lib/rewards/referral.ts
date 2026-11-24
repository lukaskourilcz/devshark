/** Invitations: the referral grant (step D8b, #228, migration 042).
 *
 * Mounted as `op=referral` on `api/user/[op].ts`, so the twelve-function
 * budget is unchanged. An account's invite link is `/?ref=<code>`. A friend who
 * signs up through it and passes a first Learn level earns coins for both
 * accounts, once, and the inviter is paid for at most `referralCap` friends.
 *
 * What the browser can do, and what it cannot:
 *
 *   - GET reads the caller's own code and counts. It never returns an account
 *     id: an inviter learns how many friends joined, never who.
 *   - POST offers the code the browser kept from the invite link. The server
 *     binds it only while the calling account is new, judged by the creation
 *     time Supabase Auth reported for the verified token, and only once. A
 *     code offered later, or a second code, changes nothing.
 *   - No request names an amount or asks for a credit. `credit_referral` runs
 *     after a Learn level the server graded, and on the wallet read, and it
 *     reads the friend's verified progress itself. */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { createLogger, jsonError, requireAuthResult, withTimeout } from '../http';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';
import { getGameSettings } from '../settings-store';
import { deploymentSubjectIds } from '../product-scope';
import { routineMissing } from './coins';
import { isReferralCode, REFERRAL_SIGNUP_WINDOW_HOURS } from '../../shared/rewards';

const logEvent = createLogger('referral');

/** What `record_referral` answers. `off` is the server's own answer when the
 * owner has set the grant to 0. */
type ReferralClaimStatus = 'recorded' | 'already' | 'unknown' | 'self' | 'closed' | 'off';
/** What `credit_referral` answers. */
export type ReferralCreditStatus = 'none' | 'waiting' | 'already' | 'credited' | 'capped' | 'orphaned' | 'off';

const CLAIM_STATUSES: readonly ReferralClaimStatus[] = ['recorded', 'already', 'unknown', 'self', 'closed', 'off'];

/** The subject the ledger lines belong to, as the wallet reads it. */
const referralSubject = (): string => deploymentSubjectIds()[0] ?? 'webdev';

/** The account's creation time as Supabase Auth reported it for the verified
 * token. Null when the auth result carries none, which binds nothing. */
export function accountCreatedAt(payload: Record<string, unknown>): string | null {
  const raw = payload.created_at;
  if (typeof raw !== 'string') return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * Settle the caller's own invitation, if there is one: both sides paid once,
 * after a passed Learn level. Idempotent, so every caller may run it. Returns
 * null when migration 042 is missing or the database could not answer; a
 * credit never fails the learning it rides on.
 */
export async function creditReferral(
  supabase: SupabaseClient,
  userId: string,
  subject: string = referralSubject(),
): Promise<ReferralCreditStatus | null> {
  const coins = (await getGameSettings()).coins;
  if (coins.referralGrant <= 0) return 'off';
  const credited = await withTimeout(
    supabase.rpc('credit_referral', {
      p_invitee: userId,
      p_subject: subject,
      p_amount: coins.referralGrant,
      p_cap: coins.referralCap,
    }),
  ).catch(() => null);
  if (!credited || credited.error) {
    if (!routineMissing(credited?.error)) {
      logEvent({ status: 500, kind: 'referral_credit_failed', reason: credited?.error?.code ?? 'timeout' });
    }
    return null;
  }
  const status = String(credited.data) as ReferralCreditStatus;
  if (status === 'credited' || status === 'capped' || status === 'orphaned') {
    logEvent({ status: 200, kind: 'referral_credited', outcome: status });
  }
  return status;
}

/* ── GET/POST ?op=referral ─────────────────────────────────────────────── */

export async function handleReferral(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  const userId = auth.sub;
  const coins = (await getGameSettings()).coins;

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'private, no-store');
    // The owner turned invitations off: the screen shows no invite link.
    if (coins.referralGrant <= 0) return res.json({ enabled: false });
    const summary = await withTimeout(supabase.rpc('referral_summary', { p_user_id: userId })).catch(() => null);
    if (!summary) return jsonError(res, 504, 'upstream_timeout', 'Your invite link could not load');
    if (summary.error) {
      if (routineMissing(summary.error)) return res.json({ enabled: false });
      return jsonError(res, 500, 'db_error', 'Your invite link could not load');
    }
    const raw = (summary.data ?? {}) as { code?: unknown; credited?: unknown; pending?: unknown; invited?: unknown };
    if (!isReferralCode(raw.code)) return jsonError(res, 500, 'db_error', 'Your invite link could not load');
    return res.json({
      enabled: true,
      code: raw.code,
      coins: coins.referralGrant,
      cap: coins.referralCap,
      credited: Number(raw.credited ?? 0),
      pending: Number(raw.pending ?? 0),
      invited: raw.invited === 'pending' || raw.invited === 'credited' ? raw.invited : null,
    });
  }

  if (req.method === 'POST') {
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.referralClaim, `user:${userId}`))) return;
    const body = (req.body || {}) as { code?: unknown };
    const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : null;
    if (!isReferralCode(code)) return jsonError(res, 400, 'bad_request', 'That invite code is not valid');
    res.setHeader('Cache-Control', 'private, no-store');
    if (coins.referralGrant <= 0) return res.json({ status: 'off', coins: 0 });

    const recorded = await withTimeout(
      supabase.rpc('record_referral', {
        p_invitee: userId,
        p_code: code,
        // From the verified token, never from the request body.
        p_account_created_at: accountCreatedAt(auth.payload),
        p_window_hours: REFERRAL_SIGNUP_WINDOW_HOURS,
      }),
    ).catch(() => null);
    if (!recorded) return jsonError(res, 504, 'upstream_timeout', 'The invitation could not be saved');
    if (recorded.error) {
      if (routineMissing(recorded.error)) {
        return jsonError(res, 503, 'migration_required', 'Invitations are not installed yet');
      }
      return jsonError(res, 500, 'db_error', 'The invitation could not be saved');
    }
    const status = String(recorded.data) as ReferralClaimStatus;
    if (!CLAIM_STATUSES.includes(status)) return jsonError(res, 500, 'db_error', 'The invitation could not be saved');
    logEvent({ status: 200, kind: 'referral_claim', outcome: status });
    // A friend who passed a level before the code arrived is paid now rather
    // than at the next level.
    if (status === 'recorded') await creditReferral(supabase, userId);
    return res.json({ status, coins: coins.referralGrant });
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}
