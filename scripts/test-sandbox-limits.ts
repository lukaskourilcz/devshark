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
import { spawnSync } from 'node:child_process';
import { jsonKind } from '../shared/coding-failure';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { runSandboxWatchdogControls } from './sandbox-watchdog-controls';
import { runSandboxOutputPolicyControls } from './sandbox-output-policy-controls';
import {
  runInSandbox, runChecks, sandboxPool, sandboxThreads, type SandboxInput,
  SANDBOX_DEADLINE_MS, SANDBOX_IDLE_THREADS, SANDBOX_MAX_THREADS, SANDBOX_MAX_TICKS, SANDBOX_MAX_WAITING,
  SANDBOX_MEMORY_BYTES, SANDBOX_SLOT_WAIT_MS, SANDBOX_STACK_BYTES, SANDBOX_WORKER_GRACE_MS,
} from '../lib/coding/sandbox';
import { LOG_LINE_CUT, LOG_OUTPUT_CUT, MAX_LOG_CHARS, MAX_LOG_LINE_CHARS, MAX_LOGS, TIMEOUT_MESSAGE, type EvaluateResult } from '../shared/coding-evaluate';

if (process.argv[2] === '--output-budget-policy') {
  await buildSandboxWorker();
  process.env.VERCEL = '1';
  await runSandboxOutputPolicyControls();
  process.exit(0);
}

if (process.argv[2] === '--disposal-controls') {
  const { runSandboxDisposalControls } = await import('./sandbox-disposal-controls');
  await runSandboxDisposalControls();
  process.exit(0);
}

if (process.argv[2] === '--retirement-fault') {
  const { runRetirementFault } = await import('./test-sandbox-retirement');
  await runRetirementFault(process.argv[3] ?? 'reject');
  process.exit(0);
}

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

/** A reported limit or host stop retires the worker; ordinary outcomes keep it.
 * Reported words are conservative cleanup signals, not native provenance. */
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
  if (thread === 'ended') assert.equal(after, before - 1, `${name}: the thread that ran it was retired`);
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
// A protocol spinner cannot reach QuickJS's interrupt or post-jobs clock.
// This proves the strict parent grace separately, including its negative.
await runSandboxWatchdogControls({ longestRunMs: LONGEST_RUN_MS, exitWaitMs: EXIT_WAIT_MS });

// F11-36 selected policy follows reported outcomes, not native provenance.
// Neutral failures and ordinary wrong answers keep a healthy worker. Exact
// reported limit words may retire even when deliberately learner-forged.
await limitCase('ordinary wrong answer keeps the worker', {
  code:'const answer=()=>1;',calls:['answer()'],expectations:[2],
}, (run)=>{
  assert.equal(run.timedOut,false);assert.equal(run.codeError,null);
  assert.deepEqual(run.results,[{pass:false,actual:'1',error:null}]);
}, 'kept');
for (const message of ['ordinary learner error', TIMEOUT_MESSAGE, 'gc_obj_list']) {
  await limitCase(`ordinary non-limit call error keeps worker: ${message}`, {
    code:`function answer(){throw new Error(${JSON.stringify(message)});}`,calls:['answer()'],
  }, (run)=>{
    assert.equal(run.timedOut,false);assert.equal(run.codeError,null);
    assert.deepEqual(run.results,[{pass:false,actual:null,error:message}]);
  }, 'kept');
}
for (const message of ['out of memory', 'stack overflow']) {
  await limitCase(`exact reported call limit retires worker: ${message}`, {
    code:`function answer(){throw new Error(${JSON.stringify(message)});}`,calls:['answer()'],
  }, (run)=>{
    assert.equal(run.timedOut,false);assert.equal(run.codeError,null);
    assert.deepEqual(run.results,[{pass:false,actual:null,error:message}]);
  }, 'ended');
}
for (const [message, publicError] of [['out of memory',OUT_OF_MEMORY_MESSAGE],['stack overflow',STACK_MESSAGE]]) {
  await limitCase(`forged InternalError has reported cleanup semantics: ${message}`, {
    code:`const error=new Error(${JSON.stringify(message)});error.name='InternalError';throw error;`,calls:[],
  }, (run)=>{
    assert.equal(run.timedOut,false);assert.equal(run.codeError,publicError);
  }, 'ended');
}
for (const codeError of [TIMEOUT_MESSAGE,STACK_MESSAGE,OUT_OF_MEMORY_MESSAGE]) {
  await limitCase(`exact top-level fixed limit report retires: ${codeError}`, {
    code:`throw ${JSON.stringify(codeError)};`,calls:[],
  }, (run)=>{
    assert.equal(run.timedOut,false);assert.equal(run.codeError,codeError);
  }, 'ended');
}
await limitCase('successful limit-looking data cannot dictate worker metadata', {
  code:`const answer=()=>({name:'InternalError',message:'out of memory',healthy:false});`,calls:['answer()'],
  expectations:[{name:'InternalError',message:'out of memory',healthy:false}],
}, (run)=>{
  assert.equal(run.timedOut,false);assert.equal(run.codeError,null);assert.equal(run.results[0].error,null);assert.equal(run.results[0].pass,true);
}, 'kept');
await limitCase('ungraded successful call still keeps the worker', {code:'const answer=()=>42;',calls:['answer()'],expectations:null}, (run)=>{
  assert.equal(run.timedOut,false);assert.equal(run.codeError,null);assert.deepEqual(run.results,[{pass:null,actual:'42',error:null}]);
}, 'kept');
await limitCase('empty successful warm-up keeps the worker', {code:'',calls:[],expectations:[]}, (run)=>{
  assert.equal(run.timedOut,false);assert.equal(run.codeError,null);assert.deepEqual(run.results,[]);
}, 'kept');

