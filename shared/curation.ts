/** What "reviewed" is allowed to mean, and who is allowed to say it.
 *
 * Two gates decide whether an item stays in the active pool. Modern relevance
 * is scored across five markers, 0-2 each, out of ten; below four it leaves.
 * Quality is scored out of five across correctness, clarity, the answer
 * choices, the hint and the explanation; below three it leaves. Both must
 * pass, and passing one says nothing about the other — a question can be
 * perfectly current and still have two defensible answers.
 *
 * The harder half of this file is the part that stops the product claiming
 * more than it can show. Every learner-facing statement about review is
 * derived from a record for the *exact published version* of an item, and
 * every derivation here fails closed:
 *
 *   * No record, or a record for a different version, is not "reviewed".
 *     An edit invalidates the approval it was given, because the thing that
 *     was approved no longer exists.
 *   * "Reviewed more than once" needs more than one recorded human review.
 *     Automated validation and coding execution checks are recorded, and
 *     shown, as what they are.
 *   * A claim about the whole bank needs coverage of every source a learner
 *     can be served from. One uncountable source — a database override, a
 *     fallback pool — makes the bank-wide claim unavailable, not approximate.
 *   * A metadata failure means saying nothing, never falling back to a
 *     friendlier default.
 *
 * Nothing in the public shape carries an answer key, a hidden test, a
 * reviewer's identity or the text of an internal report. */

/* ── the two gates ─────────────────────────────────────────────────────── */

/** The five markers modern relevance is scored across, 0-2 each. The learner-
 * facing wording for these lives with the UI copy; the ids are the contract. */
export const RELEVANCE_MARKERS = [
  /** Valid current practice, or an enduring foundation. */
  'present-day-applicability',
  /** Helps with real engineering work. */
  'practical-utility',
  /** Teaches something that applies again elsewhere. */
  'transferable-understanding',
  /** Matches the intended learner and their prerequisites. */
  'audience-and-level-fit',
  /** Helps prevent a failure or improve an outcome. */
  'risk-or-outcome-value',
] as const;
export type RelevanceMarker = (typeof RELEVANCE_MARKERS)[number];

export const MARKER_MAX = 2;
export const RELEVANCE_MAX = RELEVANCE_MARKERS.length * MARKER_MAX; // 10
/** Below this an item leaves the active pool. */
export const RELEVANCE_MIN = 4;

/** What the quality score is scored on. One point each. */
const QUALITY_CRITERIA = [
  'correctness',
  'clarity',
  'answer-choices',
  'hint',
  'explanation',
] as const;
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];

export const QUALITY_MAX = QUALITY_CRITERIA.length; // 5
/** Below this an item leaves the active pool. */
export const QUALITY_MIN = 3;

const passesRelevance = (score: number): boolean => score >= RELEVANCE_MIN;
const passesQuality = (score: number): boolean => score >= QUALITY_MIN;
/** Both gates, never one standing in for the other. */
export const passesBothGates = (relevance: number, quality: number): boolean =>
  passesRelevance(relevance) && passesQuality(quality);

/* ── what a review event actually was ──────────────────────────────────── */

/** Four different things, never collapsed into one word.
 *
 * `human` is a person applying the criteria. `model` is an AI model applying
 * the same criteria item by item, with its executable checks run and its
 * sources cited — the content audit of #176 was performed this way, and it is
 * recorded as what it was, because "a person read it" is a different claim.
 * `automated` is a check a script can make — a contract test, a link check,
 * the content audit script. For a coding task, `execution` is the solution
 * proven against the grader, which is evidence that the task is solvable as
 * specified and is not evidence that it has no defects. */
/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const REVIEW_EVENT_KINDS = ['human', 'model', 'automated', 'execution'] as const;
export type ReviewEventKind = (typeof REVIEW_EVENT_KINDS)[number];

export interface ReviewEvent {
  kind: ReviewEventKind;
  /** ISO date. Not a timestamp: the day is what is shown and the hour is not
   * anyone's business. */
  at: string;
  /** For automated and execution events, which check ran. Never a person's
   * name — reviewer identity is not public metadata. */
  check?: string;
}

/** One decision about one exact version of one item. */
export interface ReviewRecord {
  itemId: string;
  /** The version this decision was made about. A record whose version does not
   * match what is being served is a record about something else. */
  version: string;
  /** 0-10, scored across the five markers. */
  relevance: number;
  /** 0-5, scored across the five quality criteria. */
  quality: number;
  events: ReviewEvent[];
}

