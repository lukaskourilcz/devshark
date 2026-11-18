/** Server-side execution of learner JavaScript inside QuickJS (WebAssembly).
 *
 * Nothing from the host is reachable: no `process`, no `require`, no network,
 * no real timers. Timers are virtual, so a debounce task that waits 80 ms
 * finishes in microseconds and the same code grades the same way every time.
 * A memory limit, a stack limit and a CPU deadline bound every run. This is
 * the verdict of record for JavaScript and TypeScript tasks.
 *
 * The run happens on a worker thread. QuickJS checks its deadline between
 * bytecode instructions, so a loop that spends its time inside native calls
 * (`"x".repeat(2e6)` over and over) overran it by minutes, and on the request
 * thread that blocked every other request the instance served. The host now
 * stops the thread when the deadline and a short grace have passed. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule, type QuickJSHandle } from 'quickjs-emscripten';
import variant from './quickjs-variant';
import type { EvaluateResult } from '../../shared/coding-evaluate';
import { LOG_LINE_CUT, LOG_OUTPUT_CUT, MAX_LOG_CHARS, MAX_LOG_LINE_CHARS, MAX_LOGS, PROBE_IS_INDEX_SOURCE, PROBE_LINE, TIMEOUT_MESSAGE, deepEqual, displayValue } from '../../shared/coding-evaluate';
import { cutErrorText } from '../../shared/coding-error-text';
import { dumpThrown } from './vm-errors';
import { CONSOLE_SOURCE } from '../../shared/coding-console';
import { UTC_TIME_SOURCE } from '../../shared/coding-utc-time';
import { TASK_RUNTIME_POLICY_SOURCE, type TaskRuntimePolicy } from '../../shared/coding-task-runtime';
import { LOCALE_SOURCE } from '../../shared/coding-locale';
import { hostURL, MAX_URL_TEXT, WEB_APIS_SOURCE } from './sandbox-web-apis';
import { bootBackoff, GraderBusyError, inThreadGradingAllowed, threadSlots } from './grader-capacity';

let modulePromise: Promise<QuickJSWASMModule> | null = null;
const getModule = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant));

export interface SandboxInput {
  runtimePolicy?: TaskRuntimePolicy;
  code: string;
  calls: string[];
  expectations: unknown[] | null;
  /** How many leading calls the learner may see the console output of. The
   * rest are hidden checks: they start only once the shown calls have settled,
   * and nothing they print comes back, so a learner who logs inside a function
   * never reads a hidden input. Defaults to every call. */
  shownCalls?: number;
  /** CPU budget for the whole run. */
  deadlineMs?: number;
  memoryBytes?: number;
}

export const SANDBOX_DEADLINE_MS = 2_500;
/** QuickJS heap per run. */
export const SANDBOX_MEMORY_BYTES = 64 * 1024 * 1024;
/** QuickJS stack per run. */
export const SANDBOX_STACK_BYTES = 1024 * 1024;
/** Rounds of jobs and timers a run may take before it counts as a timeout. */
export const SANDBOX_MAX_TICKS = 10_000;
/** What a learner sees when their call chain ran out of stack. Named rather
 * than inlined so the message reads the same wherever the overflow surfaces. */
const STACK_MESSAGE = 'The call stack ran out of room: the recursion went too deep, or a base case is never reached.';
const NEVER_SETTLED_MESSAGE = 'A call never settled: a promise or timer is still pending.';
const STOPPED_MESSAGE = 'The run stopped unexpectedly.';
const OUT_OF_MEMORY_MESSAGE = 'Out of memory.';
/** The messages a hidden run may pass on to the learner. Each names what
 * stopped the run; none carries text the program produced, which could spell
 * out a hidden input. */
const HIDDEN_RUN_MESSAGES: ReadonlySet<string> = new Set([TIMEOUT_MESSAGE, STACK_MESSAGE, NEVER_SETTLED_MESSAGE, STOPPED_MESSAGE, OUT_OF_MEMORY_MESSAGE]);
/** What a hidden run that failed any other way reports. */
export const HIDDEN_RUN_FAILED_MESSAGE = 'A hidden check could not run.';

/** Where the host's URL parser waits for the program, which takes it and
 * deletes the name before any learner code runs. */
const URL_HOST_NAME = '__devsharkHostURL';

/** A prelude without its comment lines and indentation: QuickJS parses every
 * character of the program on every run. None of the preludes has a
 * multi-line string, so this changes no code. */
const compact = (source: string): string => source.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//')).join('\n');
// Most runs never read a date, format a number or parse a URL, so these are
// kept as text and compiled the first time learner code reaches for them.
const UTC_TIME = JSON.stringify(compact(UTC_TIME_SOURCE));
const LOCALE = JSON.stringify(compact(LOCALE_SOURCE));
const WEB_APIS = JSON.stringify(compact(WEB_APIS_SOURCE));

