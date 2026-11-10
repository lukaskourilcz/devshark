import type { TaskRuntimePolicy } from '../../../../shared/coding-task-runtime';
// Runs a JavaScript or TypeScript task in the runner worker with a hard
// budget. Never rejects: a hung loop resolves as timed out once the worker is
// terminated, a crash resolves as a code error, and a runner that never
// loaded resolves as unavailable, which says nothing about the code.
import {
  ASYNC_TIMEOUT_MS,
  RUN_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
  TYPE_CHECK_STOPPED_MESSAGE,
  type EvaluateResult,
} from '../../../../shared/coding-evaluate';
import type { TypeCheckResult, TypeTestInput } from '../../../../shared/coding-ts-check';
import type { CallTest } from '../../../../shared/coding-catalog';
import type { RunnerRequest } from './worker';

/** Loading the runner, and for the first TypeScript run the compiler (about
 * 1 MB) and its lib files. Running out of it is the network's doing. */
export const COMPILE_TIMEOUT_MS = 45_000;
/** Checking the learner's types once the compiler is loaded. A task's checks
 * take well under a second; a type that keeps recursing is stopped here and
 * reported as a type problem, not a loop. The server stops the same check
 * after 4 s, and Submit never waits for this one. */
export const TYPE_CHECK_TIMEOUT_MS = 8_000;

export type RunPhase = 'starting' | 'compiling' | 'checking' | 'running';

export interface RunOutcome extends EvaluateResult {
  check: TypeCheckResult | null;
  timedOut: boolean;
  /** The runner or the compiler never loaded (offline, or a failed
   * download). Nothing ran, so nothing is said about the code. */
  runnerUnavailable?: boolean;
}

export interface RunInput {
  runtimePolicy?: TaskRuntimePolicy;
  track: 'javascript' | 'typescript';
  code: string;
  tests: CallTest[];
  typeTests?: TypeTestInput[];
  /** false = the Run button: report values, grade nothing. */
  grade?: boolean;
  onPhase?: (phase: RunPhase) => void;
  signal?: AbortSignal;
}

const runnerWorker = (): Worker => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

const EMPTY: RunOutcome = { results: [], logs: [], codeError: null, check: null, timedOut: false };
const UNAVAILABLE: Partial<RunOutcome> = { runnerUnavailable: true };

type WorkerMessage = { phase: string } & Partial<RunOutcome> & { js?: string };

/** One run in a fresh worker, so no run sees another's realm. `starting`:
 * this is the run's first step, so the clock that follows counts the
 * worker's download. `check`: the types the shared compiler checked, kept
 * with a run that finished, as one worker used to answer. */
function runInWorker(request: RunnerRequest, input: RunInput, budget: number, starting: boolean, check?: TypeCheckResult): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = runnerWorker();
    } catch {
      resolve({ ...EMPTY, ...UNAVAILABLE });
      return;
    }

    let settled = false;
    let started = false;
    let timer: number | undefined;
    const finish = (payload: Partial<RunOutcome>) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.terminate();
      resolve({ ...EMPTY, ...payload });
    };
    const arm = (ms: number, payload: Partial<RunOutcome>) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => finish(payload), ms);
    };

    if (input.signal?.aborted) { finish({ codeError: 'Cancelled' }); return; }
    input.signal?.addEventListener('abort', () => finish({ codeError: 'Cancelled' }), { once: true });
    if (starting) input.onPhase?.('starting');
    // Until the worker answers, the clock measures the download, not the code.
    arm(COMPILE_TIMEOUT_MS, UNAVAILABLE);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      started = true;
      if (message.phase === 'compiling') {
        input.onPhase?.('compiling');
        arm(COMPILE_TIMEOUT_MS, UNAVAILABLE);
        return;
      }
      if (message.phase === 'checking') {
        input.onPhase?.('checking');
        arm(TYPE_CHECK_TIMEOUT_MS, { timedOut: true, codeError: TYPE_CHECK_STOPPED_MESSAGE });
        return;
      }
      if (message.phase === 'running') {
        input.onPhase?.('running');
        arm(budget, { timedOut: true, codeError: TIMEOUT_MESSAGE });
        return;
      }
      finish(check ? { ...message, check } : message);
    };
    // An error with a message came from the learner's code; one without, before
    // the worker ever answered, is a script that did not load.
    worker.onerror = (event) => {
      const message = (event as ErrorEvent).message;
      finish(message ? { codeError: String(message) } : started ? { codeError: 'The runner crashed.' } : UNAVAILABLE);
    };
    worker.postMessage(request);
  });
}

