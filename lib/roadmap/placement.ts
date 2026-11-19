// Adaptive placement keeps server grading and private, no-store responses.
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { randomBytes } from 'node:crypto';
import { secureShuffle, type Question } from '../quiz-runtime';
import { encodeQuizResultReceipt, encodePlacementRun, decodePlacementRun } from '../quiz-tokens';
import { jsonError } from '../http';
import { claimOnce, enforceClassRateLimit, RATE_LIMITS } from '../rate-limit';
import { deploymentSubjectIds } from '../product-scope';
import { getEffectiveQuestionsById } from '../questions-store';
import { SUBJECT_SCOPE_CATALOG, isScopeSubject, type ScopeSubjectId } from '../../shared/subject-catalog';
import {
  assessmentUnlocks, ASSESSMENT_QUESTION_COUNT, PLACEMENT_ROUND_SIZE,
  PLACEMENT_ROUNDS, PLACEMENT_TOTAL, PLACEMENT_START_DIFFICULTY,
  PLACEMENT_STEP_UP, PLACEMENT_STEP_DOWN,
} from '../../shared/assessment';
import { isRetiredTopic } from '../../shared/retired-content';
import { buildQuestions } from './payload';
import { logEvent, optionalAuthSub } from './runtime';

/* ──── adaptive placement (GET/POST ?resource=placement) ────────────────────── */
// A subject-level skill-check delivered as short adaptive rounds. Difficulty
// steps up after a strong round and down after a weak one; "I don't know yet"
// (a missing answer or index -1) counts as a miss. Every round is graded
// server-side against answer keys sealed inside the placement token, and the
// running score is re-derived from that sealed history — the browser can neither
// read the keys nor inflate the score. The run always totals exactly
// PLACEMENT_TOTAL questions, so the final result reuses the existing verified
// 20-question skill-check receipt + `assessmentUnlocks` for the actual unlock,
// keeping unlocks server-authoritative and idempotent (by the run's attemptId).

type PlacementOutcome = { questionId: string; category: string; isCorrect: boolean };
/** How long a submitted round stays claimed: the life of a placement token. */
const PLACEMENT_ROUND_TTL_S = 60 * 60;

/** The placement pool: the subject's served questions, in the categories
 * discovery still offers. Retired sections are excluded here as they are from
 * every other selector — the eligibility gate withholds their items anyway,
 * and this keeps the pool honest even for a section retired before its items
 * were dispositioned. */
function poolForSubject(byId: Map<string, Question>, subject: ScopeSubjectId): Question[] {
  const cats = new Set<string>(SUBJECT_SCOPE_CATALOG[subject].categories.filter((category) => !isRetiredTopic(category)));
  return [...byId.values()].filter((q) => cats.has(q.category));
}

// Pick `count` unseen questions nearest the target difficulty, shuffled within
// each difficulty band so a re-take never yields the same set.
function pickPlacementIds(pool: Question[], difficulty: number, count: number, seen: Set<string>): string[] {
  const banded = new Map<number, Question[]>();
  for (const q of pool) {
    if (seen.has(q.id)) continue;
    const dist = Math.abs(q.difficulty - difficulty);
    const band = banded.get(dist) ?? [];
    band.push(q);
    banded.set(dist, band);
  }
  const ids: string[] = [];
  for (let dist = 0; dist <= 4 && ids.length < count; dist++) {
    const band = secureShuffle(banded.get(dist) ?? []);
    for (const q of band) {
      if (ids.length >= count) break;
      ids.push(q.id);
    }
  }
  return ids;
}

function stepDifficulty(current: number, correct: number, size: number): number {
  const ratio = size > 0 ? correct / size : 0;
  if (ratio >= PLACEMENT_STEP_UP) return Math.min(5, current + 1);
  if (ratio <= PLACEMENT_STEP_DOWN) return Math.max(1, current - 1);
  return current;
}

