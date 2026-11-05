/** Coding-challenge API resources. Mounted on the existing handlers to keep
 * the twelve-function budget: `api/quiz/roadmap.ts` serves coding-task,
 * coding-submit and coding-reveal; `api/user/[op].ts` serves
 * coding-progress and coding-draft. The server grades JavaScript and
 * TypeScript in the QuickJS sandbox and system design against the sealed key;
 * React submissions run authoritative suites in isolated server-side VMs. */

import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { AuthError } from '../auth';
import { isRpcMissing, jsonError, createLogger, requireAuthSub, tryAuthOnce, verifiedCallerId, withTimeout } from '../http';
import { claimOnce, enforceAddressRateLimit, enforceClassRateLimit, enforcePerItemRateLimit, enforceRateLimit, enterInFlight, RATE_LIMITS } from '../rate-limit';
import { deploymentSubjectIds } from '../product-scope';
import { secureShuffle } from '../quiz-runtime';
import { decodeCodingSession, type CodingSession } from '../quiz-tokens';
import { codingTaskForHistory, playable } from './catalog';
import { CODING_SUMMARIES, codingTaskById, isHiddenCodingTask } from './active';
import { createCodingSession, codingAttemptVersion } from './session';
import { codingTaskReview } from '../curation';
import { assessComplexity } from './complexity';
import { codingPassXp, type ComplexityReport } from '../../shared/coding-complexity';
import { solutionFor } from './solutions';
import { splitHiddenCases, withHiddenCases } from './react-hidden';
import { runChecks, warmSandbox } from './sandbox';
import { runtimePolicyForTask } from '../../shared/coding-task-runtime';
import { checkTypes, TRANSPILE_FAILED_MESSAGE, TYPE_CHECK_STOPPED_MESSAGE } from './ts-check-pool';
import { GRADING_PER_CALLER, GRADING_PER_TASK, GraderBusyError, gradingItem } from './grader-capacity';
import { codeOutcome, giveUpAfter, gradeDesign, ladderLength, prepareDesign } from './grade';
import { classifyFailure, failureHint, isSyntaxError, jsonKind } from '../../shared/coding-failure';
import { afterCodingPass } from '../github-garden';
import { approachesFor } from './approaches';
import { evolvingPassed, evolvingStage, evolvingUnlocked } from '../../shared/evolving';
import { codingContent, contentTier, type GatedContent } from '../../shared/tiers';
import { refuseLocked, resolveTier, serverContentIndex } from '../access';
import { codingAwardId, creditVerifiedXp, settleMilestonesAfterPass } from '../rewards/coins';
import { prepareEvolvingDraft } from '../../shared/coding-fullstack-support';
import { presentPuzzle, puzzleFor, resolvePuzzleOrder } from './puzzles';
import { isAcceptedOrder, isCompleteOrder, PUZZLE_MAX_LINES } from '../../shared/coding-puzzle';
import {
  CODING_TRACKS,
  isCodingTaskId,
  tierLockReason,
  type CodingTask,
  type CodingTrack,
} from '../../shared/coding-catalog';
import { CODING_CODE_LIMIT_BYTES } from '../../shared/coding-api';
import type {
  CodingBriefResponse,
  CodingDealtParts,
  CodingDraftResponse,
  CodingDraftSaveRequest,
  CodingDraftSaveResponse,
  CodingGardenStatus,
  CodingOutcome,
  CodingProgressResponse,
  CodingRepeatXp,
  CodingResetRequest,
  CodingResetResponse,
  CodingRevealRequest,
  CodingRevealResponse,
  CodingSubmitRequest,
  CodingTaskProgress,
  CodingTaskResponse,
  CodingTaskStateResponse,
  CodingApproachesResponse,
  CodingSolutionPair,
  CodingVerdictResponse,
  DesignAnswer,
} from '../../shared/coding-api';
import type { EvaluateResult } from '../../shared/coding-evaluate';
import type { TypeCheckResult } from '../../shared/coding-ts-check';

const logEvent = createLogger('coding');
const MAX_CODE_BYTES = CODING_CODE_LIMIT_BYTES;

/** The tracks whose code the QuickJS sandbox grades. */
const QUICKJS_GRADED: ReadonlySet<CodingTrack> = new Set<CodingTrack>(['javascript', 'typescript', 'algorithms']);

const codingAvailable = () => deploymentSubjectIds().includes('webdev');
const notAvailable = (res: VercelResponse) => jsonError(res, 404, 'not_available', 'Coding challenges are not part of this product');

interface ProgressRow {
  task_id: string;
  track: string;
  status: CodingTaskProgress['status'];
  passes: number;
  review_stage: number;
  next_review_at: string | null;
  reveal_count: number;
  best_passed_at: string | null;
  updated_at?: string;
}
const PROGRESS_FIELDS = 'task_id,track,status,passes,review_stage,next_review_at,reveal_count,best_passed_at,updated_at';
/** PostgREST's JSON path selection: only `data.javascript.levels` of the
 * roadmap row, as the column `levels` (null when the row has none). */
export const JAVASCRIPT_LEVELS_SELECT = 'levels:data->javascript->levels';

const toProgress = (row: ProgressRow): CodingTaskProgress => ({
  status: row.status,
  passes: Number(row.passes ?? 0),
  reviewStage: Number(row.review_stage ?? 0),
  // Completion is permanent. Legacy scheduling columns are no longer read.
  nextReviewAt: null,
  revealCount: Number(row.reveal_count ?? 0),
  bestPassedAt: row.best_passed_at ?? null,
  ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
});

async function loadProgressRows(supabase: SupabaseClient, userId: string): Promise<ProgressRow[]> {
  const { data, error } = await withTimeout(supabase.from('coding_progress').select(PROGRESS_FIELDS).eq('user_id', userId));
  if (error) throw new Error('db_error');
  return (data ?? []) as ProgressRow[];
}

async function loadProgressRow(supabase: SupabaseClient, userId: string, taskId: string): Promise<CodingTaskProgress | null> {
  const { data, error } = await withTimeout(
    supabase.from('coding_progress').select(PROGRESS_FIELDS).eq('user_id', userId).eq('task_id', taskId).maybeSingle(),
  );
  if (error) throw new Error('db_error');
  return data ? toProgress(data as ProgressRow) : null;
}

/** The ids of the account's passed tasks. The tier ladder, the evolving gate
 * and review of cleared content need nothing else of the rows, so the task
 * page and a stage Submit read these instead of every row in full (#587,
 * server item 9): a learner who touched most of the catalogue had up to 769
 * rows of eight columns sent for a set of ids. */
async function loadPassedTaskIds(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await withTimeout(
    supabase.from('coding_progress').select('task_id,status').eq('user_id', userId).eq('status', 'passed'),
  );
  if (error) throw new Error('db_error');
  return new Set(((data ?? []) as { task_id: string; status: string }[]).filter((row) => row.status === 'passed').map((row) => row.task_id));
}

/** Highest contiguous cleared `javascript` Learn level, from the roadmap blob.
 * Clearing the Learn foundations opens JavaScript tier 3 (`tierUnlocked`).
 * Only the JavaScript levels are read (`data->javascript->levels`): the rest
 * of the blob, every other topic with its pass days, used to travel with
 * every task page and coding-progress read for this one count (#587, server
 * item 9). Throws when the row cannot be read, as a timeout already did: read
 * as 0, a failed read locked tier 3 for a learner who had opened it, and the
 * task page then sealed no session for it. A caller for which fewer cleared
 * levels only narrows what it offers catches it. */
export async function javascriptLevelsCleared(supabase: SupabaseClient, userId: string): Promise<number> {
  const { data, error } = await withTimeout(supabase.from('roadmap_progress').select(JAVASCRIPT_LEVELS_SELECT).eq('user_id', userId).maybeSingle());
  if (error) throw new Error('db_error');
  const levels = ((data as { levels?: Record<string, { passed?: boolean }> | null } | null)?.levels) ?? {};
  let cleared = 0;
  while (levels[String(cleared + 1)]?.passed === true) cleared++;
  return cleared;
}

async function optionalUser(req: VercelRequest, res: VercelResponse): Promise<string | null | undefined> {
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

function sessionFrom(raw: unknown): CodingSession | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 16_384) return null;
  return decodeCodingSession(raw);
}

/** The Learn level attempt a coding session belongs to expired or was
 * completed. The coding routines check the attempt again under its row lock
 * and raise `invalid_roadmap_attempt` when it ended after the check below. */
