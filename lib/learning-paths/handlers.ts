/** Learning-path API resources.
 *
 * Mounted on the existing handlers so the twelve-function budget is unchanged:
 * `api/quiz/roadmap.ts` serves learning-path-catalog, learning-path-start and
 * learning-path-submit; `api/user/[op].ts` serves learning-preference,
 * learning-path-enrollment, learning-path-progress and learning-path-draft;
 * `api/settings.ts` publishes the per-path capability.
 *
 * Everything authoritative is derived here, never taken from the request: the
 * owner from the verified token, the deployment scope from the environment,
 * the activity and its purpose from the manifest, and the answer key from the
 * sealed attempt session. A client-supplied score, completion flag or purpose
 * is ignored rather than validated. */

import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { assessComplexity } from '../coding/complexity';
import { codingPassXp, complexityGuidance, type ComplexityReport } from '../../shared/coding-complexity';
import { codingAwardId, creditVerifiedXp, settleMilestonesAfterPass } from '../rewards/coins';
import { AuthError, tryAuth } from '../auth';
import { createLogger, isRpcMissing, jsonError, requireAuthSub, ServiceUnavailableError, withTimeout } from '../http';
import { prefetchTier, refuseLocked, resolveTier } from '../access';
import { enforceAddressRateLimit, enforcePerItemRateLimit, enforceRateLimit, enterInFlight, RATE_LIMITS } from '../rate-limit';
import { deploymentSubjectIds } from '../product-scope';
import { secureShuffle } from '../quiz-runtime';
import { shuffleWithOrder } from '../coding/grade';
import { GRADING_PER_CALLER, GRADING_PER_TASK, GraderBusyError, gradingItem } from '../coding/grader-capacity';
import { decodeLearningPathSession } from '../quiz-tokens';
import { canonicalCodingTaskId } from './coding-task-id';
import {
  activityIn,
  activitySummary,
  availabilityFor,
  LEARNING_PATHS,
  manifestFor,
  moduleSummary,
  pathById,
  inventoryFor,
  pathEnabledInEnv,
  publicManifest,
} from './catalog';
import {
  codeFeedback,
  codeFromReusedTask,
  domainThresholds,
  gradeArtifact,
  gradeCheck,
  gradePathCode,
  pathCodeTooLarge,
  requestHash,
} from './grade';
import type { MergedActivity, MergedPath } from './types';
import { activityDomainScores, diagnosticCompetencies, diagnosticEvidence } from './competencies';
import {
  isExperienceLevel,
  isLearnerGoal,
  isLearningPathId,
  isBaseTrack,
  isStudyTime,
  LEARNER_PROFILE_META_KEY,
  LEARNING_PREFERENCE_META_KEY,
  LEGACY_TRACK_META_KEY,
  MAX_LEARNER_GOALS,
  missingProfileFields,
  parseLearnerProfile,
  parseLearningPreference,
  profileFromPreference,
  isOffLoopModule,
  moduleComplete,
  nextActivityId as computeNextActivity,
  pathGuidedComplete,
  pathInventory,
  artifactTally,
  SATISFYING_STATES,
  type BaseTrack,
  type EvidenceState,
  type LearningPathId,
  type ModuleProgress,
} from '../../shared/learning-paths';
import type {
  CompetencyResult,
  DraftGetResponse,
  DraftSaveRequest,
  DraftSaveResponse,
  EnrollmentCreateRequest,
  EnrollmentListResponse,
  LearningPathCatalogResponse,
  LearningPathCapability,
  LearningPreferenceRequest,
  LearningPreferenceResponse,
  PathAvailability,
  PathCatalogEntry,
  PathDraft,
  PathEnrollment,
  PathProgressResponse,
  StartActivityRequest,
  StartActivityResponse,
  SubmitActivityRequest,
  SubmitActivityResponse,
} from '../../shared/learning-path-api';
import { PATH_LIMITS } from '../../shared/learning-path-api';
import { LEARN_SECTION_IDS, isLearnSectionId } from '../../shared/learn-section-ids';
import { MAX_ADDRESS_FIELD, MERCH_ENABLED, SHIRT_SIZES, validateAddress } from '../../shared/rewards';

const logEvent = createLogger('learning-paths');

/* Loaded on first use (#587, server item 3). The attempt sessions bind a code
 * activity to its authored and hidden material (./session through ./audit),
 * which reads the coding catalogue with its reference solutions, the path
 * solutions and the curation registry: most of what this module cost a fresh
 * user-function instance before its first enrollment or progress read, which
 * every Learn section makes for a signed-in learner. Only starting and
 * submitting an activity need them. A plain `require` keeps each call site
 * synchronous and is what @vercel/node's file tracer follows. */
const attemptSessions = () => require('./session') as typeof import('./session');
const codingCatalogue = () => require('../coding/active') as typeof import('../coding/active');

const pathsAvailable = () => deploymentSubjectIds().includes('webdev');
const notAvailable = (res: VercelResponse) =>
  jsonError(res, 404, 'not_available', 'Learning paths are not part of this product');

const ID = /^[A-Za-z0-9_-]{16,64}$/;
/** The highest revision save_learning_path_draft accepts (migration 026). */
const MAX_DRAFT_REVISION = 1_000_000;
const newId = () => randomBytes(18).toString('base64url');

/** Storage readiness is discovered, not configured: the first call that hits a
 * missing RPC reports it, and everything else keeps working meanwhile. */
let storageInstalled: boolean | null = null;
export const markStorageMissing = () => { storageInstalled = false; };
export const markStorageInstalled = () => { storageInstalled = true; };

/** `availabilityFor` caches the content verdict per path (catalog.ts), so this
 * stays cheap on every settings, catalog, enrollment, start and submit call. */
function availability(path: MergedPath): PathAvailability {
  return availabilityFor({
    path,
    enabled: pathEnabledInEnv(path.id),
    storageInstalled: storageInstalled !== false,
  });
}

/** The capability `api/settings.ts` publishes. The client reads it to decide
 * what to show; it never authorizes a write, which is checked here. */
export function learningPathCapability(): LearningPathCapability {
  if (!pathsAvailable()) return { paths: {} };
  const paths: LearningPathCapability['paths'] = {};
  for (const path of LEARNING_PATHS) {
    const state = availability(path);
    paths[path.id] = { enabled: state === 'available', version: path.version, availability: state };
  }
  return { paths };
}

/* ── catalog ───────────────────────────────────────────────────────────── */

