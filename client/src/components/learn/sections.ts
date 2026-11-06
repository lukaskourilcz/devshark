// The Learn page's section rules, kept pure so the unit tests can hold them.
//
// A section (shared/learn-sections.ts) only decides where a topic is listed
// and, for a section the learner has not joined, that its topics are shown
// dimmed with the join action. Progress, prerequisites and the plan stay what
// they are: one progress record per topic, read in every section that lists
// it, and the server's plan check (403 not_in_plan) decides what it serves.
//
// This module ships with the Learn chunk. It is the one client module that
// reads the full registry; the initial bundle carries only
// shared/learn-section-ids.ts.

import {
  LEARN_SECTIONS,
  isLearnSectionVisible,
  sectionsForTopic,
  type LearnSectionId,
} from '../../../../shared/learn-sections';
import {
  LEVELS_TO_UNLOCK_NEXT,
  TOPIC_PREREQS,
  isTopicUnlocked,
  passedLevelCount,
  type VerifiedProgress,
} from '../../../../shared/progression';
import { isBarred, type LockState, type NonCodingContent } from '../../lib/contentLocks';
import type { PathProgressResponse } from '../../../../shared/learning-path-api';
import type { ModuleSummary } from '../../../../shared/learning-paths';

/** The last section opened on this device. */
export const SECTION_KEY = 'devquiz:roadmap:section';
/** The last topic opened in each section on this device, as { [section]: topic }.
 * The page-wide last topic (devquiz:roadmap:topic) still records the last one
 * overall; without this map, a visit to Software Engineer would move the Web
 * Developer rail off its topic. */
export const SECTION_TOPIC_KEY = 'devquiz:roadmap:section-topic';

export const DEFAULT_SECTION: LearnSectionId = 'web-developer';

const sectionOf = (id: LearnSectionId) => LEARN_SECTIONS.find((section) => section.id === id)!;

/**
 * Which section a Learn URL shows, and the URL to replace it with when the
 * address does not name that section. In order:
 *
 * 1. A known section in the path is shown, unless `?topic` names a topic that
 *    section does not list while another does: then the first section that
 *    lists the topic is shown, and the URL moves there.
 * 2. Otherwise (no section, or an unknown one): the first section that lists
 *    `?topic`, else the section last opened on this device, else Web Developer.
 *
 * The query string is always kept whole: the page reads topic, part, level and
 * ref from it.
 */
export function resolveSection(
  param: string | undefined,
  search: string,
  stored: string | null,
): { section: LearnSectionId; canonical: string | null } {
  const topic = new URLSearchParams(search).get('topic');
  const homes = topic ? sectionsForTopic(topic).filter(isLearnSectionVisible) : [];
  if (isLearnSectionVisible(param)) {
    if (homes.length > 0 && !homes.includes(param)) return { section: homes[0], canonical: `/learn/${homes[0]}${search}` };
    return { section: param, canonical: null };
  }
  const section = homes[0] ?? (isLearnSectionVisible(stored) ? stored : DEFAULT_SECTION);
  return { section, canonical: `/learn/${section}${search}` };
}

/** The section's topics that the subject still serves, in section order. */
export const sectionTopics = (id: LearnSectionId, liveTopics: readonly string[]): string[] =>
  sectionOf(id).topics.filter((topic) => liveTopics.includes(topic));

export type RailState = 'open' | 'locked' | 'dimmed';

export interface RailEntry {
  topic: string;
  /** open: selectable. locked: behind a prerequisite. dimmed: outside the plan
   * because the learner has not joined this section, with nothing passed. */
  state: RailState;
  /** Every level of the topic needs Premium for this visitor. */
  premium: boolean;
}

export interface RailContext {
  liveTopics: readonly string[];
  inPlan: (topic: string) => boolean;
  /** The learner has a saved plan. Signed out, or signed in without one,
   * every topic is listed and nothing is dimmed. */
  hasPlan: boolean;
  isMember: boolean;
  progress: VerifiedProgress;
  extraUnlocks: ReadonlySet<string>;
  lockOf: (content: NonCodingContent) => LockState;
}

/** The rail of one section. A member sees the section's topics that are in
 * the plan or carry a passed level, as the page always showed. A learner who
 * has not joined sees every topic, with the ones the plan lacks dimmed. */
export function railEntries(id: LearnSectionId, ctx: RailContext): RailEntry[] {
  const entries: RailEntry[] = [];
  for (const topic of sectionTopics(id, ctx.liveTopics)) {
    const kept = ctx.inPlan(topic) || passedLevelCount(ctx.progress, topic) > 0;
    if (ctx.hasPlan && ctx.isMember && !kept) continue;
    const dimmed = ctx.hasPlan && !ctx.isMember && !kept;
    const state: RailState = dimmed ? 'dimmed' : isTopicUnlocked(ctx.progress, topic, ctx.extraUnlocks) ? 'open' : 'locked';
    entries.push({
      topic,
      state,
      premium: state !== 'dimmed' && isBarred(ctx.lockOf({ kind: 'learn-level', topic, level: 1 })),
    });
  }
  return entries;
}