const learnAttemptEnded = (res: VercelResponse) =>
  jsonError(res, 409, 'invalid_session', 'This learning attempt expired or ended. Start the lesson again.');
const raisedEndedLearnAttempt = (error: { message?: string } | null | undefined): boolean =>
  /\binvalid_roadmap_attempt\b/.test(error?.message ?? '');

type LearnAttemptRead = Awaited<ReturnType<typeof readLearnAttempt>>;
const readLearnAttempt = (supabase: SupabaseClient, attemptId: string) =>
  withTimeout(supabase.from('roadmap_attempts').select('user_id,completed_at,expires_at,coding_task_ids').eq('attempt_id', attemptId).maybeSingle());

/** `prefetched`: the attempt row, read already for this session's own
 * account (`prefetchSubmitReads`). Every check below still decides. */
async function refuseInvalidLearnLink(supabase: SupabaseClient | null, res: VercelResponse, session: CodingSession, userId: string | null, prefetched?: Promise<LearnAttemptRead> | null): Promise<boolean> {
  if (!session.roadmapAttemptId) return false;
  if (session.userId !== userId) { jsonError(res, 409, 'session_owner_mismatch', 'This lesson was opened under a different sign-in. Start it again.'); return true; }
  if (!supabase) { jsonError(res, 503, 'not_configured', 'Learning progress is not configured'); return true; }
  const row = await (prefetched ?? readLearnAttempt(supabase, session.roadmapAttemptId));
  if (row.error) { jsonError(res, 503, 'progress_unavailable', 'Could not load the learning attempt. Try again.'); return true; }
  const attempt = row.data;
  if (!attempt || (attempt.user_id ?? null) !== userId || attempt.completed_at || Date.parse(attempt.expires_at) <= Date.now()
    || !Array.isArray(attempt.coding_task_ids) || !attempt.coding_task_ids.includes(session.taskId)) {
    learnAttemptEnded(res); return true;
  }
  return false;
}

/** What a coding session starts, for the tier gate. A task issued inside a
 * Learn level (its session names the level attempt) belongs to that level,
 * which the level seal already checked; any other task is itself, or the
 * evolving stage it is. */
function codingSessionContent(task: CodingTask, session: CodingSession): GatedContent {
  return session.roadmapAttemptId && task.level > 0
    ? { kind: 'learn-level', topic: task.topic, level: task.level }
    : codingContent(task.id);
}

/** Whether the learner already passed a task (or the milestone that covers an
 * evolving start stage): cleared content stays open for review on any tier. */
async function taskCleared(supabase: SupabaseClient | null, userId: string, taskId: string): Promise<boolean> {
  if (!supabase) return false;
  const ids = taskId.endsWith('-start') ? [taskId, taskId.slice(0, -6)] : [taskId];
  const { data, error } = await withTimeout(
    supabase.from('coding_progress').select('task_id,status').eq('user_id', userId).in('task_id', ids),
  );
  // A failed read is not "never passed": the tier gate answers it with 503
  // entitlement_unavailable (lib/access.ts), not the upgrade sheet.
  if (error) throw new Error(`coding_progress_unavailable: ${error.message}`);
  const passed = new Set(((data ?? []) as { task_id: string; status: string }[]).filter((row) => row.status === 'passed').map((row) => row.task_id));
  return evolvingPassed(taskId, passed);
}

/** How long a design session's single check is remembered: its whole life
 * (a coding session lasts three hours, lib/quiz-tokens.ts). */
const DESIGN_SESSION_TTL_S = 3 * 60 * 60;
const codeHash = (code: string) => createHash('sha256').update(code, 'utf8').digest('base64url').slice(0, 32);

/**
 * The verdict log's key for one graded submission.
 *
 * `record_coding_verdict` applies an attempt id once and reports every later
 * call with it as a replay. A workbench keeps one session for its whole life,
 * so the session's id alone recorded only the first Submit: fail, fix, pass
 * and the pass was never written — no completion, no XP, no Learn level. The
 * key is therefore the session plus what was graded, the code and the verdict
 * it earned: a retried request for the same submission stays a replay, and a
 * changed one is recorded. XP stays once per task and account either way; its
 * award id names the task, not the attempt.
 *
 * A system-design session keeps one graded verdict. A passing verdict returns
 * the key it was sealed with, so a second submission from the same session
 * could be answered from that key; it is reported and never applied. A failed
 * verdict returns no key (see `gradeDesign`), and a new attempt takes a new
 * session, with the options shuffled again.
 */
function submissionAttemptId(session: CodingSession, verdict: CodingOutcome, code: string | null): string {
  if (code === null) return session.attemptId;
  const graded = createHash('sha256').update(`${verdict}\n${code}`, 'utf8').digest('base64url').slice(0, 32);
  return `${session.attemptId}:${graded}`;
}

/* ── the task a read names ───────────────────────────────────────────── */

/** The task a request names, or null once it answered 400, 404 or 410. */
function requestedTask(req: VercelRequest, res: VercelResponse): CodingTask | null {
  const id = req.query.id;
  if (typeof id !== 'string' || !id) { jsonError(res, 400, 'bad_request', 'A task id is required'); return null; }
  // An id no task could have (`/coding/javascript/no-such-task`) is as
  // unknown as one that fits the pattern, and gets the same answer: the
  // browser shows its not-found page for a 404 and does not ask again.
  if (!isCodingTaskId(id)) { jsonError(res, 404, 'not_found', 'Unknown task'); return null; }
  const task = codingTaskById(id);
  if (!task) {
    // A task that exists but is withheld by the content gate is told apart
    // from an unknown id, so a stale bookmark gets an honest answer rather
    // than a "not found" it will keep retrying. A task on a hidden track
    // (system design) is answered as unknown: nothing of it is reachable.
    const authored = codingTaskForHistory(id);
    if (authored && !isHiddenCodingTask(authored)) jsonError(res, 410, 'task_retired', 'This challenge was retired from the active catalogue');
    else jsonError(res, 404, 'not_found', 'Unknown task');
    return null;
  }
  return task;
}

/** The version of a task's brief: what is known about it, the version and the
 * execution evidence that a reference solution passes its own grader. Not a
 * review — nobody has read it for clarity or judged whether it is worth doing. */
const briefReview = (task: CodingTask) => codingTaskReview(task, solutionFor(task.id));

/** A task's brief: everything of the playable task that is the same for every
 * caller and every request. A design's options, in their authored order, are
 * left out with the other dealt parts (`openCodingTask`). */
export function codingBrief(task: CodingTask): CodingBriefResponse {
  const brief = playable(task);
  delete brief.design;
  delete brief.drill;
  brief.review = briefReview(task);
  return { task: brief, version: brief.review.version };
}

/** What `coding-brief` answers with (#587 C23). The brief changes only with a
 * deploy, and every deploy starts the CDN cache afresh; a browser keeps it
 * five minutes. A page holding a brief of another version than the state
 * read's `briefVersion` reads it again past the browser cache. */
export const CODING_BRIEF_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/* ── GET ?resource=coding-brief&id=… ─────────────────────────────────── */

/** The brief alone, for every caller alike (#587 C23). It reads no token and
 * no row, so the CDN can share it, and it is exactly as public as the task
 * page is to a guest: Premium content is refused with the guest's 402. */
export async function handleCodingBrief(req: VercelRequest, res: VercelResponse) {
  if (!codingAvailable()) return notAvailable(res);
  // The same for everyone, so only the address tier, as the Learn map.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.readAddress))) return;
  const task = requestedTask(req, res);
  if (!task) return;
  if (await refuseLocked(res, null, codingContent(task.id))) return;
  res.setHeader('Cache-Control', CODING_BRIEF_CACHE);
  return res.json(codingBrief(task));
}

/* ── GET ?resource=coding-task&id=… and ?resource=coding-state&id=… ──── */

interface OpenedTask {
  task: CodingTask;
  dealt: CodingDealtParts;
  state: Omit<CodingTaskResponse, 'task'>;
}

/** Everything a task page needs from the caller: the limits, the token, the
 * Learn link, the progress and draft reads, the tier ladder, the Premium gate,
 * the dealt parts and the sealed session. Null once it answered. */