/** GET /api/quiz/roadmap?resource=learning-path-catalog — public. */
export async function handleLearningPathCatalog(req: VercelRequest, res: VercelResponse) {
  if (!pathsAvailable()) return notAvailable(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const paths: PathCatalogEntry[] = LEARNING_PATHS.map((path) => {
    const manifest = publicManifest(path);
    return { manifest, availability: availability(path), inventory: pathInventory(manifest) };
  });
  const versions = Object.fromEntries(LEARNING_PATHS.map((path) => [path.id, path.version]));
  // The manifest changes only when a published version changes, so it caches
  // by version rather than per request.
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
  const body: LearningPathCatalogResponse = { paths, versions };
  logEvent({ status: 200, kind: 'catalog', paths: paths.length });
  return res.json(body);
}

/* ── shared lookups ───────────────────────────────────────────────────── */

interface EnrollmentRow {
  enrollment_id: string;
  user_id: string;
  path_id: string;
  curriculum_version: number;
  base_track_at_enrollment: string | null;
  status: string;
  started_at: string;
  updated_at: string;
}
const ENROLLMENT_FIELDS =
  'enrollment_id,user_id,path_id,curriculum_version,base_track_at_enrollment,status,started_at,updated_at';

const toEnrollment = (row: EnrollmentRow): PathEnrollment => ({
  enrollmentId: row.enrollment_id,
  pathId: row.path_id as LearningPathId,
  curriculumVersion: Number(row.curriculum_version),
  status: (row.status as PathEnrollment['status']) ?? 'active',
  baseTrackAtEnrollment: isBaseTrack(row.base_track_at_enrollment) ? row.base_track_at_enrollment : null,
  startedAt: row.started_at,
  updatedAt: row.updated_at,
});

/** A Supabase failure that means migration 026 has not been applied yet. The
 * caller turns it into a 503 and every other feature carries on. */
function migrationMissing(res: VercelResponse, error: { message?: string } | null): boolean {
  if (!isRpcMissing(error) && !/relation .*learning_path_.* does not exist/i.test(error?.message ?? '')) return false;
  markStorageMissing();
  jsonError(res, 503, 'migration_required', 'Learning-path migration 026 is not installed');
  return true;
}

async function loadEnrollments(supabase: SupabaseClient, userId: string): Promise<EnrollmentRow[]> {
  const { data, error } = await withTimeout(
    supabase.from('learning_path_enrollments').select(ENROLLMENT_FIELDS).eq('user_id', userId),
  );
  if (error) throw Object.assign(new Error('db_error'), { supabase: error });
  markStorageInstalled();
  return (data ?? []) as EnrollmentRow[];
}

async function loadEnrollment(
  supabase: SupabaseClient,
  userId: string,
  enrollmentId: string,
): Promise<EnrollmentRow | null> {
  const { data, error } = await withTimeout(
    supabase.from('learning_path_enrollments').select(ENROLLMENT_FIELDS)
      .eq('enrollment_id', enrollmentId).eq('user_id', userId).maybeSingle(),
  );
  if (error) throw Object.assign(new Error('db_error'), { supabase: error });
  markStorageInstalled();
  return (data as EnrollmentRow | null) ?? null;
}

interface ProgressRow {
  module_id: string;
  activity_states: Record<string, {
    state?: string;
    score?: number | null;
    verification?: string | null;
    domainScores?: Record<string, number> | null;
    attempts?: number;
    updatedAt?: string | null;
  }> | null;
  completed_at: string | null;
}

/** The enrollment's progress rows. With `userId`, only rows that account
 * owns: every row carries the user_id of its enrollment's owner (the accept
 * routines write it from the owner they checked), so for the caller's own
 * enrollment this is the same set, and it can be read before the enrollment
 * is proven theirs without reading anyone else's rows. */
async function loadProgressRows(supabase: SupabaseClient, enrollmentId: string, userId?: string): Promise<ProgressRow[]> {
  const query = supabase.from('learning_path_progress').select('module_id,activity_states,completed_at').eq('enrollment_id', enrollmentId);
  const { data, error } = await withTimeout(userId ? query.eq('user_id', userId) : query);
  if (error) throw Object.assign(new Error('db_error'), { supabase: error });
  markStorageInstalled();
  return (data ?? []) as ProgressRow[];
}

/** activity id → recorded state, the shape the shared completion helpers want. */
function stateMap(rows: ProgressRow[]): Map<string, EvidenceState> {
  const states = new Map<string, EvidenceState>();
  for (const row of rows) {
    for (const [activityId, value] of Object.entries(row.activity_states ?? {})) {
      const state = value?.state;
      if (typeof state === 'string') states.set(activityId, state as EvidenceState);
    }
  }
  return states;
}

type RecordedActivity = NonNullable<ProgressRow['activity_states']>[string];

/** One activity's recorded progress as the client reads it. */
function activityProgress(activity: MergedActivity, value: RecordedActivity | undefined): ModuleProgress['activities'][number] {
  const domainScores = activityDomainScores(activity, value?.domainScores);
  return {
    activityId: activity.id,
    state: (value?.state as EvidenceState) ?? 'not_started',
    verification: (value?.verification as ModuleProgress['activities'][number]['verification']) ?? null,
    score: typeof value?.score === 'number' ? value.score : null,
    ...(domainScores ? { domainScores } : {}),
    attempts: Number(value?.attempts ?? 0),
    updatedAt: value?.updatedAt ?? null,
  };
}

function moduleProgressFor(path: MergedPath, rows: ProgressRow[]): ModuleProgress[] {
  const byModule = new Map(rows.map((row) => [row.module_id, row]));
  const states = stateMap(rows);
  return path.modules.map((module) => {
    const row = byModule.get(module.id);
    const recorded = row?.activity_states ?? {};
    return {
      moduleId: module.id,
      completed: !isOffLoopModule(module) && moduleComplete(module, states),
      completedAt: row?.completed_at ?? null,
      activities: module.activities.map((activity) => activityProgress(activity, recorded[activity.id])),
    };
  });
}

/** Read the latest accepted evidence so a weaker retake can inform recommendations
 * without demoting a previously passed module/completion record. */
async function loadDiagnosticEvidence(supabase: SupabaseClient, userId: string, enrollmentId: string, path: MergedPath): Promise<Record<string, number> | null> {
  if (!path.diagnosticActivityId) return null;
  const { data, error } = await withTimeout(supabase.from('learning_path_evidence')
    .select('domain_scores').eq('enrollment_id', enrollmentId).eq('user_id', userId)
    .eq('activity_id', path.diagnosticActivityId).order('revision', { ascending: false }).limit(1).maybeSingle());
  if (error) throw Object.assign(new Error('db_error'), { supabase: error });
  return data?.domain_scores ?? null;
}

function recommendedBridges(path: MergedPath, competencies: CompetencyResult[], baseTrack: BaseTrack | null): string[] {
  const gaps = new Set(competencies.filter((one) => one.state === 'gap').map((one) => one.competencyId));
  const unassessed = new Set(competencies.filter((one) => one.state === 'not_assessed').map((one) => one.competencyId));
  const scored = path.bridges.map((bridge) => {
    const gapHits = bridge.competencies.filter((one) => gaps.has(one)).length;
    const unknownHits = bridge.competencies.filter((one) => unassessed.has(one)).length;
    const trackHit = baseTrack && bridge.suggestedFor.includes(baseTrack) ? 1 : 0;
    return { id: bridge.id, weight: gapHits * 4 + unknownHits + trackHit };
  });
  return scored.filter((one) => one.weight > 0).sort((a, b) => b.weight - a.weight).map((one) => one.id);
}

/* ── preference ───────────────────────────────────────────────────────── */

/** The `user_metadata` of a user record Supabase Auth returned for the
 * token, or null when the verified result carries none (lib/auth.ts's local
 * development fallback is `{ sub }` alone). */
function verifiedUserMetadata(payload: Record<string, unknown>): Record<string, unknown> | null {
  const metadata = payload.user_metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
}

/** GET/PUT /api/user/[op]?op=learning-preference */
export async function handleLearningPreference(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  const auth = await tryAuth(req).catch((error) => {
    if (error instanceof AuthError) return null;
    throw error;
  });
  if (!auth?.sub) return jsonError(res, 401, 'unauthorized', 'Sign in to read or change your learning preference');
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  if (req.method === 'GET') {
    const { data, error } = await withTimeout(supabase.auth.admin.getUserById(auth.sub));
    if (error) return jsonError(res, 500, 'db_error', 'Could not read the account preference');
    const metadata = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    const legacy = metadata[LEGACY_TRACK_META_KEY];
    const preference = parseLearningPreference(metadata[LEARNING_PREFERENCE_META_KEY]);
    // An account that only ever saved a v1 preference reads back as the plan it
    // already chose with its required answers still outstanding, so onboarding
    // asks for what is missing instead of starting again from nothing.
    const profile = parseLearnerProfile(metadata[LEARNER_PROFILE_META_KEY]) ?? profileFromPreference(preference);
    res.setHeader('Cache-Control', 'private, no-store');
    const body: LearningPreferenceResponse = {
      preference,
      legacyTrack: isBaseTrack(legacy) ? legacy : null,
      profile,
      missingProfileFields: missingProfileFields(profile),
    };
    return res.json(body);
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as Partial<LearningPreferenceRequest>;
    if (!isBaseTrack(body.baseTrack)) return jsonError(res, 400, 'bad_request', 'baseTrack must be fullstack, frontend or backend');
    const specialization = body.specialization === null || body.specialization === undefined ? null : body.specialization;
    if (specialization !== null && specialization !== 'fde') {
      return jsonError(res, 400, 'bad_request', 'specialization must be fde or null');
    }
    // Validate every field the request actually carries. An answer the server
    // does not recognise is rejected rather than dropped: a learner who thinks
    // they answered should not silently be asked again.
    if (body.goals !== undefined) {
      if (!Array.isArray(body.goals) || body.goals.length === 0 || body.goals.length > MAX_LEARNER_GOALS
          || !body.goals.every(isLearnerGoal)) {
        return jsonError(res, 400, 'bad_request', `goals must be 1 to ${MAX_LEARNER_GOALS} known goals`);
      }
    }
    if (body.experience !== undefined && !isExperienceLevel(body.experience)) {
      return jsonError(res, 400, 'bad_request', 'experience must be one of the published levels');
    }
    if (body.studyTime !== undefined && !isStudyTime(body.studyTime)) {
      return jsonError(res, 400, 'bad_request', 'studyTime must be one of the published bands');
    }
    if (body.sections !== undefined
        && (!Array.isArray(body.sections) || body.sections.length > LEARN_SECTION_IDS.length
          || !body.sections.every(isLearnSectionId))) {
      return jsonError(res, 400, 'bad_request', 'sections must be known Learn sections');
    }

    // Read what the account already holds so a partial save — the Profile's
    // track toggle, which sends no profile answers — keeps the rest.
    // The token check above already returned the account (#587, server item
    // 23): a PUT never trusts an earlier acceptance (lib/auth.ts, "Reads
    // only"), so `auth.payload` is Supabase Auth's answer for this very
    // request, the same user record getUserById would fetch a moment later.
    // Only a payload without `user_metadata` (the local development fallback)
    // still asks the admin API.
    const verifiedMeta = verifiedUserMetadata(auth.payload);
    let existingMeta: Record<string, unknown>;
    if (verifiedMeta) {
      existingMeta = verifiedMeta;
    } else {
      const existingRead = await withTimeout(supabase.auth.admin.getUserById(auth.sub));
      // Without the saved answers a partial save would write empty goals,
      // experience and study time over them, so nothing is written.
      if (existingRead.error) {
        return jsonError(res, 503, 'db_error', 'Could not read the saved preference, so nothing was changed. Try again.');
      }
      existingMeta = (existingRead.data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    }
    const existing = parseLearnerProfile(existingMeta[LEARNER_PROFILE_META_KEY])
      ?? profileFromPreference(parseLearningPreference(existingMeta[LEARNING_PREFERENCE_META_KEY]));

    const profile = {
      schemaVersion: 2 as const,
      baseTrack: body.baseTrack,
      specialization,
      ...((body.sections ?? existing?.sections) ? { sections: Array.from(new Set(body.sections ?? existing?.sections)) } : {}),
      goals: body.goals ?? existing?.goals ?? [],
      experience: body.experience ?? existing?.experience ?? ('' as never),
      studyTime: body.studyTime ?? existing?.studyTime ?? ('' as never),
      updatedAt: new Date().toISOString(),
    };

    // One write, three derived records: the profile, the v1 preference and the
    // legacy field, so nothing that reads an older shape has to change.
    const { error } = await withTimeout(supabase.auth.admin.updateUserById(auth.sub, {
      user_metadata: {
        [LEARNER_PROFILE_META_KEY]: profile,
        [LEARNING_PREFERENCE_META_KEY]: { schemaVersion: 1, baseTrack: body.baseTrack, specialization },
        [LEGACY_TRACK_META_KEY]: body.baseTrack,
      },
    }));
    if (error) return jsonError(res, 500, 'db_error', 'Could not save the learning preference');
    logEvent({
      status: 200,
      kind: 'preference_saved',
      specialization: specialization ?? 'none',
      complete: missingProfileFields(profile).length === 0,
    });
    res.setHeader('Cache-Control', 'private, no-store');
    const saved: LearningPreferenceResponse = {
      preference: { schemaVersion: 1, baseTrack: body.baseTrack, specialization },
      legacyTrack: body.baseTrack,
      profile,
      missingProfileFields: missingProfileFields(profile),
    };
    return res.json(saved);
  }

  res.setHeader('Allow', 'GET, PUT');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/* ── enrollment ───────────────────────────────────────────────────────── */

/** GET/POST /api/user/[op]?op=learning-path-enrollment */
export async function handleEnrollment(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning-path storage is not configured');

  if (req.method === 'GET') {
    try {
      const rows = await loadEnrollments(supabase, userId);
      res.setHeader('Cache-Control', 'private, no-store');
      // A stored row of a retired path (dsa-foundations, E5 #496) stays in the
      // table but is not a path the client can open, so it is left out here
      // rather than cast to a LearningPathId.
      const body: EnrollmentListResponse = { enrollments: rows.filter((row) => isLearningPathId(row.path_id)).map(toEnrollment) };
      return res.json(body);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
      return jsonError(res, 500, 'db_error', 'Could not load enrollments');
    }
  }

  if (req.method === 'POST') {
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.learningPathEnroll, `user:${userId}`))) return;
    const body = (req.body || {}) as Partial<EnrollmentCreateRequest>;
    if (!isLearningPathId(body.pathId)) return jsonError(res, 400, 'bad_request', 'Unknown learning path');
    const path = pathById(body.pathId);
    if (!path) return jsonError(res, 404, 'not_found', 'Unknown learning path');
    if (body.curriculumVersion !== path.version) {
      return jsonError(res, 409, 'version_conflict', 'That curriculum version is not the published one');
    }
    const action = body.action ?? 'enroll';
    if (!['enroll', 'pause', 'resume'].includes(action)) {
      return jsonError(res, 400, 'bad_request', 'action must be enroll, pause or resume');
    }
    if (action === 'enroll' && availability(path) !== 'available') {
      return jsonError(res, 503, 'path_unavailable', 'That learning path is not open for enrollment yet');
    }
    // Enrollment is free; activity starts and submissions enforce the taster boundary.
    if (action !== 'pause' && await refuseLocked(res, userId, { kind: 'learning-path', pathId: path.id })) return;
    // A role specialization records the base track it sat above, for
    // recommendations only.
    const baseTrack = path.kind === 'role_specialization' && isBaseTrack(body.baseTrack) ? body.baseTrack : null;

    const upsert = () => withTimeout(supabase.rpc('upsert_learning_path_enrollment', {
      p_user_id: userId,
      p_enrollment_id: newId(),
      p_path_id: path.id,
      p_curriculum_version: path.version,
      p_base_track: baseTrack,
      p_action: action,
    }));
    let saved = await upsert();
    // Two enrolls at once (a double click, a second tab) both find no row and
    // both insert; the later one meets the (user, path, version) unique key.
    // The earlier one's row is the enrollment, so the call is made once more
    // and finds it, instead of answering 500 to a learner who is enrolled.
    if (saved.error?.code === '23505') saved = await upsert();
    if (saved.error) {
      if (migrationMissing(res, saved.error)) return;
      return jsonError(res, 500, 'db_error', 'Could not record the enrollment');
    }
    markStorageInstalled();
    const result = (saved.data ?? {}) as { found?: boolean; created?: boolean; enrollment?: EnrollmentRow };
    if (!result.found || !result.enrollment) return jsonError(res, 404, 'not_found', 'No enrollment to change');
    logEvent({ status: 200, kind: 'enrollment', path: path.id, action, created: result.created === true });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json({ enrollments: [toEnrollment(result.enrollment)] } satisfies EnrollmentListResponse);
  }

  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/* ── progress ─────────────────────────────────────────────────────────── */

/** GET /api/user/[op]?op=learning-path-progress&enrollmentId=… */
export async function handlePathProgress(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning-path storage is not configured');

  const enrollmentId = req.query.enrollmentId;
  if (typeof enrollmentId !== 'string' || !ID.test(enrollmentId)) {
    return jsonError(res, 400, 'bad_request', 'An enrollmentId is required');
  }
  try {
    const row = await loadEnrollment(supabase, userId, enrollmentId);
    // A record that exists but is not theirs answers the same as one that does
    // not exist, so the response never confirms another learner's enrollment.
    if (!row) return jsonError(res, 404, 'not_found', 'Unknown enrollment');
    const path = pathById(row.path_id);
    if (!path) return jsonError(res, 404, 'not_found', 'Unknown learning path');

    // Independent reads of an enrollment already proven to be the caller's.
    const [rows, evidence] = await Promise.all([
      loadProgressRows(supabase, enrollmentId),
      loadDiagnosticEvidence(supabase, userId, enrollmentId, path),
    ]);
    const manifest = publicManifest(path);
    const states = stateMap(rows);
    const competencies = diagnosticCompetencies(path, evidence);
    const enrollment = toEnrollment(row);
    const body: PathProgressResponse = {
      enrollment,
      modules: moduleProgressFor(path, rows),
      competencies,
      recommendedBridges: recommendedBridges(path, competencies, enrollment.baseTrackAtEnrollment),
      nextActivityId: computeNextActivity(manifest, states),
      guidedComplete: pathGuidedComplete(manifest, states),
      artifacts: artifactTally(manifest, states),
      dueActivityIds: [],
    };
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(body);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
    return jsonError(res, 500, 'db_error', 'Could not load learning-path progress');
  }
}

/* ── starting an activity ─────────────────────────────────────────────── */

/** POST /api/quiz/roadmap?resource=learning-path-start */
export async function handleActivityStart(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // Two tiers: an address backstop sized for a class behind one NAT, then the
  // learner's own bucket once the token says who they are.
  // The token is checked while the address bucket answers (lib/rate-limit.ts).
  if (!(await enforceAddressRateLimit(req, res, RATE_LIMITS.learningPathStartAddress))) return;
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.learningPathStart, `user:${userId}`))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning-path storage is not configured');

  const body = (req.body || {}) as Partial<StartActivityRequest>;
  if (typeof body.enrollmentId !== 'string' || !ID.test(body.enrollmentId)) {
    return jsonError(res, 400, 'bad_request', 'An enrollmentId is required');
  }
  if (typeof body.activityId !== 'string' || !/^[a-z0-9-]{3,96}$/.test(body.activityId)) {
    return jsonError(res, 400, 'bad_request', 'An activityId is required');
  }

  // The enrollment names the path, but every published activity id belongs
  // to one path, so a Premium activity's tier is asked beside the enrollment
  // read (#587, server item 21). The plan check below still runs on the path
  // the enrollment names, after ownership is proven; an id no path holds asks
  // nothing ahead.
  const requested = body.activityId;
  const named = LEARNING_PATHS.find((one) => activityIn(one, requested));
  if (named) void prefetchTier(userId, { kind: 'learning-path-activity', pathId: named.id, activityId: requested });
  let row: EnrollmentRow | null;
  try {
    row = await loadEnrollment(supabase, userId, body.enrollmentId);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
    return jsonError(res, 500, 'db_error', 'Could not load the enrollment');
  }
  if (!row) return jsonError(res, 404, 'not_found', 'Unknown enrollment');
  const path = pathById(row.path_id);
  if (!path) return jsonError(res, 404, 'not_found', 'Unknown learning path');
  if (availability(path) !== 'available') {
    return jsonError(res, 503, 'path_unavailable', 'That learning path is not open right now');
  }
  if (Number(row.curriculum_version) !== path.version) {
    return jsonError(res, 409, 'version_conflict', 'This enrollment follows an older curriculum version');
  }

  const found = activityIn(path, body.activityId);
  if (!found) return jsonError(res, 404, 'not_found', 'Unknown activity');
  const { module, activity } = found;
  // One read of the progress rows serves both the plan check's "already
  // passed" exception and the previous result the workspace shows.
  let progress: Promise<ProgressRow[]> | null = null;
  const progressRows = () => (progress ??= loadProgressRows(supabase, row.enrollment_id));
  if (await refuseLocked(res, userId, { kind: 'learning-path-activity', pathId: path.id, activityId: activity.id }, {
    cleared: async () => {
      const state = stateMap(await progressRows()).get(activity.id);
      return state === 'verified_pass' || state === 'self_reviewed';
    },
  })) return;

  if (body.previousSession !== undefined && (typeof body.previousSession !== 'string' || body.previousSession.length > 16_384)) {
    return jsonError(res, 400, 'bad_request', 'The previous session is invalid');
  }
  const previousAttempt = typeof body.previousSession === 'string' ? decodeLearningPathSession(body.previousSession) : null;
  const needsBriefReview = activity.kind === 'code' && body.previousSession !== undefined && (
    !previousAttempt || previousAttempt.userId !== userId || previousAttempt.enrollmentId !== row.enrollment_id || previousAttempt.activityId !== activity.id
    || previousAttempt.curriculumVersion !== path.version || previousAttempt.rubricVersion !== path.rubric.version
    || previousAttempt.version !== attemptSessions().pathCodeAttemptVersion(activity, path.rubric.version)
  );

  const attemptId = newId();
  // Purpose comes from the manifest, never from the request: it decides
  // whether a result can count as placement evidence or as core completion.
  // The attempt, the saved draft and the prior result are independent, so the
  // three round trips run together; the attempt's answer is still judged
  // first, and a payload failure is rethrown only once the attempt is open.
  const [opened, built, rows] = await Promise.all([
    withTimeout(supabase.rpc('open_learning_path_attempt', {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_enrollment_id: row.enrollment_id,
      p_activity_id: activity.id,
      p_purpose: activity.purpose,
      p_curriculum_version: path.version,
      p_rubric_version: path.rubric.version,
      p_ttl_minutes: 180,
    })),
    buildActivityPayload(path, activity, supabase, row.enrollment_id)
      .then((payload) => ({ payload }), (failure: unknown) => ({ failure })),
    // Prior state is context, not a precondition: a workspace still opens.
    progressRows().catch(() => null),
  ]);
  if (opened.error) {
    if (migrationMissing(res, opened.error)) return;
    return jsonError(res, 500, 'db_error', 'Could not start the activity');
  }
  const openedResult = (opened.data ?? {}) as { ok?: boolean; reason?: string; expiresAt?: string };
  if (!openedResult.ok) {
    if (openedResult.reason === 'paused') return jsonError(res, 409, 'enrollment_paused', 'Resume this path before starting an activity');
    return jsonError(res, 404, 'not_found', 'Unknown enrollment');
  }

  if ('failure' in built) throw built.failure;
  const { payload } = built;
  if ('error' in payload) return jsonError(res, payload.status, payload.code, payload.message);

  const session = attemptSessions().createLearningPathSession({
    attemptId,
    enrollmentId: row.enrollment_id,
    userId,
    pathId: path.id,
    activityId: activity.id,
    activityKind: activity.kind,
    purpose: activity.purpose,
    curriculumVersion: path.version,
    rubricVersion: path.rubric.version,
    ...(payload.answerKey ? { answerKey: payload.answerKey } : {}),
  });

  const recorded = rows?.find((one) => one.module_id === module.id)?.activity_states?.[activity.id];
  const previous: StartActivityResponse['previous'] = recorded
    ? {
        state: (recorded.state as EvidenceState) ?? 'not_started',
        score: typeof recorded.score === 'number' ? recorded.score : null,
        attempts: Number(recorded.attempts ?? 0),
      }
    : null;

  res.setHeader('Cache-Control', 'private, no-store');
  const out: StartActivityResponse = {
    attemptId,
    ...(needsBriefReview ? { needsBriefReview: true } : {}),
    session: session.token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    activity: activitySummary(activity),
    purpose: activity.purpose,
    ...(payload.lesson ? { lesson: payload.lesson } : {}),
    ...(payload.check ? { check: payload.check } : {}),
    ...(payload.code ? { code: payload.code } : {}),
    ...(payload.artifact ? { artifact: payload.artifact } : {}),
    draft: payload.draft,
    ...(payload.draftUnavailable ? { draftUnavailable: true } : {}),
    previous,
  };
  logEvent({ status: 200, kind: 'start', path: path.id, activityKind: activity.kind, purpose: activity.purpose });
  return res.json(out);
}

