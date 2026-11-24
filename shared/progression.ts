/** The progression graph: which topics a learner's plan contains, in what
 * order they open, and which level of a topic may be served next.
 *
 * One graph, shared by the browser and the server. The browser renders it; the
 * server enforces it. Before this module the graph lived only in
 * `client/src/lib/roadmap.ts`, which meant a direct URL could ask the API for a
 * level the map would never have offered — the API issued it and only refused
 * at completion. The rules now live here, and both sides read the same ones.
 *
 * Two inputs decide eligibility, and only these two:
 *
 *   1. the versioned learner profile (`LearnerProfile`) — which plan they chose;
 *   2. server-verified completions — what they actually passed.
 *
 * Nothing else counts. A local unlock flag, a self-reported experience level, a
 * diagnostic result and a bookmark are all advisory: they may reorder what we
 * recommend, and they never open a level. Account-level topic grants and the
 * verified skill-check are the one documented exception, and they arrive as
 * `extraUnlocked` from the server's own record, never from a request body.
 *
 * Keep this module pure: no storage, no network, no clock. */

import { isLearningPathId, type BaseTrack, type LearnerProfile } from './learning-paths';
import { OPT_IN_SECTIONS, type LearnSection } from './learn-section-ids';
import { isRetiredTopic } from './retired-content';
import { SUBJECT_SCOPE_CATALOG } from './subject-catalog';

/* ── verified progress ─────────────────────────────────────────────────── */

/** One level's or checkpoint's record. Structurally what both the browser's
 * `RoadmapProgress` and the server's stored progress blob already hold, so
 * neither side has to convert before asking a question. */
interface ProgressEntry {
  passed?: boolean;
  bestPct?: number;
}
interface TopicProgressLike {
  levels?: Record<string, ProgressEntry>;
  checkpoints?: Record<string, ProgressEntry>;
}
export type VerifiedProgress = Record<string, TopicProgressLike | undefined>;

const entryPassed = (entry: ProgressEntry | undefined): boolean => entry?.passed === true;

/** True when that exact level is recorded as passed. */
const isLevelPassed = (progress: VerifiedProgress, topic: string, level: number): boolean =>
  entryPassed(progress[topic]?.levels?.[String(level)]);

/** How many of a topic's levels are passed. This is the measure the unlock
 * rule has always used, so an account with an unusual record — an old part
 * test, a level order that predates a curriculum edit — keeps the topics it
 * had rather than having them close behind it. */
export function passedLevelCount(progress: VerifiedProgress, topic: string): number {
  const levels = progress[topic]?.levels;
  if (!levels) return 0;
  let count = 0;
  for (const entry of Object.values(levels)) if (entryPassed(entry)) count++;
  return count;
}

/** The first level of a topic the learner has not passed, counting from 1 and
 * stopping at the first gap. This is "where am I", which is not the same
 * question as "how much have I done": a gap means the next step is the gap. */
export function firstUnfinishedLevel(
  progress: VerifiedProgress,
  topic: string,
  availability: StepAvailability = EVERYTHING_AVAILABLE,
): number {
  const levels = progress[topic]?.levels ?? {};
  let level = 1;
  // An unavailable level cannot be the next step; it is stepped over like a
  // passed one. The walk is bounded by the map's own level count downstream.
  while (entryPassed(levels[String(level)]) || (availability.unavailableLevels?.has(level) ?? false)) level++;
  return level;
}

/* ── the topic graph ───────────────────────────────────────────────────── */

/** Topics that need nothing before them, which is what makes every valid
 * selection reachable from a standing start. */
export const STARTER_TOPICS: readonly string[] = [
  'html', 'css', 'javascript',
];

/** Levels of each prerequisite topic that must be passed before the topic that
 * depends on it opens. Five is the first checkpoint — the natural milestone. */
export const LEVELS_TO_UNLOCK_NEXT = 5;

/** Topic → the topics whose first checkpoint must be cleared first.
 *
 * Deliberately shallow, so the route from nothing to a real skill stays legible:
 * the language first, then the page-building trio for React, then the topics
 * that build on Node. Every entry must be acyclic and every topic must trace
 * back to a starter — `validateProgressionGraph` proves both. */