/* ── the ledger: what one audit decision records ───────────────────────── */

/** The disposition a review reaches. `retain` and `rewrite` are the two that
 * keep an item live (a rewrite is re-scored on its corrected version before it
 * returns); `retire` and `quarantine` remove it from every active pool the
 * moment the decision is recorded. */
/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const LEDGER_DECISIONS = ['retain', 'rewrite', 'retire', 'quarantine'] as const;
export type LedgerDecision = (typeof LEDGER_DECISIONS)[number];
export const isLedgerDecision = (value: unknown): value is LedgerDecision =>
  typeof value === 'string' && (LEDGER_DECISIONS as readonly string[]).includes(value);

/** The five modern-relevance markers, 0-2 each, summed into `relevance`. */
export interface RelevanceMarkers {
  presentDay: number;
  practicalUtility: number;
  transferable: number;
  audienceFit: number;
  riskOutcome: number;
}
/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const RELEVANCE_MARKER_KEYS = ['presentDay', 'practicalUtility', 'transferable', 'audienceFit', 'riskOutcome'] as const;

/** The seven quality dimensions, 1-5 each. The final quality score is their
 * minimum, never their average, so one serious weakness cannot hide. */
export interface QualityDimensions {
  topicRelevance: number;
  learningValue: number;
  technicalCorrectness: number;
  wording: number;
  answerOptions: number;
  hint: number;
  explanation: number;
}
/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const QUALITY_DIMENSION_KEYS = ['topicRelevance', 'learningValue', 'technicalCorrectness', 'wording', 'answerOptions', 'hint', 'explanation'] as const;

/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const relevanceTotal = (markers: RelevanceMarkers): number =>
  RELEVANCE_MARKER_KEYS.reduce((sum, key) => sum + markers[key], 0);
/** @public Authoring API documented in .claude/skills/learn-question-authoring/references/ledger-row.md. */
export const qualityFloor = (dimensions: QualityDimensions): number =>
  Math.min(...QUALITY_DIMENSION_KEYS.map((key) => dimensions[key]));

/** One row of the review registry: the compact, runtime-loaded projection of a
 * ledger entry. It names the exact content the decision was made about (by
 * plain hash, checked against the served item on every request) and carries
 * the scores the admin view shows. Nothing here is served to a learner
 * directly; `publicItemReview` derives what may cross the wire. */
export interface RegistryEntry {
  id: string;
  kind: 'question' | 'coding-task';
  /** Plain digest of the reviewed content. A served item with a different
   * digest was edited after this decision and the decision no longer applies. */
  hash: string;
  relevance: number;
  quality: number;
  markers: RelevanceMarkers;
  dimensions: QualityDimensions;
  decision: LedgerDecision;
  /** Why an item left, in a few words. Present for retire and quarantine. */
  reason?: string;
  /** ISO date of the decision. */
  reviewedAt: string;
  /** 1 for the version first reviewed; incremented by each recorded rewrite. */
  revision: number;
}

/** A registry row is internally consistent when its totals are what its
 * markers and dimensions add up to. A row that fails this is a data error and
 * is treated as no record at all — never as an approval. */
export function registryEntryConsistent(entry: RegistryEntry): boolean {
  return (
    RELEVANCE_MARKER_KEYS.every((key) => Number.isInteger(entry.markers[key]) && entry.markers[key] >= 0 && entry.markers[key] <= MARKER_MAX) &&
    QUALITY_DIMENSION_KEYS.every((key) => Number.isInteger(entry.dimensions[key]) && entry.dimensions[key] >= 1 && entry.dimensions[key] <= QUALITY_MAX) &&
    relevanceTotal(entry.markers) === entry.relevance &&
    qualityFloor(entry.dimensions) === entry.quality &&
    isLedgerDecision(entry.decision)
  );
}

/* ── eligibility: may this exact content be served? ────────────────────── */

export type EligibilityReason =
  /** Nothing on record applies to this content and its category is outside
   * the audited scope: served as before, with no claim. */
  | 'not-in-scope'
  /** Current record, both gates pass, decision keeps it live. */
  | 'reviewed'
  /** No record at all. */
  | 'unreviewed'
  /** A record exists for a different version of the content. */
  | 'superseded'
  /** The recorded decision retired it. */
  | 'retired'
  /** Correctness could not be verified; held pending evidence. */
  | 'quarantined'
  /** The record's own scores fail a gate, whatever its decision says. */
  | 'failed-gate'
  /** The record is internally inconsistent and is ignored. */
  | 'invalid-record';