type ActivityPayload =
  | { error: true; status: number; code: string; message: string }
  | {
      answerKey?: number[];
      lesson?: StartActivityResponse['lesson'];
      check?: StartActivityResponse['check'];
      code?: StartActivityResponse['code'];
      artifact?: StartActivityResponse['artifact'];
      draft: PathDraft | null;
      /** The draft read failed, so `draft: null` does not mean "no draft". */
      draftUnavailable?: boolean;
    };

/** Postgres JSONB and text refuse U+0000 (22P05), which would answer 500:
 * a draft or artifact holding the character is refused first. The values are
 * walked, not the JSON, so code that spells the escape out as text passes. */
function holdsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 4 || value === null || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((one) => holdsNul(one, depth + 1));
}
const NUL_MESSAGE = 'Text cannot contain a NUL (U+0000) character';

/** Builds the learner-facing payload. Options are shuffled per attempt and the
 * correct index is returned separately, for the sealed session only. */
async function buildActivityPayload(
  path: MergedPath,
  activity: MergedActivity,
  supabase: SupabaseClient,
  enrollmentId: string,
): Promise<ActivityPayload> {
  let draft: PathDraft | null = null;
  let draftUnavailable = false;
  if (activity.kind === 'code' || activity.kind === 'artifact') {
    const { data, error } = await withTimeout(
      supabase.from('learning_path_drafts').select('activity_id,revision,content,updated_at')
        .eq('enrollment_id', enrollmentId).eq('activity_id', activity.id).maybeSingle(),
    );
    // The activity still opens, from its starter; the log line (with the
    // request id) is how a draft that seems lost gets traced.
    if (error) {
      draftUnavailable = true;
      logEvent({ kind: 'draft_read_failed', activityKind: activity.kind, code: (error as { code?: string }).code ?? null });
    }
    if (data) {
      draft = {
        activityId: activity.id,
        revision: Number(data.revision ?? 1),
        content: (data.content ?? {}) as PathDraft['content'],
        updatedAt: data.updated_at as string,
      };
    }
  }

  switch (activity.kind) {
    case 'lesson': {
      const lesson = activity.lessonId
        ? path.modules.flatMap((one) => one.lessons).find((one) => one.id === activity.lessonId)
        : undefined;
      if (!lesson) return { error: true, status: 404, code: 'not_found', message: 'Unknown lesson' };
      return {
        lesson: { id: lesson.id, title: lesson.title, sections: lesson.sections, sources: lesson.sources },
        draft: null,
      };
    }
    case 'check': {
      const answerKey: number[] = [];
      const questions = (activity.questions ?? []).map((question) => {
        const { shuffled, order } = shuffleWithOrder(question.options, secureShuffle);
        answerKey.push(order.indexOf(question.correct));
        return {
          id: question.id,
          prompt: question.prompt,
          ...(question.context ? { context: question.context } : {}),
          options: shuffled,
          ...(question.domain ? { domain: question.domain } : {}),
          competencies: question.competencies,
        };
      });
      // The share each domain needs on its own. The screen states one figure,
      // so a check that mixed small and large domains would state the lowest.
      const perDomain = Object.values(domainThresholds(activity));
      return {
        answerKey,
        check: {
          questions,
          passThreshold: activity.passThreshold ?? 0.8,
          ...(perDomain.length ? { domainThreshold: Math.min(...perDomain) } : {}),
        },
        draft: null,
      };
    }
    case 'code': {
      const code = activity.code ?? reusedCode(activity);
      if (!code) return { error: true, status: 404, code: 'not_found', message: 'Unknown task' };
      return {
        code: {
          language: code.language,
          complexityGuidance: complexityGuidance({ track: code.language, prompt: code.prompt, tests: code.tests }),
          prompt: code.prompt,
          starter: code.starter,
          ...(code.skeleton ? { skeleton: code.skeleton } : {}),
          hints: code.hints,
          ...(code.approach ? { approach: code.approach } : {}),
          ...(code.contract ? { contract: code.contract } : {}),
          ...(code.tests.length ? { tests: code.tests.map(({ criterion: _criterion, ...test }) => test) } : {}),
          ...(code.typeTests.length ? { typeTests: code.typeTests } : {}),
          ...(code.suite ? { suite: code.suite } : {}),
        },
        draft,
        ...(draftUnavailable ? { draftUnavailable: true } : {}),
      };
    }
    case 'artifact': {
      if (!activity.artifact) return { error: true, status: 404, code: 'not_found', message: 'Unknown artifact' };
      return {
        artifact: {
          brief: activity.artifact.brief,
          fields: activity.artifact.fields,
          rubricDimensions: activity.artifact.rubricDimensions,
        },
        draft,
        ...(draftUnavailable ? { draftUnavailable: true } : {}),
      };
    }
  }
}