async function openCodingTask(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null): Promise<OpenedTask | null> {
  if (!codingAvailable()) { notAvailable(res); return null; }
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.codingTaskAddress, RATE_LIMITS.codingTask))) return null;
  const task = requestedTask(req, res);
  if (!task) return null;

  const userId = await optionalUser(req, res);
  if (userId === undefined) return null;

  const linkedRaw = req.method === 'POST' ? (req.body as { session?: unknown } | undefined)?.session : undefined;
  const linkedSession = linkedRaw === undefined ? null : sessionFrom(linkedRaw);
  if (req.method === 'POST' && (!linkedSession?.roadmapAttemptId || linkedSession.taskId !== task.id)) { jsonError(res, 400, 'invalid_session', 'A valid Learn task link is required'); return null; }
  if (linkedSession && await refuseInvalidLearnLink(supabase, res, linkedSession, userId)) return null;

  let progress: CodingTaskProgress | null = null;
  let draft: string | null = null;
  let draftUpdatedAt: string | null = null;
  let locked: CodingTaskResponse['locked'] = null;
  let passedIds: ReadonlySet<string> = new Set();
  const gated = linkedSession ? codingSessionContent(task, linkedSession) : codingContent(task.id);
  if (userId && supabase) {
    // Premium content asks for the plan below in any case. The question goes
    // out now, beside the progress reads, and the gate reads the answer the
    // request remembers (a failure is asked again there and answered 503).
    if (contentTier(gated, serverContentIndex()) === 'premium') void resolveTier(userId).catch(() => undefined);
    try {
      // The passed ids and this task's own row, not every row in full.
      const [passed, mine, cleared, draftRow] = await Promise.all([
        loadPassedTaskIds(supabase, userId),
        loadProgressRow(supabase, userId, task.id),
        javascriptLevelsCleared(supabase, userId),
        withTimeout(supabase.from('coding_drafts').select('code,updated_at').eq('user_id', userId).eq('task_id', task.id).maybeSingle()),
      ]);
      passedIds = passed;
      progress = mine;
      // An unreadable draft is not "no draft": the page would open the
      // starter (or an evolving stage's previous code) over the account's
      // saved code, which a stage Submit then overwrites. The previous
      // stage's read below already fails the same way.
      if (draftRow.error) throw new Error('draft_unavailable');
      draft = typeof draftRow.data?.code === 'string' ? draftRow.data.code : null;
      draftUpdatedAt = draft !== null && typeof draftRow.data?.updated_at === 'string' ? draftRow.data.updated_at : null;
      locked = tierLockReason({ track: task.track, tier: task.tier, progress: { passed }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: cleared });
      const stage = evolvingStage(task.id);
      if (stage) {
        locked = evolvingUnlocked(task.id, passed) ? null : 'evolving';
        if (draft === null && stage.previous && !locked) {
          const previous = await withTimeout(supabase.from('coding_drafts').select('code').eq('user_id', userId).eq('task_id', stage.previous).maybeSingle());
          if (previous.error) throw new Error('db_error');
          draft = typeof previous.data?.code === 'string' ? prepareEvolvingDraft(previous.data.code, stage.challenge, stage.index) : null;
        }
      }
    } catch (error) {
      logEvent({ status: 500, kind: 'task_progress_unavailable', reason: error instanceof Error ? error.message : 'unknown' });
      jsonError(res, 500, 'db_error', 'Could not load coding progress');
      return null;
    }
  } else {
    // Anonymous visitors may open and run any free task without recording
    // it; the ladder's tiers lock only what a signed-in learner could
    // otherwise record. Everything above tier 2 is shown as locked so the
    // ladder reads the same way for everyone.
    locked = tierLockReason({ track: task.track, tier: task.tier, progress: { passed: new Set() }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: 0 });
    if (evolvingStage(task.id)) locked = evolvingUnlocked(task.id, new Set()) ? null : 'evolving';
  }
  // Premium opens the rest of the catalogue; a guest and a free account are
  // refused it with 402. A task already passed stays open for review whatever
  // the tier.
  if (await refuseLocked(res, userId, gated, { cleared: async () => evolvingPassed(task.id, passedIds) })) return null;
  if (linkedSession) locked = null;

  // A design's options in their authored order, replaced below by the
  // shuffled deal when the task has one.
  const { design, drill } = playable(task);
  const dealt: CodingDealtParts = { ...(design ? { design } : {}), ...(drill ? { drill } : {}) };
  // The puzzle's lines go out shuffled under presentation ids, and both the
  // accepted orders and the id translation stay here — the translation in the
  // sealed session. The shuffle is per request, so reloading does not hand
  // back the same start.
  let key: CodingSession['key'];
  const authoredPuzzle = puzzleFor(task.id);
  if (authoredPuzzle) {
    const presented = presentPuzzle(authoredPuzzle, secureShuffle);
    dealt.puzzle = {
      taskId: task.id,
      variantId: 'v1',
      lines: presented.lines,
      competencies: [...authoredPuzzle.competencies],
      claim: authoredPuzzle.claim,
    };
    key = { puzzle: presented.map };
  }
  if (task.track === 'system-design') {
    const prepared = prepareDesign(task, secureShuffle);
    key = { ...(key ?? {}), ...prepared.key };
    if (prepared.design) {
      dealt.design = {
        scenario: prepared.design.scenario,
        brief: prepared.design.brief,
        passMark: prepared.design.passMark,
        steps: prepared.design.steps.map((step) => ({ key: step.key, title: step.title, prompt: step.prompt, options: step.options })),
      };
    }
    if (prepared.drill) {
      const { format, scenario, prompt, unit, options, steps } = prepared.drill;
      dealt.drill = { format, scenario, prompt, ...(unit ? { unit } : {}), ...(options ? { options } : {}), ...(steps ? { steps } : {}) };
    }
  }
  // Reading the current brief renews a stale Learn link under the same parent
  // and attempt id. The original owner/task/expiry checks above still apply.
  const session = linkedSession && linkedSession.version === codingAttemptVersion(task) ? String(linkedRaw)
    : locked ? null : createCodingSession({ taskId: task.id, track: task.track, userId,
      ...(linkedSession ? { attemptId: linkedSession.attemptId, roadmapAttemptId: linkedSession.roadmapAttemptId } : {}),
      ...(key ? { key } : {}),
    });

  // A task this page can submit, graded in QuickJS (TypeScript after its
  // type check): load a grader thread now if the instance has none, so the
  // first Submit does not wait for it (#587, server item 30).
  if (session && QUICKJS_GRADED.has(task.track)) warmSandbox();
  return { task, dealt, state: { session, locked, progress, draft, draftUpdatedAt, signedIn: Boolean(userId) } };
}

/** A playable task with its sealed session, the account's lock, progress and
 * draft: the brief and the caller's part in one answer. The Learn link (POST
 * with its session) and Premium tasks are read this way. */
export async function handleCodingTask(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  const opened = await openCodingTask(req, res, supabase);
  if (!opened) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const body: CodingTaskResponse = { task: { ...codingBrief(opened.task).task, ...opened.dealt }, ...opened.state };
  return res.json(body);
}

/** The caller's part of a task page alone (#587 C23): what `coding-task`
 * answers but the brief, which `coding-brief` serves to everyone alike. The
 * same limits, token check, reads and gates, so a 402 stays a 402. */
export async function handleCodingState(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  const opened = await openCodingTask(req, res, supabase);
  if (!opened) return;
  res.setHeader('Cache-Control', 'private, no-store');
  const body: CodingTaskStateResponse = { ...opened.state, dealt: opened.dealt, briefVersion: briefReview(opened.task).version };
  return res.json(body);
}

/* ── grading ─────────────────────────────────────────────────────────── */

interface Graded {
  verdict: CodingOutcome;
  results: EvaluateResult['results'];
  hidden: { passed: number; total: number } | null;
  check: TypeCheckResult | null;
  logs: string[];
  codeError: string | null;
  design: CodingVerdictResponse['design'];
  designReference: CodingVerdictResponse['designReference'];
  failureHint?: CodingVerdictResponse['failureHint'];
  puzzle?: CodingVerdictResponse['puzzle'];
  /** The grader itself failed: the React runner could not start or answer.
   * That says nothing about the learner's code, so nothing is recorded. */
  infra?: boolean;
  /** Nothing checked the code: a checklist task passes on the learner's own
   * confirmation. Such a pass is recorded as unverified, with no XP and so no
   * coins, links no Learn level attempt, and opens no solutions. */
  unverified?: boolean;
}

