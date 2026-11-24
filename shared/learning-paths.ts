import type { DeliveryPhase } from './learning-path-phases';
/** The learning-path domain: one bounded vocabulary for devShark's optional
 * Forward Deployed Engineer role specialization. The standalone DSA
 * Foundations skill path retired in E5 (#496); its material is Learn content.
 *
 * This module owns ids, kinds, evidence vocabulary, the public manifest shapes
 * and the pure completion arithmetic, so browser and server agree without
 * either one holding an answer key. Authored bodies, answer keys and hidden
 * fixtures live under `lib/learning-paths/` and never reach this file.
 *
 * Deliberately separate from the existing registries:
 *   - `Track` (client/src/lib/tracks.ts) stays frontend/backend/fullstack.
 *   - `Specialization` (client/src/lib/leveling.ts) stays a cosmetic XP label.
 *   - `CodingTrack` and `RoadmapTopic` gain no members.
 * A learning path references those registries; it never joins them. */

import { isLearnSectionId, type LearnSectionId } from './learn-section-ids';

/* ── identity ──────────────────────────────────────────────────────────── */

/** Job-role specializations. FDE is the only one, and adding a second is a
 * product decision, not a content edit. */
export const ROLE_SPECIALIZATION_IDS = ['fde'] as const;
export type RoleSpecializationId = (typeof ROLE_SPECIALIZATION_IDS)[number];
export const isRoleSpecializationId = (value: unknown): value is RoleSpecializationId =>
  typeof value === 'string' && (ROLE_SPECIALIZATION_IDS as readonly string[]).includes(value);

export const LEARNING_PATH_IDS = ['fde'] as const;
export type LearningPathId = (typeof LEARNING_PATH_IDS)[number];
export const isLearningPathId = (value: unknown): value is LearningPathId =>
  typeof value === 'string' && (LEARNING_PATH_IDS as readonly string[]).includes(value);

/** A role specialization sits above a chosen base track and occupies the
 * learner's single specialization preference. The `skill_path` kind left with
 * the DSA path (E5, #496). */
export type LearningPathKind = 'role_specialization';

/** The base engineering tracks the career flow already offers. Mirrors
 * `Track` in the client without importing it: `shared/` cannot depend on
 * `client/src/`, and the server needs to validate the same three values. */
export const BASE_TRACKS = ['fullstack', 'frontend', 'backend'] as const;
export type BaseTrack = (typeof BASE_TRACKS)[number];
export const isBaseTrack = (value: unknown): value is BaseTrack =>
  typeof value === 'string' && (BASE_TRACKS as readonly string[]).includes(value);

/* ── activities and evidence ───────────────────────────────────────────── */

/** What a learner does. `lesson` is reading; `check` is a set of objective
 * scenario/trace questions; `code` runs through the existing server graders;
 * `artifact` is a structured written submission. */
export type ActivityKind = 'lesson' | 'check' | 'code' | 'artifact';

/** Why the activity exists. Derived from the manifest — never trusted from a
 * request — because it decides whether a result can count as placement
 * evidence or as core completion. */
export type ActivityPurpose = 'diagnostic' | 'exercise' | 'project';

/** How a result was established. A machine-verified pass came from the
 * server's graders. A self-reviewed artifact is the learner's own account of
 * their work: it is displayed and stored, and it never becomes a verified
 * check. Keeping the two apart is a product invariant, not a display choice. */
export type VerificationKind = 'machine_verified' | 'self_reviewed';

