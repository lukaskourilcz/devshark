// Client-side roadmap ("Learn") helpers: fetch the level/checkpoint map and
// playable questions from the API, track per-level and per-checkpoint progress
// in localStorage, and (when signed in) sync that progress to the user's account.

import { ApiError, apiFetch } from './api';
import type { LearnLessonResponse } from '../../../shared/learning-path-api';
import { accountEpoch } from './accountData';
import { staleProfileStats } from './queryClient';
import { readJSON, readString, writeJSON } from './storage';
import { createStore, useStore } from './store';
import { getSubject } from './subjects';
import { assessmentUnlocks, ASSESSMENT_QUESTION_COUNT } from '../../../shared/assessment';
import {
  STARTER_TOPICS as SHARED_STARTER_TOPICS,
  TOPIC_PREREQS as SHARED_TOPIC_PREREQS,
  LEVELS_TO_UNLOCK_NEXT as SHARED_LEVELS_TO_UNLOCK_NEXT,
  PARTS_PER_TOPIC as SHARED_PARTS_PER_TOPIC,
  partSizes as sharedPartSizes,
  partRanges as sharedPartRanges,
  isLevelUnlocked as sharedIsLevelUnlocked,
  isCheckpointUnlocked as sharedIsCheckpointUnlocked,
  isSegmentCleared as sharedIsSegmentCleared,
  isTopicUnlocked as sharedIsTopicUnlocked,
  passedLevelCount as sharedPassedLevelCount,
  type PartRange as SharedPartRange,
  type StepAvailability,
} from '../../../shared/progression';
import type {
  RoadmapAnswerResult,
  RoadmapCompletionResult,
  RoadmapStructure,
  RoadmapTopicStructure,
  RoadmapPlayable,
  RoadmapTopic,
} from '../types/quiz';

export type { StepAvailability };

/**
 * What the unlock rules need to know about a topic beyond the learner's
 * record, read from the level map the server sent: how long the topic is and
 * which of its steps cannot be opened. With no map yet (still loading, or
 * offline) the rules fall back to the authored segments, which is the preview
 * the product has always drawn and never grants access — the server decides
 * every time it is asked.
 */
export function availabilityOf(structure: RoadmapTopicStructure | undefined): StepAvailability {
  if (!structure) return {};
  return {
    levelCount: structure.levels.length,
    unavailableLevels: new Set(structure.levels.filter((level) => level.unavailable).map((level) => level.level)),
    unavailableCheckpoints: new Set(structure.unavailableParts ?? []),
  };
}

// Pass thresholds (must match lib/roadmap.ts on the server).
export const LEVEL_PASS = 75;
export const CHECKPOINT_PASS = 85;
export const LEVELS_PER_CHECKPOINT = 5;
export const ROADMAP_LEVELS = 25;
export const CHECKPOINT_COUNT = ROADMAP_LEVELS / LEVELS_PER_CHECKPOINT;

/* ──── Topic gating ────────────────────────────────────────────────────────
 * Brand-new learners shouldn't be confronted with 20 paths at once. Only the
 * three "starter" paths are available out of the box; the rest unlock as the
 * learner progresses, or all at once via the skill-check assessment.
 *
 * A topic unlocks when:
 *   (a) it is a starter, or
 *   (b) every prereq topic has cleared its first checkpoint (5 levels passed), or
 *   (c) the skill-check assessment has explicitly unlocked it.
 *
 * Prereqs are intentionally a shallow graph so the path from zero → hero stays
 * obvious: master JS basics, then HTML+CSS for React, then specialise.
 */
// The graph itself lives in shared/progression.ts, because the server enforces
// the same rules when it decides whether to serve a level at all. Re-exported
// here under the client's topic type so every existing caller keeps working.
export const STARTER_TOPICS = SHARED_STARTER_TOPICS as readonly RoadmapTopic[];
export const LEVELS_TO_UNLOCK_NEXT = SHARED_LEVELS_TO_UNLOCK_NEXT;
export const TOPIC_PREREQS = SHARED_TOPIC_PREREQS as Record<RoadmapTopic, readonly RoadmapTopic[]>;

