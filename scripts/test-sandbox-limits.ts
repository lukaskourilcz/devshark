// The QuickJS grader's resource limits at their real values (Epic F, F11, #640).
//
// Every case runs through the grader's worker thread, built fresh from the
// sources under test, as a deployment runs it. VERCEL=1 forbids grading on
// this thread, so a run no worker could take fails here instead of passing
// in-process. Each case checks the verdict and the message the learner reads,
// that the run ended within its deadline, the grace and a one-second margin
// for a CI runner shared with other jobs, which threads are still alive a
// second later, and that the next run grades.
//
// test-grading-integrity covers the same limits with shortened deadlines and
// through the Submit handler; this suite keeps the deployed numbers.
import assert from 'node:assert/strict';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import {
  runInSandbox, sandboxPool, sandboxThreads, type SandboxInput,
  SANDBOX_DEADLINE_MS, SANDBOX_IDLE_THREADS, SANDBOX_MAX_THREADS, SANDBOX_MAX_TICKS, SANDBOX_MAX_WAITING,
  SANDBOX_MEMORY_BYTES, SANDBOX_SLOT_WAIT_MS, SANDBOX_STACK_BYTES, SANDBOX_WORKER_GRACE_MS,
} from '../lib/coding/sandbox';
import { MAX_LOGS, TIMEOUT_MESSAGE, type EvaluateResult } from '../shared/coding-evaluate';

await buildSandboxWorker();
process.env.VERCEL = '1';

/** What a learner reads when the program itself ran out of stack. */
const STACK_MESSAGE = 'The call stack ran out of room: the recursion went too deep, or a base case is never reached.';
/** What a learner reads when the program itself ran out of memory. */
const OUT_OF_MEMORY_MESSAGE = 'Out of memory.';
/** Room on top of a limit for a CI runner shared with other jobs. */
const MARGIN_MS = 1_000;
/** The longest any single run may take: its deadline, the grace before the
 * host stops its thread, and the margin. */
const LONGEST_RUN_MS = SANDBOX_DEADLINE_MS + SANDBOX_WORKER_GRACE_MS + MARGIN_MS;
/** How long a stopped thread may take to exit. */
const EXIT_WAIT_MS = 1_000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// ── the limits are the documented numbers ────────────────────────────────
assert.equal(SANDBOX_DEADLINE_MS, 2_500, 'a run gets 2.5 s of CPU');
assert.equal(SANDBOX_WORKER_GRACE_MS, 1_500, 'the host stops a thread 1.5 s after its deadline');
assert.equal(SANDBOX_MEMORY_BYTES, 64 * 1024 * 1024, 'QuickJS gets 64 MB of heap');
assert.equal(SANDBOX_STACK_BYTES, 1024 * 1024, 'QuickJS gets 1 MB of stack');
assert.equal(SANDBOX_MAX_TICKS, 10_000, 'a run may take 10,000 rounds of jobs and timers');
assert.equal(SANDBOX_MAX_THREADS, 4, 'four runs grade at once on an instance');
assert.equal(SANDBOX_IDLE_THREADS, 2, 'two threads stay loaded between runs');
assert.equal(SANDBOX_MAX_WAITING, 160, '160 runs may wait for a thread');
assert.equal(SANDBOX_SLOT_WAIT_MS, 5_000, 'a run waits at most 5 s for a thread');
console.log('PASS sandbox limits: the deadline, grace, memory, stack, tick, thread and queue limits are the documented numbers');

/** A plain run grades, on a worker thread. */
async function grades(after: string): Promise<void> {
  const run = await runInSandbox({ code: 'const next = (n) => n + 1;', calls: ['next(1)'], expectations: [2] });
  assert.equal(run.results[0]?.pass, true, `${after}: the next run grades`);
  assert.ok(sandboxThreads() >= 1, `${after}: the run went to a worker thread`);
}

/** Waits until every thread but the idle ones has exited, a second at most,
 * and returns how many threads are left. */
async function settledThreads(name: string): Promise<number> {
  for (let waited = 0; sandboxThreads() > sandboxPool().idle && waited < EXIT_WAIT_MS; waited += 20) await sleep(20);
  assert.equal(sandboxThreads(), sandboxPool().idle, `${name}: only idle threads are alive a second after the run`);
  return sandboxThreads();
}

