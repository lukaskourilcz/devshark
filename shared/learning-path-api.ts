/** The wire contract between the learning-path screens and the API.
 *
 * `lib/learning-paths/handlers.ts` produces these shapes; the client's
 * `client/src/lib/learningPaths.ts` consumes them. Nothing here can carry an
 * answer: objective checks travel as shuffled options with the key sealed in
 * the attempt session, code activities travel as prompt plus visible tests,
 * and reference material appears only in a result the learner has earned. */

import type { CallTest, TypeTest } from './coding-catalog';
import type { CallOutcome } from './coding-evaluate';
import type { TypeCheckResult } from './coding-ts-check';
import type { ComplexityGuidance, ComplexityReport } from './coding-complexity';
import type { LearnSectionId } from './learn-section-ids';
import type {
  ActivityPurpose,
  ActivitySummary,
  BaseTrack,
  EvidenceState,
  ExperienceLevel,
  LearnerGoal,
  LearnerProfile,
  LearningPathId,
  LearningPathManifest,
  LearningPreference,
  ModuleProgress,
  PathCodeLanguage,
  PathInventory,
  RequiredProfileField,
  StudyTime,
  VerificationKind,
} from './learning-paths';

/* ── catalog ───────────────────────────────────────────────────────────── */

/** Why a path is not open for enrollment right now. `content_incomplete` is
 * the honest answer while a version is still being authored. */
export type PathAvailability = 'available' | 'disabled' | 'content_incomplete' | 'storage_missing';

export interface PathCatalogEntry {
  manifest: LearningPathManifest;
  availability: PathAvailability;
  /** Real counts derived from the manifest, never an authoring target. */
  inventory: PathInventory;
}

/** GET /api/quiz/roadmap?resource=learning-path-catalog */
export interface LearningPathCatalogResponse {
  paths: PathCatalogEntry[];
  /** Published version per path, so a client can spot a stale cache. */
  versions: Record<string, number>;
}

/* ── preference ────────────────────────────────────────────────────────── */

/** GET/PUT /api/user/[op]?op=learning-preference
 *
 * One op, one writer. The versioned learner profile is the record; the v1
 * preference and the legacy track field are derived from it on every save so a
 * client that predates the profile still reads something it understands. */
export interface LearningPreferenceResponse {
  preference: LearningPreference | null;
  /** The legacy `devquiz_track` value, still written for older clients. */
  legacyTrack: BaseTrack | null;
  /** The full profile, or null when the account has never saved one. */
  profile: LearnerProfile | null;
  /** Required answers still outstanding. Empty means practice is personalised. */
  missingProfileFields: RequiredProfileField[];
}

export interface LearningPreferenceRequest {
  baseTrack: BaseTrack;
  specialization: 'fde' | null;
  /** The profile answers. Optional so the existing track-only save from the
   * Profile toggle keeps working: fields left out keep the value already on
   * the account rather than being cleared. */
  goals?: LearnerGoal[];
  experience?: ExperienceLevel;
  studyTime?: StudyTime;
  /** Opt-in Learn sections to keep on the profile; left out keeps the saved
   * list. Web Developer and Forward Deployed Engineer follow the base track
   * and the specialization and need no entry. */
  sections?: LearnSectionId[];
}

/* ── enrollment ────────────────────────────────────────────────────────── */

export type EnrollmentStatus = 'active' | 'paused' | 'completed';

export interface PathEnrollment {
  enrollmentId: string;
  pathId: LearningPathId;
  curriculumVersion: number;
  status: EnrollmentStatus;
  /** The base track at enrollment time, for recommendations only. Null when
   * none was chosen, as on enrollments of the retired DSA skill path. */
  baseTrackAtEnrollment: BaseTrack | null;
  startedAt: string;
  updatedAt: string;
}

/** GET/POST /api/user/[op]?op=learning-path-enrollment */
export interface EnrollmentListResponse {
  enrollments: PathEnrollment[];
}