// ── busy-waits: QuickJS interrupts the bytecode at the deadline ──────────
for (const [name, code, calls] of [
  ['a busy-wait at the top level', 'while (true) {}', ['1']],
  ['a busy-wait inside a call', 'const spin = () => { while (true) {} };', ['spin()']],
  // Date.now and performance.now read the virtual clock, which only timers
  // move, so a wait for the clock never ends by itself.
  ['a busy-wait on Date.now', 'const wait = () => { const end = Date.now() + 1000; while (Date.now() < end) {} return 1; };', ['wait()']],
  ['a busy-wait on performance.now', 'const wait = () => { const end = performance.now() + 1000; while (performance.now() < end) {} return 1; };', ['wait()']],
] as const) {
  await limitCase(name, { code, calls: [...calls] }, atDeadline(name), 'ended');
}

// A timer that fires forever keeps a call from settling. The tick limit ends
// the run long before the deadline.
await limitCase('an interval that never lets a call settle', {
  code: 'const forever = () => new Promise(() => { setInterval(() => {}, 0); });', calls: ['forever()'],
}, (run, took) => {
  timedOut('an interval')(run);
  assert.ok(took < SANDBOX_DEADLINE_MS, `the tick limit stopped it before the deadline (${took} ms)`);
}, 'ended');

// ── native-call loops: the engine deadline or host stops the run ────────
// QuickJS polls its interrupt handler every 10,000 loop iterations, and a
// loop whose iterations go into native calls reaches that poll seconds after
// the deadline. These workloads may also return to an engine interrupt or
// post-jobs clock gate before the parent grace. Keep their real resource,
// fixed-timeout, upper-bound, settled-thread and next-grade controls; the
// deterministic fixture above independently pins the strict parent path. Both valid
// timeout paths now retire their worker under the reported-limit policy.
await limitCase('a loop of native string calls', {
  code: 'const repeat = () => { let total = 0; while (true) { total += "x".repeat(2e6).length; } };', calls: ['repeat()'],
}, atDeadline('a loop of native string calls'), 'ended');
await limitCase('an allocating loop of native calls', {
  code: 'const hoard = () => { const kept = []; for (;;) kept.push("x".repeat(1e6) + kept.length); };', calls: ['hoard()'],
}, atDeadline('an allocating loop of native calls'), 'ended');
await limitCase('an allocating loop spread over promise jobs', {
  code: 'const hoard = async () => { const kept = []; for (;;) { kept.push("x".repeat(1e6) + kept.length); await 0; } };', calls: ['hoard()'],
}, atDeadline('an allocating loop spread over promise jobs'), 'ended');