/** What a learning path adds to its section's figure: one step per activity
 * of its loop modules (optional and shelf modules stay out, as they stay out
 * of completion), done once the server has recorded it as `verified_pass` or
 * `self_reviewed`. An activity is about the size of a Learn level, so the two
 * add up. Nothing here grades: it counts states the server recorded. */
export interface PathSteps {
  passed: number;
  total: number;
}

const DONE_STATES: ReadonlySet<string> = new Set(['verified_pass', 'self_reviewed']);

export function pathSteps(
  modules: readonly Pick<ModuleSummary, 'activities' | 'optional' | 'shelf'>[],
  progress: PathProgressResponse | undefined,
): PathSteps {
  const states = new Map<string, string>();
  for (const module of progress?.modules ?? []) {
    for (const activity of module.activities) states.set(activity.activityId, activity.state);
  }
  let passed = 0;
  let total = 0;
  for (const module of modules) {
    if (module.optional === true || module.shelf !== undefined) continue;
    for (const activity of module.activities) {
      total += 1;
      if (DONE_STATES.has(states.get(activity.id) ?? '')) passed += 1;
    }
  }
  return { passed, total };
}

/** The section's progress figure: levels passed over levels available, across
 * the topics the learner can work toward (every entry but the dimmed ones;
 * all of them when every entry is dimmed), plus the steps of the section's
 * path when one is open (`pathSteps`). null until the level counts are known.
 * A passed level or step always shows as at least 1%.
 *
 * Joining a section can lower its figure, and Web Developer's: the joined
 * topics and their prerequisites (Node.js for a Frontend learner) join the
 * total. That is accepted: the figure measures the plan, which just grew. */
export function sectionProgress(
  entries: readonly RailEntry[],
  progress: VerifiedProgress,
  levelCounts: Readonly<Record<string, number>>,
  path: PathSteps | null = null,
): { passed: number; total: number; percent: number | null } {
  const reachable = entries.filter((entry) => entry.state !== 'dimmed');
  const counted = reachable.length > 0 ? reachable : entries;
  let passed = path?.passed ?? 0;
  let total = path?.total ?? 0;
  for (const { topic } of counted) {
    const count = levelCounts[topic] ?? 0;
    passed += Math.min(passedLevelCount(progress, topic), count);
    total += count;
  }
  const percent = total > 0 ? Math.floor((100 * passed) / total) : null;
  return { passed, total, percent: percent === 0 && passed > 0 ? 1 : percent };
}

/** What opens a section whose listed topics are all locked: the topic to pass
 * levels in, the topic it opens, and a section that lists it (one the learner
 * belongs to first). null when something is open, or nothing is locked. */
export function sectionGate(
  entries: readonly RailEntry[],
  progress: VerifiedProgress,
  extraUnlocks: ReadonlySet<string>,
  members: readonly LearnSectionId[],
): { prereq: string; topic: string; prereqSection: LearnSectionId } | null {
  if (entries.some((entry) => entry.state === 'open')) return null;
  const first = entries.find((entry) => entry.state === 'locked');
  if (!first) return null;
  const unmet = (topic: string) =>
    (TOPIC_PREREQS[topic] ?? []).find((prereq) => passedLevelCount(progress, prereq) < LEVELS_TO_UNLOCK_NEXT);
  let prereq = unmet(first.topic);
  // A prerequisite that is itself locked points at its own; every chain ends
  // at a starter, which is always open.
  for (let guard = 0; prereq && !isTopicUnlocked(progress, prereq, extraUnlocks) && guard < 10; guard += 1) {
    const deeper = unmet(prereq);
    if (!deeper) break;
    prereq = deeper;
  }
  if (!prereq) return null;
  const homes = sectionsForTopic(prereq).filter(isLearnSectionVisible);
  const prereqSection = homes.find((home) => members.includes(home)) ?? homes[0] ?? DEFAULT_SECTION;
  return { prereq, topic: first.topic, prereqSection };
}

/** The first preferred topic that is open on the rail, else the first open
 * entry, else null. */
export function firstSelectable(entries: readonly RailEntry[], preferred: readonly (string | null | undefined)[]): string | null {
  const open = entries.filter((entry) => entry.state === 'open').map((entry) => entry.topic);
  return preferred.find((topic): topic is string => !!topic && open.includes(topic)) ?? open[0] ?? null;
}
