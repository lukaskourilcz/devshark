/** Saved challenges, named collections, skip reasons and short practice
 * sessions. Mounted as `op=` branches on `api/user/[op].ts`, so the
 * twelve-function budget is unchanged.
 *
 * Saving requires the same plan and progression eligibility as opening a
 * challenge. Existing bookmarks may be removed after access changes. A skip
 * is feedback and unlocks nothing; practice queues never widen eligibility.
 *
 * Every write goes through a service-role routine (migration 027) so the limits
 * live in one place instead of being trusted from a request. */

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../vercel-types.js';
import { isRpcMissing, jsonError, createLogger, requireAuthSub, withTimeout } from '../http';
import { deploymentSubjectIds } from '../product-scope';
import { secureShuffle } from '../quiz-runtime';
import { resolveTier, serverContentIndex, refuseLocked } from '../access';
import { CODING_SUMMARIES, codingTaskById, isHiddenCodingTask, levelCodingTasks } from './active';
import { codingTaskForHistory } from './catalog';
import { javascriptLevelsCleared } from './handlers';
import { evolvingStage, evolvingUnlocked, evolvingPassed } from '../../shared/evolving';
import { codingContent, isOpenTo, type Tier } from '../../shared/tiers';
import { isCodingSectionTrack, isCodingTaskId, tierUnlocked, tierLockReason, type CodingTaskSummary } from '../../shared/coding-catalog';
import {
  isPracticeOrder,
  isPracticeSessionMinutes,
  isSkipReason,
  PRACTICE_MAX_COUNT,
  PRACTICE_SCHEDULE_HORIZON_DAYS,
  type CodingBookmarkRequest,
  type CodingBookmarksResponse,
  type CodingCollection,
  type CodingSkipRequest,
  type CodingSkipResponse,
  type PracticeOrder,
  type PracticeSession,
  type PracticeSessionAdvanceRequest,
  type PracticeSessionResponse,
  type PracticeSessionStartRequest,
} from '../../shared/coding-api';

const logEvent = createLogger('practice');

const available = () => deploymentSubjectIds().includes('webdev');
const notAvailable = (res: VercelResponse) =>
  jsonError(res, 404, 'not_available', 'Coding practice is not part of this product');
const migrationRequired = (res: VercelResponse, migration = '027') =>
  jsonError(res, 503, 'migration_required', `Practice migration ${migration} is not installed`);

/** Whether the learner's plan opens a task: Premium opens the catalogue, the
 * free plan its free set. A task already passed stays open for review on any
 * plan, as it does everywhere else. */
const planOpens = (tier: Tier, passed: ReadonlySet<string>, taskId: string): boolean =>
  passed.has(taskId) || isOpenTo(tier, codingContent(taskId), serverContentIndex());

/** Ids are opaque and generated here: a client never names a row. */
const newId = (): string => randomBytes(24).toString('base64url').slice(0, 32);

/** The tasks the section offers, in catalogue order. Retired tracks keep their
 * records but never come back as practice. */
const SECTION_TASKS: CodingTaskSummary[] = CODING_SUMMARIES.filter((task) => isCodingSectionTrack(task.track));

/** The task-opening gates also apply to new bookmarks and collection items. */
export function canSaveCodingTask(taskId: string, passed: ReadonlySet<string>, plan: Tier, cleared: number): boolean {
  const task = SECTION_TASKS.find((one) => one.id === taskId);
  if (!task) return false;
  if (!evolvingPassed(taskId, passed) && !isOpenTo(plan, codingContent(taskId), serverContentIndex())) return false;
  if (evolvingStage(taskId)) return evolvingUnlocked(taskId, passed);
  return !tierLockReason({ track: task.track, tier: task.tier, progress: { passed }, tasks: CODING_SUMMARIES, javascriptLevelsCleared: cleared });
}

