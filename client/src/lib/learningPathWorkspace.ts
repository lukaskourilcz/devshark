// Helpers only the lazy learning-path screens use: the device copy of an
// unsaved draft and the enrollment-list merge after a change. They live apart
// from lib/learningPaths.ts because that module is in the main chunk (Today,
// Roadmap and the landing page read the catalog), and nothing here needs to
// load before a learner opens a path.

import { readJSON, removeStored, writeJSON } from './storage';
import { queryClient } from './queryClient';
import { routeChunk } from './routePreload';
import { freshStoredAccessToken, storedSessionUserId } from './supabaseClient';
import { enrollmentsQuery, pathCatalogQuery } from './learningPaths';
import type { EnrollmentListResponse, PathDraft } from '../../../shared/learning-path-api';

/* ── the path pages' first reads ───────────────────────────────────────── */

/** The FDE overview and its module pages (App.tsx serves the same two). */
export const isPathPage = (pathname: string): boolean =>
  /^\/learn\/forward-deployed-engineer\/path(?:\/[^/]+)?\/?$/.test(pathname);

/**
 * The catalogue and, for the stored session's account, its enrollments: what
 * the path pages read first, before an enrollment's progress or an activity's
 * start can leave (perf baseline #587 C27). They left only once the page had
 * drawn; now they leave with the pages' code when a link to one is pointed
 * at, focused or pressed (the route preload, lib/routePreload.ts). The
 * enrollments go only with a token supabase-js would hand out unchanged,
 * under the key the page's own query uses; one attempt each, as a page hold's
 * reads.
 */
export function prefetchPathPages(): Promise<void> {
  void queryClient.prefetchQuery({ ...pathCatalogQuery, retry: false });
  const userId = storedSessionUserId();
  if (userId && freshStoredAccessToken()) void queryClient.prefetchQuery({ ...enrollmentsQuery(userId), retry: false });
  return Promise.resolve();
}

let registered = false;
/**
 * Add the path pages' first reads to their route preload. The screens that
 * link to the path pages call it as they load (the FDE section's path shelf,
 * Today's path section), so it costs the app's first download nothing; a
 * route preload runs once per page load, so a later visit reads as its page
 * mounts, as before. A first visit that opens on a path page reads as the
 * page mounts too.
 */
export function preloadPathPagesWithLinks(): void {
  if (registered) return;
  registered = true;
  routeChunk(isPathPage, prefetchPathPages);
}

/** The cached enrollment list with the rows a change returned put in place,
 * so a screen shows the new status at once instead of after a refetch. With
 * nothing cached yet it stays empty, and the refetch fills it. */
export function withChangedEnrollments(
  list: EnrollmentListResponse | undefined,
  changed: EnrollmentListResponse,
): EnrollmentListResponse | undefined {
  if (!list) return list;
  const ids = new Set(changed.enrollments.map((one) => one.enrollmentId));
  return { enrollments: [...list.enrollments.filter((one) => !ids.has(one.enrollmentId)), ...changed.enrollments] };
}

/* A copy of an unsaved draft on this device, so a draft the server has not
 * taken yet (offline, or a failed save) survives a reload. The base revision
 * identifies the version these edits were made against. A different server
 * revision alone does not prove that the server has these edits. */

const localDraftKey = (enrollmentId: string, activityId: string) => `devshark:path:draft:${enrollmentId}:${activityId}`;

export function keepDraftLocally(enrollmentId: string, activityId: string, baseRevision: number, content: PathDraft['content']): void {
  writeJSON(localDraftKey(enrollmentId, activityId), { baseRevision, content });
}

export function forgetLocalDraft(enrollmentId: string, activityId: string): void {
  removeStored(localDraftKey(enrollmentId, activityId));
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stored copy has the shape a save sends: code as text, or artifact fields
 * as text or lists of text. Anything else (an older format, a hand-edited or
 * truncated entry) would only be refused by the server on every keystroke. */
function isDraftContent(value: unknown): value is PathDraft['content'] {
  if (!isPlainObject(value)) return false;
  const { code, artifact } = value;
  if (code === undefined && artifact === undefined) return false;
  if (code !== undefined && typeof code !== 'string') return false;
  if (artifact === undefined) return true;
  return isPlainObject(artifact) && Object.values(artifact).every((field) =>
    typeof field === 'string' || (Array.isArray(field) && field.every((one) => typeof one === 'string')));
}

/** Unsaved device work, at its own base revision. The caller checks for a
 * conflict before using that revision to save. */
export function localDraftOver(
  enrollmentId: string,
  activityId: string,
  server: PathDraft | null,
  serverUnknown = false,
): PathDraft | null {
  const kept = readJSON<{ baseRevision?: unknown; content?: unknown } | null>(localDraftKey(enrollmentId, activityId), null);
  if (!kept) return null;
  if (!isDraftContent(kept.content)) {
    forgetLocalDraft(enrollmentId, activityId);
    return null;
  }
  if (!serverUnknown && JSON.stringify(kept.content) === JSON.stringify(server?.content ?? null)) {
    forgetLocalDraft(enrollmentId, activityId);
    return null;
  }
  const base = typeof kept.baseRevision === 'number' && Number.isInteger(kept.baseRevision) && kept.baseRevision >= 0
    ? kept.baseRevision : 0;
  return {
    activityId,
    // A confirmed absence (for example after retention) can take a new
    // draft. A failed read cannot establish that absence.
    revision: server || serverUnknown ? base : 0,
    content: kept.content,
    updatedAt: new Date().toISOString(),
  };
}