// The learner is compiled in a separate strict function scope. This controller
// stays in an inaccessible closure held by the host, never in VM globals.
// Expected values and pass/fail comparison stay entirely outside QuickJS.
function program(code: string, calls: string[], shownCalls: number, runtimePolicy?: TaskRuntimePolicy): string {
  return `(() => {
'use strict';
const hostURL = globalThis.${URL_HOST_NAME};
delete globalThis.${URL_HOST_NAME};
const apply = Reflect.apply, keys = Object.keys, isArray = Array.isArray;
const setPrototype = Object.setPrototypeOf, stringify = JSON.stringify;
const NativeFunction = Function;
const string = String, number = Number, is = Object.is;
// What a check's probe counts with, taken before the learner's code runs
// (see PROBE_LINE).
const probe = Object.freeze({ Proxy, get: Reflect.get, isIndex: ${PROBE_IS_INDEX_SOURCE}, freeze: Object.freeze, keys: Object.keys, ownDescriptor: Object.getOwnPropertyDescriptor, setPrototypeOf: Object.setPrototypeOf, defineProperty: Object.defineProperty, deleteProperty: Reflect.deleteProperty });
const makeArray = () => setPrototype([], null);
const packet = (...values) => setPrototype(values, null);
let now = 0, nextId = 1, timers = makeArray(), logs = makeArray();
let done = false, output = null, shownLogs = -1;
const encode = (value, depth = 0, seen = makeArray()) => {
  if (depth > 40) throw new Error('Result nesting limit exceeded');
  if (value === undefined) return packet('undefined');
  if (value === null) return packet('null');
  if (typeof value === 'number') return packet('number', is(value, -0) ? '-0' : string(value));
  if (typeof value === 'string' || typeof value === 'boolean') return packet(typeof value, value);
  if (typeof value !== 'object') throw new Error('Result is not cloneable');
  for (let i = 0; i < seen.length; i++) if (seen[i] === value) throw new Error('Circular result');
  seen[seen.length] = value;
  const entries = makeArray();
  const names = isArray(value) ? null : keys(value);
  const length = names ? names.length : value.length;
  if (length > 10000) throw new Error('Result size limit exceeded');
  for (let i = 0; i < length; i++) {
    entries[entries.length] = names ? packet(names[i], encode(value[names[i]], depth + 1, seen)) : encode(value[i], depth + 1, seen);
  }
  seen.length--;
  return packet(names ? 'object' : 'array', entries);
};
const message = error => { try { return string(error && error.message || error); } catch { return 'Evaluation failed'; } };
const sliceText = String.prototype.slice;
let logChars = 0, logsCut = false;
const emit = line => {
  if (logsCut || logs.length >= ${MAX_LOGS}) return;
  const text = line.length > ${MAX_LOG_LINE_CHARS} ? apply(sliceText, line, [0, ${MAX_LOG_LINE_CHARS}]) + ${JSON.stringify(LOG_LINE_CUT)} : line;
  if (logChars + text.length > ${MAX_LOG_CHARS}) { logs[logs.length] = ${JSON.stringify(LOG_OUTPUT_CUT)}; logsCut = true; return; }
  logChars += text.length;
  logs[logs.length] = text;
};
// Past the cap emit drops the line, so the arguments are not turned into
// JSON first: a loop that logs a big array would spend the deadline there.
const format = value => {
  if (logsCut || logs.length >= ${MAX_LOGS}) return '';
  if (typeof value === 'string') return value;
  try { const text = stringify(value); return text === undefined ? string(value) : text; } catch { return '[unprintable]'; }
};
const record = args => {
  let line = '';
  for (let i = 0; i < args.length; i++) line += (i ? ' ' : '') + format(args[i]);
  emit(line);
};
const schedule = (fn, ms, interval, args) => {
  const id = nextId++, delay = number(ms) || 0;
  timers[timers.length] = { id, at: now + (delay > 0 ? delay : 0), fn, args, interval: interval ? (delay > 1 ? delay : 1) : null };
  return id;
};
globalThis.setTimeout = (fn, ms, ...args) => schedule(fn, ms, false, args);
globalThis.setInterval = (fn, ms, ...args) => schedule(fn, ms, true, args);
globalThis.clearTimeout = globalThis.clearInterval = id => {
  const kept = makeArray();
  for (let i = 0; i < timers.length; i++) if (timers[i].id !== id) kept[kept.length] = timers[i];
  timers = kept;
};
globalThis.queueMicrotask = fn => { void (async () => { await 0; fn(); })(); };
// One clock for every way of asking the time: Date.now, new Date() and Date()
// all read the virtual clock the timers advance, so code that times itself
// with new Date() grades the way it runs in the browser. Local time is UTC,
// as in Run (shared/coding-utc-time.ts), whatever the server's own zone. Every date comes from the global Date, so the realm's
// Date is rewritten in place the first time learner code reads that name.
const RealDate = Date;
const clock = () => 1700000000000 + now;
const defineProperty = Object.defineProperty;
const once = (source, ...args) => {
  let done = false, result;
  return () => { if (!done) { done = true; result = NativeFunction('return ' + source)()(...args); } return result; };
};
const utcDate = once(${UTC_TIME}, RealDate, { clock, inPlace: true });
const settle = (name, value) => defineProperty(globalThis, name, { value, writable: true, enumerable: false, configurable: true });
defineProperty(globalThis, 'Date', {
  get() { settle('Date', utcDate()); return globalThis.Date; },
  set(value) { utcDate(); settle('Date', value); },
  enumerable: false, configurable: true,
});
globalThis.performance = { now: () => now };
// toLocaleString and localeCompare as Run has them (shared/coding-locale.ts),
// and the web APIs Run has: URL, URLSearchParams, TextEncoder, TextDecoder,
// atob and btoa (sandbox-web-apis.ts), each set compiled on first use too.
const locale = once(${LOCALE}, globalThis);
const localeMethods = [[Number.prototype, 'toLocaleString', 0], [BigInt.prototype, 'toLocaleString', 0], [String.prototype, 'localeCompare', 1], [String.prototype, 'toLocaleUpperCase', 0], [String.prototype, 'toLocaleLowerCase', 0], [Array.prototype, 'toLocaleString', 0], [Object.getPrototypeOf(Uint8Array.prototype), 'toLocaleString', 0]];
for (const [target, name, length] of localeMethods) {
  const method = { [name](...args) { locale(); return apply(target[name], this, args); } }[name];
  defineProperty(method, 'length', { value: length, configurable: true });
  defineProperty(target, name, { value: method, writable: true, enumerable: false, configurable: true });
}
const webAPIs = once(${WEB_APIS}, globalThis, hostURL);
for (const name of ['URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'atob', 'btoa']) {
  defineProperty(globalThis, name, {
    get() { webAPIs(); return globalThis[name]; },
    set(value) { webAPIs(); globalThis[name] = value; },
    enumerable: false, configurable: true,
  });
}
// structuredClone as the browser has it: a deep copy that keeps Maps, Sets,
// Dates, RegExps, undefined, NaN and shared or circular references, drops
// prototypes, and refuses functions and symbols.
const NativeMap = Map, NativeSet = Set, NativeRegExp = RegExp, NativeError = Error, NativeObject = Object;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapHas = Map.prototype.has, mapEach = Map.prototype.forEach;
const setAdd = Set.prototype.add, setEach = Set.prototype.forEach, dateTime = RealDate.prototype.getTime;
const objectTag = Object.prototype.toString, isView = ArrayBuffer.isView;
const tagOf = value => apply(objectTag, value, []);
const refuse = what => { const error = new NativeError(what + ' could not be cloned.'); error.name = 'DataCloneError'; return error; };
globalThis.structuredClone = value => {
  const copies = new NativeMap();
  const copy = item => {
    if (typeof item === 'function') throw refuse('A function');
    if (typeof item === 'symbol') throw refuse('A symbol');
    if (item === null || typeof item !== 'object') return item;
    if (apply(mapHas, copies, [item])) return apply(mapGet, copies, [item]);
    const tag = tagOf(item);
    let out;
    if (tag === '[object Date]') out = new RealDate(apply(dateTime, item, []));
    else if (tag === '[object RegExp]') out = new NativeRegExp(item.source, item.flags);
    else if (tag === '[object Boolean]' || tag === '[object Number]' || tag === '[object String]') out = NativeObject(item.valueOf());
    else if (tag === '[object ArrayBuffer]' || (isView(item) && typeof item.slice === 'function')) out = item.slice(0);
    else if (tag === '[object Map]') {
      out = new NativeMap();
      apply(mapSet, copies, [item, out]);
      apply(mapEach, item, [(entry, key) => { apply(mapSet, out, [copy(key), copy(entry)]); }]);
      return out;
    } else if (tag === '[object Set]') {
      out = new NativeSet();
      apply(mapSet, copies, [item, out]);
      apply(setEach, item, [entry => { apply(setAdd, out, [copy(entry)]); }]);
      return out;
    } else if (tag === '[object Error]') {
      out = new NativeError(item.message);
      out.name = item.name;
    } else if (tag === '[object Promise]' || tag === '[object WeakMap]' || tag === '[object WeakSet]' || tag === '[object Symbol]') {
      throw refuse(tag.slice(8, -1));
    } else {
      out = isArray(item) ? new Array(item.length) : {};
      apply(mapSet, copies, [item, out]);
      const names = keys(item);
      // An own __proto__ key is data, including when its value points back
      // to this clone. Assignment would invoke the inherited setter.
      for (let i = 0; i < names.length; i++) defineProperty(out, names[i], {
        value: copy(item[names[i]]), writable: true, enumerable: true, configurable: true,
      });
      return out;
    }
    apply(mapSet, copies, [item, out]);
    return out;
  };
  return copy(value);
};
globalThis.console = (${CONSOLE_SOURCE})(emit, format, () => now);
(${TASK_RUNTIME_POLICY_SOURCE})(globalThis, ${JSON.stringify(runtimePolicy ?? null)});
const evaluate = NativeFunction(${JSON.stringify(PROBE_LINE + '\n' + code + '\n;return [' + calls.map(call => '() => (' + call.trim().replace(/;+$/, '') + '\n)').join(',') + '];')})(probe);
const outcomes = makeArray();
// Each call counts itself done. The controller never calls \`then\` on a
// promise: that reads the promise's \`constructor\`, which learner code can
// replace with a getter that throws, and a throw there, after a hidden call
// had run, carried the hidden inputs out as the run's error.
const launch = (from, to, next) => {
  let remaining = to - from;
  if (!remaining) { next(); return; }
  const settled = () => { remaining--; if (!remaining) next(); };
  for (let i = from; i < to; i++) {
    const invoke = async () => {
      try { outcomes[i] = packet('value', encode(await evaluate[i]())); }
      catch (error) { outcomes[i] = packet('error', message(error)); }
      settled();
    };
    invoke();
  }
};
// The shown calls run together; the hidden ones start after they settle, so
// every line printed before that point belongs to learner-visible work.
launch(0, ${shownCalls}, () => {
  shownLogs = logs.length;
  launch(${shownCalls}, ${calls.length}, () => { output = stringify(outcomes); done = true; });
});
return {
  done: () => done,
  output: () => output,
  logs: () => {
    if (shownLogs < 0) return stringify(logs);
    const shown = makeArray();
    for (let i = 0; i < shownLogs; i++) shown[i] = logs[i];
    return stringify(shown);
  },
  tick: () => {
    if (!timers.length) return false;
    let first = 0;
    for (let i = 1; i < timers.length; i++) if (timers[i].at < timers[first].at || (timers[i].at === timers[first].at && timers[i].id < timers[first].id)) first = i;
    const timer = timers[first], rest = makeArray();
    for (let i = 0; i < timers.length; i++) if (i !== first) rest[rest.length] = timers[i];
    timers = rest;
    now = timer.at > now ? timer.at : now;
    if (timer.interval !== null) { timer.at = now + timer.interval; timers[timers.length] = timer; }
    try { if (typeof timer.fn === 'function') apply(timer.fn, null, timer.args); }
    catch (error) { record(['timer error: ' + message(error)]); }
    return true;
  },
};
})()`;
}