/** The authored hint for the way this attempt failed, or null.
 *
 * Everything the classifier sees is either the learner's own output or a fact
 * about the task's shape — the kind of an expected value, never the value, and
 * never anything from a hidden test. What comes back is a category name and
 * authored text. */
function hintForFailure(
  task: CodingTask,
  graded: Pick<Graded, 'verdict' | 'results' | 'check' | 'codeError'> & { timedOut?: boolean },
): CodingVerdictResponse['failureHint'] {
  // Code that never parsed: the error says what is wrong, and a hint about
  // the values it handles would not be true (V4-3).
  if (graded.verdict === 'passed' || isSyntaxError(graded.codeError)) return null;
  const tests = task.tests ?? [];
  const category = classifyFailure({
    timedOut: graded.verdict === 'timeout' || graded.timedOut === true,
    threw: Boolean(graded.codeError),
    typeErrors: Boolean(graded.check && (graded.check.codeErrors.length > 0 || graded.check.typeTests.some((one) => !one.pass))),
    results: graded.results.map((one) => ({ pass: one.pass, actual: one.actual })),
    edge: tests.map((one) => one.edge === true),
    expectedKinds: tests.map((one) => jsonKind(JSON.stringify(one.expected) ?? null)),
    pitfall: task.pitfall,
  });
  return failureHint(category, task.failureHints);
}

async function gradeCode(task: CodingTask, code: string): Promise<Graded> {
  const tests = task.tests ?? [];
  const solution = solutionFor(task.id);
  const hiddenTests = solution?.hiddenTests ?? [];
  let check: TypeCheckResult | null = null;
  let hiddenTypeFailures = 0;
  let hiddenTypeTotal = 0;
  let codeToRun = code;
  if (task.track === 'typescript') {
    // The compiler runs on a worker thread with a deadline: a few hundred
    // bytes of recursive types kept it busy for half a minute on this thread.
    const hiddenTypeTests = solution?.hiddenTypeTests ?? [];
    const typed = await checkTypes(code, hiddenTypeTests.length ? [task.typeTests ?? [], hiddenTypeTests] : [task.typeTests ?? []]);
    if (typed.stopped) {
      // The message names the cause, a type. The timeout hint would send the
      // learner looking for a loop that is not there, so there is none.
      return {
        verdict: 'timeout', results: [], check: null, logs: [], codeError: TYPE_CHECK_STOPPED_MESSAGE, design: null, designReference: null,
        hidden: hiddenTests.length + hiddenTypeTests.length > 0 ? { passed: 0, total: hiddenTests.length + hiddenTypeTests.length } : null,
        failureHint: null,
      };
    }
    check = typed.results[0];
    const hiddenCheck = typed.results[1];
    if (hiddenCheck) {
      hiddenTypeTotal = hiddenCheck.typeTests.length;
      hiddenTypeFailures = hiddenCheck.typeTests.filter((one) => !one.pass).length;
    }
    // Code nested too deeply for the compiler is the learner's error, like a
    // syntax error, not a failure of the handler.
    if (typed.javascript === null) {
      const graded: Graded = {
        verdict: 'error', results: [], check, logs: [], codeError: TRANSPILE_FAILED_MESSAGE, design: null, designReference: null,
        hidden: hiddenTests.length + hiddenTypeTotal > 0 ? { passed: 0, total: hiddenTests.length + hiddenTypeTotal } : null,
      };
      return { ...graded, failureHint: hintForFailure(task, graded) };
    }
    codeToRun = typed.javascript;
  }
  // Only the visible checks' console output comes back: a learner who logs
  // inside their function must not read the hidden checks' inputs. The hidden
  // checks run in a fresh program, in an order shuffled for this submission.
  const { visible, hidden: hiddenRun } = await runChecks({ runtimePolicy: runtimePolicyForTask(task.id), code: codeToRun, visible: tests, hidden: hiddenTests, shuffle: secureShuffle });
  const run = { logs: visible.logs, codeError: visible.codeError ?? hiddenRun?.codeError ?? null, timedOut: Boolean(visible.timedOut || hiddenRun?.timedOut) };
  let verdict = codeOutcome({ visible, hidden: hiddenRun, check });
  if (verdict === 'passed' && hiddenTypeFailures > 0) verdict = 'failed';
  const hiddenPassed = (hiddenRun?.results.filter((r) => r.pass === true).length ?? 0) + (hiddenTypeTotal - hiddenTypeFailures);
  const hiddenTotal = hiddenTests.length + hiddenTypeTotal;
  const graded: Graded = {
    verdict,
    results: visible.results,
    hidden: hiddenTotal > 0 ? { passed: hiddenPassed, total: hiddenTotal } : null,
    check,
    logs: run.logs,
    codeError: run.codeError,
    design: null,
    designReference: null,
  };
  return { ...graded, failureHint: hintForFailure(task, { ...graded, timedOut: run.timedOut }) };
}

/**
 * React tasks: render the component and run the task's Testing Library suite
 * under jsdom. A task with no suite (`verify: 'checklist'`) has nothing to
 * assert, so the learner's own confirmation stands, marked unverified: it is
 * recorded, and pays nothing. Everything else is decided here from the code
 * alone.
 */
async function gradeReact(task: CodingTask, code: string): Promise<Graded> {
  if (task.verify === 'checklist' || !task.suite) {
    return { verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null, design: null, designReference: null, unverified: true };
  }
  let run;
  let loaded = false;
  try {
    const { runIsolatedReactSuite } = await import('./react-isolated');
    loaded = true;
    run = await runIsolatedReactSuite({ suite: withHiddenCases(task.suite, solutionFor(task.id)?.hiddenSuite), appSource: code });
  } catch (error) {
    // The runtime itself could not start; that is ours, not the learner's.
    const code = (error as { code?: unknown } | undefined)?.code;
    const missingModule = !loaded && error instanceof Error
      ? error.message.match(/^Cannot find (?:module|package) ['"]([^'"]+)['"]/)?.[1]
      : undefined;
    logEvent({ status: 500, kind: 'react_runtime', category: error instanceof Error ? error.name : 'unknown',
      phase: loaded ? 'run' : 'import',
      ...(typeof code === 'string' && /^ERR_[A-Z_]+$|^MODULE_NOT_FOUND$/.test(code) ? { code } : {}),
      ...(missingModule ? { missingModule } : {}),
    });
    return {
      verdict: 'error', results: [], hidden: null, check: null, logs: [],
      codeError: 'The React runner could not start, so this Submit was not recorded. Try again in a moment.',
      design: null, designReference: null, infra: true,
    };
  }
  // Hidden cases decide the verdict with the rest but go back only as a count,
  // never with their names or errors.
  const { visible, hidden } = splitHiddenCases(run.cases);
  const results = visible.map((one) => ({ pass: one.status === 'pass', actual: null, error: one.error }));
  const verdict: CodingOutcome = run.compileError
    ? 'error'
    : run.timedOut
      ? 'timeout'
      : run.failed === 0 && run.total > 0 ? 'passed' : 'failed';
  const graded: Graded = {
    verdict,
    results,
    hidden: hidden.length > 0 ? { passed: hidden.filter((one) => one.status === 'pass').length, total: hidden.length } : null,
    check: null,
    logs: [],
    codeError: run.compileError,
    design: null,
    designReference: null,
  };
  return { ...graded, failureHint: hintForFailure(task, { ...graded, timedOut: run.timedOut }) };
}

function gradeDesignTask(task: CodingTask, session: CodingSession, answers: DesignAnswer[] | undefined): Graded {
  const graded = gradeDesign(task, session.key ?? {}, answers);
  return {
    verdict: graded.outcome,
    results: [],
    hidden: null,
    check: null,
    logs: [],
    codeError: null,
    design: graded.verdicts,
    designReference: graded.reference,
  };
}

interface RecordInput {
  supabase: SupabaseClient;
  userId: string;
  task: CodingTask;
  session: CodingSession;
  verdict: CodingOutcome;
  verified: boolean;
  code: string | null;
  complexity?: ComplexityReport | null;
  runCount?: number;
  hintsUsed?: number;
  durationMs?: number;
}

interface Recorded {
  progress: CodingTaskProgress | null;
  firstPass: boolean;
  xpAwarded: number;
  xpForfeited: boolean;
  repeatXp: CodingRepeatXp | null;
  applied: boolean;
  codeChanged: boolean;
}

