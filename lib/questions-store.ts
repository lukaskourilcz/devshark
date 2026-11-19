// Question overrides layer.
//
// The question bank lives in code (quiz-data.ts). The /dev admin console stores
// *overrides* in the `question_edits` table: an edited copy of a base question,
// a brand-new "custom" question, or a soft-delete. This module merges those
// overrides onto the static base so the live quiz reflects admin edits, while
// always falling back to the unmodified base set if the DB is unavailable.

import type { Question, CategoryType } from './quiz-data';
import { loadDeploymentQuestionBank, loadSubjectQuestionBank } from './question-bank-loader';
import { createServiceClient, withTimeout } from './http';
import { computeImportance, clampImportance } from './importance';
import { subjectForCategory, type ScopeSubjectId } from '../shared/subject-catalog';
import { questionEligibility } from './curation';
import type { Eligibility, LedgerDecision } from '../shared/curation';

const supabase = createServiceClient();

const TABLE = 'question_edits';
// Short cache so edits propagate within seconds without a DB round-trip on
// every quiz request. (Each serverless instance has its own cache, so this TTL
// is also how long an instance serves an override set before it reads again.)
const CACHE_TTL_MS = 15_000;
/* Past that age, and up to this one, a good override set is still served
 * while a newer one is read (#587, server item 19): the request that finds
 * it old no longer waits for the read, which on an instance taking traffic
 * was one request in every fifteen seconds. The next request is served the
 * newer set. A read that fails meanwhile keeps the good set rather than
 * dropping to the bare bank (which would serve hidden questions again), and
 * the next request reads again. An older set, or none, waits for the read as
 * before; a failure there serves the bank alone, as before. */
const STALE_SERVE_MS = 60_000;
/** The columns a `QuestionEditRow` reads. Rows written before devShark went
 * English only also carry cs_* text nothing reads, which `select('*')` sent
 * on every refresh. `importance` is migration 014's, which 044 requires. */
const OVERRIDE_COLUMNS = 'question_id,is_custom,deleted,question,options,correct_index,explanation,introduction,category,tags,difficulty,importance';

export const KNOWN_CATEGORIES: CategoryType[] = [
  'html', 'css', 'javascript', 'typescript', 'react',
  'nextjs', 'nodejs', 'git', 'dsa', 'algorithms',
  'abbreviations', 'general', 'ai',
  'dev-world', 'code-snippets',
];

/** A `question_edits` row as this module reads it. Rows written before
 * devShark went English only (#485) may also carry cs_* columns; nothing
 * reads them any more. */
export interface QuestionEditRow {
  question_id: string;
  is_custom: boolean;
  deleted: boolean;
  question: string | null;
  options: string[] | null;
  correct_index: number | null;
  explanation: string | null;
  introduction: string | null;
  category: string | null;
  tags: string[] | null;
  difficulty: number | null;
  /** Per-question importance override (1–10); null = use the hand-judged score. */
  importance?: number | null;
  updated_at?: string;
}

/** What the admin console is told about an item's review state: whether it
 * is served, why not, and the scores of the decision on record. The reason
 * is the same word the gate used, so an operator editing a devShark question
 * can see that the edit made it `superseded` and that it stays out of every
 * pool until a review of the new wording is recorded. */
export interface AdminReviewState {
  active: boolean;
  reason: Eligibility['reason'];
  decision?: LedgerDecision;
  retireReason?: string;
  relevance?: number;
  quality?: number;
  reviewedAt?: string;
  revision?: number;
}

/** A question as shown in the admin console: full content and origin. */
export interface AdminQuestion extends Question {
  source: 'base' | 'edited' | 'custom';
  deleted: boolean;
  review: AdminReviewState;
}

function adminReviewState(q: Question): AdminReviewState {
  const e = questionEligibility(q);
  return {
    active: e.active,
    reason: e.reason,
    ...(e.entry
      ? {
          decision: e.entry.decision,
          ...(e.entry.reason ? { retireReason: e.entry.reason } : {}),
          relevance: e.entry.relevance,
          quality: e.entry.quality,
          reviewedAt: e.entry.reviewedAt,
          revision: e.entry.revision,
        }
      : {}),
  };
}

/** Validated input accepted by saveQuestion(). */
export interface QuestionInput {
  id?: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  introduction: string;
  category: string;
  tags: string[];
  difficulty: number;
  /** Optional importance override (1–10). Omit to keep the hand-judged score. */
  importance?: number;
}

