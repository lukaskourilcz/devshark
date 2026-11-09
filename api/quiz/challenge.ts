import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { creditVerifiedXp } from '../../lib/rewards/handlers';
import { settleMilestones } from '../../lib/rewards/coins';
import {
  secureShuffle,
  weightedSample,
  PRIVATE_CATEGORIES,
  type Question,
} from '../../lib/quiz-runtime';
import { encodeSession, createChallengeRun, decodeChallengeRun, decodeScoreProof } from '../../lib/quiz-tokens';
import { jsonError, createLogger, createServiceClient, withTimeout, isRpcMissing, withRequestContext, tryAuthOnce } from '../../lib/http';
import { AuthError, tryAuth } from '../../lib/auth';
import { getEffectiveQuestions, getEffectiveQuestionsById } from '../../lib/questions-store';
import { ChallengeScoreConflictError, getChallengeLeaderboard, recordChallengeScore } from '../../lib/challenge-store';
import { enforceClassRateLimit, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { defaultDeploymentCategories, deploymentSubjectIds, validateCategoryScope } from '../../lib/product-scope';
import { ASSESSMENT_QUESTION_COUNT } from '../../shared/assessment';
import { challengeRunXp } from '../../shared/progression';
import { questionXpHeldOf, type QuestionXpHeld } from '../../shared/repeat-xp';
import { itemReview } from '../../lib/curation';

// Biggest Shark Challenge: a single function serving every challenge resource
// so we stay within Vercel's 12-function Hobby limit. Routing:
//   GET  /api/quiz/challenge                       → fresh question batch
//   GET  /api/quiz/challenge?resource=leaderboard  → top 10 + current champion
//   POST /api/quiz/challenge                       → submit a finished run's score
//
// The question batch is importance-weighted across every public category and
// difficulty; session and run tokens are opaque authenticated envelopes.
// `exclude` lets the client request a batch that doesn't repeat seen ids.

const BATCH_SIZE = 25;
const MAX_EXCLUDE = 500;
const MAX_SCORE = 1000;

const logEvent = createLogger('quiz/challenge');
const supabase = createServiceClient();

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  const resource = typeof req.query.resource === 'string' ? req.query.resource : '';

  // ── POST: submit a finished run's score to the leaderboard ──
  if (req.method === 'POST') {
    if (resource === 'complete') return handleCompleteRun(req, res);
    return jsonError(res, 409, 'automatic_score', 'Completed Challenge scores are saved automatically');
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  // ── GET ?resource=leaderboard: top scores + champion ──
  // A read over history, so a retired category in the list is no reason to
  // refuse it; the categories only name the subject whose board to show.
  if (resource === 'leaderboard') {
    const scope = requestedScope(req, { forDelivery: false });
    if (!scope.ok) {
      return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
    }
    // Shared responses stay cacheable, but varied query strings can miss the
    // CDN. Give those reads the same address backstop as the other boards.
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.readAddress))) return;
    try {
      const board = await getChallengeLeaderboard(scope.subject, 10);
      res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=60');
      return res.json(board);
    } catch {
      return jsonError(res, 503, 'leaderboard_unavailable', 'Challenge leaderboard is temporarily unavailable');
    }
  }

  if (resource && resource !== 'assessment') {
    return jsonError(res, 404, 'unknown_resource', 'Unknown challenge resource');
  }

  // ── GET: question batch ──
  return handleQuestionBatch(req, res);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}