const clampInt = (value: unknown, max: number): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null;

async function recordVerdict(input: RecordInput, res: VercelResponse): Promise<Recorded | null> {
  const { supabase, userId, task, session } = input;
  // Only a verdict the server checked pays: an unverified pass (a checklist
  // task) records the attempt and the progress row with no XP, so no coins.
  const xp = input.verified ? codingPassXp(input.complexity) : 0;
  const roadmapAttemptId = input.verified ? session.roadmapAttemptId ?? null : null;
  // settle_coin_milestones credits only inside IF is_premium (migration 052),
  // so after a verified pass it runs for a Premium account only (#587, server
  // item 8), as after a path code pass. The plan is read while the verdict is
  // recorded (remembered for the request, so a Premium task's gate answer is
  // reused), and a plan that cannot be read settles: the routine decides.
  const premium = input.verdict === 'passed' && input.verified
    ? resolveTier(userId).then((tier) => tier === 'premium')
    : null;
  premium?.catch(() => {});
  const saved = await withTimeout(
    supabase.rpc('record_coding_verdict', {
      p_user_id: userId,
      p_attempt_id: submissionAttemptId(session, input.verdict, input.code),
      p_task_id: task.id,
      p_track: task.track,
      p_outcome: input.verdict,
      p_verified: input.verified,
      p_xp: xp,
      p_subject: 'webdev',
      p_roadmap_attempt_id: roadmapAttemptId,
      p_duration_ms: clampInt(input.durationMs, 86_400_000),
      p_run_count: clampInt(input.runCount, 10_000),
      p_hints_used: clampInt(input.hintsUsed, 20) ?? 0,
      p_code_hash: input.code ? codeHash(input.code) : null,
    }),
  );
  if (saved.error) {
    if (isRpcMissing(saved.error)) {
      jsonError(res, 503, 'migration_required', 'Coding progress migration 025 is not installed');
      return null;
    }
    // The level attempt ended between the link check and this write (the
    // level was completed in another tab, or it expired): nothing was
    // recorded, and the learner reopens the lesson, as for any ended link.
    if (raisedEndedLearnAttempt(saved.error)) {
      learnAttemptEnded(res);
      return null;
    }
    jsonError(res, 500, 'db_error', 'Could not record the verdict');
    return null;
  }
  const data = (saved.data ?? {}) as {
    applied?: boolean; firstPass?: boolean; xpAwarded?: boolean; xpForfeited?: boolean; codeChanged?: boolean;
    xpKind?: 'first' | 'repeat' | null; repeatXp?: CodingRepeatXp | null;
  };
  // Coins follow the XP the routine just awarded, under the same award id
  // (#227). The last stage of a project or short path is a Premium milestone.
  // A task's repeat XP (058) is XP only: it credits no coins.
  const xpAwarded = data.xpAwarded === true && xp > 0;
  // The credit and the settlement run together (#587, server item 10): the
  // milestones settle on the streak, the Learn blob and the passed tasks,
  // none of which the credit writes, and each routine is idempotent under
  // its own event ids. The settlement's report is not used here.
  const rewards = async () => {
    const settled = await Promise.allSettled([
      xpAwarded && data.xpKind !== 'repeat'
        ? creditVerifiedXp(supabase, { userId, awardId: codingAwardId(userId, task.id), subject: 'webdev', xp })
        : null,
      // From migration 048 every applied verified pass is also a streak day,
      // which can reach a Premium streak milestone; an unverified (checklist)
      // pass settles nothing.
      data.applied === true && premium ? settleMilestonesAfterPass(supabase, userId, 'webdev', () => premium) : null,
    ]);
    for (const one of settled) if (one.status === 'rejected') throw one.reason;
  };
  // The progress row the verdict wrote does not depend on the coins, so it is
  // read beside them. Both settle before the answer: a read that fails must
  // not end the request while a credit is still in flight.
  const [read, credited] = await Promise.allSettled([loadProgressRow(supabase, userId, task.id), rewards()]);
  if (credited.status === 'rejected') throw credited.reason;
  if (read.status === 'rejected') throw read.reason;
  const progress = read.value;
  // Whether a reveal came before this pass, for a database without migration
  // 058, whose routine does not say it itself. Its first pass is the row's
  // first (`passes` was 0, so the row did not read 'passed'), and the verdict
  // routine leaves reveal_count alone, so the row read back above tells what
  // a read before the write did (#587, server item 10). That read used to
  // run before every pass, also on 058 and later, where its answer went
  // unused.
  const revealedBefore = (progress?.revealCount ?? 0) > 0;
  return {
    progress,
    firstPass: data.firstPass === true,
    xpAwarded: xpAwarded ? xp : 0,
    // Migration 048 pays no XP, and so no coins, for a first pass after a
    // reveal. Before 048 the routine still pays it: xpAwarded is then true and
    // this stays false, so the verdict never claims a forfeit that did not
    // happen. An unverified (checklist) pass never pays, so it claims none.
    // From 058 the first verified pass pays even after an old unverified one,
    // whose row already reads 'passed', and the routine says whether a reveal
    // cost it the XP (C1-7).
    xpForfeited: typeof data.xpForfeited === 'boolean'
      ? data.xpForfeited && data.applied === true && !xpAwarded && xp > 0
      : revealedBefore && input.verdict === 'passed' && data.applied === true && data.firstPass === true && !xpAwarded && xp > 0,
    repeatXp: repeatXpOf(data.repeatXp),
    applied: data.applied === true,
    codeChanged: data.codeChanged === true,
  };
}

/** The routine's `repeatXp` (058), kept only in the shape the client reads. */
function repeatXpOf(value: unknown): CodingRepeatXp | null {
  if (!value || typeof value !== 'object') return null;
  const one = value as { availableAt?: unknown; needsReset?: unknown; withheld?: unknown };
  const at = typeof one.availableAt === 'string' && !Number.isNaN(Date.parse(one.availableAt)) ? new Date(one.availableAt).toISOString() : null;
  return {
    availableAt: at,
    needsReset: one.needsReset === true,
    withheld: one.withheld === 'reset' || one.withheld === 'cooldown' ? one.withheld : null,
  };
}

/** The junior and senior solutions for a task, when both are authored. Called
 * only where a pass has been established: by the grader just now, or by the
 * recorded progress row. */
const solutionPairFor = (id: string): CodingSolutionPair | null => {
  const record = solutionFor(id);
  return record?.junior && record.senior ? { junior: record.junior, senior: record.senior } : null;
};

function verdictBody(graded: Graded, recorded: Recorded | null, github: CodingGardenStatus | null, solutions: CodingSolutionPair | null): CodingVerdictResponse {
  return {
    verdict: graded.verdict,
    results: graded.results,
    hidden: graded.hidden,
    check: graded.check,
    logs: graded.logs,
    codeError: graded.codeError,
    design: graded.design,
    designReference: graded.designReference,
    failureHint: graded.failureHint ?? null,
    puzzle: graded.puzzle ?? null,
    progress: recorded?.progress ?? null,
    firstPass: recorded?.firstPass ?? false,
    xpAwarded: recorded?.xpAwarded ?? 0,
    xpForfeited: recorded?.xpForfeited ?? false,
    repeatXp: recorded?.repeatXp ?? null,
    applied: recorded?.applied ?? false,
    github,
    solutions,
    ...(graded.infra ? { graderUnavailable: true as const } : {}),
  };
}

/** The grader could not take this Submit (`GraderBusyError`): nothing was
 * graded, so nothing is recorded, and the learner is asked to submit again. A
 * caller over its own limit hears 429; a Submit the instance's grader threads
 * could not take, 503. Both carry a Retry-After. */
function graderBusy(res: VercelResponse, status: 429 | 503, error: GraderBusyError, track: CodingTrack, hasUser: boolean) {
  logEvent({ status, kind: 'submit_unrecorded', reason: error.reason, track, hasUser });
  res.setHeader('Retry-After', String(error.retryAfterSeconds));
  return jsonError(res, status, 'grader_busy', error.message);
}

/* ── POST ?resource=coding-submit ────────────────────────────────────── */