const clampDifficulty = (n: number): Question['difficulty'] => {
  const d = Math.round(n);
  return (d < 1 ? 1 : d > 5 ? 5 : d) as Question['difficulty'];
};

// Merge an override row onto its base question, or build a custom question
// when there is no base. A field the row leaves null keeps the base value.
function mergeRow(row: QuestionEditRow, base?: Question): Question {
  const merged: Question = {
    id: row.question_id,
    tags: row.tags ?? base?.tags ?? [],
    introduction: row.introduction ?? base?.introduction ?? '',
    question: row.question ?? base?.question ?? '',
    options: row.options ?? base?.options ?? [],
    correctAnswer: row.correct_index ?? base?.correctAnswer ?? 0,
    category: (row.category ?? base?.category ?? 'general') as CategoryType,
    explanation: row.explanation ?? base?.explanation ?? '',
    difficulty: clampDifficulty(row.difficulty ?? base?.difficulty ?? 1),
  };
  // A DB importance override wins; otherwise resolve from the hand-judged map.
  merged.importance = row.importance ?? computeImportance(merged);
  return merged;
}

/** Fresh source proof for the marketing integration. Serving caches and the
 * base-bank fallback cannot establish whether an operator hid or edited an item.
 * Refuse incomplete PostgREST results rather than silently losing overrides. */
export async function getFreshMarketingQuestions(): Promise<{ question: Question; deleted: boolean; updatedAt: string | null }[]> {
  if (!supabase || !process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY === process.env.SUPABASE_ANON_KEY) throw new Error('marketing_source_unavailable');
  const client = supabase;
  const read = async (): Promise<QuestionEditRow[]> => {
    const rows: QuestionEditRow[] = [];
    let total: number | null = null;
    for (let offset = 0; offset < 5000; offset += 500) {
      const { data, error, count } = await withTimeout(
        client.from(TABLE).select('*', { count: 'exact' }).order('question_id').range(offset, offset + 499), 5000,
      );
      if (error || !data || count === null || count > 5000 || (total !== null && total !== count)) throw new Error('marketing_source_unavailable');
      total = count;
      rows.push(...data as QuestionEditRow[]);
      if (rows.length === total) return rows;
      if (data.length !== 500 || rows.length > total) throw new Error('marketing_source_unavailable');
    }
    throw new Error('marketing_source_unavailable');
  };
  // PostgREST pages span requests. Verify a second complete observation so
  // concurrent edits/deletes cannot manufacture an apparently complete layer.
  const data = await withTimeout((async () => {
    const first = await read();
    const second = await read();
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('marketing_source_unavailable');
    return second;
  })(), 10000);
  const bank = await loadSubjectQuestionBank('webdev');
  return buildMarketingQuestionSnapshot(bank, data);
}

/** Includes safe history for tombstones, with the exact same merge as serving. */
export function buildMarketingQuestionSnapshot(base: Question[], rows: QuestionEditRow[]): { question: Question; deleted: boolean; updatedAt: string | null }[] {
  const overrides = new Map(rows.map((row) => [row.question_id, row]));
  const baseIds = new Set(base.map((q) => q.id));
  return [
    ...base.map((q) => {
      const row = overrides.get(q.id);
      return { question: row ? mergeRow(row, q) : withImportance(q), deleted: row?.deleted ?? false, updatedAt: row?.updated_at ?? null };
    }),
    ...rows.filter((row) => row.is_custom && !baseIds.has(row.question_id)).map((row) => ({
      question: mergeRow(row), deleted: row.deleted, updatedAt: row.updated_at ?? null,
    })),
  ];
}

/** Attach a resolved importance to a base question that has no override row. */
function withImportance(q: Question): Question {
  return q.importance != null ? q : { ...q, importance: computeImportance(q) };
}

let overrideCache: { at: number; value: Map<string, QuestionEditRow> | null } | null = null;
let overrideInflight: Promise<Map<string, QuestionEditRow> | null> | null = null;
/** Bumped by `invalidateQuestionsCache`: a read begun before an admin save
 * must not become the cached set after it. */
let overrideGeneration = 0;

/** `withTimeout` ends a live read at four seconds, so a read still unsettled
 * after this long was cut off by an instance frozen once its response went
 * out: the read the stale path below starts in the background, which no
 * response waits for. It is left behind. The next request starts a read of
 * its own instead of waiting for it, and its answer, read before the freeze
 * (or a failure on waking), never becomes the cached set. */
