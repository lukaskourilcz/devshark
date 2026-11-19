// Biggest Shark Challenge leaderboard store.
//
// Persists finished runs to `challenge_scores`. Reads return a subject's top
// 10 plus a "champion" pointer used by the home-page badge. Falls back to an
// empty list if Supabase isn't configured or the table hasn't been migrated
// yet. Callers decide whether a read may degrade; writes never report success
// unless the row was actually persisted.

import { createServiceClient, withTimeout } from './http';
import { randomInt } from 'node:crypto';
import { generateSharkname } from '../shared/sharkname';
import type { ScopeSubjectId } from '../shared/subject-catalog';

const supabase = createServiceClient();

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

class ChallengeStoreError extends Error {}

/** save_completed_challenge_score (migration 064) refused the run: it was
 * already saved with another score, owner or topic set. Only a forged or
 * legacy run token gets here, and sending it again cannot succeed. */
export class ChallengeScoreConflictError extends ChallengeStoreError {}

const MAX_SCORE = 100_000;

function rowToScore(row: Record<string, unknown>): ChallengeScore {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    score: typeof row.score === 'number' ? row.score : Number(row.score) || 0,
    createdAt: String(row.created_at ?? ''),
    topics: Array.isArray(row.selected_topics) ? row.selected_topics.filter((topic): topic is string => typeof topic === 'string') : null,
    allTopics: typeof row.all_topics === 'boolean' ? row.all_topics : null,
  };
}

export async function getChallengeLeaderboard(subject: ScopeSubjectId, limit = 10): Promise<ChallengeLeaderboard> {
  if (!supabase) throw new ChallengeStoreError('Challenge storage is not configured');
  try {
    const result = await withTimeout(supabase.rpc('challenge_leaderboard', { p_subject: subject, p_limit: limit }), 4000);
    const { data, error } = result;
    if (error || !Array.isArray(data)) throw new ChallengeStoreError(error?.message || 'Could not load leaderboard');
    const top = data.map(rowToScore);
    return { top, champion: top[0] ?? null };
  } catch (error) {
    if (error instanceof ChallengeStoreError) throw error;
    throw new ChallengeStoreError(error instanceof Error ? error.message : 'Could not load leaderboard');
  }
}

export async function recordChallengeScore(input: {
  score: number; runId: string; subject: ScopeSubjectId; userId?: string | null;
  topics?: string[] | null; allTopics?: boolean | null;
}): Promise<ChallengeScore | null> {
  if (!Number.isInteger(input.score) || input.score <= 0) return null;
  if (!supabase) throw new ChallengeStoreError('Challenge storage is not configured');
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await withTimeout(supabase.rpc('save_completed_challenge_score', {
      p_run_id: input.runId, p_subject: input.subject, p_user_id: input.userId ?? null,
      p_score: Math.min(input.score, MAX_SCORE),
      p_base: generateSharkname(() => randomInt(1_000_000) / 1_000_000),
      p_topics: input.topics ?? null, p_all_topics: input.allTopics ?? null,
    }), 5000);
    if (result.error?.message?.includes('handle_taken')) continue;
    if (result.error?.message?.includes('challenge_score_conflict')) throw new ChallengeScoreConflictError(result.error.message);
    if (result.error || !result.data) throw new ChallengeStoreError(result.error?.message || 'Could not save score');
    return rowToScore(result.data as Record<string, unknown>);
  }
  throw new ChallengeStoreError('Could not assign a sharkname');
}
