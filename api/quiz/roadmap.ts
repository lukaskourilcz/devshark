import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { randomBytes } from 'node:crypto';
import { secureShuffle, type Question } from '../../lib/quiz-runtime';
import {
  decodeQuizResultReceipt,
  decodeSessionEnvelope,
  encodeSession,
  encodeQuizResultReceipt,
  encodePlacementRun,
  decodePlacementRun,
} from '../../lib/quiz-tokens';
import {
  jsonError,
  createLogger,
  createServiceClient,
  withTimeout,
  requireAuthSub,
  requireAuthResult,
  isRpcMissing,
  withRequestContext,
  tryAuthOnce,
  ServiceUnavailableError,
  lazyExport,
} from '../../lib/http';
import { AuthError, confirmedEmail, requireFreshAuth, tryAuth } from '../../lib/auth';
import {
  isCheckpointUnlocked as isCheckpointOpen,
  isLevelUnlocked as isLevelOpen,
  isTopicInPlan,
  isTopicUnlocked as isTopicOpen,
  areLevelsPassed,
  stepAlreadyPassed,
  eligibleTopics,
  nextEligibleStep,
  type ProgressStep,
  type StepAvailability,
  type VerifiedProgress,
} from '../../shared/progression';
import {
  LEARNER_PROFILE_META_KEY,
  LEARNING_PREFERENCE_META_KEY,
  isLearnerProfileComplete,
  missingProfileFields,
  parseLearnerProfile,
  parseLearningPreference,
  profileFromPreference,
  type LearnerProfile,
} from '../../shared/learning-paths';
import { getGameSettings } from '../../lib/settings-store';
import { withGrantedTopics } from '../../lib/topic-grants';
import { getEffectiveQuestionsById } from '../../lib/questions-store';
import { claimOnce, enforceClassRateLimit, enforceRateLimit, limitRead, RATE_LIMITS } from '../../lib/rate-limit';
import { deploymentSubjectIds, isDeploymentTopic } from '../../lib/product-scope';
import { isLearnCodingTopic, type CodingTask } from '../../shared/coding-catalog';
import type { RoadmapTopicStructure } from '../../lib/roadmap';
import { SUBJECT_SCOPE_CATALOG } from '../../shared/subject-catalog';
import { subjectForCategory, subjectForTopic, isScopeSubject, type ScopeSubjectId } from '../../shared/subject-catalog';
import {
  assessmentUnlocks,
  ASSESSMENT_QUESTION_COUNT,
  PLACEMENT_ROUND_SIZE,
  PLACEMENT_ROUNDS,
  PLACEMENT_TOTAL,
  PLACEMENT_START_DIFFICULTY,
  PLACEMENT_STEP_UP,
  PLACEMENT_STEP_DOWN,
  roadmapEndedOnHearts,
} from '../../shared/assessment';
import {
  buildLiveTopic,
  liveRoadmapStructure,
  liveAvailability,
  unavailablePartsOf,
  isRoadmapTopic,
  ROADMAP_TOPICS,
  ROADMAP_LEVELS,
  CHECKPOINT_COUNT,
  LEVELS_PER_CHECKPOINT,
  LEVEL_PASS,
  partRanges,
  isValidPart,
  PART_TEST_PASS,
  PART_TEST_SIZE,
  type RoadmapTopic,
} from '../../lib/roadmap';
import { itemReview, contentVersion } from '../../lib/curation';
import { isRetiredTopic } from '../../shared/retired-content';
import { loadReviewStates, recordConceptReviews } from '../../lib/concept-review';
import { conceptOf } from '../../shared/concepts';
import { creditLearnPass, settleMilestonesAfterPass } from '../../lib/rewards/coins';
import { creditReferral } from '../../lib/rewards/referral';
import { isBigOIntroduction, type GatedContent } from '../../shared/tiers';
import { learnRepeatXpOf, type LearnRepeatXp } from '../../shared/repeat-xp';
import { handleLessonRead } from '../../lib/learn-lessons/serve';

// Modules only some resources need load on their first use, not with this
// function (#587, server item 4). Statically imported, every new instance
// evaluated the coding catalogue with its reference solutions, QuickJS and the
// learning-path handlers (with TypeScript) before it answered a progress read
// or a Learn answer: about 350 ms of import. The names and the dispatch lines
// are the same as with static imports.
const codingHandlers = () => import('../../lib/coding/handlers');
const handleCodingApproaches = lazyExport(codingHandlers, 'handleCodingApproaches');
const handleCodingReset = lazyExport(codingHandlers, 'handleCodingReset');
const handleCodingReveal = lazyExport(codingHandlers, 'handleCodingReveal');
const handleCodingSubmit = lazyExport(codingHandlers, 'handleCodingSubmit');
const handleCodingTask = lazyExport(codingHandlers, 'handleCodingTask');
const handleCodingBrief = lazyExport(codingHandlers, 'handleCodingBrief');
const handleCodingState = lazyExport(codingHandlers, 'handleCodingState');
const pathHandlers = () => import('../../lib/learning-paths/handlers');
const handleActivityStart = lazyExport(pathHandlers, 'handleActivityStart');
const handleActivitySubmit = lazyExport(pathHandlers, 'handleActivitySubmit');
const handleLearningPathCatalog = lazyExport(pathHandlers, 'handleLearningPathCatalog');
// The tier check reads an index over the coding catalogue (lib/access.ts).
const refuseLocked = lazyExport(() => import('../../lib/access'), 'refuseLocked');
const prefetchTier = lazyExport(() => import('../../lib/access'), 'prefetchTier');
const resolveTier = lazyExport(() => import('../../lib/access'), 'resolveTier');
/** What a code level seals: its coding tasks, their playable projection and
 * one coding session each. Loaded with the level map or the first code level. */
const learnCoding = async () => {
  const [{ levelCodingTasks }, { playable }, { createCodingSession }] = await Promise.all([
    import('../../lib/coding/active'),
    import('../../lib/coding/catalog'),
    import('../../lib/coding/session'),
  ]);
  return { levelCodingTasks: memoLevelTasks(levelCodingTasks), playableCodingTask: playable, createCodingSession };
};

/** `levelCodingTasks` filters every issuable task on each call, and the map
 * asks it once per level of every code topic: about 10 ms of the map's 11 ms
 * (#587, server item 25). The task catalogue is content fixed when the module
 * loads, so each level's list is worked out once per instance and kept,
 * frozen so no caller can change it for the next. */
const levelTaskLists = new Map<string, readonly CodingTask[]>();
function memoLevelTasks(levelCodingTasks: (topic: CodingTask['topic'], level: number) => CodingTask[]) {
  return (topic: CodingTask['topic'], level: number): readonly CodingTask[] => {
    const key = `${topic}:${level}`;
    let tasks = levelTaskLists.get(key);
    if (!tasks) {
      tasks = Object.freeze(levelCodingTasks(topic, level));
      levelTaskLists.set(key, tasks);
    }
    return tasks;
  };
}

/** The tasks a Learn level seals, as the level map and a level open read
 * them. Exported for the round-trip contract. */
export async function learnLevelCodingTasks(topic: CodingTask['topic'], level: number): Promise<readonly CodingTask[]> {
  return (await learnCoding()).levelCodingTasks(topic, level);
}

// One function for the whole roadmap to stay within the Vercel Hobby
// 12-function limit. It serves three things off the same route:
//   GET  /api/quiz/roadmap                         → the level/checkpoint map
//   GET  /api/quiz/roadmap?topic=&level=           → an 8-question level lesson
//   GET  /api/quiz/roadmap?topic=&checkpoint=      → a 40-question checkpoint exam
//   GET  /api/quiz/roadmap?resource=progress       → the signed-in user's progress
//   POST /api/quiz/roadmap?resource=answer         → grade one first answer
//   POST /api/quiz/roadmap?resource=complete       → atomically record progress
//   GET  /api/quiz/roadmap?resource=learning-path-catalog → published path manifests
//   POST /api/quiz/roadmap?resource=learning-path-start   → open one path activity
//   POST /api/quiz/roadmap?resource=learning-path-submit  → grade and record it
//   GET  /api/quiz/roadmap?resource=lesson&id=     → the lesson a Learn level opens with
const logEvent = createLogger('quiz/roadmap');

/** The level map marks devShark code levels that end with coding tasks, so the
 * learner sees the extra work before opening the level. Counts only; the task
 * ids stay sealed in the level session. */
function withCodingCounts(
  topic: string,
  live: RoadmapTopicStructure,
  levelCodingTasks: (topic: CodingTask['topic'], level: number) => readonly CodingTask[],
): RoadmapTopicStructure {
  if (!isLearnCodingTopic(topic) || !deploymentSubjectIds().includes('webdev')) return live;
  return {
    ...live,
    levels: live.levels.map((level) => {
      const count = levelCodingTasks(topic, level.level).length;
      return count > 0 ? { ...level, codingTasks: count } : level;
    }),
  };
}
const supabase = createServiceClient();
const PROGRESS_TABLE = 'roadmap_progress';

// Build a playable payload without answer keys. Options are shuffled on the
// server and the answer indices are kept only inside the encrypted session.
function buildQuestions(ids: string[], byId: Map<string, Question>) {
  const answerKey: { questionId: string; correctAnswer: number }[] = [];
  const questions = ids
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => Boolean(q))
    .map((q) => {
      const correctText = q.options[q.correctAnswer];
      const options = secureShuffle(q.options);
      answerKey.push({ questionId: q.id, correctAnswer: options.indexOf(correctText) });
      return {
        id: q.id,
        // No tags before grading: some name the correct option.
        introduction: q.introduction,
        question: q.question,
        options,
        category: q.category,
        difficulty: q.difficulty,
        review: itemReview(q),
      };
    });
  return { questions, answerKey };
}

