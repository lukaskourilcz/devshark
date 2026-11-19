// Shared builder for the roadmap ("Learn") question sets.
//
// The roadmap is a Duolingo-style path: eight questions per level, ordered
// easiest → hardest, up to 25 levels per topic (the level titles in
// lib/roadmap.ts set each topic's count: JavaScript runs 25, HTML 6). Each
// topic file supplies a compact `Seed[]` and this helper expands it into real
// Question objects with deterministic ids (`<prefix>-<n>`, n = seed index + 1),
// a level-derived difficulty, and a default hint. JavaScript, TypeScript and
// React author each level as four A seeds and four B seeds, which
// lib/roadmap-questions.ts interleaves; every other topic is one list of eight
// seeds per level.
//
// Level/difficulty mapping (QUESTIONS_PER_LEVEL = 8):
//   question index i (0-based) → level = floor(i/8)+1 → difficulty = ceil(level/5)
// so levels 1-5 are difficulty 1, 6-10 are 2, … 21-25 are 5. With 8 per level,
// every 5-level checkpoint covers exactly 40 questions. An id is its position,
// so a seed inserted mid-list renumbers every later question: new material for
// an existing level goes through lib/roadmap-questions-restored.ts.

import type { Question, CategoryType } from './quiz-data';
import type { SnippetMeta } from '../shared/snippet-format';

export const QUESTIONS_PER_LEVEL = 8;
export const ROADMAP_LEVELS = 25;
// Each level is authored as two sets of 4 (A + B); the combiner interleaves them.
export const HALF_LEVEL = 4;

export interface Seed {
  /** Question text; may embed a fenced code block (```js … ```). */
  q: string;
  /** Answer choices. */
  opts: string[];
  /** Index of the correct choice in `opts`. */
  a: number;
  /** Explanation shown after answering. */
  e: string;
  /** Topic tags (the builder always prepends "Roadmap"). */
  tags: string[];
  /** Optional per-question hint; falls back to a shape-aware nudge (see hintFor). */
  intro?: string;
  /** Declared when the question is a code-reading one. Declared rather than
   * inferred: a fenced block is not by itself a snippet question, and guessing
   * would make the coverage report and the pacing rule meaningless. */
  snippet?: SnippetMeta;
}

// Broad topic/category tags that don't make a useful "think about X" nudge on
// their own — we only name a tag in the hint when it's more specific than these.
const BROAD_TAGS = new Set([
  'javascript', 'typescript', 'react', 'html', 'css', 'node.js', 'nodejs', 'next.js',
  'git', 'roadmap', 'dsa', 'algorithms', 'sql', 'databases', 'system design',
  'devops', 'security', 'testing', 'general', 'web', 'frontend', 'backend',
]);

const GENERIC_HINT = 'Name the requirement or behavior first, then compare the options against it.';

/**
 * A short, non-spoiling "little push" derived from a question's shape, so every
 * question shows a relevant hint on how to reason about the concept. Hints
 * should help learners recall or trace the material; they must not teach
 * test-taking tricks such as choosing the only option that sounds technical.
 */
function hintFor(seed: Seed): string {
  const lower = seed.q.toLowerCase();
  const hasCode = seed.q.includes('```');

  let base: string;
  if (hasCode && /(return|output|print|log|console|result|evaluate|value|what does|what will|what is)/.test(lower)) {
    base = 'Trace the code one line at a time. Write down each value before choosing.';
  } else if (hasCode) {
    base = 'Read the code once for control flow, then again for the values that change.';
  } else if (/^\s*which\b/.test(lower) || lower.includes('which of')) {
    base = 'Identify the requirement or failure mode first, then compare the trade-offs.';
  } else if (lower.includes('true or false') || /^\s*(is|are|does|do|can|will|should|has|have)\b/.test(lower)) {
    base = 'Check the statement against the normal case and one likely edge case.';
  } else if (/(what is|what does|purpose of|used for|meaning of|stands? for|difference between|when (to|should))/.test(lower)) {
    base = 'Explain the term in your own words, including when you would use it.';
  } else {
    base = GENERIC_HINT;
  }

  // Name the most specific (non-broad) tag for a topic nudge, if any.
  const specific = [...seed.tags].reverse().find((tg) => !BROAD_TAGS.has(tg.toLowerCase().trim()));
  return specific ? `${base} Focus on ${specific}.` : base;
}

function levelForIndex(i: number): number {
  return Math.floor(i / QUESTIONS_PER_LEVEL) + 1;
}

export function difficultyForLevel(level: number): Question['difficulty'] {
  return Math.min(5, Math.max(1, Math.ceil(level / 5))) as Question['difficulty'];
}

/** Expand a topic's compact seeds into full Question objects. */
export function buildRoadmap(prefix: string, category: CategoryType, seeds: Seed[]): Question[] {
  return seeds.map((s, i) => {
    const level = levelForIndex(i);
    return {
      id: `${prefix}-${i + 1}`,
      tags: ['Roadmap', ...s.tags],
      introduction: s.intro ?? hintFor(s),
      question: s.q,
      options: s.opts,
      correctAnswer: s.a,
      category,
      explanation: s.e,
      difficulty: difficultyForLevel(level),
      ...(s.snippet ? { snippet: s.snippet } : {}),
    } satisfies Question;
  });
}