/** A code activity that reuses an ordinary coding task. Reaching it here needs
 * the enrollment, not the ordinary tier ladder, and the grade it produces is
 * path evidence only. */
function reusedCode(activity: MergedActivity) {
  if (!activity.reuseTaskId) return null;
  const task = codingCatalogue().codingTaskById(activity.reuseTaskId);
  return task ? codeFromReusedTask(task) : null;
}

/** The grader could not take this submission: nothing was graded or recorded.
 * 429 when the learner already has submissions grading, 503 when the
 * instance's grader threads could not take it; both carry a Retry-After. */
function graderBusy(res: VercelResponse, status: 429 | 503, error: GraderBusyError) {
  logEvent({ status, kind: 'submit_unrecorded', reason: error.reason });
  res.setHeader('Retry-After', String(error.retryAfterSeconds));
  return jsonError(res, status, 'grader_busy', error.message);
}

/* ── submitting ───────────────────────────────────────────────────────── */

/**
 * The state a result leaves on record, folded the way
 * `accept_learning_path_result` (migration 054) folds it: a verified pass is
 * never demoted, and a submitted write-up (`self_reviewed`) is replaced only
 * by a verified pass. The weaker attempt is still stored as evidence.
 */
export function recordedState(prior: EvidenceState | undefined, next: EvidenceState): EvidenceState {
  if (prior === 'verified_pass' && next !== 'verified_pass') return 'verified_pass';
  if (prior === 'self_reviewed' && (next === 'needs_revision' || next === 'in_progress')) return 'self_reviewed';
  return next;
}