async function playableResponse(input: {
  kind: 'level' | 'checkpoint';
  topic: RoadmapTopic;
  ref: number;
  title: string;
  passPct: number;
  ids: string[];
  byId: Map<string, Question>;
  difficulty?: number;
  requiredLevelStart?: number;
  requiredLevelEnd?: number;
  /** The account the step is issued to, or null for a guest. */
  userId: string | null;
}) {
  const built = buildQuestions(input.ids, input.byId);
  const subject = subjectForTopic(input.topic);
  if (!subject) return null;
  const attemptId = randomBytes(18).toString('base64url');
  // devShark Learn levels of the code topics carry coding tasks. Their ids are
  // sealed into the session so completion can insist on every one passing;
  // each task gets its own coding session bound to this level attempt.
  const coding = input.kind === 'level' && subject === 'webdev' && isLearnCodingTopic(input.topic)
    ? await learnCoding()
    : null;
  const codingTasks = coding && isLearnCodingTopic(input.topic) ? coding.levelCodingTasks(input.topic, input.ref) : [];
  const sessionId = encodeSession(built.answerKey, {
    scope: 'roadmap',
    subject,
    topic: input.topic,
    roadmapKind: input.kind,
    ref: input.ref,
    attemptId,
    ...(input.requiredLevelStart !== undefined && input.requiredLevelEnd !== undefined
      ? { requiredLevelStart: input.requiredLevelStart, requiredLevelEnd: input.requiredLevelEnd }
      : {}),
    ...(codingTasks.length > 0 ? { codingTaskIds: codingTasks.map((task) => task.id) } : {}),
    // Sealed so only the account the progression guard checked may answer
    // and complete the step. A guest session carries null: presenting it with
    // a token would otherwise record a level the guard never allowed.
    userId: input.userId,
  });
  // A coding link can be opened before the first question is answered.
  // Persist its parent now, with the same sealed task list and owner.
  // The attempt id was minted a few lines up (144 random bits), so no row
  // can hold it yet: the row is inserted without reading for it first
  // (#587, server item 11), and only a failed insert reads it back.
  if (supabase && codingTasks.length > 0) {
    const opened = await ensureAttempt(roadmapSession(sessionId)!, input.userId, undefined, { minted: true });
    if (opened.error || !opened.data) throw new Error('Could not open the learning attempt');
  }
  return {
    kind: input.kind,
    topic: input.topic,
    ref: input.ref,
    title: input.title,
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    passPct: input.passPct,
    sessionId,
    questions: built.questions,
    ...(codingTasks.length > 0
      ? {
          coding: codingTasks.map((task) => ({
            task: coding!.playableCodingTask(task),
            session: coding!.createCodingSession({ taskId: task.id, track: task.track, userId: input.userId, roadmapAttemptId: attemptId }),
          })),
        }
      : {}),
  };
}

/* ──── per-user progress (GET ?resource=progress) ───────────────────────── */

interface Entry {
  passed: boolean;
  bestPct: number;
  // Spaced mastery (migration 024), written by the completion routine on
  // levels only. Optional: older rows and part tests have none.
  passDays?: string[];
  mastered?: boolean;
  masteredAt?: string;
  lastPassDay?: string;
}
type TopicProgress = { levels: Record<string, Entry>; checkpoints: Record<string, Entry> };
type ProgressBlob = Record<string, TopicProgress>;

// Skill-check unlocks are server-authoritative. Legacy wallet/inventory fields
// remain readable so existing accounts do not break; nothing the browser sends
// writes balances, inventory or learning unlocks.
interface InventoryBlob {
  owned: string[];
  ring: string | null;
  flair: string | null;
  doubleXp: number;
}
interface ExtraBlob {
  unlocked: string[];
  wallet?: { balance: number };
  inventory?: InventoryBlob;
  wallets?: Record<string, { balance: number }>;
  inventories?: Record<string, InventoryBlob>;
}

const MAX_TOKEN_BALANCE = 100_000_000;
const MAX_INVENTORY_ITEMS = 64;
const MAX_STR_LEN = 64;
const MAX_SUBJECT_KEYS = 16;
const isSafeId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_STR_LEN && /^[a-z0-9_-]+$/i.test(v);
const isSubjectKey = (v: string): boolean => /^[a-z][a-z0-9-]{0,31}$/.test(v);

const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The completion routine keeps at most twelve distinct passing days. */
const MAX_PASS_DAYS = 12;

/** A level entry's spaced-mastery fields, validated. The client reads them for
 * the map's mastered/due states and Today's review list, so a response that
 * carries progress must keep them exactly as the GET does. */
function masteryFields(e: Record<string, unknown>): Pick<Entry, 'passDays' | 'mastered' | 'masteredAt' | 'lastPassDay'> {
  return {
    ...(Array.isArray(e.passDays) ? { passDays: e.passDays.filter(isDayKey).slice(0, MAX_PASS_DAYS) } : {}),
    ...(typeof e.mastered === 'boolean' ? { mastered: e.mastered } : {}),
    ...(isDayKey(e.masteredAt) ? { masteredAt: e.masteredAt } : {}),
    ...(isDayKey(e.lastPassDay) ? { lastPassDay: e.lastPassDay } : {}),
  };
}

const clampPct = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 0;
  return v < 0 ? 0 : v > 100 ? 100 : v;
};

const clampBalance = (n: unknown): number => {
  const bal = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return Math.min(MAX_TOKEN_BALANCE, bal);
};

function sanitizeInventory(input: unknown): InventoryBlob {
  const inv = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const owned = Array.isArray(inv.owned)
    ? Array.from(new Set(inv.owned.filter(isSafeId))).slice(0, MAX_INVENTORY_ITEMS)
    : [];
  const ring = isSafeId(inv.ring) && owned.includes(inv.ring) ? inv.ring : null;
  const flair = isSafeId(inv.flair) && owned.includes(inv.flair) ? inv.flair : null;
  // Retained in the wire shape for old clients, but boosters are retired:
  // shop purchases may never alter XP, scores, access, or ranking fairness.
  return { owned, ring, flair, doubleXp: 0 };
}

// Rebuild a clean extras blob from untrusted input: only known topic ids,
// de-duplicated and bounded. Exported for tests.
export function sanitizeExtra(input: unknown): ExtraBlob {
  const out: ExtraBlob = { unlocked: [] };
  if (!input || typeof input !== 'object') return out;
  const rec = input as Record<string, unknown>;

  // unlocked topic ids
  const raw = rec.unlocked;
  if (Array.isArray(raw)) {
    const seen = new Set<string>();
    const known = new Set<string>(ROADMAP_TOPICS);
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const id = v.toLowerCase();
      if (!known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.unlocked.push(id);
      if (out.unlocked.length >= ROADMAP_TOPICS.length) break;
    }
  }

  // legacy single wallet (pre-split rows/clients)
  if (rec.wallet && typeof rec.wallet === 'object') {
    out.wallet = { balance: clampBalance((rec.wallet as Record<string, unknown>).balance) };
  }

  // legacy single inventory (pre-split rows/clients)
  if (rec.inventory && typeof rec.inventory === 'object') {
    out.inventory = sanitizeInventory(rec.inventory);
  }

  // per-subject wallets
  if (rec.wallets && typeof rec.wallets === 'object' && !Array.isArray(rec.wallets)) {
    const wallets: Record<string, { balance: number }> = {};
    let n = 0;
    for (const [k, v] of Object.entries(rec.wallets as Record<string, unknown>)) {
      if (n >= MAX_SUBJECT_KEYS) break;
      if (!isSubjectKey(k) || !v || typeof v !== 'object') continue;
      wallets[k] = { balance: clampBalance((v as Record<string, unknown>).balance) };
      n++;
    }
    out.wallets = wallets;
  }

  // per-subject inventories
  if (rec.inventories && typeof rec.inventories === 'object' && !Array.isArray(rec.inventories)) {
    const inventories: Record<string, InventoryBlob> = {};
    let n = 0;
    for (const [k, v] of Object.entries(rec.inventories as Record<string, unknown>)) {
      if (n >= MAX_SUBJECT_KEYS) break;
      if (!isSubjectKey(k) || !v || typeof v !== 'object') continue;
      inventories[k] = sanitizeInventory(v);
      n++;
    }
    out.inventories = inventories;
  }

  return out;
}

// Rebuild a clean blob from untrusted input: only known topics, valid level /
// checkpoint numbers, and bounded values are kept. This bounds the stored size
// and shape regardless of what the client sends. Exported for tests.
export function sanitize(input: unknown): ProgressBlob {
  const out: ProgressBlob = {};
  if (!input || typeof input !== 'object') return out;
  const root = input as Record<string, unknown>;

  for (const topic of ROADMAP_TOPICS) {
    const t = root[topic];
    if (!t || typeof t !== 'object') continue;
    const levelsIn = (t as Record<string, unknown>).levels;
    const checkpointsIn = (t as Record<string, unknown>).checkpoints;
    const levels: Record<string, Entry> = {};
    const checkpoints: Record<string, Entry> = {};

    if (levelsIn && typeof levelsIn === 'object') {
      for (const [k, v] of Object.entries(levelsIn as Record<string, unknown>)) {
        const n = parseInt(k, 10);
        if (!Number.isInteger(n) || n < 1 || n > ROADMAP_LEVELS) continue;
        if (!v || typeof v !== 'object') continue;
        const e = v as Record<string, unknown>;
        levels[String(n)] = { passed: e.passed === true, bestPct: clampPct(e.bestPct), ...masteryFields(e) };
      }
    }
    if (checkpointsIn && typeof checkpointsIn === 'object') {
      for (const [k, v] of Object.entries(checkpointsIn as Record<string, unknown>)) {
        const n = parseInt(k, 10);
        if (!Number.isInteger(n) || n < 1 || n > CHECKPOINT_COUNT) continue;
        if (!v || typeof v !== 'object') continue;
        const e = v as Record<string, unknown>;
        checkpoints[String(n)] = { passed: e.passed === true, bestPct: clampPct(e.bestPct) };
      }
    }
    if (Object.keys(levels).length > 0 || Object.keys(checkpoints).length > 0) {
      out[topic] = { levels, checkpoints };
    }
  }
  return out;
}

