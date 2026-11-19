/** Naming why a coding attempt failed, so the next hint can be about that.
 *
 * The classifier is pure and takes only safe inputs. It never receives a hidden
 * test's input or expected value, and it never returns one: the category is a
 * word from a fixed vocabulary, and the hint attached to it is authored text.
 * The raw error from the sandbox or the compiler stays on the server — a stack
 * trace is not a teaching aid, and it can carry fixture data.
 *
 * The server classifies with everything it knows (the expected kinds and which
 * cases the author marked as edge cases). The browser can classify the Run
 * button's immediate feedback too, with the narrower set of signals it already
 * holds; the same vocabulary and the same authored text serve both, so the
 * learner is not told two different stories about one failure. */


export const FAILURE_CATEGORIES = [
  'types',
  'runtime',
  'timeout',
  'missing-return',
  'output-shape',
  'boundary',
  'mutation',
  'tests',
] as const;
export type FailureCategory = (typeof FAILURE_CATEGORIES)[number];

/** What the classifier is allowed to see. Everything here is either the
 * learner's own output or a fact about the task's shape. */
export interface FailureSignals {
  timedOut?: boolean;
  /** True when the run threw or would not parse. The message itself stays on
   * the server; only the fact of it reaches this function. */
  threw?: boolean;
  /** True when the failure came from the type checker rather than a run. */
  typeErrors?: boolean;
  /** One entry per visible test, in task order. */
  results?: readonly { pass: boolean | null; actual: string | null }[];
  /** For each visible test, whether the author marked it an edge case.
   * Server-side only; omitted in the browser. */
  edge?: readonly boolean[];
  /** For each visible test, the JSON kind the expected value has — "array",
   * "object", "string", "number", "boolean", "null". The *kind*, never the
   * value, so nothing about the answer leaves the server. */
  expectedKinds?: readonly (string | null)[];
  /** The pitfall this task is built around, when its author declared one.
   * Used only when nothing more specific was proven. */
  pitfall?: FailureCategory;
}

/** Whether a run's error is code that never parsed. Both runners say so as
 * "SyntaxError: <message>": the grading sandbox as QuickJS words it, the
 * browser's runner as `new Function` does. The message says what is wrong,
 * and no hint about values or types would be true of code that never ran, so
 * none is given: the hint ladder answers instead. */
export const isSyntaxError = (codeError: string | null | undefined): boolean =>
  typeof codeError === 'string' && codeError.startsWith('SyntaxError: ');

/** The JSON kind of a serialized value, as the classifier compares them. */
export function jsonKind(serialized: string | null): string | null {
  if (serialized === null) return null;
  const text = serialized.trim();
  if (text === 'undefined') return 'undefined';
  if (text === 'null') return 'null';
  if (text.startsWith('[')) return 'array';
  if (text.startsWith('{')) return 'object';
  if (text.startsWith('"') || text.startsWith("'")) return 'string';
  if (text === 'true' || text === 'false') return 'boolean';
  if (text !== '' && Number.isFinite(Number(text))) return 'number';
  return null;
}

/**
 * The most specific category the signals actually prove, or `tests` when the
 * only honest answer is "some checks did not pass".
 *
 * Order matters: a run that never finished cannot have a meaningful output
 * shape, and a file that will not type-check never ran at all.
 */
export function classifyFailure(signals: FailureSignals): FailureCategory {
  if (signals.timedOut) return 'timeout';
  if (signals.typeErrors) return 'types';
  if (signals.threw) return 'runtime';

  const results = signals.results ?? [];
  const failing = results
    .map((result, index) => ({ ...result, index }))
    .filter((result) => result.pass === false);
  if (failing.length === 0) return signals.pitfall ?? 'tests';

  // Nothing came back at all: the commonest first failure, and the one whose
  // fix is most specific.
  if (failing.every((result) => jsonKind(result.actual) === 'undefined')) return 'missing-return';

  // Every failure produced a value of a different kind than the test wanted.
  if (signals.expectedKinds) {
    const kinds = signals.expectedKinds;
    const shapeWrong = failing.every((result) => {
      const expected = kinds[result.index];
      const actual = jsonKind(result.actual);
      return expected !== null && actual !== null && expected !== actual;
    });
    if (shapeWrong) return 'output-shape';
  }

  // Only the cases the author marked as edges fail, and something ordinary
  // passed — the logic is right in the middle and wrong at the ends.
  if (signals.edge && results.some((result, index) => result.pass === true && !signals.edge![index])) {
    if (failing.every((result) => signals.edge![result.index] === true)) return 'boundary';
  }

  return signals.pitfall ?? 'tests';
}

/**
 * The curated hint for each category, used when a task authors none of its own.
 *
 * Every line is written to move a learner without answering for them: it names
 * the kind of mistake, not the fix, and never mentions a specific input or
 * expected value. `tests` has no default on purpose — "some checks failed" adds
 * nothing the results panel has not already said, so the hint ladder takes over.
 */
/** @public Published from packages/coding-evaluator/src/index.ts; preserve the package API. */
export const DEFAULT_FAILURE_HINTS: Partial<Record<FailureCategory, string>> = {
  types: 'The types did not check out, so the code never ran. Read the first type error and fix that one — later errors are often knock-on effects of it.',
  runtime: 'Your code threw before it could answer. Check the values you index into or call methods on: something is not what you expect it to be at that point.',
  timeout: 'The run did not finish in time. Look for a loop whose condition never becomes false, or a recursion with no base case.',
  'missing-return': 'Your function came back with nothing. Check that every path returns a value — a branch that only computes, or a callback whose result is thrown away, both look like this.',
  'output-shape': 'You are returning the right idea in the wrong form. Re-read what the task asks you to hand back and compare it with the kind of value you are producing.',
  boundary: 'The ordinary cases pass and the extremes do not. Try the smallest input the task allows, and the one right at the edge of your loop or slice.',
  mutation: 'Something is being changed in place that should not be. Check whether you are modifying the value you were given instead of building a new one.',
};

/**
 * The hint to show for a failure: the task's own line when its author wrote one
 * for this category, otherwise the curated default, otherwise nothing — and
 * nothing means the hint ladder answers instead, which is the existing
 * behaviour rather than a gap.
 */
export function failureHint(
  category: FailureCategory,
  authored: Partial<Record<FailureCategory, string>> | undefined,
): { category: FailureCategory; body: string } | null {
  const body = authored?.[category] ?? DEFAULT_FAILURE_HINTS[category];
  return body ? { category, body } : null;
}