/** A module's completion requirements in the shape
 * `accept_learning_path_result` takes: each required activity with every
 * state that satisfies it (`SATISFYING_STATES`, the rule `moduleComplete`
 * applies). An off-loop module (optional or on a shelf) sends none and never
 * completes.
 *
 * Quota modules send these AND requirements alongside their separate quota;
 * migration 066 evaluates both from the states written under its lock. */
export function moduleRequirements(module: MergedPath['modules'][number]): { activityId: string; states: readonly EvidenceState[] }[] {
  if (isOffLoopModule(module)) return [];
  return module.requires.map((requirement) => ({
    activityId: requirement.activityId,
    states: SATISFYING_STATES[requirement.state],
  }));
}

/** POST /api/quiz/roadmap?resource=learning-path-submit */
/** A result accepted before devShark became English only (#485) stored each
 * learner-visible string as an `{ en, cs }` pair, and the client now renders
 * plain strings. A replay hands such a pair back as its English string, so an
 * old attempt reads like a new one. Copy fields only: test outcomes are data. */
function englishReplay(result: SubmitActivityResponse): SubmitActivityResponse {
  const copy = <T>(value: T): T | string =>
    value && typeof value === 'object' && typeof (value as { en?: unknown }).en === 'string'
      ? (value as unknown as { en: string }).en
      : value;
  return {
    ...result,
    ...(Array.isArray(result.criteria)
      ? { criteria: result.criteria.map((criterion) => ({ ...criterion, label: copy(criterion.label), detail: copy(criterion.detail) })) }
      : {}),
    ...(Array.isArray(result.questions)
      ? { questions: result.questions.map((question) => (question.explanation === undefined ? question : { ...question, explanation: copy(question.explanation) })) }
      : {}),
    ...(Array.isArray(result.feedback) ? { feedback: result.feedback.map(copy) } : {}),
  };
}