const EVIDENCE_STATES = [
  'not_started',
  'in_progress',
  'verified_pass',
  'self_reviewed',
  'needs_revision',
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** The states that satisfy a module requirement, per requirement. A required
 * `verified_pass` cannot be met by `self_reviewed`; that is the whole point of
 * separating them. */
export const SATISFYING_STATES: Record<EvidenceState, readonly EvidenceState[]> = {
  not_started: ['not_started', 'in_progress', 'verified_pass', 'self_reviewed', 'needs_revision'],
  in_progress: ['in_progress', 'verified_pass', 'self_reviewed'],
  verified_pass: ['verified_pass'],
  self_reviewed: ['self_reviewed', 'verified_pass'],
  needs_revision: ['needs_revision'],
};

/* ── the public manifest ───────────────────────────────────────────────── */

/** A named capability the path teaches and the diagnostic measures. */
interface CompetencyDescriptor {
  id: string;
  title: string;
  summary: string;
}

/** A published source the author checked, with the date they checked it. The
 * content validator requires one per lesson so a stale example is traceable. */
export interface SourceReference {
  label: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the author last verified the link's claims. */
  reviewedOn: string;
}

/** One rubric dimension, in the learner-visible words used before they start.
 * Descriptors are observable, so a learner can self-review honestly. */
interface RubricDimension {
  id: string;
  title: string;
  levels: {
    missing: string;
    partial: string;
    adequate: string;
    strong: string;
  };
}

interface RubricDescriptor {
  version: number;
  dimensions: RubricDimension[];
}

/** The public shape of one activity: enough to preview, plan and understand
 * how it is judged, with no answer, fixture or hidden assertion. */
export interface ActivitySummary {
  id: string;
  kind: ActivityKind;
  purpose: ActivityPurpose;
  verification: VerificationKind;
  title: string;
  /** One sentence on what the learner will do. */
  summary: string;
  competencies: string[];
  estimatedMinutes: number;
  /** Objective checks: how many questions and the share that must be right. */
  questionCount?: number;
  passThreshold?: number;
  /** Objective checks that gate on every domain separately (the DSA final). */
  domains?: string[];
  /** Code activities: which server grader runs the submission. */
  language?: PathCodeLanguage;
  /** Code activities that reuse an ordinary coding task, by its stable id.
   * The learner reaches it through the path without the ordinary tier gate,
   * and the pass records path evidence only — never coding XP or a tier
   * unlock. */
  reuseTaskId?: string;
  /** Artifacts: the rubric dimensions the learner self-reviews against. */
  rubricDimensions?: string[];
  /** Checks only: a shared preamble shown once above the ordered questions,
   * so a decomposition case is one check. It ships in the public manifest
   * and must never state an answer. */
  scenario?: string;
  /** Code activities only: shown above the editor. It says the fixture is
   * deliberately unfamiliar and what "done" means. */
  fixtureNote?: string;
}

interface ModuleRequirement {
  activityId: string;
  state: EvidenceState;
}

/** A quota beside `requires`: at least `count` of the activities in `of` must
 * reach `state`. The decomposition module asks for nine of its twelve cases,
 * so one weak case cannot hold the module back and nine strong ones still
 * have to exist. */
export interface ModuleRequirementQuota {
  count: number;
  of: string[];
  state: EvidenceState;
}

/** Named lists of modules the hub shows apart from the loop. Not the Learn
 * section's shelf of paths (shared/progression.ts): this one groups modules
 * inside one path. */
export const MODULE_SHELVES = ['interview-prep'] as const;
export type ModuleShelf = (typeof MODULE_SHELVES)[number];

/** Whether a module sits outside the loop: optional placement and bridge
 * modules, and every shelf module. An off-loop module never gates path
 * completion, never supplies the next action and never counts toward the
 * inventory's module total, which the merchandise reward compares with the
 * completed modules. The validator also makes every shelf module optional;
 * this checks both so the rule holds even if that ever slips.
 *
 * Server code and server-only shared functions only. The client must not
 * import it as a value: this file sits in the initial chunk, so a client
 * value import would add it to every first visit. */
export const isOffLoopModule = ({ optional, shelf }: { optional?: boolean; shelf?: ModuleShelf }): boolean =>
  optional === true || shelf !== undefined;

export interface ModuleSummary {
  /** FDE delivery-loop phase; placement, shelves and the capstone sit apart. */
  deliveryPhase?: DeliveryPhase;
  id: string;
  title: string;
  /** What the learner can do after the module, in their words. */
  outcomes: string[];
  competencies: string[];
  /** Module ids that should come first. Advisory for browsing, and the
   * validator proves the graph is acyclic. */
  dependsOn: string[];
  lessons: LessonSummary[];
  activities: ActivitySummary[];
  requires: ModuleRequirement[];
  /** Met as well as every entry of `requires`, never instead of them. */
  requiresAtLeast?: ModuleRequirementQuota;
  estimatedMinutes: number;
  /** Placement diagnostics and bridges live in modules the learner may skip
   * entirely. An optional module never gates path completion and never
   * supplies the next required action. */
  optional?: boolean;
  /** Listed apart from the loop (the interview-prep shelf) and always paired
   * with `optional: true`. It never gates completion and never supplies the
   * next action. */
  shelf?: ModuleShelf;
}

interface LessonSummary {
  id: string;
  title: string;
  /** One sentence for the module list; the body arrives with the lesson. */
  summary: string;
  estimatedMinutes: number;
  sources: SourceReference[];
}

/** A recommendation attached to a competency the learner has not shown. Points
 * at material that already exists rather than duplicating it. */
export interface BridgeSummary {
  id: string;
  title: string;
  summary: string;
  /** Base tracks this bridge is usually suggested to; the diagnostic can
   * recommend it to anyone whose evidence calls for it. */
  suggestedFor: BaseTrack[];
  competencies: string[];
  /** Existing Learn topics/levels and coding tasks worth revisiting. */
  references: BridgeReference[];
  estimatedMinutes: number;
}

interface BridgeReference {
  kind: 'roadmap-topic' | 'coding-task' | 'path-activity' | 'doc';
  /** Topic id, coding task id, activity id, or an absolute documentation URL. */
  ref: string;
  label: string;
}

/** The published, learner-visible description of one path version. */
export interface LearningPathManifest {
  id: LearningPathId;
  kind: LearningPathKind;
  version: number;
  title: string;
  /** The honest promise: what the path covers and what it does not. */
  summary: string;
  outcomes: string[];
  /** What the path deliberately excludes, so nobody infers coverage. */
  nonGoals: string[];
  /** Prose entry requirement; enrollment never enforces a rank or XP gate. */
  entryRequirement: string;
  competencies: CompetencyDescriptor[];
  modules: ModuleSummary[];
  bridges: BridgeSummary[];
  rubric: RubricDescriptor;
  /** The diagnostic activity id, when the path offers one. Always skippable. */
  diagnosticActivityId: string | null;
  estimatedHours: { min: number; max: number };
  sources: SourceReference[];
  /** ISO date of the latest curriculum authoring review. Individual source
   * references retain their own claim-verification dates. */
  reviewedOn: string;
  /** Wording the completion screen may use. No certification, no hiring claim. */
  completionLabel: string;
}

export type PathCodeLanguage = 'javascript' | 'typescript' | 'react';

/* ── derived counts ────────────────────────────────────────────────────── */

/** The real inventory of a published manifest. Every count the product shows
 * comes from here, so a screen can never advertise unbuilt content. */
export interface PathInventory {
  /** Modules that gate completion; off-loop modules (optional placement, bridges, shelves) excluded. */
  modules: number;
  lessons: number;
  /** Every objective question in the path, whatever its purpose. A shelf
   * module's questions, code and artifacts are not counted here or below:
   * the interview shelf is listed apart from the loop. */
  checks: number;
  /** Every code exercise in the path, whatever its purpose. */
  codeExercises: number;
  artifacts: number;
  estimatedMinutes: number;
  /** The same counts split by purpose, so a screen can say "36 module checks
   * and a 10-question final assessment" instead of one number that means
   * neither. Diagnostics are placement, not curriculum. */
  moduleChecks: number;
  moduleCodeExercises: number;
  finalChecks: number;
  finalCodeExercises: number;
  diagnosticChecks: number;
  diagnosticCodeExercises: number;
}

export function pathInventory(manifest: LearningPathManifest): PathInventory {
  const zero = { checks: 0, code: 0 };
  const byPurpose: Record<ActivityPurpose, { checks: number; code: number }> = {
    diagnostic: { ...zero },
    exercise: { ...zero },
    project: { ...zero },
  };
  let lessons = 0;
  let artifacts = 0;
  let estimatedMinutes = 0;
  let modules = 0;
  for (const module of manifest.modules) {
    if (!isOffLoopModule(module)) {
      modules += 1;
      lessons += module.lessons.length;
      estimatedMinutes += module.estimatedMinutes;
    }
    // Placement and bridge activities keep their purpose split below; a
    // shelf's do not reach the path's totals at all.
    if (module.shelf !== undefined) continue;
    for (const activity of module.activities) {
      if (activity.kind === 'check') byPurpose[activity.purpose].checks += activity.questionCount ?? 0;
      else if (activity.kind === 'code') byPurpose[activity.purpose].code += 1;
      else if (activity.kind === 'artifact') artifacts += 1;
    }
  }
  return {
    modules,
    lessons,
    checks: byPurpose.diagnostic.checks + byPurpose.exercise.checks + byPurpose.project.checks,
    codeExercises: byPurpose.diagnostic.code + byPurpose.exercise.code + byPurpose.project.code,
    artifacts,
    estimatedMinutes,
    moduleChecks: byPurpose.exercise.checks,
    moduleCodeExercises: byPurpose.exercise.code,
    finalChecks: byPurpose.project.checks,
    finalCodeExercises: byPurpose.project.code,
    diagnosticChecks: byPurpose.diagnostic.checks,
    diagnosticCodeExercises: byPurpose.diagnostic.code,
  };
}

/* ── progress ──────────────────────────────────────────────────────────── */

interface ActivityProgress {
  activityId: string;
  state: EvidenceState;
  verification: VerificationKind | null;
  /** Best recorded score for an objective check, 0..1. */
  score: number | null;
  /** Per-domain scores for a check that gates on domains. */
  domainScores?: Record<string, number>;
  attempts: number;
  updatedAt: string | null;
}

export interface ModuleProgress {
  moduleId: string;
  /** True only when every entry of `requires` and the quota are satisfied. */
  completed: boolean;
  completedAt: string | null;
  activities: ActivityProgress[];
}

const stateSatisfies = (required: EvidenceState, actual: EvidenceState): boolean =>
  SATISFYING_STATES[required].includes(actual);

/** The activities of a quota that already reach its state. */
function quotaMet(
  quota: ModuleRequirementQuota,
  states: ReadonlyMap<string, EvidenceState>,
): string[] {
  return quota.of.filter((activityId) => stateSatisfies(quota.state, states.get(activityId) ?? 'not_started'));
}

/** Whether a module's requirements are met by the states recorded for it:
 * every entry of `requires`, and the quota when the module carries one. */
export function moduleComplete(
  module: Pick<ModuleSummary, 'requires' | 'requiresAtLeast'>,
  states: ReadonlyMap<string, EvidenceState>,
): boolean {
  const quota = module.requiresAtLeast;
  if (module.requires.length === 0 && !quota) return false;
  return module.requires.every((requirement) =>
    stateSatisfies(requirement.state, states.get(requirement.activityId) ?? 'not_started'),
  ) && (!quota || quotaMet(quota, states).length >= quota.count);
}

/** Guided completion: every required module's evidence is in place. Off-loop
 * modules (placement, bridges, shelves) never count. A module that requires a written
 * artifact at `self_reviewed` is not complete until it is submitted, so the
 * FDE path, whose modules require three such pieces, cannot complete (or earn
 * its merchandise) without them. They are still never counted as verified:
 * `self_reviewed` satisfies only a `self_reviewed` requirement. */
export function pathGuidedComplete(
  manifest: LearningPathManifest,
  states: ReadonlyMap<string, EvidenceState>,
): boolean {
  const required = manifest.modules.filter((module) => !isOffLoopModule(module));
  return required.length > 0 && required.every((module) => moduleComplete(module, states));
}

/** How many self-reviewed artifacts the learner has submitted, out of the
 * loop's total. Shown on its own line beside guided completion, which
 * already requires every artifact a module lists in `requires`, under copy
 * that calls every counted piece required. Off-loop modules (the interview
 * shelf's write-ups) are skipped, as `pathGuidedComplete` skips them, so the
 * total never names optional practice as required. */
export function artifactTally(
  manifest: LearningPathManifest,
  states: ReadonlyMap<string, EvidenceState>,
): { submitted: number; total: number } {
  const artifacts = manifest.modules.flatMap((module) =>
    isOffLoopModule(module) ? [] : module.activities.filter((activity) => activity.kind === 'artifact'),
  );
  const submitted = artifacts.filter((activity) => {
    const state = states.get(activity.id);
    return state === 'self_reviewed' || state === 'verified_pass';
  }).length;
  return { submitted, total: artifacts.length };
}

/** The next thing worth doing in the first incomplete module: a lesson not
 * read yet, in the module's own order, and then the first unmet requirement,
 * preferring an activity already in progress. Lessons never gate a module, so
 * they are not requirements, but a module teaches before it checks: without
 * this a new learner is sent to the module check before any lesson. One
 * concrete action, never a list of everything outstanding. */
export function nextActivityId(
  manifest: LearningPathManifest,
  states: ReadonlyMap<string, EvidenceState>,
): string | null {
  for (const module of manifest.modules) {
    if (isOffLoopModule(module) || moduleComplete(module, states)) continue;
    const unread = module.activities.find((activity) => {
      if (activity.kind !== 'lesson') return false;
      const state = states.get(activity.id);
      return state !== 'self_reviewed' && state !== 'verified_pass';
    });
    if (unread) return unread.id;
    const unmet = module.requires
      .filter((requirement) => !stateSatisfies(requirement.state, states.get(requirement.activityId) ?? 'not_started'))
      .map((requirement) => requirement.activityId);
    // An unmet quota offers each of its activities not yet at its state, in
    // the module's order, after the plain requirements.
    const quota = module.requiresAtLeast;
    if (quota && quotaMet(quota, states).length < quota.count) {
      const met = new Set(quotaMet(quota, states));
      unmet.push(...quota.of.filter((activityId) => !met.has(activityId) && !unmet.includes(activityId)));
    }
    if (unmet.length === 0) continue;
    const started = unmet.find((activityId) => {
      const state = states.get(activityId);
      return state === 'in_progress' || state === 'needs_revision';
    });
    return started ?? unmet[0];
  }
  return null;
}

/* ── the account preference ────────────────────────────────────────────── */

/** The account-synced learning preference. `baseTrack` keeps the career flow's
 * existing choice; `specialization` is the optional role above it and is null
 * for a learner who continued without one. */
export interface LearningPreference {
  schemaVersion: 1;
  baseTrack: BaseTrack;
  specialization: RoleSpecializationId | null;
}

export const LEARNING_PREFERENCE_META_KEY = 'devquiz_learning_preference_v1';
/** The pre-existing track field, still written for older clients. */
export const LEGACY_TRACK_META_KEY = 'devquiz_track';

/**
 * Read a stored preference defensively.
 *
 * Salvages what it can rather than discarding the record: a base track it
 * cannot recognise makes the preference unusable, but an unrecognised
 * specialization only costs the specialization. A learner whose account picked
 * up a bad role value — an older client, a hand-edited record, a role that no
 * longer exists — keeps their track and simply has no specialization, instead
 * of being handed back to the picker as though they had never chosen anything.
 *
 * The specialization is a preference, not an authority: nothing about access or
 * completion is decided from it, so recovering it this way is safe.
 */
export function parseLearningPreference(value: unknown): LearningPreference | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) return null;
  if (!isBaseTrack(raw.baseTrack)) return null;
  return {
    schemaVersion: 1,
    baseTrack: raw.baseTrack,
    specialization: isRoleSpecializationId(raw.specialization) ? raw.specialization : null,
  };
}