export interface EnrollmentCreateRequest {
  pathId: LearningPathId;
  curriculumVersion: number;
  /** The base track the role specialization sits above. */
  baseTrack?: BaseTrack;
  /** `pause` and `resume` keep the enrollment and all its evidence. */
  action?: 'enroll' | 'pause' | 'resume';
}

/* ── progress ──────────────────────────────────────────────────────────── */

/** Which competencies the diagnostic actually measured. A competency the
 * learner never attempted is `not_assessed`, never a silent zero. */
export type CompetencyState = 'demonstrated' | 'gap' | 'not_assessed';

export interface CompetencyResult {
  competencyId: string;
  state: CompetencyState;
  /** 0..1 over the diagnostic items that touched this competency. */
  score: number | null;
  /** Actual accepted item count, or zero when no per-item evidence exists. */
  assessedItems: number;
}

/** GET /api/user/[op]?op=learning-path-progress&enrollmentId=… */
export interface PathProgressResponse {
  enrollment: PathEnrollment;
  modules: ModuleProgress[];
  competencies: CompetencyResult[];
  /** Bridge ids worth doing first, most useful first. Recommendations only. */
  recommendedBridges: string[];
  /** The one concrete next action, or null when the guided path is finished. */
  nextActivityId: string | null;
  guidedComplete: boolean;
  artifacts: { submitted: number; total: number };
  /** Path activities due for a spaced review, oldest first. */
  dueActivityIds: string[];
}

/* ── starting an activity ──────────────────────────────────────────────── */

/** The learner-facing body of a lesson. Sections are plain prose and code
 * samples; a trace is a deterministic, step-by-step data walkthrough with a
 * textual alternative, never a generated image. */
export interface LessonBody {
  id: string;
  title: string;
  sections: LessonSection[];
  sources: { label: string; url: string; reviewedOn: string }[];
}

/** GET /api/quiz/roadmap?resource=lesson&id=: the lesson a Learn level opens
 * with (#492). `hash` is the sha256 of `lesson`; the answer's ETag carries it,
 * so a repeat read revalidates to a 304. */
export interface LearnLessonResponse {
  lesson: LessonBody;
  hash: string;
}

export type LessonSection =
  | { kind: 'prose'; body: string }
  | { kind: 'code'; language: string; code: string; caption: string }
  /** A snippet the learner can change and run.
   *
   * Exploration, and labelled as such: nothing here is graded, nothing is
   * recorded, and running it proves nothing. It exists because a paragraph
   * about what a loop does is weaker than changing the loop and watching the
   * output change. The code runs in the same bounded, isolated runner the
   * Run button uses — never in the page, never on the server.
   *
   * On a narrow screen the editor is not offered: the snippet stays readable
   * and runnable, and the typing waits for a keyboard, exactly as a coding
   * task does. */
  | { kind: 'example'; language: string; code: string; caption: string; note: string }
  | { kind: 'table'; caption: string; headers: string[]; rows: string[][] }
  | { kind: 'trace'; caption: string; trace: TraceSpec }
  | { kind: 'callout'; tone: 'note' | 'warning'; body: string };

/** A deterministic trace the learner can step through. Every step carries the
 * full state and a sentence describing it, so the animation is an affordance
 * rather than the only way to read it. */
export interface TraceSpec {
  /** What the frames show: array cells, a stack, a queue, or tree nodes. */
  shape: 'array' | 'stack' | 'queue' | 'tree' | 'counter';
  /** Column or node labels, when the shape needs them. */
  legend?: string[];
  frames: TraceFrame[];
}

export interface TraceFrame {
  /** The visible values at this step, already stringified for display. */
  cells: string[];
  /** Indices to mark: compared, moved, settled. */
  marks?: { index: number; role: 'active' | 'compare' | 'settled' | 'excluded' }[];
  /** One sentence describing this step; the textual alternative. */
  note: string;
  /** Operation counter, when the trace is teaching cost. */
  counter?: { label: string; value: number };
}