export async function handleActivitySubmit(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // The token is checked while the address bucket answers (lib/rate-limit.ts).
  if (!(await enforceAddressRateLimit(req, res, RATE_LIMITS.learningPathSubmitAddress))) return;
  const userId = await requireAuthSub(req, res);
  if (!userId) return;

  const body = (req.body || {}) as Partial<SubmitActivityRequest>;
  if (typeof body.session !== 'string' || body.session.length > 16_384) {
    return jsonError(res, 400, 'invalid_session', 'The activity session is missing');
  }
  const session = decodeLearningPathSession(body.session);
  if (!session) return jsonError(res, 410, 'session_expired', 'This attempt expired or is no longer valid. Start it again.');
  // Token binding: a session minted for another account is not this caller's.
  if (session.userId !== userId) return jsonError(res, 403, 'forbidden', 'This attempt belongs to another account');
  // Per activity, beneath a ceiling per account, as a coding Submit is per
  // task (owner decision, 9 October 2026).
  if (!(await enforcePerItemRateLimit(req, res, RATE_LIMITS.learningPathSubmit, RATE_LIMITS.learningPathSubmitCeiling,
    gradingItem.activity(session.pathId, session.activityId)))) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning-path storage is not configured');
  if (typeof body.idempotencyKey !== 'string' || !PATH_LIMITS.idempotencyKeyPattern.test(body.idempotencyKey)) {
    return jsonError(res, 400, 'bad_request', 'An idempotencyKey is required');
  }

  const path = pathById(session.pathId);
  if (!path) return jsonError(res, 404, 'not_found', 'Unknown learning path');
  // A session outlives the switch that opened it and the enrollment state it
  // was opened under, so both are checked again before anything is graded.
  if (availability(path) !== 'available') {
    return jsonError(res, 503, 'path_unavailable', 'That learning path is not open right now');
  }
  // The plan check of a Premium activity needs the caller's tier, which does
  // not depend on the enrollment: it is asked beside the enrollment read
  // (#587, server item 20) and remembered for the request, so refuseLocked
  // below reads the same answer. It is the caller's own plan, and it is used
  // only once the enrollment is proven to be theirs.
  void prefetchTier(userId, { kind: 'learning-path-activity', pathId: path.id, activityId: session.activityId });
  // One read of the progress rows serves the plan check's "already passed"
  // exception and the completion projection below. Outside a code activity
  // (whose rows are read while the grader runs) it is issued beside the
  // enrollment read, scoped to the caller's own rows, instead of after it
  // (#587, server item 20): a lesson, check or artifact submit then goes from
  // the enrollment straight to its accept call. The rows are used only once
  // the enrollment is proven the caller's; a submit refused before that has
  // spent the read. A failure is answered where the rows are awaited.
  let progress: Promise<ProgressRow[]> | null = null;
  const progressRows = () => (progress ??= loadProgressRows(supabase, session.enrollmentId, userId));
  if (session.activityKind !== 'code') progressRows().catch(() => {});
  let enrollmentRow: EnrollmentRow | null;
  try {
    enrollmentRow = await loadEnrollment(supabase, userId, session.enrollmentId);
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
    return jsonError(res, 500, 'db_error', 'Could not load the enrollment');
  }
  if (!enrollmentRow) return jsonError(res, 404, 'not_found', 'Unknown enrollment');
  if (enrollmentRow.status === 'paused') {
    return jsonError(res, 409, 'enrollment_paused', 'Resume this path before submitting work');
  }
  if (session.curriculumVersion !== path.version) {
    return jsonError(res, 409, 'version_conflict', 'The curriculum changed while this attempt was open. Start it again.');
  }
  const found = activityIn(path, session.activityId);
  if (!found) return jsonError(res, 404, 'not_found', 'Unknown activity');
  const { module, activity } = found;
  if (await refuseLocked(res, userId, { kind: 'learning-path-activity', pathId: path.id, activityId: activity.id }, {
    cleared: async () => {
      const state = stateMap(await progressRows()).get(activity.id);
      return state === 'verified_pass' || state === 'self_reviewed';
    },
  })) return;

  if (activity.kind !== session.activityKind || activity.purpose !== session.purpose) {
    return jsonError(res, 409, 'session_mismatch', 'This attempt no longer matches the activity');
  }

  if (activity.kind === 'code' && session.version !== attemptSessions().pathCodeAttemptVersion(activity, path.rubric.version)) {
    // A response lost after an accepted write is still the recorded result,
    // even when the catalogue changed before its network retry. Read only the
    // bound attempt; never regrade it or pay its reward again.
    const saved = await withTimeout(supabase.from('learning_path_attempts')
      .select('user_id,enrollment_id,activity_id,state,idempotency_key,request_hash,accepted_result')
      .eq('attempt_id', session.attemptId).eq('user_id', userId).maybeSingle());
    if (saved.error) return jsonError(res, 503, 'progress_unavailable', 'Could not check the recorded attempt. Try again.');
    const row = saved.data;
    if (row?.state === 'accepted' && row.user_id === userId && row.enrollment_id === session.enrollmentId && row.activity_id === activity.id) {
      const hash = requestHash({ answers: body.answers ?? null, code: body.code ?? null, artifact: null, acknowledged: body.acknowledged ?? null });
      if (row.idempotency_key !== body.idempotencyKey || row.request_hash !== hash) {
        return jsonError(res, 409, 'idempotency_conflict', 'That attempt was already checked with different work.');
      }
      if (row.accepted_result && typeof row.accepted_result === 'object') {
        res.setHeader('Cache-Control', 'private, no-store');
        return res.json({ ...englishReplay(row.accepted_result as SubmitActivityResponse), replayed: true });
      }
    }
    return jsonError(res, 409, 'task_changed', 'This activity changed while you were working. Load its latest brief before submitting. Your code has been kept.');
  }
  if (session.rubricVersion !== path.rubric.version) {
    return jsonError(res, 409, 'version_conflict', 'The activity criteria changed while this attempt was open. Start it again.');
  }

  let state: EvidenceState = 'in_progress';
  let score: number | null = null;
  let domainScores: Record<string, number> | null = null;
  let diagnosticCounts: Record<string, number> | null = null;
  let failedDomains: string[] = [];
  let criteria: SubmitActivityResponse['criteria'] = [];
  let questions: SubmitActivityResponse['questions'] = null;
  let code: SubmitActivityResponse['code'] = null;
  let complexity: ComplexityReport | null = null;
  /** Set for a graded code submission: what the coding ledger records. */
  let coding: { track: string; codeHash: string } | null = null;
  let feedback: SubmitActivityResponse['feedback'] = [];
  let artifact: Record<string, string | string[]> | null = null;

  switch (activity.kind) {
    case 'lesson': {
      if (body.acknowledged !== true) return jsonError(res, 400, 'bad_request', 'acknowledged must be true');
      state = 'self_reviewed';
      feedback = [module.requires.some((one) => one.activityId === activity.id)
        ? 'Marked as read. This module requires its lesson acknowledgements as self-reviewed evidence, alongside its verified case passes.'
        : 'Marked as read. Reading is recorded for your own overview; it is not a verified check and does not gate this module.'];
      break;
    }
    case 'check': {
      const answers = body.answers;
      const expected = activity.questions?.length ?? 0;
      if (!Array.isArray(answers) || answers.length !== expected ||
          !answers.every((one) => Number.isInteger(one) && one >= 0 && one <= 25)) {
        return jsonError(res, 400, 'bad_request', `answers must hold ${expected} option indexes`);
      }
      const graded = gradeCheck(activity, session.answerKey, answers);
      state = graded.state;
      score = graded.score;
      domainScores = graded.domainScores;
      failedDomains = graded.failedDomains;
      questions = graded.verdicts;
      if (activity.id === path.diagnosticActivityId && activity.purpose === 'diagnostic') {
        diagnosticCounts = diagnosticEvidence(activity, graded.verdicts);
      }
      if (graded.failedDomains.length > 0) {
        feedback = ['Every area has to reach its own minimum as well as the overall score, so a strong area cannot cover an empty one. Revisit the areas listed above and try the check again.'];
      }
      if (graded.keyWithheld) {
        // A retry deals the same questions, so the key waits for a pass.
        feedback.push('This check counts toward finishing the path, so the correct answers and their explanations appear once you pass it. The questions marked wrong show what to revisit before you try again.');
      } else if (graded.failedDomains.length === 0 && state !== 'verified_pass') {
        feedback = ['Read the explanation under each miss before retrying — every question says why the other options fail here, not only why the right one works.'];
      }
      break;
    }
    case 'code': {
      if (typeof body.code !== 'string' || body.code.length === 0) {
        return jsonError(res, 400, 'bad_request', 'code is required');
      }
      if (pathCodeTooLarge(body.code)) return jsonError(res, 413, 'too_large', 'Code is limited to 20 kB');
      const merged = activity.code ?? reusedCode(activity);
      if (!merged) return jsonError(res, 404, 'not_found', 'Unknown task');
      // The coding section's grader threads, under the same limits
      // (lib/coding/grader-capacity.ts): a busy grader is a retry, never a
      // recorded result.
      const done = enterInFlight(req, 'grading', { item: gradingItem.activity(path.id, activity.id), perItem: GRADING_PER_TASK, perCaller: GRADING_PER_CALLER }, `user:${userId}`);
      if (!done) return graderBusy(res, 429, new GraderBusyError('caller_in_flight'));
      // The progress rows feed only the projection after grading and do not
      // depend on it, so they are read while the grader runs (#587, server
      // item 20). They are read before the accept call either way, and the
      // routine decides completion again under its lock (see below). A
      // failure is answered where the rows are awaited.
      progressRows().catch(() => {});
      let graded;
      try {
        graded = await gradePathCode(activity, merged, body.code);
      } catch (error) {
        if (!(error instanceof GraderBusyError)) throw error;
        return graderBusy(res, 503, error);
      } finally {
        done();
      }
      // Infrastructure failure is retryable, never a recorded learner failure.
      if (graded.code.outcome === 'error' && graded.state === 'in_progress') {
        return jsonError(res, 503, 'runner_unavailable', graded.code.codeError ?? 'The runner could not start. Try again in a moment.');
      }
      state = graded.state;
      score = graded.score;
      criteria = graded.criteria;
      code = graded.code;
      // A verified pass settles the milestones after the accept call, for a
      // Premium account only; its tier is read meanwhile.
      if (state === 'verified_pass') resolveTier(userId).catch(() => {});
      // A reused task resolved above (merged is non-null), so its lookup holds.
      const task = activity.reuseTaskId ? codingCatalogue().codingTaskById(activity.reuseTaskId) : undefined;
      complexity = assessComplexity(task ?? { track: merged.language, prompt: merged.prompt, tests: merged.tests }, body.code);
      coding = {
        track: task?.track ?? merged.language,
        codeHash: createHash('sha256').update(body.code).digest('hex'),
      };
      feedback = codeFeedback(graded);
      break;
    }
    case 'artifact': {
      const submitted = body.artifact;
      if (submitted !== undefined && (typeof submitted !== 'object' || submitted === null || Array.isArray(submitted))) {
        return jsonError(res, 400, 'bad_request', 'artifact must be an object of field values');
      }
      if (submitted && Buffer.byteLength(JSON.stringify(submitted), 'utf8') > PATH_LIMITS.payloadBytes) {
        return jsonError(res, 413, 'too_large', 'The submission is limited to 64 kB');
      }
      if (submitted && holdsNul(submitted)) return jsonError(res, 400, 'bad_request', NUL_MESSAGE);
      const graded = gradeArtifact(activity, submitted as Record<string, string | string[]> | undefined);
      state = graded.state;
      criteria = graded.criteria;
      feedback = graded.feedback;
      artifact = graded.cleaned;
      break;
    }
  }

  // Module completion is decided from the manifest plus the states already on
  // record, with this result folded in — the client never asserts it.
  let rows: ProgressRow[] = [];
  try {
    rows = await progressRows();
  } catch (error) {
    if (error instanceof ServiceUnavailableError) throw error;
    if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
    return jsonError(res, 500, 'db_error', 'Could not load learning-path progress');
  }
  // A verified pass or a submitted write-up is never demoted by a later weaker
  // attempt. The RPC applies the same rule, so this projection matches what
  // the write is about to store.
  const states = stateMap(rows);
  const effectiveState = recordedState(states.get(activity.id), state);
  states.set(activity.id, effectiveState);
  const moduleWillComplete = !isOffLoopModule(module) && moduleComplete(module, states);

  const manifest = publicManifest(path);
  const projected = projectModuleProgress(module, rows, activity, effectiveState, score, domainScores);

  // The whole response is stored with the accepted result, so replaying the
  // same key returns exactly what the learner saw the first time rather than a
  // second grading that could disagree with it.
  const out: SubmitActivityResponse = {
    activityId: activity.id,
    state,
    verification: activity.verification,
    score,
    ...(domainScores ? { domainScores } : {}),
    ...(failedDomains.length ? { failedDomains } : {}),
    criteria,
    questions,
    code,
    feedback,
    module: projected,
    guidedComplete: pathGuidedComplete(manifest, states),
    nextActivityId: computeNextActivity(manifest, states),
    replayed: false,
    xpAwarded: 0,
    ...(complexity ? { complexity } : {}),
  };

  const acceptParams = {
    p_user_id: userId,
    p_attempt_id: session.attemptId,
    p_idempotency_key: body.idempotencyKey,
    p_request_hash: requestHash({
      answers: body.answers ?? null,
      code: body.code ?? null,
      artifact: artifact ?? null,
      acknowledged: body.acknowledged ?? null,
    }),
    p_module_id: module.id,
    p_state: state,
    p_verification_kind: activity.verification,
    p_score: score,
    p_domain_scores: diagnosticCounts ? { ...domainScores, ...diagnosticCounts } : domainScores,
    p_criteria: criteria.map((criterion) => ({ id: criterion.id, critical: criterion.critical, passed: criterion.passed })),
    p_artifact: artifact,
    p_module_complete: moduleWillComplete,
    p_result: out,
  };
  // moduleWillComplete comes from progress read before this call, so two
  // submits finishing a module's last activities at once would each miss the
  // other. With the requirements, the routine (migration 054) decides
  // completion again from the states it writes, one result at a time. Before
  // 054 is installed it does not take them, and the call is made without.
  // The DSA exercises E2 turned into coding tasks record under the task's id,
  // so a path pass and a Coding pass share one record and one award (#493).
  const canonicalTaskId = canonicalCodingTaskId(path.id, activity);
  const packet = { ...acceptParams, p_module_requires: moduleRequirements(module) };
  const codingParams = coding ? {
    p_task_id: canonicalTaskId, p_track: coding.track,
    p_xp: state === 'verified_pass' ? codingPassXp(complexity) : 0,
    p_code_hash: coding.codeHash,
  } : {};
  let accepted = module.requiresAtLeast
    ? await withTimeout(supabase.rpc('accept_learning_path_quota_result', {
      p_accept: packet,
      p_module_quota: { ...module.requiresAtLeast, states: SATISFYING_STATES[module.requiresAtLeast.state] },
      ...codingParams,
    }))
    : activity.kind === 'code'
      ? await withTimeout(supabase.rpc('accept_learning_path_coding_result', { p_accept: packet, ...codingParams }))
      : await withTimeout(supabase.rpc('accept_learning_path_result', packet));
  // An older AND-only routine cannot preserve an any-N quota. Refuse with
  // migration_required rather than silently accepting incomplete progress.
  if (!module.requiresAtLeast && activity.kind !== 'code' && accepted.error && isRpcMissing(accepted.error)) {
    accepted = await withTimeout(supabase.rpc('accept_learning_path_result', acceptParams));
  }
  if (accepted.error) {
    if (migrationMissing(res, accepted.error)) return;
    return jsonError(res, 500, 'db_error', 'Could not record the result');
  }
  markStorageInstalled();
  const outcome = (accepted.data ?? {}) as { ok?: boolean; reason?: string; replayed?: boolean; result?: unknown; coding?: { xpKind?: string } };
  if (!outcome.ok) {
    if (outcome.reason === 'expired') return jsonError(res, 410, 'attempt_expired', 'This attempt expired. Start it again.');
    if (outcome.reason === 'conflict') {
      return jsonError(res, 409, 'idempotency_conflict', 'That submission key was already used with different work');
    }
    return jsonError(res, 404, 'not_found', 'Unknown attempt');
  }

  res.setHeader('Cache-Control', 'private, no-store');
  logEvent({
    status: 200, kind: 'submit', path: path.id, activityKind: activity.kind,
    state, replayed: outcome.replayed === true,
  });
  const stored = englishReplay((outcome.result ?? out) as SubmitActivityResponse);
  // The XP coin credit and the milestone settlement are independent one-time
  // routines (distinct event ids; only the credit takes the account's XP
  // lock, the settlement never does), so they run together (#587, server
  // item 20), as the wallet read already runs its settlements.
  const rewards: Promise<unknown>[] = [];
  if (activity.kind === 'code' && stored.xpAwarded > 0 && outcome.coding?.xpKind !== 'repeat') {
    rewards.push(creditVerifiedXp(supabase, { userId, awardId: codingAwardId(userId,canonicalTaskId), subject: 'webdev', xp: stored.xpAwarded }));
  }
  // A verified pass may reach a milestone. Only a Premium account can be
  // credited one, so a free account skips the routine (#587, server item 8).
  if (activity.kind === 'code' && stored.state === 'verified_pass') {
    rewards.push(settleMilestonesAfterPass(supabase, userId, 'webdev', async () => (await resolveTier(userId)) === 'premium'));
  }
  // Both are awaited before the answer, as they were one after the other.
  const failed = (await Promise.allSettled(rewards)).find((one): one is PromiseRejectedResult => one.status === 'rejected');
  if (failed) throw failed.reason;
  return res.json({ ...stored, replayed: outcome.replayed === true });
}