function decode(value: unknown, depth = 0): unknown {
  if (depth > 40 || !Array.isArray(value)) throw new Error('Malformed result');
  const [type, data] = value;
  if (type === 'undefined') return undefined;
  if (type === 'null') return null;
  if (type === 'number' && typeof data === 'string') return Number(data);
  if (type === 'string' && typeof data === 'string') return data;
  if (type === 'boolean' && typeof data === 'boolean') return data;
  if (type === 'array' && Array.isArray(data)) return data.map(item => decode(item, depth + 1));
  if (type === 'object' && Array.isArray(data)) return Object.fromEntries(data.map(entry => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') throw new Error('Malformed property');
    return [entry[0], decode(entry[1], depth + 1)];
  }));
  throw new Error('Malformed result value');
}

/* ── the worker thread ───────────────────────────────────────────────── */

/** The worker bundle `npm run build:react-runner` writes
 * (scripts/sandbox-worker-entry.ts with QuickJS inside). vercel.json ships
 * it with api/quiz/roadmap.ts. */
export const SANDBOX_WORKER_FILE = 'lib/coding/generated/quickjs-sandbox.cjs';
/** How long past the run's own deadline the thread may take to answer
 * before it is stopped. A run the interrupt handler catches answers well
 * inside it. */
export const SANDBOX_WORKER_GRACE_MS = 1_500;
/** How long a new thread may take to load QuickJS and pick up the run. */
const WORKER_BOOT_MS = 10_000;
/** Threads running at once; further runs wait for one to finish. */
export const SANDBOX_MAX_THREADS = 4;
/** Runs that may wait for a thread; one more is told the grader is busy. A
 * class of SHARED_NETWORK_SEATS submitting at once queues two runs each, and
 * correct runs drain in milliseconds, so the wait limit below bounds the
 * time and this only bounds the memory. */