/* ── the learner profile ───────────────────────────────────────────────── */

/** What the learner is here for. A learner may hold more than one goal; the
 * plan reads them to order recommendations, never to grant access. */
export const LEARNER_GOALS = ['first-job', 'change-track', 'level-up', 'interview-prep', 'side-projects'] as const;
export type LearnerGoal = (typeof LEARNER_GOALS)[number];
export const isLearnerGoal = (value: unknown): value is LearnerGoal =>
  typeof value === 'string' && (LEARNER_GOALS as readonly string[]).includes(value);
export const MAX_LEARNER_GOALS = 3;

/** How much programming the learner has done. Advisory only, and deliberately
 * so: it orders recommendations and sets the tone of an explanation. It never
 * unlocks a level, skips a prerequisite or stands in for verified evidence.
 * `unsure` is a real answer, matching the placement check's "I don't know yet". */
export const EXPERIENCE_LEVELS = ['unsure', 'new', 'some', 'professional'] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];
export const isExperienceLevel = (value: unknown): value is ExperienceLevel =>
  typeof value === 'string' && (EXPERIENCE_LEVELS as readonly string[]).includes(value);

/** Minutes the learner expects to study on a day they study. Sizes the Today
 * queue and the short practice sessions; it is a preference, not a quota. */
export const STUDY_TIMES = ['under-15', '15-30', '30-60', '60-plus'] as const;
export type StudyTime = (typeof STUDY_TIMES)[number];
export const isStudyTime = (value: unknown): value is StudyTime =>
  typeof value === 'string' && (STUDY_TIMES as readonly string[]).includes(value);