export interface Eligibility {
  active: boolean;
  reason: EligibilityReason;
  entry: RegistryEntry | null;
}

/**
 * The one rule every delivery surface applies, pure so that the contract
 * suite can run it against every boundary: relevance 3 retires, 4 alone does
 * not, 4 with quality 2 still retires, relevance 10 with a wrong key (quality
 * capped at 2) still retires, and an item nobody has reviewed is not served.
 *
 * A recorded decision about exactly this content is enforced wherever the
 * item lives: a retirement withholds it and a passing review serves it
 * whether or not its category is in the audited
 * scope. The scope decides only what happens to content nobody has recorded a
 * decision about — no record, a record for other wording, a broken record:
 * inside the scope that content is withheld until it is reviewed; outside it
 * is served as before, with no claim. That is what lets a wave land its rows
 * for a category before the category is complete, without either withholding
 * the items it has not reached or serving the ones it retired.
 */
export function eligibilityFrom(
  entry: RegistryEntry | null | undefined,
  contentHash: string,
  inScope: boolean,
): Eligibility {
  const unrecorded = (reason: 'unreviewed' | 'invalid-record' | 'superseded', record: RegistryEntry | null): Eligibility =>
    inScope
      ? { active: false, reason, entry: record }
      : { active: true, reason: 'not-in-scope', entry: null };
  if (!entry) return unrecorded('unreviewed', null);
  if (!registryEntryConsistent(entry)) return unrecorded('invalid-record', entry);
  if (entry.hash !== contentHash) return unrecorded('superseded', entry);
  if (entry.decision === 'retire') return { active: false, reason: 'retired', entry };
  if (entry.decision === 'quarantine') return { active: false, reason: 'quarantined', entry };
  if (!passesBothGates(entry.relevance, entry.quality)) return { active: false, reason: 'failed-gate', entry };
  return { active: true, reason: 'reviewed', entry };
}

/* ── status, derived and failing closed ────────────────────────────────── */

export type ReviewStatus =
  /** A record exists for exactly this version and both gates pass. */
  | 'reviewed'
  /** A record exists for this item but for an earlier version: the item was
   * edited after it was approved, so the approval no longer applies. */
  | 'superseded'
  /** No record for this item at all. Not a defect and not a badge — most of
   * the bank is here until the audit reaches it. */
  | 'unreviewed'
  /** The metadata could not be read. Say nothing rather than guessing. */
  | 'unavailable';

export function reviewStatusFor(
  record: ReviewRecord | null | undefined,
  version: string | null | undefined,
): ReviewStatus {
  if (record === undefined) return 'unavailable';
  if (!record || !version) return 'unreviewed';
  if (record.version !== version) return 'superseded';
  // A record that fails a gate should not be being served at all; if one is,
  // it is certainly not something to describe as reviewed.
  if (!passesBothGates(record.relevance, record.quality)) return 'superseded';
  return 'reviewed';
}

const countEvents = (record: ReviewRecord | null | undefined, kind: ReviewEventKind): number =>
  record ? record.events.filter((event) => event.kind === kind).length : 0;

/** The most recent human review date, or null. Used for "reviewed on", which
 * is a claim about a person having looked, not about a script having run. */
function lastHumanReviewAt(record: ReviewRecord | null | undefined): string | null {
  return lastReviewAt(record, 'human');
}