async function handleQuestionBatch(req: VercelRequest, res: VercelResponse) {
  // A guest's refill is charged to the run its sealed token names, as its
  // answers are; a new run, an assessment or a token that does not verify is
  // charged to the address.
  const refill = typeof req.query.runToken === 'string' && req.query.runToken ? decodeChallengeRun(req.query.runToken) : null;
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.quizSessionAddress, RATE_LIMITS.quizSession, refill ? `run:${refill.runId}` : undefined))) return;
  const excludeRaw = typeof req.query.exclude === 'string' ? req.query.exclude : '';
  const excludeSet = new Set(
    excludeRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_EXCLUDE),
  );

  // Optional subject scoping: the client sends the active subject's categories
  // so a challenge never mixes subjects. Old clients default to the
  // deployment's first subject rather than spanning the shared question bank.
  const scope = requestedScope(req, { forDelivery: true });
  if (!scope.ok) {
    return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
  }
  const assessment = req.query.resource === 'assessment';
  const suppliedRunToken = typeof req.query.runToken === 'string' ? req.query.runToken : '';
  if (assessment && suppliedRunToken) {
    return jsonError(res, 400, 'bad_request', 'Assessment sessions cannot reuse challenge runs');
  }
  if (!assessment && req.query.ranked === '0') return jsonError(res, 400, 'invalid_run_mode', 'Challenge allows 90 seconds per question');
  const all = await getEffectiveQuestions(scope.subject);
  const deliverable = new Set(defaultDeploymentCategories());
  const available: string[] = [...new Set(all.filter(q => deliverable.has(q.category) && !PRIVATE_CATEGORIES.includes(q.category)).map(q => q.category))].sort();
  const topics = scope.categories.filter(topic => available.includes(topic)).sort();
  if (topics.length === 0) return jsonError(res, 404, 'no_questions', 'No challenge questions available');
  let auth;
  // The class rate limit above already verified the token; read that result
  // rather than asking Supabase Auth a second time.
  try { auth = assessment ? null : await tryAuthOnce(req); }
  catch (error) {
    if (error instanceof AuthError) return jsonError(res, error.status, error.code, error.message);
    throw error;
  }
  const run = assessment ? null : suppliedRunToken ? decodeChallengeRun(suppliedRunToken)
    : createChallengeRun(true, scope.subject, {
        topics,
        allTopics: available.length === topics.length && available.every(topic => topics.includes(topic)),
        userId: auth?.sub ?? null,
        gradingVersion: 2,
      });
  if (!assessment && (!run || run.subject !== scope.subject || !run.ranked)) return jsonError(res, 400, 'invalid_run', 'Challenge run expired or invalid');
  if (run && 'userId' in run && run.userId !== (auth?.sub ?? null)) return jsonError(res, 400, 'invalid_run', 'Challenge run belongs to another session');
  if (suppliedRunToken && run && run.topics && (run.topics.length !== topics.length || run.topics.some(topic => !topics.includes(topic)))) {
    return jsonError(res, 400, 'invalid_run_scope', 'Challenge topics cannot change during a run');
  }
  const runToken = assessment ? '' : suppliedRunToken || (run && 'runToken' in run ? run.runToken : '');
  const catSet = new Set(run?.topics ?? topics);
  const pool = all.filter(q => !PRIVATE_CATEGORIES.includes(q.category) && !excludeSet.has(q.id) && catSet.has(q.category));
  if (pool.length === 0) return jsonError(res, 404, 'no_questions', 'No challenge questions available');

  const weight = (q: Question) => q.importance ?? 5;
  const batchSize = assessment ? ASSESSMENT_QUESTION_COUNT : BATCH_SIZE;
  const selected = weightedSample(pool, Math.min(batchSize, pool.length), weight);

  const sessionData: { questionId: string; correctAnswer: number }[] = [];
  const questions = selected.map((q) => {
    const correctText = q.options[q.correctAnswer];
    const shuffled = secureShuffle(q.options);
    sessionData.push({ questionId: q.id, correctAnswer: shuffled.indexOf(correctText) });
    return {
      id: q.id,
      // No tags before grading: some name the correct option.
      introduction: q.introduction,
      question: q.question,
      options: shuffled,
      category: q.category,
      difficulty: q.difficulty,
      review: itemReview(q),
    };
  });

  const sessionId = assessment
    ? encodeSession(sessionData, { scope: 'assessment', subject: scope.subject })
    : encodeSession(sessionData, {
        scope: 'challenge',
        runId: run!.runId,
        subject: scope.subject,
        // All batches in a run share one claim namespace, preventing the same
        // question from being re-graded through a freshly issued batch.
        attemptId: run!.runId,
        userId: auth?.sub ?? null,
        gradingVersion: run!.gradingVersion,
      });
  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({ status: 200, kind: assessment ? 'assessment' : 'batch', count: questions.length, excluded: excludeSet.size });
  res.json({ sessionId, runToken, questions });
}

