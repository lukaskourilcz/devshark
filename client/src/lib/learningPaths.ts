// Typed wrappers over the learning-path API plus the TanStack Query hooks the
// path screens use. Query keys live under ['learning-path', …] and always
// carry the account and the enrollment, so signing in as somebody else can
// never show the previous learner's evidence from a warm cache.
//
// Nothing here decides what a learner has passed. The server owns grading,
// enrollment and completion; this module only asks and renders the answer.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { accountEpoch } from './accountData';
import { staleProfileStats } from './queryClient';
import type {
  DraftSaveRequest,
  DraftSaveResponse,
  EnrollmentCreateRequest,
  EnrollmentListResponse,
  LearningPathCatalogResponse,
  LearningPreferenceRequest,
  LearningPreferenceResponse,
  PathAvailability,
  PathCatalogEntry,
  PathProgressResponse,
  StartActivityRequest,
  StartActivityResponse,
  SubmitActivityRequest,
  SubmitActivityResponse,
} from '../../../shared/learning-path-api';
import type { LearningPathId } from '../../../shared/learning-paths';

const ROADMAP = '/api/quiz/roadmap';
const USER = '/api/user/[op]';

export const learningPathKeys = {
  catalog: () => ['learning-path', 'catalog'] as const,
  enrollments: (userId: string | undefined) => ['learning-path', 'enrollments', userId ?? 'anon'] as const,
  progress: (userId: string | undefined, enrollmentId: string | undefined, version: number | undefined) =>
    ['learning-path', 'progress', userId ?? 'anon', enrollmentId ?? '', version ?? 0] as const,
};

/* ── catalog ───────────────────────────────────────────────────────────── */

export function fetchPathCatalog(signal?: AbortSignal): Promise<LearningPathCatalogResponse> {
  return apiFetch<LearningPathCatalogResponse>(`${ROADMAP}?resource=learning-path-catalog`, { signal });
}

/** The published manifests, as one set of options the hook and a page's
 * first-data prefetch share. */
export const pathCatalogQuery = queryOptions({
  queryKey: learningPathKeys.catalog(),
  queryFn: ({ signal }) => fetchPathCatalog(signal),
  staleTime: 5 * 60_000,
});

/** The published manifests. Guests get this too — the outline is previewable
 * without an account; only persisted, graded work needs one. */
export function usePathCatalog(enabled = true) {
  return useQuery({ ...pathCatalogQuery, enabled });
}

export const entryFor = (
  catalog: LearningPathCatalogResponse | undefined,
  pathId: LearningPathId,
): PathCatalogEntry | undefined => catalog?.paths.find((entry) => entry.manifest.id === pathId);

/** True when a learner can enrol and record work right now. Anything else is
 * previewable, and the reason is shown rather than hidden. */
export const isOpen = (availability: PathAvailability | undefined): boolean => availability === 'available';

/* ── preference ────────────────────────────────────────────────────────── */

export function saveLearningPreference(input: LearningPreferenceRequest): Promise<LearningPreferenceResponse> {
  return apiFetch<LearningPreferenceResponse>(`${USER}?op=learning-preference`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/* ── enrollment ────────────────────────────────────────────────────────── */

export function fetchEnrollments(signal?: AbortSignal): Promise<EnrollmentListResponse> {
  return apiFetch<EnrollmentListResponse>(`${USER}?op=learning-path-enrollment`, { signal });
}

export function changeEnrollment(input: EnrollmentCreateRequest): Promise<EnrollmentListResponse> {
  return apiFetch<EnrollmentListResponse>(`${USER}?op=learning-path-enrollment`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** An account's enrollments, as one set of options the hook and a page's
 * first-data prefetch share. */
export const enrollmentsQuery = (userId: string | undefined) => queryOptions({
  queryKey: learningPathKeys.enrollments(userId),
  queryFn: ({ signal }) => fetchEnrollments(signal),
  staleTime: 30_000,
});

export function useEnrollments(userId: string | undefined) {
  return useQuery({ ...enrollmentsQuery(userId), enabled: Boolean(userId) });
}

/* ── progress ──────────────────────────────────────────────────────────── */

export function fetchPathProgress(enrollmentId: string, signal?: AbortSignal): Promise<PathProgressResponse> {
  return apiFetch<PathProgressResponse>(
    `${USER}?op=learning-path-progress&enrollmentId=${encodeURIComponent(enrollmentId)}`,
    { signal },
  );
}

/** One enrollment's progress, as one set of options the hook and a page's
 * first-data prefetch share. */
export const pathProgressQuery = (
  userId: string | undefined,
  enrollmentId: string | undefined,
  version: number | undefined,
) => queryOptions({
  queryKey: learningPathKeys.progress(userId, enrollmentId, version),
  queryFn: ({ signal }) => fetchPathProgress(enrollmentId!, signal),
  staleTime: 15_000,
});

export function usePathProgress(
  userId: string | undefined,
  enrollmentId: string | undefined,
  version: number | undefined,
) {
  return useQuery({ ...pathProgressQuery(userId, enrollmentId, version), enabled: Boolean(userId && enrollmentId) });
}

/* ── activities ────────────────────────────────────────────────────────── */

/** Opens an attempt. `signal` lets a screen the learner already left stop
 * waiting for (and parsing) an answer nobody will read. */
export function startActivity(input: StartActivityRequest, signal?: AbortSignal): Promise<StartActivityResponse> {
  return apiFetch<StartActivityResponse>(`${ROADMAP}?resource=learning-path-start`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export async function submitActivity(input: SubmitActivityRequest): Promise<SubmitActivityResponse> {
  const epoch = accountEpoch();
  const result = await apiFetch<SubmitActivityResponse>(`${ROADMAP}?resource=learning-path-submit`, {
    method: 'POST',
    body: JSON.stringify(input),
    // Grading a code activity runs the sandbox; the API's own budget is
    // shorter than this, so the client never gives up first.
    timeoutMs: 30_000,
  });
  if (accountEpoch() === epoch && result.code?.outcome === 'passed' && result.state === 'verified_pass') staleProfileStats();
  return result;
}

/** A fresh key per intended submission. Retrying a failed request reuses the
 * same key so the server can replay its stored result rather than grade twice;
 * a new submission mints a new one. */
export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ── drafts ────────────────────────────────────────────────────────────── */

export function savePathDraft(input: DraftSaveRequest): Promise<DraftSaveResponse> {
  return apiFetch<DraftSaveResponse>(`${USER}?op=learning-path-draft`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/* ── routes ────────────────────────────────────────────────────────────── */

/** The FDE path's pages live in its Learn section (#489, plan decision D4).
 * Its old addresses under /roadmap/specializations/fde redirect here: App.tsx
 * in the browser, vercel.json with a 308 for crawlers. App.tsx, routeHead.ts
 * and vercel.json spell the same path; the route-head test holds them equal. */
export const FDE_PATH_ROUTE = '/learn/forward-deployed-engineer/path';

/** The role specialization lives in its section. The retired DSA path's old
 * routes redirect to Learn (App.tsx, vercel.json). */
export function pathHref(_pathId: LearningPathId): string {
  return FDE_PATH_ROUTE;
}

export function moduleHref(pathId: LearningPathId, moduleId: string): string {
  return `${pathHref(pathId)}/${encodeURIComponent(moduleId)}`;
}

export function activityHref(pathId: LearningPathId, moduleId: string, activityId: string): string {
  return `${moduleHref(pathId, moduleId)}?activity=${encodeURIComponent(activityId)}`;
}
