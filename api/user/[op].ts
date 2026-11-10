import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createServiceClient,
  jsonError,
  withTimeout,
  isRpcMissing,
  requireAuthResult,
  requireAuthSub,
  logEvent as emit,
  withRequestContext,
  ServiceUnavailableError,
  lazyExport,
} from '../../lib/http';
import { forgetVerifiedToken, getBearer, requireFreshAuth, type AuthResult } from '../../lib/auth';
import { recordAuthEvent } from '../../lib/auth-events-store';
import { enforceClassRateLimit, limitRead, RATE_LIMITS } from '../../lib/rate-limit';
import { decodeQuizResultReceipt } from '../../lib/quiz-tokens';
import {
  SUBJECT_SCOPE_CATALOG,
  isScopeSubject,
  subjectForCategory,
  type ScopeSubjectId,
} from '../../shared/subject-catalog';
import { deploymentSubjectIds } from '../../lib/product-scope';
import { eligibleServerBadges, type BadgeStatsSummary } from '../../shared/badges';
import { eligibleCodingBadges } from '../../shared/coding-catalog';
import { isMastered, type LevelMasteryEntry } from '../../shared/mastery';
import { questionXpHeldOf } from '../../shared/repeat-xp';
import { settleMilestones } from '../../lib/rewards/coins';
import { handleReferral } from '../../lib/rewards/referral';
import { handleGithub } from '../../lib/github-handlers';
import { handleFriends, handleIdentity } from '../../lib/friends-handlers';
import { verifiedProfile as verifiedProfileOf } from '../../lib/public-identity';
import { handleLeaderboardName } from '../../lib/leaderboard-identity';
import { handleEntitlement } from '../../lib/entitlements';

// The op families below load on their first call, not with this function
// (#587, server item 3). Each one pulled in something most ops never touch:
// the coding catalogue with its reference solutions, the QuickJS grader and
// TypeScript (coding, practice and learning-path handlers), the tier index
// over the coding catalogue (rewards, through lib/access.ts), or Stripe
// (billing, vouchers). Statically imported, a new instance spent about 370 ms
// evaluating them before it answered an entitlement or XP read. The names and
// the dispatch lines are the same as with static imports.
const codingHandlers = () => import('../../lib/coding/handlers');
const handleCodingDraft = lazyExport(codingHandlers, 'handleCodingDraft');
const handleCodingProgress = lazyExport(codingHandlers, 'handleCodingProgress');
const practiceHandlers = () => import('../../lib/coding/practice-handlers');
const handleCodingBookmarks = lazyExport(practiceHandlers, 'handleCodingBookmarks');
const handleCodingSkip = lazyExport(practiceHandlers, 'handleCodingSkip');
const handlePracticeSession = lazyExport(practiceHandlers, 'handlePracticeSession');
const rewardsHandlers = () => import('../../lib/rewards/handlers');
const creditVerifiedXp = lazyExport(rewardsHandlers, 'creditVerifiedXp');
const handleCosmetic = lazyExport(rewardsHandlers, 'handleCosmetic');
const handleStreakProtection = lazyExport(rewardsHandlers, 'handleStreakProtection');
const handleFulfilment = lazyExport(rewardsHandlers, 'handleFulfilment');
const handleOrders = lazyExport(rewardsHandlers, 'handleOrders');
const handlePaymentWebhook = lazyExport(rewardsHandlers, 'handlePaymentWebhook');
const handleShopCatalogue = lazyExport(rewardsHandlers, 'handleShopCatalogue');
const handleWallet = lazyExport(rewardsHandlers, 'handleWallet');
const pathHandlers = () => import('../../lib/learning-paths/handlers');
const handleEnrollment = lazyExport(pathHandlers, 'handleEnrollment');
const handleLearningPreference = lazyExport(pathHandlers, 'handleLearningPreference');
const handlePathDraft = lazyExport(pathHandlers, 'handlePathDraft');
const handlePathReward = lazyExport(pathHandlers, 'handlePathReward');
const handlePathProgress = lazyExport(pathHandlers, 'handlePathProgress');
const handleVoucherRedeem = lazyExport(() => import('../../lib/vouchers'), 'handleVoucherRedeem');
const billingHandlers = () => import('../../lib/billing/handlers');
const endBillingForDeletedAccount = lazyExport(billingHandlers, 'endBillingForDeletedAccount');
const handleBillingCancel = lazyExport(billingHandlers, 'handleBillingCancel');
const handleBillingCheckout = lazyExport(billingHandlers, 'handleBillingCheckout');
const handleBillingPortal = lazyExport(billingHandlers, 'handleBillingPortal');
const handleBillingWebhook = lazyExport(billingHandlers, 'handleBillingWebhook');

const supabase = createServiceClient();

const STATS_FIELDS =
  'id,user_id,email,name,picture,total_quizzes,total_correct,total_questions,current_streak,longest_streak,last_quiz_date,created_at,updated_at';

const MAX_STR = 512;