// ── memory: a call past 64 MB fails, the run goes on ─────────────────────
await limitCase('an allocating loop inside a call', {
  code: 'const grow = () => { const kept = []; for (;;) kept.push(1); };\nconst block = (mb) => new Uint8Array(mb * 1024 * 1024).length;',
  calls: ['grow()', 'block(32)', 'block(80)'], expectations: [null, 32 * 1024 * 1024, 80 * 1024 * 1024],
}, (run) => {
  assert.equal(run.codeError, null, 'the run itself loads and finishes');
  assert.deepEqual(run.results[0], { pass: false, actual: null, error: 'out of memory' }, 'a call that allocates without end fails with out of memory');
  assert.equal(run.results[1]?.pass, true, 'its memory is freed, and 32 MB fits under the limit');
  assert.deepEqual(run.results[2], { pass: false, actual: null, error: 'out of memory' }, '80 MB does not');
}, 'ended');
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
  }, 'ended');
}

// ── stack: unbounded recursion fails the call or the program ─────────────
await limitCase('unbounded recursion inside a call', {
  code: 'const down = (n) => down(n + 1) + 1;\nconst deep = (n) => (n === 0 ? 0 : 1 + deep(n - 1));',
  calls: ['down(0)', 'deep(2000)'], expectations: [0, 2000],
}, (run) => {
  assert.equal(run.codeError, null, 'the run itself loads and finishes');
  assert.deepEqual(run.results[0], { pass: false, actual: null, error: 'stack overflow' }, 'the recursing call fails');
  assert.equal(run.results[1]?.pass, true, 'recursion 2,000 calls deep fits in the stack');
}, 'ended');
await limitCase('unbounded recursion at the top level', {
  code: 'const down = (n) => down(n + 1) + 1;\ndown(0);', calls: ['1'],
}, (run) => {
  assert.equal(run.codeError, STACK_MESSAGE, 'the learner reads the stack message');
  assert.equal(run.timedOut, false, 'a stack overflow is not a timeout');
}, 'ended');

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
// A correct answer that logs a 20,000-number array 3,000 times. Each line is
// cut to 2,000 characters, so 31 fit the 64,000-character cap and the 32nd
// is the cut marker. The grader used to turn every argument into JSON before
// it dropped the line and spent the deadline on 2,968 lines nobody sees, so
// the answer graded "timeout"; past the cap it skips that work.
const bigLine = MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length;
const keptBigLines = Math.floor(MAX_LOG_CHARS / bigLine);
await limitCase('3,000 logs of a 20,000-number array', {
  code: 'const loud = () => { const numbers = Array.from({ length: 2e4 }, (_, i) => i); for (let i = 0; i < 3000; i++) console.log(numbers); return 1; };',
  calls: ['loud()'], expectations: [1],
}, (run, took) => {
  assert.equal(run.timedOut, false, `the run ends before its deadline (${took} ms)`);
  assert.equal(run.codeError, null, 'the run finishes');
  assert.equal(run.results[0]?.pass, true, 'the correct answer passes');
  assert.equal(keptBigLines, 31, '31 cut lines fit under the output cap');
  assert.equal(run.logs.length, keptBigLines + 1, 'the learner reads 31 lines and the cut marker');
  assert.ok(run.logs.slice(0, -1).every((line) => line.length === bigLine && line.endsWith(LOG_LINE_CUT)), 'each line is cut to 2,000 characters');
  assert.equal(run.logs.at(-1), LOG_OUTPUT_CUT, 'the last entry marks the cut');
}, 'kept');
// The same past the line cap: 100 short lines, then 3,000 big ones nobody sees.
await limitCase('3,000 logs of a 20,000-number array after 100 short lines', {
  code: 'const loud = () => { for (let i = 0; i < 100; i++) console.log(i); const numbers = Array.from({ length: 2e4 }, (_, i) => i); for (let i = 0; i < 3000; i++) console.log(numbers); return 1; };',
  calls: ['loud()'], expectations: [1],
}, (run, took) => {
  assert.equal(run.timedOut, false, `the run ends before its deadline (${took} ms)`);
  assert.equal(run.results[0]?.pass, true, 'the correct answer passes');
  assert.equal(run.logs.length, MAX_LOGS, `the first ${MAX_LOGS} lines are kept`);
  assert.equal(run.logs.at(-1), String(MAX_LOGS - 1), 'and none of the big ones');
}, 'kept');

