/** The wire contract between the coding screens and the API. Server handlers
 * in `lib/coding/handlers.ts` produce these shapes; `client/src/coding/api.ts`
 * consumes them. Answers never appear here: results, not keys. */

import type { ComplexityReport } from './coding-complexity';
import type { CodingTrack, PlayableCodingTask } from './coding-catalog';
import type { CallOutcome } from './coding-evaluate';
import type { FailureCategory } from './coding-failure';
import type { PuzzleCompetency, PuzzleView } from './coding-puzzle';
import type { TypeCheckResult } from './coding-ts-check';

export type CodingOutcome = 'passed' | 'failed' | 'error' | 'timeout';
export type CodingProgressStatus = 'in_progress' | 'passed' | 'revealed';

export interface CodingTaskProgress {
  status: CodingProgressStatus;
  passes: number;
  reviewStage: number;
  nextReviewAt: string | null;
  revealCount: number;
  bestPassedAt: string | null;
  /** Latest recorded activity, from the server clock. */
  updatedAt?: string;
}

export type CodingLockReason = 'foundations' | 'sweep' | 'tier3' | 'tier4' | 'evolving';

/** GET ?resource=coding-task&id=… */
export interface CodingTaskResponse {
  task: PlayableCodingTask;
  /** Sealed coding session; null when the tier is locked for this learner. */
  session: string | null;
  locked: CodingLockReason | null;
  progress: CodingTaskProgress | null;
  draft: string | null;
  /** When `draft` was saved, when it is this task's own draft (not an
   * evolving stage's start made from the stage before). The browser opens
   * the newer of it and the copy on the device. */
  draftUpdatedAt?: string | null;
  /** True when the learner is signed in; anonymous visitors may run, not submit. */
  signedIn: boolean;
}

/** The parts of a playable task dealt per request: the puzzle's shuffled
 * lines and a design's shuffled options. The sealed session holds the key to
 * them, so they travel with it and never with the shared brief. */
export type CodingDealtParts = Pick<PlayableCodingTask, 'puzzle' | 'design' | 'drill'>;

/** GET ?resource=coding-brief&id=… (#587 C23): the task's brief, the same for
 * every caller, without a token, and cached publicly. It carries what the
 * task page always showed a guest (no solution, no hidden test, no key) and
 * none of the dealt parts. Premium content is refused with the guest's 402. */
export interface CodingBriefResponse {
  task: PlayableCodingTask;
  /** The brief's public content version, `task.review.version`. */
  version: string;
}

/** GET ?resource=coding-state&id=… (#587 C23): the caller's part of a task
 * page, with the gates, limits and reads of `coding-task`: the sealed
 * session, the lock, the progress, the draft and the dealt parts. */
export interface CodingTaskStateResponse extends Omit<CodingTaskResponse, 'task'> {
  dealt: CodingDealtParts;
  /** The version of the brief this session was sealed against. A cached
   * brief of another version is read again before the page shows it. */
  briefVersion: string;
}

export interface CodingGardenStatus {
  status: 'committed' | 'queued' | 'skipped' | 'failed' | 'not_connected';
  url?: string;
}

/** The most code, in UTF-8 bytes, one Submit may carry. The server refuses
 * more with 413 `too_large`; the workbench says so before sending. */
export const CODING_CODE_LIMIT_BYTES = 20 * 1024;

/** POST ?resource=coding-submit (JavaScript, TypeScript, system design) */
export interface CodingSubmitRequest {
  /** A code-ordering submission: the puzzle's line ids in the arranged order.
   * Present instead of `code` when the learner arranged rather than typed. */
  order?: string[];
  session: string;
  /** Code tracks. */
  code?: string;
  /** System design: one entry per step or one drill answer. */
  answers?: DesignAnswer[];
  runCount?: number;
  hintsUsed?: number;
  durationMs?: number;
}

/** A guided step answer is an option index; a drill answer depends on the
 * format: option index, estimate number, or the chosen order of step indices. */
export type DesignAnswer = number | number[];

/** Two more ways to write a task: how someone new to the language would, and
 * how an experienced engineer would. Both are proven against every visible and
 * hidden check by the content contract, and they travel only with a verified
 * pass — this submission's, or one recorded earlier. */