async function handleProgress(req: VercelRequest, res: VercelResponse) {
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Backend is not configured');

  // One token verification serves both the row lookup and the email claim the
  // account grants below are keyed on.
  const auth = await requireAuthResult(req, res);
  if (!auth) return;
  const userId = auth.sub;
  // Grants are keyed on the address, so only a confirmed one counts.
  const email = confirmedEmail(auth.payload);

  // Paths granted to a named account (see lib/topic-grants.ts) are resolved
  // here rather than stored, so they stay server-owned and survive a progress
  // reset. Everything else in `extra` still comes from the row. The owner
  // address the grants are keyed on is read alongside the row, not after it.
  const [{ ownerEmail }, current] = await Promise.all([
    getGameSettings(),
    withTimeout(supabase.from(PROGRESS_TABLE).select('data, extra').eq('user_id', userId).maybeSingle()),
  ]);
  if (current.error) return jsonError(res, 500, 'db_error', 'Could not load progress');
  const stored = sanitizeExtra(current.data?.extra);
  const extra = { ...stored, unlocked: withGrantedTopics(stored.unlocked, email, ownerEmail) };

  return res.json({ data: (current.data?.data as ProgressBlob) ?? {}, extra });
}

async function handleSkillCheck(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapCompleteAddress, RATE_LIMITS.roadmapComplete))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning progress is not configured');
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  const body = (req.body || {}) as { resultReceipt?: unknown };
  if (typeof body.resultReceipt !== 'string') {
    return jsonError(res, 400, 'bad_request', 'A verified assessment receipt is required');
  }
  const receipt = decodeQuizResultReceipt(body.resultReceipt);
  // A receipt may be a few questions short of the budget when items were
  // retired mid-run (the grader voids them). It is still a full run — every
  // question the learner was asked was graded — so the unlock tier is read
  // from the share correct, scaled to the budget, rather than refused.
  // Anything shorter than that is not an assessment.
  const MAX_VOIDED = 5;
  if (
    !receipt || receipt.userId !== userId || receipt.purpose !== 'assessment' ||
    receipt.total > ASSESSMENT_QUESTION_COUNT || receipt.total < ASSESSMENT_QUESTION_COUNT - MAX_VOIDED ||
    receipt.outcomes.length !== receipt.total ||
    !deploymentSubjectIds().includes(receipt.subject) ||
    receipt.outcomes.some((outcome) => subjectForCategory(outcome.category) !== receipt.subject)
  ) {
    return jsonError(res, 400, 'invalid_receipt', 'Assessment receipt expired or invalid');
  }

  const scaledCorrect = receipt.total === ASSESSMENT_QUESTION_COUNT
    ? receipt.correct
    : Math.round((receipt.correct * ASSESSMENT_QUESTION_COUNT) / receipt.total);
  const unlocked = assessmentUnlocks(receipt.subject, scaledCorrect, ASSESSMENT_QUESTION_COUNT);
  const applied = await withTimeout(
    supabase.rpc('apply_verified_skill_check', {
      p_user_id: userId,
      p_attempt_id: receipt.attemptId,
      p_subject: receipt.subject,
      p_correct: scaledCorrect,
      p_total: ASSESSMENT_QUESTION_COUNT,
      p_unlocked: unlocked,
    }),
  );
  if (applied.error) {
    if (isRpcMissing(applied.error)) {
      return jsonError(res, 503, 'migration_required', 'Verified assessment migration is not installed');
    }
    return jsonError(res, 500, 'db_error', 'Could not apply assessment unlocks');
  }
  logEvent({ status: 200, kind: 'skill_check', subject: receipt.subject, correct: receipt.correct, applied: applied.data === true });
  return res.json({ applied: applied.data === true, unlocked });
}

async function optionalAuthSub(req: VercelRequest, res: VercelResponse): Promise<string | null | undefined> {
  try {
    return (await tryAuthOnce(req))?.sub ?? null;
  } catch (error) {
    if (error instanceof AuthError) {
      jsonError(res, error.status, error.code, error.message);
      return undefined;
    }
    throw error;
  }
}

/* ──── progression guard (issue #152) ───────────────────────────────────────
 * One graph decides what a learner may open, and the server is where it is
 * enforced. Until now the map hid a level the learner had not reached but the
 * API still served it to a direct URL, and only the verified-completion routine
 * refused — so a level could be played, just not finished. It is now refused at
 * issuance too, from the same rules the map draws (shared/progression.ts).
 *
 * Two inputs, and only two: the versioned profile stored on the account, and
 * the server's own record of what was verified. Nothing in the request body
 * takes part. A signed-out visitor has no verified record at all, so nothing
 * here can be checked against evidence — their play is a preview that never
 * completes, never scores and never unlocks, exactly as before.
 */

interface LearnerContext {
  userId: string;
  profile: LearnerProfile | null;
  progress: VerifiedProgress;
  extraUnlocked: string[];
}

/** The learner's plan and verified record, or null for a guest.
 * `undefined` means a response was already sent (a broken credential, or a
 * record that could not be read). */
async function learnerContext(
  req: VercelRequest,
  res: VercelResponse,
): Promise<LearnerContext | null | undefined> {
  let auth: Awaited<ReturnType<typeof tryAuth>>;
  try {
    // Verified once per request: the read limit in front has checked it.
    auth = await tryAuthOnce(req);
  } catch (error) {
    if (error instanceof AuthError) {
      jsonError(res, error.status, error.code, error.message);
      return undefined;
    }
    throw error;
  }
  if (!auth) return null;
  // Grants are keyed on the address, so only a confirmed one counts.
  const email = confirmedEmail(auth.payload);
  const metadata = ((auth.payload as Record<string, unknown>).user_metadata ?? {}) as Record<string, unknown>;
  // The v2 profile when there is one; otherwise the plan the account already
  // chose through the v1 preference, with its required answers still missing.
  const profile =
    parseLearnerProfile(metadata[LEARNER_PROFILE_META_KEY]) ??
    profileFromPreference(parseLearningPreference(metadata[LEARNING_PREFERENCE_META_KEY]));
  // Paths granted to the account open here exactly as the progress GET
  // reports them (see handleProgress), or the map would draw a granted topic
  // open while every level in it answered 403 topic_locked.
  if (!supabase) {
    const { ownerEmail } = await getGameSettings();
    return { userId: auth.sub, profile, progress: {}, extraUnlocked: withGrantedTopics([], email, ownerEmail) };
  }
  const [{ ownerEmail }, row] = await Promise.all([
    getGameSettings(),
    withTimeout(supabase.from(PROGRESS_TABLE).select('data, extra').eq('user_id', auth.sub).maybeSingle()),
  ]);
  // Without the record nothing can be checked against evidence. Carrying on
  // with an empty one would refuse every level past the first as "complete
  // the preceding steps" over a database blip, which is not true.
  if (row.error) {
    jsonError(res, 503, 'progress_unavailable', 'Could not load your learning progress. Try again.');
    return undefined;
  }
  return {
    userId: auth.sub,
    profile,
    progress: (row.data?.data as VerifiedProgress) ?? {},
    extraUnlocked: withGrantedTopics(sanitizeExtra(row.data?.extra).unlocked, email, ownerEmail),
  };
}

type StepRequest = ProgressStep;

/** Start the tier read of the step a signed-in learner asked for, beside the
 * reads that come before its gates. `part` is the part test's number, when
 * the request is for one; `ref` is the number asked for. A request whose
 * number is not a step's, or that carries no token, reads nothing; a token
 * that fails is answered by `learnerContext`. */
async function prefetchStepTier(req: VercelRequest, topic: RoadmapTopic, part: string | undefined, ref: string | undefined): Promise<void> {
  const n = Number.parseInt(ref ?? '', 10);
  if (!Number.isInteger(n) || n < 1 || (part !== undefined && !isValidPart(n))) return;
  const auth = await tryAuthOnce(req).catch(() => null);
  if (!auth) return;
  await prefetchTier(auth.sub, part !== undefined ? { kind: 'learn-part-test', topic, part: n } : { kind: 'learn-level', topic, level: n });
}

/** Why the server will not serve this step, or null when it will. */
function stepRefusal(
  context: LearnerContext,
  subject: string,
  topic: string,
  step: StepRequest,
  availability: StepAvailability,
): { code: string; message: string } | null {
  // Work already done is served whatever the plan says now. Editing a plan
  // narrows what is offered next; it does not withdraw what was earned. Without
  // this, a learner who passed Next.js levels on the frontend track and then
  // switched to backend — where Next.js is not in the plan — would be told
  // those very levels are "not part of the learning plan you chose".
  //
  // A passed part test is covered on both of its names: `?test=n` and the
  // older `?checkpoint=n` read the same record, and the map offers it again.
  if (stepAlreadyPassed(context.progress, topic, step)) return null;
  if (step.kind === 'level' && isBigOIntroduction(topic, step.level)) return null;

  if (!isTopicInPlan(context.profile, subject, topic)) {
    return { code: 'not_in_plan', message: 'This topic is not part of the learning plan you chose' };
  }
  if (!isTopicOpen(context.progress, topic, context.extraUnlocked)) {
    return { code: 'topic_locked', message: 'Finish the topics this one builds on first' };
  }
  if (step.kind === 'level' && !isLevelOpen(context.progress, topic, step.level, availability)) {
    return { code: 'prerequisite_not_met', message: 'Complete the preceding learning steps first' };
  }
  if (step.kind === 'checkpoint' && !isCheckpointOpen(context.progress, topic, step.checkpoint, availability)) {
    return { code: 'prerequisite_not_met', message: 'Pass every level of this segment before its checkpoint' };
  }
  if (step.kind === 'test' && !areLevelsPassed(context.progress, topic, step.from, step.to, availability)) {
    return { code: 'prerequisite_not_met', message: 'Pass every level of this part before its test' };
  }
  return null;
}