export const TOPIC_PREREQS: Record<string, readonly string[]> = {
  // Web — starters
  html: [],
  css: [],
  javascript: [],
  // Web — build directly on the language
  typescript: ['javascript'],
  abbreviations: ['javascript'],
  general: ['javascript'],
  git: ['javascript'],
  dsa: ['javascript'],
  'dsa-advanced': ['dsa'],
  algorithms: ['javascript'],
  nodejs: ['javascript'],
  testing: ['javascript'],
  ai: ['javascript'],
  'cool-stuff': ['javascript'],
  security: ['javascript'],
  // Web — React needs the page-building trio
  react: ['javascript', 'html', 'css'],
  nextjs: ['react'],
  databases: ['nodejs'],
  'system-design': ['nodejs'],
  devops: ['nodejs'],
};

/** Every prerequisite of `topic` has cleared its first checkpoint. */
export function topicPrereqsMet(progress: VerifiedProgress, topic: string): boolean {
  const prereqs = TOPIC_PREREQS[topic] ?? [];
  return prereqs.every((prereq) => passedLevelCount(progress, prereq) >= LEVELS_TO_UNLOCK_NEXT);
}

/**
 * A topic is open when it is a starter, when the server granted it (a verified
 * skill-check or an account grant — never a client flag), or when its
 * prerequisites are met.
 */
export function isTopicUnlocked(
  progress: VerifiedProgress,
  topic: string,
  extraUnlocked: readonly string[] | ReadonlySet<string> = [],
): boolean {
  if (STARTER_TOPICS.includes(topic)) return true;
  const granted = extraUnlocked instanceof Set ? extraUnlocked : new Set(extraUnlocked as readonly string[]);
  if (granted.has(topic)) return true;
  return topicPrereqsMet(progress, topic);
}

/** Checkpoints sit after every fifth level and gate the next segment. */
const LEVELS_PER_CHECKPOINT = 5;

const isCheckpointPassed = (progress: VerifiedProgress, topic: string, checkpoint: number): boolean =>
  entryPassed(progress[topic]?.checkpoints?.[String(checkpoint)]);

/* ── learning XP ───────────────────────────────────────────────────────── */

/** XP for passing a Learn level the first time: 50 × its difficulty tier, and
 * the tier is one per five levels (1 … 5). The browser derives the learner's
 * learning XP from verified progress with these; the server uses the same
 * numbers when a first pass credits coins. */
/** @public Source contract reader: scripts/test-launch-contracts.ts verifies the authoritative XP export. */
export const LEVEL_XP_PER_DIFFICULTY = 50;
/** XP for passing a part test (checkpoint *n*) the first time: 300 × n. */
/** @public Source contract reader: scripts/test-launch-contracts.ts verifies the authoritative XP export. */
export const CHECKPOINT_XP_PER_PART = 300;

/** Difficulty tier (1–5) of a 1-based Learn level: levels 1–5 → 1, 6–10 → 2, … */
export const learnLevelDifficulty = (level: number): number =>
  Number.isFinite(level) ? Math.min(5, Math.max(1, Math.ceil(level / 5))) : 1;
export const learnLevelXp = (level: number): number => LEVEL_XP_PER_DIFFICULTY * learnLevelDifficulty(level);
export const learnCheckpointXp = (checkpoint: number): number => CHECKPOINT_XP_PER_PART * Math.max(1, checkpoint);

/** XP for a finished Biggest Shark Challenge run: five per server-proven
 * correct answer and nothing for ending one, so an all-timeout run is not a
 * farmable award. The server credits it; a signed-out browser counts the same
 * amount locally. */
export const challengeRunXp = (score: number): number =>
  Math.min(10_000, Math.max(0, Math.floor(Number.isFinite(score) ? score : 0)) * 5);

/* ── parts and availability ────────────────────────────────────────────── */

/** Every topic is presented as this many sequential parts, each ending with
 * its own test. A part is a contiguous slice of the topic's levels, sized
 * from the level count so a topic re-splits cleanly whatever its length. The
 * test of part *n* is recorded as checkpoint *n*. This is the split the map
 * draws and the exams the learner actually sits, so it is also the split the
 * unlock rules use — the fixed five-level segments below are the shape the
 * question ids are authored in, not the shape the learner meets. */
export const PARTS_PER_TOPIC = 3;