export interface CodingSolutionPair {
  junior: string;
  senior: string;
}

export interface CodingVerdictResponse {
  /** Server estimate for this source. Only a reliable above-target result
   * reduces the base reward; uncertainty keeps the ordinary reward. */
  complexity?: ComplexityReport;
  verdict: CodingOutcome;
  /** Visible tests, in task order (code tracks). */
  results: CallOutcome[];
  /** Hidden tests are reported as counts only. */
  hidden: { passed: number; total: number } | null;
  check: TypeCheckResult | null;
  logs: string[];
  codeError: string | null;
  /** System design: per step or drill. A pass carries the whole walkthrough;
   * any other verdict says only which steps were right (see
   * `DesignStepVerdict`). */
  design: DesignStepVerdict[] | null;
  /** The reference answer for a system-design task, on a pass only. */
  designReference: string | null;
  /** Why this attempt failed, and the authored line about that kind of
   * mistake. Null on a pass, and null when the only honest answer is "some
   * checks did not pass" — the hint ladder answers that one. It never carries
   * a hidden input, an expected value or a raw error. */
  failureHint: { category: FailureCategory; body: string } | null;
  /** Set when the submission was a code-ordering puzzle rather than code. It
   * carries what the arrangement established, which is narrower than a code
   * pass and never recorded as one. */
  puzzle: PuzzleVerdict | null;
  /** null for an anonymous run: nothing was recorded. */
  progress: CodingTaskProgress | null;
  firstPass: boolean;
  xpAwarded: number;
  /** True when this was the task's first pass, it earned no XP, and the
   * learner had revealed the solution before it: a pass after a reveal earns
   * no XP and no coins. False whenever XP was paid, so a database that still
   * pays for such a pass never makes the verdict claim otherwise. */
  xpForfeited: boolean;
  /** When this task's XP can be earned again (migration 058), on a verified
   * pass that offered XP: a reset of the task to its starter, then a pass
   * from `availableAt` on, pays the task's XP once more. `withheld` says why
   * this pass paid nothing: no reset since the last award, or the hour since
   * it is not up. Null on every other verdict, and on a database without 058. */
  repeatXp?: CodingRepeatXp | null;
  applied: boolean;
  github: CodingGardenStatus | null;
  /** The junior and senior solutions, on a passed code submission. Null on
   * any other verdict, on a puzzle, and for tasks without authored pairs. */
  solutions: CodingSolutionPair | null;
  /** Set when the grader itself could not run (the React runner did not
   * start). The verdict says nothing about the code and nothing was
   * recorded; the learner can submit again. */
  graderUnavailable?: true;
  /** An evolving stage's Submit by an account stores the submitted code as
   * the stage's draft: the time it did, so the browser's next draft save
   * builds on it rather than meeting it as a conflict. */
  draftUpdatedAt?: string;
}

/** One graded step of a walkthrough, or the one answer of a drill.
 *
 * A failed or partly right submission carries `correct` and `given` and
 * nothing else: no correct option, order or range, and no explanation, since
 * the explanations name the right option. Otherwise the key could be read off
 * a failed attempt and the task reopened under a fresh shuffle and passed for
 * full XP. The rest arrives only with a pass. */
export interface DesignStepVerdict {
  correct: boolean;
  /** The learner's own answer as graded: an option index, an estimate, or an
   * order of step positions. Null when it was missing or malformed. */
  given: DesignAnswer | null;
  /** On a pass only: the correct option, order or range, with the explanation. */
  correctIndex?: number;
  correctOrder?: number[];
  acceptedRange?: { min: number; max: number; answer: number };
  explanation?: string;
}

/** When a task's XP opens again (`CodingVerdictResponse.repeatXp`). */
export interface CodingRepeatXp {
  /** ISO time from which a pass after a reset pays the XP again. */
  availableAt: string | null;
  /** True when the task must be reset before its XP can be earned again. */
  needsReset: boolean;
  /** Why this pass paid nothing, when that is the reason. */
  withheld: 'reset' | 'cooldown' | null;
}