const READ_ABANDON_MS = 5_000;
let overrideInflightAt = 0;
/** The latest read started: an older one that settles later caches nothing. */
let overrideReadSeq = 0;

/** Read the override rows, one read at a time per instance. */
function refreshOverrides(): Promise<Map<string, QuestionEditRow> | null> {
  if (overrideInflight && Date.now() - overrideInflightAt < READ_ABANDON_MS) return overrideInflight;
  if (!supabase) return Promise.resolve(null);
  const client = supabase;
  const generation = overrideGeneration;
  const seq = ++overrideReadSeq;
  const startedAt = Date.now();
  const previous = overrideCache;
  const loading: Promise<Map<string, QuestionEditRow> | null> = (async () => {
    let value: Map<string, QuestionEditRow> | null;
    try {
      const { data, error } = await withTimeout(client.from(TABLE).select(OVERRIDE_COLUMNS), 4000);
      value = error || !data ? null : new Map((data as QuestionEditRow[]).map((r) => [r.question_id, r]));
    } catch {
      value = null;
    }
    // An admin save since it began, a newer read, or a freeze: the read
    // answers its own callers and caches nothing.
    if (generation !== overrideGeneration || seq !== overrideReadSeq || Date.now() - startedAt >= READ_ABANDON_MS) return value;
    if (!value && previous?.value && Date.now() - previous.at < STALE_SERVE_MS) return previous.value;
    overrideCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    if (overrideInflight === loading) overrideInflight = null;
  });
  overrideInflight = loading;
  overrideInflightAt = startedAt;
  return loading;
}

/** The override rows by id, or null when they cannot be read. `stale` lets a
 * serving read take a good set up to `STALE_SERVE_MS` old while a newer one
 * is read; without it the caller waits for anything older than the TTL. */
async function loadOverrides(stale = false): Promise<Map<string, QuestionEditRow> | null> {
  const cached = overrideCache;
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < CACHE_TTL_MS) return cached.value;
  if (stale && cached?.value && age < STALE_SERVE_MS) {
    void refreshOverrides();
    return cached.value;
  }
  return refreshOverrides();
}

function buildEffective(
  baseQuestions: Question[],
  overrides: Map<string, QuestionEditRow>,
  subject?: ScopeSubjectId,
): Question[] {
  const list: Question[] = [];
  for (const base of baseQuestions) {
    const ov = overrides.get(base.id);
    if (ov?.deleted) continue;
    list.push(ov ? mergeRow(ov, base) : withImportance(base));
  }
  for (const ov of overrides.values()) {
    if (ov.is_custom && !ov.deleted) {
      const merged = mergeRow(ov);
      if (!subject || subjectForCategory(merged.category) === subject) list.push(merged);
    }
  }
  return list;
}

type EffectiveCache = {
  at: number;
  /** The override set it was built from: rebuilt when that set changes. */
  source: Map<string, QuestionEditRow> | null;
  /** What may be served: the merged set with the eligibility gate applied. */
  list: Question[];
  byId: Map<string, Question>;
  /** The merged set before the gate, for history: an explanation for an
   * attempt made before an item was retired, an admin summary of a reported
   * question. Never a pool to select from. */
  historyById: Map<string, Question>;
  /** Merged items the gate removed, with the reason, for the admin view and
   * the coverage report. */
  withheld: Map<string, Eligibility['reason']>;
};
const caches = new Map<string, EffectiveCache>();

/**
 * The eligibility gate, applied once, here, to the merged set.
 *
 * Everything a learner can be served reads `list` or `byId`, so a retired,
 * quarantined, edited-since-review or never-reviewed devShark item is absent
 * from every selector at once: quiz, daily, challenge, placement, Learn levels
 * and checkpoints, personalised review, Play, flashcard creation, the coverage
 * count. Subjects outside the audit pass through unchanged.
 */
export function applyEligibility(merged: Question[]): { list: Question[]; withheld: Map<string, Eligibility['reason']> } {
  const list: Question[] = [];
  const withheld = new Map<string, Eligibility['reason']>();
  for (const q of merged) {
    const eligibility = questionEligibility(q);
    if (!eligibility.active) {
      withheld.set(q.id, eligibility.reason);
      continue;
    }
    list.push(q);
  }
  return { list, withheld };
}