export const SANDBOX_MAX_WAITING = 160;
/** How long a run may wait for a thread. A runaway run holds one for its
 * deadline and grace, four seconds, so a run behind a few of them still gets
 * one; a Submit makes two runs, and both waits fit the function's limit. */
export const SANDBOX_SLOT_WAIT_MS = 5_000;
/** Threads kept loaded between runs. */
export const SANDBOX_IDLE_THREADS = 2;

const idleWorkers: Worker[] = [];
/** Threads started and not yet exited: busy, idle or being stopped. */
let liveThreads = 0;
const slots = threadSlots({ threads: SANDBOX_MAX_THREADS, waiting: SANDBOX_MAX_WAITING, waitMs: SANDBOX_SLOT_WAIT_MS, name: 'sandbox' });
/** Runs holding a slot now, warm-ups (`warmSandbox`) excluded. */
let running = 0;
const boot = bootBackoff();
let workerFile: string | null | undefined;

const sandboxWorkerFile = (): string | null => {
  if (workerFile === undefined) {
    const file = join(process.cwd(), SANDBOX_WORKER_FILE);
    workerFile = existsSync(file) ? file : null;
    // Tests and local runs before a build grade in this thread; a deployment
    // that lost the bundle refuses runs. Logged so either shows up.
    if (!workerFile) console.warn(JSON.stringify({ level: 'warn', msg: 'sandbox_worker_missing', file: SANDBOX_WORKER_FILE }));
  }
  return workerFile;
};