/** POST ?resource=coding-reset: the workbench's Reset, signed in. */
export interface CodingResetRequest {
  session: string;
}
export interface CodingResetResponse {
  /** False when there was nothing to reset: the account never opened the task. */
  recorded: boolean;
  availableAt: string | null;
}

/** POST ?resource=coding-reveal */
export interface CodingRevealRequest {
  session: string;
  /** Rungs already taken, so the give-up rule can be checked. */
  hintsUsed: number;
}
export interface CodingRevealResponse {
  /** Code for the code tracks; the reference answer for system design. */
  solution: string;
  reference: string | null;
  progress: CodingTaskProgress | null;
}

/** GET /api/user/[op]?op=coding-progress */
export interface CodingProgressResponse {
  tasks: Record<string, CodingTaskProgress>;
  /** Task ids due for a review, oldest first. */
  due: string[];
  /** Highest contiguous cleared `javascript` Learn level. */
  javascriptLevelsCleared: number;
  passedByTrack: Record<CodingTrack, number>;
}

/** GET/POST /api/user/[op]?op=coding-draft&id=… */
export interface CodingDraftResponse {
  code: string | null;
  updatedAt: string | null;
}

/** POST /api/user/[op]?op=coding-draft. `base` is the account draft's
 * `updatedAt` the code builds on, null for none: the save is refused with 409
 * `draft_conflict` (`CodingDraftConflict`) when the account holds a draft
 * saved since. A request without `base` (a client from before migration 059)
 * writes whatever the account holds, as every save used to. */
export interface CodingDraftSaveRequest {
  id: string;
  code: string;
  base?: string | null;
}

/** POST /api/user/[op]?op=coding-draft: the time the account now holds the
 * code just sent, or null when it cannot say (another save landed first). */
export interface CodingDraftSaveResponse {
  ok: true;
  updatedAt: string | null;
}

/** The `error` of a 409 `draft_conflict`: the time of the draft the account
 * holds, saved since the base the request named. Its code is not sent; the
 * client reads it with GET coding-draft when the learner asks for it. */
export interface CodingDraftConflict {
  code: 'draft_conflict';
  message: string;
  updatedAt: string;
}

/* ── GitHub garden ─────────────────────────────────────────────────────── */

export type GithubConnectionStatus = 'pending_repo' | 'active' | 'broken';

export interface GithubConnectionResponse {
  available: boolean;
  status: GithubConnectionStatus | 'not_connected';
  accountLogin: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  lastCommitAt: string | null;
  queued: number;
  lastError: string | null;
  repositories?: { fullName: string; defaultBranch: string; private: boolean; fork: boolean }[];
}

export interface GithubConnectStartResponse {
  url: string;
}

export interface GithubSyncResponse {
  committed: number;
  failed: number;
  remaining: number;
}

/* ── saved challenges, collections, skips and short sessions ───────────── */

/** GET/PUT /api/user/[op]?op=coding-bookmarks */
export interface CodingBookmarksResponse {
  /** Task ids the learner saved, newest first. */
  saved: string[];
  collections: CodingCollection[];
}

export interface CodingCollection {
  collectionId: string;
  name: string;
  position: number;
  taskIds: string[];
}

export type CodingBookmarkRequest =
  | { op: 'save'; taskId: string; saved: boolean }
  | { op: 'collection-upsert'; collectionId?: string; name: string; position?: number }
  | { op: 'collection-delete'; collectionId: string }
  | { op: 'collection-item'; collectionId: string; taskId: string; present: boolean };

/** Why a learner passed on a task. Recorded, never rewarded: a required task
 * that was skipped stays required and unlocks nothing. */