/**
 * What the module projection will hold once this result is written.
 *
 * Computed rather than re-read, so the response the learner sees and the
 * response stored for a replay are the same object. The arithmetic mirrors
 * `accept_learning_path_result`: attempts increment, the best score is kept,
 * and a verified pass or a submitted write-up is never demoted (`state` is
 * what `recordedState` folded).
 */
function projectModuleProgress(
  module: MergedPath['modules'][number],
  rows: ProgressRow[],
  activity: MergedActivity,
  state: EvidenceState,
  score: number | null,
  domainScores: Record<string, number> | null,
): ModuleProgress {
  const row = rows.find((one) => one.module_id === module.id);
  const recorded = row?.activity_states ?? {};
  const now = new Date().toISOString();
  const states = stateMap(rows);
  states.set(activity.id, state);
  const completed = !isOffLoopModule(module) && moduleComplete(module, states);
  return {
    moduleId: module.id,
    completed,
    completedAt: row?.completed_at ?? (completed ? now : null),
    activities: module.activities.map((one) => {
      const value = recorded[one.id];
      if (one.id !== activity.id) return activityProgress(one, value);
      const bestScore = Math.max(typeof value?.score === 'number' ? value.score : 0, score ?? 0);
      return {
        activityId: one.id,
        state,
        verification: activity.verification,
        score: score === null && typeof value?.score !== 'number' ? null : bestScore,
        ...(domainScores ? { domainScores } : {}),
        attempts: Number(value?.attempts ?? 0) + 1,
        updatedAt: now,
      };
    }),
  };
}

/* ── drafts ───────────────────────────────────────────────────────────── */

/** GET/PUT /api/user/[op]?op=learning-path-draft */
/* ── GET/POST ?op=learning-path-reward ─────────────────────────────────── */

/** What to correct, for each field `validateAddress` refuses. Every field
 * holds what `merch_orders` holds (migration 028). */
const REWARD_ADDRESS_ERRORS: Record<string, string> = {
  name: `Enter the name to post the package to, up to ${MAX_ADDRESS_FIELD} characters`,
  line1: `Enter the street address, up to ${MAX_ADDRESS_FIELD} characters`,
  line2: `The second address line holds up to ${MAX_ADDRESS_FIELD} characters`,
  city: `Enter the town or city, up to ${MAX_ADDRESS_FIELD} characters`,
  postalCode: `Enter the postcode, up to ${MAX_ADDRESS_FIELD} characters`,
  country: 'Enter the country as its two-letter ISO code, such as CZ or DE',
};

/**
 * The merchandise package a finished learning path earns: a t-shirt, a mug and
 * a sticker set.
 *
 * Completion is the server's own reading of the progress rows the graders
 * wrote — `path_is_complete` counts the completed modules of the enrollment
 * in the curriculum version this deployment ships against that version's
 * module count — so a client cannot claim a package for a path it did not
 * finish. The claim is keyed by (learner, path), which is what makes it
 * one-time: completing twice, or two devices reporting the same completion,
 * grants once and the second call reports the first order.
 *
 * A reward *for* learning is not a purchase that affects learning. Nothing here
 * touches XP, scores, streaks, ranks or access; the only thing that changes is
 * that somebody is owed a parcel.
 *
 * The address is part of the claim rather than a later step because
 * `merch_orders` requires one, and a placeholder would put a fake address in
 * the table the owner ships from. And the package is an order, not a parcel:
 * merchandise is still unconfigured — no supplier, no stock, no postage — so
 * what a claim produces is something waiting for the owner to fulfil.
 *
 * Paused until next quarter with the rest of merchandise (owner decision 10,
 * `MERCH_ENABLED` in shared/rewards.ts): reading and claiming both answer 404
 * `merch_unavailable`, as a shop order does, and nothing reaches the database.
 * `merchOn` is the switch, a parameter only so the contracts can drive the
 * code that comes back with it.
 */
