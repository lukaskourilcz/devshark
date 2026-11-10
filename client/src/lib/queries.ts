// Shared TanStack Query hooks for the app's read-only fetches. Centralising the
// query keys + fns here means callers get caching, request de-duplication
// (e.g. /learn and /roadmap share one roadmap-structure fetch), background
// revalidation and built-in cancellation for free — replacing the bespoke
// useEffect + AbortController + loading/error state each screen used to carry.

import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRoadmapStructure, syncProgressWithServer } from './roadmap';
import { useAuth } from './auth';
import { entitlementQuery } from './entitlement';
import { HELD_READ, readOnce, settled, useFirstData } from './routeData';
import { fetchLeaderboard, type LeaderboardPeriod } from './play';
import { getUserStats, createOrUpdateUserStats, type UserStats } from './supabase';
import { apiFetch } from './api';
import { listFlashcards } from './flashcards';
import { getChallengeLeaderboard } from './challengeApi';
import { useSubject, type SubjectId } from './subjects';

/** The roadmap level/checkpoint map, as one set of options the hook and a
 * page's first-data prefetch share. */
export const roadmapStructureQuery = queryOptions({
  queryKey: ['roadmap', 'structure'],
  // React Query supplies an AbortSignal that fetchRoadmapStructure forwards to fetch.
  queryFn: ({ signal }) => fetchRoadmapStructure(signal),
  staleTime: 5 * 60_000, // the structure only changes when questions are edited in /dev
});

/** The roadmap level/checkpoint map. Shared by the Learn path and the roadmap tree. */
export function useRoadmapStructure() {
  return useQuery(roadmapStructureQuery);
}

/** Hold a page drawn from the roadmap structure until the structure (and,
 * with `plan`, a signed-in account's plan, which decides the Premium marks) is
 * in the cache, so it draws its path once instead of a skeleton first.
 *
 * With `progress`, a signed-in account's progress sync is in the same wait.
 * The Learn map picks its topic on its first draw from the progress this
 * device holds, so a deep link to a topic that progress opens (?topic=dsa-
 * advanced) needs the account's record merged by then. It always was in
 * practice: the sign-in sync answered before the map drew. Once the map drew
 * without React's reveal throttle (perf baseline #587 C04), it could draw
 * first and land on the section's first topic. The sync is the one the map
 * starts beside this hold (learn/mapReads.ts), not a second read, and the
 * wait keeps its cap (lib/routeData.ts FIRST_DATA_WAIT_MS). */
export function useRoadmapStructureFirst({ plan, progress = false }: { plan: boolean; progress?: boolean }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const account = plan ? user : null;
  useFirstData(`structure ${account?.id ?? ''}`, () => settled([
    readOnce(queryClient, roadmapStructureQuery),
    account ? readOnce(queryClient, entitlementQuery(account.id)) : null,
    progress && user ? syncProgressWithServer() : null,
  ]));
}

/** What one board needs from the server. The 30-day board is the default. */
export type LeaderboardRequest =
  | { period: '30d'; category: string | null; viewer: string | null }
  | { period: 'month'; categories: string[]; viewer: string | null }
  | { period: 'global'; categories: string[] }
  | { period: 'category'; category: string }
  | { period: 'daily'; date: string; categories: string[] };

/** One board, as one set of options the hook and the page's first-data
 *  prefetch share, so the two cannot ask for different keys. The key holds only
 *  the inputs that change the result, plus the viewer on the 30-day and month
 *  boards, whose responses carry their own line. */
export function leaderboardQuery(request: LeaderboardRequest, activeViewer?: string | null) {
  const period: LeaderboardPeriod = request.period;
  const viewer = request.period === '30d' || request.period === 'month' ? request.viewer : null;
  return queryOptions({
    // Keep the prior board during a tab or topic switch, unless its private
    // rank and viewer marks belong to an account that has since left.
    placeholderData: (previous, previousQuery) => {
      const previousViewer = previousQuery?.queryKey[5];
      return previousViewer && previousViewer !== (activeViewer ?? viewer) ? undefined : previous;
    },
    queryKey: [
      'leaderboard',
      period,
      request.period === 'daily' ? request.date : null,
      request.period === 'category' || request.period === '30d' ? request.category : null,
      request.period === 'global' || request.period === 'daily' || request.period === 'month' ? request.categories.join(',') : null,
      viewer,
    ],
    queryFn: ({ signal }) =>
      fetchLeaderboard(period, {
        signal,
        date: request.period === 'daily' ? request.date : undefined,
        category: request.period === 'category' || request.period === '30d' ? request.category : undefined,
        categories: request.period === 'global' || request.period === 'daily' || request.period === 'month' ? request.categories : undefined,
        personal: (request.period === '30d' || request.period === 'month') && !!request.viewer,
      }),
    staleTime: 30_000,
  });
}

/** A leaderboard board. The screen's hold reads the board it opens on, so a
 * failure there draws the screen's error at once (HELD_READ); a board picked
 * later loads as before. */
export function useLeaderboard(request: LeaderboardRequest, activeViewer: string | null) {
  return useQuery({ ...leaderboardQuery(request, activeViewer), ...HELD_READ });
}

export const profileStatsQueryKey = (userId: string | undefined) =>
  ['profile-stats', userId] as const;

/** The signed-in user's profile stats, creating the row on first visit. */
export function useProfileStats(
  userId: string | undefined,
  createWith: { email?: string; name?: string; picture?: string },
  enabled: boolean,
) {
  return useQuery({
    queryKey: profileStatsQueryKey(userId),
    enabled: enabled && !!userId,
    queryFn: async (): Promise<UserStats | null> => {
      const loaded = await getUserStats(userId!);
      return loaded ?? (await createOrUpdateUserStats(userId!, createWith));
    },
  });
}

/** The signed-in user's saved flashcards of a subject, as one set of options
 * the hook and /collection's first-data hold share. */
export const flashcardsQuery = (subject: SubjectId) => queryOptions({
  queryKey: ['flashcards', subject],
  queryFn: listFlashcards,
});

/** The signed-in user's saved flashcards. `held`: the page's hold read them
 * (HELD_READ). */
export function useFlashcards(enabled: boolean, { held = false }: { held?: boolean } = {}) {
  const [subject] = useSubject();
  return useQuery({ ...flashcardsQuery(subject), enabled, retryOnMount: !held });
}

/** The Biggest Shark Challenge leaderboard of a subject, as one set of
 * options the hook and the page's first-data prefetch share. */
export const challengeLeaderboardQuery = (subject: SubjectId) => queryOptions({
  queryKey: ['challenge', 'leaderboard', subject],
  queryFn: getChallengeLeaderboard,
  staleTime: 30_000,
});

/** The Biggest Shark Challenge leaderboard (best-effort; never throws to the UI). */
export function useChallengeLeaderboard() {
  const [subject] = useSubject();
  return useQuery(challengeLeaderboardQuery(subject));
}

/** Concepts whose spaced review is due, for Today's review card. */
interface ConceptDueResponse {
  due: { conceptId: string; overdueHours: number; stage: number }[];
  estimatedMinutes: number;
}

/** The signed-in learner's due concepts, as one set of options the Today card
 * and Today's first-data prefetch share. A failure only hides the card, so it
 * is not retried. */
export const conceptDueQuery = queryOptions({
  queryKey: ['concept-due'],
  queryFn: () => apiFetch<ConceptDueResponse>('/api/quiz/questions?resource=due'),
  staleTime: 60_000,
  retry: false,
});
