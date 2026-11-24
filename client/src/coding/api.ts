import { isGithubInstallUrl } from '../lib/safeRedirect';
// Typed wrappers over the coding API resources plus the TanStack Query hooks
// the section screens use. Query keys live under ['coding', …] so a submit
// can invalidate exactly the progress it changed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { staleProfileStats } from '../lib/queryClient';
import { announceVerifiedQuestXp, announceXpHeld, syncXpWithServer } from '../lib/xp';
import { joinCodingTaskRead } from '../../../shared/coding-task-read';
import type {
  CodingApproachesResponse,
  CodingBriefResponse,
  CodingDraftSaveRequest,
  CodingDraftSaveResponse,
  CodingProgressResponse,
  CodingResetRequest,
  CodingResetResponse,
  CodingRevealRequest,
  CodingRevealResponse,
  CodingSubmitRequest,
  CodingTaskResponse,
  CodingTaskStateResponse,
  CodingVerdictResponse,
  GithubConnectStartResponse,
  GithubConnectionResponse,
  GithubSyncResponse,
} from '../../../shared/coding-api';

const ROADMAP = '/api/quiz/roadmap';
const USER = '/api/user/[op]';

export const codingKeys = {
  approaches: (id: string) => ['coding', 'approaches', id] as const,
  task: (id: string) => ['coding', 'task', id] as const,
  brief: (id: string) => ['coding', 'brief', id] as const,
  progress: () => ['coding', 'progress'] as const,
  github: () => ['coding', 'github'] as const,
};

export function fetchCodingTask(id: string, signal?: AbortSignal, learnSession?: string): Promise<CodingTaskResponse> {
  return apiFetch<CodingTaskResponse>(`${ROADMAP}?resource=coding-task&id=${encodeURIComponent(id)}`, { signal,
    ...(learnSession ? { method: 'POST', body: JSON.stringify({ session: learnSession }) } : {}),
  });
}

/** The task's brief, the same for every caller and sent without a token
 * (lib/api.ts PUBLIC_READ). `fresh` reads past the browser's cache, for a
 * brief of another version than the session's. */
export function fetchCodingBrief(id: string, signal?: AbortSignal, fresh = false): Promise<CodingBriefResponse> {
  return apiFetch<CodingBriefResponse>(`${ROADMAP}?resource=coding-brief&id=${encodeURIComponent(id)}`, { signal, ...(fresh ? { cache: 'no-cache' as const } : {}) });
}

/** The caller's part of a task page: the sealed session, lock, progress and draft. */
export function fetchCodingTaskState(id: string, signal?: AbortSignal): Promise<CodingTaskStateResponse> {
  return apiFetch<CodingTaskStateResponse>(`${ROADMAP}?resource=coding-state&id=${encodeURIComponent(id)}`, { signal });
}

export async function submitCoding(input: CodingSubmitRequest): Promise<CodingVerdictResponse> {
  const result = await apiFetch<CodingVerdictResponse>(`${ROADMAP}?resource=coding-submit`, {
    method: 'POST',
    body: JSON.stringify(input),
    timeoutMs: 50_000,
  });
  // A recorded pass is a streak day.
  if (result.applied && result.verdict === 'passed') staleProfileStats();
  // The pass's XP exists only on the server until a sync, and a later silent
  // sync would mark the rank it crosses as seen: announce the gain, then the
  // rank. A pass that is no first pass paid the task's XP again (058).
  if (result.xpAwarded > 0) {
    announceVerifiedQuestXp(result.xpAwarded, result.firstPass ? 'coding' : 'again');
    void syncXpWithServer({ announceRankUp: true });
  } else if (result.applied && result.verdict === 'passed' && result.repeatXp?.withheld) {
    // A pass the repeat rule (058) paid nothing. The toast says what earns
    // the XP again: a reset, and a pass from the hour on, when it is not up.
    const at = result.repeatXp.availableAt;
    announceXpHeld({ on: 'task', availableAt: at && Date.parse(at) > Date.now() ? at : null });
  }
  return result;
}

export function revealCoding(input: CodingRevealRequest): Promise<CodingRevealResponse> {
  return apiFetch<CodingRevealResponse>(`${ROADMAP}?resource=coding-reveal`, { method: 'POST', body: JSON.stringify(input) });
}

/** The workbench's Reset, signed in: it opens the task's XP again for a pass
 * an hour after the task last paid it (migration 058). */
export function resetCoding(input: CodingResetRequest): Promise<CodingResetResponse> {
  return apiFetch<CodingResetResponse>(`${ROADMAP}?resource=coding-reset`, { method: 'POST', body: JSON.stringify(input) });
}

export function fetchCodingProgress(signal?: AbortSignal): Promise<CodingProgressResponse> {
  return apiFetch<CodingProgressResponse>(`${USER}?op=coding-progress`, { signal });
}

