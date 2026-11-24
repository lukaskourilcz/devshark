// The contract between react-isolated.ts, which runs in the API, and the guest
// runner (scripts/react-sandbox-entry.ts, bundled to
// lib/coding/generated/react-sandbox.cjs), which grades one React submission
// inside a disposable VM. It lives apart from both so the launch contracts can
// start the real guest bundle with the same flags and read its output by the
// same rules, without the Sandbox SDK.
import type { ReactSuiteOutcome } from './react-runner';
import { suiteCaseCount } from './react-hidden';

/** Node flags for the guest. With code generation from strings disallowed, a
 * host function the component reaches through jsdom or React cannot compile
 * `return process` through its `.constructor`; the page realm itself already
 * refuses `eval` and `Function(...)` (lib/coding/react-runner.ts). */
export const GUEST_NODE_FLAGS = ['--max-old-space-size=256', '--disallow-code-generation-from-strings'];

/** The guest's environment. React's `act` needs the development build
 * (lib/coding/react-runner.ts). The page realm's `Date` reads UTC whatever
 * the zone (shared/coding-utc-time.ts); TZ puts the guest's own realm in UTC
 * too, for the dates jsdom makes there, such as an input's `valueAsDate`.
 * This is the disposable guest, never the API process. */
export const GUEST_ENV: Readonly<Record<string, string>> = { NODE_ENV: 'development', TZ: 'UTC' };

/** What the guest reads from its input file, then deletes before learner code runs. */
export interface GuestInput {
  suite: string;
  appSource: string;
  nonce: string;
  compiledApp?: string;
  compiledFixtures?: Record<string,string>;
}

/** The line that carries the result: the nonce, one space, the JSON. It
 * starts with a line break, so nothing printed before it can join it. */
export const guestResultLine = (nonce: string, json: string): string => `\n${nonce} ${json}\n`;

/** The line the guest prints once its own setup is done, just before the
 * suite loads the learner's code. A guest that ends without a result after
 * this line was ended by that code; one that ends before it is a runner
 * failure. The nonce is gone before learner code runs, so nothing else can
 * print it. */
export const guestStartedLine = (nonce: string): string => `\n${nonce}:started\n`;