type WorkerReply = { type: 'start' } | { type: 'done'; result: EvaluateResult } | { type: 'fail'; message: string };

/** The thread could not be started or never picked the run up: a fault of
 * the host, not of the learner's program. */
class WorkerUnavailableError extends Error {}

const stopped = (codeError: string, timedOut: boolean): EvaluateResult => ({ results: [], logs: [], codeError, timedOut });

function newWorker(file: string): Worker {
  const worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 192 } });
  liveThreads++;
  // An idle thread must not keep the process alive (a run in flight holds a
  // timer that does), and one that dies while idle leaves the pool quietly.
  worker.unref();
  const forget = () => {
    const index = idleWorkers.indexOf(worker);
    if (index >= 0) idleWorkers.splice(index, 1);
  };
  worker.on('error', forget);
  worker.on('exit', forget);
  // A thread emits 'exit' once, after an 'error' too.
  worker.once('exit', () => { liveThreads--; });
  return worker;
}

function runOnWorker(file: string, input: SandboxInput): Promise<EvaluateResult> {
  const idle = idleWorkers.pop();
  const worker = idle ?? newWorker(file);
  return new Promise<EvaluateResult>((resolve, reject) => {
    let settled = false;
    let started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (keep: boolean) => {
      settled = true;
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onFailure);
      worker.off('exit', onFailure);
      if (keep && idleWorkers.length < SANDBOX_IDLE_THREADS) idleWorkers.push(worker);
      else void worker.terminate();
    };
    const finish = (result: EvaluateResult) => {
      if (settled) return;
      settle(false);
      resolve(result);
    };
    const unavailable = (reason: string) => {
      if (settled) return;
      settle(false);
      reject(new WorkerUnavailableError(reason));
    };
    const onMessage = (reply: WorkerReply) => {
      if (settled) return;
      if (reply.type === 'start') {
        started = true;
        // A new thread that picked its run up ends the pause after a failed start.
        if (!idle) boot.started();
        clearTimeout(timer);
        // The run measures its own deadline from here. A run the interrupt
        // handler cannot reach is stopped with the thread.
        timer = setTimeout(() => finish(stopped(TIMEOUT_MESSAGE, true)), (input.deadlineMs ?? SANDBOX_DEADLINE_MS) + SANDBOX_WORKER_GRACE_MS);
        return;
      }
      settle(reply.type === 'done');
      if (reply.type === 'done') { resolve(reply.result); return; }
      // The thread could not run the program at all: QuickJS would not load
      // or would not give it a runtime, before any learner code ran. That is
      // the host's fault, so the caller hears the grader is busy and records
      // nothing, as for a thread that would not start; a plain error was an
      // HTTP 500. The thread is stopped above.
      console.warn(JSON.stringify({ level: 'warn', msg: 'sandbox_worker_run_failed' }));
      reject(new GraderBusyError('sandbox_worker_run_failed'));
    };
    // A thread that dies mid-run (its heap limit, a WebAssembly abort) took
    // the learner's program with it, and says so like any other failed run.
    // One that dies before it picked the run up is the host's problem.
    const onFailure = () => (started ? finish(stopped(STOPPED_MESSAGE, false)) : unavailable('sandbox_worker_failed'));
    worker.on('message', onMessage);
    worker.on('error', onFailure);
    worker.on('exit', onFailure);
    timer = setTimeout(() => unavailable('sandbox_worker_boot_timeout'), WORKER_BOOT_MS);
    worker.postMessage({ type: 'run', input });
  });
}