/** A step with too few served questions is refused for everyone, signed in or
 * not, with its own code: the learner has not failed to earn it, there is
 * nothing there to earn. */
const STEP_UNAVAILABLE = { code: 'step_unavailable', message: 'Not enough reviewed questions are available for this step yet' } as const;

/** The nearest available level before `level` in its part, or null when the
 * level is the first available one of its part (the part test before it is
 * what gates it, and the completion routine does not check tests). */
function previousAvailable(availability: StepAvailability, level: number): number | null {
  const range = partRanges(availability.levelCount ?? 0).find((r) => level >= r.startLevel && level <= r.endLevel);
  const start = range?.startLevel ?? 1;
  for (let candidate = level - 1; candidate >= start; candidate--) {
    if (!availability.unavailableLevels?.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The level range the completion routine must find passed before it records
 * an exam. The routine walks the range level by level, so a range that spans
 * an unavailable level could never be satisfied; when the range has a gap the
 * requirement narrows to its last available level, which — by the sequential
 * rule the map applies — is passed only when every available level before it
 * is. The handler has already applied the full rule with availability.
 */
function requiredRange(availability: StepAvailability, from: number, to: number): { requiredLevelStart: number; requiredLevelEnd: number } | Record<string, never> {
  const unavailable = availability.unavailableLevels;
  let hasGap = false;
  let last: number | null = null;
  for (let level = from; level <= to; level++) {
    if (unavailable?.has(level)) hasGap = true;
    else last = level;
  }
  if (last === null) return {};
  return hasGap ? { requiredLevelStart: last, requiredLevelEnd: last } : { requiredLevelStart: from, requiredLevelEnd: to };
}

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

async function handlePlacementStart(req: VercelRequest, res: VercelResponse) {
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

async function handlePlacementRound(req: VercelRequest, res: VercelResponse) {
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

function roadmapSession(raw: unknown) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16_384) return null;
  const session = decodeSessionEnvelope(raw);
  if (
    !session || session.scope !== 'roadmap' || !session.subject || !session.topic ||
    !session.roadmapKind || !session.ref || !session.attemptId ||
    !isRoadmapTopic(session.topic) || !isDeploymentTopic(session.topic) ||
    subjectForTopic(session.topic) !== session.subject
  ) return null;
  return session;
}

/** The attempt row of a session, inserted when no answer opened it yet.
 * `refused`, when given, is a tier gate that runs at the same time: the read
 * goes ahead, but nothing is inserted until the gate let the session through,
 * and nothing at all when it refused it. `minted` says the attempt id was
 * generated for this request, so there is no row to read before the insert. */
async function ensureAttempt(
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
  refused?: Promise<boolean>,
  { minted = false }: { minted?: boolean } = {},
) {
  const existing = minted
    ? { data: null, error: null }
    : await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .eq('attempt_id', session.attemptId!)
        .maybeSingle(),
    );
  if (existing.error) return { error: existing.error, data: null };
  if (!existing.data && refused && (await refused)) return existing;
  if (!existing.data) {
    const passPct = session.roadmapKind === 'level' ? LEVEL_PASS : PART_TEST_PASS;
    const inserted = await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .insert({
          attempt_id: session.attemptId,
          user_id: userId,
          subject: session.subject,
          topic: session.topic,
          kind: session.roadmapKind,
          ref: session.ref,
          total_questions: session.questions.length,
          pass_pct: passPct,
          required_level_start: session.requiredLevelStart ?? null,
          required_level_end: session.requiredLevelEnd ?? null,
          coding_task_ids: session.codingTaskIds ?? null,
          expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
        })
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .single(),
    );
    if (!inserted.error) return inserted;
    // A simultaneous first answer can win the insert. Re-read the row and
    // verify it below instead of turning a harmless race into a failed lesson.
    const raced = await withTimeout(
      supabase!
        .from('roadmap_attempts')
        .select('attempt_id,user_id,subject,topic,kind,ref,total_questions,pass_pct,required_level_start,required_level_end,completed_at')
        .eq('attempt_id', session.attemptId!)
        .maybeSingle(),
    );
    return raced;
  }
  return existing;
}

function attemptMatches(
  attempt: Record<string, unknown>,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
): boolean {
  return (
    (attempt.user_id ?? null) === userId &&
    attempt.subject === session.subject &&
    attempt.topic === session.topic &&
    attempt.kind === session.roadmapKind &&
    Number(attempt.ref) === session.ref &&
    Number(attempt.total_questions) === session.questions.length
    && (attempt.required_level_start == null ? undefined : Number(attempt.required_level_start)) === session.requiredLevelStart
    && (attempt.required_level_end == null ? undefined : Number(attempt.required_level_end)) === session.requiredLevelEnd
  );
}

/** What a sealed Learn session starts, for the tier gate: a level, or the
 * part test a checkpoint session stands for. */
function sessionContent(session: NonNullable<ReturnType<typeof roadmapSession>>): { content: GatedContent; step: ProgressStep } {
  return session.roadmapKind === 'level'
    ? { content: { kind: 'learn-level', topic: session.topic!, level: session.ref! }, step: { kind: 'level', level: session.ref! } }
    : { content: { kind: 'learn-part-test', topic: session.topic!, part: session.ref! }, step: { kind: 'checkpoint', checkpoint: session.ref! } };
}

/** The tier gate for answering and completing a Learn session. The seal
 * already refused locked content when the session was issued; this catches a
 * session issued while the account was Premium and used after it lapsed. A
 * step the learner already passed stays open for review. */
async function refuseLockedSession(
  res: VercelResponse,
  userId: string | null,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  /** For an answer: a Premium tier this instance read in the last minute
   * stands (lib/access.ts, #587 server item 6). A completion asks again. */
  recentPremium = false,
): Promise<boolean> {
  const { content, step } = sessionContent(session);
  return refuseLocked(res, userId, content, {
    recentPremium,
    cleared: async () => {
      if (!userId || !supabase) return false;
      const row = await withTimeout(supabase.from(PROGRESS_TABLE).select('data').eq('user_id', userId).maybeSingle());
      // A failed read is not "never passed": refuseLocked answers it with 503
      // entitlement_unavailable, not the upgrade sheet for a passed level.
      if (row.error) throw new Error(`progress_unavailable: ${row.error.message}`);
      return stepAlreadyPassed((row.data?.data as VerifiedProgress) ?? {}, session.topic!, step);
    },
  });
}

/** A Learn session answers only to the account it was issued to. The
 * progression guard runs when a step is issued, and only for a signed-in
 * request, so a session fetched without a token (or under another account)
 * must not be answered or completed with one: that would record a level the
 * guard never checked. Signing in or out mid-level lands here too; the client
 * restarts the step under the current sign-in. A session sealed before the
 * owner was recorded reads as a guest's. */
function refuseForeignSession(
  res: VercelResponse,
  session: NonNullable<ReturnType<typeof roadmapSession>>,
  userId: string | null,
): boolean {
  if ((session.userId ?? null) === userId) return false;
  logEvent({ status: 409, kind: 'session_owner_mismatch', topic: session.topic, hasUser: Boolean(userId) });
  jsonError(res, 409, 'session_owner_mismatch', 'This lesson was opened under a different sign-in. Start it again.');
  return true;
}

async function handleAnswer(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapAnswerAddress, RATE_LIMITS.roadmapAnswer))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning progress is not configured');
  const body = (req.body || {}) as {
    sessionId?: unknown; questionId?: unknown; selectedIndex?: unknown;
  };
  const session = roadmapSession(body.sessionId);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Learning session expired or invalid');
  if (
    typeof body.questionId !== 'string' || body.questionId.length > 64 ||
    !Number.isInteger(body.selectedIndex) || Number(body.selectedIndex) < 0 || Number(body.selectedIndex) > 25
  ) return jsonError(res, 400, 'bad_request', 'Question and selected answer are required');
  const sessionQuestion = session.questions.find((question) => question.questionId === body.questionId);
  if (!sessionQuestion) return jsonError(res, 400, 'bad_request', 'Question is not part of this learning session');
  const userId = await optionalAuthSub(req, res);
  if (userId === undefined) return;
  if (refuseForeignSession(res, session, userId)) return;
  if (await refuseLockedSession(res, userId, session, true)) return;

  const selectedIndex = Number(body.selectedIndex);

  // The explanation does not depend on the grade, so it is fetched alongside it
  // rather than after it. The store is cached, but a cold instance pays a read,
  // and paying it in parallel costs nothing.
  const questionsPromise = getEffectiveQuestionsById(session.subject);

  // One round trip. The v2 routine opens the attempt if this is the first
  // answer and runs every check the two-step path ran on the same locked row,
  // so reading the attempt separately first was a second read of it.
  let saved = await withTimeout(
    supabase.rpc('record_roadmap_answer_v2', {
      p_attempt_id: session.attemptId,
      p_user_id: userId,
      p_question_id: body.questionId,
      p_selected_index: selectedIndex,
      p_correct_index: sessionQuestion.correctAnswer,
      p_subject: session.subject,
      p_topic: session.topic,
      p_kind: session.roadmapKind,
      p_ref: session.ref,
      p_total_questions: session.questions.length,
      p_pass_pct: session.roadmapKind === 'level' ? LEVEL_PASS : PART_TEST_PASS,
      p_required_start: session.requiredLevelStart ?? null,
      p_required_end: session.requiredLevelEnd ?? null,
    }),
  );

  // Until migration 034 is applied, fall back to the pair it replaces. Costs a
  // wasted call once per cold instance and nothing after that.
  if (isRpcMissing(saved.error)) {
    const attemptResult = await ensureAttempt(session, userId);
    if (attemptResult.error || !attemptResult.data) {
      if (isRpcMissing(attemptResult.error)) {
        return jsonError(res, 503, 'migration_required', 'Verified learning migration is not installed');
      }
      return jsonError(res, 500, 'db_error', 'Could not start the learning attempt');
    }
    if (!attemptMatches(attemptResult.data as Record<string, unknown>, session, userId)) {
      return jsonError(res, 409, 'attempt_conflict', 'This learning attempt belongs to another session');
    }
    saved = await withTimeout(
      supabase.rpc('record_roadmap_answer', {
        p_attempt_id: session.attemptId,
        p_user_id: userId,
        p_question_id: body.questionId,
        p_selected_index: selectedIndex,
        p_correct_index: sessionQuestion.correctAnswer,
      }),
    );
    if (isRpcMissing(saved.error)) {
      return jsonError(res, 503, 'migration_required', 'Verified learning migration 023 is not installed');
    }
  }

  if (saved.error || !saved.data || typeof saved.data !== 'object') {
    // The routine raises this when the attempt is not the caller's, has expired,
    // is finished, or describes a different lesson than the session does.
    if (/invalid_roadmap_attempt/i.test(saved.error?.message ?? '')) {
      return jsonError(res, 409, 'attempt_conflict', 'This learning attempt belongs to another session');
    }
    return jsonError(res, 500, 'db_error', 'Could not record the answer');
  }
  const stored = saved.data as { selectedIndex?: unknown; correctAnswer?: unknown; isCorrect?: unknown };

  const questions = await questionsPromise;
  const explanation = questions.get(body.questionId)?.explanation ?? '';
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({
    selectedIndex: Number(stored.selectedIndex),
    correctAnswer: Number(stored.correctAnswer),
    isCorrect: stored.isCorrect === true,
    explanation,
  });
}

