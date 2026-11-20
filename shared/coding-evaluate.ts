/** Runs a learner's JavaScript against a list of call expressions and compares
 * the results by deep equality. Shared by the browser worker (untrusted code,
 * isolated in a Worker) and the node content test (trusted reference
 * solutions). The server never uses this: learner code there runs inside the
 * QuickJS sandbox in `lib/coding/sandbox.ts`. Ported from interview-prepper. */

import { learnerConsoleFactory } from './coding-console';

// Captured in the controller module, never passed into learner scope.
const collectOutcomes = Promise.all.bind(Promise);
// Private controller capability, captured before a task can revoke the
// learner-visible Function constructors. Never passed into learner scope.
const compileProgram = Function;

export const RUN_TIMEOUT_MS = 2_000;
/** Timer- and promise-based tasks need longer than a synchronous one. */
export const ASYNC_TIMEOUT_MS = 6_000;
export const TIMEOUT_MESSAGE = 'Timed out. Check for an infinite loop.';
/** What the learner reads when a type check was stopped: the cause is a type,
 * not a loop. The server's checker (lib/coding/ts-check-pool.ts) and the
 * browser's runner both report a stopped check with this text. */
export const TYPE_CHECK_STOPPED_MESSAGE =
  'Type checking stopped before it finished: it ran out of time, memory or stack. A type that keeps recursing, or one that builds very large unions or tuples, can do this.';
export const MAX_LOGS = 100;
/** Console output is capped by size as well as by line count: a line past
 * MAX_LOG_LINE_CHARS is cut, and past MAX_LOG_CHARS in all the rest is
 * dropped, so a print loop cannot make a response too large to send or a
 * Console tab too long to draw. Both runners apply the same caps. */
export const MAX_LOG_LINE_CHARS = 2_000;
export const MAX_LOG_CHARS = 64_000;
export const LOG_LINE_CUT = ' … (line cut)';
export const LOG_OUTPUT_CUT = '… (output cut)';

/**
 * The built-ins a check's probe counts with. A check that grades how code
 * touches its input (a binary search's reads, a one-pass budget) wraps the
 * input in a `Proxy` and counts the index reads it sees. Code that replaced
 * the global `Proxy` (`var Proxy = function (t) { return t; };`) or
 * `RegExp.prototype.test` made every count zero, and a linear scan passed a
 * binary-search budget. Both runners take these before the learner's code
 * runs and hand them to it as the constant `__probe`, declared on the first
 * line (PROBE_LINE), which the code cannot redeclare; the object is frozen.
 * Checks and path harnesses write `new __probe.Proxy(...)`,
 * `__probe.isIndex(key)` and `__probe.get(...)`.
 * Path-harness export sealing also uses captured freeze/descriptor/key
 * operations, so learner replacements cannot leave fixtures writable.
 */
export const PROBE_LINE = '"use strict"; const __probe = arguments[arguments.length - 1];';
/** Whether a property key is an array index, with no built-in method. The
 * grading sandbox embeds the same function as source (PROBE_IS_INDEX_SOURCE). */
const isProbeIndex = (key: unknown): boolean => {
  if (typeof key !== 'string' || key.length === 0) return false;
  for (let i = 0; i < key.length; i++) {
    const c = key[i];
    if (c < '0' || c > '9') return false;
  }
  return true;
};
export const PROBE_IS_INDEX_SOURCE =
  "(key) => { if (typeof key !== 'string' || key.length === 0) return false; for (let i = 0; i < key.length; i++) { const c = key[i]; if (c < '0' || c > '9') return false; } return true; }";
/** Taken when this module loads, before any learner code in this realm. */
const PROBE = Object.freeze({ Proxy, get: Reflect.get, isIndex: isProbeIndex,
  freeze: Object.freeze, keys: Object.keys, ownDescriptor: Object.getOwnPropertyDescriptor, setPrototypeOf: Object.setPrototypeOf,
  defineProperty: Object.defineProperty, deleteProperty: Reflect.deleteProperty });

export interface CallOutcome {
  /** null when the run was not graded (the Run button). */
  pass: boolean | null;
  actual: string | null;
  error: string | null;
}

export interface EvaluateResult {
  results: CallOutcome[];
  logs: string[];
  codeError: string | null;
  timedOut?: boolean;
}

// Numbers compare the way `includes` and `Map` keys do: NaN equals NaN, and
// 0 equals -0. Correct arithmetic can produce -0 (`-a - b` with both zero),
// and no check in the catalogue asks for one sign of zero over the other.
export const deepEqual = (actual: unknown, expected: unknown): boolean => {
  if (actual === expected || Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
      actual.every((value, index) => deepEqual(value, expected[index]));
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    return actualKeys.length === expectedKeys.length &&
      actualKeys.every((key) => Object.prototype.hasOwnProperty.call(expected, key) &&
        deepEqual((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key]));
  }
  return false;
};