// Build one playable round (no answer keys leave the server) plus a fresh
// placement token carrying the sealed answer key and the graded history so far.
function placementRoundResponse(input: {
  subject: ScopeSubjectId;
  attemptId: string;
  round: number;
  difficulty: number;
  history: PlacementOutcome[];
  pool: Question[];
  byId: Map<string, Question>;
}): Record<string, unknown> | null {
  const seen = new Set<string>(input.history.map((h) => h.questionId));
  // A round is five questions, or fewer when fewer are left in the budget: a
  // void earlier in the run adds a short top-up round rather than a sixth
  // full one.
  const remaining = PLACEMENT_TOTAL - input.history.length;
  const ids = pickPlacementIds(input.pool, input.difficulty, Math.max(1, Math.min(PLACEMENT_ROUND_SIZE, remaining)), seen);
  if (ids.length === 0) return null;
  const built = buildQuestions(ids, input.byId);
  if (built.questions.length === 0) return null;
  const items = built.answerKey.map((k) => ({
    questionId: k.questionId,
    correctAnswer: k.correctAnswer,
    category: input.byId.get(k.questionId)!.category,
  }));
  const placementToken = encodePlacementRun({
    subject: input.subject,
    attemptId: input.attemptId,
    round: input.round,
    difficulty: input.difficulty,
    history: input.history,
    items,
  });
  return {
    done: false,
    round: input.round,
    // The nominal count; a void extends the run by one short round, and the
    // client counts from `asked`/`total` so the extra round reads correctly.
    totalRounds: Math.max(PLACEMENT_ROUNDS, input.round),
    difficulty: input.difficulty,
    asked: input.history.length,
    total: PLACEMENT_TOTAL,
    idkCountsAsMiss: true,
    placementToken,
    questions: built.questions,
  };
}

export async function handlePlacementStart(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.quizSessionAddress, RATE_LIMITS.quizSession))) return;
  const rawSubject = req.query.subject;
  if (!isScopeSubject(rawSubject) || !deploymentSubjectIds().includes(rawSubject)) {
    return jsonError(res, 400, 'invalid_subject_scope', 'A subject from this deployment is required');
  }
  const subject = rawSubject;
  const byId = await getEffectiveQuestionsById(subject);
  const pool = poolForSubject(byId, subject);
  const attemptId = randomBytes(18).toString('base64url');
  const response = placementRoundResponse({
    subject, attemptId, round: 1, difficulty: PLACEMENT_START_DIFFICULTY, history: [], pool, byId,
  });
  if (!response) return jsonError(res, 404, 'no_questions', 'No placement questions available');
  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({ status: 200, kind: 'placement_start', subject });
  return res.json(response);
}