/** Whether a verified progress blob records this session's level or part test
 * as passed. */
function progressStepPassed(data: unknown, session: NonNullable<ReturnType<typeof roadmapSession>>): boolean {
  const topic = (data as Record<string, { levels?: Record<string, { passed?: unknown }>; checkpoints?: Record<string, { passed?: unknown }> }> | null)?.[session.topic ?? ''];
  const steps = session.roadmapKind === 'level' ? topic?.levels : topic?.checkpoints;
  return steps?.[String(session.ref)]?.passed === true;
}

/** The account's verified progress row. */
function stepRow(userId: string) {
  return withTimeout(supabase!.from(PROGRESS_TABLE).select('data').eq('user_id', userId).maybeSingle());
}

/** The same question asked of the stored progress, or null when it cannot be
 * read (then nothing is credited: a missed credit beats paying twice for a
 * level passed before coins existed). */
async function stepPassed(userId: string, session: NonNullable<ReturnType<typeof roadmapSession>>): Promise<boolean | null> {
  if (!supabase) return null;
  const row = await stepRow(userId).catch(() => null);
  if (!row || row.error) return null;
  return progressStepPassed(row.data?.data, session);
}

async function handleComplete(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapCompleteAddress, RATE_LIMITS.roadmapComplete))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning progress is not configured');
  const body = (req.body || {}) as { sessionId?: unknown };
  const session = roadmapSession(body.sessionId);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Learning session expired or invalid');
  const userId = await optionalAuthSub(req, res);
  if (userId === undefined) return;
  if (refuseForeignSession(res, session, userId)) return;
  // The attempt row, the served question set, the graded answers and, on a
  // code level, the coding rows are independent reads, so they run together
  // once the session's owner is confirmed, and with the tier gate (#587,
  // server item 5: the gate and the coding rows were two more waves). The
  // gate still decides first: an attempt no answer opened is inserted only
  // after it let the session through, and a refused session writes nothing.
  // The answers are used only after the attempt is shown to be this
  // session's, and only when none of its questions was retired.
  const codingUnverified = !userId && (session.codingTaskIds?.length ?? 0) > 0;
  const readsCoding = !codingUnverified && (session.codingTaskIds?.length ?? 0) > 0;
  const locked = refuseLockedSession(res, userId, session);
  // A completion that is recorded settles the milestones, whose every credit
  // sits inside IF is_premium (migration 052): for a Premium account only
  // (#587, server item 8). The plan is read with the first reads (remembered
  // for the request, so a Premium step's gate reads the same answer), and a
  // plan that cannot be read settles: the routine decides.
  const premium = userId ? resolveTier(userId).then((tier) => tier === 'premium') : null;
  premium?.catch(() => {});
  const reads = Promise.all([
    ensureAttempt(session, userId, locked),
    getEffectiveQuestionsById(session.subject),
    withTimeout(
      supabase
        .from('roadmap_attempt_answers')
        .select('question_id,is_correct')
        .eq('attempt_id', session.attemptId!),
    ),
    // Needed only when the questions passed. A failure is kept, and answered
    // below only if they did, as when the rows were read after the grade.
    readsCoding
      ? withTimeout(
        supabase.from('roadmap_attempt_coding').select('task_id,passed,verified,revealed').eq('attempt_id', session.attemptId!),
      ).then((read) => ({ read }), (thrown: unknown) => ({ thrown }))
      : null,
  ]);
  // Read below; a gate that refuses leaves it unread.
  reads.catch(() => {});
  if (await locked) return;
  const [attemptResult, served, answers, codingRead] = await reads;
  if (attemptResult.error || !attemptResult.data) {
    if (isRpcMissing(attemptResult.error)) {
      return jsonError(res, 503, 'migration_required', 'Verified learning migration is not installed');
    }
    return jsonError(res, 500, 'db_error', 'Could not load the learning attempt');
  }
  const attempt = attemptResult.data as Record<string, unknown>;
  if (!attemptMatches(attempt, session, userId)) {
    return jsonError(res, 409, 'attempt_conflict', 'This learning attempt belongs to another session');
  }

  // A question retired while this attempt was open. The verified completion
  // routine grades every sealed question and cannot void one, so the attempt
  // is closed without a verdict instead: nothing is written to the learner's
  // progress, no pass is granted on a flawed item and no fail is recorded for
  // one. The client offers the level again with its current questions.
  const retired = session.questions.filter((q) => !served.has(q.questionId)).map((q) => q.questionId);
  if (retired.length > 0) {
    if (!attempt.completed_at) {
      const closed = await withTimeout(
        supabase
          .from('roadmap_attempts')
          .update({ completed_at: new Date().toISOString(), passed: false })
          .eq('attempt_id', session.attemptId!),
      );
      if (closed.error) return jsonError(res, 500, 'db_error', 'Could not close the learning attempt');
    }
    logEvent({ status: 200, kind: 'invalidated', topic: session.topic, retired: retired.length });
    return res.json({
      correctAnswers: 0,
      totalQuestions: session.questions.length,
      percentage: 0,
      passed: false,
      applied: false,
      codingPending: [],
      invalidated: { reason: 'content_retired', questionIds: retired },
    });
  }
  if (answers.error) return jsonError(res, 500, 'db_error', 'Could not grade the learning attempt');
  const graded = answers.data ?? [];
  const correctAnswers = graded.filter((answer) => answer.is_correct === true).length;
  const totalQuestions = session.questions.length;
  const percentage = Math.round((correctAnswers / totalQuestions) * 100);
  const passPct = Number(attempt.pass_pct);
  let passed = percentage >= passPct;
  // A level ends the moment the learner spends their last heart, which normally
  // leaves the remaining questions unanswered. That lesson is over and failed:
  // the verified RPC only completes a full answer set, so this attempt is closed
  // here instead — otherwise the learner is stuck on an error they cannot clear.
  // The unanswered questions still count against the percentage.
  const endedOnHearts = roadmapEndedOnHearts(
    session.roadmapKind,
    graded.length,
    graded.filter((answer) => answer.is_correct === false).length,
    totalQuestions,
  );
  if (endedOnHearts) passed = false;
  // A level with coding tasks passes only when every one of them passed in
  // this attempt without its solution being revealed, the rule
  // complete_verified_roadmap_attempt applies from migration 047: a reveal
  // ends the attempt, and the task is passed again in a fresh one.
  //
  // A guest's coding passes are never stored, so for a guest that rule could
  // only ever fail the level. A guest's level passes on its questions and the
  // response says the coding was not verified; nothing is recorded for a
  // guest here, and the browser keeps the pass locally until they sign in.
  let codingPending: string[] = [];
  if (passed && session.codingTaskIds && codingRead) {
    if ('thrown' in codingRead) throw codingRead.thrown;
    const codingRows = codingRead.read;
    if (codingRows.error) return jsonError(res, 500, 'db_error', 'Could not grade the coding tasks');
    const passedIds = new Set((codingRows.data ?? [])
      .filter((row) => row.passed === true && row.verified === true && row.revealed !== true)
      .map((row) => String(row.task_id)));
    codingPending = session.codingTaskIds.filter((id) => !passedIds.has(id));
    if (codingPending.length > 0) passed = false;
    const revealed = (codingRows.data ?? []).some(row => session.codingTaskIds!.includes(String(row.task_id)) && row.revealed === true);
    if (codingPending.length > 0 && !revealed && graded.length === totalQuestions && !attempt.completed_at) {
      return res.json({ correctAnswers, totalQuestions, percentage, passed: false, applied: false, waiting: true, codingPending });
    }
  }

  // The concept items this attempt graded, and the learner's review state
  // for them. The state is read while the completion runs: the completion
  // never writes it, and the review is recorded from it at the end.
  const reviewSubject = userId && isScopeSubject(session.subject) ? session.subject : null;
  const reviewItems = reviewSubject
    ? graded.flatMap((answer) => {
      const question = served.get(String(answer.question_id));
      if (!question) return [];
      return [{
        itemId: question.id,
        itemVersion: contentVersion(question),
        category: question.category,
        tags: question.tags,
        correct: answer.is_correct === true,
        kind: 'independent' as const,
      }];
    })
    : [];
  // Most items name no concept, and an attempt whose items name none has
  // nothing to record, so its state is not read at all.
  const reviewStates = userId && reviewSubject && reviewItems.some((item) => conceptOf(item) !== null)
    ? loadReviewStates(supabase, userId, reviewSubject)
    : null;
  // Concept-level review state, from the answers the server itself graded.
  //
  // Levels are where a devShark learner spends most of their time, so leaving
  // this out left spaced practice inert for them: nothing was ever due, and
  // Review had nothing to offer. Recorded here rather than per answer because
  // the interval belongs to the concept and a level asking `reduce` three times
  // is one review of `reduce`, not three; the attempt id makes it idempotent,
  // so a retried completion reports the stored state and changes nothing.
  //
  // Every answer counts as independent retrieval: a level has no hint
  // affordance, so unlike a quiz there is nothing to downgrade. Questions left
  // unanswered when the hearts ran out are simply absent from the graded rows
  // and are not recorded as failures — they were not attempted.
  //
  // Started once the attempt is closed, beside what else follows the close
  // (#587, server item 5), and awaited before the answer, since a function
  // can be frozen the moment it responds.
  let reviewsRecorded: Promise<void> | null = null;
  const recordReviews = (): Promise<void> => {
    reviewsRecorded ??= userId && reviewSubject && reviewStates
      ? reviewStates.then((states) => recordConceptReviews(
        supabase,
        { userId, subject: reviewSubject, eventId: session.attemptId!, items: reviewItems },
        states,
      ))
      : Promise.resolve();
    // Awaited below; this keeps a failure of the request meanwhile from
    // leaving it unhandled.
    reviewsRecorded.catch(() => {});
    return reviewsRecorded;
  };

  let progress: unknown;
  let applied = false;
  let repeatXp: LearnRepeatXp | null = null;
  if (endedOnHearts) {
    const close = userId && !attempt.completed_at
      ? await withTimeout(supabase.rpc('complete_roadmap_attempt_on_hearts', {
        p_user_id: userId,
        p_attempt_id: session.attemptId,
      }))
      : null;
    if (userId && close && close.error?.code !== 'PGRST202') {
      if (/invalid_roadmap_attempt/i.test(close.error?.message ?? '')) {
        return jsonError(res, 409, 'invalid_session', 'This learning attempt expired. Start the lesson again.');
      }
      if (/incomplete_roadmap_attempt/i.test(close.error?.message ?? '')) {
        return jsonError(res, 409, 'incomplete_attempt', 'The learning attempt changed. Try completing it again.');
      }
      if (close.error) return jsonError(res, 503, 'progress_unavailable', 'Could not close the learning attempt. Try again.');
      applied = close.data === true;
      recordReviews();
      if (applied) await settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!);
    } else if (!attempt.completed_at) {
      // Guests and deployments before migration 076 use the original close.
      const closed = await withTimeout(
        supabase
          .from('roadmap_attempts')
          .update({ completed_at: new Date().toISOString(), score_pct: percentage, passed: false })
          .eq('attempt_id', session.attemptId!),
      );
      if (closed.error) return jsonError(res, 500, 'db_error', 'Could not close the learning attempt');
      applied = true;
      recordReviews();
      // A Learn level counts for the streak whether it was passed, failed or
      // lost on hearts. complete_verified_roadmap_attempt advances the streak
      // for the other two; this attempt closes without it, so the day is
      // counted here, once, by the request that closed it. Before migration
      // 048 the routine does not exist and the level simply does not count.
      if (userId) {
        const streak = await withTimeout(supabase.rpc('advance_verified_streak', { p_user_id: userId })).catch(() => null);
        if (!streak || streak.error) {
          if (!isRpcMissing(streak?.error)) {
            logEvent({ status: 500, kind: 'streak_failed', reason: streak?.error?.code ?? 'timeout' });
          }
        } else {
          await settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!);
        }
      }
    }
  } else if (userId) {
    // Only a first pass earns a step's learning XP, so only a first pass
    // credits coins (#227). From migration 060 the completion says whether
    // it was the step's first pass, read under the progress lock it holds
    // while recording it; before 060 the record is read here, before the
    // completion writes the pass.
    const completion = {
      p_user_id: userId,
      p_attempt_id: session.attemptId,
      p_coding_task_ids: session.codingTaskIds ?? null,
    };
    // From migration 060 the completion also pays a replayed step its XP
    // again, an hour after the step last paid (owner decision of 9 Oct
    // 2026), and says so. Before 060 the completion of 056 answers alone.
    const { coins: coinSettings } = await getGameSettings();
    let completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt_v3', {
      ...completion,
      p_coin_rate: coinSettings.xpRate,
      p_coin_multiplier: coinSettings.premiumMultiplier,
      p_coin_daily_cap: coinSettings.dailyXpCap,
    }));
    // Only a missing entrypoint permits the non-atomic compatibility path.
    const legacyCompletion = completed.error?.code === 'PGRST202';
    let passedBefore: boolean | null = null;
    if (legacyCompletion) {
      completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt_v2', completion));
      if (completed.error?.code === 'PGRST202') {
        if (passed) passedBefore = await stepPassed(userId, session);
        completed = await withTimeout(supabase.rpc('complete_verified_roadmap_attempt', completion));
      }
    }
    if (completed.error) {
      if (completed.error.code === 'PGRST202') {
        return jsonError(res, 503, 'migration_required', 'Verified learning migration is not installed');
      }
      if (/incomplete_roadmap_attempt/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'incomplete_attempt', 'Answer every question before completing this lesson');
      }
      if (/roadmap_prerequisite_not_met/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'prerequisite_not_met', 'Complete the preceding learning steps first');
      }
      // The routine refuses an attempt that ran past its two hours (the
      // owner was checked above), which the learner fixes by starting the
      // level again, as the attempt-status check tells them.
      if (/invalid_roadmap_attempt/i.test(completed.error.message ?? '')) {
        return jsonError(res, 409, 'invalid_session', 'This learning attempt expired. Start the lesson again.');
      }
      return jsonError(res, 503, 'progress_unavailable', 'Could not save learning progress. Try again.');
    }
    const outcome = completed.data as { applied?: unknown; repeatXp?: unknown; firstPass?: unknown } | boolean | null;
    applied = typeof outcome === 'object' && outcome !== null ? outcome.applied === true : outcome === true;
    // XP only: a repeat credits no coins and is no first pass.
    repeatXp = typeof outcome === 'object' && outcome !== null ? learnRepeatXpOf(outcome.repeatXp) : null;
    const firstPass = typeof outcome === 'object' && outcome !== null ? outcome.firstPass === true : passedBefore === false;
    // What follows a recorded completion ran one call after another: the
    // reload, the coin credit, the referral, the milestones and the concept
    // reviews (#587, server item 5). Only the reload feeds the answer, and
    // each routine is idempotent under its own event id, so they run as
    // three branches at once: the reload, then the first pass's referral
    // and, before 076, its coins. The milestone settlement and concept reviews
    // run beside the reload. The settlement and the
    // reviews read nothing the credits write that this answer reports.
    //
    // A completed level or part test is a streak day from migration 048, passed
    // or not, and the last level of a topic is a Premium milestone.
    const settled = applied ? settleMilestonesAfterPass(supabase, userId, session.subject!, () => premium!) : null;
    settled?.catch(() => {});
    recordReviews();
    const followers = () => Promise.allSettled([settled, reviewsRecorded]);
    let row: Awaited<ReturnType<typeof stepRow>>;
    try {
      row = await stepRow(userId);
    } catch (error) {
      await followers();
      throw error;
    }
    if (row.error) {
      await followers();
      return jsonError(res, 500, 'db_error', 'Progress saved but could not be reloaded');
    }
    progress = sanitize(row.data?.data);
    if (applied && firstPass && progressStepPassed(row.data?.data, session)) {
      const coins = legacyCompletion ? creditLearnPass(supabase, {
        userId,
        subject: session.subject!,
        topic: session.topic!,
        kind: session.roadmapKind!,
        ref: session.ref!,
      }) : null;
      coins?.catch(() => {});
      try {
        // A friend's first passed Learn level pays both sides of an invitation
        // once; the routine reads the verified progress itself (#228). It
        // runs while the coin credit does.
        await creditReferral(supabase, userId, session.subject!);
        await coins;
      } catch (error) {
        await followers();
        throw error;
      }
    }
    await settled;
  } else if (!attempt.completed_at) {
    await withTimeout(
      supabase.from('roadmap_attempts').update({ completed_at: new Date().toISOString() }).eq('attempt_id', session.attemptId!),
    );
    applied = true;
  }

  await recordReviews();

  logEvent({ status: 200, kind: 'complete', topic: session.topic, passed, hasUser: !!userId, codingPending: codingPending.length, codingUnverified, outOfHearts: endedOnHearts, repeatXp: repeatXp?.xp ?? null });
  return res.json({
    correctAnswers, totalQuestions, percentage, passed, applied, codingPending,
    ...(codingUnverified ? { codingUnverified: true } : {}),
    ...(progress ? { progress } : {}),
    ...(repeatXp ? { repeatXp } : {}),
  });
}