async function effective(subject?: ScopeSubjectId): Promise<EffectiveCache> {
  const key = subject ?? 'deployment';
  // The bank (a module import on a cold instance, remembered after) and the
  // override rows (a database read, cached above) do not depend on each
  // other, so they load together.
  const [baseQuestions, overrides] = await Promise.all([
    subject ? loadSubjectQuestionBank(subject) : loadDeploymentQuestionBank(),
    loadOverrides(true),
  ]);
  // Built once per override set. The build below runs without a pause, so
  // callers that waited for the same set find the first one's build here.
  const cached = caches.get(key);
  if (cached && cached.source === overrides) return cached;
  const merged = overrides
    ? buildEffective(baseQuestions, overrides, subject)
    : baseQuestions.map(withImportance);
  const { list, withheld } = applyEligibility(merged);
  const value: EffectiveCache = {
    at: Date.now(),
    source: overrides,
    list,
    byId: new Map(list.map((q) => [q.id, q])),
    historyById: new Map(merged.map((q) => [q.id, q])),
    withheld,
  };
  caches.set(key, value);
  return value;
}

/** The live question set (base + overrides, eligibility applied), used by
 * every selector. */
export async function getEffectiveQuestions(subject?: ScopeSubjectId): Promise<Question[]> {
  return (await effective(subject)).list;
}

/** Same set as a lookup map, for grading and explanation lookups. An id the
 * map lacks is either unknown or no longer served; graders treat both the
 * same way — the answer is void, neither counted for nor against. */
export async function getEffectiveQuestionsById(subject?: ScopeSubjectId): Promise<Map<string, Question>> {
  return (await effective(subject)).byId;
}

/**
 * The merged set before the gate, by id. For reading history only: the
 * explanation of an item a learner answered before it was retired, the
 * summary of a reported question in the admin console. Nothing selects from
 * it, which is what keeps retirement from being deletion.
 */
export async function getQuestionsForHistoryById(subject?: ScopeSubjectId): Promise<Map<string, Question>> {
  return (await effective(subject)).historyById;
}

/** Ids the gate withheld from the served set, with the reason each was
 * withheld. For the admin view and the audit report. */
/** @public Fresh-module contract reader: scripts/test-verified-caller.ts checks withheld retired questions. */
export async function getWithheldQuestions(subject?: ScopeSubjectId): Promise<Map<string, Eligibility['reason']>> {
  return (await effective(subject)).withheld;
}

/**
 * Whether the override layer was readable the last time it was consulted.
 *
 * False means the served set is the static bank alone and there may be
 * operator-authored questions, edits or hides this process cannot see. Callers
 * that count what is deliverable have to treat that as unknown rather than as
 * zero — an uncountable source is the difference between a claim about the
 * whole bank and no claim at all.
 */
export function overridesAvailable(): boolean {
  if (!supabase) return true; // No override layer configured: the bank is all there is.
  return overrideCache != null && overrideCache.value != null;
}

/** Clear the serving cache so the next request re-reads overrides. */
export function invalidateQuestionsCache() {
  caches.clear();
  overrideCache = null;
  overrideInflight = null;
  overrideGeneration += 1;
}

/**
 * Full list for the admin console: every base question (with its override
 * applied and flagged) plus custom questions, including soft-deleted ones so
 * the admin can restore them. Always reads fresh (no serving cache).
 */
export async function listAdminQuestions(): Promise<AdminQuestion[]> {
  const baseQuestions = await loadDeploymentQuestionBank();
  const overrides = (await loadOverrides()) ?? new Map<string, QuestionEditRow>();
  const out: AdminQuestion[] = [];
  for (const base of baseQuestions) {
    const ov = overrides.get(base.id);
    if (ov) {
      const merged = mergeRow(ov, base);
      out.push({ ...merged, source: 'edited', deleted: ov.deleted, review: adminReviewState(merged) });
    } else {
      const item = withImportance(base);
      out.push({ ...item, source: 'base', deleted: false, review: adminReviewState(item) });
    }
  }
  for (const ov of overrides.values()) {
    if (ov.is_custom) {
      const merged = mergeRow(ov);
      out.push({ ...merged, source: 'custom', deleted: ov.deleted, review: adminReviewState(merged) });
    }
  }
  return out;
}

