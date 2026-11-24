import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { sendPublicJson } from '../../lib/public-json';
import { buildQuestions } from '../../lib/roadmap/payload';
import { logEvent, supabase, optionalAuthSub, PROGRESS_TABLE } from '../../lib/roadmap/runtime';
import { roadmapSession, ensureAttempt, attemptMatches, refuseLocked, refuseLockedSession, refuseForeignSession } from '../../lib/roadmap/session';
import type { ProgressBlob } from '../../lib/roadmap/progress-state';
export { sanitize } from '../../lib/roadmap/progress-state';
import { randomBytes } from 'node:crypto';
import { secureShuffle, type Question } from '../../lib/quiz-runtime';
import {
  decodeQuizResultReceipt,
  encodeSession,
} from '../../lib/quiz-tokens';
import {
  jsonError,
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
import { enforceClassRateLimit, enforceRateLimit, limitRead, RATE_LIMITS } from '../../lib/rate-limit';
import { deploymentSubjectIds, isDeploymentTopic } from '../../lib/product-scope';
import { isLearnCodingTopic, type CodingTask } from '../../shared/coding-catalog';
import type { RoadmapTopicStructure } from '../../lib/roadmap';
import { SUBJECT_SCOPE_CATALOG } from '../../shared/subject-catalog';
import { subjectForCategory, subjectForTopic } from '../../shared/subject-catalog';
import {
  assessmentUnlocks,
  ASSESSMENT_QUESTION_COUNT,
} from '../../shared/assessment';
import {
  buildLiveTopic,
  liveRoadmapStructure,
  liveAvailability,
  unavailablePartsOf,
  isRoadmapTopic,
  ROADMAP_TOPICS,
  LEVELS_PER_CHECKPOINT,
  LEVEL_PASS,
  partRanges,
  isValidPart,
  PART_TEST_PASS,
  PART_TEST_SIZE,
  type RoadmapTopic,
} from '../../lib/roadmap';
import { isBigOIntroduction, type GatedContent } from '../../shared/tiers';

// Modules only some resources need load on their first use, not with this
// function (#587, server item 4). Statically imported, every new instance
// evaluated the coding catalogue with its reference solutions, QuickJS and the
// learning-path handlers (with TypeScript) before it answered a progress read
// or a Learn answer: about 350 ms of import. The names and the dispatch lines
// are the same as with static imports.
// The map needs lesson IDs, but only a lesson read needs the full text.
const handleComplete = lazyExport(() => import('../../lib/roadmap/completion'), 'handleComplete');
const handleLessonRead = lazyExport(() => import('../../lib/learn-lessons/serve'), 'handleLessonRead');
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
const placementHandlers = () => import('../../lib/roadmap/placement');
const handlePlacementStart = lazyExport(placementHandlers, 'handlePlacementStart');
const handlePlacementRound = lazyExport(placementHandlers, 'handlePlacementRound');
// The tier check reads an index over the coding catalogue (lib/access.ts).
const prefetchTier = lazyExport(() => import('../../lib/access'), 'prefetchTier');
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
function shareCatalogWithCdn(req: VercelRequest, res: VercelResponse): VercelResponse {
  const setHeader = res.setHeader.bind(res);
  let publicCatalog = false;
  res.setHeader = (name, value) => {
    if (name.toLowerCase() === 'cache-control') {
      publicCatalog = /^public\b/.test(String(value));
      return setHeader(name, publicCatalog ? LEARNING_PATH_CATALOG_CACHE : value);
    }
    return setHeader(name, value);
  };
  const json = res.json;
  res.json = (body) => {
    res.json = json;
    // Refusals retain the original writer and private policy. The shared
    // sender sees only the catalogue's completed public success projection.
    return publicCatalog && (res.statusCode ?? 200) === 200
      ? sendPublicJson(req, res, body) ?? res
      : json.call(res, body);
  };
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
      if (resource === 'learning-path-catalog') return await handleLearningPathCatalog(req, shareCatalogWithCdn(req, res));
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
      if (error instanceof ServiceUnavailableError) throw error;
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
      if (error instanceof ServiceUnavailableError) throw error;
      logEvent({ status: 500, kind: 'eligibility_error', category: error instanceof Error ? error.name : 'unknown' });
      return jsonError(res, 500, 'internal_error', 'Could not load what is available');
    }
  }

  if (req.query.resource === 'placement') {
    if (req.method === 'GET') {
      try {
        return await handlePlacementStart(req, res);
      } catch (error) {
        if (error instanceof ServiceUnavailableError) throw error;
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
    return sendPublicJson(req, res, { topics, structure });
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
