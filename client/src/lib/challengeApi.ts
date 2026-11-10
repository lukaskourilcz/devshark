import { apiFetch } from './api';
import { staleProfileStats } from './queryClient';
import type { Question } from '../types/quiz';
import { getSubject, deliveryCategoriesForSubject } from './subjects';
import type { QuestionXpHeld } from '../../../shared/repeat-xp';

// Biggest Shark Challenge client. All resources live on one Vercel function
// (to stay within the 12-function Hobby limit), differentiated by method +
// `?resource=`:
//   GET  /api/quiz/challenge                       → fresh batch of mixed questions
//   GET  /api/quiz/challenge?resource=leaderboard  → top-10 + current champion
//   POST /api/quiz/challenge                       → submit a finished run's score

export interface ChallengeBatch {
  sessionId: string;
  runToken: string;
  questions: Question[];
}

export interface ChallengeScore {
  id: string;
  name: string;
  score: number;
  createdAt: string;
  topics?: string[] | null;
  allTopics?: boolean | null;
}

export interface ChallengeLeaderboard {
  top: ChallengeScore[];
  champion: ChallengeScore | null;
}

export function fetchChallengeBatch(opts: { exclude?: string[]; runToken?: string; ranked?: boolean; assessment?: boolean; categories?: string[]; signal?: AbortSignal } = {}): Promise<ChallengeBatch> {
  const params = new URLSearchParams();
  if (opts.exclude && opts.exclude.length > 0) {
    // Cap the exclude payload — the server caps too, but no need to send more.
    params.set('exclude', opts.exclude.slice(0, 400).join(','));
  }
  if (opts.runToken) params.set('runToken', opts.runToken);
  if (opts.ranked === false) params.set('ranked', '0');
  if (opts.assessment) params.set('resource', 'assessment');
  // Scope the challenge mix to the subject's served categories. A retired
  // section in the list gets the whole request refused.
  params.set('categories', (opts.categories ?? deliveryCategoriesForSubject(getSubject())).join(','));
  const qs = params.toString();
  return apiFetch<ChallengeBatch>(`/api/quiz/challenge${qs ? `?${qs}` : ''}`, { signal: opts.signal });
}

export function getChallengeLeaderboard(): Promise<ChallengeLeaderboard> {
  const params = new URLSearchParams({
    resource: 'leaderboard',
    categories: deliveryCategoriesForSubject(getSubject()).join(','),
  });
  return apiFetch<ChallengeLeaderboard>(`/api/quiz/challenge?${params}`);
}

/** `xpHeld`: the correct answers whose question paid XP less than an hour
 * ago, which paid nothing, and when they pay again (migration 060). */
export async function completeChallengeRun(input: { runToken: string; proofs: string[] }): Promise<{ ok: true; awarded: boolean; score: number; xp?: number; xpHeld?: QuestionXpHeld; record?: ChallengeScore | null }> {
  const result = await apiFetch<{ ok: true; awarded: boolean; score: number; xp?: number; xpHeld?: QuestionXpHeld; record?: ChallengeScore | null }>('/api/quiz/challenge?resource=complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  // An awarded run is a streak day.
  if (result.awarded) staleProfileStats();
  return result;
}