/** Runs one limit case. `thread` says what becomes of the thread that ran it:
 * `ended` when the host had to stop it, `kept` when QuickJS stopped the
 * program and the thread went back to the pool. */
async function limitCase(
  name: string,
  input: Omit<SandboxInput, 'expectations'> & { expectations?: unknown[] | null },
  check: (run: EvaluateResult, took: number) => void,
  thread: 'ended' | 'kept',
): Promise<void> {
  // A loaded thread first, so the time below is the run's and not a thread start.
  await grades(`before ${name}`);
  const before = sandboxThreads();
  const started = Date.now();
  const run = await runInSandbox({ expectations: null, ...input });
  const took = Date.now() - started;
  check(run, took);
  assert.ok(took <= LONGEST_RUN_MS, `${name}: ended within the deadline, the grace and the margin (${took} ms)`);
  const after = await settledThreads(name);
  if (thread === 'ended') assert.equal(after, before - 1, `${name}: the host stopped the thread that ran it`);
  else assert.equal(after, before, `${name}: the thread that ran it went back to the pool`);
  await grades(name);
  console.log(`PASS sandbox limits: ${name} (${took} ms, thread ${thread})`);
}

const timedOut = (name: string) => (run: EvaluateResult) => {
  assert.equal(run.timedOut, true, `${name}: the run timed out`);
  assert.equal(run.codeError, TIMEOUT_MESSAGE, `${name}: the learner reads the timeout message`);
  assert.deepEqual(run.results, [], `${name}: no call has a result`);
};
/** The interrupt handler stopped the program at its deadline. */
const atDeadline = (name: string) => (run: EvaluateResult, took: number) => {
  timedOut(name)(run);
  assert.ok(took >= SANDBOX_DEADLINE_MS - 50, `${name}: the program had its whole deadline (${took} ms)`);
};
/** The host stopped the thread at the deadline plus the grace. */
const atGrace = (name: string) => (run: EvaluateResult, took: number) => {
  timedOut(name)(run);
  assert.ok(took >= SANDBOX_DEADLINE_MS + SANDBOX_WORKER_GRACE_MS - 20, `${name}: the host waited out the deadline and the grace (${took} ms)`);
};

// ── busy-waits: QuickJS interrupts the bytecode at the deadline ──────────
for (const [name, code, calls] of [
  ['a busy-wait at the top level', 'while (true) {}', ['1']],
  ['a busy-wait inside a call', 'const spin = () => { while (true) {} };', ['spin()']],
  // Date.now and performance.now read the virtual clock, which only timers
  // move, so a wait for the clock never ends by itself.
  ['a busy-wait on Date.now', 'const wait = () => { const end = Date.now() + 1000; while (Date.now() < end) {} return 1; };', ['wait()']],
  ['a busy-wait on performance.now', 'const wait = () => { const end = performance.now() + 1000; while (performance.now() < end) {} return 1; };', ['wait()']],
] as const) {
  await limitCase(name, { code, calls: [...calls] }, atDeadline(name), 'kept');
}

// A timer that fires forever keeps a call from settling. The tick limit ends
// the run long before the deadline.
await limitCase('an interval that never lets a call settle', {
  code: 'const forever = () => new Promise(() => { setInterval(() => {}, 0); });', calls: ['forever()'],
}, (run, took) => {
  timedOut('an interval')(run);
  assert.ok(took < SANDBOX_DEADLINE_MS, `the tick limit stopped it before the deadline (${took} ms)`);
}, 'kept');

// ── native-call loops: the host stops the thread ────────────────────────
// QuickJS polls its interrupt handler every 10,000 loop iterations, and a
// loop whose iterations go into native calls reaches that poll seconds after
// the deadline: run on this thread, the three loops below stopped after
// about 40 s, 12 s and 10 s. The host ends their thread at the deadline plus
// the grace instead.
await limitCase('a loop of native string calls', {
  code: 'const repeat = () => { let total = 0; while (true) { total += "x".repeat(2e6).length; } };', calls: ['repeat()'],
}, atGrace('a loop of native string calls'), 'ended');
await limitCase('an allocating loop of native calls', {
  code: 'const hoard = () => { const kept = []; for (;;) kept.push("x".repeat(1e6) + kept.length); };', calls: ['hoard()'],
}, atGrace('an allocating loop of native calls'), 'ended');
await limitCase('an allocating loop spread over promise jobs', {
  code: 'const hoard = async () => { const kept = []; for (;;) { kept.push("x".repeat(1e6) + kept.length); await 0; } };', calls: ['hoard()'],
}, atGrace('an allocating loop spread over promise jobs'), 'ended');