async function refuseSavedLock(res: VercelResponse, supabase: SupabaseClient, userId: string, taskId: string): Promise<boolean> {
  try {
    const [rows, cleared, plan] = await Promise.all([
      withTimeout(supabase.from('coding_progress').select('task_id,status').eq('user_id', userId)),
      javascriptLevelsCleared(supabase, userId), resolveTier(userId),
    ]);
    if (rows.error) throw new Error('progress_unavailable');
    const passed = new Set((rows.data ?? []).filter((row) => row.status === 'passed').map((row) => String(row.task_id)));
    if (await refuseLocked(res, userId, codingContent(taskId), { cleared: async () => evolvingPassed(taskId, passed) })) return true;
    if (canSaveCodingTask(taskId, passed, plan, cleared)) return false;
    jsonError(res, 403, 'challenge_locked', 'Unlock this challenge before saving it');
  } catch {
    jsonError(res, 503, 'access_unavailable', 'Could not verify challenge access. Please try again');
  }
  return true;
}

/* ── saved challenges and collections ─────────────────────────────────── */

async function readBookmarks(supabase: SupabaseClient, userId: string): Promise<CodingBookmarksResponse | 'missing' | 'error'> {
  // The saved list and the collections are independent reads; only the
  // collections' items wait for the collection ids.
  const [saved, collections] = await Promise.all([
    withTimeout(supabase.from('coding_bookmarks').select('task_id').eq('user_id', userId).order('created_at', { ascending: false })),
    withTimeout(supabase.from('coding_collections').select('collection_id,name,position').eq('user_id', userId).order('position')),
  ]);
  if (saved.error) return isRpcMissing(saved.error) ? 'missing' : 'error';
  if (collections.error) return isRpcMissing(collections.error) ? 'missing' : 'error';
  const ids = (collections.data ?? []).map((row) => String(row.collection_id));
  const items = ids.length
    ? await withTimeout(
        supabase.from('coding_collection_items').select('collection_id,task_id,position').in('collection_id', ids).order('position'),
      )
    : { data: [], error: null };
  const byCollection = new Map<string, string[]>();
  if (items.error) return 'error';
  for (const row of (items.data ?? []) as { collection_id: string; task_id: string }[]) {
    const list = byCollection.get(row.collection_id) ?? [];
    list.push(String(row.task_id));
    byCollection.set(row.collection_id, list);
  }
  // A star saved on a hidden track (system design) stays in the table and
  // never comes back: nothing of that track is shown, not even its id.
  const shown = (id: string) => { const task = codingTaskForHistory(id); return !task || !isHiddenCodingTask(task); };
  return {
    saved: (saved.data ?? []).map((row) => String(row.task_id)).filter(shown),
    collections: (collections.data ?? []).map((row): CodingCollection => ({
      collectionId: String(row.collection_id),
      name: String(row.name),
      position: Number(row.position ?? 0),
      taskIds: (byCollection.get(String(row.collection_id)) ?? []).filter(shown),
    })),
  };
}

