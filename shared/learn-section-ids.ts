/** The part of the Learn section registry that the browser's initial bundle
 * needs: the section ids, the `LearnSection` shape and the opt-in sections
 * that `planTopics` appends. The full registry, with every section's topics
 * and the lookups the Learn page uses, lives in `shared/learn-sections.ts`,
 * which only lazy code and the server import. Rollup puts a module wholly in
 * one chunk, so anything added here ships to every first visit.
 *
 * Keep this module pure: browser and server both read it. */

import type { LearningPathId } from './learning-paths';

export const LEARN_SECTION_IDS = ['web-developer', 'software-engineer', 'forward-deployed-engineer'] as const;
export type LearnSectionId = (typeof LEARN_SECTION_IDS)[number];

/** Owner hold, 6 November 2026. Keep FDE content, ids and saved preferences
 * intact for a later release. Discovery is separate from the server's
 * LEARNING_PATH_FDE_ENABLED execution switch, which must stay off too. */
export const FDE_SECTION_VISIBLE: boolean = false;

export const isLearnSectionVisible = (value: unknown): value is LearnSectionId =>
  isLearnSectionId(value) && (FDE_SECTION_VISIBLE || value !== 'forward-deployed-engineer');

export const VISIBLE_LEARN_SECTION_IDS: readonly LearnSectionId[] =
  LEARN_SECTION_IDS.filter(isLearnSectionVisible);

export const isLearnSectionId = (value: unknown): value is LearnSectionId =>
  typeof value === 'string' && (LEARN_SECTION_IDS as readonly string[]).includes(value);

export interface LearnSection {
  id: LearnSectionId;
  /** Learn topics in the order the section rail shows them. */
  topics: readonly string[];
  /** Learning paths that live in this section. Only FDE, in its own section. */
  paths: readonly LearningPathId[];
  /** How a learner joins: the base track implies Web Developer; Software
   * Engineer is an explicit opt-in; FDE is the role specialization. */
  membership: 'base-track' | 'opt-in' | 'specialization';
}

export const SOFTWARE_ENGINEER: LearnSection = {
  id: 'software-engineer',
  topics: ['dsa', 'dsa-advanced', 'algorithms', 'system-design', 'devops', 'security', 'databases', 'git', 'general'],
  paths: [],
  membership: 'opt-in',
};

/** The sections a learner joins by choice, in section order: the only ones
 * `planTopics` appends. Kept apart from `LEARN_SECTIONS` so the browser's
 * initial bundle, which plans but does not render sections, carries only
 * these. The launch contracts check it equals the opt-in subset. */
export const OPT_IN_SECTIONS: readonly LearnSection[] = [SOFTWARE_ENGINEER];