/* ── The TypeScript compiler, kept between Runs ──────────────────────────
 * The compiler is about 1 MB gzip and 4 MB of JavaScript to evaluate. It used
 * to load in every Run's worker, so each Run parsed and evaluated it again
 * (perf baseline #587 C01). One compiler worker now stays loaded while a
 * TypeScript task is open: it type-checks and transpiles, and never runs the
 * learner's code, which still runs in a fresh worker per Run, so no Run sees
 * what an earlier one did to its realm. The checks are the same program the
 * Run worker built; only where they happen moved. A check that stopped (its
 * clock, its stack) or a worker that failed is dropped, as the server's
 * type-check pool drops its thread, and the next Run starts a new one. */

interface Compiler {
  worker: Worker;
  /** The job using the worker now. */
  job: ((message: WorkerMessage) => void) | null;
  fail: ((event: ErrorEvent) => void) | null;
  /** Settles when the job in progress, if any, has. */
  idle: Promise<void>;
  release: number | undefined;
}

/** How long a loaded compiler outlives the last screen that held it, so the
 * next TypeScript task (Next, a stage of a project) finds it loaded. */
export const COMPILER_KEEP_MS = 30_000;
/** How long a Run waits for a check an earlier Run left behind before it
 * drops that worker and starts a fresh one: a task's checks take well under a
 * second, and a runaway one would hold the next Run for its whole 8 s. */
export const ABANDONED_CHECK_GRACE_MS = 1_000;

let compiler: Compiler | null = null;
/** Task screens holding a compiler (holdCompiler), whichever worker it is:
 * one started after a dropped one is held too. */
let holders = 0;

function dropCompiler(which: Compiler): void {
  if (compiler === which) compiler = null;
  window.clearTimeout(which.release);
  which.worker.terminate();
}

/** Close an idle compiler nobody holds, after COMPILER_KEEP_MS. */
function scheduleRelease(which: Compiler): void {
  window.clearTimeout(which.release);
  which.release = undefined;
  if (holders > 0 || which.job || compiler !== which) return;
  which.release = window.setTimeout(() => { if (holders === 0 && !which.job) dropCompiler(which); }, COMPILER_KEEP_MS);
}

/** The shared compiler worker, started if there is none. `warm`: also load
 * the compiler now rather than with the first check. */
function sharedCompiler(warm: boolean): Compiler | null {
  if (compiler) return compiler;
  let worker: Worker;
  try {
    worker = runnerWorker();
  } catch {
    return null;
  }
  const created: Compiler = { worker, job: null, fail: null, idle: Promise.resolve(), release: undefined };
  worker.onmessage = (event: MessageEvent<WorkerMessage & { ready?: boolean }>) => {
    if (event.data?.phase === 'warm') {
      // The compiler did not download: this worker keeps that failure.
      if (event.data.ready === false && !created.job) dropCompiler(created);
      return;
    }
    created.job?.(event.data);
  };
  worker.onerror = (event) => {
    if (created.fail) created.fail(event as ErrorEvent);
    else dropCompiler(created);
  };
  compiler = created;
  if (warm) {
    const request: RunnerRequest = { track: 'typescript', code: '', calls: [], expectations: null, warm: true, compiler: true };
    worker.postMessage(request);
  }
  scheduleRelease(created);
  return created;
}

/** Keep the compiler loaded while a TypeScript task is on screen, and start
 * loading it now. Returns the release. A visitor who asked the browser to
 * save data loads it on the first Run instead. */