// Log under a `user/<op>` route so stats and category-stats are distinguishable.
const logEvent = (op: string, event: Record<string, unknown>) => emit(`user/${op}`, event);

/** The answer for an exception an op caught: a Supabase call that timed out
 * (lib/http.ts `UpstreamTimeoutError`) is the database busy for a moment,
 * which the client may retry, so 503 with its code; anything else is 500. */
function caughtError(res: VercelResponse, error: unknown) {
  if (error instanceof ServiceUnavailableError) return jsonError(res, 503, error.code, error.message);
  return jsonError(res, 500, 'internal_error', 'Internal error');
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Backend is not configured');

  const op = String(req.query.op || '').toLowerCase();
  if (FRESH_AUTH_OPS.has(op)) requireFreshAuth(req);
  if (!(await limitUserWrite(req, res, op))) return;
  if (!(await limitUserRead(req, res, op))) return;
  if (op === 'stats') return stats(req, res);
  if (op === 'leaderboard-visibility') return handleLeaderboardVisibility(req, res, supabase);
  if (op === 'leaderboard-name') return handleLeaderboardName(req, res, supabase);
  if (op === 'identity') return handleIdentity(req, res, supabase, verifiedProfile);
  if (op === 'category-stats') return categoryStats(req, res);
  if (op === 'streak') return streak(req, res);
  if (op === 'xp') return xp(req, res);
  if (op === 'authevent') return authEvent(req, res);
  if (op === 'delete-account') return deleteAccount(req, res);
  if (op === 'cards') return retiredCardPacks(req, res);
  if (op === 'badges') return badges(req, res);
  if (op === 'freezes') return freezes(req, res);
  if (op === 'advisor') return advisor(req, res);
  if (op === 'coding-progress') return handleCodingProgress(req, res, supabase);
  if (op === 'coding-draft') return handleCodingDraft(req, res, supabase);
  if (op === 'coding-bookmarks') return handleCodingBookmarks(req, res, supabase);
  if (op === 'coding-skip') return handleCodingSkip(req, res, supabase);
  if (op === 'practice-session') return handlePracticeSession(req, res, supabase);
  if (op === 'wallet') return handleWallet(req, res, supabase);
  if (op === 'referral') return handleReferral(req, res, supabase);
  if (op === 'shop') return handleShopCatalogue(req, res, supabase);
  if (op === 'orders') return handleOrders(req, res, supabase);
  if (op === 'cosmetic') return handleCosmetic(req, res, supabase);
  if (op === 'protection') return handleStreakProtection(req, res, supabase);
  if (op === 'payment-webhook') return handlePaymentWebhook(req, res, supabase);
  if (op === 'fulfilment') return handleFulfilment(req, res, supabase);
  if (op === 'learning-preference') return handleLearningPreference(req, res, supabase);
  if (op === 'learning-path-enrollment') return handleEnrollment(req, res, supabase);
  if (op === 'learning-path-progress') return handlePathProgress(req, res, supabase);
  if (op === 'learning-path-draft') return handlePathDraft(req, res, supabase);
  if (op === 'learning-path-reward') return handlePathReward(req, res, supabase);
  if (op === 'entitlement') return handleEntitlement(req, res, supabase);
  if (op === 'voucher') return handleVoucherRedeem(req, res, supabase);
  if (op === 'billing-checkout') return handleBillingCheckout(req, res, supabase);
  if (op === 'billing-portal') return handleBillingPortal(req, res, supabase);
  if (op === 'billing-webhook') return handleBillingWebhook(req, res, supabase);
  if (op === 'billing-cancel') return handleBillingCancel(req, res, supabase);
  if (op.startsWith('github-')) return handleGithub(op, req, res, supabase);
  if (op.startsWith('friends-')) return handleFriends(op, req, res, supabase);
  return jsonError(res, 404, 'unknown_op', `Unknown user op: ${op}`);
}

/** Mark privileged operations and GETs that may write account data before
 * the rate limit checks the caller. Other writes already ask Auth directly. */
const FRESH_AUTH_OPS: ReadonlySet<string> = new Set([
  'delete-account', 'fulfilment', 'billing-checkout', 'billing-portal', 'billing-cancel', 'voucher',
  'wallet', 'badges', 'freezes', 'friends-handle', 'leaderboard-name', 'referral',
]);

/**
 * The rate limit every write here takes, in two tiers as play's routes do.
 * The first token, before the credentials are read, comes from an address
 * backstop that holds a class behind one NAT: thirty pupils finishing a quiz
 * in the same minute used to share one person's budget, and the ones past
 * twenty lost their result. The second is the caller's own, keyed by the
 * verified account (verified once per request; the op reuses it). A caller
 * without an account keeps the per-address rate it had before the split.
 *
 * Stripe's signature gates the billing webhook, so a burst of retries never
 * meets a 429 meant for people; a learning-path draft autosave takes its own
 * two tiers in `handlePathDraft`. Returns false after sending the 429.
 */