/** Topics granted by an assessment scoring `correct` out of `total`. */
export function topicsFromAssessment(correct: number): RoadmapTopic[] {
  return assessmentUnlocks(getSubject(), correct, ASSESSMENT_QUESTION_COUNT) as RoadmapTopic[];
}

export { ASSESSMENT_QUESTION_COUNT };

const PROGRESS_KEY = 'devquiz:roadmap:v2';
const UNLOCKS_KEY = 'devquiz:roadmap:unlocks:v1';
// Progress lives on the same function as the rest of the roadmap (to stay within
// Vercel's Hobby 12-function limit). The server writes it itself, on each
// completion; the browser only reads it.
const PROGRESS_GET = '/api/quiz/roadmap?resource=progress';

export interface Entry {
  /** Latches true once passed. */
  passed: boolean;
  /** Best score (percent). */
  bestPct: number;
}
export interface TopicProgress {
  levels: Record<string, Entry>;
  checkpoints: Record<string, Entry>;
}
export type RoadmapProgress = Partial<Record<RoadmapTopic, TopicProgress>>;

/* ──── API ──────────────────────────────────────────────────────────────── */

export function fetchRoadmapStructure(signal?: AbortSignal): Promise<RoadmapStructure> {
  return apiFetch<RoadmapStructure>('/api/quiz/roadmap', { signal });
}

export function fetchLearnLesson(id: string, signal?: AbortSignal): Promise<LearnLessonResponse> {
  return apiFetch<LearnLessonResponse>(`/api/quiz/roadmap?${new URLSearchParams({ resource: 'lesson', id })}`, { signal });
}

export function fetchRoadmapLevel(topic: RoadmapTopic, level: number, signal?: AbortSignal): Promise<RoadmapPlayable> {
  const params = new URLSearchParams({ topic, level: String(level) });
  return apiFetch<RoadmapPlayable>(`/api/quiz/roadmap?${params}`, { signal });
}

export function fetchRoadmapCheckpoint(topic: RoadmapTopic, checkpoint: number, signal?: AbortSignal): Promise<RoadmapPlayable> {
  const params = new URLSearchParams({ topic, checkpoint: String(checkpoint) });
  return apiFetch<RoadmapPlayable>(`/api/quiz/roadmap?${params}`, { signal });
}

export function submitRoadmapAnswer(
  sessionId: string,
  questionId: string,
  selectedIndex: number,
): Promise<RoadmapAnswerResult> {
  return apiFetch<RoadmapAnswerResult>('/api/quiz/roadmap?resource=answer', {
    method: 'POST',
    body: JSON.stringify({ sessionId, questionId, selectedIndex }),
  });
}

// Counts the account records completions have written, so a progress sync
// whose GET left before one of them does not write its older read over it.
let completionWrites = 0;