export function holdCompiler(): () => void {
  if (typeof Worker === 'undefined') return () => {};
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return () => {};
  holders += 1;
  const held = sharedCompiler(true);
  if (held) window.clearTimeout(held.release);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (compiler) scheduleRelease(compiler);
  };
}

/** Whether a compiler is loaded or loading, so a new TypeScript task can hold
 * it without asking for a download. */
export const compilerStarted = (): boolean => compiler !== null;

type Compiled = { js: string; check: TypeCheckResult } | { outcome: Partial<RunOutcome> };

/** Check and transpile on the shared compiler. Resolves when the job ends,
 * whatever the caller does meanwhile: an abandoned check still has its clock,
 * so a runaway one is stopped and its worker dropped. */
function compileShared(which: Compiler, input: RunInput, onPhase: (phase: RunPhase) => void): Promise<Compiled> {
  const done = new Promise<Compiled>((resolve) => {
    let timer: number | undefined;
    let started = false;
    let checking = false;
    let ended = false;
    const end = (result: Compiled, keep: boolean) => {
      if (ended) return;
      ended = true;
      window.clearTimeout(timer);
      input.signal?.removeEventListener('abort', orphan);
      which.job = null;
      which.fail = null;
      if (keep) scheduleRelease(which);
      else dropCompiler(which);
      resolve(result);
    };
    let deadline = 0;
    const arm = (ms: number, outcome: Partial<RunOutcome>) => {
      window.clearTimeout(timer);
      deadline = Date.now() + ms;
      timer = window.setTimeout(() => end({ outcome }, false), ms);
    };
    // A check its Run no longer waits for (the Run was cancelled, or the task
    // left) has ABANDONED_CHECK_GRACE_MS to finish, then its worker is
    // dropped: a runaway type no longer spins in the background for the rest
    // of its 8 s, where a Run's own worker used to be stopped at once. A
    // compiler still downloading is kept for the next Run.
    function orphan(): void {
      if (ended || !checking || deadline - Date.now() <= ABANDONED_CHECK_GRACE_MS) return;
      arm(ABANDONED_CHECK_GRACE_MS, { codeError: 'Cancelled' });
    }
    input.signal?.addEventListener('abort', orphan, { once: true });
    arm(COMPILE_TIMEOUT_MS, UNAVAILABLE);
    which.job = (message) => {
      started = true;
      if (message.phase === 'compiling') {
        onPhase('compiling');
        arm(COMPILE_TIMEOUT_MS, UNAVAILABLE);
        return;
      }
      if (message.phase === 'checking') {
        checking = true;
        onPhase('checking');
        arm(TYPE_CHECK_TIMEOUT_MS, { timedOut: true, codeError: TYPE_CHECK_STOPPED_MESSAGE });
        if (input.signal?.aborted) orphan();
        return;
      }
      if (message.phase === 'compiled' && typeof message.js === 'string' && message.check) {
        end({ js: message.js, check: message.check }, true);
        return;
      }
      // The worker's last word without JavaScript: code that did not
      // transpile keeps the loaded compiler; a compiler that did not load or
      // a check that stopped does not.
      end({ outcome: message }, Boolean(message.check) && !message.runnerUnavailable && !message.timedOut);
    };
    which.fail = (event) => {
      const message = event.message;
      end({ outcome: message ? { codeError: String(message) } : started ? { codeError: 'The runner crashed.' } : UNAVAILABLE }, false);
    };
    window.clearTimeout(which.release);
    const request: RunnerRequest = {
      track: 'typescript', code: input.code, calls: [], expectations: null, typeTests: input.typeTests, compileOnly: true,
    };
    which.worker.postMessage(request);
  });
  which.idle = done.then(() => undefined);
  return done;
}

/** A TypeScript Run: the shared compiler checks and transpiles, then a fresh
 * worker runs the JavaScript. The phases and clocks are the ones one worker
 * used to report: starting, compiling, checking, running. */
