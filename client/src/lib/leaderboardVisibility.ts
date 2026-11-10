// Profile edits the independent leaderboard preference; boards read it.
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiFetch } from './api';
import { accountEpoch } from './accountData';
import { useAuth } from './auth';

const URL = '/api/user/leaderboard-name';

export interface LeaderboardVisibility {
  mode: 'nickname' | 'account';
  nickname: string;
  accountName: string | null;
  showPhoto?: boolean;
  picture?: string | null;
}

const visibilityKey = (userId: string) => ['leaderboard-name', userId] as const;

export const leaderboardVisibilityQuery = (userId: string) => queryOptions({
  queryKey: visibilityKey(userId),
  queryFn: ({ signal }) => apiFetch<LeaderboardVisibility>(URL, { signal, expectedUserId: userId }),
  staleTime: 5 * 60_000,
});

type Patch = { mode?: LeaderboardVisibility['mode']; showPhoto?: boolean };
type Save = { patch: Patch; userId: string; epoch: number };
type SaveHandlers = { onError?: (error: unknown) => void };

/**
 * The signed-in learner's setting and the way to change it. `setMode`
 * shows the new state at once and puts the old one back if the save fails;
 * pass `onError` to tell the learner. A save, successful or not, refetches
 * every board this tab has loaded: the learner's own 30-day board, whose line
 * for them is uncached, follows at once, and the shared boards follow as soon
 * as the CDN's copy expires, within a minute (they are never served stale).
 *
 * Carry the account that chose the setting through both the request and the
 * optimistic cache update. Clearing the old account's cache must stay final,
 * even when its save was already on the wire.
 */
export function useLeaderboardVisibility() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const options = leaderboardVisibilityQuery(userId ?? '');
  const query = useQuery({ ...options, enabled: !!userId });

  const mutation = useMutation({
    mutationFn: ({ patch, userId, epoch }: Save) => {
      if (epoch !== accountEpoch()) throw new ApiError('Request was cancelled.', 0, 'cancelled');
      return apiFetch<LeaderboardVisibility>(URL, { method: 'PUT', body: JSON.stringify(patch), expectedUserId: userId });
    },
    onMutate: async ({ patch, userId, epoch }: Save) => {
      const queryKey = visibilityKey(userId);
      await queryClient.cancelQueries({ queryKey });
      if (epoch !== accountEpoch()) return;
      const previous = queryClient.getQueryData<LeaderboardVisibility>(queryKey);
      queryClient.setQueryData<LeaderboardVisibility>(queryKey, (old) => old ? { ...old, ...patch } : old);
      return { previous, queryKey };
    },
    onError: (_error, { epoch }, context) => {
      if (epoch !== accountEpoch() || !context) return;
      if (context.previous) queryClient.setQueryData(context.queryKey, context.previous);
      else void queryClient.resetQueries({ queryKey: context.queryKey });
    },
    onSuccess: (saved, { epoch }, context) => {
      if (epoch === accountEpoch() && context) queryClient.setQueryData(context.queryKey, saved);
    },
    onSettled: (_saved, _error, { epoch }) => {
      if (epoch === accountEpoch()) return queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
  const save = (patch: Patch, handlers?: SaveHandlers) => {
    if (!userId) return;
    const epoch = accountEpoch();
    mutation.mutate({ patch, userId, epoch }, {
      onError: (error) => {
        if (epoch === accountEpoch()) handlers?.onError?.(error);
      },
    });
  };

  return {
    /** Null while it has not loaded (or there is no signed-in learner). */
    setting: query.data ?? null,
    loading: query.isPending && !!userId,
    failed: query.isError && query.data === undefined,
    retry: () => void query.refetch(),
    saving: mutation.isPending,
    setMode: (mode: LeaderboardVisibility['mode'], handlers?: SaveHandlers) => save({ mode }, handlers),
    setPhoto: (showPhoto: boolean, handlers?: SaveHandlers) => save({ showPhoto }, handlers),
  };
}