export async function limitUserWrite(req: VercelRequest, res: VercelResponse, op: string): Promise<boolean> {
  if (req.method === 'GET' || op === 'billing-webhook' || op === 'learning-path-draft') return true;
  const deleting = op === 'delete-account';
  // The token is checked while the address bucket answers (lib/rate-limit.ts).
  return enforceClassRateLimit(
    req,
    res,
    deleting ? RATE_LIMITS.accountDeleteAddress : RATE_LIMITS.userMutationAddress,
    deleting ? RATE_LIMITS.accountDelete : RATE_LIMITS.userMutation,
  );
}

/** GETs a script can drive for more than a row: the wallet settles grants,
 * milestones and invitations as it reads, badges are worked out from the
 * stats, and a friend lookup searches by handle. They take the two-tier read
 * limit (`limitRead`). Returns false after sending the 429. */
const LIMITED_READS: ReadonlySet<string> = new Set(['wallet', 'badges', 'friends-lookup', 'friends-handle', 'leaderboard-name']);
async function limitUserRead(req: VercelRequest, res: VercelResponse, op: string): Promise<boolean> {
  if (req.method !== 'GET' || !LIMITED_READS.has(op)) return true;
  return limitRead(req, res);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}

async function deleteAccount(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  // Verified once per request: the deletion rate limit already asked Auth.
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  const body = (req.body || {}) as { confirmation?: unknown };
  if (body.confirmation !== 'DELETE') {
    return jsonError(res, 400, 'confirmation_required', 'Account deletion must be confirmed');
  }

  // End any Premium subscription first: a deleted account must never be
  // charged again, so a Stripe outage stops the deletion here (#221).
  if (!(await endBillingForDeletedAccount(supabase!, auth.sub))) {
    return jsonError(res, 503, 'billing_unavailable', 'We could not cancel your Premium subscription. Try again in a few minutes.');
  }

  try {
    // One routine erases every table that holds an account id: 044 folded in
    // the four routines 039 to 042 shipped, and 045 restated it with the
    // voucher redemptions. Migration 046 drops those four routines.
    const cleanup = await withTimeout(
      supabase!.rpc('delete_user_data', { p_user_id: auth.sub }),
      8000,
    );
    if (cleanup.error) {
      if (isRpcMissing(cleanup.error)) {
        return jsonError(res, 503, 'migration_required', 'Account deletion is not configured yet');
      }
      logEvent('delete-account', { status: 500, reason: 'cleanup_failed', error: cleanup.error.message });
      return jsonError(res, 500, 'db_error', 'Could not delete account data');
    }

    const { error } = await withTimeout(supabase!.auth.admin.deleteUser(auth.sub), 8000);
    // A concurrent, already authenticated deletion may get here after the
    // first request removed the identity. Auth's explicit absence is success.
    if (error && error.code !== 'user_not_found') {
      logEvent('delete-account', { status: 500, reason: 'auth_delete_failed', error: error.message });
      return jsonError(res, 500, 'auth_delete_failed', 'Account data was removed, but the sign-in identity could not be deleted');
    }

    // The Stripe webhook that the cancellation above set off can write billing
    // rows between the erasure and the identity's deletion (finding PROF-4).
    // Erase once more: delete_user_data is idempotent, and with the identity
    // gone migration 053 refuses any later billing write. The account is
    // deleted either way, so a failure here is logged, not answered.
    const again = await withTimeout(supabase!.rpc('delete_user_data', { p_user_id: auth.sub }), 8000)
      .catch((err: unknown) => ({ error: { message: err instanceof Error ? err.message : 'timeout' } }));
    if (again.error) logEvent('delete-account', { status: 200, reason: 'second_cleanup_failed', error: again.error.message });

    logEvent('delete-account', { status: 200, user_id: auth.sub });
    // The identity is gone: this instance no longer accepts its token.
    forgetVerifiedToken(getBearer(req));
    return res.json({ ok: true });
  } catch (err) {
    // A timeout is the database busy for a moment: 503 with its code, as
    // caughtError answers every other op. Anything else is a fault, not a
    // timeout, and is logged and answered as one.
    const message = err instanceof Error ? err.message : 'unknown';
    const timedOut = err instanceof ServiceUnavailableError;
    logEvent('delete-account', { status: timedOut ? 503 : 500, reason: timedOut ? 'timeout' : 'exception', error: message });
    if (timedOut) return jsonError(res, 503, err.code, 'Account deletion timed out; please try again');
    return jsonError(res, 500, 'internal_error', 'Internal error');
  }
}

// Record a sign-in for the /dev "Logs" tab. The client calls this once per
// browser session after Supabase confirms a real sign-in; the server derives the
// (verified) user id, email and provider from the token — never trusting the
// client for identity. Best-effort: a failure here must not break sign-in.
// The token was verified for the rate limit already, so it is read from there;
// a Supabase Auth outage keeps its 503 or 504 instead of reading as 401.
async function authEvent(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  const email = typeof auth.payload.email === 'string' ? auth.payload.email : null;
  const meta = (auth.payload.app_metadata ?? {}) as { provider?: unknown };
  const provider = typeof meta.provider === 'string' ? meta.provider : null;
  const kind = await recordAuthEvent({ userId: auth.sub, email, provider });
  logEvent('authevent', { status: 200, kind });
  return res.json({ ok: true, kind });
}

