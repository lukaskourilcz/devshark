/** Shark Cards (owner decision 12, 1 October 2026): a question a learner did
 * not know, saved where its explanation was shown, and reviewed later as a
 * card that explains the topic. The old collectible card packs are retired
 * (`op=cards` answers 410); their `user_cards` rows stay and account deletion
 * still erases them.
 *
 * A card is a `flashcards` row (migration 008): the question, its topic, and
 * the correct answer and explanation the server's grading returned once the
 * learner had answered. `/api/flashcards` stores what the learner was shown
 * after grading and serves a learner only their own cards, so a card never
 * carries an answer its owner was not already given.
 *
 * This module only works out where a card's "Learn this topic" link goes.
 * Pure, so the browser and the launch contracts share it. */

import { SUBJECT_SCOPE_CATALOG } from './subject-catalog';

/** The Learn questions' id prefixes, by topic: `rm-js-17` is the 17th
 * JavaScript question, which sits in level 3. `lib/roadmap.ts` builds the ids
 * from the same prefixes; the launch contracts check the two agree. */
export const LEARN_ID_PREFIXES: Readonly<Record<string, string>> = {
  javascript: 'rm-js',
  typescript: 'rm-ts',
  react: 'rm-react',
  nextjs: 'rm-next',
  nodejs: 'rm-node',
  html: 'rm-html',
  css: 'rm-css',
  git: 'rm-git',
  dsa: 'rm-dsa',
  'dsa-advanced': 'rm-dsaa',
  algorithms: 'rm-algorithms',
  general: 'rm-general',
  ai: 'rm-ai',
  databases: 'rm-db',
  'system-design': 'rm-sysdesign',
  devops: 'rm-devops',
  security: 'rm-security',
};

/** Questions per Learn level, as `lib/roadmap-build.ts` builds them. */
const LEARN_QUESTIONS_PER_LEVEL = 8;

const LEARN_TOPICS: readonly string[] = SUBJECT_SCOPE_CATALOG.webdev.topics;
const QUIZ_CATEGORIES: readonly string[] = SUBJECT_SCOPE_CATALOG.webdev.categories;

/** The Learn topic and level a question belongs to, or null for a question
 * that is not part of a Learn level (a quiz question, or a retired topic). */
export function learnLevelOfQuestion(questionId: string): { topic: string; level: number } | null {
  const fresh = /^rm-([a-z]+)-fresh-(\d+)-\d+$/.exec(questionId);
  if (fresh && LEARN_TOPICS.includes(fresh[1]) && Number(fresh[2]) >= 1) return { topic: fresh[1], level: Number(fresh[2]) };
  const match = /^(rm-[a-z]+)-(\d+)$/.exec(questionId);
  if (!match) return null;
  const topic = Object.keys(LEARN_ID_PREFIXES).find((one) => LEARN_ID_PREFIXES[one] === match[1]);
  const index = Number(match[2]);
  if (!topic || !LEARN_TOPICS.includes(topic) || !Number.isInteger(index) || index < 1) return null;
  return { topic, level: Math.floor((index - 1) / LEARN_QUESTIONS_PER_LEVEL) + 1 };
}

export type SharkCardStudyLink =
  /** The Learn level the question comes from. */
  | { kind: 'level'; to: string; topic: string; level: number }
  /** The Learn topic the question's category is. */
  | { kind: 'topic'; to: string; topic: string }
  /** A topic Learn does not teach: practise it in a quiz instead. */
  | { kind: 'practice'; to: string; topic: string };

/** Where "Learn this topic" goes for a card: the question's own Learn level
 * when it has one, else its topic in Learn, else a quiz on its category. */
export function sharkCardStudyLink(questionId: string, category: string | null): SharkCardStudyLink | null {
  const level = learnLevelOfQuestion(questionId);
  if (level) {
    return { kind: 'level', to: `/learn?topic=${encodeURIComponent(level.topic)}&level=${level.level}`, ...level };
  }
  if (category && LEARN_TOPICS.includes(category)) {
    return { kind: 'topic', to: `/learn?topic=${encodeURIComponent(category)}`, topic: category };
  }
  if (category && QUIZ_CATEGORIES.includes(category)) {
    return { kind: 'practice', to: `/quiz?category=${encodeURIComponent(category)}`, topic: category };
  }
  return null;
}