export async function completeRoadmapAttempt(sessionId: string): Promise<RoadmapCompletionResult> {
  const epoch = accountEpoch();
  const result = await apiFetch<RoadmapCompletionResult>('/api/quiz/roadmap?resource=complete', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  // The account changed while the completion was out (a sign-out, or another
  // account's sign-in): the record it carries belongs to the account that
  // left, so nothing is written here. The level says the sign-in changed, as
  // it does when the server refuses a request sent after the change.
  if (accountEpoch() !== epoch) {
    throw new ApiError('Your sign-in changed during this level.', 409, 'session_owner_mismatch');
  }
  if (result.progress) {
    writeProgress(result.progress);
    completionWrites += 1;
  }
  // A finished level or part test is a streak day, passed or not.
  if (result.applied) staleProfileStats();
  return result;
}

export function checkRoadmapAttempt(sessionId: string): Promise<{ completed: boolean; coding: { taskId: string; passed: boolean; revealed: boolean }[] }> {
  return apiFetch('/api/quiz/roadmap?resource=attempt-status', { method: 'POST', body: JSON.stringify({ sessionId }) });
}

export function applySkillCheckReceipt(resultReceipt: string): Promise<{ applied: boolean; unlocked: RoadmapTopic[] }> {
  return apiFetch('/api/quiz/roadmap?resource=skill-check', {
    method: 'POST',
    body: JSON.stringify({ resultReceipt }),
  });
}

/* ──── Progress store (localStorage-backed) ─────────────────────────────── */

// This device's copies are read as what they should be, not trusted: a value
// of another shape (an older build's, or one edited by hand) reads as empty
// rather than taking the Learn page down with it.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTopicId = (id: unknown): id is RoadmapTopic =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(TOPIC_PREREQS, id);

const readProgress = (): RoadmapProgress => {
  const stored = readJSON<unknown>(PROGRESS_KEY, {});
  return isRecord(stored) ? stored as RoadmapProgress : {};
};

const store = createStore<RoadmapProgress>(readProgress);

/** Live view of roadmap progress; re-renders subscribers when it changes. */
export function useRoadmapProgress(): RoadmapProgress {
  return useStore(store);
}

/** Imperative snapshot of the current roadmap progress (for XP computations). */
export function getRoadmapProgress(): RoadmapProgress {
  return readProgress();
}

function writeProgress(p: RoadmapProgress): void {
  writeJSON(PROGRESS_KEY, p);
  store.emit();
}

function topicOf(p: RoadmapProgress, topic: RoadmapTopic): TopicProgress {
  const t = p[topic];
  return { levels: { ...(t?.levels ?? {}) }, checkpoints: { ...(t?.checkpoints ?? {}) } };
}

function record(kind: 'levels' | 'checkpoints', topic: RoadmapTopic, ref: number, pct: number, passPct: number): void {
  const p = readProgress();
  const tp = topicOf(p, topic);
  const map = tp[kind];
  const prev = map[String(ref)];
  // Keep what else the entry holds: a signed-in completion has just written
  // the server's record here, spaced-mastery days included, and dropping them
  // would read a mastered level as cleared and today's pass as not done.
  map[String(ref)] = {
    ...prev,
    passed: (prev?.passed ?? false) || pct >= passPct,
    bestPct: Math.max(prev?.bestPct ?? 0, pct),
  };
  writeProgress({ ...p, [topic]: tp });
}

export const recordLevelResult = (topic: RoadmapTopic, level: number, pct: number, passPct = LEVEL_PASS) =>
  record('levels', topic, level, pct, passPct);

export const recordCheckpointResult = (topic: RoadmapTopic, checkpoint: number, pct: number, passPct = CHECKPOINT_PASS) =>
  record('checkpoints', topic, checkpoint, pct, passPct);

/* ──── Derived helpers (unlock / pass / progress) ───────────────────────── */

export const isLevelPassed = (p: RoadmapProgress, topic: RoadmapTopic, level: number): boolean =>
  p[topic]?.levels?.[String(level)]?.passed ?? false;

export const levelBestPct = (p: RoadmapProgress, topic: RoadmapTopic, level: number): number =>
  p[topic]?.levels?.[String(level)]?.bestPct ?? 0;

export const isCheckpointPassed = (p: RoadmapProgress, topic: RoadmapTopic, checkpoint: number): boolean =>
  p[topic]?.checkpoints?.[String(checkpoint)]?.passed ?? false;

export const checkpointBestPct = (p: RoadmapProgress, topic: RoadmapTopic, checkpoint: number): number =>
  p[topic]?.checkpoints?.[String(checkpoint)]?.bestPct ?? 0;

// Level 1 is always open. The first level of a new part unlocks only when the
// preceding part's test is passed; otherwise a level unlocks when the nearest
// available level before it is passed. Pass the topic's availability from the
// fetched map so the rule uses the real part boundaries.
export function isLevelUnlocked(p: RoadmapProgress, topic: RoadmapTopic, level: number, availability: StepAvailability = {}): boolean {
  return sharedIsLevelUnlocked(p, topic, level, availability);
}

// A part test (checkpoint) unlocks once the last available level of its part
// is passed (which, by the sequential gating above, means all of them are).
export function isCheckpointUnlocked(p: RoadmapProgress, topic: RoadmapTopic, checkpoint: number, availability: StepAvailability = {}): boolean {
  return sharedIsCheckpointUnlocked(p, topic, checkpoint, availability);
}

export function passedLevelCount(p: RoadmapProgress, topic: RoadmapTopic): number {
  return sharedPassedLevelCount(p, topic);
}

/* ──── Topic unlock state ───────────────────────────────────────────────── */

// Extra-unlocked topics live in their own localStorage entry so resetting
// roadmap progress doesn't accidentally relock skill-check rewards.
const readExtraUnlocks = (): RoadmapTopic[] => {
  const stored = readJSON<unknown>(UNLOCKS_KEY, []);
  return Array.isArray(stored) ? stored.filter(isTopicId) : [];
};

const writeExtraUnlocks = (next: RoadmapTopic[]): void => {
  writeJSON(UNLOCKS_KEY, next);
  unlocksStore.emit();
};

const unlocksStore = createStore<RoadmapTopic[]>(readExtraUnlocks);

/** Live view of the topics unlocked by the skill-check assessment. */
export function useExtraUnlocks(): RoadmapTopic[] {
  return useStore(unlocksStore);
}

/** Imperative snapshot of skill-check-unlocked topics. */
export function getExtraUnlocks(): RoadmapTopic[] {
  return readExtraUnlocks();
}

/** Merge `topics` into the extra-unlocks set. Returns the topics that were new. */
export function unlockExtraTopics(topics: RoadmapTopic[]): RoadmapTopic[] {
  const current = new Set(readExtraUnlocks());
  const added: RoadmapTopic[] = [];
  for (const t of topics) {
    if (!current.has(t)) {
      current.add(t);
      added.push(t);
    }
  }
  if (added.length > 0) writeExtraUnlocks(Array.from(current));
  return added;
}

/** True if every prereq of `topic` has cleared its first checkpoint. */


/**
 * Whether the learner can open `topic`'s path. Starters are always unlocked;
 * other topics unlock once their prereqs are cleared OR they were granted by
 * the skill-check assessment.
 */
export function isTopicUnlocked(
  p: RoadmapProgress,
  topic: RoadmapTopic,
  extra: RoadmapTopic[] | Set<RoadmapTopic> = [],
): boolean {
  return sharedIsTopicUnlocked(p, topic, extra instanceof Set ? extra : new Set(extra));
}

/** Human-readable reason a topic is locked (e.g. "Pass JavaScript level 5"). */
export function topicUnlockHint(
  p: RoadmapProgress,
  topic: RoadmapTopic,
  topicLabel: (t: RoadmapTopic) => string,
): string {
  const reqs = TOPIC_PREREQS[topic] ?? [];
  const unmet = reqs.filter((req) => passedLevelCount(p, req) < LEVELS_TO_UNLOCK_NEXT);
  if (unmet.length === 0) return '';
  return unmet
    .map((req) => `${topicLabel(req)} · ${passedLevelCount(p, req)}/${LEVELS_TO_UNLOCK_NEXT}`)
    .join(' · ');
}

/* ──── Parts ("learning paths" split) ───────────────────────────────────────
 * Each topic is shown as PARTS_PER_TOPIC shorter, sequential paths instead of
 * one long ladder — every part ends with its own test. A part is a contiguous
 * slice of the topic's GLOBAL levels, derived from the (live) level count so the
 * split stays in sync with the server. Per-part progress reuses the existing
 * per-topic maps: level passes stay keyed by their global level number, and a
 * part test is stored in the topic's `checkpoints` map keyed by the part number
 * (1..PARTS_PER_TOPIC). For the common 15-level topics the part ranges line up
 * exactly with the old 5-level checkpoints, so existing progress carries over.
 * ─────────────────────────────────────────────────────────────────────────── */

// The split lives in shared/progression.ts, where the server's unlock rules
// read it too; re-exported so every existing caller keeps working.
export const PARTS_PER_TOPIC = SHARED_PARTS_PER_TOPIC;
export const PART_TEST_PASS = CHECKPOINT_PASS;
export const partSizes = sharedPartSizes;
export const partRanges = sharedPartRanges;
export type PartRange = SharedPartRange;

/** Build a path id ("javascript-2") and parse it back, family ids may contain '-'. */
export const makePathId = (family: RoadmapTopic, part: number): string => `${family}-${part}`;
export function parsePathId(id: string): { family: RoadmapTopic; part: number } | null {
  const idx = id.lastIndexOf('-');
  if (idx <= 0) return null;
  const family = id.slice(0, idx) as RoadmapTopic;
  const part = parseInt(id.slice(idx + 1), 10);
  if (!Number.isInteger(part) || part < 1 || part > PARTS_PER_TOPIC) return null;
  if (!(Object.keys(TOPIC_PREREQS) as string[]).includes(family)) return null;
  return { family, part };
}

export const fetchRoadmapPartTest = (family: RoadmapTopic, part: number, signal?: AbortSignal): Promise<RoadmapPlayable> => {
  const params = new URLSearchParams({ topic: family, test: String(part) });
  return apiFetch<RoadmapPlayable>(`/api/quiz/roadmap?${params}`, { signal });
};

/* part-test results live in the topic's checkpoints map, keyed by part number */
export const recordPartTestResult = (family: RoadmapTopic, part: number, pct: number, passPct = PART_TEST_PASS) =>
  record('checkpoints', family, part, pct, passPct);
export const isPartTestPassed = (p: RoadmapProgress, family: RoadmapTopic, part: number): boolean =>
  p[family]?.checkpoints?.[String(part)]?.passed ?? false;
export const partTestBestPct = (p: RoadmapProgress, family: RoadmapTopic, part: number): number =>
  p[family]?.checkpoints?.[String(part)]?.bestPct ?? 0;

/** Levels passed within a part's global range. */
export function partPassedLevels(p: RoadmapProgress, family: RoadmapTopic, range: PartRange): number {
  let n = 0;
  for (let l = range.startLevel; l <= range.endLevel; l++) if (isLevelPassed(p, family, l)) n++;
  return n;
}

/**
 * A global level within an open part: the same shared rule the server
 * applies, given the topic's availability. The part is already known to be
 * open (see `isPathUnlocked`), so the rule's own "previous part cleared"
 * check agrees with the part selector rather than repeating it.
 */
export function isPartLevelUnlocked(
  p: RoadmapProgress,
  family: RoadmapTopic,
  range: PartRange,
  globalLevel: number,
  availability: StepAvailability = { levelCount: range.endLevel },
): boolean {
  return sharedIsLevelUnlocked(p, family, globalLevel, availability);
}

/** A part's test unlocks once every available level in the part is passed. */
export function isPartTestUnlocked(
  p: RoadmapProgress,
  family: RoadmapTopic,
  range: PartRange,
  availability: StepAvailability = { levelCount: range.endLevel },
): boolean {
  if (range.size <= 0) return false;
  return sharedIsCheckpointUnlocked(p, family, range.part, availability);
}

/**
 * Whether a path (part) is open: its family must be unlocked, and either it's
 * the first part or the previous part is cleared — its test passed, or, when
 * that test has nothing left to examine, its levels done.
 */
export function isPathUnlocked(
  p: RoadmapProgress,
  family: RoadmapTopic,
  part: number,
  extra: RoadmapTopic[] | Set<RoadmapTopic> = [],
  availability: StepAvailability = {},
): boolean {
  if (!isTopicUnlocked(p, family, extra)) return false;
  if (part <= 1) return true;
  return sharedIsSegmentCleared(p, family, part - 1, availability);
}

export type PathStatus = 'locked' | 'available' | 'in-progress' | 'complete';

/** Coarse state of a single path (part) for the tree + part selector. */
export function pathStatus(
  p: RoadmapProgress,
  family: RoadmapTopic,
  ranges: PartRange[],
  part: number,
  extra: RoadmapTopic[] | Set<RoadmapTopic> = [],
  availability: StepAvailability = {},
): PathStatus {
  const range = ranges[part - 1];
  if (!range || !isPathUnlocked(p, family, part, extra, availability)) return 'locked';
  if (sharedIsSegmentCleared(p, family, part, availability)) return 'complete';
  return partPassedLevels(p, family, range) > 0 ? 'in-progress' : 'available';
}

/** The part a learner should land on: the first unlocked, not-yet-complete part. */
export function currentPart(
  p: RoadmapProgress,
  family: RoadmapTopic,
  ranges: PartRange[],
  extra: RoadmapTopic[] | Set<RoadmapTopic> = [],
  availability: StepAvailability = {},
): number {
  let lastUnlocked = 1;
  for (let part = 1; part <= ranges.length; part++) {
    if (!isPathUnlocked(p, family, part, extra, availability)) break;
    lastUnlocked = part;
    if (!sharedIsSegmentCleared(p, family, part, availability)) return part;
  }
  return lastUnlocked;
}

/* ──── Account sync ─────────────────────────────────────────────────────── */

function mergeMaps(a: Record<string, Entry> = {}, b: Record<string, Entry> = {}): Record<string, Entry> {
  const out: Record<string, Entry> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = prev
      ? { passed: prev.passed || v.passed, bestPct: Math.max(prev.bestPct, v.bestPct) }
      : v;
  }
  return out;
}