/**
 * The versioned learner profile: everything the learner told us about what
 * they are learning and why.
 *
 * It is one record with one writer. `baseTrack` and `specialization` keep the
 * meaning they have in `LearningPreference`, which is still written beside it
 * so a client that predates this profile reads a preference it understands.
 * The rest is new: the goals, the experience answer and the study-time band
 * that let Today, the roadmap and the short sessions describe a plan instead
 * of a catalogue.
 *
 * None of it is authority. Eligibility comes from this profile *plus*
 * server-verified completions (see `shared/progression.ts`); the profile alone
 * never unlocks anything, and `experience` least of all.
 */
export interface LearnerProfile {
  schemaVersion: 2;
  baseTrack: BaseTrack;
  specialization: RoleSpecializationId | null;
  /** Learn sections the learner chose to join (`shared/learn-sections.ts`).
   * Missing means none chosen: Web Developer comes with the base track and
   * Forward Deployed Engineer with the `fde` specialization regardless, so
   * only an opt-in section such as Software Engineer needs saving here. */
  sections?: LearnSectionId[];
  goals: LearnerGoal[];
  experience: ExperienceLevel;
  studyTime: StudyTime;
  /** When the learner last saved it, ISO-8601. Used to show "updated" copy and
   * to break ties between two devices; never to expire a plan. */
  updatedAt: string | null;
}