async function handleCompleteRun(req: VercelRequest, res: VercelResponse) {
  // Address bucket first (a class behind one NAT); the per-person limit is
  // taken below, once the caller is known.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.challengeComplete))) return;
  const body = (req.body || {}) as { runToken?: unknown; proofs?: unknown };
  if (typeof body.runToken !== 'string' || !Array.isArray(body.proofs) || body.proofs.length > MAX_SCORE) {
    return jsonError(res, 400, 'bad_request', 'Run token and proofs are required');
  }
  const run = decodeChallengeRun(body.runToken);
  if (!run || !deploymentSubjectIds().includes(run.subject)) {
    return jsonError(res, 400, 'invalid_run', 'Challenge run expired, invalid, or belongs to another product');
  }

  const seen = new Set<string>();
  const outcomes: { questionId: string; isCorrect: boolean }[] = [];
  let score = 0;
  let failures = 0;
  for (const value of body.proofs) {
    if (typeof value !== 'string') return jsonError(res, 400, 'invalid_proof', 'Invalid score proof');
    const proof = decodeScoreProof(value);
    if (!proof || proof.runId !== run.runId || proof.subject !== run.subject || proof.gradingVersion !== run.gradingVersion) {
      return jsonError(res, 400, 'invalid_proof', 'Invalid score proof');
    }
    if (seen.has(proof.questionId)) continue;
    seen.add(proof.questionId);
    outcomes.push({ questionId: proof.questionId, isCorrect: proof.isCorrect });
    if (proof.isCorrect) score++;
    else failures++;
  }
  if (failures !== 3) {
    return jsonError(res, 400, 'incomplete_run', 'A completed run must include its three terminal strikes');
  }

  let auth;
  try {
    auth = await tryAuth(req);
  } catch (error) {
    if (error instanceof AuthError) return jsonError(res, error.status, error.code, error.message);
    throw error;
  }
  const withinCallerLimit = auth
    ? await enforceRateLimit(req, res, RATE_LIMITS.challengeCompletePerUser, `user:${auth.sub}`)
    : await enforceRateLimit(req, res, RATE_LIMITS.challengeCompletePerUser, `run:${run.runId}`);
  if (!withinCallerLimit) return;
  if ('userId' in run && run.userId !== (auth?.sub ?? null)) return jsonError(res, 400, 'invalid_run', 'Challenge run belongs to another session');
  if (score <= 0) return res.json({ ok: true, awarded: false, score, xp: 0, record: null });
  let record;
  try {
    record = await recordChallengeScore({ score, runId: run.runId, subject: run.subject, userId: auth?.sub ?? null, topics: run.topics, allTopics: run.allTopics });
  } catch (error) {
    // The run is already on the board with another score or owner: a retry
    // would be refused the same way, so it is a conflict, not an outage.
    if (error instanceof ChallengeScoreConflictError) return jsonError(res, 409, 'run_already_saved', 'This run was already saved with a different result');
    return jsonError(res, 503, 'leaderboard_unavailable', 'Could not save the score right now');
  }
  if (!auth) return res.json({ ok: true, awarded: false, score, record });
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account progress is not configured');
  // Only server-proven correct answers earn XP. Merely creating/ending a run
  // (including an all-timeout run) must never be a farmable base award.
  const xp = challengeRunXp(score);
  if (xp <= 0) return res.json({ ok: true, awarded: false, score, xp: 0 });
  // Migration 040's completion step applies the same award under the same id
  // and also dates the run's answers for the 30-day board. From 052 it takes
  // the answers themselves and dates only the questions the learner had not
  // answered earlier the same UTC day; before 052 it takes the breakdown
  // alone. Until 040 is installed, fall back to the award alone.
  const answers = await runAnswers(run.subject, outcomes);
  const completion = {
    p_user_id: auth.sub,
    p_run_id: run.runId,
    p_subject: run.subject,
    p_xp: xp,
    p_breakdown: answers?.breakdown ?? null,
  };
  // From migration 060 the completion also names the correct answers whose
  // question's hour held their XP back, and the XP the award holds. Before
  // 060 the routines below answer as they did.
  let xpHeld: QuestionXpHeld | null = null;
  let heldAward: number | null = null;
  let { data, error } = await withTimeout(
    supabase.rpc('record_challenge_completion_v2', answers ? { ...completion, p_outcomes: answers.outcomes } : completion),
  );
  if (!error && data && typeof data === 'object') {
    const outcome = data as { awarded?: unknown; xp?: unknown; xpHeld?: unknown };
    xpHeld = questionXpHeldOf(outcome.xpHeld);
    heldAward = typeof outcome.xp === 'number' && Number.isInteger(outcome.xp) ? outcome.xp : null;
    data = outcome.awarded === true;
  }
  if (isRpcMissing(error)) {
    ({ data, error } = await withTimeout(
      supabase.rpc('record_challenge_completion', answers ? { ...completion, p_outcomes: answers.outcomes } : completion),
    ));
  }
  if (isRpcMissing(error) && answers) {
    ({ data, error } = await withTimeout(supabase.rpc('record_challenge_completion', completion)));
  }
  if (isRpcMissing(error)) {
    ({ data, error } = await withTimeout(
      supabase.rpc('record_verified_activity_xp', {
        p_user_id: auth.sub,
        p_award_id: `challenge:${run.runId}`,
        p_subject: run.subject,
        p_xp: xp,
      }),
    ));
  }
  if (error) {
    if (isRpcMissing(error)) return jsonError(res, 503, 'migration_required', 'Verified progression migration is not installed');
    return jsonError(res, 500, 'db_error', 'Could not record challenge progress');
  }
  // From migration 058 a correct answer whose question paid this account XP
  // less than an hour ago pays nothing, so the run may be awarded less than
  // its score: the award row says how much. Without 058, or when the row
  // cannot be read, the run was awarded in full.
  const awardedXp = data !== true ? 0 : heldAward !== null ? Math.min(heldAward, xp) : await awardedRunXp(run.runId, xp);
  // Tokens follow verified XP, keyed to the same award. A replay credits
  // nothing, and a wallet that cannot be reached never fails the learning.
  if (data === true) {
    await creditVerifiedXp(supabase, { userId: auth.sub, awardId: `challenge:${run.runId}`, subject: run.subject, xp: awardedXp });
    // From migration 048 an awarded run is a streak day, so a Premium streak
    // milestone may have just been reached. Idempotent; a failure costs nothing.
    await settleMilestones(supabase, auth.sub, run.subject);
  }
  return res.json({ ok: true, awarded: data === true, score, record, xp: data === true ? awardedXp : xp, ...(xpHeld ? { xpHeld } : {}) });
}