/** Split a level count into PARTS_PER_TOPIC contiguous sizes (extra → earlier parts). */
export function partSizes(levelCount: number): number[] {
  const n = Math.max(0, Math.floor(levelCount));
  const base = Math.floor(n / PARTS_PER_TOPIC);
  const rem = n % PARTS_PER_TOPIC;
  return Array.from({ length: PARTS_PER_TOPIC }, (_, i) => base + (i < rem ? 1 : 0));
}

export interface PartRange {
  /** 1-based part number (1..PARTS_PER_TOPIC). */
  part: number;
  /** First / last GLOBAL level (1-based, inclusive) covered by this part. */
  startLevel: number;
  endLevel: number;
  size: number;
}

/** Contiguous global-level ranges for each part of a topic with `levelCount` levels. */
export function partRanges(levelCount: number): PartRange[] {
  const sizes = partSizes(levelCount);
  const ranges: PartRange[] = [];
  let start = 1;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    ranges.push({ part: i + 1, startLevel: start, endLevel: start + size - 1, size });
    start += size;
  }
  return ranges;
}

/**
 * What the unlock rules need to know about a topic beyond the learner's
 * record: how long it is, and which of its steps cannot be opened right now.
 *
 * `levelCount` decides where the part tests fall. Without it the rules fall
 * back to the authored five-level segments, which is what they used before
 * the map was split into parts — and which refused level 6 of a 25-level
 * topic to a signed-in learner whose part-1 test does not come until level 9.
 * Every caller that knows the topic's length passes it.
 *
 * A level is unavailable when too few of its questions are served — the
 * content audit retired them, or the owner hid them. Such a level stays on
 * the map with its number, so an old record for it keeps its meaning, but the
 * rules step over it: it is never a prerequisite, and a part whose last level
 * is unavailable opens its test on the last level that is available. A test
 * with nothing to examine is unavailable in turn and opens the next part as
 * if it were passed. This is what stops a retired item from turning into a
 * dead end for the learner behind it.
 *
 * Both sides read the same availability: the server derives it from the
 * served question set and sends it in the level map, and the browser reads it
 * from that map. Nothing here grants access — an unavailable step is one the
 * server refuses to serve, so stepping over it is the only way forward.
 */
export interface StepAvailability {
  levelCount?: number;
  unavailableLevels?: ReadonlySet<number>;
  /** Checkpoint (part test) numbers with no available level to examine. */
  unavailableCheckpoints?: ReadonlySet<number>;
}
const EVERYTHING_AVAILABLE: StepAvailability = {};

interface Segment {
  /** 1-based; the checkpoint or part test that closes it carries this number. */
  index: number;
  start: number;
  end: number;
}

/** The segment a level belongs to: its part when the topic's length is known,
 * otherwise the authored five-level block. */
function segmentOf(availability: StepAvailability, level: number): Segment {
  if (availability.levelCount && availability.levelCount > 0) {
    const range = partRanges(availability.levelCount).find((r) => level >= r.startLevel && level <= r.endLevel);
    if (range) return { index: range.part, start: range.startLevel, end: range.endLevel };
    // Past the end of the topic: not a step at all. Treat as its own segment so
    // the rule refuses it (nothing before it can be "the last available level").
    return { index: PARTS_PER_TOPIC + 1, start: level, end: level };
  }
  const block = Math.floor((level - 1) / LEVELS_PER_CHECKPOINT);
  return { index: block + 1, start: block * LEVELS_PER_CHECKPOINT + 1, end: (block + 1) * LEVELS_PER_CHECKPOINT };
}

/** The segment a checkpoint (part test) closes, or null when the topic has no
 * such segment. */
function segmentClosedBy(availability: StepAvailability, checkpoint: number): Segment | null {
  if (!Number.isInteger(checkpoint) || checkpoint < 1) return null;
  if (availability.levelCount && availability.levelCount > 0) {
    const range = partRanges(availability.levelCount)[checkpoint - 1];
    return range && range.size > 0 ? { index: range.part, start: range.startLevel, end: range.endLevel } : null;
  }
  return { index: checkpoint, start: (checkpoint - 1) * LEVELS_PER_CHECKPOINT + 1, end: checkpoint * LEVELS_PER_CHECKPOINT };
}

const levelAvailable = (availability: StepAvailability, level: number): boolean =>
  !(availability.unavailableLevels?.has(level) ?? false);