/**
 * A Submit's reads that wait only on who the caller is (#587, server item
 * 10). The per-task and ceiling buckets need the verified account, and the
 * plan (Premium content) and the Learn level attempt (a linked session) were
 * then read one after the other once both buckets had answered. They start as
 * soon as the token check answers, beside the two buckets; the gates below
 * still decide, in their order, on what was read.
 *
 * Only a session issued to the verified caller, or to no one, is read for:
 * one bound to another account is refused before anything is read, as it
 * was. The trade-off: a Submit one of the two buckets then refuses has spent
 * these reads (an `is_premium` call, a roadmap_attempts row) for nothing.
 * Such a caller is signed in and still inside its address bucket
 * (`codingSubmitAddress`), which bounds them.
 */
function prefetchSubmitReads(req: VercelRequest, supabase: SupabaseClient | null, task: CodingTask, session: CodingSession): Promise<{ learnAttempt: Promise<LearnAttemptRead> | null }> {
  return verifiedCallerId(req).then((callerId) => {
    if (!callerId || !supabase || (session.userId && session.userId !== callerId)) return { learnAttempt: null };
    // Remembered for the request; a failure is asked again by the gate.
    if (contentTier(codingSessionContent(task, session), serverContentIndex()) === 'premium') void resolveTier(callerId).catch(() => undefined);
    if (!session.roadmapAttemptId || session.userId !== callerId) return { learnAttempt: null };
    const learnAttempt = readLearnAttempt(supabase, session.roadmapAttemptId);
    // Awaited by the link check; a request answered before it ends quietly.
    learnAttempt.catch(() => undefined);
    return { learnAttempt };
  });
}

export async function handleCodingSubmit(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!codingAvailable()) return notAvailable(res);
  // The caller's token is checked while the address bucket answers.
  if (!(await enforceAddressRateLimit(req, res, RATE_LIMITS.codingSubmitAddress))) return;
  const body = (req.body || {}) as Partial<CodingSubmitRequest>;
  const session = sessionFrom(body.session);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Coding session expired or invalid');
  const task = codingTaskById(session.taskId);
  if (!task || task.track !== session.track) return jsonError(res, 400, 'invalid_session', 'Coding session does not match a task');
  // The plan and the Learn attempt are read while the per-task buckets answer.
  const prefetched = prefetchSubmitReads(req, supabase, task, session);
  // Per task, beneath a ceiling per caller (owner decision, 9 October 2026):
  // a learner who spent one task's budget still submits on the next one.
  if (!(await enforcePerItemRateLimit(req, res, RATE_LIMITS.codingSubmit, RATE_LIMITS.codingSubmitCeiling, gradingItem.task(task.id)))) return;
  const userId = await optionalUser(req, res);
  if (userId === undefined) return;
  if (session.userId && session.userId !== userId) return jsonError(res, 403, 'invalid_session', 'Coding session belongs to another account');
  const { learnAttempt } = await prefetched;
  if (await refuseLocked(res, userId, codingSessionContent(task, session), { cleared: () => taskCleared(supabase, userId!, task.id) })) return;
  if (await refuseInvalidLearnLink(supabase, res, session, userId, learnAttempt)) return;
  if (session.version !== codingAttemptVersion(task)) {
    return jsonError(res, 409, 'task_changed', 'This task changed while you were working. Reload its latest brief before submitting. Your code has been kept.');
  }

  let graded: Graded;
  let code: string | null = null;
  let stagePassed: Promise<Set<string>> | null = null;
  // A code-ordering submission. The server neither reads nor believes a
  // viewport: it accepts an order from any device and grades it the same way,
  // and what it produces is ordering evidence, never a code pass.
  const puzzle = puzzleFor(task.id);
  if (Array.isArray(body.order) && puzzle) {
    // The browser arranged presentation ids; the session says what they stand
    // for. An id this session never issued fails the whole submission.
    const map = session.key?.puzzle;
    if (!map) return jsonError(res, 400, 'invalid_session', 'This session did not issue a puzzle');
    // Every entry must be an id: dropping the others would accept an order
    // padded with junk as if it were the arrangement the learner sent.
    if (body.order.length > PUZZLE_MAX_LINES || !body.order.every((id): id is string => typeof id === 'string')) {
      return jsonError(res, 400, 'bad_request', 'Arrange every line exactly once');
    }
    const resolved = resolvePuzzleOrder(body.order as string[], map);
    const order = resolved.filter((id): id is string => id !== null);
    if (order.length !== resolved.length || !isCompleteOrder(order, puzzle.lines)) {
      return jsonError(res, 400, 'bad_request', 'Arrange every line exactly once');
    }
    const accepted = isAcceptedOrder(order, puzzle.accepted);
    if (userId && supabase) {
      const written = await withTimeout(supabase.rpc('record_coding_puzzle', {
        p_user_id: userId, p_task_id: task.id, p_competencies: puzzle.competencies, p_passed: accepted,
      }));
      if (written.error && isRpcMissing(written.error)) {
        return jsonError(res, 503, 'migration_required', 'Practice migration 027 is not installed');
      }
      // The arrangement is still answered: it is evidence about ordering and
      // records no progress. A lost record is logged, never dropped silently.
      if (written.error) logEvent({ status: 500, kind: 'puzzle_unrecorded', reason: written.error.code ?? 'unknown' });
    }
    logEvent({ status: 200, kind: 'puzzle', track: task.track, accepted });
    res.setHeader('Cache-Control', 'private, no-store');
    // coding_progress is deliberately untouched: the task stays open for the
    // implementation it actually asks for.
    return res.json(verdictBody({
      verdict: accepted ? 'passed' : 'failed',
      results: [],
      hidden: null,
      check: null,
      logs: [],
      codeError: null,
      design: null,
      designReference: null,
      puzzle: { accepted, competencies: puzzle.competencies, claim: puzzle.claim },
    }, null, null, null));
  }
  if (task.track === 'system-design') {
    if (!Array.isArray(body.answers) || body.answers.length > 12) return jsonError(res, 400, 'bad_request', 'answers must be an array');
    // One check per design session. A failed check names which answers were
    // right, so sending the same session again with other answers would read
    // the key off it step by step, and a pass would then hand over the whole
    // walkthrough. A new attempt opens the task again, under a new shuffle.
    if (!(await claimOnce(`design:${session.attemptId}`, DESIGN_SESSION_TTL_S))) {
      return jsonError(res, 409, 'design_session_used', 'This walkthrough was already checked. Open it again for a new attempt.');
    }
    graded = gradeDesignTask(task, session, body.answers);
  } else {
    if (typeof body.code !== 'string' || body.code.length === 0) return jsonError(res, 400, 'bad_request', 'code is required');
    if (Buffer.byteLength(body.code, 'utf8') > MAX_CODE_BYTES) return jsonError(res, 413, 'too_large', 'Code is limited to 20 kB');
    // A signed-in Submit of an evolving stage stores its code as the stage
    // draft, which Postgres text cannot hold with U+0000 in it.
    if (userId && evolvingStage(task.id) && hasNul(body.code)) return jsonError(res, 400, 'bad_request', NUL_MESSAGE);
    code = body.code;
    const done = enterInFlight(req, 'grading', { item: gradingItem.task(task.id), perItem: GRADING_PER_TASK, perCaller: GRADING_PER_CALLER }, userId ? `user:${userId}` : undefined);
    if (!done) return graderBusy(res, 429, new GraderBusyError('caller_in_flight'), task.track, Boolean(userId));
    // A signed-in stage Submit's gate reads the passed stages while the code
    // is graded rather than after (#587, server item 10); it still decides
    // before anything is written.
    if (userId && supabase && evolvingStage(task.id)) {
      stagePassed = loadPassedTaskIds(supabase, userId);
      stagePassed.catch(() => undefined);
    }
    try {
      graded = task.track === 'react' ? await gradeReact(task, code) : await gradeCode(task, code);
    } catch (error) {
      if (!(error instanceof GraderBusyError)) throw error;
      return graderBusy(res, 503, error, task.track, Boolean(userId));
    } finally {
      done();
    }
  }
  // A grader outage is not the learner's error: it is neither recorded nor
  // counted against the attempt, and the message asks for another Submit.
  if (graded.infra) {
    logEvent({ status: 200, kind: 'submit_unrecorded', track: task.track, hasUser: Boolean(userId) });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(verdictBody(graded, null, null, null));
  }

  const complexity = code !== null ? assessComplexity(task, code) : null;
  let recorded: Recorded | null = null;
  let github: CodingGardenStatus | null = null;
  let draftUpdatedAt: string | null = null;
  if (userId) {
    if (!supabase) return jsonError(res, 503, 'not_configured', 'Coding progress is not configured');
    if (evolvingStage(task.id)) {
      const passed = await (stagePassed ?? loadPassedTaskIds(supabase, userId));
      if (!evolvingUnlocked(task.id, passed)) return jsonError(res, 403, 'stage_locked', 'Complete earlier stages first');
      // Persist the exact submitted code before publishing completion. A next
      // stage can then resume from this draft even on another device. It is
      // written whatever the draft holds, and the time goes back with the
      // verdict, so the browser's next save builds on it.
      if (code !== null) {
        const draft = await storeDraft(supabase, userId, task.id, code, 'force');
        if (draft === 'busy') return draftBusy(res);
        if (!draft || draft === 'missing') return jsonError(res, 500, 'db_error', 'Could not save stage code');
        if (draft.saved && draft.updatedAt) draftUpdatedAt = draft.updatedAt;
      }
    }
    recorded = await recordVerdict({ supabase, userId, task, session, verdict: graded.verdict, verified: graded.unverified !== true, code, complexity, runCount: body.runCount, hintsUsed: body.hintsUsed, durationMs: body.durationMs }, res);
    if (!recorded) return;
    if (graded.verdict === 'passed' && recorded.applied) {
      github = await afterCodingPass(supabase, {
        userId,
        task,
        code: code ?? '',
        passedCount: graded.results.filter((r) => r.pass === true).length + (graded.hidden?.passed ?? 0),
        totalCount: graded.results.length + (graded.hidden?.total ?? 0),
        firstPass: recorded.firstPass,
        codeChanged: recorded.codeChanged,
      });
    }
  }
  logEvent({ status: 200, kind: 'submit', track: task.track, verdict: graded.verdict, hasUser: Boolean(userId) });
  res.setHeader('Cache-Control', 'private, no-store');
  // A pass opens the two authored solutions. The grader decided the pass a
  // moment ago in this same request, which is the only reason they are here;
  // an unverified pass checked nothing, so it opens nothing.
  const checkedPass = graded.verdict === 'passed' && code !== null && graded.unverified !== true;
  const out: CodingVerdictResponse = verdictBody(graded, recorded, github, checkedPass ? solutionPairFor(task.id) : null);
  if (complexity) out.complexity = complexity;
  if (draftUpdatedAt) out.draftUpdatedAt = draftUpdatedAt;
  return res.json(out);
}

