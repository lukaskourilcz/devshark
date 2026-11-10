import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { createHash } from 'node:crypto';
import { encodeSession, quizSessionExpiresAt, stableAttemptId } from '../../lib/quiz-tokens';
import { PRIVATE_CATEGORIES, type Question } from '../../lib/quiz-runtime';
import { createLogger, createServiceClient, jsonError, ServiceUnavailableError, tryAuthOnce, withRequestContext, withTimeout } from '../../lib/http';
import { getEffectiveQuestions } from '../../lib/questions-store';
import { getGameSettings } from '../../lib/settings-store';
import { enforceClassRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { defaultDeploymentCategories, validateCategoryScope } from '../../lib/product-scope';
import { AuthError, requireFreshAuth } from '../../lib/auth';
import { dailySeededShuffle, handleQuestionOfTheDay } from '../../lib/daily-question';
import { deliveryCategories, type ScopeSubjectId } from '../../shared/subject-catalog';

// Daily challenge: deterministic per-UTC-date selection (one question per
// difficulty bucket). Same set for every user on the same day, so leaderboards
// are comparable. Date override is available only outside production testing.

const DAILY_DIFFICULTIES = [1, 2, 3, 4, 5];

const logEvent = createLogger('quiz/daily');
const supabase = createServiceClient();
const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
const localDailyStarts = new Map<string, number>();
const DAILY_START_HASH = createHash('sha256').update('daily-start').digest('hex');

function dateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** When a signed-in learner was first handed this day's challenge, and
 * whether they have already submitted it. A daily result's time runs from
 * that first sight, so fetching the same questions again just before
 * submitting does not shorten it. Kept as a marker row beside the attempt's
 * own one-time grading claim, under its own key, so no schema change is
 * needed; the claim row itself says the attempt was submitted. An unknown
 * ranked start is retryable: a fresh token must not shorten a stored time. */
async function dailyStart(input: { attemptId: string; userId: string; subject: ScopeSubjectId }): Promise<{ startedAt: number; completed: boolean }> {
  const startKey = `daily-start:${input.attemptId}`;
  const db = supabase;
  if (!db && !isProduction) {
    if (!localDailyStarts.has(startKey)) localDailyStarts.set(startKey, Date.now());
    return { startedAt: localDailyStarts.get(startKey)!, completed: false };
  }
  try {
    if (!db) throw new Error('ranked database is not configured');
    const readRows = async () => {
      const result = await withTimeout(db.from('quiz_submissions').select('grade_key, created_at')
        .eq('user_id', input.userId).eq('subject', input.subject).in('grade_key', [startKey, input.attemptId]));
      if (result.error) throw new Error(result.error.message);
      return result.data ?? [];
    };
    let rows = await readRows();
    if (!rows.some((row) => row.grade_key === startKey)) {
      const claimed = await withTimeout(db.rpc('claim_quiz_submission', {
        p_grade_key: startKey,
        p_attempt_id: input.attemptId,
        p_user_id: input.userId,
        p_subject: input.subject,
        p_answer_hash: DAILY_START_HASH,
      }));
      if (claimed.error) throw new Error(claimed.error.message);
      if (claimed.data !== 'claimed' && claimed.data !== 'replay') throw new Error('invalid start claim');
      // Use the same committed time when this request inserted the marker and
      // when another instance inserted it between our read and claim.
      rows = await readRows();
    }
    const marker = rows.find((row) => row.grade_key === startKey);
    const startedAt = Date.parse(String(marker?.created_at));
    if (!Number.isFinite(startedAt)) throw new Error('start marker is missing or invalid');
    return { startedAt: Math.min(startedAt, Date.now()), completed: rows.some((row) => row.grade_key === input.attemptId) };
  } catch (error) {
    logEvent({ status: 503, reason: 'daily_start_unavailable', error: error instanceof Error ? error.message : 'unknown' });
    throw new ServiceUnavailableError('daily_start_unavailable', 'Could not start the ranked daily challenge. Try again in a moment.');
  }
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // The public question of the day (#239) shares this function so the
  // handler count stays at twelve: GET /api/quiz/daily?qotd=<date|today>.
  if (req.query.qotd !== undefined) return handleQuestionOfTheDay(req, res);
  // A signed-in start can create a marker row. Mark it before the rate
  // limiter verifies the token; a guest still starts without an Auth call.
  requireFreshAuth(req);
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.quizSessionAddress, RATE_LIMITS.quizSession))) return;

  const settings = await getGameSettings();
  // The /dev switch. The question of the day above is its own feature and
  // stays open.
  if (!settings.features.dailyChallenge) {
    return jsonError(res, 503, 'feature_disabled', 'The daily challenge is switched off');
  }
  const dailyCount = settings.daily.count;
  const today = dateString();
  const dateParam = (req.query.date as string) || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return jsonError(res, 400, 'bad_request', 'date must be YYYY-MM-DD');
  }
  if (isProduction && dateParam !== today) {
    return jsonError(res, 400, 'date_override_disabled', 'Daily challenge date override is disabled in production');
  }

  // Restrict the ?date= override to a small window around today so an
  // attacker can't enumerate every historical daily challenge in one pass.
  const dayMs = 86_400_000;
  const requestedTs = Date.parse(`${dateParam}T00:00:00Z`);
  const todayTs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(requestedTs) || Math.abs(requestedTs - todayTs) > 30 * dayMs) {
    return jsonError(res, 400, 'bad_request', 'date out of range');
  }

  // The optional category list identifies the subject. Everyone competing
  // on its board gets the draw from the subject's full pool.
  const catRaw = typeof req.query.categories === 'string' ? req.query.categories : '';
  const requested = catRaw
    ? catRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : defaultDeploymentCategories();
  const scope = validateCategoryScope(requested, { forDelivery: true });
  if (!scope.ok) {
    return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
  }
  const catSet = new Set(deliveryCategories(scope.subject));

  let auth;
  try {
    auth = await tryAuthOnce(req);
  } catch (error) {
    if (error instanceof AuthError) return jsonError(res, error.status, error.code, error.message);
    throw error;
  }
  // A signed-in learner gets one claim for this subject/day even if they
  // refetch the deterministic questions, and quiz/submit ranks only that one.
  // Anonymous practice stays useful but never receives a ranked receipt.
  const attemptId = auth ? stableAttemptId('daily', auth.sub, scope.subject, dateParam) : undefined;
  // When the learner first saw today's questions does not depend on which
  // questions they are, so the bank and the start marker load together.
  const [allQuestions, start] = await Promise.all([
    getEffectiveQuestions(scope.subject),
    auth && attemptId
      ? dailyStart({ attemptId, userId: auth.sub, subject: scope.subject })
      : Promise.resolve({ startedAt: null, completed: false }),
  ]);
  const selected: Question[] = [];
  for (const diff of DAILY_DIFFICULTIES) {
    // Never surface private (owner-only) categories in the shared daily mix.
    const pool = allQuestions.filter(
      (q) =>
        q.difficulty === diff &&
        !PRIVATE_CATEGORIES.includes(q.category) &&
        catSet.has(q.category),
    );
    if (pool.length === 0) continue;
    // Keep the daily out of "filler" territory: prefer importance ≥ 4 when there
    // are still enough to vary day to day, otherwise fall back to the full pool.
    const worthy = pool.filter((q) => (q.importance ?? 5) >= 4);
    const usePool = worthy.length >= 3 ? worthy : pool;
    const shuffled = dailySeededShuffle(usePool, `${dateParam}::${diff}`, dateParam);
    selected.push(shuffled[0]);
    if (selected.length >= dailyCount) break;
  }

  // Shuffle option order per question (also deterministic).
  const sessionData: { questionId: string; correctAnswer: number }[] = [];
  const dailyQuestions = selected.map((q, i) => {
    const correctText = q.options[q.correctAnswer];
    const optShuffled = dailySeededShuffle(q.options, `${dateParam}::${q.id}::opts::${i}`, dateParam);
    sessionData.push({ questionId: q.id, correctAnswer: optShuffled.indexOf(correctText) });
    return {
      id: q.id,
      // No tags before grading: some name the correct option.
      introduction: q.introduction,
      question: q.question,
      options: optShuffled,
      category: q.category,
      difficulty: q.difficulty,
    };
  });

  const issuedAt = Date.now();
  const sessionId = encodeSession(sessionData, {
    scope: 'daily',
    date: dateParam,
    subject: scope.subject,
    ...(attemptId ? { attemptId } : {}),
    ...(start.startedAt !== null ? { startedAt: start.startedAt } : {}),
    // The account it was fetched for: quiz/submit grades it for that account
    // only, so a submit that arrives without the token is refused instead of
    // spending the day's one claim as a guest's.
    userId: auth?.sub ?? null,
  });

  // The response embeds an opaque, authenticated session token bound to the
  // caller, signed in or not: never cached, so a response fetched signed out
  // cannot be served again after signing in.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  res.json({
    date: dateParam,
    sessionId,
    expiresAt: quizSessionExpiresAt(issuedAt),
    questions: dailyQuestions,
    // Already submitted today: the client shows that instead of a second run
    // the grader would refuse.
    ...(start.completed ? { completed: true } : {}),
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