/** `base`: the account draft's time the code builds on, null for none. The
 * server refuses the save with 409 draft_conflict when its draft moved since. */
export function saveCodingDraft(id: string, code: string, base: string | null): Promise<CodingDraftSaveResponse> {
  return apiFetch<CodingDraftSaveResponse>(`${USER}?op=coding-draft`, { method: 'POST', body: JSON.stringify({ id, code, base } satisfies CodingDraftSaveRequest) });
}

export function fetchGithubConnection(signal?: AbortSignal): Promise<GithubConnectionResponse> {
  return apiFetch<GithubConnectionResponse>(`${USER}?op=github-connection`, { signal });
}
export async function startGithubConnect(): Promise<GithubConnectStartResponse> {
  const response = await apiFetch<GithubConnectStartResponse>(`${USER}?op=github-connect-start`, { method: 'POST', body: '{}' });
  if (!isGithubInstallUrl(response.url)) throw new Error('GitHub returned an invalid installation link.');
  return response;
}
/** `code` is GitHub's one-time user authorization from the install redirect;
 * the server exchanges it to check the installation is the learner's own. */
export function finishGithubConnect(installationId: string, state: string, code: string): Promise<GithubConnectionResponse> {
  return apiFetch<GithubConnectionResponse>(`${USER}?op=github-connect-finish`, { method: 'POST', body: JSON.stringify({ installationId, state, code }) });
}
export function chooseGithubRepo(repoFullName: string): Promise<GithubConnectionResponse> {
  return apiFetch<GithubConnectionResponse>(`${USER}?op=github-repo`, { method: 'POST', body: JSON.stringify({ repoFullName }) });
}
export function syncGithub(): Promise<GithubSyncResponse> {
  return apiFetch<GithubSyncResponse>(`${USER}?op=github-sync`, { method: 'POST', body: '{}', timeoutMs: 30_000 });
}
export function disconnectGithub(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`${USER}?op=github-disconnect`, { method: 'POST', body: '{}' });
}

/** The signed-in learner's coding progress, as one set of options the hook
 * and a page's first-data prefetch share. */
export const codingProgressQuery = queryOptions({
  queryKey: codingKeys.progress(),
  queryFn: ({ signal }) => fetchCodingProgress(signal),
  staleTime: 30_000,
});

/** The signed-in learner's coding progress; `enabled` false for anonymous visitors. */
export function useCodingProgress(enabled: boolean) {
  return useQuery({ ...codingProgressQuery, enabled });
}

/** Curated approaches for a task the learner has passed. The server decides;
 * this hook only asks, and only once a pass has been recorded. */
export function fetchCodingApproaches(id: string, signal?: AbortSignal): Promise<CodingApproachesResponse> {
  return apiFetch<CodingApproachesResponse>(`${ROADMAP}?resource=coding-approaches&id=${encodeURIComponent(id)}`, { signal });
}

export function useCodingApproaches(id: string | undefined, passed: boolean) {
  return useQuery({
    queryKey: codingKeys.approaches(id ?? ''),
    enabled: Boolean(id) && passed,
    queryFn: ({ signal }) => fetchCodingApproaches(id!, signal),
    staleTime: 5 * 60_000,
  });
}

/** How long a task's answer counts as the one this visit asked for. The
 * first page's early read (startCodingTaskRead) hands its answer to the
 * screen within that time, so the screen does not ask again; every visit
 * still asks afresh, since nothing outlives the screen (gcTime 0). */
export const TASK_HANDOFF_MS = 5_000;

// Premium (402), an unknown task (404) and a retired one (410) are answers,
// not failures to retry, and so is a request the server refused as
// malformed (400): sent again, it is refused again.
const retryTaskRead = (failures: number, error: unknown) =>
  ![400, 402, 404, 410].includes((error as { status?: unknown } | null)?.status as number) && failures < 1;

/** The task, its sealed session and the account's draft in one answer, as
 * one set of options the task screen and the first page's early read share.
 * The Learn link and Premium tasks read it this way; a free task reads its
 * brief and the caller's part apart (coding/taskRead.ts). */
export const codingTaskQuery = (id: string, learnSession?: string) => queryOptions({
  queryKey: [...codingKeys.task(id), learnSession ?? null] as const,
  queryFn: ({ signal }) => fetchCodingTask(id, signal, learnSession),
  retry: retryTaskRead,
  staleTime: TASK_HANDOFF_MS,
  // A read that failed in the early read is the screen's error: its Try
  // again asks again, as after a failure of its own.
  retryOnMount: false,
  // Task responses contain an editable starting draft. Do not mount a new
  // stage from an old response while its current draft is being fetched.
  gcTime: 0,
});

/** How long a brief read in this tab answers a task page (#587 C23). The
 * brief changes only with a deploy, and a page whose session names another
 * version reads it again (`useCodingTask`), so it may be kept long. */
export const BRIEF_STALE_MS = 30 * 60_000;