function rowFromInput(input: QuestionInput, id: string, isCustom: boolean): QuestionEditRow {
  return {
    question_id: id,
    is_custom: isCustom,
    deleted: false,
    question: input.question,
    options: input.options,
    correct_index: input.correctIndex,
    explanation: input.explanation,
    introduction: input.introduction,
    category: input.category,
    tags: input.tags,
    difficulty: clampDifficulty(input.difficulty),
  };
}

/** Insert or update an override. A missing id creates a new custom question. */
export async function saveQuestion(input: QuestionInput): Promise<{ id: string }> {
  if (!supabase) throw new Error('not_configured');
  const id = input.id || `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // No id at all, or a generated "dev-" id, means this has no base counterpart.
  const isCustom = !input.id || id.startsWith('dev-');
  const row = rowFromInput(input, id, isCustom);
  const { error } = await withTimeout(supabase.from(TABLE).upsert(row, { onConflict: 'question_id' }), 5000);
  if (error) throw new Error(error.message);

  // Persist the importance override separately and best-effort: the column was
  // added in schema-014, so if a deployment hasn't run that migration yet this
  // simply no-ops instead of breaking the whole save.
  if (typeof input.importance === 'number') {
    try {
      const { error: impErr } = await withTimeout(
        supabase.from(TABLE).update({ importance: clampImportance(input.importance) }).eq('question_id', id),
        5000,
      );
      if (impErr) log_importance_skip(impErr.message);
    } catch {
      /* timeout — ignore, importance is non-critical */
    }
  }

  invalidateQuestionsCache();
  return { id };
}

// Importance persistence is optional (pre-migration deployments lack the column).
// Keep a tiny breadcrumb without failing the save.
function log_importance_skip(_message: string): void {
  /* intentionally silent: best-effort column write */
}

/**
 * Soft-delete a base question (hidden from the quiz, restorable) or hard-delete
 * a custom one (gone for good).
 */
export async function setQuestionDeleted(id: string, deleted: boolean): Promise<void> {
  if (!supabase) throw new Error('not_configured');
  const isCustom = id.startsWith('dev-');
  if (isCustom && deleted) {
    const { error } = await withTimeout(supabase.from(TABLE).delete().eq('question_id', id), 5000);
    if (error) throw new Error(error.message);
  } else {
    // One upsert on the primary key: flip the flag on an existing override, or
    // create a minimal soft-delete marker (is_custom defaults to false). An
    // update followed by an insert lost the race when two deletes of the same
    // untouched question ran at once: the second insert hit 23505 and the
    // console answered 500. Only the flag is written, so an edit's content
    // and a custom row's is_custom stay as they are.
    const { error } = await withTimeout(
      supabase.from(TABLE).upsert(
        { question_id: id, deleted, updated_at: new Date().toISOString() },
        { onConflict: 'question_id' },
      ),
      5000,
    );
    if (error) throw new Error(error.message);
  }
  invalidateQuestionsCache();
}

/**
 * Soft-hide every (non-custom, currently visible) question whose resolved
 * importance is ≤ maxImportance — a one-click "remove the fillers" for the /dev
 * console. Returns how many were hidden. Hidden questions are restorable, and
 * the learning paths re-level automatically (they read the live set).
 */
export async function bulkHideByImportance(maxImportance: number): Promise<number> {
  if (!supabase) throw new Error('not_configured');
  const max = clampImportance(maxImportance);
  // getEffectiveQuestions already excludes hidden ones and carries importance.
  const visible = await getEffectiveQuestions();
  const targets = visible.filter((q) => !q.id.startsWith('dev-') && (q.importance ?? 10) <= max);
  if (targets.length === 0) return 0;

  // Upsert minimal soft-delete markers in chunks; onConflict leaves any existing
  // edit content intact and just flips `deleted` to true.
  const rows = targets.map((q) => ({ question_id: q.id, is_custom: false, deleted: true }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await withTimeout(
      supabase.from(TABLE).upsert(rows.slice(i, i + CHUNK), { onConflict: 'question_id' }),
      8000,
    );
    if (error) throw new Error(error.message);
  }
  invalidateQuestionsCache();
  return targets.length;
}

/** Drop the override row entirely, reverting a base question to its original. */
export async function resetQuestion(id: string): Promise<void> {
  if (!supabase) throw new Error('not_configured');
  const { error } = await withTimeout(supabase.from(TABLE).delete().eq('question_id', id), 5000);
  if (error) throw new Error(error.message);
  invalidateQuestionsCache();
}