export async function handlePathReward(
  req: VercelRequest,
  res: VercelResponse,
  supabase: SupabaseClient | null,
  merchOn: boolean = MERCH_ENABLED,
) {
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!merchOn) return jsonError(res, 404, 'merch_unavailable', 'Merchandise is not available yet');
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');
  if (!deploymentSubjectIds().includes('webdev')) {
    return jsonError(res, 404, 'not_available', 'Learning paths are not part of this product');
  }
  res.setHeader('Cache-Control', 'private, no-store');

  const pathId = typeof req.query.pathId === 'string' ? req.query.pathId : String((req.body as { pathId?: unknown })?.pathId ?? '');
  if (!isLearningPathId(pathId)) return jsonError(res, 400, 'bad_request', 'Unknown path');
  const inventory = inventoryFor(pathId);
  const path = pathById(pathId);
  if (!inventory || !path) return jsonError(res, 404, 'not_found', 'Unknown path');

  const missing = (error: { message?: string } | null) =>
    /does not exist|schema cache/i.test(error?.message ?? '');

  // Every module finished within the enrollment of the curriculum version this
  // deployment publishes, which `path_is_complete` checks from migration 054.
  // A database without 054 has neither routine's version parameter, so the
  // call is made again without it (one enrollment of any version).
  const atVersion = async (name: 'path_is_complete' | 'claim_path_reward', params: Record<string, unknown>) => {
    const first = await withTimeout(supabase.rpc(name, { ...params, p_curriculum_version: path.version }));
    if (!first.error || !isRpcMissing(first.error)) return first;
    return withTimeout(supabase.rpc(name, params));
  };

  if (req.method === 'GET') {
    const [claim, complete] = await Promise.all([
      withTimeout(supabase.from('path_reward_claims').select('order_id,claimed_at').eq('user_id', userId).eq('path_id', pathId).maybeSingle()),
      atVersion('path_is_complete', { p_user_id: userId, p_path_id: pathId, p_modules: inventory.modules }),
    ]);
    if (missing(claim.error) || missing(complete.error)) {
      return jsonError(res, 503, 'migration_required', 'Run supabase/supabase-schema-035.sql to enable path rewards');
    }
    if (claim.error || complete.error) return jsonError(res, 500, 'db_error', 'Could not read the reward state');
    return res.json({
      eligible: complete.data === true,
      claimed: Boolean(claim.data),
      orderId: claim.data?.order_id ?? null,
      modules: inventory.modules,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }

  const body = (req.body || {}) as Record<string, unknown>;
  // Checked here, the same way a shop order is, and refused rather than cut to
  // fit: a truncated street or a made-up country is a parcel that goes nowhere.
  const shirt = typeof body.shirt === 'string' ? body.shirt.trim().toUpperCase() : '';
  if (!(SHIRT_SIZES as readonly string[]).includes(shirt)) return jsonError(res, 400, 'bad_request', 'Pick a shirt size');
  const checked = validateAddress({
    name: body.name, line1: body.line1, line2: body.line2, city: body.city, postalCode: body.postal, country: body.country,
  });
  if (!checked.ok) return jsonError(res, 400, 'invalid_address', REWARD_ADDRESS_ERRORS[checked.field] ?? REWARD_ADDRESS_ERRORS.name);
  const address = checked.address;

  const claimed = await atVersion('claim_path_reward', {
    p_user_id: userId,
    p_path_id: pathId,
    p_modules: inventory.modules,
    p_shirt: shirt,
    p_name: address.name,
    p_line1: address.line1,
    p_line2: address.line2 ?? null,
    p_city: address.city,
    p_postal: address.postalCode,
    p_country: address.country,
  });
  if (claimed.error) {
    if (missing(claimed.error)) {
      return jsonError(res, 503, 'migration_required', 'Run supabase/supabase-schema-035.sql to enable path rewards');
    }
    if (/path_not_complete/i.test(claimed.error.message ?? '')) {
      return jsonError(res, 409, 'not_complete', 'Finish every module of the path first');
    }
    if (/invalid_address/i.test(claimed.error.message ?? '')) {
      return jsonError(res, 400, 'invalid_address', 'A name, street, town, postcode and two-letter country are all required');
    }
    if (/invalid_variant/i.test(claimed.error.message ?? '')) {
      return jsonError(res, 400, 'bad_request', 'Pick a shirt size');
    }
    // An address field the table refuses (check_violation).
    if (claimed.error.code === '23514') {
      return jsonError(res, 400, 'invalid_address', 'A name, street, town, postcode and two-letter country are all required');
    }
    // A second claim that raced the first one to the claim row
    // (unique_violation): the first one won, so this is the "already" answer.
    if (claimed.error.code === '23505') {
      const first = await withTimeout(
        supabase.from('path_reward_claims').select('order_id').eq('user_id', userId).eq('path_id', pathId).maybeSingle(),
      );
      logEvent({ status: 200, kind: 'path_reward_claimed', granted: false, raced: true });
      return res.json({ granted: false, already: true, orderId: first.data?.order_id ?? null });
    }
    return jsonError(res, 500, 'db_error', 'Could not claim the package');
  }
  const row = Array.isArray(claimed.data) ? claimed.data[0] : claimed.data;
  logEvent({ status: 200, kind: 'path_reward_claimed', granted: row?.granted === true });
  return res.json({
    granted: row?.granted === true,
    already: row?.already === true,
    orderId: row?.reward_order_id ?? null,
  });
}

export async function handlePathDraft(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!pathsAvailable()) return notAvailable(res);
  // An autosave fires while the learner types, so a save is kept out of the
  // shared per-address bucket in `api/user/[op].ts`. Two tiers instead: an
  // address backstop sized for a class behind one NAT, then the learner's own.
  // The token is checked while the address bucket answers (lib/rate-limit.ts).
  if (req.method === 'PUT' && !(await enforceAddressRateLimit(req, res, RATE_LIMITS.learningPathDraftAddress))) return;
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Learning-path storage is not configured');

  if (req.method === 'GET') {
    const enrollmentId = req.query.enrollmentId;
    const activityId = req.query.activityId;
    if (typeof enrollmentId !== 'string' || !ID.test(enrollmentId)) {
      return jsonError(res, 400, 'bad_request', 'An enrollmentId is required');
    }
    if (typeof activityId !== 'string' || !/^[a-z0-9-]{3,96}$/.test(activityId)) {
      return jsonError(res, 400, 'bad_request', 'An activityId is required');
    }
    try {
      // The draft read carries the owner too, so it can run beside the
      // ownership check instead of after it.
      const [owned, { data, error }] = await Promise.all([
        loadEnrollment(supabase, userId, enrollmentId),
        withTimeout(
          supabase.from('learning_path_drafts').select('activity_id,revision,content,updated_at')
            .eq('enrollment_id', enrollmentId).eq('activity_id', activityId).eq('user_id', userId).maybeSingle(),
        ),
      ]);
      if (!owned) return jsonError(res, 404, 'not_found', 'Unknown enrollment');
      if (error) return jsonError(res, 500, 'db_error', 'Could not load the draft');
      res.setHeader('Cache-Control', 'private, no-store');
      const out: DraftGetResponse = {
        draft: data
          ? {
              activityId,
              revision: Number(data.revision ?? 1),
              content: (data.content ?? {}) as PathDraft['content'],
              updatedAt: data.updated_at as string,
            }
          : null,
      };
      return res.json(out);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      if (migrationMissing(res, (error as { supabase?: { message?: string } }).supabase ?? null)) return;
      return jsonError(res, 500, 'db_error', 'Could not load the draft');
    }
  }

  if (req.method === 'PUT') {
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.learningPathDraft, `user:${userId}`))) return;
    const body = (req.body || {}) as Partial<DraftSaveRequest>;
    if (typeof body.enrollmentId !== 'string' || !ID.test(body.enrollmentId)) {
      return jsonError(res, 400, 'bad_request', 'An enrollmentId is required');
    }
    if (typeof body.activityId !== 'string' || !/^[a-z0-9-]{3,96}$/.test(body.activityId)) {
      return jsonError(res, 400, 'bad_request', 'An activityId is required');
    }
    // save_learning_path_draft raises on a revision outside 0..1,000,000, and
    // a raise is a 500; the bound is checked here so a bad value is a 400.
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0
        || (body.expectedRevision as number) > MAX_DRAFT_REVISION) {
      return jsonError(res, 400, 'bad_request', 'expectedRevision must be a whole number');
    }
    const content = body.content;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return jsonError(res, 400, 'bad_request', 'content is required');
    }
    const serialized = JSON.stringify(content);
    if (Buffer.byteLength(serialized, 'utf8') > PATH_LIMITS.payloadBytes) {
      return jsonError(res, 413, 'too_large', 'A draft is limited to 64 kB');
    }
    if (holdsNul(content)) return jsonError(res, 400, 'bad_request', NUL_MESSAGE);
    if (typeof content.code === 'string' && pathCodeTooLarge(content.code)) {
      return jsonError(res, 413, 'too_large', 'Code is limited to 20 kB');
    }

    const params = {
      p_user_id: userId,
      p_enrollment_id: body.enrollmentId,
      p_activity_id: body.activityId,
      p_expected_revision: body.expectedRevision,
      p_content: content,
      p_max_drafts: PATH_LIMITS.draftsPerEnrollment,
    };
    let saved = await withTimeout(supabase.rpc('save_learning_path_draft_v2', params));
    if (isRpcMissing(saved.error)) saved = await withTimeout(supabase.rpc('save_learning_path_draft', params));
    if (saved.error) {
      if (migrationMissing(res, saved.error)) return;
      if (saved.error.code === '55P03') {
        return jsonError(res, 503, 'draft_busy', 'The draft is busy. Try again.');
      }
      // Two first saves of one activity at once (a second tab or device) both
      // find no row and both insert at revision 0; the later one meets the
      // (enrollment, activity) key. The other save's copy is now the newer
      // one, which is a conflict, not a server failure.
      if (saved.error.code === '23505') {
        return jsonError(res, 409, 'draft_conflict', 'A newer draft was saved elsewhere. Reload before saving again.');
      }
      // Every other field the routine checks was checked above, so its raise
      // means the stored form outgrew its 64 kB (pg_column_size measures the
      // binary JSONB, which can exceed the text this handler measured).
      if (/invalid_learning_path_draft/.test(saved.error.message ?? '')) {
        return jsonError(res, 413, 'too_large', 'A draft is limited to 64 kB');
      }
      return jsonError(res, 500, 'db_error', 'Could not save the draft');
    }
    markStorageInstalled();
    const result = (saved.data ?? {}) as { ok?: boolean; reason?: string; revision?: number; updatedAt?: string };
    if (!result.ok) {
      if (result.reason === 'conflict') {
        // The other device's copy is newer. Say so with its revision rather
        // than overwriting work the learner has not seen.
        return jsonError(res, 409, 'draft_conflict', 'A newer draft was saved elsewhere. Reload before saving again.');
      }
      if (result.reason === 'too_many_drafts') {
        return jsonError(res, 409, 'too_many_drafts', `A path keeps at most ${PATH_LIMITS.draftsPerEnrollment} drafts at a time`);
      }
      return jsonError(res, 404, 'not_found', 'Unknown enrollment');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const out: DraftSaveResponse = {
      draft: {
        activityId: body.activityId,
        revision: Number(result.revision ?? 1),
        content: content as PathDraft['content'],
        updatedAt: result.updatedAt ?? new Date().toISOString(),
      },
    };
    return res.json(out);
  }

  res.setHeader('Allow', 'GET, PUT');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/* ── module summary, for the dev readiness screen ─────────────────────── */

export { manifestFor, moduleSummary };