// F11-17: only the displayed serialization is bounded; grading sees full values.
const displayedLong = 'x'.repeat(6000);
await limitCase('displayed long values preserve complete equality and JSON-kind prefixes', {
  code: 'const text = () => "x".repeat(6000); const list = () => [text()]; const record = () => ({ text: text() });',
  calls: ['text()', 'text()', 'list()', 'record()'], expectations: [displayedLong, 'x'.repeat(5999) + 'y', [displayedLong], { text: displayedLong }],
}, (run) => {
  assert.equal(run.codeError, null); assert.equal(run.timedOut, false);
  assert.deepEqual(run.results.map(result => result.pass), [true, false, true, true], 'a difference after the display boundary still fails');
  assert.ok(run.results.every(result => result.actual !== null && result.actual.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length && result.actual.endsWith(LOG_LINE_CUT)));
  assert.deepEqual(run.results.map(result => jsonKind(result.actual)), ['string', 'string', 'array', 'object']);
  assert.ok(run.results.every(result => result.error === null));
}, 'kept');
await limitCase('an ungraded long value retains null instead of a grade', {
  code: 'const text = () => "x".repeat(6000);', calls: ['text()'], expectations: null,
}, (run) => {
  assert.deepEqual(run.results, [{ pass: null, actual: '"' + 'x'.repeat(1999) + LOG_LINE_CUT, error: null }]);
}, 'kept');
const displayedSurrogate = 'x'.repeat(1998) + '\ud83e\udd88' + 'tail';
await limitCase('a displayed value never splits the surrogate pair at its boundary', {
  code: 'const text = () => "x".repeat(1998) + "\\ud83e\\udd88" + "tail";', calls: ['text()'], expectations: [displayedSurrogate],
}, (run) => {
  assert.deepEqual(run.results, [{ pass: true, actual: '"' + 'x'.repeat(1998) + LOG_LINE_CUT, error: null }]);
}, 'kept');
// Existing F11-21 error cuts are controls, not new display regressions.
await limitCase('long call errors retain their existing bounded message', {
  code: 'const fail = () => { throw "q".repeat(6000); };', calls: ['fail()'], expectations: [null],
}, (run) => {
  assert.deepEqual(run.results, [{ pass: false, actual: null, error: 'q'.repeat(2000) + LOG_LINE_CUT }]);
}, 'kept');
await limitCase('a top-level surrogate error retains its existing cut', {
  code: 'throw "r".repeat(1999) + "\\ud83e\\udd88" + "tail";', calls: ['1'],
}, (run) => {
  assert.deepEqual(run.results, []); assert.equal(run.codeError, 'r'.repeat(1999) + LOG_LINE_CUT); assert.equal(run.timedOut, false);
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

await runSandboxOutputPolicyControls();

// F11-16: an output budget fails the individual call, including the JSON
// packet/escaping overhead. Other calls and their full-value grades survive.
const OUTPUT_SIZE_ERROR = 'Result size limit exceeded';
const assertSmallSides = (run: EvaluateResult, length: number) => {
  assert.equal(run.codeError, null, 'the run still loads and reports');
  assert.equal(run.timedOut, false, 'output size is not a timeout');
  assert.equal(run.results.length, length, 'every authored call still reports');
  assert.deepEqual(run.results[0], { pass: true, actual: '1', error: null });
  assert.deepEqual(run.results[length - 1], { pass: true, actual: '2', error: null });
};
for (const [name, expression] of [
  ['huge string', '"x".repeat(2000000)'],
  ['escaped string', 'String.fromCharCode(0).repeat(160000)'],
  ['escaped key', '({[String.fromCharCode(0).repeat(160000)]:1})'],
  ['lone surrogate', 'String.fromCharCode(0xd800).repeat(160000)'],
  ['numeric packet arrays', 'Array.from({length:3},()=>Array.from({length:10000},()=>1.2345678901234567e308))'],
] as const) {
  await limitCase(`F11-16 ${name} fails only that call`, {
    code: `const huge=()=>(${expression});`, calls: ['1', 'huge()', '2'], expectations: [1, null, 2],
  }, (run) => {
    assertSmallSides(run, 3);
    assert.deepEqual(run.results[1], { pass: false, actual: null, error: OUTPUT_SIZE_ERROR });
  }, 'kept');
}
await limitCase('F11-16 a huge thrown message is cut before the packet', {
  code: 'String.prototype.slice=()=>"poisoned";const fail=()=>{throw new Error("e".repeat(2000000));};', calls: ['1', 'fail()', '2'], expectations: [1, null, 2],
}, (run) => {
  assertSmallSides(run, 3);
  assert.deepEqual(run.results[1], { pass: false, actual: null, error: 'e'.repeat(MAX_LOG_LINE_CHARS) + LOG_LINE_CUT });
}, 'kept');
await limitCase('F11-16 a cut thrown message keeps the surrogate boundary', {
  code: `const fail=()=>{throw new Error('x'.repeat(${MAX_LOG_LINE_CHARS - 1})+String.fromCodePoint(0x1f988)+'tail'.repeat(100000));};`, calls: ['1', 'fail()', '2'], expectations: [1, null, 2],
}, (run) => {
  assertSmallSides(run, 3);
  assert.deepEqual(run.results[1], { pass: false, actual: null, error: 'x'.repeat(MAX_LOG_LINE_CHARS - 1) + LOG_LINE_CUT });
}, 'kept');
// UTF16, not UTF8: this value is over a million UTF8 bytes but under the
// encoded-character budget. Compare the complete value before display cuts.
const unicodeValue = String.fromCodePoint(0x1f988).repeat(350000);
await limitCase('F11-16 valid surrogate pairs count as two UTF16 units', {
  code: 'JSON.stringify=()=>"poisoned";String.prototype.charCodeAt=()=>0;const value=()=>String.fromCodePoint(0x1f988).repeat(350000);', calls: ['1', 'value()', '2'], expectations: [1, unicodeValue, 2],
}, (run) => {
  assertSmallSides(run, 3);assert.equal(run.results[1]?.pass, true);assert.equal(run.results[1]?.error, null);
}, 'kept');
for(const [name,expression,expected] of [
  ['escaped value','String.fromCharCode(0).repeat(100000)',String.fromCharCode(0).repeat(100000)],
  ['lone surrogate','String.fromCharCode(0xd800).repeat(100000)',String.fromCharCode(0xd800).repeat(100000)],
  ['escaped key','({[String.fromCharCode(0).repeat(100000)]:1})',{[String.fromCharCode(0).repeat(100000)]:1}],
] as const) {
  await limitCase(`F11-16 a fitting ${name} keeps its full grade`, {
    code:`const value=()=>(${expression});`,calls:['1','value()','2'],expectations:[1,expected,2],
  },(run)=>{assertSmallSides(run,3);assert.equal(run.results[1]?.pass,true);},'kept');
}
const weirdKey = String.fromCharCode(0, 8, 9, 10, 11, 12, 13, 34, 92, 0xd800);
const mixed = [undefined, -0, NaN, Infinity, -Infinity, true, false, null, String.fromCodePoint(0x1f988), String.fromCharCode(0xd800), String.fromCharCode(0xdc00)];
await limitCase('F11-16 escaped keys and mixed packet types retain full grading', {
  code: 'const value=()=>Object.fromEntries([[String.fromCharCode(0,8,9,10,11,12,13,34,92,0xd800),[undefined,-0,NaN,Infinity,-Infinity,true,false,null,String.fromCodePoint(0x1f988),String.fromCharCode(0xd800),String.fromCharCode(0xdc00)]]]);',
  calls: ['1', 'value()', '2'], expectations: [1, { [weirdKey]: mixed }, 2],
}, (run) => { assertSmallSides(run, 3);assert.equal(run.results[1]?.pass, true); }, 'kept');
// One large successful value, 48 cut/escaped errors and two light calls:
// value-only accounting would still let the error packets cross the backstop.
// Both competitors settle after the same async turn; plain synchronous
// throws would otherwise be caught before an earlier value's await resumes.
for(const largeFirst of [true, false]) {
  const errors = Array.from({length:48},()=> 'fail()');
  const middle = largeFirst ? ['large()', ...errors] : [...errors, 'large()'];
  const largeIndex = largeFirst ? 1 : 49;
  const expected = largeFirst ? [1, 'a'.repeat(850000), ...errors.map(()=>null), 2] : [1, ...errors.map(()=>null), 'a'.repeat(850000), 2];
  await limitCase(`F11-16 cumulative errors and value, large ${largeFirst ? 'first' : 'last'}`, {
    code: 'const large=async()=>{await 0;return "a".repeat(850000);};const fail=async()=>{await 0;throw new Error(String.fromCharCode(0).repeat(50000));};',
    calls: ['1', ...middle, '2'], expectations: expected,
  }, (run) => {
    assertSmallSides(run, 51);
    assert.equal(run.results[largeIndex].pass, largeFirst, 'earlier committed output is retained');
    if(!largeFirst) assert.equal(run.results[largeIndex].error, OUTPUT_SIZE_ERROR);
    const throwResults=run.results.filter((_,index)=>index>0 && index<50 && index!==largeIndex);
    assert.ok(throwResults.every(one=>one.pass===false && one.actual===null));
    const cut=String.fromCharCode(0).repeat(MAX_LOG_LINE_CHARS)+LOG_LINE_CUT;
    assert.ok(throwResults.every(one=>one.error===cut || one.error===OUTPUT_SIZE_ERROR));
    assert.ok(throwResults.some(one=>one.error===cut), 'cut learner errors remain when their complete packets fit');
    if(largeFirst) assert.ok(throwResults.some(one=>one.error===OUTPUT_SIZE_ERROR), 'later escaped errors use reserved size stubs');
  }, 'kept');
}
for(const reverse of [false,true]) {
  const a='a'.repeat(550000),b='b'.repeat(550000);
  const run=await runChecks({code:'const value=ch=>ch.repeat(550000);',visible:[{call:'1',expected:1}],hidden:[{call:'value("a")',expected:a},{call:'value("b")',expected:b},{call:'2',expected:2}],shuffle:order=>reverse ? order.reverse() : order});
  assert.equal(run.visible.results[0]?.pass,true);assert.equal(run.hidden?.codeError,null);
  assert.deepEqual(run.hidden?.results.map(one=>one.pass),reverse ? [false,true,true] : [true,false,true], 'hidden results restore authored indices after cumulative settlement accounting');
  assert.deepEqual(run.hidden?.logs,[]);
}
console.log('PASS sandbox output budget: cumulative hidden order restores authored indices');

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

// Real owned workers prove disposal health reaches the actual done producer.
await (await import('./sandbox-disposal-controls')).runSandboxDisposalControls();

// Fresh processes prevent the controlled Worker prototype faults from
// touching this suite's normal pool or any other engine invocation.
for (const mode of ['reject', 'throw']) {
  const child = spawnSync(process.execPath, [process.argv[1], '--retirement-fault', mode], {
    cwd: process.cwd(), env: { NODE_ENV: 'development', TZ: 'UTC', VERCEL: '1' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
  assert.match(child.stdout, /PASS retirement lease:/);
  console.log(child.stdout.trim());
}

console.log('Sandbox limits passed: busy-waits, native-call loops, memory, stack, console floods, deep and wide values and the thread cap end within deadline plus grace.');