const checkpointAvailable = (availability: StepAvailability, checkpoint: number): boolean =>
  !(availability.unavailableCheckpoints?.has(checkpoint) ?? false);

/** The last available level in a segment, or null. */
function lastAvailableLevel(availability: StepAvailability, segment: Segment): number | null {
  for (let candidate = segment.end; candidate >= segment.start; candidate--) {
    if (levelAvailable(availability, candidate)) return candidate;
  }
  return null;
}

/** The segment's levels are all done: its last available level passed, or —
 * when it has none — the segment before it cleared. */
function segmentDone(progress: VerifiedProgress, topic: string, segment: Segment, availability: StepAvailability): boolean {
  const last = lastAvailableLevel(availability, segment);
  if (last === null) return segment.index === 1 || isSegmentCleared(progress, topic, segment.index - 1, availability);
  return isLevelPassed(progress, topic, last);
}

/**
 * Whether segment `index` (a part, or an authored block) is behind the
 * learner: its test passed, or — when that test has nothing to examine — its
 * levels done. The first level of the next segment opens on this.
 */
export function isSegmentCleared(progress: VerifiedProgress, topic: string, index: number, availability: StepAvailability = EVERYTHING_AVAILABLE): boolean {
  if (index < 1) return true;
  const segment = segmentClosedBy(availability, index);
  if (!segment) return false;
  if (checkpointAvailable(availability, index)) return isCheckpointPassed(progress, topic, index);
  return segmentDone(progress, topic, segment, availability);
}

/**
 * Level 1 is always the way in. The first level of a new part needs the part
 * before it cleared (its test passed); every other level needs the nearest
 * available level before it in the same part. An unavailable level is stepped
 * over in both directions: it cannot be opened itself, and the level after it
 * looks past it.
 *
 * This is the rule the roadmap map draws, and it is at least as strict as the
 * verified-completion routine's — so a level the server agrees to serve is a
 * level the learner can also finish, and a level the map hides is one the API
 * refuses.
 */
export function isLevelUnlocked(
  progress: VerifiedProgress,
  topic: string,
  level: number,
  availability: StepAvailability = EVERYTHING_AVAILABLE,
): boolean {
  if (!Number.isInteger(level) || level < 1) return false;
  if (availability.levelCount !== undefined && level > availability.levelCount) return false;
  if (!levelAvailable(availability, level)) return false;
  const segment = segmentOf(availability, level);
  for (let candidate = level - 1; candidate >= segment.start; candidate--) {
    if (levelAvailable(availability, candidate)) return isLevelPassed(progress, topic, candidate);
  }
  // First available level of its segment: the segment before must be cleared.
  return segment.index === 1 || isSegmentCleared(progress, topic, segment.index - 1, availability);
}

/** A checkpoint (part test) opens once the last available level of its
 * segment is passed, which by the rule above means every available level in
 * it is. */
export function isCheckpointUnlocked(
  progress: VerifiedProgress,
  topic: string,
  checkpoint: number,
  availability: StepAvailability = EVERYTHING_AVAILABLE,
): boolean {
  if (!checkpointAvailable(availability, checkpoint)) return false;
  const segment = segmentClosedBy(availability, checkpoint);
  if (!segment) return false;
  const last = lastAvailableLevel(availability, segment);
  return last !== null && isLevelPassed(progress, topic, last);
}

/** A checkpoint needs every level it examines. */
/** A step a learner can ask the server for. */
export type ProgressStep =
  | { kind: 'level'; level: number }
  | { kind: 'checkpoint'; checkpoint: number }
  | { kind: 'test'; part: number; from: number; to: number };

/**
 * Whether this exact step is already on the learner's record as passed.
 *
 * The server serves such a step whatever the current plan says, because editing
 * a plan narrows what is offered next and must never withdraw what was earned:
 * a learner who passed Next.js levels on the frontend track and then moved to
 * backend would otherwise be told those very levels are not part of the plan
 * they chose.
 *
 * A part test is recorded under `checkpoints` by its part number, so a passed
 * part test counts as passed whether it is asked for as `?test=` or by its
 * older `?checkpoint=` name. The map draws it passed and lets the learner open
 * it again, and the two names must not answer differently.
 */