/** A task's brief, kept per task like any other read (gcTime by default):
 * a return to the task, or the next stage's page, takes it from here. */
export const codingBriefQuery = (id: string) => queryOptions({
  queryKey: codingKeys.brief(id),
  queryFn: ({ signal }) => fetchCodingBrief(id, signal),
  retry: retryTaskRead,
  staleTime: BRIEF_STALE_MS,
  retryOnMount: false,
});

/** The caller's part of a task page, read afresh on every visit, as the
 * combined answer was: it carries the sealed session and the account draft,
 * which must be current. Nothing of it outlives the screen (gcTime 0), and a
 * sign-out empties the cache, so no account's part answers another. */
export const codingTaskStateQuery = (id: string) => queryOptions({
  queryKey: [...codingKeys.task(id), 'state'] as const,
  queryFn: ({ signal }) => fetchCodingTaskState(id, signal),
  retry: retryTaskRead,
  staleTime: TASK_HANDOFF_MS,
  retryOnMount: false,
  gcTime: 0,
});

/** Read the brief again past the browser's cache, into the query cache. */
const readFreshBrief = (client: QueryClient, id: string) =>
  client.fetchQuery({ ...codingBriefQuery(id), queryFn: ({ signal }) => fetchCodingBrief(id, signal, true), staleTime: 0 });

export interface CodingTaskRead {
  data: CodingTaskResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<{ error: unknown }>;
}

/** A task page's read: the combined answer, or, with `splitRead` (a free
 * task outside a Learn link, coding/taskRead.ts), the brief and the caller's
 * part together, which make the same answer (`joinCodingTaskRead`). The page
 * sees one read either way. The brief comes from this tab's cache when it
 * holds one; when the session was sealed against another version of it (a
 * deploy since), the brief is read again past the browser's cache before
 * the page draws, and the page keeps what it showed until then. */
export function useCodingTask(id: string | undefined, learnSession?: string, splitRead = false): CodingTaskRead {
  const client = useQueryClient();
  const split = Boolean(id) && splitRead && !learnSession;
  const whole = useQuery({ ...codingTaskQuery(id ?? '', learnSession), enabled: Boolean(id) && !split });
  const brief = useQuery({ ...codingBriefQuery(id ?? ''), enabled: split });
  const state = useQuery({ ...codingTaskStateQuery(id ?? ''), enabled: split });

  const wanted = state.data?.briefVersion;
  const behind = split && brief.data !== undefined && wanted !== undefined && brief.data.version !== wanted;
  // The version the brief was last read again for, past the browser's cache.
  const [freshFor, setFreshFor] = useState<string | null>(null);
  const freshKey = `${id}:${wanted}`;
  useEffect(() => {
    if (!behind || !id || freshFor === freshKey) return;
    setFreshFor(freshKey);
    void readFreshBrief(client, id).catch(() => undefined);
  }, [behind, client, freshFor, freshKey, id]);
  // Held while a brief of the session's version is on its way; one read
  // again that still answers another version is shown as it is.
  const holding = behind && (freshFor !== freshKey || brief.isFetching);

  const joined = useMemo(() => (brief.data && state.data ? joinCodingTaskRead(brief.data, state.data) : undefined), [brief.data, state.data]);
  const shown = useRef<CodingTaskResponse | undefined>(undefined);
  if (split && joined && !holding) shown.current = joined;
  const data = !split ? whole.data : holding ? (shown.current?.task.id === id ? shown.current : undefined) : joined;

  const latest = useRef({ split, id, brief, state, whole });
  latest.current = { split, id, brief, state, whole };
  const refetch = useCallback(async (): Promise<{ error: unknown }> => {
    const now = latest.current;
    if (!now.split || !now.id) return now.whole.refetch();
    const taskId = now.id;
    const [read] = await Promise.all([now.state.refetch(), now.brief.isError ? now.brief.refetch() : null]);
    if (read.error) return { error: read.error };
    const version = read.data?.briefVersion;
    if (version !== undefined && client.getQueryData(codingBriefQuery(taskId).queryKey)?.version !== version) {
      setFreshFor(`${taskId}:${version}`);
      try {
        await readFreshBrief(client, taskId);
      } catch (error) {
        return { error };
      }
    }
    return { error: client.getQueryState(codingBriefQuery(taskId).queryKey)?.error ?? null };
  }, [client]);

  if (!split) return { data, isLoading: whole.isLoading, isError: whole.isError, error: whole.error, refetch };
  return {
    data,
    isLoading: data === undefined && (brief.isLoading || state.isLoading || holding),
    isError: brief.isError || state.isError,
    error: state.error ?? brief.error,
    refetch,
  };
}

export function useGithubConnection(enabled: boolean) {
  return useQuery({
    queryKey: codingKeys.github(),
    enabled,
    queryFn: ({ signal }) => fetchGithubConnection(signal),
    staleTime: 30_000,
  });
}