/** JSON writes -0 as 0; this stands in for it until the text is built. */
const NEGATIVE_ZERO = '\u0000-0\u0000';

/** Renders a value the way the results table shows it. -0 is written as -0,
 * so a result that differs only in that sign does not read as the answer. */
export const displayValue = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (Object.is(value, -0)) return '-0';
  try {
    const text = JSON.stringify(value, (_key, item: unknown) => (Object.is(item, -0) ? NEGATIVE_ZERO : item));
    return text === undefined ? String(value) : text.split(JSON.stringify(NEGATIVE_ZERO)).join('-0');
  } catch {
    return String(value);
  }
};

const formatArg = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const errorText = (error: unknown): string =>
  String((error && typeof error === 'object' && 'message' in error && (error as { message?: unknown }).message) || error);

/** What Run says when code used a global the grader lacks, which the Run
 * worker removed (shared/coding-checker-globals.ts). */
export const hiddenGlobalMessage = (name: string): string => `\`${name}\` isn't available in the checker. Submit runs without it.`;

/** A ReferenceError for one of `hidden` reworded to name the reason. Chrome
 * and Firefox write "X is not defined", Safari "Can't find variable: X". */
const explainHidden = (message: string, hidden: ReadonlySet<string> | undefined): string => {
  if (!hidden || hidden.size === 0) return message;
  const name = /^(?:ReferenceError: )?(?:([\w$]+) is not defined|Can't find variable: ([\w$]+))$/.exec(message);
  const missing = name && (name[1] ?? name[2]);
  return missing && hidden.has(missing) ? hiddenGlobalMessage(missing) : message;
};

/**
 * Runs `code` once and evaluates each call in its scope. Pass `expectations`
 * to grade, or omit them to just run: an ungraded call reports what it
 * returned with `pass: null`. Every call is awaited, so a promise is graded on
 * what it resolves to. Only clone-safe strings cross the worker boundary.
 * `hidden` names the globals the Run worker removed to match the grader; an
 * error from using one says so.
 */
export async function evaluateCalls(input: { code: string; calls: string[]; expectations?: unknown[] | null; hidden?: ReadonlySet<string> }): Promise<EvaluateResult> {
  const logs: string[] = [];
  let logChars = 0;
  let logsCut = false;
  const emit = (line: string) => {
    if (logsCut || logs.length >= MAX_LOGS) return;
    const text = line.length > MAX_LOG_LINE_CHARS ? line.slice(0, MAX_LOG_LINE_CHARS) + LOG_LINE_CUT : line;
    if (logChars + text.length > MAX_LOG_CHARS) {
      logs.push(LOG_OUTPUT_CUT);
      logsCut = true;
      return;
    }
    logChars += text.length;
    logs.push(text);
  };
  // The same console the grading sandbox gives the code, on the real clock.
  const sink = learnerConsoleFactory()(emit, (value) => {
    if (logsCut || logs.length >= MAX_LOGS) return '';
    return formatArg(value);
  }, () => (typeof performance === 'undefined' ? Date.now() : performance.now()));
  const grading = Array.isArray(input.expectations);

  let evaluate: (console: typeof sink, probe: typeof PROBE) => (() => unknown)[];
  try {
    // Compile authored call expressions as closures over the learner module,
    // as Submit does. The controller needs no learner-visible eval and retains
    // strict mode, the probe ABI and the learner's original line offset.
    const callbacks = input.calls.map(source => '() => (' + source.trim().replace(/;+$/, '') + '\n)').join(',');
    evaluate = compileProgram('console', PROBE_LINE + '\n' + input.code + '\n;return [' + callbacks + '];') as typeof evaluate;
  } catch (error) {
    // Code that does not parse, named as the grading sandbox names it.
    const syntax = error instanceof Error && error.name === 'SyntaxError';
    return { results: [], logs, codeError: syntax ? `SyntaxError: ${errorText(error)}` : explainHidden(errorText(error), input.hidden) };
  }

  try {
    const callbacks = evaluate(sink, PROBE);
    const outcomes = await collectOutcomes(input.calls.map(async (_source, index) => {
      try { return { ok: true, value: await callbacks[index](), error: undefined }; }
      catch (error) { return { ok: false, value: undefined, error: errorText(error) }; }
    }));
    const results = outcomes.map((outcome, index): CallOutcome => {
      if (!outcome.ok) return { pass: false, actual: null, error: explainHidden(outcome.error ?? 'Error', input.hidden) };
      return {
        pass: grading ? deepEqual(outcome.value, input.expectations![index]) : null,
        actual: displayValue(outcome.value),
        error: null,
      };
    });
    return { results, logs, codeError: null };
  } catch (error) {
    return { results: [], logs, codeError: explainHidden(errorText(error), input.hidden) };
  }
}

/** True when every case in a completed graded run passed. */
export const allPassed = (run: EvaluateResult): boolean =>
  !run.codeError && !run.timedOut && run.results.length > 0 && run.results.every((result) => result.pass === true);