/* ── POST ?resource=coding-reset ─────────────────────────────────────── */

/** The workbench's Reset, signed in: the code went back to the starter, which
 * opens the task's repeat XP (migration 058). A pass from an hour after the
 * task last paid its XP, with no reveal in between, pays it once more. A guest
 * earns no XP, so a guest's reset records nothing. */
export async function handleCodingReset(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!codingAvailable()) return notAvailable(res);
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.codingTaskAddress, RATE_LIMITS.codingTask))) return;
  const body = (req.body || {}) as Partial<CodingResetRequest>;
  const session = sessionFrom(body.session);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Coding session expired or invalid');
  const task = codingTaskById(session.taskId);
  if (!task) return jsonError(res, 400, 'invalid_session', 'Coding session does not match a task');
  const userId = await optionalUser(req, res);
  if (userId === undefined) return;
  if (!userId) return jsonError(res, 401, 'unauthorized', 'Sign in to earn XP for a task again');
  if (session.userId && session.userId !== userId) return jsonError(res, 403, 'invalid_session', 'Coding session belongs to another account');
  if (await refuseInvalidLearnLink(supabase, res, session, userId)) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Coding progress is not configured');
  const saved = await withTimeout(supabase.rpc('record_coding_reset', { p_user_id: userId, p_task_id: task.id }));
  if (saved.error) {
    if (isRpcMissing(saved.error)) return jsonError(res, 503, 'migration_required', 'Coding repeat migration 058 is not installed');
    return jsonError(res, 500, 'db_error', 'Could not record the reset');
  }
  const data = (saved.data ?? {}) as { recorded?: unknown; availableAt?: unknown };
  res.setHeader('Cache-Control', 'private, no-store');
  const out: CodingResetResponse = {
    recorded: data.recorded === true,
    availableAt: repeatXpOf({ availableAt: data.availableAt })?.availableAt ?? null,
  };
  return res.json(out);
}

/* ── POST ?resource=coding-reveal ────────────────────────────────────── */

export async function handleCodingReveal(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!codingAvailable()) return notAvailable(res);
  if (!(await enforceClassRateLimit(req, res, RATE_LIMITS.codingRevealAddress, RATE_LIMITS.codingReveal))) return;
  const body = (req.body || {}) as Partial<CodingRevealRequest>;
  const session = sessionFrom(body.session);
  if (!session) return jsonError(res, 400, 'invalid_session', 'Coding session expired or invalid');
  const task = codingTaskById(session.taskId);
  if (!task) return jsonError(res, 400, 'invalid_session', 'Coding session does not match a task');
  const hintsUsed = clampInt(body.hintsUsed, 20) ?? 0;
  const userId = await optionalUser(req, res);
  if (userId === undefined) return;
  if (session.userId && session.userId !== userId) return jsonError(res, 403, 'invalid_session', 'Coding session belongs to another account');

  let progress: CodingTaskProgress | null = null;
  if (userId && supabase) {
    try { progress = await loadProgressRow(supabase, userId, task.id); } catch { return jsonError(res, 500, 'db_error', 'Could not load coding progress'); }
  }
  if (progress?.status !== 'passed' && await refuseLocked(res, userId, codingSessionContent(task, session))) return;
  if (await refuseInvalidLearnLink(supabase, res, session, userId)) return;
  const allowed = progress?.status === 'passed' || hintsUsed >= giveUpAfter(ladderLength(task));
  if (!allowed) return jsonError(res, 403, 'reveal_locked', 'Take more of the hint ladder before revealing the solution');

  if (userId && supabase && (progress?.status !== 'passed' || session.roadmapAttemptId)) {
    const marked = await withTimeout(supabase.rpc('record_coding_reveal', {
      p_user_id: userId, p_task_id: task.id, p_track: task.track, p_roadmap_attempt_id: session.roadmapAttemptId ?? null,
    }));
    if (marked.error) {
      if (isRpcMissing(marked.error)) return jsonError(res, 503, 'migration_required', 'Coding progress migration 025 is not installed');
      // The level attempt ended after the link check: nothing was recorded
      // and nothing is revealed, as for any ended link.
      if (raisedEndedLearnAttempt(marked.error)) return learnAttemptEnded(res);
      return jsonError(res, 500, 'db_error', 'Could not record the reveal');
    }
    try { progress = await loadProgressRow(supabase, userId, task.id); } catch { /* the reveal itself succeeded */ }
  } else if (userId && supabase) {
    // After a pass the solution opens without the ladder, and costs only the
    // repeat XP of a reset the learner has open (058): that attempt then pays
    // nothing. Before 058 there is no repeat XP to forfeit.
    const marked = await withTimeout(supabase.rpc('record_coding_repeat_reveal', { p_user_id: userId, p_task_id: task.id }));
    if (marked.error && !isRpcMissing(marked.error)) return jsonError(res, 500, 'db_error', 'Could not record the reveal');
  }
  const solution = solutionFor(task.id)?.solution ?? '';
  const reference = task.design?.reference ?? task.drill?.explanation ?? null;
  logEvent({ status: 200, kind: 'reveal', track: task.track, hasUser: Boolean(userId) });
  res.setHeader('Cache-Control', 'private, no-store');
  const out: CodingRevealResponse = { solution, reference: reference, progress };
  return res.json(out);
}

/* ── GET ?op=coding-progress ─────────────────────────────────────────── */