function lastReviewAt(record: ReviewRecord | null | undefined, kind: ReviewEventKind): string | null {
  const dates = (record?.events ?? []).filter((e) => e.kind === kind).map((e) => e.at).sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

/** Everything about review that may cross the wire, and nothing else. */
export interface PublicItemReview {
  /** Opaque, stable while the content is unchanged. Quoted in a report so a
   * fix can be matched to the exact wording the learner saw. */
  version: string;
  status: ReviewStatus;
  /** Present only when status is 'reviewed'. */
  reviewedAt?: string;
  /** Present only when status is 'reviewed'. Counted, never rounded up. */
  humanReviews?: number;
  /** Present only when status is 'reviewed': item-level reviews performed by
   * an AI model against the published criteria. A different claim from a
   * person having read it, and labelled as one. */
  modelReviews?: number;
  /** Machine evidence, which exists independently of anyone having read the
   * item — a contract suite passing is a fact whether or not a reviewer has
   * looked. Carried whatever the status, so an item nobody has read can still
   * say truthfully what a script proved about it. */
  automatedChecks?: number;
  executionChecks?: number;
  relevance?: number;
  quality?: number;
}

export function publicItemReview(
  record: ReviewRecord | null | undefined,
  version: string,
  /** Machine evidence recorded outside the review record — a solution executed
   * against its grader, a contract that iterates every item. */
  evidence: readonly ReviewEvent[] = [],
): PublicItemReview {
  const status = reviewStatusFor(record, version);
  const automated =
    countEvents(record, 'automated') + evidence.filter((e) => e.kind === 'automated').length;
  const execution =
    countEvents(record, 'execution') + evidence.filter((e) => e.kind === 'execution').length;
  const machine = {
    ...(automated > 0 ? { automatedChecks: automated } : {}),
    ...(execution > 0 ? { executionChecks: execution } : {}),
  };
  if (status !== 'reviewed' || !record) return { version, status, ...machine };
  const reviewedAt = lastHumanReviewAt(record) ?? lastReviewAt(record, 'model');
  return {
    version,
    status,
    ...(reviewedAt ? { reviewedAt } : {}),
    humanReviews: countEvents(record, 'human'),
    modelReviews: countEvents(record, 'model'),
    ...machine,
    relevance: record.relevance,
    quality: record.quality,
  };
}

/** Which sentence about this item is supportable.
 *
 * `reviewed-once` and `reviewed-repeatedly` are different claims and the
 * second needs the evidence for it. `checked-automatically` is what is left
 * when scripts have run and nobody has read it — worth saying, and not the
 * same word. */
export type ItemClaim =
  | 'reviewed-repeatedly'
  | 'reviewed-once'
  /** Reviewed item by item by an AI model against the criteria, with the
   * executable checks run; not yet read by a person. Never upgraded to either
   * sentence above. */
  | 'reviewed-by-model'
  | 'checked-automatically'
  | 'not-yet-reviewed'
  | 'none';

export function itemClaim(review: PublicItemReview | null | undefined): ItemClaim {
  if (!review || review.status === 'unavailable') return 'none';
  // Human review outranks model review, which outranks machine evidence, and
  // only a current record counts: 'superseded' is deliberately
  // indistinguishable from 'unreviewed' to the learner, because in both cases
  // nobody has approved what is on their screen.
  if (review.status === 'reviewed') {
    if ((review.humanReviews ?? 0) > 1) return 'reviewed-repeatedly';
    if ((review.humanReviews ?? 0) === 1) return 'reviewed-once';
    if ((review.modelReviews ?? 0) > 0) return 'reviewed-by-model';
  }
  if ((review.automatedChecks ?? 0) + (review.executionChecks ?? 0) > 0) {
    return 'checked-automatically';
  }
  return 'not-yet-reviewed';
}

/* ── coverage, and the claim it does or does not license ───────────────── */

/** One place a learner can be served an item from. */
export interface CoverageSource {
  id: string;
  /** How many deliverable items this source holds, or null when the source
   * cannot be counted from here (a database table, an operator override).
   * Null is the whole point: it is what makes a bank-wide claim impossible. */
  items: number | null;
  /** How many of them have a current review record. Null when unknown. */
  reviewed: number | null;
}

export interface CoverageReport {
  sources: CoverageSource[];
  /** Summed over the countable sources only. */
  items: number;
  reviewed: number;
  /** True when every source could be counted. */
  countable: boolean;
}

export function summarizeCoverage(sources: CoverageSource[]): CoverageReport {
  let items = 0;
  let reviewed = 0;
  let countable = true;
  for (const source of sources) {
    if (source.items === null || source.reviewed === null) countable = false;
    items += source.items ?? 0;
    reviewed += source.reviewed ?? 0;
  }
  return { sources, items, reviewed, countable };
}

/** Which of the three bank-wide sentences may be published.
 *
 *   'complete' — every deliverable source counted, every item reviewed.
 *   'partial'  — real numbers to quote, and a review still in progress.
 *   'none'     — nothing reviewed yet, or a source that cannot be counted.
 *                Either way there is no coverage claim to make, only the
 *                criteria themselves.
 */
export type CoverageClaim = 'complete' | 'partial' | 'none';

export function coverageClaim(report: CoverageReport): CoverageClaim {
  if (!report.countable) return 'none';
  if (report.items <= 0) return 'none';
  if (report.reviewed >= report.items) return 'complete';
  if (report.reviewed <= 0) return 'none';
  return 'partial';
}