/** GET/PUT /api/user/[op]?op=coding-bookmarks */
export async function handleCodingBookmarks(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!available()) return notAvailable(res);
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  if (req.method === 'GET') {
    const body = await readBookmarks(supabase, userId);
    if (body === 'missing') return migrationRequired(res);
    if (body === 'error') return jsonError(res, 500, 'db_error', 'Could not load saved challenges');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(body);
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as Partial<CodingBookmarkRequest> & Record<string, unknown>;

    if (body.op === 'save') {
      const taskId = body.taskId;
      if (!isCodingTaskId(taskId) || (body.saved === true && !SECTION_TASKS.some((task) => task.id === taskId))) {
        return jsonError(res, 400, 'bad_request', 'Unknown challenge');
      }
      if (body.saved === true && await refuseSavedLock(res, supabase, userId, taskId)) return;
      const saved = await withTimeout(
        supabase.rpc('set_coding_bookmark', { p_user_id: userId, p_task_id: taskId, p_saved: body.saved === true }),
      );
      if (saved.error) {
        if (isRpcMissing(saved.error)) return migrationRequired(res);
        if (/bookmark_limit_reached/i.test(saved.error.message ?? '')) {
          return jsonError(res, 409, 'limit_reached', 'You have saved as many challenges as a list can hold');
        }
        return jsonError(res, 500, 'db_error', 'Could not save the challenge');
      }
    } else if (body.op === 'collection-upsert') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length === 0 || name.length > 60) {
        return jsonError(res, 400, 'bad_request', 'A collection needs a name of 1 to 60 characters');
      }
      const collectionId = typeof body.collectionId === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.collectionId)
        ? body.collectionId
        : newId();
      const position = Number.isInteger(body.position) ? Math.max(0, Math.min(999, Number(body.position))) : 0;
      const saved = await withTimeout(
        supabase.rpc('upsert_coding_collection', {
          p_collection_id: collectionId, p_user_id: userId, p_name: name, p_position: position,
        }),
      );
      if (saved.error) {
        if (isRpcMissing(saved.error)) return migrationRequired(res);
        if (/collection_limit_reached/i.test(saved.error.message ?? '')) {
          return jsonError(res, 409, 'limit_reached', 'You already have as many collections as an account can hold');
        }
        if (/collection_not_owned/i.test(saved.error.message ?? '')) {
          return jsonError(res, 403, 'forbidden', 'That collection belongs to another account');
        }
        if (/duplicate key/i.test(saved.error.message ?? '')) {
          return jsonError(res, 409, 'name_taken', 'You already have a collection with that name');
        }
        return jsonError(res, 500, 'db_error', 'Could not save the collection');
      }
    } else if (body.op === 'collection-delete') {
      if (typeof body.collectionId !== 'string') return jsonError(res, 400, 'bad_request', 'A collection is required');
      const removed = await withTimeout(
        supabase.rpc('delete_coding_collection', { p_collection_id: body.collectionId, p_user_id: userId }),
      );
      if (removed.error) {
        if (isRpcMissing(removed.error)) return migrationRequired(res);
        return jsonError(res, 500, 'db_error', 'Could not delete the collection');
      }
    } else if (body.op === 'collection-item') {
      const taskId = body.taskId;
      if (typeof body.collectionId !== 'string' || !isCodingTaskId(taskId)) {
        return jsonError(res, 400, 'bad_request', 'A collection and a challenge are required');
      }
      if (body.present === true && await refuseSavedLock(res, supabase, userId, taskId)) return;
      const changed = await withTimeout(
        supabase.rpc('set_coding_collection_item', {
          p_collection_id: body.collectionId, p_user_id: userId, p_task_id: taskId, p_present: body.present === true,
        }),
      );
      if (changed.error) {
        if (isRpcMissing(changed.error)) return migrationRequired(res);
        if (/collection_not_owned/i.test(changed.error.message ?? '')) {
          return jsonError(res, 403, 'forbidden', 'That collection belongs to another account');
        }
        if (/collection_item_limit_reached/i.test(changed.error.message ?? '')) {
          return jsonError(res, 409, 'limit_reached', 'That collection is full');
        }
        return jsonError(res, 500, 'db_error', 'Could not change the collection');
      }
    } else {
      return jsonError(res, 400, 'bad_request', 'Unknown operation');
    }

    const body2 = await readBookmarks(supabase, userId);
    if (body2 === 'missing') return migrationRequired(res);
    if (body2 === 'error') return jsonError(res, 500, 'db_error', 'Could not reload saved challenges');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.json(body2);
  }

  res.setHeader('Allow', 'GET, PUT');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

/* ── skips ────────────────────────────────────────────────────────────── */

/** The learner's passed tasks, for choosing what to offer next. Throws when
 * they cannot be read, as a timeout already did: an empty set would offer
 * every task the learner already passed as new work. */
async function passedTaskIds(supabase: SupabaseClient, userId: string): Promise<Set<string>> {
  const rows = await withTimeout(
    supabase.from('coding_progress').select('task_id,status').eq('user_id', userId).eq('status', 'passed'),
  );
  if (rows.error) throw new Error('progress_unavailable');
  return new Set((rows.data ?? []).map((row) => String(row.task_id)));
}