export function stepAlreadyPassed(
  progress: VerifiedProgress,
  topic: string,
  step: ProgressStep,
): boolean {
  if (step.kind === 'level') return isLevelPassed(progress, topic, step.level);
  if (step.kind === 'checkpoint') return isCheckpointPassed(progress, topic, step.checkpoint);
  return isCheckpointPassed(progress, topic, step.part);
}

/** Every available level in the range passed; unavailable ones are stepped
 * over, as they are everywhere else. */
export function areLevelsPassed(
  progress: VerifiedProgress,
  topic: string,
  from: number,
  to: number,
  availability: StepAvailability = EVERYTHING_AVAILABLE,
): boolean {
  for (let level = from; level <= to; level++) {
    if (!levelAvailable(availability, level)) continue;
    if (!isLevelPassed(progress, topic, level)) return false;
  }
  return true;
}

/* ── the plan ──────────────────────────────────────────────────────────── */

/** The devShark plan for each base track, as ordered stages.
 *
 * This is the topic membership only — the stage titles are translation keys and
 * stay in `client/src/lib/tracks.ts`, which reads these lists so the two cannot
 * drift. Frontend and Fullstack carry the browser (HTML and CSS) in full;
 * Backend gets the narrow web-foundations bridge it actually needs rather than
 * the whole styling curriculum.
 *
 * TypeScript has a stage to itself, and a late one. It used to sit second, one
 * step after a learner's first JavaScript — which put a type system in front of
 * people who had not yet written enough code for one to help. It is a large
 * topic and it pays off against real components and real handlers, so it comes
 * after them now: after the React stack on Frontend, after the server and its
 * data on Backend, after both on Fullstack. A stage of its own rather than a
 * seat in a crowded one, because its size is the point.
 *
 * The hard prerequisite is unchanged and stays `javascript` alone. Order and
 * dependency are different questions: this list is the recommended order, and
 * moving a topic later here never withdraws a level anyone already passed. */
export const WEBDEV_PLAN_STAGES: Record<BaseTrack, readonly (readonly string[])[]> = {
  frontend: [
    ['html', 'css', 'javascript'],
    ['git'],
    ['react', 'nextjs'],
    ['typescript'],
    ['general', 'dsa', 'ai'],
  ],
  backend: [
    ['javascript', 'git'],
    ['nodejs', 'general'],
    ['databases', 'dsa', 'algorithms'],
    ['typescript'],
    ['system-design', 'devops', 'security', 'ai'],
  ],
  fullstack: [
    ['html', 'css', 'javascript'],
    ['git'],
    ['react', 'nextjs'],
    ['nodejs', 'general', 'databases'],
    ['typescript'],
    ['dsa', 'algorithms'],
    ['system-design', 'devops', 'security', 'ai'],
  ],
};

/** Topics a role specialization needs on top of the base track. A frontend
 * learner who chose FDE still has to meet the data and service work the
 * specialization is built on — the specialization does not route around it. */
export const SPECIALIZATION_BRIDGE_TOPICS: Record<string, readonly string[]> = {
  // Every FDE section topic the base track may lack (shared/learn-sections.ts):
  // a member never meets a topic of their own section outside their plan.
  fde: ['nodejs', 'databases', 'general', 'ai', 'security', 'devops'],
};

/** Ordered topics of a learner's plan: the base track's stages, then whatever
 * the chosen specialization adds, then the topics of each
 * opt-in Learn section the learner joined (in section order), then every
 * prerequisite those section topics need that the plan does not hold yet.
 * First-seen order, without repeats.
 *
 * Only opt-in sections append here. Web Developer is the base track's stages
 * and Forward Deployed Engineer is the specialization's bridge, so a profile
 * without `sections` plans exactly what it planned before sections existed.
 * The prerequisite closure is what stops a Frontend learner who joins
 * Software Engineer from meeting DevOps & Cloud behind a Node.js their plan
 * never offered. No prerequisite changes. */