export const LEARNER_PROFILE_META_KEY = 'devquiz_learner_profile_v2';

/** The fields a learner must answer before practice is personalised. The base
 * track is not listed because a profile without one does not parse at all. */
const REQUIRED_PROFILE_FIELDS = ['goals', 'experience', 'studyTime'] as const;
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

/**
 * Read a stored profile defensively, in the same spirit as
 * `parseLearningPreference`: salvage what is readable rather than handing a
 * learner back to onboarding because one field went bad. An unusable base
 * track is the only thing that voids the record.
 *
 * A field that fails validation comes back missing rather than guessed, so
 * `missingProfileFields` asks for it again instead of inventing an answer.
 */
export function parseLearnerProfile(value: unknown): LearnerProfile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 2) return null;
  if (!isBaseTrack(raw.baseTrack)) return null;
  const goals = Array.isArray(raw.goals)
    ? Array.from(new Set(raw.goals.filter(isLearnerGoal))).slice(0, MAX_LEARNER_GOALS)
    : [];
  // Unknown section ids are dropped; a missing or malformed list stays
  // missing, which means "none chosen", never a guess.
  const sections = Array.isArray(raw.sections)
    ? Array.from(new Set(raw.sections.filter(isLearnSectionId)))
    : undefined;
  return {
    schemaVersion: 2,
    baseTrack: raw.baseTrack,
    specialization: isRoleSpecializationId(raw.specialization) ? raw.specialization : null,
    ...(sections ? { sections } : {}),
    goals,
    // An unreadable answer is a missing answer, not a default one.
    experience: isExperienceLevel(raw.experience) ? raw.experience : ('' as ExperienceLevel),
    studyTime: isStudyTime(raw.studyTime) ? raw.studyTime : ('' as StudyTime),
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.length <= 40 ? raw.updatedAt : null,
  };
}