/** Runs one program on a worker thread. Never throws for learner mistakes:
 * a syntax error, a throw, an infinite loop or a promise that never settles
 * all come back as results the caller can show.
 *
 * Throws `GraderBusyError` when no thread can take the run: every thread is
 * busy and the wait ran out, or a thread would not start. After a thread
 * would not start, a new one is tried again only after a pause
 * (`bootBackoff`); a run in between that has no loaded thread to use is told
 * the grader is busy. Only off a deployment (`inThreadGradingAllowed`) does
 * such a run, or any run when the worker bundle is missing, happen in this
 * thread, as before the worker existed. */
export async function runInSandbox(input: SandboxInput): Promise<EvaluateResult> {
  const file = sandboxWorkerFile();
  if (!file) {
    if (inThreadGradingAllowed()) return runInQuickJS(input);
    throw new GraderBusyError('sandbox_worker_missing', 30);
  }
  await slots.acquire();
  running++;
  try {
    const pause = idleWorkers.length === 0 ? boot.pause() : 0;
    if (pause > 0) {
      if (inThreadGradingAllowed()) return runInQuickJS(input);
      throw new GraderBusyError('sandbox_worker_backoff', pause / 1000);
    }
    return await runOnWorker(file, input);
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error;
    boot.failed();
    console.warn(JSON.stringify({ level: 'warn', msg: 'sandbox_worker_unavailable', reason: error.message }));
    if (inThreadGradingAllowed()) return runInQuickJS(input);
    throw new GraderBusyError(error.message, boot.pause() / 1000);
  } finally {
    running--;
    slots.release();
  }
}

/* ── warming a thread ahead of the first Submit ──────────────────────── */

let warming: Promise<void> | null = null;
/** An empty program: loading QuickJS in a thread is what a warm-up is for. */
const WARM_INPUT: SandboxInput = { code: '', calls: [], expectations: [] };

/**
 * Load one grader thread ahead of a Submit (#587, server item 30). A new
 * thread loads QuickJS on its first run, which made the first Submit on an
 * instance about 70 ms slower than the next (measured offline). A coding task
 * page calls this as it answers; the thread runs an empty program and stays
 * loaded among the idle ones, as any thread does after a run.
 *
 * Only when nothing would use it otherwise: no thread is loaded or being
 * warmed, no run holds a slot, the worker bundle is there and no failed start
 * is pausing new threads. It takes a slot like a run, so it never adds a
 * thread beyond SANDBOX_MAX_THREADS, and a warm-up that fails is not counted as a
 * failed start: the next run tries a thread of its own and decides that. No
 * learner code is involved, and each run still gets a fresh QuickJS runtime
 * and context. The cost is one idle thread on an instance that served a task
 * page but never grades.
 */
export function warmSandbox(): void {
  if (warming || running > 0 || idleWorkers.length > 0 || boot.pause() > 0) return;
  const file = sandboxWorkerFile();
  if (!file) return;
  warming = (async () => {
    await slots.acquire();
    try {
      if (running === 0 && idleWorkers.length === 0) await runOnWorker(file, WARM_INPUT);
    } finally {
      slots.release();
    }
  })().then(() => undefined, () => undefined).finally(() => { warming = null; });
}

/** The pool as tests and diagnostics see it. */
export const sandboxPool = (): { idle: number; warming: boolean } => ({ idle: idleWorkers.length, warming: warming !== null });

/** Grader threads alive now, busy or idle, including one being stopped until
 * it has exited. A test reads it to see that the thread a runaway run held
 * was ended, which `sandboxPool` (idle threads only) cannot show. */
export const sandboxThreads = (): number => liveThreads;

/** Runs one program in this thread. The worker entry calls this; everything
 * else goes through `runInSandbox`. */
