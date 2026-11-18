// Saved challenges, collections, skip reasons and short practice sessions.
//
// All of it is owner-scoped server state, so all of it goes through the API
// rather than localStorage: a saved list that lives on one device is not a
// saved list. None of it grants anything — the eligibility rules are applied
// server-side when a task is issued, exactly as they are for any other route.

import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import { accountEpoch } from '../lib/accountData';
import type {
  CodingBookmarkRequest,
  CodingBookmarksResponse,
  CodingSkipRequest,
  CodingSkipResponse,
  PracticeSessionAdvanceRequest,
  PracticeSessionResponse,
  PracticeSessionStartRequest,
} from '../../../shared/coding-api';

const BOOKMARKS = '/api/user/[op]?op=coding-bookmarks';
const SKIP = '/api/user/[op]?op=coding-skip';
const SESSION = '/api/user/[op]?op=practice-session';

export const practiceKeys = {
  bookmarks: () => ['coding', 'bookmarks'] as const,
  session: () => ['coding', 'session'] as const,
};

export const fetchBookmarks = (signal?: AbortSignal): Promise<CodingBookmarksResponse> =>
  apiFetch<CodingBookmarksResponse>(BOOKMARKS, { signal });

export const writeBookmarks = (body: CodingBookmarkRequest): Promise<CodingBookmarksResponse> =>
  apiFetch<CodingBookmarksResponse>(BOOKMARKS, { method: 'PUT', body: JSON.stringify(body) });

export const skipTask = (body: CodingSkipRequest): Promise<CodingSkipResponse> =>
  apiFetch<CodingSkipResponse>(SKIP, { method: 'POST', body: JSON.stringify(body) });

export const fetchPracticeSession = (signal?: AbortSignal): Promise<PracticeSessionResponse> =>
  apiFetch<PracticeSessionResponse>(SESSION, { signal });

export const startPracticeSession = (body: PracticeSessionStartRequest): Promise<PracticeSessionResponse> =>
  apiFetch<PracticeSessionResponse>(SESSION, { method: 'POST', body: JSON.stringify(body) });

export const advancePracticeSession = (body: PracticeSessionAdvanceRequest): Promise<PracticeSessionResponse> =>
  apiFetch<PracticeSessionResponse>(SESSION, { method: 'PUT', body: JSON.stringify(body) });

// A start, a step or a save still on the wire when the learner logs out, or
// another account signs in, must not answer into the next account's cache:
// these keys carry no account id, and emptying the cache (lib/auth.tsx) does
// not stop a mutation already sent. onMutate notes the account epoch
// (lib/accountData.ts), and the answer is written only while it holds.
interface Sent { epoch: number }
const noteAccount = (): Sent => ({ epoch: accountEpoch() });
const sameAccount = (sent: Sent | undefined): boolean => sent?.epoch === accountEpoch();

/** The learner's saved challenges and collections. Signed out there are none:
 * saving is an account feature, and the UI says so rather than pretending. */
export const bookmarksQuery = queryOptions({
  queryKey: practiceKeys.bookmarks(),
  queryFn: ({ signal }) => fetchBookmarks(signal),
  staleTime: 60_000,
});

/** `held`: the page's first-data hold read them (lib/routeData.ts HELD_READ). */
export function useBookmarks(enabled: boolean, { held = false }: { held?: boolean } = {}) {
  return useQuery({ ...bookmarksQuery, enabled, retryOnMount: !held });
}

export function useSaveChallenge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CodingBookmarkRequest) => writeBookmarks(input),
    onMutate: noteAccount,
    onSuccess: (data, _input, sent) => {
      if (sameAccount(sent)) queryClient.setQueryData(practiceKeys.bookmarks(), data);
    },
  });
}

/** The learner's open challenge run, as one set of options the hook and a
 * page's first-data prefetch share. */
export const practiceSessionQuery = queryOptions({
  queryKey: practiceKeys.session(),
  queryFn: ({ signal }) => fetchPracticeSession(signal),
  staleTime: 15_000,
});

export function usePracticeSession(enabled: boolean) {
  return useQuery({ ...practiceSessionQuery, enabled });
}

export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeSessionStartRequest) => startPracticeSession(input),
    onMutate: noteAccount,
    onSuccess: (data, _input, sent) => {
      if (sameAccount(sent)) queryClient.setQueryData(practiceKeys.session(), data);
    },
  });
}

export function useAdvanceSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PracticeSessionAdvanceRequest) => advancePracticeSession(input),
    onMutate: noteAccount,
    onSuccess: (data, _input, sent) => {
      if (sameAccount(sent)) queryClient.setQueryData(practiceKeys.session(), data);
    },
  });
}
