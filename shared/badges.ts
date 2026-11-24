/** Server-authoritative badge catalog shared by browser and server code.
 *
 * Eligibility is decided from already-verified stats (never from client claims),
 * so the API can recompute the earned set and persist it with a stable
 * earned_at. string labels/descriptions live in the client i18n tables under
 * `badge.<id>.label` / `badge.<id>.desc`; this module owns only ids, tiers, and
 * the threshold predicates. Purely-cosmetic client-only signals (a perfect quiz,
 * bookmarks) are layered on in the client and are intentionally not here. */

import type { CodingBadgeId } from './coding-catalog';

export interface BadgeStatsSummary {
  totalQuizzes: number;
  longestStreak: number;
  totalCorrect: number;
  totalQuestions: number;
  /** Distinct Learn levels the learner has mastered in this subject. */
  masteredLevels: number;
}

export type BadgeTier = 'bronze' | 'silver' | 'gold';

/** devShark coding badges. Eligibility comes from passed coding tasks (see
 * `eligibleCodingBadges` in coding-catalog); this list owns tier and glyph. */
export const CODING_BADGES: readonly { id: CodingBadgeId; tier: BadgeTier; glyph: string }[] = [
  { id: 'loop-shark', tier: 'bronze', glyph: '↻' },
  { id: 'method-shark', tier: 'bronze', glyph: '⊞' },
  { id: 'typed-shark', tier: 'silver', glyph: '◬' },
  { id: 'hooked-shark', tier: 'silver', glyph: '⊕' },
  { id: 'capstone-shark', tier: 'gold', glyph: '▣' },
];

interface BadgeDef {
  id: string;
  tier: BadgeTier;
  /** Glyph shown when earned; locked badges render a neutral outline. */
  glyph: string;
  eligible: (s: BadgeStatsSummary) => boolean;
}

const accuracy = (s: BadgeStatsSummary): number =>
  s.totalQuestions > 0 ? s.totalCorrect / s.totalQuestions : 0;

/** The server-verifiable badges, in display order (easiest goal first). */
const SERVER_BADGES: readonly BadgeDef[] = [
  { id: 'first-quiz', tier: 'bronze', glyph: '◔', eligible: (s) => s.totalQuizzes >= 1 },
  { id: 'ten-quizzes', tier: 'bronze', glyph: '◑', eligible: (s) => s.totalQuizzes >= 10 },
  { id: 'fifty-quizzes', tier: 'silver', glyph: '●', eligible: (s) => s.totalQuizzes >= 50 },
  { id: 'first-mastery', tier: 'bronze', glyph: '✦', eligible: (s) => s.masteredLevels >= 1 },
  { id: 'mastery-10', tier: 'silver', glyph: '✧', eligible: (s) => s.masteredLevels >= 10 },
  { id: 'mastery-50', tier: 'gold', glyph: '❖', eligible: (s) => s.masteredLevels >= 50 },
  { id: 'streak-3', tier: 'bronze', glyph: '▲', eligible: (s) => s.longestStreak >= 3 },
  { id: 'streak-7', tier: 'silver', glyph: '◆', eligible: (s) => s.longestStreak >= 7 },
  { id: 'streak-30', tier: 'gold', glyph: '★', eligible: (s) => s.longestStreak >= 30 },
  { id: 'avg-70', tier: 'silver', glyph: '◈', eligible: (s) => s.totalQuestions >= 20 && accuracy(s) >= 0.7 },
  { id: 'avg-90', tier: 'gold', glyph: '⬢', eligible: (s) => s.totalQuestions >= 100 && accuracy(s) >= 0.9 },
];

/** The subset of server badges the learner currently qualifies for. */
export function eligibleServerBadges(stats: BadgeStatsSummary): string[] {
  return SERVER_BADGES.filter((b) => b.eligible(stats)).map((b) => b.id);
}