/** POST /api/user/[op]?op=coding-skip */
export async function handleCodingSkip(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!available()) return notAvailable(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  const body = (req.body || {}) as Partial<CodingSkipRequest>;
  if (!isCodingTaskId(body.taskId) || !isSkipReason(body.reason)) {
    return jsonError(res, 400, 'bad_request', 'A challenge and a reason are required');
  }
  const task = SECTION_TASKS.find((one) => one.id === body.taskId);
  if (!task) return jsonError(res, 400, 'bad_request', 'Unknown challenge');
  // coding_skips holds 280 characters (code points): cut by UTF-16 unit, an
  // emoji at the edge kept half of itself.
  const note = typeof body.note === 'string' ? Array.from(body.note.trim()).slice(0, 280).join('') : '';

  const recorded = await withTimeout(
    supabase.rpc('record_coding_skip', {
      p_user_id: userId, p_task_id: task.id, p_reason: body.reason, p_note: note || null, p_task_version: 1,
    }),
  );
  if (recorded.error) {
    if (isRpcMissing(recorded.error)) return migrationRequired(res);
    return jsonError(res, 500, 'db_error', 'Could not record the skip');
  }

  // Something else to do, from what the learner can already open. A skip never
  // opens anything: the tier gate is applied here exactly as it is everywhere,
  // the Learn levels that open JavaScript tier 3 included. A plan that cannot
  // be read suggests from the free set, which only narrows.
  const [passed, cleared, plan] = await Promise.all([
    // The skip is recorded; a suggestion read without the passed tasks is
    // still one the learner may open.
    passedTaskIds(supabase, userId).catch(() => new Set<string>()), javascriptLevelsCleared(supabase, userId).catch(() => 0), resolveTier(userId).catch((): Tier => 'free'),
  ]);
  const next = nextAfterSkip(task.id, passed, plan, cleared);

  logEvent({ status: 200, kind: 'skip_recorded', reason: body.reason });
  res.setHeader('Cache-Control', 'private, no-store');
  const answer: CodingSkipResponse = {
    recorded: true,
    next,
    required: skipPostpones(task.id),
  };
  return res.json(answer);
}

/** What to offer after a skip: the first task the learner can open that comes
 * after the skipped one in its track, wrapping round to the start, as Next
 * does after a pass. Searching from the top offered a task the learner had
 * already walked past (js-digit-sum after skipping js-count-multiples). */
export function nextAfterSkip(taskId: string, passed: ReadonlySet<string>, plan: Tier, javascriptLevelsCleared = 0): string | null {
  const task = SECTION_TASKS.find((one) => one.id === taskId);
  if (!task) return null;
  const track = SECTION_TASKS.filter((one) => one.track === task.track);
  const after = track.findIndex((one) => one.id === task.id) + 1;
  const next = [...track.slice(after), ...track.slice(0, after)].find((one) =>
    one.id !== task.id
    && !evolvingStage(one.id)
    && !passed.has(one.id)
    && tierUnlocked({ track: one.track, tier: one.tier, progress: { passed }, tasks: SECTION_TASKS, javascriptLevelsCleared })
    && planOpens(plan, passed, one.id),
  );
  return next?.id ?? null;
}

/** Whether a skip only postpones a task: a Learn level's coding phase needs
 * it, because it is one of the tasks that level issues (`levelCodingTasks`),
 * so it comes back. A task with a level number outside that quota is as
 * optional as any other section task. */
export function skipPostpones(taskId: string): boolean {
  const task = codingTaskById(taskId);
  return Boolean(task && task.level > 0 && !evolvingStage(task.id) && levelCodingTasks(task.topic, task.level).some((one) => one.id === task.id));
}

/* ── challenge runs (short practice sessions) ────────────────────────── */

/** The longest queue a run holds (027's practice_sessions checks the queue
 * length and the position against it). */
const PRACTICE_QUEUE_MAX = 40;

const estimatedMinutes = (ids: readonly string[]): number =>
  ids.reduce((total, id) => total + (SECTION_TASKS.find((task) => task.id === id)?.estimatedMinutes ?? 0), 0);