/** One objective question, as the learner sees it. Options arrive shuffled and
 * the correct index lives only in the sealed session. */
export interface CheckQuestionPayload {
  id: string;
  prompt: string;
  /** Optional code or data the question is about. */
  context?: { language: string; code: string };
  options: string[];
  /** Which knowledge domain the question belongs to, when the activity gates
   * on domains separately. */
  domain?: string;
  competencies: string[];
}

/** A code activity as the learner receives it: prompt, starter, visible tests.
 * Hidden assertions and the reference solution stay on the server. */
export interface PathCodePayload {
  complexityGuidance?: ComplexityGuidance;
  language: PathCodeLanguage;
  prompt: string;
  starter: string;
  skeleton?: string;
  hints: string[];
  approach?: string[];
  /** Operations the task forbids or requires, stated in the prompt and
   * enforced by the graded contract — not by matching source text. */
  contract?: string[];
  tests?: CallTest[];
  typeTests?: TypeTest[];
  suite?: string;
}

/** An artifact activity: what to write, and the rubric it is judged against
 * before the learner starts. */
export interface PathArtifactPayload {
  brief: string;
  fields: ArtifactField[];
  rubricDimensions: string[];
}

export interface ArtifactField {
  id: string;
  label: string;
  help: string;
  kind: 'short-text' | 'long-text' | 'list' | 'url';
  required: boolean;
  maxLength: number;
}

/** POST /api/quiz/roadmap?resource=learning-path-start */
export interface StartActivityRequest {
  /** Previous automatic retry; used only to flag a brief needing review. */
  previousSession?: string;
  enrollmentId: string;
  activityId: string;
}

export interface StartActivityResponse {
  /** A renewed code attempt must show its latest brief before another Submit. */
  needsBriefReview?: boolean;
  attemptId: string;
  /** Sealed attempt session: owner, activity, version, purpose, expiry and
   * any answer key. Opaque to the browser. */
  session: string;
  expiresAt: string;
  /** The activity's public summary. A check's `scenario` and a code
   * activity's `fixtureNote` reach the workspace from here, as `domains` and
   * `rubricDimensions` do, so neither payload below repeats them. */
  activity: ActivitySummary;
  purpose: ActivityPurpose;
  lesson?: LessonBody;
  check?: { questions: CheckQuestionPayload[]; passThreshold: number; domainThreshold?: number };
  code?: PathCodePayload;
  artifact?: PathArtifactPayload;
  /** The learner's saved draft for this activity, if any. */
  draft: PathDraft | null;
  /** Set when the server could not read the draft: `draft: null` then means
   * "unknown", so the browser keeps its own unsaved copy. */
  draftUnavailable?: boolean;
  /** Prior recorded state, so a resumed workspace opens honestly. */
  previous: { state: EvidenceState; score: number | null; attempts: number } | null;
}

/* ── submitting ───────────────────────────────────────────────────────── */

/** POST /api/quiz/roadmap?resource=learning-path-submit */
export interface SubmitActivityRequest {
  session: string;
  /** Repeat-safe key minted by the client, one per intended submission. */
  idempotencyKey: string;
  /** Objective checks: one chosen option index per question, in order. */
  answers?: number[];
  /** Code activities. */
  code?: string;
  /** Artifact activities: field id to value. */
  artifact?: Record<string, string | string[]>;
  /** Lesson activities: the learner marking it read. */
  acknowledged?: boolean;
  durationMs?: number;
  hintsUsed?: number;
}

export interface CheckQuestionVerdict {
  questionId: string;
  correct: boolean;
  /** The correct option index in the order the learner saw, revealed with the
   * explanation once the answer is in. Absent, with the explanation, after a
   * failed project check: that check keeps its key until it is passed. */
  correctIndex?: number;
  explanation?: string;
  domain?: string;
}