// Per-user "quest" XP (career leveling), counted PER SUBJECT (platform).
// Learning XP is derived from roadmap progress on the client; only the
// quiz/practice accumulators are persisted here: a `quest_xp_by_subject`
// jsonb map plus the legacy `quest_xp` total kept as the map's sum so old
// clients still see a sensible (monotone) number.
// Kept on the existing user function so we don't add a Vercel Hobby function.
const MAX_XP = 100_000_000;

const clampXp = (n: unknown): number => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  const v = Math.round(n);
  return v < 0 ? 0 : v > MAX_XP ? MAX_XP : v;
};

const MAX_SUBJECT_KEYS = 16;
const SUBJECT_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/;

function sanitizeBySubject(input: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_SUBJECT_KEYS) break;
    if (!SUBJECT_KEY_RE.test(k)) continue;
    const xp = clampXp(v);
    if (xp > 0) {
      out[k] = xp;
      n++;
    }
  }
  return out;
}

// Before migration 020 the `quest_xp_by_subject` column doesn't exist yet —
// detect that specific failure so the endpoint can fall back to legacy shape
// instead of erroring.
const isMissingBySubjectColumn = (error: { message?: string } | null | undefined): boolean =>
  typeof error?.message === 'string' && error.message.includes('quest_xp_by_subject');

async function readXpRow(userId: string): Promise<
  | { ok: true; questXp: number; bySubject: Record<string, number>; hasBySubjectColumn: boolean }
  | { ok: false }
> {
  const { data, error } = await withTimeout(
    supabase!.from('user_xp').select('quest_xp, quest_xp_by_subject').eq('user_id', userId).maybeSingle(),
  );
  if (!error) {
    return {
      ok: true,
      questXp: Number(data?.quest_xp ?? 0),
      bySubject: sanitizeBySubject(data?.quest_xp_by_subject),
      hasBySubjectColumn: true,
    };
  }
  if (!isMissingBySubjectColumn(error)) return { ok: false };
  const fallback = await withTimeout(
    supabase!.from('user_xp').select('quest_xp').eq('user_id', userId).maybeSingle(),
  );
  if (fallback.error) return { ok: false };
  return { ok: true, questXp: Number(fallback.data?.quest_xp ?? 0), bySubject: {}, hasBySubjectColumn: false };
}

async function xp(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const row = await readXpRow(userId);
      if (!row.ok) return jsonError(res, 500, 'db_error', 'Could not load XP');
      return res.json({ data: { quest_xp: row.questXp, by_subject: row.bySubject } });
    }

    if (req.method === 'PUT') {
      return jsonError(
        res,
        409,
        'verified_result_required',
        'XP is awarded only from server-verified quiz and learning results',
      );
    }

    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (err) {
    return caughtError(res, err);
  }
}

async function streak(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await withTimeout(
        supabase!.from('user_streak').select('days').eq('user_id', userId).maybeSingle(),
      );
      if (error) return jsonError(res, 500, 'db_error', 'Could not load streak');
      return res.json({ data: { days: (data?.days as Record<string, number>) ?? {} } });
    }

    if (req.method === 'PUT') {
      return jsonError(
        res,
        409,
        'verified_result_required',
        'Activity streaks are updated only from server-verified learning results',
      );
    }

    res.setHeader('Allow', 'GET, PUT');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (err) {
    return caughtError(res, err);
  }
}

// A leaderboard row shows the name and picture stored here, so both come from
// the verified sign-in and never from the request body (lib/public-identity.ts).
// No email ever stands in for a missing name: the boards say "Learner" instead.
const verifiedProfile = (auth: AuthResult) => verifiedProfileOf(auth, supabase);

/** The XP record_verified_quiz_result_v2 awarded for this attempt, as
 * migration 048 stores it on the receipt row, whichever request applied it.
 *
 * `applied` is what the routine answered this request. A routine that
 * committed and then timed out answers the retry FALSE, yet the attempt was
 * awarded, so a stored amount counts whatever `applied` says; crediting it
 * again is harmless, since the coin credit is keyed to the attempt. A row
 * whose amount is NULL was refused (a second daily result for the day) and
 * awarded nothing. Before 048 the column is missing and the routine awarded
 * the receipt's amount in full, so a failed read answers that for an attempt
 * applied now, and nothing otherwise. */
async function awardedQuestXp(userId: string, attemptId: string, receiptXp: number, applied: boolean): Promise<number> {
  const stored = await withTimeout(
    supabase!.from('quiz_attempts').select('quest_xp').eq('attempt_id', attemptId).eq('user_id', userId).maybeSingle(),
  ).catch(() => null);
  if (!stored || stored.error) return applied ? receiptXp : 0;
  const value = (stored.data as { quest_xp?: unknown } | null)?.quest_xp;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? Math.min(value, receiptXp) : 0;
}

