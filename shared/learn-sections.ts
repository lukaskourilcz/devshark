/** The three Learn sections: Web Developer, Software Engineer and Forward
 * Deployed Engineer (docs/learn-sections-fde-flagship-plan.md, section 5).
 *
 * A section groups existing Learn topics and learning paths; it owns no
 * content and copies nothing from `shared/subject-catalog.ts`. A shared topic
 * keeps one id, one set of levels and one progress record wherever it is
 * listed. The section only decides where the topic is listed and, for an
 * opt-in section, whether it joins the learner's plan (`planTopics` in
 * `shared/progression.ts`). A section never changes a tier.
 *
 * Keep this module pure: browser and server both read it. */

import { SOFTWARE_ENGINEER, isLearnSectionVisible, type LearnSection, type LearnSectionId } from './learn-section-ids';

// The ids, the section shape, Software Engineer and the opt-in list live in
// `./learn-section-ids`, the slice the browser's initial bundle carries. This
// module re-exports them, so the server and lazy code import one place.
export { LEARN_SECTION_IDS, VISIBLE_LEARN_SECTION_IDS, FDE_SECTION_VISIBLE, OPT_IN_SECTIONS, SOFTWARE_ENGINEER, isLearnSectionId, isLearnSectionVisible } from './learn-section-ids';
export type { LearnSection, LearnSectionId } from './learn-section-ids';

/** The membership matrix the owner approved on 21 October 2026 (plan
 * section 5.1, decision D2): Databases is shared into Software Engineer; AI &
 * LLMs belongs to FDE; Node.js, Databases, General, DevOps & Cloud and
 * Security are FDE foundations; Git and General are shared by Web Developer and
 * Software Engineer. DSA Advanced joins Software Engineer with epic E.
 * Software Engineer's own list sits in `./learn-section-ids`. */
const WEB_DEVELOPER: LearnSection = {
  id: 'web-developer',
  topics: ['html', 'css', 'javascript', 'typescript', 'react', 'nextjs', 'nodejs', 'databases', 'git', 'general'],
  paths: [],
  membership: 'base-track',
};
const FORWARD_DEPLOYED_ENGINEER: LearnSection = {
  id: 'forward-deployed-engineer',
  topics: ['ai', 'nodejs', 'databases', 'general', 'devops', 'security'],
  paths: ['fde'],
  membership: 'specialization',
};

export const LEARN_SECTIONS: readonly LearnSection[] = [WEB_DEVELOPER, SOFTWARE_ENGINEER, FORWARD_DEPLOYED_ENGINEER];

/** Published choices, without deleting the complete curriculum registry. */
export const VISIBLE_LEARN_SECTIONS = LEARN_SECTIONS.filter((section) => isLearnSectionVisible(section.id));

/** Sections that list `topic`, in section order. A topic in more than one is
 * shared: the rail shows it in each, with the same progress. */
export const sectionsForTopic = (topic: string): LearnSectionId[] =>
  LEARN_SECTIONS.filter((section) => section.topics.includes(topic)).map((section) => section.id);

/** A topic with only a paused section has no visible Learn destination. */
export const isLearnTopicVisible = (topic: string): boolean =>
  sectionsForTopic(topic).some(isLearnSectionVisible);

/** The sections a learner belongs to. Web Developer comes with every base
 * track; Forward Deployed Engineer comes with the `fde` specialization, which
 * stays the one switch for it; Software Engineer comes only from an explicit
 * opt-in saved in `sections`. A profile without `sections` therefore means Web
 * Developer, plus FDE when the specialization is `fde`. */
export function learnerSections(profile: { specialization: string | null; sections?: readonly LearnSectionId[] } | null): LearnSectionId[] {
  if (!profile) return [];
  const chosen = new Set(profile.sections ?? []);
  return LEARN_SECTIONS.filter((section) => {
    if (section.membership === 'base-track') return true;
    if (section.membership === 'specialization') return profile.specialization === 'fde';
    return chosen.has(section.id);
  }).map((section) => section.id);
}

/** Canonical entry for a topic shared by multiple sections: the first owner
 * in the registry, matching Learn's legacy-query resolution. */
export function learnTopicHref(topic: string): string {
  const section = sectionsForTopic(topic).find(isLearnSectionVisible);
  return section ? `/learn/${section}?topic=${encodeURIComponent(topic)}` : '/learn/web-developer';
}