/** Read-only: a tab returning from a linked coding task checks this attempt. */
async function handleAttemptStatus(req: VercelRequest, res: VercelResponse) {
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.roadmapCompleteAddress, RATE_LIMITS.roadmapComplete))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning progress is not configured');
  const session = roadmapSession((req.body as { sessionId?: unknown } | undefined)?.sessionId);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Learning session expired or invalid');
  const userId = await optionalAuthSub(req, res);
  if (userId === undefined || refuseForeignSession(res, session, userId)) return;
  const [attempt, coding] = await Promise.all([
    withTimeout(supabase.from('roadmap_attempts').select('attempt_id,user_id,subject,topic,kind,ref,total_questions,required_level_start,required_level_end,completed_at,expires_at').eq('attempt_id', session.attemptId!).maybeSingle()),
    withTimeout(supabase.from('roadmap_attempt_coding').select('task_id,passed,verified,revealed').eq('attempt_id', session.attemptId!)),
  ]);
  if (attempt.error || coding.error) return jsonError(res, 503, 'progress_unavailable', 'Could not load the learning attempt. Try again.');
  if (!attempt.data || !attemptMatches(attempt.data, session, userId) || Date.parse(attempt.data.expires_at) <= Date.now()) return jsonError(res, 409, 'invalid_session', 'This learning attempt expired. Start the lesson again.');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ completed: Boolean(attempt.data.completed_at), coding: (coding.data ?? []).filter(row => session.codingTaskIds?.includes(String(row.task_id))).map(row => ({ taskId: String(row.task_id), passed: row.passed === true && row.verified === true && row.revealed !== true, revealed: row.revealed === true })) });
}

