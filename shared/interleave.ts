/** The order a practice session is played in.
 *
 * Scheduling decides *which* concepts are due (`shared/spaced-practice.ts`).
 * This file decides only what order they arrive in, and the two are kept apart
 * so neither can quietly become the other.
 *
 * The rule being implemented: when a learner already knows two related ideas,
 * mixing them makes the practice about choosing between them; a block of one
 * idea makes it about executing that idea. Both are useful, in that order —
 * which is why a concept the learner has just met gets a focused block before
 * it is ever mixed with anything.
 *
 * Three failure modes this arrangement is written against:
 *
 *   * A long run of one concept is a block with extra steps. Runs are bounded.
 *   * A strict alternation is a pattern, and a pattern is a hint: after three
 *     A-B-A-B pairs a learner can answer the seventh without reading it. Runs
 *     of two are therefore allowed and used.
 *   * A mix nobody can do is not interleaving, it is a wall. Only concepts the
 *     learner has already practised are eligible to be mixed.
 *
 * Deterministic throughout. The arrangement of a given set of items with a
 * given seed is always the same, which is what makes it testable and what
 * makes a resumed session look like the one that was interrupted. */

import { areContrastable, conceptOf } from './concepts';

/** The minimum a learner must have done with a concept before it is mixed with
 * anything. One correct answer is a coincidence; a small block is a start. */
const FOCUSED_BLOCK_SIZE = 4;

/** Never more than this many of one concept in a row. Two is deliberate: one
 * would force a strict alternation, which teaches the alternation. */
const MAX_RUN = 2;

/** How many of one concept to take before moving on, cycled. A fixed short
 * cycle rather than a random one, so the same session always arranges the same
 * way — and so a resumed session looks like the one that was interrupted. */
const RUN_PATTERN = [1, 2, 1, 1, 2] as const;

export interface Arrangeable {
  id: string;
  category?: string;
  tags?: readonly string[];
  /** What kind of item this is, used only to avoid three of a shape in a row. */
  format?: string;
}

export interface ArrangeInput<T extends Arrangeable> {
  items: readonly T[];
  /** How many times the learner has practised each concept. A concept below
   * FOCUSED_BLOCK_SIZE is new enough to want a block of its own first. */
  practised: Readonly<Record<string, number>>;
  /** Stable across a session so a resume produces the same order. */
  seed?: number;
}

export interface Arrangement<T> {
  items: T[];
  /** True when the order actually mixes contrastable concepts — the only case
   * where the learner is told why. */
  mixed: boolean;
  /** The concepts being contrasted, when mixed. */
  contrasted: string[];
}

/** A small deterministic shuffle: enough to stop the first item always being
 * the same one, never enough to matter for fairness. */
function rotate<T>(list: T[], by: number): T[] {
  if (list.length < 2) return list;
  const at = ((by % list.length) + list.length) % list.length;
  return [...list.slice(at), ...list.slice(0, at)];
}

/**
 * Order a session.
 *
 * Items with no concept are ordinary items: they fill the gaps and never block
 * a mix. Items whose concept is new are kept together at the front, in a block,
 * so the mixing starts only once there is something to mix.
 */
export function arrangePractice<T extends Arrangeable>(input: ArrangeInput<T>): Arrangement<T> {
  const seed = input.seed ?? 0;
  const byConcept = new Map<string, T[]>();
  const loose: T[] = [];
  for (const item of input.items) {
    const concept = conceptOf(item);
    if (!concept) {
      loose.push(item);
      continue;
    }
    const bucket = byConcept.get(concept) ?? [];
    bucket.push(item);
    byConcept.set(concept, bucket);
  }

  // A concept the learner has barely met is taught before it is contrasted.
  const fresh: string[] = [];
  const known: string[] = [];
  for (const concept of [...byConcept.keys()].sort()) {
    ((input.practised[concept] ?? 0) < FOCUSED_BLOCK_SIZE ? fresh : known).push(concept);
  }

  const contrasted = known.filter((concept) =>
    known.some((other) => areContrastable(concept, other)),
  );

  const out: T[] = [];
  // Focused blocks first, whole and unmixed.
  for (const concept of fresh) out.push(...(byConcept.get(concept) ?? []));

  // Then the mix. Round-robin over the known concepts, but taking one or two
  // at a time rather than always one: a strict rotation is a pattern, and after
  // three A-B-A-B pairs a learner can answer the next item without reading it.
  // The run lengths follow a fixed short cycle, so the arrangement stays
  // deterministic while the concept sequence does not repeat.
  const queues = rotate(
    known.map((concept) => ({ concept, items: [...(byConcept.get(concept) ?? [])] })),
    seed,
  );
  let lastConcept: string | null = null;
  let lastFormat: string | undefined;
  let formatRun = 0;
  let step = 0;
  let guard = 0;
  while (queues.some((queue) => queue.items.length > 0) && guard++ < input.items.length * 4) {
    // Prefer a queue that is not the one just used; fall back to any queue with
    // items left, which is what happens as the session runs out.
    const pick =
      queues.find((queue) => queue.items.length > 0 && queue.concept !== lastConcept) ??
      queues.find((queue) => queue.items.length > 0);
    if (!pick) break;
    const wanted = Math.min(RUN_PATTERN[step % RUN_PATTERN.length], MAX_RUN);
    for (let taken = 0; taken < wanted && pick.items.length > 0; taken++) {
      const next = pick.items[0];
      // Three of one shape in a row teaches the shape; break the run instead.
      // Only declared formats count: an item with none is not "the same shape"
      // as the last one, it is an item nobody has said anything about.
      const sameFormat = next.format !== undefined && next.format === lastFormat;
      if (taken > 0 && sameFormat && formatRun >= MAX_RUN) break;
      pick.items.shift();
      formatRun = sameFormat ? formatRun + 1 : 1;
      lastFormat = next.format;
      out.push(next);
    }
    lastConcept = pick.concept;
    step++;
    // Move the used queue to the back so the next pick comes from elsewhere.
    const at = queues.indexOf(pick);
    queues.push(...queues.splice(at, 1));
  }

  // Loose items last, so they never interrupt a contrast, and never duplicated.
  const seen = new Set(out.map((item) => item.id));
  for (const item of loose) if (!seen.has(item.id)) out.push(item);

  return {
    items: out.filter((item, index, all) => all.findIndex((one) => one.id === item.id) === index),
    mixed: contrasted.length >= 2,
    contrasted: [...contrasted].sort(),
  };
}

/** Problems with an arrangement that would make it worse than no arrangement.
 * Empty is correct; used by the contract suite rather than at runtime. */
export function arrangementProblems<T extends Arrangeable>(items: readonly T[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let lastConcept: string | null = null;
  let run = 0;
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) problems.push(`duplicate item ${item.id} at position ${index + 1}`);
    seen.add(item.id);
    const concept = conceptOf(item);
    run = concept !== null && concept === lastConcept ? run + 1 : 1;
    if (concept !== null && run > MAX_RUN) {
      problems.push(`${run} of ${concept} in a row at position ${index + 1}`);
    }
    lastConcept = concept;
  }
  return problems;
}