export async function runInQuickJS(input: SandboxInput): Promise<EvaluateResult> {
  const QuickJS = await getModule();
  const runtime = QuickJS.newRuntime();
  const deadline = Date.now() + (input.deadlineMs ?? SANDBOX_DEADLINE_MS);
  runtime.setMemoryLimit(input.memoryBytes ?? SANDBOX_MEMORY_BYTES);
  runtime.setMaxStackSize(SANDBOX_STACK_BYTES);
  // Whether QuickJS stopped the program at its deadline. A timeout is read
  // from this, never from an error's text: a learner's own top-level
  // `throw new Error("Download interrupted")` read as an infinite loop.
  let interrupted = false;
  runtime.setInterruptHandler(() => {
    if (Date.now() <= deadline) return false;
    interrupted = true;
    return true;
  });
  const vm = runtime.newContext();
  // The host's URL parser (sandbox-web-apis.ts). Strings in, one string of
  // JSON or null out: no host object reaches the VM, and a string past the
  // limit is refused before it is copied out of the VM.
  const urlFunction = vm.newFunction('url', (...handles) => {
    const args: (string | undefined)[] = [];
    for (const handle of handles.slice(0, 4)) {
      if (vm.typeof(handle) !== 'string') { args.push(undefined); continue; }
      const length = vm.getProp(handle, 'length');
      const tooLong = vm.getNumber(length) > MAX_URL_TEXT;
      length.dispose();
      if (tooLong) return vm.null;
      args.push(vm.getString(handle));
    }
    const answer = hostURL(args[0], args[1], args[2], args[3]);
    return answer === null ? vm.null : vm.newString(answer);
  });
  vm.setProp(vm.global, URL_HOST_NAME, urlFunction);
  urlFunction.dispose();
  let driver: QuickJSHandle | null = null;
  const dumpError = (handle: QuickJSHandle): unknown => dumpThrown(vm, handle);
  const readDriver = (name: string): unknown => {
    if (!driver) return undefined;
    const fn = vm.getProp(driver, name);
    try {
      const result = vm.callFunction(fn, vm.undefined);
      if (result.error) {
        const error = dumpError(result.error) as { message?: string } | undefined;
        throw new Error(error?.message ?? 'Evaluator failed');
      }
      try { return vm.dump(result.value); } finally { result.value.dispose(); }
    } finally { fn.dispose(); }
  };
  const readLogs = (): string[] => {
    const raw = readDriver('logs');
    return typeof raw === 'string' ? JSON.parse(raw) : [];
  };
  const failure = (message: string, timedOut = false): EvaluateResult => {
    let logs: string[] = [];
    try { logs = readLogs(); } catch { /* the VM may be unusable after an interrupt */ }
    return { results: [], logs, codeError: cutErrorText(message), timedOut };
  };
  /** An error QuickJS itself raised when a limit stopped the program:
   * `stack overflow` or `out of memory`. A learner's
   * `throw new Error("stack overflow in my parser")` is not one. */
  const isQuickJSLimit = (error: unknown, message: 'stack overflow' | 'out of memory') =>
    typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'InternalError' && (error as { message?: unknown }).message === message;
  /** An overflow the host itself hit: QuickJS's error passed on by a driver
   * call, V8's RangeError, or the WebAssembly abort a run that exhausted the
   * stack can leave behind. No text the program produced reaches the catch
   * below, so its words can be trusted there. */
  const isHostStackOverflow = (message: string) => /stack overflow|maximum call stack|gc_obj_list/i.test(message);

  try {
    const shownCalls = Math.max(0, Math.min(input.calls.length, Math.floor(input.shownCalls ?? input.calls.length)));
    const evaluated = vm.evalCode(program(input.code, input.calls, shownCalls, input.runtimePolicy), 'task.js');
    if (evaluated.error) {
      const error = dumpError(evaluated.error) as { message?: string; name?: string } | string;
      if (interrupted) return failure(TIMEOUT_MESSAGE, true);
      if (isQuickJSLimit(error, 'stack overflow')) return failure(STACK_MESSAGE);
      if (isQuickJSLimit(error, 'out of memory')) return failure(OUT_OF_MEMORY_MESSAGE);
      const message = typeof error === 'string' ? error : `${error?.name ?? 'Error'}: ${error?.message ?? 'failed'}`;
      return failure(message.replace(/^SyntaxError: /, 'SyntaxError: '));
    }
    driver = evaluated.value;

    for (let tick = 0; tick < SANDBOX_MAX_TICKS; tick++) {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        dumpError(jobs.error);
        if (interrupted) return failure(TIMEOUT_MESSAGE, true);
        // An unhandled rejection inside a job: keep pumping, the harness catches per call.
      }
      if (Date.now() > deadline) return failure(TIMEOUT_MESSAGE, true);
      if (readDriver('done') === true) break;
      const didFire = readDriver('tick') === true;
      if (!didFire && !runtime.hasPendingJob()) {
        // Nothing left to run and the calls have not settled: a promise that
        // never resolves. Report it instead of waiting for the deadline.
        return failure(NEVER_SETTLED_MESSAGE);
      }
    }

    if (readDriver('done') !== true) return failure(TIMEOUT_MESSAGE, true);
    const raw = readDriver('output');
    const logs = readLogs();
    if (typeof raw !== 'string' || raw.length > 1_000_000) return failure('The run produced an invalid result.');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== input.calls.length) return failure('Incomplete evaluation.');
    const results = parsed.map((outcome, index) => {
      if (!Array.isArray(outcome)) throw new Error('Malformed result');
      if (outcome[0] === 'error' && typeof outcome[1] === 'string') return { pass: false, actual: null, error: cutErrorText(outcome[1]) };
      if (outcome[0] !== 'value') throw new Error('Malformed result');
      const actual = decode(outcome[1]);
      return { pass: input.expectations ? deepEqual(actual, input.expectations[index]) : null, actual: displayValue(actual), error: null };
    });
    return { results, logs, codeError: null, timedOut: false };
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    if (interrupted) return failure(TIMEOUT_MESSAGE, true);
    if (isHostStackOverflow(message)) return failure(STACK_MESSAGE);
    return failure(message.includes('memory') ? OUT_OF_MEMORY_MESSAGE : message);
  } finally {
    // Disposal can fail after a run that exhausted the stack: QuickJS asserts
    // its object list is empty and aborts the whole WebAssembly instance.
    // Letting that escape would discard the result the run already produced and
    // surface deep recursion — an ordinary learner mistake this module promises
    // to report rather than crash on — as a 500. Swallow it, and drop the
    // cached module so the next run starts from a clean instance.
    let disposalFailed = false;
    try { driver?.dispose(); } catch { disposalFailed = true; }
    try { vm.dispose(); } catch { disposalFailed = true; }
    try { runtime.dispose(); } catch { disposalFailed = true; }
    if (disposalFailed) modulePromise = null;
  }
}