export async function handlePlacementRound(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapAnswerAddress, RATE_LIMITS.roadmapAnswer))) return;
  const body = (req.body || {}) as { placementToken?: unknown; answers?: unknown };
  if (typeof body.placementToken !== 'string') {
    return jsonError(res, 400, 'invalid_session', 'Placement session expired or invalid');
  }
  const state = decodePlacementRun(body.placementToken);
  if (!state || !deploymentSubjectIds().includes(state.subject)) {
    return jsonError(res, 400, 'invalid_session', 'Placement session expired or invalid');
  }
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    return jsonError(res, 400, 'bad_request', 'answers must be an object');
  }
  const answerMap = body.answers as Record<string, unknown>;

  // A question retired while the round was open is void: it is neither a hit
  // nor a miss, it does not move the difficulty, and the run is topped up with
  // another question later so the receipt still covers the full budget.
  const servedNow = await getEffectiveQuestionsById(state.subject);
  const roundOutcomes: PlacementOutcome[] = [];
  const review: import('../../shared/assessment').PlacementReview[] = [];
  let roundCorrect = 0;
  let voided = 0;
  for (const item of state.items) {
    const raw = answerMap[item.questionId];
    if (raw !== undefined && (typeof raw !== 'number' || !Number.isInteger(raw) || raw < -1 || raw > 25)) {
      return jsonError(res, 400, 'bad_request', 'Invalid answer index');
    }
    if (!servedNow.has(item.questionId)) {
      voided++;
      continue;
    }
    // A missing answer or -1 is the "I don't know yet" option and counts as a miss.
    const selected = typeof raw === 'number' ? raw : -1;
    const isCorrect = selected >= 0 && selected === item.correctAnswer;
    if (isCorrect) roundCorrect++;
    roundOutcomes.push({ questionId: item.questionId, category: item.category, isCorrect });
    review.push({ questionId: item.questionId, selectedIndex: selected, correctAnswer: item.correctAnswer,
      isCorrect, explanation: servedNow.get(item.questionId)!.explanation });
  }

  const history = [...state.history, ...roundOutcomes];
  const graded = state.items.length - voided;
  const nextDifficulty = graded > 0 ? stepDifficulty(state.difficulty, roundCorrect, graded) : state.difficulty;
  // The run ends when the budget is met. A void leaves the budget short, so
  // one more round is served (bounded: a round always asks at least one
  // question, and the budget is twenty).
  const finished = history.length >= PLACEMENT_TOTAL;
  // The last round names the account its receipt is for. That sign-in is
  // checked before the round is claimed: an expired or unreadable token is
  // refused with nothing spent, so the same round can be sent again once the
  // session is refreshed instead of answering 409 for a round never graded.
  const userId = finished ? await optionalAuthSub(req, res) : null;
  if (userId === undefined) return;

  // Each round is graded once. The token is sealed but not single-use, and
  // every response reports how the round went (the next difficulty, the
  // round's score, the final total), so a round submitted again with other
  // answers would reveal which ones were right: a few dozen replays would
  // find every key and mint a perfect, verified receipt. The client never
  // resubmits a round; after an error it starts a new placement.
  if (!(await claimOnce(`placement:${state.attemptId}:${state.round}`, PLACEMENT_ROUND_TTL_S))) {
    logEvent({ status: 409, kind: 'placement_replayed', subject: state.subject, round: state.round });
    return jsonError(res, 409, 'placement_round_used', 'This placement round was already submitted. Start the placement again.');
  }

  if (finished) {
    const correct = history.filter((h) => h.isCorrect).length;
    const total = history.length;
    const breakdown: Record<string, { correct: number; total: number }> = {};
    for (const h of history) {
      const bucket = breakdown[h.category] ?? { correct: 0, total: 0 };
      bucket.total++;
      if (h.isCorrect) bucket.correct++;
      breakdown[h.category] = bucket;
    }
    const response: Record<string, unknown> = {
      done: true,
      correct,
      total,
      difficulty: nextDifficulty,
      unlockedPreview: assessmentUnlocks(state.subject, correct, total),
      review,
    };
    // The final unlock stays on the verified 20-question skill-check path: only a
    // signed-in run that reached the full budget mints a receipt to apply it.
    if (userId && total === ASSESSMENT_QUESTION_COUNT) {
      response.resultReceipt = encodeQuizResultReceipt({
        attemptId: state.attemptId,
        userId,
        correct,
        total,
        breakdown,
        outcomes: history,
        subject: state.subject,
        questXp: 0,
        purpose: 'assessment',
      });
    }
    logEvent({ status: 200, kind: 'placement_done', subject: state.subject, correct, total });
    return res.json(response);
  }

  const byId = await getEffectiveQuestionsById(state.subject);
  const pool = poolForSubject(byId, state.subject);
  const response = placementRoundResponse({
    subject: state.subject,
    attemptId: state.attemptId,
    round: state.round + 1,
    difficulty: nextDifficulty,
    history,
    pool,
    byId,
  });
  if (!response) return jsonError(res, 404, 'no_questions', 'No placement questions available');
  response.lastRoundCorrect = roundCorrect;
  response.lastRoundSize = graded;
  response.review = review;
  if (voided > 0) response.voided = voided;
  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({ status: 200, kind: 'placement_round', subject: state.subject, round: state.round + 1, difficulty: nextDifficulty });
  return res.json(response);
}