// ── memory: a call past 64 MB fails, the run goes on ─────────────────────
await limitCase('an allocating loop inside a call', {
  code: 'const grow = () => { const kept = []; for (;;) kept.push(1); };\nconst block = (mb) => new Uint8Array(mb * 1024 * 1024).length;',
  calls: ['grow()', 'block(32)', 'block(80)'], expectations: [null, 32 * 1024 * 1024, 80 * 1024 * 1024],
}, (run) => {
  assert.equal(run.codeError, null, 'the run itself loads and finishes');
  assert.deepEqual(run.results[0], { pass: false, actual: null, error: 'out of memory' }, 'a call that allocates without end fails with out of memory');
  assert.equal(run.results[1]?.pass, true, 'its memory is freed, and 32 MB fits under the limit');
  assert.deepEqual(run.results[2], { pass: false, actual: null, error: 'out of memory' }, '80 MB does not');
}, 'kept');
// Past 64 MB at the top level the whole program fails, and the learner reads
// the fixed message, as for a thread that ran out of memory, in place of
// QuickJS's "InternalError: out of memory".
for (const [name, code] of [
  ['an allocating loop at the top level', 'const kept = []; for (;;) kept.push(1);'],
  ['a loop of 1 MB buffers at the top level', 'const kept = []; for (;;) kept.push(new Uint8Array(1024 * 1024));'],
] as const) {
  await limitCase(name, { code, calls: ['1'] }, (run) => {
    assert.equal(run.codeError, OUT_OF_MEMORY_MESSAGE, `${name}: the learner reads the out-of-memory message`);
    assert.equal(run.timedOut, false, `${name}: running out of memory is not a timeout`);
    assert.deepEqual(run.results, [], `${name}: no call has a result`);
  }, 'kept');
}

// ── stack: unbounded recursion fails the call or the program ─────────────
await limitCase('unbounded recursion inside a call', {
  code: 'const down = (n) => down(n + 1) + 1;\nconst deep = (n) => (n === 0 ? 0 : 1 + deep(n - 1));',
  calls: ['down(0)', 'deep(2000)'], expectations: [0, 2000],
}, (run) => {
  assert.equal(run.codeError, null, 'the run itself loads and finishes');
  assert.deepEqual(run.results[0], { pass: false, actual: null, error: 'stack overflow' }, 'the recursing call fails');
  assert.equal(run.results[1]?.pass, true, 'recursion 2,000 calls deep fits in the stack');
}, 'kept');
await limitCase('unbounded recursion at the top level', {
  code: 'const down = (n) => down(n + 1) + 1;\ndown(0);', calls: ['1'],
}, (run) => {
  assert.equal(run.codeError, STACK_MESSAGE, 'the learner reads the stack message');
  assert.equal(run.timedOut, false, 'a stack overflow is not a timeout');
}, 'kept');

// ── a learner's own error is not a limit, whatever its words ────────────
// The grader used to read a timeout or a stack overflow off the error text,
// so a program that threw "Download interrupted" at load read as an infinite
// loop, and one that threw "stack overflow in my parser" lost its message.
// Only the interrupt handler firing is a timeout, and only QuickJS's own
// stack overflow is the stack message; the two cases above still are.
for (const [thrown, codeError] of [
  ['new Error("Download interrupted")', 'Error: Download interrupted'],
  ['"interrupted"', 'interrupted'],
  ['new Error("stack overflow in my parser")', 'Error: stack overflow in my parser'],
  ['new RangeError("Maximum call stack size exceeded, says my parser")', 'RangeError: Maximum call stack size exceeded, says my parser'],
  ['new Error("gc_obj_list is my variable")', 'Error: gc_obj_list is my variable'],
] as const) {
  const name = `a top-level throw of ${thrown}`;
  await limitCase(name, { code: `throw ${thrown};`, calls: ['1'] }, (run) => {
    assert.equal(run.codeError, codeError, `${name}: the learner reads their own error`);
    assert.equal(run.timedOut, false, `${name}: it is not a timeout`);
    assert.deepEqual(run.results, [], `${name}: no call has a result`);
  }, 'kept');
}