/** Combine two progress blobs: passed latches true, bestPct takes the max. */
export function mergeProgress(a: RoadmapProgress, b: RoadmapProgress): RoadmapProgress {
  const out: RoadmapProgress = {};
  const topics = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<RoadmapTopic>;
  for (const topic of topics) {
    out[topic] = {
      levels: mergeMaps(a[topic]?.levels, b[topic]?.levels),
      checkpoints: mergeMaps(a[topic]?.checkpoints, b[topic]?.checkpoints),
    };
  }
  return out;
}

/** Shape of what tokens.ts + shop.ts contribute to the account-synced blob:
 *  one wallet + one inventory PER SUBJECT (platform), keyed by subject id. */
interface SyncedInventory {
  owned: string[];
  ring: string | null;
  flair: string | null;
  doubleXp: number;
}

// On sign-in: pull the account's progress + per-subject wallets/inventories,
// merge each with whatever is on this device (progress and unlocks: the
// account's, as the server holds them; balances: per-subject max — tokens can
// only grow; owned items: per-subject union; equipped items: server wins if
// valid, otherwise local; retired doubleXp data is cleared) and store the
// result locally. Nothing is sent back. A legacy account blob (one
// pre-split wallet/inventory, no per-subject maps) is attributed to the
// active subject — the same rule the local stores use when migrating.
//
// Sign-in, Today and the maps all ask for this; one request answers the ones
// that ask while it is in flight, for the same account. A sync still in flight
// when the account signs out answers for nobody: it writes nothing (see
// accountEpoch), and the next account's first ask starts its own.
//
// A sync that answered less than PROGRESS_SYNC_FRESH_MS ago, for the same
// account and with no level completed since, answers the next ask too (perf
// baseline #587 C08 and C22). The sign-in sync in App, Today's and the map's
// all asked within a second of each other on a first Learn visit, and every
// client-side return to a map asked again; each read costs an Auth getUser,
// two Upstash calls and a roadmap_progress read. Within this tab every change
// the server makes to the record comes back in the answer that made it (a
// completion writes its record, completionWrites below), so only a change
// made in another tab or device can wait, for at most the window. A device
// copy that is no longer the one the sync left (another tab wrote it, or it
// was cleared) is read again at once.
export const PROGRESS_SYNC_FRESH_MS = 60_000;
let syncInFlight: { epoch: number; done: Promise<void> } | null = null;
let lastSynced: { epoch: number; writes: number; at: number; copy: string } | null = null;
const deviceCopy = (): string => `${readString(PROGRESS_KEY)}\n${readString(UNLOCKS_KEY)}`;
const syncedRecently = (epoch: number): boolean =>
  lastSynced !== null
  && lastSynced.epoch === epoch
  && lastSynced.writes === completionWrites
  && Date.now() - lastSynced.at < PROGRESS_SYNC_FRESH_MS
  && lastSynced.copy === deviceCopy();