export function planTopics(profile: LearnerProfile | null): string[] {
  if (!profile) return [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (topic: string) => {
    if (seen.has(topic)) return;
    seen.add(topic);
    ordered.push(topic);
  };
  for (const stage of WEBDEV_PLAN_STAGES[profile.baseTrack] ?? []) for (const topic of stage) push(topic);
  if (profile.specialization) for (const topic of SPECIALIZATION_BRIDGE_TOPICS[profile.specialization] ?? []) push(topic);
  const appended: string[] = [];
  for (const section of OPT_IN_SECTIONS) {
    if (!profile.sections?.includes(section.id)) continue;
    for (const topic of section.topics) {
      appended.push(topic);
      push(topic);
    }
  }
  // Breadth-first over the prerequisites of everything a section appended,
  // so each prerequisite lands after the topics that asked for it.
  const queue = [...appended];
  while (queue.length > 0) {
    for (const prereq of TOPIC_PREREQS[queue.shift()!] ?? []) {
      if (seen.has(prereq)) continue;
      push(prereq);
      queue.push(prereq);
    }
  }
  return ordered;
}

/** The subject learner plans apply to. Any other subject value (an old row or
 * a stale token) keeps every topic it owns, so the plan filter checks first. */
const PLANNED_SUBJECT = 'webdev';
const subjectHasPlans = (subject: string): boolean => subject === PLANNED_SUBJECT;

/**
 * Is this topic part of what the learner chose?
 *
 * A learner with no profile, or an incomplete one, has no plan yet: everything
 * their subject owns stays available, which is the general roadmap the product
 * has always shown. Once a plan exists, topics outside it are not offered —
 * they are not "locked" so much as not chosen, and #153 hides them rather than
 * dangling them.
 */
export function isTopicInPlan(profile: LearnerProfile | null, subject: string, topic: string): boolean {
  if (!subjectHasPlans(subject)) return true;
  const topics = planTopics(profile);
  if (topics.length === 0) return true;
  return topics.includes(topic);
}

/** Topics of the plan that are both chosen and open right now. */
export function eligibleTopics(
  profile: LearnerProfile | null,
  subject: string,
  progress: VerifiedProgress,
  extraUnlocked: readonly string[] = [],
): string[] {
  const inPlan = subjectHasPlans(subject) && planTopics(profile).length > 0
    ? planTopics(profile)
    : [...(SUBJECT_SCOPE_CATALOG[subject as keyof typeof SUBJECT_SCOPE_CATALOG]?.topics ?? [])];
  return inPlan.filter((topic) => isTopicUnlocked(progress, topic, extraUnlocked));
}

/** The single next thing to do: the earliest unfinished level of the earliest
 * open topic in the plan. `levelCount` reports how many levels a topic
 * actually has, so a finished topic is skipped rather than pointing past its
 * end. Returns null when the plan holds nothing left to start. */
export function nextEligibleStep(
  profile: LearnerProfile | null,
  subject: string,
  progress: VerifiedProgress,
  levelCount: (topic: string) => number,
  extraUnlocked: readonly string[] = [],
  availabilityOf: (topic: string) => StepAvailability = () => EVERYTHING_AVAILABLE,
): { topic: string; level: number } | null {
  for (const topic of eligibleTopics(profile, subject, progress, extraUnlocked)) {
    const total = levelCount(topic);
    if (total <= 0) continue;
    const next = firstUnfinishedLevel(progress, topic, availabilityOf(topic));
    if (next <= total) return { topic, level: next };
  }
  return null;
}

/* ── graph validation ──────────────────────────────────────────────────── */

export interface GraphProblem {
  kind: 'missing' | 'cycle' | 'unreachable' | 'unknown-plan-topic'
    | 'unknown-section-topic' | 'unsectioned-topic' | 'unknown-section-path';
  topic: string;
  detail?: string;
}

/**
 * Prove the graph is usable: every topic declares prerequisites, no cycle
 * exists, every topic traces back to a starter, every plan names topics the
 * subject actually owns, and the Learn sections cover the live catalogue
 * exactly. The caller passes `sections` (`LEARN_SECTIONS` from
 * `shared/learn-sections.ts`, or a broken registry in the contract), so this
 * module, which the browser's initial bundle carries, never pulls the full
 * registry in. Run from the launch-contract test, so a curriculum
 * edit that strands a learner fails before it ships rather than after.
 */
export function validateProgressionGraph(
  allTopics: readonly string[],
  sections: readonly LearnSection[],
): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const known = new Set(allTopics);

  for (const topic of allTopics) {
    if (!(topic in TOPIC_PREREQS)) problems.push({ kind: 'missing', topic });
  }
  for (const [topic, prereqs] of Object.entries(TOPIC_PREREQS)) {
    for (const prereq of prereqs) {
      if (!known.has(prereq)) problems.push({ kind: 'missing', topic, detail: `unknown prerequisite ${prereq}` });
    }
  }

  // Depth-first search with a colour per node: grey means "on the current
  // stack", so meeting a grey node is a cycle.
  const colour = new Map<string, 'grey' | 'black'>();
  const visit = (topic: string, trail: string[]): boolean => {
    const seen = colour.get(topic);
    if (seen === 'black') return true;
    if (seen === 'grey') {
      problems.push({ kind: 'cycle', topic, detail: [...trail, topic].join(' → ') });
      return false;
    }
    colour.set(topic, 'grey');
    let ok = true;
    for (const prereq of TOPIC_PREREQS[topic] ?? []) {
      if (!visit(prereq, [...trail, topic])) ok = false;
    }
    colour.set(topic, 'black');
    return ok;
  };
  for (const topic of Object.keys(TOPIC_PREREQS)) visit(topic, []);

  // Reachability: a topic is reachable when it is a starter or every
  // prerequisite is reachable. A cycle already reported above is skipped here
  // so one fault does not produce a second, confusing report.
  const reachable = new Map<string, boolean>();
  const canReach = (topic: string, stack: Set<string>): boolean => {
    const cached = reachable.get(topic);
    if (cached !== undefined) return cached;
    if (stack.has(topic)) return false;
    // A starter, or anything that declares no prerequisite at all, needs
    // nothing before it and is reachable from a standing start.
    if (STARTER_TOPICS.includes(topic) || (TOPIC_PREREQS[topic]?.length ?? 0) === 0) {
      reachable.set(topic, true);
      return true;
    }
    stack.add(topic);
    const prereqs = TOPIC_PREREQS[topic] ?? [];
    const ok = prereqs.every((prereq) => canReach(prereq, stack));
    stack.delete(topic);
    reachable.set(topic, ok);
    return ok;
  };
  const cyclic = new Set(problems.filter((p) => p.kind === 'cycle').map((p) => p.topic));
  for (const topic of allTopics) {
    if (cyclic.has(topic)) continue;
    if (!canReach(topic, new Set())) problems.push({ kind: 'unreachable', topic });
  }

  const webdevTopics = new Set<string>(SUBJECT_SCOPE_CATALOG.webdev.topics);
  for (const [track, stages] of Object.entries(WEBDEV_PLAN_STAGES)) {
    for (const stage of stages) {
      for (const topic of stage) {
        if (!webdevTopics.has(topic)) problems.push({ kind: 'unknown-plan-topic', topic, detail: track });
      }
    }
  }
  for (const [role, topics] of Object.entries(SPECIALIZATION_BRIDGE_TOPICS)) {
    for (const topic of topics) {
      if (!webdevTopics.has(topic)) problems.push({ kind: 'unknown-plan-topic', topic, detail: role });
    }
  }

  // Learn sections (shared/learn-sections.ts): every listed topic is a live
  // catalogue topic, every live catalogue topic is listed somewhere, and every
  // path a section shelves is a published learning path.
  const sectioned = new Set<string>();
  for (const section of sections) {
    for (const topic of section.topics) {
      sectioned.add(topic);
      if (!webdevTopics.has(topic) || isRetiredTopic(topic)) {
        problems.push({ kind: 'unknown-section-topic', topic, detail: section.id });
      }
    }
    for (const path of section.paths) {
      if (!isLearningPathId(path)) problems.push({ kind: 'unknown-section-path', topic: path, detail: section.id });
    }
  }
  for (const topic of webdevTopics) {
    if (!isRetiredTopic(topic) && !sectioned.has(topic)) problems.push({ kind: 'unsectioned-topic', topic });
  }

  return problems;
}

/** Every plan must have a first step a learner with nothing passed can take. */
export function everyPlanHasAFirstStep(): GraphProblem[] {
  const problems: GraphProblem[] = [];
  for (const track of Object.keys(WEBDEV_PLAN_STAGES) as BaseTrack[]) {
    const first = (WEBDEV_PLAN_STAGES[track][0] ?? []).find((topic) => STARTER_TOPICS.includes(topic));
    if (!first) problems.push({ kind: 'unreachable', topic: track, detail: 'plan has no starter topic' });
  }
  return problems;
}