// ── output: a console flood keeps the first lines only ──────────────────
await limitCase('a console.log flood of 200,000 lines', {
  code: 'const shout = () => { for (let i = 0; i < 2e5; i++) console.log(i); return 1; };', calls: ['shout()'], expectations: [1],
}, (run, took) => {
  assert.equal(run.results[0]?.pass, true, 'the call still grades');
  assert.equal(run.logs.length, MAX_LOGS, `the first ${MAX_LOGS} lines are kept`);
  assert.deepEqual([run.logs[0], run.logs.at(-1)], ['0', String(MAX_LOGS - 1)], 'in the order they were printed');
  assert.ok(took < SANDBOX_DEADLINE_MS, `inside the deadline (${took} ms)`);
}, 'kept');

// ── output: a return value deeper than 40 levels or wider than 10,000 ────
const nested = (depth: number): unknown => { let value: unknown = 1; for (let i = 0; i < depth; i++) value = [value]; return value; };
await limitCase('a return value nested past 40 levels', {
  code: 'const nest = (depth) => { let value = 1; for (let i = 0; i < depth; i++) value = [value]; return value; };',
  calls: ['nest(40)', 'nest(41)'], expectations: [nested(40), nested(41)],
}, (run) => {
  assert.equal(run.results[0]?.pass, true, '40 levels arrive whole');
  assert.deepEqual(run.results[1], { pass: false, actual: null, error: 'Result nesting limit exceeded' }, 'a 41st level fails that call');
}, 'kept');
const range = (length: number) => Array.from({ length }, (_, i) => i);
await limitCase('a return value wider than 10,000 entries', {
  code: 'const range = (length) => Array.from({ length }, (_, i) => i);\nconst record = (length) => Object.fromEntries(range(length).map((i) => ["k" + i, i]));',
  calls: ['range(10000)', 'range(10001)', 'record(10001)'], expectations: [range(10_000), range(10_001), null],
}, (run) => {
  assert.equal(run.results[0]?.pass, true, '10,000 entries arrive whole');
  assert.deepEqual(run.results[1], { pass: false, actual: null, error: 'Result size limit exceeded' }, 'an array of 10,001 fails that call');
  assert.deepEqual(run.results[2], { pass: false, actual: null, error: 'Result size limit exceeded' }, 'so does an object with 10,001 keys');
}, 'kept');

// ── concurrency: four threads, the rest wait for one ────────────────────
// Six busy-waits at once. Four run, two wait for a thread and run after the
// first ones end, and no more than four threads are ever alive.
{
  await grades('before six runs at once');
  let most = sandboxThreads();
  const sample = setInterval(() => { most = Math.max(most, sandboxThreads()); }, 10);
  const started = Date.now();
  const runs = await Promise.all(Array.from({ length: SANDBOX_MAX_THREADS + 2 }, () => runInSandbox({ code: 'while (true) {}', calls: ['1'], expectations: null })));
  const took = Date.now() - started;
  clearInterval(sample);
  runs.forEach((run, index) => timedOut(`run ${index + 1} of six`)(run));
  assert.equal(most, SANDBOX_MAX_THREADS, `four threads ran at once and never more (${most})`);
  assert.ok(took >= 2 * SANDBOX_DEADLINE_MS - 100, `the two extra runs waited for a thread (${took} ms)`);
  assert.ok(took <= 2 * (SANDBOX_DEADLINE_MS + SANDBOX_WORKER_GRACE_MS) + MARGIN_MS, `and every run ended within two rounds (${took} ms)`);
  assert.ok(await settledThreads('six runs at once') <= SANDBOX_IDLE_THREADS, 'threads past the idle ones were stopped');
  await grades('six runs at once');
  console.log(`PASS sandbox limits: six runaway runs at once share four threads and end in ${took} ms`);
}

console.log('Sandbox limits passed: busy-waits, native-call loops, memory, stack, console floods, deep and wide values and the thread cap end within deadline plus grace.');