/* ──── the learning-path catalogue in the CDN ───────────────────────────── */

/** The FDE catalogue is the same for every caller: the published manifests,
 * their versions and each path's availability, which follows the
 * deployment's switch and this instance's storage check, never the caller's
 * token or address (lib/learning-paths/handlers.ts). Its handler answers
 * `public, max-age=60, stale-while-revalidate=600` without s-maxage, which
 * kept it out of the Vercel CDN, so every browser miss ran this function and
 * sent about 30 KB gzip (#587, server item 12). The router lets the CDN share
 * it for five minutes, as the Learn map is shared for one; browsers keep
 * their minute. Bounded trade-off: an availability flip after a deploy (a
 * storage migration found missing by one instance) reaches every browser up
 * to five minutes later. Only the handler's public header is replaced; a
 * refusal keeps the private default of withRequestContext. */
export const LEARNING_PATH_CATALOG_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';
function shareCatalogWithCdn(res: VercelResponse): VercelResponse {
  const setHeader = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) =>
    setHeader(name, name.toLowerCase() === 'cache-control' && /^public\b/.test(String(value)) ? LEARNING_PATH_CATALOG_CACHE : value)) as typeof res.setHeader;
  return res;
}

/* ──── handler ──────────────────────────────────────────────────────────── */

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();

  // Coding challenges share this function (twelve-function budget):
  //   GET  ?resource=coding-task&id=     → a playable task with its sealed session
  //   GET  ?resource=coding-brief&id=    → the task's brief alone, public and cached (#587 C23)
  //   GET  ?resource=coding-state&id=    → the caller's part alone: session, lock, progress, draft
  //   POST ?resource=coding-submit       → server grading (every track)
  //   POST ?resource=coding-reveal       → the reference solution after a pass or give-up
  //   POST ?resource=coding-reset        → Reset, signed in: opens the task's repeat XP
  const resource = typeof req.query.resource === 'string' ? req.query.resource : '';
  if (resource.startsWith('coding-')) {
    try {
      if (resource === 'coding-task' && (req.method === 'GET' || req.method === 'POST')) return await handleCodingTask(req, res, supabase);
      if (resource === 'coding-brief' && req.method === 'GET') return await handleCodingBrief(req, res);
      if (resource === 'coding-state' && req.method === 'GET') return await handleCodingState(req, res, supabase);
      if (resource === 'coding-submit' && req.method === 'POST') return await handleCodingSubmit(req, res, supabase);
      if (resource === 'coding-reveal' && req.method === 'POST') return await handleCodingReveal(req, res, supabase);
      if (resource === 'coding-reset' && req.method === 'POST') return await handleCodingReset(req, res, supabase);
      if (resource === 'coding-approaches' && req.method === 'GET') return await handleCodingApproaches(req, res, supabase);
      res.setHeader('Allow', resource === 'coding-task' ? 'GET, POST' : ['coding-approaches', 'coding-brief', 'coding-state'].includes(resource) ? 'GET' : 'POST');
      return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
    } catch (error) {
      if (error instanceof ServiceUnavailableError) return jsonError(res, 503, error.code, error.message);
      logEvent({ status: 500, kind: 'coding_error', resource, category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not handle the coding request');
    }
  }

  // Learning paths share this function too (twelve-function budget):
  //   GET  ?resource=learning-path-catalog → the published manifests, guests included
  //   POST ?resource=learning-path-start   → an attempt, its sealed session and safe payload
  //   POST ?resource=learning-path-submit  → server grading and the recorded evidence
  if (resource.startsWith('learning-path-')) {
    try {
      if (resource === 'learning-path-catalog') return await handleLearningPathCatalog(req, shareCatalogWithCdn(res));
      if (resource === 'learning-path-start') return await handleActivityStart(req, res, supabase);
      if (resource === 'learning-path-submit') return await handleActivitySubmit(req, res, supabase);
      return jsonError(res, 404, 'not_found', 'Unknown learning-path resource');
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      logEvent({ status: 500, kind: 'learning_path_error', resource, category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not handle the learning-path request');
    }
  }

  // The lesson a Learn level opens with (#492): public reading, guests
  // included, the Learn map's address limit and an ETag of the content hash
  // (lib/learn-lessons/serve.ts).
  if (resource === 'lesson') return await handleLessonRead(req, res);

  if (req.method === 'POST' && req.query.resource === 'answer') {
    try {
      return await handleAnswer(req, res);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      logEvent({ status: 500, kind: 'answer_error', category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not record the answer');
    }
  }
  if (req.method === 'POST' && req.query.resource === 'complete') {
    try {
      return await handleComplete(req, res);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      logEvent({ status: 500, kind: 'complete_error', category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not complete the learning attempt');
    }
  }
  if (req.method === 'POST' && resource === 'attempt-status') return handleAttemptStatus(req, res);
  if (req.method === 'POST' && req.query.resource === 'skill-check') {
    try {
      return await handleSkillCheck(req, res);
    } catch (error) {
      logEvent({ status: 500, kind: 'skill_check_error', category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not apply assessment unlocks');
    }
  }
  // The learner's plan, what is open in it and the single next step. One
  // answer, so the roadmap, Today and the navigation cannot disagree about
  // what is eligible — and none of them has to recompute it from local state.
  if (req.method === 'GET' && req.query.resource === 'eligibility') {
    if (!(await limitRead(req, res))) return;
    try {
      // The served set is the same for everyone, so it loads while the
      // learner's plan and record are read rather than after them.
      const [learner, byId] = await Promise.all([learnerContext(req, res), getEffectiveQuestionsById()]);
      if (learner === undefined) return;
      const exists = (id: string) => byId.has(id);
      const structure = liveRoadmapStructure(exists);
      const levelCount = (topic: string) => (structure as Record<string, { levels: unknown[] } | undefined>)[topic]?.levels.length ?? 0;
      const availabilityOf = (topic: string) => (isRoadmapTopic(topic) ? liveAvailability(buildLiveTopic(topic, exists)) : {});
      const subjects = deploymentSubjectIds();
      const profile = learner?.profile ?? null;
      const missing = missingProfileFields(profile);
      const plans = subjects.map((subject) => {
        const progress = learner?.progress ?? {};
        const extra = learner?.extraUnlocked ?? [];
        return {
          subject,
          topics: eligibleTopics(profile, subject, progress, extra),
          next: nextEligibleStep(profile, subject, progress, levelCount, extra, availabilityOf),
        };
      });
      res.setHeader('Cache-Control', 'private, no-store');
      logEvent({ status: 200, kind: 'eligibility', latency_ms: Date.now() - started });
      return res.json({
        signedIn: Boolean(learner),
        profileComplete: isLearnerProfileComplete(profile),
        missingProfileFields: missing,
        plan: profile
          ? { baseTrack: profile.baseTrack, specialization: profile.specialization }
          : null,
        plans,
      });
    } catch (error) {
      logEvent({ status: 500, kind: 'eligibility_error', category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not load what is available');
    }
  }

  if (req.query.resource === 'placement') {
    if (req.method === 'GET') {
      try {
        return await handlePlacementStart(req, res);
      } catch (error) {
        logEvent({ status: 500, kind: 'placement_start_error', category: error instanceof Error ? error.name : 'unknown' });
        return jsonError(res, 500, 'internal_error', 'Could not start placement');
      }
    }
    if (req.method === 'POST') {
      try {
        return await handlePlacementRound(req, res);
      } catch (error) {
        if (error instanceof ServiceUnavailableError) return jsonError(res, 503, error.code, error.message);
        logEvent({ status: 500, kind: 'placement_round_error', category: error instanceof Error ? error.name : 'unknown' });
        return jsonError(res, 500, 'internal_error', 'Could not grade the placement round');
      }
    }
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  // Per-user progress sub-resource (auth-gated): GET ?resource=progress. The
  // server writes progress itself, on each completion. A PUT that used to sit
  // here answered with this read and wrote nothing, so it answers 405 now.
  if (req.method === 'GET' && req.query.resource === 'progress') {
    try {
      if (!(await limitRead(req, res))) return;
      return await handleProgress(req, res);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      return jsonError(res, 500, 'internal_error', 'Internal error');
    }
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const topicRaw = (req.query.topic as string) || '';
  const levelRaw = req.query.level as string | undefined;
  const checkpointRaw = req.query.checkpoint as string | undefined;
  const testRaw = req.query.test as string | undefined;

  // No topic → return the whole map so the client can render the path.
  if (!topicRaw && levelRaw === undefined && checkpointRaw === undefined && testRaw === undefined) {
    // The same for everyone, so only the address tier: verifying a token
    // here would cost a round trip the map never needed.
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.readAddress))) return;
    const [byId, { levelCodingTasks }] = await Promise.all([getEffectiveQuestionsById(), learnCoding()]);
    const exists = (id: string) => byId.has(id);
    const topics = deploymentSubjectIds().flatMap((subject) => [...SUBJECT_SCOPE_CATALOG[subject].topics]);
    const topicSet = new Set<string>(topics);
    const structure = Object.fromEntries(
      Object.entries(liveRoadmapStructure(exists))
        .filter(([topic]) => topicSet.has(topic))
        .map(([topic, live]) => {
          const withCounts = withCodingCounts(topic, live, levelCodingTasks);
          const unavailableParts = unavailablePartsOf(withCounts.levels);
          return [topic, unavailableParts.length > 0 ? { ...withCounts, unavailableParts } : withCounts];
        }),
    );
    // The map is the same for every caller, so the CDN may share it: one
    // function run per minute per region instead of one per Learn visit.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    logEvent({ status: 200, kind: 'structure', latency_ms: Date.now() - started });
    return res.json({ topics, structure });
  }

  if (!isRoadmapTopic(topicRaw) || !isDeploymentTopic(topicRaw)) {
    return jsonError(res, 400, 'bad_request', 'Unknown topic');
  }
  const topic: RoadmapTopic = topicRaw;
  const subject = subjectForTopic(topic)!;
  // A coding level can persist its parent attempt while it opens. The part
  // tests, checkpoints and topics without coding only deal a sealed session.
  if (supabase && isLearnCodingTopic(topic) && levelRaw !== undefined && testRaw === undefined && checkpointRaw === undefined) {
    requireFreshAuth(req);
  }
  if (!(await limitRead(req, res))) return;
  // One read of the learner's plan and verified record, shared by the three
  // step branches below. A guest has neither, and takes the preview path.
  // The served question set does not depend on who asks, so it loads at the
  // same time instead of waiting for the record.
  // The tier of a Premium step is read with them too (#587, server item 6),
  // for the gate below, which still decides only after the progression one.
  const [learner, byId] = await Promise.all([
    learnerContext(req, res),
    getEffectiveQuestionsById(subject),
    prefetchStepTier(req, topic, testRaw ?? checkpointRaw, testRaw ?? checkpointRaw ?? levelRaw),
  ]);
  if (learner === undefined) return;
  const exists = (id: string) => byId.has(id);
  const live = buildLiveTopic(topic, exists);
  const availability = liveAvailability(live);
  const refuse = (step: StepRequest) => {
    if (!learner) return false;
    const refusal = stepRefusal(learner, subject, topic, step, availability);
    if (!refusal) return false;
    logEvent({ status: 403, kind: 'not_eligible', topic, reason: refusal.code });
    jsonError(res, 403, refusal.code, refusal.message);
    return true;
  };
  // The tier seal, after the progression one: a step the learner may reach is
  // still refused with 402 when Premium opens it and the account is free. A
  // step already passed stays open, so a lapsed account can review it.
  const refusePremium = async (content: GatedContent, cleared: ProgressStep) => {
    const refused = await refuseLocked(res, learner?.userId ?? null, content, {
      cleared: async () => Boolean(learner && stepAlreadyPassed(learner.progress, topic, cleared)),
    });
    if (refused) logEvent({ status: res.statusCode, kind: 'premium_required', topic });
    return refused;
  };

  // ── Part test (a focused exam over one of the topic's 3 parts) ────────────
  // A part is a contiguous slice of the topic's (live) levels; the test samples
  // up to PART_TEST_SIZE questions from across that slice and grades at 85%.
  if (testRaw !== undefined) {
    const part = parseInt(testRaw, 10);
    if (!isValidPart(part)) return jsonError(res, 400, 'bad_request', 'Invalid test');
    const range = partRanges(live.levels.length).find((r) => r.part === part);
    if (!range || range.size <= 0) return jsonError(res, 400, 'bad_request', 'Invalid test');
    if (live.unavailableParts.has(part)) {
      logEvent({ status: 409, kind: 'unavailable', topic, part });
      return jsonError(res, 409, STEP_UNAVAILABLE.code, STEP_UNAVAILABLE.message);
    }
    if (refuse({ kind: 'test', part, from: range.startLevel, to: range.endLevel })) return;
    if (await refusePremium({ kind: 'learn-part-test', topic, part }, { kind: 'checkpoint', checkpoint: part })) return;

    const pool: string[] = [];
    for (let l = range.startLevel; l <= range.endLevel; l++) {
      pool.push(...(live.levelIds[l - 1] ?? []));
    }
    const ids = secureShuffle(pool).slice(0, PART_TEST_SIZE);
    const playable = await playableResponse({
      kind: 'checkpoint', topic, ref: part, title: `Part ${part}`,
      passPct: PART_TEST_PASS, ids, byId, userId: learner?.userId ?? null,
      ...requiredRange(availability, range.startLevel, range.endLevel),
    });
    if (!playable || playable.questions.length === 0) return jsonError(res, 404, 'no_questions', 'No questions for this test');

    res.setHeader('Cache-Control', 'private, no-store');
    logEvent({ status: 200, kind: 'test', topic, part, count: playable.questions.length, latency_ms: Date.now() - started });
    return res.json({
      ...playable,
    });
  }

  // ── Checkpoint exam ───────────────────────────────────────────────────────
  // The older name for a part test. Checkpoint *n* is recorded as the test of
  // part *n* — the progress record has only ever had one `checkpoints` map —
  // so this serves exactly what `?test=n` serves, over the part's levels.
  // Serving the authored five-level block here would grade an exam the map
  // never offered and record it under a number that means something else.
  if (checkpointRaw !== undefined) {
    const checkpoint = parseInt(checkpointRaw, 10);
    if (!isValidPart(checkpoint)) return jsonError(res, 400, 'bad_request', 'Invalid checkpoint');
    const range = partRanges(live.levels.length).find((r) => r.part === checkpoint);
    if (!range || range.size <= 0) return jsonError(res, 400, 'bad_request', 'Invalid checkpoint');
    if (live.unavailableParts.has(checkpoint)) {
      logEvent({ status: 409, kind: 'unavailable', topic, checkpoint });
      return jsonError(res, 409, STEP_UNAVAILABLE.code, STEP_UNAVAILABLE.message);
    }
    if (refuse({ kind: 'checkpoint', checkpoint })) return;
    if (await refusePremium({ kind: 'learn-part-test', topic, part: checkpoint }, { kind: 'checkpoint', checkpoint })) return;

    const pool: string[] = [];
    for (let l = range.startLevel; l <= range.endLevel; l++) pool.push(...(live.levelIds[l - 1] ?? []));
    const ids = secureShuffle(pool).slice(0, PART_TEST_SIZE);
    const playable = await playableResponse({
      kind: 'checkpoint', topic, ref: checkpoint, title: `Part ${checkpoint}`,
      passPct: PART_TEST_PASS, ids, byId, userId: learner?.userId ?? null,
      ...requiredRange(availability, range.startLevel, range.endLevel),
    });
    if (!playable || playable.questions.length === 0) {
      return jsonError(res, 404, 'no_questions', 'No questions for this checkpoint');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    logEvent({ status: 200, kind: 'checkpoint', topic, checkpoint, count: playable.questions.length, latency_ms: Date.now() - started });
    return res.json({
      ...playable,
    });
  }

  // ── Level lesson (the surviving questions for that level) ─────────────────
  const level = parseInt(levelRaw ?? '', 10);
  const meta = live.levels.find((l) => l.level === level);
  if (!meta) return jsonError(res, 400, 'bad_request', 'Invalid level');
  if (meta.unavailable) {
    logEvent({ status: 409, kind: 'unavailable', topic, level });
    return jsonError(res, 409, STEP_UNAVAILABLE.code, STEP_UNAVAILABLE.message);
  }
  if (refuse({ kind: 'level', level })) return;
  if (await refusePremium({ kind: 'learn-level', topic, level }, { kind: 'level', level })) return;

  // The completion routine re-checks the prerequisite in SQL by level number,
  // so it is told the nearest *available* level before this one: an
  // unavailable level is stepped over there exactly as the map steps over it.
  const required = isBigOIntroduction(topic, level) ? null : previousAvailable(availability, level);
  const playable = await playableResponse({
    kind: 'level', topic, ref: meta.level, title: meta.title,
    difficulty: meta.difficulty, passPct: LEVEL_PASS,
    ids: live.levelIds[level - 1] ?? [], byId, userId: learner?.userId ?? null,
    ...(required !== null ? { requiredLevelStart: required, requiredLevelEnd: required } : {}),
  });
  if (!playable || playable.questions.length === 0) {
    return jsonError(res, 404, 'no_questions', 'No questions for this level');
  }

  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({ status: 200, kind: 'level', topic, level, count: playable.questions.length, latency_ms: Date.now() - started });
  return res.json({
    ...playable,
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