async function runTypeScript(input: RunInput, budget: number): Promise<RunOutcome> {
  const cancelled = new Promise<'cancelled'>((resolve) => {
    if (input.signal?.aborted) resolve('cancelled');
    input.signal?.addEventListener('abort', () => resolve('cancelled'), { once: true });
  });
  const stopped: RunOutcome = { ...EMPTY, codeError: 'Cancelled' };
  let live = true;
  const onPhase = (phase: RunPhase) => { if (live) input.onPhase?.(phase); };
  onPhase('starting');
  // The compiler job owns its deadline. A queued caller waits for it or
  // its own cancellation, and cannot stop another active caller's check.
  while (compiler?.job) {
    if (await Promise.race([compiler.idle, cancelled]) === 'cancelled') return stopped;
  }
  if (input.signal?.aborted) return stopped;
  const shared = sharedCompiler(false);
  if (!shared) return { ...EMPTY, ...UNAVAILABLE };
  const compiled = await Promise.race([compileShared(shared, input, onPhase), cancelled]);
  live = false;
  if (compiled === 'cancelled') return stopped;
  if ('outcome' in compiled) return { ...EMPTY, ...compiled.outcome };
  const request: RunnerRequest = {
    runtimePolicy: input.runtimePolicy,
    track: 'javascript',
    code: compiled.js,
    calls: input.tests.map((test) => test.call),
    expectations: input.grade === false ? null : input.tests.map((test) => test.expected),
  };
  return runInWorker(request, input, budget, false, compiled.check);
}

export function runCodeTests(input: RunInput): Promise<RunOutcome> {
  const budget = input.tests.some((test) => test.async) ? ASYNC_TIMEOUT_MS : RUN_TIMEOUT_MS;
  if (input.track === 'typescript') return runTypeScript(input, budget);
  const request: RunnerRequest = {
    runtimePolicy: input.runtimePolicy,
    track: input.track,
    code: input.code,
    calls: input.tests.map((test) => test.call),
    expectations: input.grade === false ? null : input.tests.map((test) => test.expected),
    typeTests: input.typeTests,
  };
  return runInWorker(request, input, budget, true);
}

/** The runner's script has answered once in this page. */
let runnerWarm = false;

/** Loads the runner's script while the learner reads the task, so the first
 * Run does not wait for it and still works if the connection drops
 * afterwards. The file stays in the browser's cache; the worker that fetched
 * it is closed. TypeScript's compiler is not part of it: holdCompiler loads
 * it once the learner reaches for the code. A visitor who asked the browser
 * to save data downloads the runner on the first Run instead. */
export function warmRunner(track: 'javascript' | 'typescript'): () => void {
  if (typeof Worker === 'undefined') return () => {};
  if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return () => {};
  // One script serves every track, and once it answered it is in the cache:
  // the next task, or a return to this one, starts no worker to fetch it
  // again (perf baseline #587 C23).
  if (runnerWarm) return () => {};
  let worker: Worker | null = null;
  try {
    worker = runnerWorker();
  } catch {
    return () => {};
  }
  const close = () => { worker?.terminate(); worker = null; };
  const timer = window.setTimeout(close, COMPILE_TIMEOUT_MS);
  worker.onmessage = () => { runnerWarm = true; window.clearTimeout(timer); close(); };
  worker.onerror = () => { window.clearTimeout(timer); close(); };
  const request: RunnerRequest = { track, code: '', calls: [], expectations: null, warm: true };
  worker.postMessage(request);
  return () => { window.clearTimeout(timer); close(); };
}

/** True when the run is a pass: every call matched and, for TypeScript, the types were clean. */
export function runPassed(outcome: RunOutcome): boolean {
  if (outcome.codeError || outcome.timedOut || outcome.runnerUnavailable || outcome.results.length === 0) return false;
  if (!outcome.results.every((result) => result.pass === true)) return false;
  if (outcome.check && (outcome.check.codeErrors.length > 0 || outcome.check.typeTests.some((one) => !one.pass))) return false;
  return true;
}