export interface CriterionResult {
  id: string;
  label: string;
  /** A critical criterion cannot be averaged away: failing one fails the
   * activity however well the rest scored. */
  critical: boolean;
  weight: number;
  passed: boolean;
  detail: string | null;
}

export interface CodeVerdictPayload {
  outcome: 'passed' | 'failed' | 'error' | 'timeout';
  /** Visible test outcomes, in task order. */
  results: CallOutcome[];
  /** Hidden assertions are reported as counts only. */
  hidden: { passed: number; total: number } | null;
  check: TypeCheckResult | null;
  logs: string[];
  codeError: string | null;
}

export interface SubmitActivityResponse {
  complexity?: ComplexityReport | null;
  activityId: string;
  state: EvidenceState;
  verification: VerificationKind;
  /** 0..1 for anything scored; null for a lesson or a pure artifact. */
  score: number | null;
  domainScores?: Record<string, number>;
  /** Which domain gates failed, when a domain-gated check did not pass. */
  failedDomains?: string[];
  criteria: CriterionResult[];
  questions: CheckQuestionVerdict[] | null;
  code: CodeVerdictPayload | null;
  /** Guidance after a miss; never the reference implementation. */
  feedback: string[];
  /** Progress for the module this activity belongs to, after the write. */
  module: ModuleProgress | null;
  guidedComplete: boolean;
  nextActivityId: string | null;
  /** True when this response replays a previously accepted result rather than
   * grading again. */
  replayed: boolean;
  /** Actual server award; code reuses the ordinary coding reward ledger. */
  xpAwarded: number;
}

/* ── drafts ────────────────────────────────────────────────────────────── */

export interface PathDraft {
  activityId: string;
  revision: number;
  /** Code text, or the artifact's fields. */
  content: { code?: string; artifact?: Record<string, string | string[]> };
  updatedAt: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A draft holds code as text, or artifact fields as text or lists of text. */
export function isPathDraftContent(value: unknown): value is PathDraft['content'] {
  if (!isPlainObject(value)) return false;
  const { code, artifact } = value;
  if (code === undefined && artifact === undefined) return false;
  if (code !== undefined && typeof code !== 'string') return false;
  if (artifact === undefined) return true;
  return isPlainObject(artifact) && Object.values(artifact).every((field) =>
    typeof field === 'string' || (Array.isArray(field) && field.every((one) => typeof one === 'string')));
}

/** GET/PUT /api/user/[op]?op=learning-path-draft */
export interface DraftGetResponse {
  draft: PathDraft | null;
}

export interface DraftSaveRequest {
  enrollmentId: string;
  activityId: string;
  /** The revision the client believes it is editing. A stale value conflicts
   * rather than overwriting a newer save from another device. */
  expectedRevision: number;
  content: PathDraft['content'];
}

export interface DraftSaveResponse {
  draft: PathDraft;
}

/* ── capability ───────────────────────────────────────────────────────── */

/** Added to GET /api/settings. The server owns this: a client-only flag never
 * authorizes a write. */
export interface LearningPathCapability {
  /** Per path, so DSA can ship while FDE content is still being authored. */
  paths: Record<string, { enabled: boolean; version: number; availability: PathAvailability }>;
}

/** Payload limits, shared so the client can stop a save the server would
 * reject rather than discovering it after the fact. */
export const PATH_LIMITS = {
  /** Serialized draft or artifact submission. */
  payloadBytes: 64 * 1024,
  /** Submitted code, matching the existing coding limit. */
  codeBytes: 20 * 1024,
  /** At least every code exercise and artifact of a path, so a learner who
   * types into all of them is never refused (`npm run test:paths` checks it).
   * A pass keeps its draft: it is the only copy of the learner's passed code
   * the server holds. Idle drafts go after 90 days (the retention purge). */
  draftsPerEnrollment: 60,
  idempotencyKeyPattern: /^[A-Za-z0-9_-]{16,64}$/,
} as const;