const toSession = (row: Record<string, unknown>): PracticeSession => {
  const queue = Array.isArray(row.queue) ? (row.queue as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  return {
    sessionId: String(row.session_id),
    minutes: Number(row.minutes),
    topic: row.topic == null ? null : String(row.topic),
    queue,
    position: Number(row.position ?? 0),
    status: row.status as PracticeSession['status'],
    estimatedMinutes: estimatedMinutes(queue),
    // Rows written before migration 037 carry none of these; they read as the
    // run they were: catalogue order, sized by minutes, started at once.
    order: isPracticeOrder(row.order_mode) ? row.order_mode : 'sequential',
    count: Number.isInteger(row.task_count) ? Number(row.task_count) : null,
    scheduledFor: typeof row.scheduled_for === 'string' ? row.scheduled_for : row.scheduled_for instanceof Date ? row.scheduled_for.toISOString() : null,
  };
};

/**
 * Build the queue for a run.
 *
 * Review comes first — work that is already due is the point of a short
 * session — then new work: in catalogue order, one challenge after the next,
 * or shuffled when the learner asked for that. Sized by a number of
 * challenges when `count` is given, otherwise by the minutes budget. Every
 * candidate has already passed both gates — the ladder's tiers, which the
 * cleared JavaScript Learn levels also open, and the learner's plan — so the
 * queue can only reorder what was available: a free account is never handed a
 * Premium challenge it would be refused mid-run.
 * The total is an estimate and the response says so.
 *
 * Pure apart from the shuffle, which is injected so the contracts can prove
 * a shuffled run is a permutation of the sequential one.
 */
export function buildQueue(input: {
  minutes: number;
  count?: number | null;
  order?: PracticeOrder;
  topic: string | null;
  /** The learner's plan, resolved once for the whole queue. */
  plan: Tier;
  passed: Set<string>;
  /** The learner's cleared JavaScript Learn levels, as the task page reads
   * them; enough of them open tier 3. */
  javascriptLevelsCleared?: number;
  due: Set<string>;
  shuffle?: <T>(list: T[]) => T[];
}): string[] {
  const eligible = SECTION_TASKS.filter((task) =>
    !evolvingStage(task.id) &&
    (!input.topic || task.track === input.topic)
    && tierUnlocked({
      track: task.track, tier: task.tier, progress: { passed: input.passed },
      tasks: SECTION_TASKS, javascriptLevelsCleared: input.javascriptLevelsCleared ?? 0,
    })
    && planOpens(input.plan, input.passed, task.id),
  );
  const review = eligible.filter((task) => input.due.has(task.id));
  const fresh = eligible.filter((task) => !input.due.has(task.id) && !input.passed.has(task.id));
  const ordered = input.order === 'random' ? (input.shuffle ?? secureShuffle)([...review, ...fresh]) : [...review, ...fresh];
  const queue: string[] = [];
  if (input.count) {
    for (const task of ordered) {
      if (queue.length >= Math.min(input.count, PRACTICE_MAX_COUNT)) break;
      queue.push(task.id);
    }
    return queue;
  }
  let budget = input.minutes;
  for (const task of ordered) {
    if (queue.length >= PRACTICE_QUEUE_MAX) break;
    // Always offer at least one task, even when it is longer than the session:
    // an empty queue helps nobody, and the estimate is labelled as an estimate.
    if (queue.length > 0 && task.estimatedMinutes > budget) continue;
    queue.push(task.id);
    budget -= task.estimatedMinutes;
    if (budget <= 0) break;
  }
  return queue;
}

/** The moment a run is planned for, or null for "now". A moment already past
 * is "now" too; one too far ahead, or not a time at all, is refused. */
export function parseScheduledFor(value: unknown, now = Date.now()): { at: Date | null } | { error: string } {
  if (value === undefined || value === null || value === '') return { at: null };
  if (typeof value !== 'string') return { error: 'scheduledFor must be an ISO timestamp' };
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { error: 'scheduledFor must be an ISO timestamp' };
  if (at.getTime() <= now + 60_000) return { at: null };
  if (at.getTime() > now + PRACTICE_SCHEDULE_HORIZON_DAYS * 86_400_000) {
    return { error: `A run can be planned up to ${PRACTICE_SCHEDULE_HORIZON_DAYS} days ahead` };
  }
  return { at };
}

/** The minutes column is the run's size in time. A run sized by count still
 * records its estimate, within the column's bounds. */
const minutesFor = (requested: number | null, queue: readonly string[]): number =>
  requested ?? Math.max(5, Math.min(60, estimatedMinutes(queue) || 5));

/** GET/POST/PUT /api/user/[op]?op=practice-session */
export async function handlePracticeSession(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient | null) {
  if (!available()) return notAvailable(res);
  const userId = await requireAuthSub(req, res);
  if (!userId) return;
  if (!supabase) return jsonError(res, 503, 'not_configured', 'Account storage is not configured');

  if (req.method === 'GET') {
    // The one open run: active, or planned for later. Migration 037 is what
    // makes `scheduled` a state; before it the filter simply matches nothing
    // extra.
    const row = await withTimeout(
      supabase.from('practice_sessions').select('*').eq('user_id', userId).in('status', ['active', 'scheduled'])
        .order('started_at', { ascending: false }).limit(1).maybeSingle(),
    );
    if (row.error) {
      if (isRpcMissing(row.error)) return migrationRequired(res);
      return jsonError(res, 500, 'db_error', 'Could not load your session');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const body: PracticeSessionResponse = { session: row.data ? toSession(row.data) : null };
    return res.json(body);
  }

  if (req.method === 'POST') {
    const body = (req.body || {}) as Partial<PracticeSessionStartRequest>;
    const count = Number.isInteger(body.count) && Number(body.count) >= 1 && Number(body.count) <= PRACTICE_MAX_COUNT ? Number(body.count) : null;
    if (body.count !== undefined && count === null) {
      return jsonError(res, 400, 'bad_request', `Ask for 1 to ${PRACTICE_MAX_COUNT} challenges`);
    }
    if (count === null && !isPracticeSessionMinutes(body.minutes)) {
      return jsonError(res, 400, 'bad_request', 'Choose one of the offered session lengths, or a number of challenges');
    }
    const minutes = isPracticeSessionMinutes(body.minutes) ? body.minutes : null;
    if (body.order !== undefined && !isPracticeOrder(body.order)) {
      return jsonError(res, 400, 'bad_request', 'A run is sequential or random');
    }
    const order: PracticeOrder = body.order ?? 'sequential';
    const when = parseScheduledFor(body.scheduledFor);
    if ('error' in when) return jsonError(res, 400, 'bad_request', when.error);
    const topic = typeof body.topic === 'string' && isCodingSectionTrack(body.topic) ? body.topic : null;

    // The plan, the passed tasks and the cleared Learn levels are read
    // together; none of them needs another.
    const [passed, cleared, plan] = await Promise.all([
      // Unread Learn levels count as none, which only narrows the run.
      passedTaskIds(supabase, userId).catch(() => null), javascriptLevelsCleared(supabase, userId).catch(() => 0), resolveTier(userId).catch(() => null),
    ]);
    if (passed === null) return jsonError(res, 503, 'progress_unavailable', 'Could not load your progress. Try again in a moment.');
    if (plan === null) return jsonError(res, 503, 'entitlement_unavailable', 'Could not check your plan. Try again in a moment.');
    const due = new Set<string>();

    const queue = buildQueue({ minutes: minutes ?? 0, count, order, topic, plan, passed, due, javascriptLevelsCleared: cleared });
    if (queue.length === 0) {
      return jsonError(res, 409, 'nothing_eligible', 'There is nothing eligible to practise right now');
    }
    const sessionId = newId();
    const storedMinutes = minutesFor(minutes, queue);
    const shaped = order !== 'sequential' || count !== null || when.at !== null;
    let status: PracticeSession['status'] = 'active';
    const started = await withTimeout(
      supabase.rpc('start_practice_session_v2', {
        p_session_id: sessionId, p_user_id: userId, p_subject: 'webdev',
        p_minutes: storedMinutes, p_topic: topic, p_queue: queue,
        p_order_mode: order, p_task_count: count, p_scheduled_for: when.at ? when.at.toISOString() : null,
      }),
    );
    if (started.error) {
      if (!isRpcMissing(started.error)) return jsonError(res, 500, 'db_error', 'Could not start the run');
      // Migration 037 is not installed. A plain session still works through
      // the 027 routine; a shaped or scheduled run cannot be honoured, and
      // saying so beats silently dropping the schedule.
      if (shaped) return migrationRequired(res, '037');
      const legacy = await withTimeout(
        supabase.rpc('start_practice_session', {
          p_session_id: sessionId, p_user_id: userId, p_subject: 'webdev',
          p_minutes: storedMinutes, p_topic: topic, p_queue: queue,
        }),
      );
      if (legacy.error) {
        if (isRpcMissing(legacy.error)) return migrationRequired(res);
        return jsonError(res, 500, 'db_error', 'Could not start the run');
      }
    } else if (started.data === 'scheduled') {
      status = 'scheduled';
    }
    logEvent({ status: 200, kind: status === 'scheduled' ? 'run_scheduled' : 'session_started', minutes: storedMinutes, size: queue.length, order, count: count ?? undefined });
    res.setHeader('Cache-Control', 'private, no-store');
    const answer: PracticeSessionResponse = {
      session: {
        sessionId, minutes: storedMinutes, topic, queue, position: 0, status,
        estimatedMinutes: estimatedMinutes(queue),
        order, count, scheduledFor: status === 'scheduled' && when.at ? when.at.toISOString() : null,
      },
    };
    return res.json(answer);
  }

  if (req.method === 'PUT') {
    const body = (req.body || {}) as Partial<PracticeSessionAdvanceRequest>;
    if (typeof body.sessionId !== 'string') return jsonError(res, 400, 'bad_request', 'A session is required');
    if (body.status !== undefined && body.status !== 'finished' && body.status !== 'abandoned' && body.status !== 'active') {
      return jsonError(res, 400, 'bad_request', 'A run starts as active, or ends as finished or abandoned');
    }
    const beginning = body.status === 'active';
    if (beginning) {
      const begun = await withTimeout(
        supabase.rpc('begin_scheduled_practice_session', { p_session_id: body.sessionId, p_user_id: userId }),
      );
      if (begun.error) {
        if (isRpcMissing(begun.error)) return migrationRequired(res, '037');
        return jsonError(res, 500, 'db_error', 'Could not start the run');
      }
      if (begun.data !== true) return jsonError(res, 409, 'not_scheduled', 'That run is not waiting to be started');
    }

    // Clamp before sending the place as a Postgres integer. Begin already
    // set the status, so only an explicit position needs another write.
    const position = Number.isInteger(body.position) ? Math.max(0, Math.min(PRACTICE_QUEUE_MAX, Number(body.position))) : null;
    if (!beginning || position !== null) {
      const moved = await withTimeout(
        supabase.rpc('advance_practice_session', {
          p_session_id: body.sessionId,
          p_user_id: userId,
          p_position: position,
          p_status: beginning ? null : body.status ?? null,
        }),
      );
      if (moved.error) {
        if (isRpcMissing(moved.error)) return migrationRequired(res);
        return jsonError(res, 500, 'db_error', 'Could not save your place');
      }
    }
    const row = await withTimeout(
      supabase.from('practice_sessions').select('*').eq('session_id', body.sessionId).eq('user_id', userId).maybeSingle(),
    );
    // A failed read is not "no run": answering null would tell the browser
    // the run it just moved does not exist.
    if (row.error) return jsonError(res, 500, 'db_error', 'Could not load your session');
    if (beginning) {
      if (row.data?.status !== 'active') return jsonError(res, 409, 'not_scheduled', 'That run is not waiting to be started');
      logEvent({ status: 200, kind: 'run_started' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const answer: PracticeSessionResponse = { session: row.data ? toSession(row.data) : null };
    return res.json(answer);
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}