export const SKIP_REASONS = ['too-easy', 'too-hard', 'missing-prerequisite', 'unclear', 'later'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const isSkipReason = (value: unknown): value is SkipReason =>
  typeof value === 'string' && (SKIP_REASONS as readonly string[]).includes(value);

/** POST /api/user/[op]?op=coding-skip */
export interface CodingSkipRequest {
  taskId: string;
  reason: SkipReason;
  /** Optional, short and about the task. */
  note?: string;
}

export interface CodingSkipResponse {
  recorded: boolean;
  /** Another eligible task to try instead, when one exists. */
  next: string | null;
  /** True when the task is required by the learner's plan, so it will return. */
  required: boolean;
}

/** The session lengths offered. Estimates, and labelled as such. */
export const PRACTICE_SESSION_MINUTES = [5, 10, 20] as const;
export type PracticeSessionMinutes = (typeof PRACTICE_SESSION_MINUTES)[number];
export const isPracticeSessionMinutes = (value: unknown): value is PracticeSessionMinutes =>
  typeof value === 'number' && (PRACTICE_SESSION_MINUTES as readonly number[]).includes(value);

/** How a run's queue is ordered: the catalogue's order, one challenge after
 * the next, or shuffled. Shuffling happens on the server when the run is
 * created, so the queue is fixed from then on. */
export const PRACTICE_ORDERS = ['sequential', 'random'] as const;
export type PracticeOrder = (typeof PRACTICE_ORDERS)[number];
export const isPracticeOrder = (value: unknown): value is PracticeOrder =>
  typeof value === 'string' && (PRACTICE_ORDERS as readonly string[]).includes(value);

/** The run sizes offered when the learner asks for a number of challenges
 * rather than a number of minutes. Any integer from 1 to `PRACTICE_MAX_COUNT`
 * is accepted by the API; these are the ones the planner shows. */
export const PRACTICE_RUN_COUNTS = [3, 5, 10] as const;
export const PRACTICE_MAX_COUNT = 20;
/** A run may be scheduled up to this far ahead. */
export const PRACTICE_SCHEDULE_HORIZON_DAYS = 60;

/** GET/POST/PUT /api/user/[op]?op=practice-session */
export interface PracticeSession {
  sessionId: string;
  minutes: number;
  topic: string | null;
  /** Task ids the server chose, in order. Every one was already eligible. */
  queue: string[];
  position: number;
  /** `scheduled` until the learner starts a run they planned for later. */
  status: 'active' | 'scheduled' | 'finished' | 'abandoned';
  /** The sum of the queue's estimated minutes. An estimate, not a promise. */
  estimatedMinutes: number;
  order: PracticeOrder;
  /** The number of challenges asked for, when the run was sized by count. */
  count: number | null;
  /** ISO timestamp the run was planned for; null for a run started at once. */
  scheduledFor: string | null;
}

export interface PracticeSessionResponse {
  session: PracticeSession | null;
}

export interface PracticeSessionStartRequest {
  /** Size the run by time, or leave it out and size it by `count`. */
  minutes?: PracticeSessionMinutes;
  /** Size the run by a number of challenges (1 to PRACTICE_MAX_COUNT). */
  count?: number;
  /** Restrict the queue to one topic, or leave it out for the whole plan. */
  topic?: string;
  /** Catalogue order (the default) or shuffled. */
  order?: PracticeOrder;
  /** ISO timestamp to plan the run for. In the past or absent means now. */
  scheduledFor?: string;
}

export interface PracticeSessionAdvanceRequest {
  sessionId: string;
  position?: number;
  /** `active` starts a scheduled run; the other two end a run. */
  status?: 'finished' | 'abandoned' | 'active';
}

/* ── curated approach comparisons ─────────────────────────────────────── */

export interface CuratedApproachView {
  name: string;
  code: string;
  readability: string;
  time: string;
  space: string;
  assumptions: string;
  tradeoffs: string;
}

/** GET ?resource=coding-approaches&id=…
 *
 * Two or three original solutions to the same task, with what each costs, what
 * it assumes and what it gives up. Served only when the learner's own recorded
 * evidence says they passed: a revealed solution after giving up is a different
 * thing and does not open this. An empty list means nothing is authored for
 * this task yet, and the client shows no tab rather than an empty one. */
export interface CodingApproachesResponse {
  taskId: string;
  approaches: CuratedApproachView[];
  /** The same pair a passing submission returns, for a task passed earlier. */
  solutions: CodingSolutionPair | null;
}

/** The result of arranging a puzzle. `accepted` says the order is one the
 * author accepts; `competencies` and `claim` say exactly what that shows, so
 * nobody reads it as having written the code. */
export interface PuzzleVerdict {
  accepted: boolean;
  competencies: PuzzleCompetency[];
  claim: string;
}