export function syncProgressWithServer(): Promise<void> {
  const epoch = accountEpoch();
  if (syncInFlight?.epoch !== epoch) {
    if (syncedRecently(epoch)) return Promise.resolve();
    const entry = { epoch, done: syncOnce(epoch).finally(() => { if (syncInFlight === entry) syncInFlight = null; }) };
    syncInFlight = entry;
  }
  return syncInFlight.done;
}

async function syncOnce(epoch: number): Promise<void> {
  interface ServerInventory {
    owned?: string[];
    ring?: string | null;
    flair?: string | null;
    doubleXp?: number;
  }
  interface ServerExtras {
    unlocked?: string[];
    wallet?: { balance?: number };
    inventory?: ServerInventory;
    wallets?: Record<string, { balance?: number }>;
    inventories?: Record<string, ServerInventory>;
  }
  let serverProgress: RoadmapProgress = {};
  let serverExtras: ServerExtras = {};
  const writesBefore = completionWrites;
  try {
    const res = await apiFetch<{ data: RoadmapProgress; extra?: ServerExtras }>(PROGRESS_GET);
    serverProgress = res.data ?? {};
    serverExtras = res.extra ?? {};
  } catch {
    return; // not signed in or offline — keep local only
  }
  // The account signed out while this was in flight: its progress, unlocks
  // and balances are no longer this browser's to hold.
  if (accountEpoch() !== epoch) return;
  // Signed-in progress is server-authoritative. Legacy server rows are retained
  // by migration; unverified browser-only values cannot unlock account XP.
  // A completion that answered while this GET was out wrote a newer read of
  // the same record, which this one must not replace.
  if (completionWrites === writesBefore) writeProgress(serverProgress);

  // Unlocks are the server's too. A guest's skill-check unlocks, or ones this
  // device granted itself when applying a receipt failed, would draw a topic
  // as open that the server refuses with topic_locked.
  const serverUnlocked = (Array.isArray(serverExtras.unlocked) ? serverExtras.unlocked : []).filter(isTopicId);
  const local = readExtraUnlocks();
  const accountUnlocks = Array.from(new Set<RoadmapTopic>(serverUnlocked));
  if (accountUnlocks.length !== local.length || accountUnlocks.some((id) => !local.includes(id))) writeExtraUnlocks(accountUnlocks);

  // Open the wallet and inventory modules after a successful account read.
  // Keeping the merge in this request means a fast first response cannot
  // arrive before a separate bootstrap registration.
  const mergers = await Promise.all([import('./tokens'), import('./shop')]).catch(() => null);
  if (!mergers || accountEpoch() !== epoch) return;
  const toInventory = (inv: ServerInventory | undefined): SyncedInventory => ({
    owned: Array.isArray(inv?.owned) ? inv!.owned!.filter((x): x is string => typeof x === 'string') : [],
    ring: typeof inv?.ring === 'string' ? inv.ring : null,
    flair: typeof inv?.flair === 'string' ? inv.flair : null,
    doubleXp: typeof inv?.doubleXp === 'number' ? inv.doubleXp : 0,
  });

  const wallets: Record<string, { balance: number }> = {};
  for (const [k, v] of Object.entries(serverExtras.wallets ?? {})) {
    wallets[k] = { balance: typeof v?.balance === 'number' ? v.balance : 0 };
  }
  const inventories: Record<string, SyncedInventory> = {};
  for (const [k, v] of Object.entries(serverExtras.inventories ?? {})) {
    inventories[k] = toInventory(v);
  }
  // Legacy pre-split blob → attribute to the active subject.
  const legacyBalance = typeof serverExtras.wallet?.balance === 'number' ? serverExtras.wallet.balance : 0;
  if (Object.keys(wallets).length === 0 && legacyBalance > 0) {
    wallets[getSubject()] = { balance: legacyBalance };
  }
  if (Object.keys(inventories).length === 0 && serverExtras.inventory) {
    inventories[getSubject()] = toInventory(serverExtras.inventory);
  }
  const [tokens, shop] = mergers;
  tokens.mergeBalancesFromServer(wallets);
  shop.mergeInventoriesFromServer(inventories);
  // Fresh from here on, unless a completion answered while the GET was out.
  lastSynced = { epoch, writes: writesBefore, at: Date.now(), copy: deviceCopy() };
  // No write follows: the server keeps progress, unlocks and extras itself.
}
