/** Pure spaced-mastery helpers shared by browser and server code.
 *
 * A Learn level is "cleared" the first time it is passed and only "mastered"
 * after being passed on {@link MASTERY_REQUIRED_DAYS} distinct UTC days. Between
 * clearing and mastering, a level becomes due for another pass on a spaced
 * schedule so the daily "Today" queue can resurface it. This module owns the
 * arithmetic only; storage lives in roadmap_progress and localized copy lives in
 * the client i18n tables. */

/** Distinct passing days needed to flip a level from cleared to mastered. */
const MASTERY_REQUIRED_DAYS = 3;

/** Days to wait before a cleared-but-unmastered level is due again, indexed by
 * how many distinct days it has already been passed (1st pass -> +1 day, 2nd
 * pass -> +3 days). A mastered level is never scheduled. */
const REVIEW_INTERVALS_DAYS = [1, 3] as const;

/** The per-level entry stored inside roadmap_progress.data[topic].levels[n]. The
 * mastery fields are optional so pre-migration-024 rows keep working. */
export interface LevelMasteryEntry {
  passed?: boolean;
  bestPct?: number;
  passDays?: string[];
  mastered?: boolean;
  masteredAt?: string;
  lastPassDay?: string;
}

export type MasteryState = 'notStarted' | 'cleared' | 'mastered';

/** UTC day key in the same 'YYYY-MM-DD' shape the SQL functions write. */
export function masteryDayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** Distinct days this level has been passed on. */
export function distinctPassDays(entry: LevelMasteryEntry | undefined): number {
  if (!entry) return 0;
  if (Array.isArray(entry.passDays)) {
    return new Set(entry.passDays.filter((d) => typeof d === 'string')).size;
  }
  // Pre-024 rows have no passDays; a latched pass counts as one day.
  return entry.passed ? 1 : 0;
}

export function isMastered(entry: LevelMasteryEntry | undefined): boolean {
  if (!entry) return false;
  return entry.mastered === true || distinctPassDays(entry) >= MASTERY_REQUIRED_DAYS;
}

export function masteryState(entry: LevelMasteryEntry | undefined): MasteryState {
  if (!entry || !entry.passed) return 'notStarted';
  return isMastered(entry) ? 'mastered' : 'cleared';
}

/** Add whole days to a 'YYYY-MM-DD' key, returning the same shape. */
function addDays(dayKey: string, days: number): string {
  const parsed = Date.parse(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(parsed)) return dayKey;
  return masteryDayKey(new Date(parsed + days * 86_400_000));
}

/** The day a cleared-but-unmastered level should next be practised, or null when
 * the level is mastered or has never been passed. */
function nextReviewDayKey(entry: LevelMasteryEntry | undefined): string | null {
  if (!entry || !entry.passed || isMastered(entry)) return null;
  const last = entry.lastPassDay
    ?? (Array.isArray(entry.passDays) ? entry.passDays[entry.passDays.length - 1] : undefined);
  if (!last) return null;
  const passes = distinctPassDays(entry);
  const interval = REVIEW_INTERVALS_DAYS[Math.min(passes, REVIEW_INTERVALS_DAYS.length) - 1]
    ?? REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1];
  return addDays(last, interval);
}

/** True when a cleared level is scheduled for another pass on/before `today`. */
export function isDueForReview(
  entry: LevelMasteryEntry | undefined,
  today: string = masteryDayKey(),
): boolean {
  const due = nextReviewDayKey(entry);
  return due !== null && today >= due;
}
