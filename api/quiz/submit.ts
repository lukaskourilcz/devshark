import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { createHash } from 'node:crypto';
import {
  decodeSessionEnvelope,
  encodeScoreProof,
  encodeQuizResultReceipt,
  dailyDurationMs,
  stableAttemptId,
  type DecodedQuizSession,
} from '../../lib/quiz-tokens';
import { AuthError, tryAuth } from '../../lib/auth';
import { createServiceClient, jsonError, createLogger, withTimeout, withRequestContext, isRpcMissing, ServiceUnavailableError, tryAuthOnce } from '../../lib/http';
import { getEffectiveQuestionsById } from '../../lib/questions-store';
import { enforceClassRateLimit, enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import { subjectForCategory } from '../../shared/subject-catalog';
import { deploymentSubjectIds } from '../../lib/product-scope';
import { loadReviewStates, recordConceptReviews } from '../../lib/concept-review';
import { contentVersion } from '../../lib/curation';

const MAX_ANSWERS = 50;

// Who issues a session this handler grades: a quiz or a personalised review
// (api/quiz/questions.ts, no scope), the daily challenge (api/quiz/daily.ts),
// the question of the day (lib/daily-question.ts), a Biggest Shark Challenge
// batch and the 20-question assessment (api/quiz/challenge.ts).
const SUBMITTABLE_SCOPES: ReadonlySet<DecodedQuizSession['scope']> = new Set([
  undefined, 'daily', 'qotd', 'challenge', 'assessment',
]);

const logEvent = createLogger('quiz/submit');
const reportLogger = createLogger('quiz/report');
const serviceSupabase = createServiceClient();
const isProduction = () => process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

interface SubmissionClaim {
  gradeKey: string;
  attemptId: string;
  answerHash: string;
  subject: string;
  userId: string | null;
}

type ChallengeVerdict = 'correct' | 'strike' | 'void';
type ClaimStatus = 'claimed' | 'replay' | 'conflict' | 'unavailable';
type ChallengeClaim =
  | { status: 'claimed' | 'replay'; verdict: ChallengeVerdict }
  | { status: 'conflict' | 'finished' | 'unavailable' };
const localSubmissionClaims = new Map<string, SubmissionClaim & { verdict?: ChallengeVerdict }>();
const localChallengeStrikes = new Map<string, number>();

function sameSubmission(previous: SubmissionClaim, input: SubmissionClaim): boolean {
  return previous.attemptId === input.attemptId && previous.answerHash === input.answerHash &&
    previous.subject === input.subject && previous.userId === input.userId;
}

function claimArguments(input: SubmissionClaim) {
  return {
    p_grade_key: input.gradeKey,
    p_attempt_id: input.attemptId,
    p_user_id: input.userId,
    p_subject: input.subject,
    p_answer_hash: input.answerHash,
  };
}

async function claimSubmission(input: SubmissionClaim): Promise<ClaimStatus> {
  if (!serviceSupabase) {
    if (isProduction()) return 'unavailable';
    const previous = localSubmissionClaims.get(input.gradeKey);
    if (previous) return sameSubmission(previous, input) ? 'replay' : 'conflict';
    localSubmissionClaims.set(input.gradeKey, input);
    return 'claimed';
  }
  const result = await withTimeout(serviceSupabase.rpc('claim_quiz_submission', claimArguments(input)));
  if (result.error) {
    if (isRpcMissing(result.error)) return 'unavailable';
    // The claim is what makes grading one-time, so without it nothing is
    // graded: the database being unreachable is a 503 to retry, not a 500.
    logEvent({ status: 503, reason: 'claim_failed', error: result.error.message });
    throw new ServiceUnavailableError('claim_unavailable', 'This could not be checked right now. Try again in a minute.');
  }
  return result.data === 'claimed' || result.data === 'replay' || result.data === 'conflict'
    ? result.data
    : 'unavailable';
}

async function claimChallengeAnswer(input: SubmissionClaim, verdict: ChallengeVerdict): Promise<ChallengeClaim> {
  if (!serviceSupabase) {
    if (isProduction()) return { status: 'unavailable' };
    const previous = localSubmissionClaims.get(input.gradeKey);
    if (previous) {
      return previous.verdict && sameSubmission(previous, input)
        ? { status: 'replay', verdict: previous.verdict }
        : { status: 'conflict' };
    }
    const strikes = localChallengeStrikes.get(input.attemptId) ?? 0;
    if (strikes >= 3) return { status: 'finished' };
    localSubmissionClaims.set(input.gradeKey, { ...input, verdict });
    if (verdict === 'strike') localChallengeStrikes.set(input.attemptId, strikes + 1);
    return { status: 'claimed', verdict };
  }
  const result = await withTimeout(serviceSupabase.rpc('claim_challenge_answer', { ...claimArguments(input), p_verdict: verdict }));
  if (result.error) {
    if (isRpcMissing(result.error)) return { status: 'unavailable' };
    logEvent({ status: 503, reason: 'challenge_claim_failed', error: result.error.message });
    throw new ServiceUnavailableError('claim_unavailable', 'This could not be checked right now. Try again in a minute.');
  }
  const stored = result.data as { status?: unknown; verdict?: unknown } | null;
  if (stored?.status === 'conflict' || stored?.status === 'finished') return { status: stored.status };
  if ((stored?.status === 'claimed' || stored?.status === 'replay') &&
      (stored.verdict === 'correct' || stored.verdict === 'strike' || stored.verdict === 'void')) {
    return { status: stored.status, verdict: stored.verdict };
  }
  return { status: 'unavailable' };
}

// Question-report reasons. 'needs-review' is the lightweight red-flag from the
// learning path; the rest come from the full report dialog in the solo quiz.
const REPORT_REASONS = [
  'incorrect-answer', 'unclear', 'typo', 'outdated', 'duplicate', 'other', 'needs-review',
] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();

  // Question-report sub-resource shares this function so we stay within the
  // 12-function Hobby limit: POST /api/quiz/submit?resource=report
  if (req.method === 'POST' && req.query.resource === 'report') {
    return handleReport(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // The address bucket holds a class behind one NAT; each caller is bounded
  // again below, once the session and the account are known.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.quizSubmit))) return;

  const body = req.body as { sessionId?: unknown; answers?: unknown };
  if (!body || typeof body !== 'object') {
    return jsonError(res, 400, 'bad_request', 'Body must be JSON');
  }
  if (typeof body.sessionId !== 'string' || body.sessionId.length === 0 || body.sessionId.length > 16_384) {
    return jsonError(res, 400, 'bad_request', 'sessionId is required');
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    return jsonError(res, 400, 'bad_request', 'answers must be an object');
  }

  const answersEntries = Object.entries(body.answers as Record<string, unknown>);
  if (answersEntries.length === 0) {
    return jsonError(res, 400, 'no_answers', 'No answers were submitted');
  }
  if (answersEntries.length > MAX_ANSWERS) {
    return jsonError(res, 413, 'too_many_answers', `At most ${MAX_ANSWERS} answers allowed`);
  }

  const validated: { questionId: string; selectedIndex: number }[] = [];
  for (const [qid, idx] of answersEntries) {
    if (typeof qid !== 'string' || qid.length === 0 || qid.length > 64) {
      return jsonError(res, 400, 'bad_request', 'Invalid question id');
    }
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < -1 || idx > 25) {
      return jsonError(res, 400, 'bad_request', 'Invalid answer index');
    }
    validated.push({ questionId: qid, selectedIndex: idx });
  }

  // Which questions had a hint open. Client-reported, and safe to take as
  // given because it can only make the outcome weaker: a hinted answer never
  // lengthens an interval. Ids outside the session are ignored rather than
  // rejected — a stale hint id is not worth failing a submit over.
  const hintedIds = new Set(
    Array.isArray((req.body as { hinted?: unknown }).hinted)
      ? ((req.body as { hinted: unknown[] }).hinted.filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64,
        ) as string[])
      : [],
  );

  const session = decodeSessionEnvelope(body.sessionId);
  if (!session || !session.attemptId) {
    logEvent({ status: 400, reason: 'invalid_session', latency_ms: Date.now() - started });
    return jsonError(res, 400, 'invalid_session', 'Quiz session expired or invalid');
  }
  // Only the sessions this endpoint issues a verdict for. A Learn level or
  // part test (scope 'roadmap') is graded one answer at a time by
  // /api/quiz/roadmap, which reveals each correct option as it goes; graded
  // here as a whole it would turn those revealed answers into quiz XP, a
  // streak day and leaderboard stats, as often as the level can be reopened.
  if (!SUBMITTABLE_SCOPES.has(session.scope)) {
    logEvent({ status: 400, reason: 'foreign_scope', scope: session.scope, latency_ms: Date.now() - started });
    return jsonError(res, 400, 'invalid_session', 'This session is not graded here');
  }

  const sessionById = new Map(session.questions.map((q) => [q.questionId, q]));
  if (validated.some(({ questionId }) => !sessionById.has(questionId))) {
    return jsonError(res, 400, 'bad_request', 'Answers contain a question outside this session');
  }
  if (session.scope !== 'challenge' && validated.length !== session.questions.length) {
    return jsonError(res, 400, 'incomplete_answers', 'Answer every question before submitting');
  }
  if (session.scope === 'challenge' && validated.length !== 1) {
    return jsonError(res, 400, 'bad_request', 'Challenge answers must be submitted one at a time');
  }
  if (session.scope !== 'challenge' && validated.some(({ selectedIndex }) => selectedIndex < 0)) {
    return jsonError(res, 400, 'bad_request', 'Invalid answer index');
  }
  const subject = session.subject;
  if (!subject || !deploymentSubjectIds().includes(subject)) {
    return jsonError(res, 400, 'invalid_session', 'Quiz session belongs to another product deployment');
  }

  let signedIn;
  try {
    signedIn = await tryAuth(req);
  } catch (error) {
    if (error instanceof AuthError) return jsonError(res, error.status, error.code, error.message);
    throw error;
  }
  // Challenge batches bind guests as well as accounts. A daily opened as a
  // guest can still be submitted as unranked practice after sign-in.
  const owner = session.scope === 'challenge' ? session.userId : session.userId ?? undefined;
  if (owner && !signedIn) {
    logEvent({ status: 401, reason: 'owner_signed_out', scope: session.scope, latency_ms: Date.now() - started });
    return jsonError(res, 401, 'sign_in_required', 'Sign in again to submit this. It was started signed in.');
  }
  // Refuse before spending a claim that belongs to another caller.
  if (owner !== undefined && owner !== (signedIn?.sub ?? null)) {
    logEvent({ status: 409, reason: 'session_owner_mismatch', scope: session.scope, latency_ms: Date.now() - started });
    return jsonError(res, 409, 'session_owner_mismatch', 'This was started under a different sign-in. Start it again.');
  }
  // A signed-in caller is bounded by their account, with room for a Challenge
  // answer every few seconds. A Challenge played without an account is
  // bounded the same way by the run sealed in its session, so a class of
  // guests behind one address each keep their own budget; the address bucket
  // above stays in front of them. Any other caller without an account keeps
  // the address rate.
  const withinCallerLimit = !signedIn
    ? session.scope === 'challenge' && session.runId
      ? await enforceRateLimit(req, res, RATE_LIMITS.challengeSubmitPerUser, `run:${session.runId}`)
      : await enforceRateLimit(req, res, RATE_LIMITS.quizSubmitAnonymous)
    : session.scope === 'challenge'
      ? await enforceRateLimit(req, res, RATE_LIMITS.challengeSubmitPerUser, `user:${signedIn.sub}`)
      : await enforceRateLimit(req, res, RATE_LIMITS.quizSubmitPerUser, `user:${signedIn.sub}`);
  if (!withinCallerLimit) return;
  // The public question of the day (#239) is practice: it is graded as if
  // signed out, so it mints no receipt, XP, streak day or review record for
  // anyone. So is a daily challenge a signed-in learner did not fetch as
  // their own one attempt of the day: fetched signed out it carries a random
  // attempt id, and ranking it would let a learner who has seen the answers
  // refetch and replace their result.
  const dailyPractice = session.scope === 'daily' && signedIn !== null &&
    session.attemptId !== stableAttemptId('daily', signedIn.sub, subject, session.date ?? '');
  const auth = session.scope === 'qotd' || dailyPractice ? null : signedIn;
  const canonicalAnswers = [...validated].sort((a, b) => a.questionId.localeCompare(b.questionId));
  // The same index can refer to a different option in a new Challenge batch.
  // Only the original deal may replay the claim. Pre-deploy batches lack an
  // owner field and keep the old hash for retries until their tokens expire.
  const claimContent = session.scope === 'challenge' && owner !== undefined
    ? [body.sessionId, canonicalAnswers]
    : canonicalAnswers;
  const answerHash = createHash('sha256').update(JSON.stringify(claimContent)).digest('hex');
  const gradeKey = session.scope === 'challenge'
    ? `${session.attemptId}:${validated[0].questionId}`
    : session.attemptId;
  // Start loading the bank and review states alongside the claim. New
  // Challenge claims need the bank first so a retired question cannot
  // spend a strike. No result is returned before the claim is recorded.
  const loading = Promise.all([
    getEffectiveQuestionsById(subject),
    auth && session.scope !== 'challenge' ? loadReviewStates(serviceSupabase, auth.sub, subject) : Promise.resolve([]),
  ]);
  loading.catch(() => {});
  const claimInput = {
    gradeKey,
    attemptId: session.attemptId,
    answerHash,
    subject,
    userId: auth?.sub ?? null,
  };
  let challengeClaim: ChallengeClaim | undefined;
  if (session.scope === 'challenge' && session.gradingVersion === 2) {
    const [bank] = await loading;
    const { questionId, selectedIndex } = validated[0];
    const correct = sessionById.get(questionId)?.correctAnswer === selectedIndex;
    const verdict = !bank.has(questionId) ? 'void' : correct ? 'correct' : 'strike';
    challengeClaim = await claimChallengeAnswer(claimInput, verdict);
  }
  const claim = challengeClaim?.status ?? await claimSubmission(claimInput);
  if (claim === 'unavailable') {
    return jsonError(res, 503, 'migration_required', 'One-time quiz grading is not configured');
  }
  if (claim === 'conflict') {
    return jsonError(res, 409, 'attempt_already_graded', 'This answer has already been graded and cannot be changed');
  }
  if (claim === 'finished') {
    return jsonError(res, 409, 'challenge_finished', 'This Challenge run ended after its third strike.');
  }
  // Effective question set (base + /dev overrides, eligibility applied) for
  // explanations, and for the one grading decision the sealed key
  // cannot make on its own. A question that was retired between the session
  // being issued and the answers arriving is void: it is neither counted for
  // nor against the learner, earns no XP, and it is reported back so
  // the result screen can say why the total is short. The key stays sealed
  // either way; nothing here reveals it.
  const [questionsById, reviewStates] = await loading;
  const recordedVerdict = challengeClaim && 'verdict' in challengeClaim ? challengeClaim.verdict : undefined;
  const canGrade = ({ questionId }: { questionId: string }) => recordedVerdict === undefined
    ? questionsById.has(questionId)
    : recordedVerdict !== 'void';
  const voided = validated.filter((answer) => !canGrade(answer)).map(({ questionId }) => questionId);
  const gradable = validated.filter(canGrade);

  let correct = 0;
  const results = gradable.map(({ questionId, selectedIndex }) => {
    const sessionQ = sessionById.get(questionId);
    const q = questionsById.get(questionId);
    const isCorrect = recordedVerdict === undefined ? sessionQ?.correctAnswer === selectedIndex : recordedVerdict === 'correct';
    if (isCorrect) correct++;
    const result = {
      questionId,
      selectedIndex,
      correctAnswer: sessionQ?.correctAnswer ?? -1,
      isCorrect,
      explanation: q?.explanation ?? '',
    };
    return session.scope === 'challenge' && session.runId && sessionQ
      ? { ...result, scoreProof: encodeScoreProof(session.runId, questionId, subject, isCorrect, session.gradingVersion) }
      : result;
  });

  const total = gradable.length;
  const percentage = total > 0 ? Math.round((correct / total) * 100) : 0;
  const breakdown: Record<string, { correct: number; total: number }> = {};
  // Each question's XP, kept on the receipt beside the total. The stats
  // routine pays the total less the XP of each correct answer whose question
  // paid this account XP less than an hour ago (migration 058).
  const questionXp = new Map<string, number>();
  let questXp = 0;
  for (const result of results) {
    const question = questionsById.get(result.questionId);
    const category = question?.category;
    if (!category) continue;
    if (subjectForCategory(category) !== subject) {
      return jsonError(res, 400, 'invalid_session', 'Quiz session contains mixed product scope');
    }
    const bucket = breakdown[category] ?? { correct: 0, total: 0 };
    bucket.total++;
    if (result.isCorrect) bucket.correct++;
    breakdown[category] = bucket;
    const earned = result.isCorrect && question ? 2 + 2 * question.difficulty : 0;
    questionXp.set(result.questionId, earned);
    questXp += earned;
  }
  // A daily pays at least 20 XP, which record_verified_quiz_result_v2 keeps
  // whatever its questions' cooldowns take off (058).
  if (session.scope === 'daily') questXp = Math.max(20, questXp);
  // A receipt needs something graded behind it. An attempt whose every
  // question was retired mid-flight is reported, not recorded.
  const resultReceipt = auth && session.scope !== 'challenge' && total > 0
      ? encodeQuizResultReceipt({
        attemptId: session.attemptId,
        userId: auth.sub,
        correct,
        total,
        breakdown,
        outcomes: results.flatMap((result) => {
          const category = questionsById.get(result.questionId)?.category;
          return category
            ? [{ questionId: result.questionId, category, isCorrect: result.isCorrect, xp: questionXp.get(result.questionId) ?? 0 }]
            : [];
        }),
        subject,
        questXp,
        purpose: session.scope === 'assessment'
          ? 'assessment'
          : session.scope === 'daily'
            ? 'daily'
            : 'quiz',
        ...(session.scope === 'daily' && session.date
          ? { daily: { date: session.date, durationMs: dailyDurationMs(session) } }
          : {}),
      })
    : undefined;

  // Concept-level review state, from the server's own grading. One row per
  // concept, idempotent on the attempt id, and never a source of XP: review
  // reuses the existing reward rules and grants nothing of its own.
  if (auth && session.scope !== 'challenge') {
    await recordConceptReviews(
      serviceSupabase,
      {
        userId: auth.sub,
        subject,
        eventId: session.attemptId,
        items: results.flatMap((result) => {
          const question = questionsById.get(result.questionId);
          if (!question) return [];
          return [{
            itemId: result.questionId,
            itemVersion: contentVersion(question),
            category: question.category,
            tags: question.tags,
            correct: result.isCorrect,
            kind: hintedIds.has(result.questionId) ? ('hinted' as const) : ('independent' as const),
          }];
        }),
      },
      reviewStates,
    );
  }

  logEvent({ status: 200, total, correct, percentage, voided: voided.length, latency_ms: Date.now() - started });

  res.json({
    totalQuestions: total,
    correctAnswers: correct,
    percentage,
    questXp,
    results,
    ...(voided.length > 0 ? { voided } : {}),
    ...(resultReceipt ? { resultReceipt } : {}),
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}

// POST /api/quiz/submit?resource=report — log a learner's question report.
// Anonymous posts are allowed; when a token is present the verified sub is
// recorded so reporter_sub can't be forged.
async function handleReport(req: VercelRequest, res: VercelResponse) {
  // Anonymous inserts allowed, so throttle against spam: a class-sized
  // address bucket, then the reporter's account, or the address for a guest.
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.questionReportAddress, RATE_LIMITS.questionReport))) return;

  if (!serviceSupabase) {
    return jsonError(res, 503, 'not_configured', 'Reporting backend is not configured');
  }

  let reporter_sub: string | null = null;
  try {
    const auth = await tryAuthOnce(req);
    if (auth) reporter_sub = auth.sub;
  } catch (e) {
    if (e instanceof AuthError) return jsonError(res, e.status, e.code, e.message);
  }

  const body = req.body as { question_id?: unknown; reason?: unknown; detail?: unknown; content_version?: unknown };
  if (!body || typeof body !== 'object') {
    return jsonError(res, 400, 'bad_request', 'Body must be JSON');
  }
  if (
    typeof body.question_id !== 'string' ||
    body.question_id.length === 0 ||
    body.question_id.length > 64
  ) {
    return jsonError(res, 400, 'bad_request', 'question_id required');
  }
  if (typeof body.reason !== 'string' || !REPORT_REASONS.includes(body.reason as ReportReason)) {
    return jsonError(res, 400, 'bad_request', `reason must be one of: ${REPORT_REASONS.join(', ')}`);
  }
  // Postgres text cannot hold U+0000, so a report carrying one failed its
  // insert and answered 500. It is the reporter's text, refused as such.
  if ([body.question_id, body.detail].some((value) => typeof value === 'string' && value.includes('\u0000'))) {
    return jsonError(res, 400, 'bad_request', 'A report cannot contain a null character');
  }
  const detail =
    typeof body.detail === 'string' && body.detail.length <= 1000 ? body.detail : null;
  // The version of the wording the reporter saw. Validated as the shape the
  // server issues rather than trusted: it is stored and later compared, so a
  // client-supplied value that is not one of ours would only produce a report
  // that can never be matched to anything.
  const contentVersion =
    typeof body.content_version === 'string' && /^[A-Za-z0-9_-]{8,32}$/.test(body.content_version)
      ? body.content_version
      : null;

  const row = { question_id: body.question_id, reason: body.reason, detail, reporter_sub };
  try {
    let { error } = await withTimeout(
      serviceSupabase.from('question_reports').insert({ ...row, content_version: contentVersion }),
    );
    // The version column arrives with migration 029. Until it is applied the
    // insert is rejected for an unknown column, and a learner reporting a wrong
    // answer would get an error for a feature that worked yesterday. Losing the
    // version is a much smaller loss than losing the report, so fall back to the
    // row without it. Self-healing: once the migration lands, the first attempt
    // succeeds and this never runs again.
    if (error && /content_version/i.test(error.message ?? '')) {
      reportLogger({ status: 200, reason: 'version_column_missing', migration: '029' });
      ({ error } = await withTimeout(serviceSupabase.from('question_reports').insert(row)));
    }
    if (error) {
      reportLogger({ status: 500, reason: 'insert_failed', error: error.message });
      return jsonError(res, 500, 'db_error', 'Could not save report');
    }
    reportLogger({ status: 200, question_id: body.question_id, reason: body.reason });
    return res.json({ ok: true });
  } catch (err) {
    // A timed-out insert is the service being down for a moment: 503, which
    // the client may retry, as every other handler answers it. Anything else
    // is a fault, answered 500 by withRequestContext.
    if (!(err instanceof ServiceUnavailableError)) throw err;
    reportLogger({ status: 503, error: err.code });
    return jsonError(res, 503, err.code, err.message);
  }
}