async function stats(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();
  try {
    const auth = await requireAuthResult(req, res);
    if (!auth) return;
    const user_id = auth.sub;

    if (req.method === 'GET') {
      const { data, error } = await withTimeout(
        supabase!.from('user_stats').select(STATS_FIELDS).eq('user_id', user_id).maybeSingle(),
      );
      if (error) {
        logEvent('stats', { status: 500, reason: 'select_failed', error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not load stats');
      }
      logEvent('stats', { status: 200, op: 'get', latency_ms: Date.now() - started });
      return res.json({ data });
    }

    if (req.method === 'POST') {
      const body = (req.body || {}) as {
        email?: unknown;
        result_receipt?: unknown;
        profile?: unknown;
      };
      // Name and picture sent in the body are ignored; see verifiedProfile.
      const shown = await verifiedProfile(auth);

      if (body.result_receipt !== undefined) {
        if (typeof body.result_receipt !== 'string') {
          return jsonError(res, 400, 'bad_request', 'Invalid result receipt');
        }
        const receipt = decodeQuizResultReceipt(body.result_receipt);
        if (!receipt || receipt.userId !== user_id) {
          return jsonError(res, 400, 'invalid_receipt', 'Quiz result receipt expired or invalid');
        }
        if (receipt.purpose !== 'quiz' && receipt.purpose !== 'daily') {
          return jsonError(res, 400, 'invalid_receipt', 'This result does not update quiz statistics');
        }
        if (!deploymentSubjectIds().includes(receipt.subject)) {
          return jsonError(res, 400, 'invalid_receipt', 'Quiz result belongs to another product deployment');
        }
        if (Object.keys(receipt.breakdown).some((category) => subjectForCategory(category) !== receipt.subject)) {
          return jsonError(res, 400, 'invalid_receipt', 'Quiz result receipt has mixed product scope');
        }
        if (receipt.outcomes.some((outcome) => subjectForCategory(outcome.category) !== receipt.subject)) {
          return jsonError(res, 400, 'invalid_receipt', 'Quiz result receipt has mixed question scope');
        }
        const result = {
          p_user_id: user_id,
          p_attempt_id: receipt.attemptId,
          p_correct: receipt.correct,
          p_total: receipt.total,
          p_breakdown: receipt.breakdown,
          p_outcomes: receipt.outcomes,
          p_subject: receipt.subject,
          p_quest_xp: receipt.questXp,
          p_daily_date: receipt.daily?.date ?? null,
          p_duration_ms: receipt.daily?.durationMs ?? null,
          p_email: typeof auth.payload.email === 'string' && auth.payload.email.length <= MAX_STR ? auth.payload.email : null,
          p_name: shown.name,
          p_picture: shown.picture,
        };
        // From migration 060 the same record also names the correct answers
        // whose question's hour held their XP back, so the learner is told.
        // Before 060, 058's routine answers alone.
        let { data: recorded, error } = await withTimeout(supabase!.rpc('record_verified_quiz_result_v3', result));
        if (isRpcMissing(error)) ({ data: recorded, error } = await withTimeout(supabase!.rpc('record_verified_quiz_result_v2', result)));
        const outcome = recorded as { applied?: unknown; xpHeld?: unknown } | boolean | null;
        const data = typeof outcome === 'object' && outcome !== null ? outcome.applied === true : outcome === true;
        const xpHeld = typeof outcome === 'object' && outcome !== null ? questionXpHeldOf(outcome.xpHeld) : null;

        if (error) {
          if (isRpcMissing(error)) {
            logEvent('stats', { status: 200, op: 'submit_fallback', warn: 'rpc_missing' });
            return jsonError(res, 503, 'migration_required', 'Verified statistics migration is not installed');
          }
          logEvent('stats', { status: 500, reason: 'rpc_failed', error: error.message });
          return jsonError(res, 500, 'db_error', 'Could not record quiz result');
        }

        logEvent('stats', { status: 200, op: 'submit', latency_ms: Date.now() - started });
        // The XP the routine awarded: from migration 058 the receipt's XP
        // less that of each correct answer whose question paid XP less than
        // an hour ago (056 paid it whole; 048 to 055 paid less for a question
        // answered earlier the same UTC day), and nothing for a refused second
        // daily. Tokens follow
        // that amount, keyed to the attempt so a replayed submission credits
        // nothing more, and a retry after a commit that timed out credits
        // what the first request could not.
        const questXp = await awardedQuestXp(user_id, receipt.attemptId, receipt.questXp, data === true);
        if (questXp > 0) {
          await creditVerifiedXp(supabase!, {
            userId: user_id,
            awardId: `quiz:${receipt.attemptId}`,
            subject: receipt.subject,
            xp: questXp,
          });
        }
        // A verified quiz moves the streak, so a Premium streak milestone may
        // have just been reached (#227). Idempotent; a failure costs nothing.
        if (data === true) await settleMilestones(supabase!, user_id, receipt.subject);
        const [row, xpRow] = await Promise.all([
          withTimeout(supabase!.from('user_stats').select(STATS_FIELDS).eq('user_id', user_id).maybeSingle()),
          withTimeout(supabase!.from('user_xp').select('quest_xp, quest_xp_by_subject').eq('user_id', user_id).maybeSingle()),
        ]);
        if (row.error || xpRow.error) return jsonError(res, 500, 'db_error', 'Result saved but account progress could not be loaded');
        return res.json({ data: row.data, xp: xpRow.data, applied: data === true, questXp, ...(xpHeld ? { xpHeld } : {}) });
      }

      const profile = {
        user_id,
        // The address of the verified sign-in, like the name and picture above.
        email: typeof auth.payload.email === 'string' && auth.payload.email.length <= MAX_STR ? auth.payload.email : null,
        name: shown.name,
        picture: shown.picture,
      };

      const { data, error } = await withTimeout(
        supabase!
          .from('user_stats')
          .upsert(profile, { onConflict: 'user_id' })
          .select(STATS_FIELDS)
          .single(),
      );

      if (error) {
        logEvent('stats', { status: 500, reason: 'upsert_failed', error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not save profile');
      }
      logEvent('stats', { status: 200, op: 'upsert', latency_ms: Date.now() - started });
      return res.json({ data });
    }

    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logEvent('stats', { status: err instanceof ServiceUnavailableError ? 503 : 500, reason: 'exception', error: message });
    return caughtError(res, err);
  }
}

async function categoryStats(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  return jsonError(
    res,
    409,
    'verified_result_required',
    'Category statistics are recorded only from a server-verified quiz result',
  );
}

/**
 * Whether the public leaderboards show this learner's name and photo
 * (user_stats.show_on_leaderboards, migration 049). It is off until the
 * learner switches it on, and the boards list them as "Learner" meanwhile.
 * GET answers `{ visible }`; PUT `{ visible: boolean }` sets it and answers
 * the stored value. A PUT creates the stats row when it is missing, with the
 * verified name, picture and email as the stats POST writes them, so the
 * name the board shows is always the sign-in's own. The route's write limit
 * (limitUserWrite) charges each PUT to the account.
 */
export async function handleLeaderboardVisibility(
  req: VercelRequest,
  res: VercelResponse,
  db: SupabaseClient | null,
) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  if (!db) return jsonError(res, 503, 'not_configured', 'Backend is not configured');
  res.setHeader('Cache-Control', 'private, no-store');

  let visible: boolean | null = null;
  if (req.method === 'PUT') {
    const body = req.body as { visible?: unknown } | null | undefined;
    if (!body || typeof body !== 'object' || typeof body.visible !== 'boolean') {
      return jsonError(res, 400, 'bad_request', 'visible must be true or false');
    }
    visible = body.visible;
  }

  try {
    const shown = visible === null ? null : await verifiedProfile(auth);
    const result = visible === null
      ? await withTimeout(
          db.from('user_stats').select('show_on_leaderboards').eq('user_id', auth.sub).maybeSingle(),
        )
      : await withTimeout(
          db
            .from('user_stats')
            .upsert(
              {
                user_id: auth.sub,
                email: typeof auth.payload.email === 'string' && auth.payload.email.length <= MAX_STR ? auth.payload.email : null,
                ...shown,
                show_on_leaderboards: visible,
              },
              { onConflict: 'user_id' },
            )
            .select('show_on_leaderboards')
            .single(),
        );
    if (result.error) {
      // 42703: the column is missing, so migration 049 is not applied yet.
      if (result.error.code === '42703') {
        return jsonError(res, 503, 'migration_required', 'Run supabase/supabase-schema-049.sql to enable leaderboard visibility');
      }
      logEvent('leaderboard-visibility', { status: 500, reason: visible === null ? 'select_failed' : 'upsert_failed', error: result.error.message });
      return jsonError(res, 500, 'db_error', 'Could not load or save leaderboard visibility');
    }
    const row = result.data as { show_on_leaderboards?: unknown } | null;
    if (visible !== null) logEvent('leaderboard-visibility', { status: 200, visible });
    return res.json({ visible: row?.show_on_leaderboards === true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logEvent('leaderboard-visibility', { status: err instanceof ServiceUnavailableError ? 503 : 500, reason: 'exception', error: message });
    return caughtError(res, err);
  }
}

/* ──── daily habit: badges, freezes, advisor ──────────────────────────────── */

// op=cards granted a collectible card pack for finishing the Today queue. The
// packs are retired (owner decision 12, 1 October 2026): Shark Cards are now
// saved questions (/api/flashcards). Nothing grants a pack any more and
// grant_daily_queue_cards is no longer called; the user_cards rows stay, and
// delete_user_data still erases them.
export function retiredCardPacks(_req: VercelRequest, res: VercelResponse) {
  return jsonError(res, 410, 'gone', 'Card packs are retired. Shark Cards are the questions you save.');
}

const ADVISOR_MIN_SAMPLE = 4;
const ADVISOR_MAX_WEAK = 6;
const ADVISOR_WEEK_DAYS = 7;

const utcMonth = (): string => new Date().toISOString().slice(0, 7);

// Resolve the active subject the same way flashcards/submit do: from the query
// on reads, from the body on writes, and only if it belongs to this deployment.
function resolveSubject(req: VercelRequest): ScopeSubjectId | null {
  const raw = req.method === 'GET'
    ? req.query.subject
    : (req.body as { subject?: unknown } | undefined)?.subject;
  return isScopeSubject(raw) && deploymentSubjectIds().includes(raw) ? raw : null;
}

// Count Learn levels the learner has mastered in a subject, from the verified
// roadmap-progress blob and the shared mastery rule. Never trusts the client.
function countMasteredLevels(data: unknown, subject: ScopeSubjectId): number {
  if (!data || typeof data !== 'object') return 0;
  const root = data as Record<string, unknown>;
  let count = 0;
  for (const topic of SUBJECT_SCOPE_CATALOG[subject].topics) {
    const t = root[topic];
    if (!t || typeof t !== 'object') continue;
    const levels = (t as Record<string, unknown>).levels;
    if (!levels || typeof levels !== 'object') continue;
    for (const entry of Object.values(levels as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && isMastered(entry as LevelMasteryEntry)) count++;
    }
  }
  return count;
}

// GET/POST /api/user/[op]?op=badges — recompute eligibility from verified stats
// + mastery, persist newly earned ones with a stable date, and return the earned
// set. Badge ids are never accepted from the client.
async function badges(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const subject = resolveSubject(req);
  if (!subject) return jsonError(res, 400, 'invalid_subject_scope', 'A subject from this deployment is required');

  try {
    const [statsRow, progressRow, codingRows] = await Promise.all([
      withTimeout(
        supabase!.from('user_stats').select('total_quizzes, total_correct, total_questions, longest_streak').eq('user_id', userId).maybeSingle(),
      ),
      withTimeout(supabase!.from('roadmap_progress').select('data').eq('user_id', userId).maybeSingle()),
      // devShark coding badges come from passed coding tasks; the other
      // products have no coding progress to read.
      subject === 'webdev'
        ? withTimeout(supabase!.from('coding_progress').select('task_id').eq('user_id', userId).eq('status', 'passed'))
        : Promise.resolve({ data: [] as { task_id: string }[], error: null }),
    ]);
    if (statsRow.error || progressRow.error || codingRows.error) return jsonError(res, 500, 'db_error', 'Could not load badge stats');

    const s = statsRow.data;
    const masteredLevels = countMasteredLevels(progressRow.data?.data, subject);
    const summary: BadgeStatsSummary = {
      totalQuizzes: Number(s?.total_quizzes ?? 0),
      longestStreak: Number(s?.longest_streak ?? 0),
      totalCorrect: Number(s?.total_correct ?? 0),
      totalQuestions: Number(s?.total_questions ?? 0),
      masteredLevels,
    };
    const passedCoding = new Set(((codingRows.data ?? []) as { task_id: string }[]).map((row) => row.task_id));
    const eligible = [
      ...eligibleServerBadges(summary),
      ...(subject === 'webdev' ? eligibleCodingBadges(passedCoding, (await import('../../lib/coding/active')).CODING_SUMMARIES) : []),
    ];

    const synced = await withTimeout(
      supabase!.rpc('sync_user_badges', { p_user_id: userId, p_subject: subject, p_badge_ids: eligible }),
    );
    if (synced.error) {
      if (isRpcMissing(synced.error)) return jsonError(res, 503, 'migration_required', 'Badges are not configured');
      return jsonError(res, 500, 'db_error', 'Could not sync badges');
    }
    const rows = Array.isArray(synced.data) ? (synced.data as { badge_id: string; earned_at: string }[]) : [];
    return res.json({
      earned: rows.map((r) => ({ id: r.badge_id, earnedAt: r.earned_at })),
      masteredLevels,
    });
  } catch (err) {
    return caughtError(res, err);
  }
}


// GET  /api/user/[op]?op=freezes — the monthly protection budget, the latest
//                                   shield, and every date a shield covered in
//                                   the last 40 days (shieldDays, 052).
// POST                            — spend one protection to shield the streak
//                                   today and tomorrow (UTC dates). 409
//                                   shield_would_end_streak when a missed day
//                                   still needs that protection.
//
// The budget, the spend and the expiry are all the server's. A client can ask
// for a shield; it cannot grant itself one, cannot choose the window and cannot
// set the balance. Off-days used to be settable here and are gone: a fixed
// weekend that never counted against anyone was a second, invisible rule on top
// of the two protections, and two rules for the same thing is one too many.
async function freezes(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  try {
    // Spending goes through a routine that decides everything: it refuses an
    // empty budget and returns the running window unchanged rather than
    // charging twice, so a double click or two devices cost one protection.
    if (req.method === 'POST') {
      const spent = await withTimeout(supabase!.rpc('activate_streak_shield', { p_user_id: userId }));
      if (spent.error) {
        if (isRpcMissing(spent.error)) {
          return jsonError(res, 503, 'migration_required', 'Run supabase/supabase-schema-032.sql to enable the streak shield');
        }
        return jsonError(res, 500, 'db_error', 'Could not protect the streak');
      }
      const row = Array.isArray(spent.data) ? spent.data[0] : spent.data;
      // From migration 052 the routine refuses a shield that would spend the
      // protection a missed day still needs, and charges nothing.
      if (row?.outcome === 'would_end_streak') {
        return jsonError(res, 409, 'shield_would_end_streak', 'Learn today to keep your streak');
      }
      if (row?.granted === false && Number(row?.remaining ?? 0) <= 0 && !row?.shield_until) {
        return jsonError(res, 409, 'no_protection_left', 'No protection left this month');
      }
      return res.json({
        remaining: Number(row?.remaining ?? 0),
        period: String(row?.period ?? utcMonth()),
        used: Array.isArray(row?.used) ? (row.used as string[]) : [],
        shieldUntil: row?.shield_until ?? null,
        shieldDays: shieldDaysOf(row),
        shieldSupported: true,
      });
    }

    const refreshed = await withTimeout(supabase!.rpc('refresh_streak_freezes', { p_user_id: userId }));
    if (refreshed.error) {
      if (isRpcMissing(refreshed.error)) return jsonError(res, 503, 'migration_required', 'Streak protection is not configured');
      return jsonError(res, 500, 'db_error', 'Could not load streak protection');
    }
    const freezeRow = Array.isArray(refreshed.data) ? refreshed.data[0] : refreshed.data;
    // `shield_until` arrives with migration 032. Until it is applied the budget
    // still reads correctly and the client simply does not offer the control,
    // rather than offering one that would fail.
    const shieldSupported = freezeRow !== null && typeof freezeRow === 'object' && 'shield_until' in freezeRow;

    return res.json({
      remaining: Number(freezeRow?.remaining ?? 2),
      period: String(freezeRow?.period ?? utcMonth()),
      used: Array.isArray(freezeRow?.used) ? (freezeRow.used as string[]) : [],
      shieldUntil: shieldSupported ? (freezeRow as { shield_until?: string | null }).shield_until ?? null : null,
      shieldDays: shieldDaysOf(freezeRow),
      shieldSupported,
    });
  } catch (err) {
    return caughtError(res, err);
  }
}

/** Every UTC date a shield covered in the last 40 days (migration 052), as
 * YYYY-MM-DD. Empty before 052: the client then reads shieldUntil alone. */
function shieldDaysOf(row: unknown): string[] {
  const days = row && typeof row === 'object' ? (row as { shield_days?: unknown }).shield_days : undefined;
  return Array.isArray(days)
    ? days.filter((day): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)).slice(-64)
    : [];
}

const focusFor = (accuracyPct: number): 'recall' | 'practice' | 'apply' =>
  accuracyPct < 40 ? 'recall' : accuracyPct < 70 ? 'practice' : 'apply';

// Read-only "weakest areas + suggested week". Never mutates, never diagnoses:
// it only ranks the subject's verified per-category accuracy and lays the
// weakest categories across a practice week. `focus` is a stable token
// ('recall' | 'practice' | 'apply') the client localizes.
async function advisor(req: VercelRequest, res: VercelResponse) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const subject = resolveSubject(req);
  if (!subject) return jsonError(res, 400, 'invalid_subject_scope', 'A subject from this deployment is required');

  try {
    const categories = [...SUBJECT_SCOPE_CATALOG[subject].categories];
    const statsRes = await withTimeout(
      supabase!.from('user_category_stats').select('category, total_correct, total_questions').eq('user_id', userId).in('category', categories),
    );
    if (statsRes.error) return jsonError(res, 500, 'db_error', 'Could not load study advisor');

    const ranked = (statsRes.data ?? [])
      .map((r) => {
        const answered = Number(r.total_questions);
        const correct = Number(r.total_correct);
        return { category: String(r.category), answered, accuracyPct: answered > 0 ? Math.round((100 * correct) / answered) : 0 };
      })
      .filter((r) => r.answered >= ADVISOR_MIN_SAMPLE)
      .sort((a, b) => a.accuracyPct - b.accuracyPct || b.answered - a.answered || a.category.localeCompare(b.category));

    const weakAreas = ranked.slice(0, ADVISOR_MAX_WEAK);
    const suggestedWeek = weakAreas.length === 0
      ? []
      : Array.from({ length: ADVISOR_WEEK_DAYS }, (_, i) => {
          const area = weakAreas[i % weakAreas.length];
          return { day: i + 1, category: area.category, focus: focusFor(area.accuracyPct) };
        });

    return res.json({ weakAreas, suggestedWeek, generatedAt: new Date().toISOString() });
  } catch (err) {
    return caughtError(res, err);
  }
}
