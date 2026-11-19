/** When a concept comes back, and what counts as having recalled it.
 *
 * The scheduling half of practice. It answers one question — which concepts are
 * due — and deliberately answers nothing about the order they are practised in;
 * that is `shared/interleave.ts`, and keeping the two apart is what makes both
 * testable.
 *
 * Three things this file is careful about:
 *
 * **What counts as recall.** Answering after a hint, after seeing the solution,
 * or by ordering shuffled lines is evidence of something, but it is not
 * evidence of independent retrieval. Only `independent` lengthens an interval.
 * Immediate correctness after seeing an answer is the thing spaced practice
 * exists to see through, so treating it as a success would quietly defeat the
 * feature.
 *
 * **The intervals are a starting policy, not a discovery.** Spaced retrieval
 * has strong general support; the specific hours below are ours, bounded, and
 * versioned so a later change is a new policy rather than a silent
 * reinterpretation of what learners already earned. Nothing in the product
 * presents them as optimal.
 *
 * **Missing a day is information, not debt.** Overdue concepts sort first and
 * the queue is capped, so returning after three weeks gives a normal session
 * rather than a backlog. Nothing is revoked for being late: a level a learner
 * passed stays passed. */

export const SCHEDULING_POLICY_VERSION = 1;

/* ── what happened when the learner answered ───────────────────────────── */

/** How an answer was arrived at. The distinction is the whole design. */
export const RETRIEVAL_KINDS = [
  /** Answered from memory, no hint shown, no solution revealed. */
  'independent',
  /** A hint was open. Still useful practice; not evidence of recall. */
  'hinted',
  /** The answer or solution had been shown before the attempt was recorded. */
  'revealed',
  /** Ordered shuffled lines, or another recognition-shaped task. Evidence of
   * reading, which is not the same competency as producing. */
  'assisted',
] as const;
export type RetrievalKind = (typeof RETRIEVAL_KINDS)[number];


/** Only one kind advances a concept. */
const advancesInterval = (kind: RetrievalKind): boolean => kind === 'independent';

/* ── the interval ladder ───────────────────────────────────────────────── */

/**
 * Hours until the next review, by stage. Bounded at both ends: nothing comes
 * back inside a few hours (which would be the same sitting) and nothing is
 * pushed past a month (after which "did you keep it" stops being a useful
 * question and starts being a trap).
 *
 * Configurable rather than fixed: a deployment can supply its own ladder, and
 * the policy version is what says which one produced a given due date.
 */
export const DEFAULT_INTERVAL_HOURS: readonly number[] = [8, 24, 72, 168, 336, 720];

/** The shorter follow-up after a failed recall. Short enough to close the gap
 * while the explanation is still fresh, long enough not to be the same sitting. */
export const RELEARN_HOURS = 4;

export interface ReviewState {
  conceptId: string;
  /** 0..(ladder.length - 1). Higher means longer intervals. */
  stage: number;
  /** ISO timestamp, or null for a concept that is not scheduled. */
  dueAt: string | null;
  /** Consecutive independent successes. Only used for reporting. */
  streak: number;
  /** The item version last used, so the next review can prefer a different
   * item testing the same objective. */
  lastItemId: string | null;
}

export interface AttemptOutcome {
  conceptId: string;
  correct: boolean;
  kind: RetrievalKind;
  itemId: string;
}

/**
 * The next state for one concept. Pure, with the clock injected.
 *
 * Correct and independent climbs a rung. Correct but hinted, revealed or
 * assisted holds the rung: it was practice, and the interval it earned was
 * already earned. Wrong drops to the bottom and comes back soon, whatever the
 * kind — a wrong answer with a hint open is still a wrong answer.
 */
export function nextReviewState(
  current: ReviewState | null,
  outcome: AttemptOutcome,
  now: number,
  ladder: readonly number[] = DEFAULT_INTERVAL_HOURS,
): ReviewState {
  const hours = ladder.length > 0 ? ladder : DEFAULT_INTERVAL_HOURS;
  const stage = Math.min(Math.max(current?.stage ?? 0, 0), hours.length - 1);
  const streak = current?.streak ?? 0;

  if (!outcome.correct) {
    return {
      conceptId: outcome.conceptId,
      stage: 0,
      dueAt: new Date(now + RELEARN_HOURS * 3600_000).toISOString(),
      streak: 0,
      lastItemId: outcome.itemId,
    };
  }

  const nextStage = advancesInterval(outcome.kind) ? Math.min(stage + 1, hours.length - 1) : stage;
  return {
    conceptId: outcome.conceptId,
    stage: nextStage,
    dueAt: new Date(now + hours[nextStage] * 3600_000).toISOString(),
    streak: advancesInterval(outcome.kind) ? streak + 1 : streak,
    lastItemId: outcome.itemId,
  };
}

/* ── which concepts are due ────────────────────────────────────────────── */

export interface DueConcept {
  conceptId: string;
  /** Hours past due; 0 for something due right now. */
  overdueHours: number;
  stage: number;
  lastItemId: string | null;
}

/**
 * The concepts a learner owes, most overdue first, capped.
 *
 * `eligible` is the caller's business: it is the same server-side eligibility
 * and plan filter used everywhere else, passed in rather than re-derived, so
 * review can never resurrect a locked topic or a retired one.
 *
 * The cap is what keeps a long absence from producing a punishing queue. What
 * falls outside it is not lost — it is still overdue tomorrow, and it sorts
 * first when it does.
 */
export function dueConcepts(
  states: readonly ReviewState[],
  eligible: (conceptId: string) => boolean,
  now: number,
  cap = 12,
): DueConcept[] {
  const due: DueConcept[] = [];
  for (const state of states) {
    if (!state.dueAt || !eligible(state.conceptId)) continue;
    const at = Date.parse(state.dueAt);
    if (!Number.isFinite(at) || at > now) continue;
    due.push({
      conceptId: state.conceptId,
      overdueHours: Math.floor((now - at) / 3600_000),
      stage: state.stage,
      lastItemId: state.lastItemId,
    });
  }
  return due
    .sort(
      (a, b) =>
        b.overdueHours - a.overdueHours ||
        a.stage - b.stage ||
        a.conceptId.localeCompare(b.conceptId),
    )
    .slice(0, Math.max(0, cap));
}

/** How many items a session should hold for the time a learner said they have.
 * Deliberately small: a session someone finishes is worth more than one they
 * abandon. */
export function sessionSize(minutes: number | null | undefined): number {
  if (!minutes || minutes <= 0) return 8;
  return Math.max(4, Math.min(20, Math.round(minutes / 1.5)));
}

/** Roughly how long a session of `count` items takes, in minutes. Used to tell
 * the learner what they are agreeing to before they start. */
export const estimatedMinutes = (count: number): number => Math.max(1, Math.round(count * 1.5));