// Package versions are the only guest metadata copied to operational logs.
export function snapshotVersionDrift(stdout: string, nonce: string): Record<string, string> | null {
  const marker = `\n${nonce}:versions `;
  const start = stdout.indexOf(marker);
  if (start < 0) return null;
  const line = stdout.slice(start + marker.length, start + marker.length + 1024).split('\n', 1)[0];
  let record: unknown;
  try { record = JSON.parse(line); } catch { return null; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const drift: Record<string, string> = {};
  for (const name of ['react', 'react-dom', 'jsdom', '@testing-library/react', '@testing-library/dom', 'sucrase']) {
    const value = Object.getOwnPropertyDescriptor(record, name)?.value;
    if (typeof value === 'string' && /^[0-9][a-z0-9.+-]{0,39}\/(?:missing|[0-9][a-z0-9.+-]{0,39})$/i.test(value)) drift[name] = value;
  }
  return Object.keys(drift).length ? drift : null;
}

/** What the learner reads when their code ended the guest before it could
 * report: the heap limit is the usual way (an endless chain of promises or
 * updates). */
export const GUEST_CRASHED_MESSAGE =
  'Your code stopped the test runner before it could report: it most likely ran out of memory, for example in an endless chain of promises or state updates.';

// Captured when this module loads, which in the guest is before any learner
// code runs. The serializer below uses nothing else.
const ownDescriptor = Reflect.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const quote = JSON.stringify;
const isFiniteNumber = Number.isFinite;

/** An own data property, or undefined. Never runs a getter and never looks
 * at the prototype chain. */
const ownData = (target: unknown, key: string | number): unknown => {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) return undefined;
  const descriptor = ownDescriptor(target, key);
  return descriptor !== undefined && hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
/** A string as JSON. JSON.stringify on a primitive string consults no
 * `toJSON`, so this cannot run anything else. */
const jsonText = (value: string): string => quote(value) as string;
const jsonNullableText = (value: unknown): string => (typeof value === 'string' ? jsonText(value) : 'null');

/**
 * The guest's verdict as a JSON string, built by hand from the result's own
 * data properties.
 *
 * The component under test can reach objects of the grader's realm (React's
 * exports, jsdom), and through them the realm's `Object.prototype` and
 * `Array.prototype`. `JSON.stringify(result)` asks every object and array in
 * the result for a `toJSON` up that chain, so a component that put one there
 * rewrote the printed verdict: every case, hidden ones included, passed. This
 * reads each field by descriptor with functions captured before any learner
 * code ran, accepts only the outcome's shape (anything else throws, which the
 * guest reports as a failed run), and writes the JSON itself.
 */
export function serializeGuestResult(result: unknown): string {
  const cases = ownData(result, 'cases');
  if (!isArray(cases)) throw new Error('Malformed result');
  const length = ownData(cases, 'length');
  if (typeof length !== 'number' || length > 500) throw new Error('Malformed result');
  let json = '{"cases":[';
  let passed = 0;
  for (let index = 0; index < length; index++) {
    const one = ownData(cases, index);
    const name = text(ownData(one, 'name'));
    const status = ownData(one, 'status');
    const error = ownData(one, 'error');
    const durationMs = ownData(one, 'durationMs');
    if (name === null || (status !== 'pass' && status !== 'fail') || (error !== null && typeof error !== 'string')) {
      throw new Error('Malformed result');
    }
    if (status === 'pass') passed++;
    json += `${index > 0 ? ',' : ''}{"name":${jsonText(name)},"status":"${status}","error":${jsonNullableText(error)},"durationMs":${typeof durationMs === 'number' && isFiniteNumber(durationMs) ? `${durationMs}` : '0'}}`;
  }
  const compileError = ownData(result, 'compileError');
  const timedOut = ownData(result, 'timedOut');
  if ((compileError !== null && typeof compileError !== 'string') || typeof timedOut !== 'boolean') throw new Error('Malformed result');
  // Counts follow the cases, as readGuestResult recomputes them anyway.
  const total = length > 0 ? length : 1;
  json += `],"passed":${passed},"failed":${total - passed},"total":${total},"compileError":${jsonNullableText(compileError)},"timedOut":${timedOut ? 'true' : 'false'}}`;
  return json;
}

/**
 * The outcome of one guest run, from its exit code and stdout. A run that
 * exited cleanly is read by `readGuestResult`. One that crashed after the
 * started line (`guestStartedLine`) was crashed by the learner's code, which
 * is an error in that code and recorded as one; one that crashed before it
 * throws, as a runner failure the API reports as an outage. A run stopped at
 * its deadline (exit 137 or 124) is the caller's to report as a timeout.
 */
export function readGuestRun(exitCode: number | null, stdout: string, nonce: string, suite: string): ReactSuiteOutcome {
  if (exitCode === 0) return readGuestResult(stdout, nonce, suite);
  if (stdout.includes(guestStartedLine(nonce))) {
    return { cases: [], passed: 0, failed: 1, total: 1, compileError: GUEST_CRASHED_MESSAGE, timedOut: false };
  }
  throw new Error('Isolated React runner exited unsuccessfully');
}

/**
 * Reads the verdict out of the guest's stdout. Only a line that starts with
 * this run's nonce counts, and there must be exactly one; the JSON must have
 * the outcome's shape; and a run that compiled must report exactly as many
 * cases as the suite declares (visible and hidden together). Anything else is
 * a runner failure, never a pass. Pass counts are recomputed from the cases.
 */
export function readGuestResult(stdout: string, nonce: string, suite: string): ReactSuiteOutcome {
  const marker = `\n${nonce} `;
  const start = stdout.indexOf(marker);
  if (start < 0 || stdout.indexOf(marker, start + 1) >= 0) throw new Error('React runner printed no result');
  const end = stdout.indexOf('\n', start + marker.length);
  const data = stdout.slice(start + marker.length, end < 0 ? undefined : end);
  if (data.length > 256_000) throw new Error('Invalid React runner response');
  const result = JSON.parse(data) as ReactSuiteOutcome;
  if (
    !result ||
    !Array.isArray(result.cases) ||
    result.cases.length > 500 ||
    !result.cases.every(
      (one) =>
        one &&
        typeof one.name === 'string' &&
        (one.status === 'pass' || one.status === 'fail') &&
        (one.error === null || typeof one.error === 'string'),
    ) ||
    typeof result.timedOut !== 'boolean' ||
    (result.compileError !== null && typeof result.compileError !== 'string')
  ) {
    throw new Error('Malformed React runner response');
  }
  // A run that compiled reports every case the suite declares, and no others.
  if (result.compileError === null && result.cases.length !== suiteCaseCount(suite)) {
    throw new Error('React runner reported the wrong number of cases');
  }
  const passed = result.cases.filter((one) => one.status === 'pass').length;
  return {
    ...result,
    passed,
    total: Math.max(1, result.cases.length),
    failed: Math.max(1, result.cases.length) - passed,
  };
}