/** The XP a completed run was awarded (verified_activity_awards). */
async function awardedRunXp(runId: string, runXp: number): Promise<number> {
  const row = await withTimeout(
    supabase!.from('verified_activity_awards').select('xp').eq('award_id', `challenge:${runId}`).maybeSingle(),
  ).catch(() => null);
  const value = (row?.data as { xp?: unknown } | null | undefined)?.xp;
  return !row || row.error || typeof value !== 'number' || !Number.isInteger(value) ? runXp : Math.min(value, runXp);
}

/**
 * A finished run's answers for the dated boards: each answer with its
 * category (migration 052 counts a question once per UTC day), and the same
 * answers by category for a database before 052. A score proof names its
 * question and not its category, so the category comes from the server's own
 * bank. A question that has left the bank since the run was served is left
 * out rather than guessed, and a bank that cannot be read leaves the answers
 * out: the award still applies either way.
 */
async function runAnswers(
  subject: Parameters<typeof getEffectiveQuestionsById>[0],
  outcomes: { questionId: string; isCorrect: boolean }[],
): Promise<{
  outcomes: { questionId: string; category: string; isCorrect: boolean; xp: number }[];
  breakdown: Record<string, { correct: number; total: number }>;
} | null> {
  try {
    const bank = await getEffectiveQuestionsById(subject);
    const answered: { questionId: string; category: string; isCorrect: boolean; xp: number }[] = [];
    const breakdown: Record<string, { correct: number; total: number }> = {};
    for (const outcome of outcomes) {
      const category = bank.get(outcome.questionId)?.category;
      if (!category) continue;
      // Each answer's XP, so migration 058 can leave out the answers whose
      // question paid XP less than an hour ago.
      answered.push({ questionId: outcome.questionId, category, isCorrect: outcome.isCorrect, xp: outcome.isCorrect ? challengeRunXp(1) : 0 });
      const entry = (breakdown[category] ??= { correct: 0, total: 0 });
      entry.total += 1;
      if (outcome.isCorrect) entry.correct += 1;
    }
    return answered.length > 0 ? { outcomes: answered, breakdown } : null;
  } catch (error) {
    logEvent({ status: 200, kind: 'complete', warn: 'breakdown_unavailable', error: error instanceof Error ? error.message : 'unknown' });
    return null;
  }
}

function requestedScope(req: VercelRequest, opts: { forDelivery: boolean }) {
  const catRaw = typeof req.query.categories === 'string' ? req.query.categories : '';
  const requested = catRaw
    ? catRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : defaultDeploymentCategories();
  return validateCategoryScope(requested, opts);
}