export async function handleCodingProgress(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (!codingAvailable()) return notAvailable(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  try {
    const [rows, cleared] = await Promise.all([loadProgressRows(supabase, userId), javascriptLevelsCleared(supabase, userId)]);
    const tasks: Record<string, CodingTaskProgress> = {};
    const passedByTrack = Object.fromEntries(CODING_TRACKS.map((track) => [track, 0])) as Record<CodingTrack, number>;
    for (const row of rows) {
      tasks[row.task_id] = toProgress(row);
      if (row.status === 'passed' && CODING_TRACKS.includes(row.track as CodingTrack)) passedByTrack[row.track as CodingTrack] += 1;
    }
    // A checkmark means both a recorded pass and saved code, not merely a
    // local draft or an inherited checkpoint pass. Read ids only, bounded to
    // known passed stages and the verified account; never transfer the code.
    const passedStages = rows.filter((row) => row.status === 'passed' && evolvingStage(row.task_id)).map((row) => row.task_id);
    const chunks: string[][] = [];
    for (let index = 0; index < passedStages.length; index += 128) chunks.push(passedStages.slice(index, index + 128));
    const saved = await Promise.all(chunks.map(async (ids) => {
      const { data, error } = await withTimeout(supabase.from('coding_drafts').select('task_id')
        .eq('user_id', userId).in('task_id', ids).not('code', 'match', '^[[:space:]]*$'));
      if (error) throw new Error('saved_code_unavailable');
      return (data ?? []).flatMap((row) => typeof row.task_id === 'string' && ids.includes(row.task_id) ? [row.task_id] : []);
    }));
    const stagesWithSavedCode = saved.flat();
    const due: string[] = [];
    res.setHeader('Cache-Control', 'private, no-store');
    const out: CodingProgressResponse = { tasks, stagesWithSavedCode, due, javascriptLevelsCleared: cleared, passedByTrack };
    return res.json(out);
  } catch (error) {
    logEvent({ status: 500, kind: 'progress_unavailable', reason: error instanceof Error ? error.message : 'unknown' });
    return jsonError(res, 500, 'db_error', 'Could not load coding progress');
  }
}

/* ── GET/POST ?op=coding-draft&id=… ──────────────────────────────────── */

/** An account draft's updated_at as Postgres hands it out, ISO 8601 with up
 * to microseconds: kept as a string, since a Date would drop them. */
const isDraftTime = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/.test(value) && !Number.isNaN(Date.parse(value));

type StoredDraft = { saved: true; updatedAt: string | null } | { saved: false; updatedAt: string };

/** save_coding_draft_v2 met two other saves of the same new draft and gave
 * up (`coding_draft_busy`). Nothing was written; another try a moment later
 * goes through. */
function draftBusy(res: VercelResponse) {
  res.setHeader('Retry-After', '1');
  return jsonError(res, 503, 'draft_busy', 'Another save of this draft was in progress. Try again in a moment.');
}

/** Write a task's draft: only while the account's draft still has `base`
 * (null: none yet), or whatever it holds with 'force'. Migration 059's
 * save_coding_draft_v2 decides under a row lock. Before that migration the
 * save goes through save_coding_draft (025), which always writes, and the
 * time is read back: none when another save overtook it. Null for a database
 * error, 'missing' when neither routine exists, 'busy' when 059's routine
 * gave up on concurrent first saves. */
/** Postgres text cannot hold U+0000: a draft holding it is refused before
 * the database, which would raise and answer 500. */
const hasNul = (code: string): boolean => code.includes('\u0000');
const NUL_MESSAGE = 'Code cannot contain a NUL (U+0000) character';

async function storeDraft(supabase: SupabaseClient, userId: string, taskId: string, code: string, base: string | null | 'force'): Promise<StoredDraft | 'missing' | 'busy' | null> {
  const force = base === 'force';
  const result = await withTimeout(supabase.rpc('save_coding_draft_v2', { p_user_id: userId, p_task_id: taskId, p_code: code, p_base: force ? null : base, p_force: force }));
  if (!result.error) {
    const answer = result.data as { saved?: unknown; conflict?: unknown; updatedAt?: unknown } | null;
    const updatedAt = typeof answer?.updatedAt === 'string' ? answer.updatedAt : null;
    if (answer?.saved === false && answer.conflict === true && updatedAt) return { saved: false, updatedAt };
    return { saved: true, updatedAt };
  }
  if (/\bcoding_draft_busy\b/.test(result.error.message ?? '')) return 'busy';
  if (!isRpcMissing(result.error)) return null;
  const saved = await withTimeout(supabase.rpc('save_coding_draft', { p_user_id: userId, p_task_id: taskId, p_code: code }));
  if (saved.error) return isRpcMissing(saved.error) ? 'missing' : null;
  let updatedAt: string | null = null;
  try {
    const row = await withTimeout(supabase.from('coding_drafts').select('code,updated_at').eq('user_id', userId).eq('task_id', taskId).maybeSingle());
    if (!row.error && row.data?.code === code && typeof row.data.updated_at === 'string') updatedAt = row.data.updated_at;
  } catch { /* saved all the same; the browser learns no time */ }
  return { saved: true, updatedAt };
}

export async function handleCodingDraft(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  if (!codingAvailable()) return notAvailable(res);
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  const id = req.method === 'GET' ? req.query.id : (req.body as { id?: unknown } | undefined)?.id;
  if (!isCodingTaskId(id) || !codingTaskById(id)) return jsonError(res, 400, 'bad_request', 'A task id is required');
  if (req.method === 'GET') {
    const { data, error } = await withTimeout(supabase.from('coding_drafts').select('code,updated_at').eq('user_id', userId).eq('task_id', id).maybeSingle());
    if (error) return jsonError(res, 500, 'db_error', 'Could not load the draft');
    res.setHeader('Cache-Control', 'private, no-store');
    const out: CodingDraftResponse = { code: typeof data?.code === 'string' ? data.code : null, updatedAt: data?.updated_at ?? null };
    return res.json(out);
  }
  if (req.method === 'POST') {
    // Rate limited as every write to api/user/[op].ts is (`limitUserWrite`):
    // per account, behind a class-sized address bucket. A second bucket here,
    // keyed by address alone, held a whole class to one person's saves.
    const body = (req.body ?? {}) as Partial<Record<keyof CodingDraftSaveRequest, unknown>>;
    const code = body.code;
    if (typeof code !== 'string' || Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) return jsonError(res, 400, 'bad_request', 'code is required and limited to 20 kB');
    // Refused here rather than raised by the save routine as a 500.
    if (hasNul(code)) return jsonError(res, 400, 'bad_request', NUL_MESSAGE);
    // The account draft's time this code builds on (owner decision 10). A
    // client from before it sends none and writes as it always did.
    const base = !('base' in body) ? 'force' : body.base === null ? null : isDraftTime(body.base) ? body.base : undefined;
    if (base === undefined) return jsonError(res, 400, 'bad_request', 'base must be a draft time or null');
    const saved = await storeDraft(supabase, userId, id, code, base);
    if (!saved) return jsonError(res, 500, 'db_error', 'Could not save the draft');
    if (saved === 'busy') return draftBusy(res);
    if (saved === 'missing') return jsonError(res, 503, 'migration_required', 'Coding progress migration 025 is not installed');
    // Saved from another device or tab since: nothing was written, and the
    // browser asks the learner which code to keep. The other code stays on
    // the server until the browser asks for it.
    if (!saved.saved) return jsonError(res, 409, 'draft_conflict', 'Your account holds a draft of this task saved since this code was opened', { updatedAt: saved.updatedAt });
    // The time the account now holds this code, so the browser's next save
    // builds on it (client/src/coding/drafts.ts).
    const out: CodingDraftSaveResponse = { ok: true, updatedAt: saved.updatedAt };
    return res.json(out);
  }
  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}


/* ── GET ?resource=coding-approaches ─────────────────────────────────── */

/**
 * Curated approach comparisons for a task the learner has passed.
 *
 * The gate is the recorded verdict, not a flag from the browser and not the
 * reveal: giving up shows the reference solution and ends the attempt, and it
 * still does. Passing is what opens the comparison, because the comparison only
 * teaches anything to someone who already has a working answer of their own.
 */
export async function handleCodingApproaches(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!codingAvailable()) return notAvailable(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!isCodingTaskId(id) || !codingTaskById(id)) return jsonError(res, 404, 'not_found', 'Unknown challenge');
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  const row = await withTimeout(
    supabase.from('coding_progress').select('status').eq('user_id', userId).eq('task_id', id).maybeSingle(),
  );
  if (row.error) {
    if (isRpcMissing(row.error)) return jsonError(res, 503, 'migration_required', 'Coding progress migration 025 is not installed');
    return jsonError(res, 500, 'db_error', 'Could not read your progress');
  }
  if (row.data?.status !== 'passed') {
    return jsonError(res, 403, 'not_passed', 'Approach comparisons open once you have passed the challenge');
  }

  res.setHeader('Cache-Control', 'private, no-store');
  const body: CodingApproachesResponse = { taskId: id, approaches: approachesFor(id), solutions: solutionPairFor(id) };
  return res.json(body);
}