/** One check: a call expression and the value it must produce. */
export interface SandboxCheck {
  call: string;
  expected: unknown;
}

/**
 * Grades code against its visible and hidden checks.
 *
 * The visible checks run together, and their console output is what the
 * learner sees. The hidden checks run in a fresh program — the code evaluated
 * again, sharing no state with the visible run — in an order shuffled for
 * every submission. So an answer cannot be served by counting calls (`A[k++]`
 * handed the hidden checks their answers in authored order when every call
 * shared one program), and the hidden pass count cannot be read position by
 * position. Nothing a hidden check prints comes back, and its run's error
 * only when it is a fixed message (a timeout, a stack overflow, a call that
 * never settled). Hidden results return in authored order.
 */
export async function runChecks(input: {
  runtimePolicy?: TaskRuntimePolicy;
  code: string;
  visible: readonly SandboxCheck[];
  hidden: readonly SandboxCheck[];
  shuffle: <T>(list: T[]) => T[];
}): Promise<{ visible: EvaluateResult; hidden: EvaluateResult | null }> {
  const visible = await runInSandbox({
    code: input.code,
    runtimePolicy: input.runtimePolicy,
    calls: input.visible.map((check) => check.call),
    expectations: input.visible.map((check) => check.expected),
  });
  if (input.hidden.length === 0) return { visible, hidden: null };
  // A program that does not load, or runs out of time, fails the hidden checks
  // the same way; running it again would only spend the time twice.
  if (visible.codeError || visible.timedOut) {
    return { visible, hidden: { results: [], logs: [], codeError: visible.codeError, timedOut: visible.timedOut } };
  }
  const order = input.shuffle(input.hidden.map((_, index) => index));
  const run = await runInSandbox({
    code: input.code,
    runtimePolicy: input.runtimePolicy,
    calls: order.map((index) => input.hidden[index].call),
    expectations: order.map((index) => input.hidden[index].expected),
    shownCalls: 0,
  });
  const results: EvaluateResult['results'] = [];
  if (!run.codeError && !run.timedOut) order.forEach((original, position) => { results[original] = run.results[position]; });
  // The hidden run's error goes back only when it is one of the fixed
  // messages. Anything else is text the program produced after it had seen
  // the hidden inputs.
  const codeError = run.codeError === null ? null : HIDDEN_RUN_MESSAGES.has(run.codeError) ? run.codeError : HIDDEN_RUN_FAILED_MESSAGE;
  return { visible, hidden: { results, logs: [], codeError, timedOut: run.timedOut } };
}