/** Which required answers are still missing. Empty means the profile is
 * complete and personalised practice can start. */
export function missingProfileFields(profile: LearnerProfile | null): RequiredProfileField[] {
  if (!profile) return [...REQUIRED_PROFILE_FIELDS];
  const missing: RequiredProfileField[] = [];
  if (profile.goals.length === 0) missing.push('goals');
  if (!isExperienceLevel(profile.experience)) missing.push('experience');
  if (!isStudyTime(profile.studyTime)) missing.push('studyTime');
  return missing;
}

export const isLearnerProfileComplete = (profile: LearnerProfile | null): boolean =>
  profile !== null && missingProfileFields(profile).length === 0;

/** The profile an account that only ever saved a v1 preference implies: the
 * plan it already chose, and the required answers still outstanding. */
export const profileFromPreference = (preference: LearningPreference | null): LearnerProfile | null =>
  preference === null
    ? null
    : {
        schemaVersion: 2,
        baseTrack: preference.baseTrack,
        specialization: preference.specialization,
        goals: [],
        experience: '' as ExperienceLevel,
        studyTime: '' as StudyTime,
        updatedAt: null,
      };

/* ── id shapes ─────────────────────────────────────────────────────────── */

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const isPathContentId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 3 && value.length <= 96 && ID_PATTERN.test(value);

/** Activity ids carry their path and version so a stale client cannot submit
 * a v1 answer against a v2 activity: `fde-v1-m08-untrusted-content`. */
export const activityIdPrefix = (pathId: LearningPathId, version: number): string =>
  `${pathId}-v${version}-`;
