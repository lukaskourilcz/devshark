import { checkQuickjsProvenance } from './quickjs-provenance-contract';
import { checkSortParity } from './coding-sort-contract';
import { checkCodingTaskRuntimePolicy } from './coding-task-runtime-contracts';
import { createCodingSession as encodeCodingSession } from '../lib/coding/session';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { QuickJSContext, QuickJSRuntime } from 'quickjs-emscripten';
import vendoredQuickJS from '../lib/coding/vendor/quickjs-node24.cjs';
import { HIDDEN_RUN_FAILED_MESSAGE, runChecks, runInQuickJS, runInSandbox, sandboxPool, SANDBOX_MAX_WAITING, SANDBOX_SLOT_WAIT_MS, SANDBOX_WORKER_FILE } from '../lib/coding/sandbox';
import { checkTypes, TRANSPILE_FAILED_MESSAGE, TS_CHECK_MAX_WAITING, TS_CHECK_SLOT_WAIT_MS, TS_CHECK_WORKER_FILE, TYPE_CHECK_DEADLINE_MS, TYPE_CHECK_STOPPED_MESSAGE } from '../lib/coding/ts-check-pool';
import { GRADING_PER_CALLER, GRADING_PER_TASK, GraderBusyError, gradingItem, threadSlots } from '../lib/coding/grader-capacity';
import { enterInFlight, SHARED_NETWORK_SEATS } from '../lib/rate-limit';
import { requestMemo, withRequestContext } from '../lib/http';
import { handleCodingReset, handleCodingReveal, handleCodingSubmit, handleCodingTask } from '../lib/coding/handlers';
import { type CodingDesignKey } from '../lib/quiz-tokens';
import { gradeDesign, prepareDesign } from '../lib/coding/grade';
import type { DesignAnswer } from '../shared/coding-api';
import { solutionFor } from '../lib/coding/solutions';
import { codingAwardId } from '../lib/rewards/coins';
import { CODING_TASK_XP } from '../shared/coding-catalog';
import { puzzleFor } from '../lib/coding/puzzles';
import { CODING_TASKS } from '../lib/coding/catalog';
import { isFreeCodingTask } from '../shared/tiers';
import { evolvingStage } from '../shared/evolving';
import { createMiniJest } from '../shared/coding-mini-jest';
import { runReactSuite } from '../lib/coding/react-runner';
import { withHiddenCases } from '../lib/coding/react-hidden';
import { guestResultLine, readGuestResult, serializeGuestResult } from '../lib/coding/react-guest';
import { allPassed, evaluateCalls, hiddenGlobalMessage, LOG_LINE_CUT, LOG_OUTPUT_CUT, MAX_LOG_CHARS, MAX_LOG_LINE_CHARS, MAX_LOGS, TIMEOUT_MESSAGE } from '../shared/coding-evaluate';
import { CHECKER_GLOBALS, CHECKER_MEMBERS } from '../shared/coding-checker-globals';
import { nodeTypeScriptChecker } from '../lib/coding/ts-check-node';
import { evaluateInRunRealm } from './run-realm-node';
import { checkStructuredCloneOwnKeys } from './structured-clone-contracts';
import { UTC_REACT_APP, UTC_REACT_SUITE } from './fixtures/utc-react';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { checkReactBusyContracts } from './react-busy-contracts';

// Every run below goes through the grader's worker thread, built fresh from
// the sources under test, exactly as the deployment runs it.
checkQuickjsProvenance();
await buildSandboxWorker();
await checkReactBusyContracts();

// ── a task page loads a grader thread ahead of its first Submit (#587) ───
// Server item 30: the first Submit on an instance waited for a new thread to
// load QuickJS. A page of a task QuickJS grades now loads one when the
// instance has none, runs an empty program on it and leaves it idle, as any
// run does; a second page loads nothing more, and a React page none.
{
  const page = async (id: string) => {
    const out = { statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingTask({ method: 'GET', headers: { 'x-forwarded-for': '203.0.113.94' }, query: { id } } as never, out as never, null);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  };
  assert.deepEqual(sandboxPool(), { idle: 0, warming: false }, 'no grader thread is loaded before any run');
  await page(CODING_TASKS.find((task) => task.track === 'react' && isFreeCodingTask(task.id))!.id);
  assert.deepEqual(sandboxPool(), { idle: 0, warming: false }, 'a React page loads no QuickJS thread');
  await page('js-double-numbers');
  assert.equal(sandboxPool().warming, true, 'a JavaScript page starts loading one');
  for (let waited = 0; sandboxPool().warming && waited < 15_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(sandboxPool(), { idle: 1, warming: false }, 'and leaves it loaded and idle');
  await page('js-double-numbers');
  assert.deepEqual(sandboxPool(), { idle: 1, warming: false }, 'a second page loads nothing more');
  const graded = await runInSandbox({ code: 'function answer(){return 1}', calls: ['answer()'], expectations: [1] });
  assert.equal(graded.results[0]?.pass, true, 'the warmed thread grades the next run');
  console.log('PASS integrity: a task page loads one grader thread ahead of its first Submit, and only when the instance has none');
}
await checkCodingTaskRuntimePolicy();
await checkSortParity();

const attacks = [
  ['replace comparison', 'globalThis.__deepEqual=()=>true; function answer(){return 0}'],
  ['replace expected answer', 'globalThis.__expect=[0]; function answer(){return 0}'],
  ['replace evaluator', 'globalThis.eval=()=>1; function answer(){return 0}'],
  ['replace intrinsic equality', 'Object.is=()=>true; function answer(){return 0}'],
  ['replace serializer', 'JSON.stringify=()=>\'[ {"pass":true,"actual":"1","error":null} ]\'; function answer(){return 0}'],
  ['forge completion', 'function answer(){globalThis.__done=true;globalThis.__out=\'[ {"pass":true,"actual":"1","error":null} ]\';return new Promise(()=>{})}'],
  ['replace promise combinator', 'Promise.all=()=>Promise.resolve([{ok:true,value:1}]);function answer(){return 0}'],
  ['poison prototype serializer', 'Array.prototype.toJSON=()=>[{pass:true,actual:"1",error:null}];function answer(){return 0}'],
  ['read controller closure', 'function answer(){return __expect[0]}'],
  ['read caller arguments', 'function answer(){return answer.caller.arguments[0]}'],
] as const;
for (const [name, code] of attacks) {
  const run = await runInSandbox({ code, calls: ['answer()'], expectations: [1] });
  assert(!run.results.some(result => result.pass === true), `${name}: forged a pass`);
  console.log(`PASS integrity: ${name}`);
}
const special = await runInSandbox({code:'function answer(){return {a:undefined,b:[NaN,Infinity,-Infinity,-0]}}',calls:['answer()'],expectations:[{a:undefined,b:[NaN,Infinity,-Infinity,-0]}]});
assert.equal(special.results[0]?.pass, true);
const clean = await runInSandbox({code:'function answer(){return 1}',calls:['answer()'],expectations:[1]});
assert.equal(clean.results[0]?.pass, true, 'an attack must not poison the next run');
console.log('PASS integrity: lossless values and fresh run');

// Reading a thrown promise releases its handle; releasing it again made the
// run's error "Lifetime not alive" instead of what the code threw.
const thrownPromise = await runInSandbox({ code: 'throw Promise.resolve(7);', calls: ['1'], expectations: [1] });
const thrownObject = await runInSandbox({ code: 'throw {};', calls: ['1'], expectations: [1] });
assert.notEqual(thrownObject.codeError, null);
assert.equal(thrownPromise.codeError, thrownObject.codeError, 'a thrown promise reads like any other thrown object');
// A promise rejected with another promise made `dump` free the inner one twice.
for (const code of ['throw Promise.reject(Promise.resolve(7));', 'throw Promise.reject(new Promise(() => {}));']) {
  const nested = await runInSandbox({ code, calls: ['1'], expectations: [1] });
  assert.equal(nested.codeError, thrownObject.codeError, `${code} reads like any other thrown object`);
}
console.log('PASS integrity: a thrown promise is reported as the code\'s error');

// Correct arithmetic can produce -0 (`-a - b` with both zero), and no check
// asks for a sign of zero: both graders take -0 for 0, and when a result is
// wrong for another reason its -0 is shown as -0, not as the 0 it was not.
const zeroes = { code: 'function answer(){return [[-0, 0], -0]}\nfunction wrong(){return [-0, 1]}', calls: ['answer()', 'answer()[1]', 'wrong()'], expectations: [[[0, 0], 0], 0, [0, 2]] };
for (const [grader, run] of [['server', await runInSandbox(zeroes)], ['browser', await evaluateCalls(zeroes)]] as const) {
  assert.deepEqual(run.results.map((result) => result.pass), [true, true, false], `${grader}: -0 equals 0`);
  assert.deepEqual(run.results.map((result) => result.actual), ['[[-0,0],-0]', '-0', '[-0,1]'], `${grader}: -0 is shown as -0`);
}
// The case that found it: a correct alg-mh-three-sum that computes the third
// number as -sorted[i] - sorted[j] returned [[-0,0,0]] for [0,0,0].
const threeSum = CODING_TASKS.find((task) => task.id === 'alg-mh-three-sum')!;
const threeSumRun = await runChecks({
  code: 'function threeSum(numbers) {\n  const sorted = [...numbers].sort((a, b) => a - b);\n  const seen = new Set();\n  const triples = [];\n  for (let i = 0; i < sorted.length - 2; i++) {\n    if (i > 0 && sorted[i] === sorted[i - 1]) continue;\n    const lookup = new Set();\n    for (let j = i + 1; j < sorted.length; j++) {\n      const need = -sorted[i] - sorted[j];\n      if (lookup.has(need)) {\n        const triple = [sorted[i], need, sorted[j]];\n        const key = triple.join(",");\n        if (!seen.has(key)) {\n          seen.add(key);\n          triples.push(triple);\n        }\n      }\n      lookup.add(sorted[j]);\n    }\n  }\n  return triples.sort((a, b) => a[0] - b[0] || a[1] - b[1]);\n}',
  visible: threeSum.tests!, hidden: solutionFor(threeSum.id)!.hiddenTests!, shuffle: (list) => list,
});
assert.ok(allPassed(threeSumRun.visible) && threeSumRun.hidden && allPassed(threeSumRun.hidden), 'alg-mh-three-sum: a correct answer that computes -0 passes');
console.log('PASS integrity: -0 equals 0 and shows as -0');

// Hidden checks run in the same program as the visible ones. What they print
// must never reach the learner: a console.log inside the function would
// otherwise hand back every hidden input after Submit.
const echo = 'const echo = x => { console.log("saw", x); return x; };';
const everyCall = await runInSandbox({ code: echo, calls: ['echo(1)', 'echo(2)', 'echo(424242)'], expectations: [1, 2, 424242] });
assert.deepEqual(everyCall.logs, ['saw 1', 'saw 2', 'saw 424242'], 'without a split every call is shown');
const split = await runInSandbox({ code: echo, calls: ['echo(1)', 'echo(2)', 'echo(424242)'], expectations: [1, 2, 424242], shownCalls: 2 });
assert.deepEqual(split.results.map((result) => result.pass), [true, true, true], 'hidden calls are still graded');
assert.deepEqual(split.logs, ['saw 1', 'saw 2'], 'a hidden call prints nothing the learner sees');
const later = await runInSandbox({
  code: 'const echo = async x => { await new Promise((done) => setTimeout(done, x === 424242 ? 1 : 50)); console.log("after", x); return x; };',
  calls: ['echo(1)', 'echo(424242)'], expectations: [1, 424242], shownCalls: 1,
});
assert.deepEqual(later.results.map((result) => result.pass), [true, true]);
assert.deepEqual(later.logs, ['after 1'], 'a hidden call cannot print before a slower shown call settles');
const hung = await runInSandbox({
  code: 'const echo = x => { console.log("saw", x); if (x === 424242) while (true) {} return x; };',
  calls: ['echo(1)', 'echo(424242)'], expectations: [1, 424242], shownCalls: 1, deadlineMs: 300,
});
assert.equal(hung.timedOut, true);
assert(!hung.logs.some((line) => line.includes('424242')), 'a hidden call that hangs still prints nothing');
console.log('PASS integrity: hidden calls print nothing the learner sees');

// The same through the Submit handler. Use the actual catalogue counts and
// visible literal inputs so editorial additions do not turn this privacy
// contract into a stale fixture-count check. Anonymous Submit needs no database.
const response = { statusCode: 200, body: null as null | { verdict?: string; hidden?: unknown; logs?: string[] }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
await handleCodingSubmit({
  method: 'POST', headers: {},
  body: {
    session: encodeCodingSession({ taskId: 'js-digit-sum', track: 'javascript', userId: null }),
    code: 'const digitSum = n => { console.log("digitSum of", n); let total = 0; while (n > 0) { total += n % 10; n = Math.floor(n / 10); } return total; };',
  },
} as never, response as never, null);
assert.equal(response.statusCode, 200, JSON.stringify(response.body));
assert.equal(response.body?.verdict, 'passed');
const loggedDigitTask = CODING_TASKS.find(task => task.id === 'js-digit-sum')!;
const loggedDigitHidden = solutionFor(loggedDigitTask.id)!.hiddenTests!.length;
assert(loggedDigitHidden > 0, 'the privacy probe must still exercise hidden calls');
assert.deepEqual(response.body?.hidden, { passed: loggedDigitHidden, total: loggedDigitHidden });
const loggedDigitExpected = loggedDigitTask.tests!.map(test => {
  const literal = /^digitSum\((\d+)\)$/.exec(test.call);
  assert(literal, 'Adapt the logging probe if its visible authored call shape changes');
  return `digitSum of ${Number(literal[1])}`;
});
assert.deepEqual(response.body?.logs, loggedDigitExpected, 'Submit returns only the visible calls\' console output');
console.log('PASS integrity: Submit shows the visible checks\' console only');

// ── every changed submission in one session is recorded (CODE-1) ─────────
// A workbench keeps one coding session for its whole life. The verdict log
// must still record a fix: fail, then pass, in the same session has to end as
// a passed task, XP once, and a passed Learn level link. A retried request for
// the same submission stays a replay. The fake below keeps the routine's
// contract from migration 041: one application per attempt id, progress per
// account and task, XP once per account and task and only when p_xp is above
// zero, and a level link that only ever turns true. Every routine call is
// kept, with its arguments. `record_coding_reveal` counts a reveal the way
// migration 038 does, and `forfeitAfterReveal` adds migration 048's rule: a
// first pass after a reveal pays no XP. `firstVerifiedPass` is migration 058:
// the first verified pass pays even after an unverified one, and the routine
// says itself whether a reveal cost it the XP.
type ProgressFake = { status: 'in_progress' | 'passed' | 'revealed'; passes: number; revealCount: number; verified?: boolean };
function codingDatabase(options: { forfeitAfterReveal?: boolean; firstVerifiedPass?: boolean } = {}) {
  const attempts = new Set<string>();
  const progress = new Map<string, ProgressFake>();
  const links = new Map<string, boolean>();
  const levels = new Map<string, { user_id: string; coding_task_ids: string[]; completed_at: string | null; expires_at: string }>();
  const xp = new Set<string>();
  const attemptIds: string[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  // Every read and routine call in the order the handler made it.
  const events: string[] = [];
  const result = (data: unknown) => Promise.resolve({ data, error: null });
  const progressRow = (taskId: unknown, row: ProgressFake) => ({
    task_id: taskId, track: 'javascript', status: row.status, passes: row.passes,
    review_stage: 0, next_review_at: null, reveal_count: row.revealCount, best_passed_at: null,
  });
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
      in: () => chain,
      maybeSingle: () => {
        events.push(`read:${table}`);
        if (table === 'roadmap_attempts') return result(levels.get(String(filters.attempt_id)) ?? null);
        if (table === 'coding_progress') {
          const row = progress.get(`${filters.user_id}:${filters.task_id}`);
          return result(row ? progressRow(filters.task_id, row) : null);
        }
        return result(null);
      },
      // A list read of coding_progress returns the account's rows.
      then: (resolve: (value: unknown) => unknown) => (events.push(`list:${table}`), resolve({
        data: table === 'coding_progress'
          ? [...progress].filter(([key]) => key.startsWith(`${filters.user_id}:`)).map(([key, row]) => progressRow(key.slice(key.indexOf(':') + 1), row))
          : [],
        error: null,
      })),
    };
    return chain;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    events.push(`rpc:${name}`);
    if (name === 'record_coding_reveal') {
      const key = `${args.p_user_id}:${args.p_task_id}`;
      const row = progress.get(key) ?? { status: 'in_progress' as const, passes: 0, revealCount: 0 };
      row.revealCount += 1;
      if (row.status !== 'passed') row.status = 'revealed';
      progress.set(key, row);
      return result(null);
    }
    if (name !== 'record_coding_verdict') return result(null);
    const attemptId = String(args.p_attempt_id);
    attemptIds.push(attemptId);
    assert.match(attemptId, /^[A-Za-z0-9:_-]{8,128}$/, 'the attempt id fits the coding_attempts check');
    const key = `${args.p_user_id}:${args.p_task_id}`;
    if (attempts.has(attemptId)) return result({ applied: false, firstPass: false, xpAwarded: false, codeChanged: false });
    attempts.add(attemptId);
    const row = progress.get(key) ?? { status: 'in_progress' as const, passes: 0, revealCount: 0 };
    let firstPass = false;
    let xpAwarded = false;
    let xpForfeited = false;
    if (args.p_outcome === 'passed') {
      const firstVerified = options.firstVerifiedPass === true && args.p_verified === true && row.verified !== true;
      firstPass = row.passes === 0 || firstVerified;
      row.status = 'passed';
      row.passes += 1;
      row.verified = row.verified === true || args.p_verified === true;
      const forfeited = options.forfeitAfterReveal === true && row.revealCount > 0;
      const pays = options.firstVerifiedPass === true ? firstVerified : firstPass;
      if (pays && !xp.has(key) && Number(args.p_xp) > 0) {
        if (forfeited) xpForfeited = true;
        else { xp.add(key); xpAwarded = true; }
      }
    }
    progress.set(key, row);
    if (args.p_roadmap_attempt_id) {
      const link = `${args.p_roadmap_attempt_id}:${args.p_task_id}`;
      links.set(link, links.get(link) === true || args.p_outcome === 'passed');
    }
    return result({ applied: true, firstPass, xpAwarded, codeChanged: firstPass, ...(options.firstVerifiedPass ? { xpForfeited } : {}) });
  };
  return { client: { from, rpc }, progress, links, xp, attemptIds, rpcCalls, levels, events };
}

{
  const db = codingDatabase();
  const learner = 'user-aaaa-1111';
  const levelAttempt = 'levelattempt0123456789';
  db.levels.set(levelAttempt, { user_id: learner, coding_task_ids: ['js-double-numbers'], completed_at: null, expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString() });
  const session = encodeCodingSession({ taskId: 'js-double-numbers', track: 'javascript', userId: learner, roadmapAttemptId: levelAttempt });
  const reference = solutionFor('js-double-numbers')!;
  type Verdict = { verdict?: string; applied?: boolean; firstPass?: boolean; xpAwarded?: number; xpForfeited?: boolean; progress?: { status?: string } | null };
  const submit = async (code: string) => {
    const out = { statusCode: 200, body: null as null | Verdict, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingSubmit({
      method: 'POST', headers: { authorization: 'Bearer local-test' }, query: {},
      body: { session, code, user_id: learner },
    } as never, out as never, db.client as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body!;
  };
  const failed = await submit('const double = numbers => numbers;');
  assert.equal(failed.verdict, 'failed');
  assert.equal(failed.applied, true, 'the first submission is recorded');
  const passed = await submit(reference.solution);
  assert.equal(passed.verdict, 'passed');
  assert.equal(passed.applied, true, 'a fix submitted from the same session is recorded');
  assert.equal(passed.firstPass, true);
  assert.ok((passed.xpAwarded ?? 0) > 0, 'the first pass earns the task XP');
  assert.equal(passed.xpForfeited, false, 'a paid pass claims no forfeit');
  assert.equal(passed.progress?.status, 'passed', 'the task reads as passed');
  assert.equal(db.links.get(`${levelAttempt}:js-double-numbers`), true, 'the Learn level sees the coding task passed');
  const replay = await submit(reference.solution);
  assert.equal(replay.applied, false, 'a retried request for the same submission is a replay');
  assert.equal(replay.xpAwarded, 0);
  const again = await submit(reference.senior!);
  assert.equal(again.verdict, 'passed');
  assert.equal(again.applied, true, 'another passing submission is recorded as another pass');
  assert.equal(again.xpAwarded, 0, 'XP is paid once per task and account');
  assert.equal(db.xp.size, 1);
  assert.equal(db.progress.get(`${learner}:js-double-numbers`)?.passes, 2);
  assert.equal(new Set(db.attemptIds).size, 3, 'three distinct submissions, one replay');
  console.log('PASS integrity: a fix submitted from the same session is recorded, a replay is not');

  // A grader outage is not the learner's error (CODE-14). Without a runner
  // snapshot the isolated React runner cannot start: the Submit says so and
  // records nothing, so the next Submit from the same session still counts.
  delete process.env.REACT_RUNNER_SNAPSHOT_ID;
  const reactTask = CODING_TASKS.find((task) => task.track === 'react' && task.verify === 'tests' && task.suite && isFreeCodingTask(task.id) && !evolvingStage(task.id))!;
  const before = db.attemptIds.length;
  const outage = { statusCode: 200, body: null as null | { verdict?: string; applied?: boolean; codeError?: string | null; failureHint?: unknown; graderUnavailable?: boolean }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({
    method: 'POST', headers: { authorization: 'Bearer local-test' }, query: {},
    body: { session: encodeCodingSession({ taskId: reactTask.id, track: 'react', userId: null }), code: solutionFor(reactTask.id)!.solution, user_id: learner },
  } as never, outage as never, db.client as never);
  assert.equal(outage.statusCode, 200);
  assert.equal(outage.body?.verdict, 'error');
  assert.equal(outage.body?.applied, false);
  assert.match(outage.body?.codeError ?? '', /not recorded/, 'the learner is told nothing was recorded');
  assert.equal(outage.body?.failureHint, null, 'no hint blames the code');
  // The workbench shows it as a problem to retry, not as a build error (CODE-9).
  assert.equal(outage.body?.graderUnavailable, true, 'the verdict says the grader could not run');
  assert.equal(db.attemptIds.length, before, 'a runner outage writes no verdict');
  console.log('PASS integrity: a React runner outage is not recorded as the learner\'s error');

  // React code nested past the compiler's recursion threw a RangeError on
  // this side, before any VM, and was answered as a runner outage the learner
  // could only retry. It is the learner's error, as in the TypeScript grader.
  const deep = { statusCode: 200, body: null as null | { verdict?: string; codeError?: string | null; graderUnavailable?: boolean }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({
    method: 'POST', headers: { 'x-forwarded-for': '203.0.113.73' }, query: {},
    body: { session: encodeCodingSession({ taskId: reactTask.id, track: 'react', userId: null }), code: `export default function App() { return ${'('.repeat(9000)}null${')'.repeat(9000)}; }` },
  } as never, deep as never, null);
  assert.equal(deep.statusCode, 200, JSON.stringify(deep.body));
  assert.equal(deep.body?.verdict, 'error');
  assert.equal(deep.body?.graderUnavailable, undefined, 'over-deep code is not a grader outage');
  assert.match(deep.body?.codeError ?? '', /nests too deeply/);
  console.log('PASS integrity: React code nested too deeply for the compiler is an error verdict, not a runner outage');
}

// ── a slow React VM is a runner outage, not the learner's timeout ────────
// The isolated runner stops everything at 22 s. Any stop counted as the
// learner's timeout, also one while the files were written or the verdict
// was read, or one that left the command less than its 10 s: a slow VM was
// recorded as a timed-out attempt. Only a command that had its whole budget
// is the learner's.
{
  const { Sandbox } = createRequire(join(process.cwd(), 'package.json'))('./lib/coding/generated/vercel-sandbox.cjs') as { Sandbox: { create: (...args: unknown[]) => Promise<unknown> } };
  const { runIsolatedReactSuite } = await import('../lib/coding/react-isolated');
  const realCreate = Sandbox.create;
  const realTimeout = AbortSignal.timeout;
  const realNow = Date.now;
  let skew = 0;
  const aborted = (signal: AbortSignal) => new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const vm = (overrides: Record<string, unknown>) => {
    Sandbox.create = async () => ({
      writeFiles: async () => undefined,
      runCommand: async () => ({ exitCode: 1, stdout: async () => '' }),
      stop: async () => undefined,
      ...overrides,
    });
  };
  const input = { suite: "test('renders', () => {});", appSource: 'export default function App() { return null; }' };
  process.env.REACT_RUNNER_SNAPSHOT_ID = 'snapshot-test';
  AbortSignal.timeout = (ms: number) => realTimeout.call(AbortSignal, ms === 22_000 ? 150 : ms);
  Date.now = () => realNow() + skew;
  // AbortSignal.timeout does not keep the process alive; this does.
  const awake = setInterval(() => undefined, 1_000);
  try {
    vm({ writeFiles: async (_files: unknown, options: { signal: AbortSignal }) => aborted(options.signal) });
    await assert.rejects(runIsolatedReactSuite(input), /unavailable/, 'a stop while the files are written is ours');
    vm({ runCommand: async () => ({ exitCode: 0, stdout: async (options: { signal: AbortSignal }) => aborted(options.signal) }) });
    await assert.rejects(runIsolatedReactSuite(input), /unavailable/, 'a stop while the verdict is read is ours');
    vm({ runCommand: async (options: { signal: AbortSignal }) => aborted(options.signal) });
    await assert.rejects(runIsolatedReactSuite(input), /unavailable/, 'a command stopped before its budget ran out was started late');
    vm({ runCommand: async (options: { signal: AbortSignal }) => { skew = 10_000; return aborted(options.signal); } });
    assert.equal((await runIsolatedReactSuite(input)).timedOut, true, 'a command still going after its whole budget is the learner\'s timeout');
    skew = 0;
    vm({ runCommand: async () => ({ exitCode: 124, stdout: async () => '' }) });
    assert.equal((await runIsolatedReactSuite(input)).timedOut, true, 'a command its own limit stopped is the learner\'s timeout');
  } finally {
    clearInterval(awake);
    Sandbox.create = realCreate;
    AbortSignal.timeout = realTimeout;
    Date.now = realNow;
    delete process.env.REACT_RUNNER_SNAPSHOT_ID;
  }
  console.log('PASS integrity: a slow React VM is a runner outage, not the learner\'s timeout');
}

// ── the React grader bundle is read once per instance (#587 item 14) ────
// Every Submit read the 2 MB bundle from disk again. It is read once and the
// same bytes are uploaded on every run, exactly the deployed file.
{
  const { Sandbox } = createRequire(join(process.cwd(), 'package.json'))('./lib/coding/generated/vercel-sandbox.cjs') as { Sandbox: { create: (...args: unknown[]) => Promise<unknown> } };
  const { runIsolatedReactSuite } = await import('../lib/coding/react-isolated');
  const realCreate = Sandbox.create;
  const uploaded: Buffer[] = [];
  Sandbox.create = async () => ({
    writeFiles: async (files: { path: string; content: Buffer }[]) => { uploaded.push(files.find((file) => file.path.endsWith('/runner.cjs'))!.content); },
    runCommand: async () => ({ exitCode: 124, stdout: async () => '' }),
    stop: async () => undefined,
  });
  process.env.REACT_RUNNER_SNAPSHOT_ID = 'snapshot-test';
  try {
    const input = { suite: "test('renders', () => {});", appSource: 'export default function App() { return null; }' };
    await runIsolatedReactSuite(input);
    await runIsolatedReactSuite(input);
    assert.equal(uploaded.length, 2, 'every run uploads the bundle');
    assert.equal(uploaded[0], uploaded[1], 'the bytes read once are reused');
    assert.ok(uploaded[0].equals(readFileSync(join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs'))), 'and they are the deployed bundle, byte for byte');
  } finally {
    Sandbox.create = realCreate;
    delete process.env.REACT_RUNNER_SNAPSHOT_ID;
  }
  console.log('PASS integrity: the React grader bundle is read once per instance and uploaded unchanged on every run');
}

// ── the verdict does not wait for the VM's stop (#587 item 14) ──────────
// The stop is sent as soon as the verdict is read. Where the runtime keeps
// the function alive for it (the request context's waitUntil), the verdict
// goes on at once; elsewhere it waits for the stop, as before.
{
  const { Sandbox } = createRequire(join(process.cwd(), 'package.json'))('./lib/coding/generated/vercel-sandbox.cjs') as { Sandbox: { create: (...args: unknown[]) => Promise<unknown> } };
  const { runIsolatedReactSuite } = await import('../lib/coding/react-isolated');
  const realCreate = Sandbox.create;
  const contextKey = Symbol.for('@vercel/request-context');
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const realContext = holder[contextKey];
  let release: () => void = () => undefined;
  let stopsSent = 0;
  Sandbox.create = async () => ({
    writeFiles: async () => undefined,
    runCommand: async () => ({ exitCode: 124, stdout: async () => '' }),
    stop: () => { stopsSent += 1; return new Promise<void>((resolve) => { release = resolve; }); },
  });
  process.env.REACT_RUNNER_SNAPSHOT_ID = 'snapshot-test';
  const input = { suite: "test('renders', () => {});", appSource: 'export default function App() { return null; }' };
  const within = (promise: Promise<unknown>, ms: number) => Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);
  try {
    const handed: Promise<unknown>[] = [];
    holder[contextKey] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => { handed.push(promise); } }) };
    const outcome = await within(runIsolatedReactSuite(input), 2_000);
    assert.equal(outcome, true, 'with waitUntil the verdict comes back while the stop is still open');
    assert.equal(stopsSent, 1, 'the stop was sent');
    assert.equal(handed.length, 1, 'and handed to the runtime');
    assert.equal(await within(handed[0], 50), false, 'what was handed settles only with the stop');
    release();
    assert.equal(await within(handed[0], 1_000), true);

    delete holder[contextKey];
    const waiting = runIsolatedReactSuite(input);
    assert.equal(await within(waiting, 100), false, 'without the hook the verdict waits for the stop, as before');
    release();
    assert.equal(await within(waiting, 1_000), true);
    assert.equal(stopsSent, 2);
  } finally {
    Sandbox.create = realCreate;
    if (realContext === undefined) delete holder[contextKey]; else holder[contextKey] = realContext;
    delete process.env.REACT_RUNNER_SNAPSHOT_ID;
  }
  console.log('PASS integrity: a React verdict does not wait for the VM\'s stop where the runtime keeps the function alive for it');
}

// ── work handed over after the response never rejects (F11, #640) ───────
// afterResponse promises two things the React grader's stop relies on: what
// it hands to waitUntil is settled and never a rejection, so a failed stop
// cannot surface as an unhandled rejection after the answer went out; and
// where the runtime cannot keep the function alive (no hook, or a hook that
// throws), the caller waits for the work, so nothing runs past the response
// unowned. The block above covers a stop that resolves; these cover one that
// rejects and a hook that refuses.
{
  const { afterResponse } = await import('../lib/coding/after-response');
  const contextKey = Symbol.for('@vercel/request-context');
  const holder = globalThis as unknown as Record<symbol, unknown>;
  const realContext = holder[contextKey];
  const within = (promise: Promise<unknown>, ms: number) => Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise<string>((resolve) => setTimeout(() => resolve('pending'), ms))]);
  /** Work that rejects only when the test says so. */
  const rejectLater = () => {
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<never>((_resolve, reject) => { fail = reject; });
    return { work, fail: () => fail(new Error('stop failed')) };
  };
  try {
    // A hook: the caller goes on at once, and the runtime holds a promise
    // that resolves when the work rejects.
    const handed: Promise<unknown>[] = [];
    holder[contextKey] = { get: () => ({ waitUntil: (promise: Promise<unknown>) => { handed.push(promise); } }) };
    const withHook = rejectLater();
    assert.equal(await within(afterResponse(withHook.work), 50), 'resolved', 'with waitUntil the caller goes on before the work settles');
    assert.equal(handed.length, 1, 'the work was handed to the runtime');
    assert.equal(await within(handed[0], 50), 'pending', 'what was handed waits for the work');
    withHook.fail();
    assert.equal(await within(handed[0], 1_000), 'resolved', 'and resolves, never rejects, when the work fails');

    // No hook: the caller waits for the work and hears no rejection.
    delete holder[contextKey];
    const noHook = rejectLater();
    const waited = afterResponse(noHook.work);
    assert.equal(await within(waited, 50), 'pending', 'without a hook the caller waits for the work');
    noHook.fail();
    assert.equal(await within(waited, 1_000), 'resolved', 'and goes on, without a rejection, once the work failed');

    // A hook that throws: the same as no hook.
    let refused = 0;
    holder[contextKey] = { get: () => ({ waitUntil: () => { refused += 1; throw new Error('waitUntil refused'); } }) };
    const refusedWork = rejectLater();
    const fallback = afterResponse(refusedWork.work);
    assert.equal(refused, 1, 'the hook was asked');
    assert.equal(await within(fallback, 50), 'pending', 'a hook that throws leaves the caller waiting for the work');
    refusedWork.fail();
    assert.equal(await within(fallback, 1_000), 'resolved', 'which goes on, without a rejection, once the work failed');

    // A request context whose getter throws counts as no hook too.
    holder[contextKey] = { get: () => { throw new Error('no request context'); } };
    let finish: () => void = () => undefined;
    const plain = afterResponse(new Promise<void>((resolve) => { finish = resolve; }));
    assert.equal(await within(plain, 50), 'pending', 'a context that cannot be read leaves the caller waiting');
    finish();
    assert.equal(await within(plain, 1_000), 'resolved');
  } finally {
    if (realContext === undefined) delete holder[contextKey]; else holder[contextKey] = realContext;
  }
  console.log('PASS integrity: work handed over after the response settles without a rejection, and the caller waits for it where the runtime cannot hold it');
}

// ── a checkpoint hands over nothing that passes its milestone ───────────
// A pass of a checkpoint (`…-start`) and a reveal there serve that
// checkpoint's own reference and no boards; that reference fails the
// milestone after it. The free stage one of the expression engine used to
// open Premium milestone 1's three solutions (C2-1).
{
  const db = codingDatabase();
  const learner = 'user-cccc-3333';
  const auth = { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.31' };
  const id = 'js-evolving-calculator-1-start';
  const session = encodeCodingSession({ taskId: id, track: 'javascript', userId: null });
  const reply = () => ({ statusCode: 200, body: null as null | { verdict?: string; solutions?: unknown; solution?: string }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } });
  const pass = reply();
  await handleCodingSubmit({ method: 'POST', headers: auth, query: {}, body: { session, code: solutionFor(id)!.solution, user_id: learner } } as never, pass as never, db.client as never);
  assert.equal(pass.statusCode, 200, JSON.stringify(pass.body));
  assert.equal(pass.body?.verdict, 'passed');
  assert.equal(pass.body?.solutions, null, 'a checkpoint pass opens no junior or senior board');
  const reveal = reply();
  await handleCodingReveal({ method: 'POST', headers: auth, query: {}, body: { session, hintsUsed: 0, user_id: learner } } as never, reveal as never, db.client as never);
  assert.equal(reveal.statusCode, 200, JSON.stringify(reveal.body));
  const milestone = CODING_TASKS.find((task) => task.id === 'js-evolving-calculator-1')!;
  const pasted = await runChecks({ code: reveal.body?.solution ?? '', visible: milestone.tests!, hidden: solutionFor(milestone.id)!.hiddenTests!, shuffle: (list) => list });
  assert.ok(!allPassed(pasted.visible) || (pasted.hidden !== null && !allPassed(pasted.hidden)), 'the revealed checkpoint reference does not pass the milestone');
  console.log('PASS integrity: a checkpoint pass and reveal hand over nothing that passes its milestone');
}

// ── a pass after a reveal says it paid nothing, and only then ───────────
// Migration 048 pays no XP (and so no coins) for a first pass after the
// learner revealed that task's solution. The verdict says so in
// `xpForfeited`, read from the progress row before the pass. Before 048 the
// routine still pays: xpAwarded is then true and nothing claims a forfeit.
{
  type Verdict = { verdict?: string; firstPass?: boolean; xpAwarded?: number; xpForfeited?: boolean };
  const reference = solutionFor('js-double-numbers')!;
  const reply = () => ({ statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } });
  // An address of its own, so these requests spend none of the other tests' rate budget.
  const auth = { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.21' };
  const play = (db: ReturnType<typeof codingDatabase>, learner: string) => {
    const session = encodeCodingSession({ taskId: 'js-double-numbers', track: 'javascript', userId: null });
    return {
      reveal: async () => {
        const out = reply();
        await handleCodingReveal({ method: 'POST', headers: auth, query: {}, body: { session, hintsUsed: 20, user_id: learner } } as never, out as never, db.client as never);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
      },
      submit: async (code: string) => {
        const out = reply();
        await handleCodingSubmit({ method: 'POST', headers: auth, query: {}, body: { session, code, user_id: learner } } as never, out as never, db.client as never);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        return out.body as Verdict;
      },
    };
  };

  const after048 = codingDatabase({ forfeitAfterReveal: true });
  const learner = 'user-bbbb-2222';
  const run = play(after048, learner);
  await run.reveal();
  assert.equal(after048.progress.get(`${learner}:js-double-numbers`)?.status, 'revealed');
  const readsBefore = after048.events.length;
  const forfeited = await run.submit(reference.solution);
  // #587 server item 10: the pass reads its progress row once, after the
  // verdict is written; no read before the write, which only a pre-058
  // database needed and which the row read back now answers.
  const passEvents = after048.events.slice(readsBefore);
  assert.deepEqual(passEvents.filter((event) => event === 'read:coding_progress' || event === 'rpc:record_coding_verdict'), ['rpc:record_coding_verdict', 'read:coding_progress'],
    `a pass reads its progress row only after the verdict is written (${passEvents.join(', ')})`);
  assert.equal(forfeited.verdict, 'passed');
  assert.equal(forfeited.firstPass, true);
  assert.equal(forfeited.xpAwarded, 0, 'migration 048 pays nothing for a first pass after a reveal');
  assert.equal(forfeited.xpForfeited, true, 'the verdict says the reveal cost the XP');
  const later = await run.submit(reference.senior!);
  assert.equal(later.verdict, 'passed');
  assert.equal(later.xpForfeited, false, 'a later pass forfeits nothing: nothing was on offer');

  const before048 = codingDatabase();
  const early = play(before048, learner);
  await early.reveal();
  const paid = await early.submit(reference.solution);
  assert.equal(paid.firstPass, true);
  assert.ok((paid.xpAwarded ?? 0) > 0, 'before 048 the routine still pays');
  assert.equal(paid.xpForfeited, false, 'a paid pass never claims a forfeit');

  // XP withheld for another reason, with no reveal on record, is no forfeit.
  const ledger = codingDatabase({ forfeitAfterReveal: true });
  ledger.xp.add(`${learner}:js-double-numbers`);
  const unpaid = await play(ledger, learner).submit(reference.solution);
  assert.equal(unpaid.firstPass, true);
  assert.equal(unpaid.xpAwarded, 0);
  assert.equal(unpaid.xpForfeited, false, 'no reveal, no claim');
  console.log('PASS integrity: a pass after a reveal says it earned no XP, and nothing else does');
}

// ── an old unverified pass no longer blocks the XP (C1-7) ───────────────
// React passes reported by the browser (3-29 September) and checklist
// capstones were recorded unverified, and the routine paid only a task's
// first pass, so the first pass the server checked never paid. Migration 058
// (owner decision 3) pays the first verified pass, once, and its coins with
// it under the same award id; the old pass stays on record. A reveal before
// it still forfeits the XP, which only the routine can tell: the row already
// reads 'passed'.
{
  type Verdict = { verdict?: string; firstPass?: boolean; xpAwarded?: number; xpForfeited?: boolean };
  const id = 'js-double-numbers';
  const reference = solutionFor(id)!;
  const taskXp = CODING_TASK_XP[CODING_TASKS.find((task) => task.id === id)!.tier];
  const db = codingDatabase({ forfeitAfterReveal: true, firstVerifiedPass: true });
  const auth = { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.71' };
  const submit = async (learner: string, code: string) => {
    const out = { statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingSubmit({ method: 'POST', headers: auth, query: {}, body: { session: encodeCodingSession({ taskId: id, track: 'javascript', userId: null }), code, user_id: learner } } as never, out as never, db.client as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body as Verdict;
  };
  const coinCredits = (learner: string) => db.rpcCalls.filter((call) => call.name === 'credit_verified_xp_tokens' && call.args.p_user_id === learner);

  const legacy = 'user-legacy-0001';
  db.progress.set(`${legacy}:${id}`, { status: 'passed', passes: 1, revealCount: 0, verified: false });
  const paid = await submit(legacy, reference.solution);
  assert.equal(paid.verdict, 'passed');
  assert.equal(paid.firstPass, true, 'the first verified pass reads as the first pass');
  assert.equal(paid.xpAwarded, taskXp, 'it pays the task XP although an unverified pass came first');
  assert.equal(paid.xpForfeited, false);
  assert.deepEqual(coinCredits(legacy).map((call) => call.args.p_award_id), [codingAwardId(legacy, id)], 'its coins are credited once, under the task award id');
  const again = await submit(legacy, reference.senior!);
  assert.equal(again.xpAwarded, 0, 'a later verified pass pays nothing');
  assert.equal(coinCredits(legacy).length, 1, 'and credits no more coins');
  assert.equal(db.progress.get(`${legacy}:${id}`)?.passes, 3, 'the old pass stays on record');

  const revealed = 'user-legacy-0002';
  db.progress.set(`${revealed}:${id}`, { status: 'passed', passes: 1, revealCount: 1, verified: false });
  const readsBefore = db.events.length;
  const forfeited = await submit(revealed, reference.solution);
  assert.deepEqual(db.events.slice(readsBefore).filter((event) => event === 'read:coding_progress' || event === 'rpc:record_coding_verdict'), ['rpc:record_coding_verdict', 'read:coding_progress'],
    'on 058 a pass reads its progress row once, after the verdict (#587 item 10)');
  assert.equal(forfeited.xpAwarded, 0, 'a reveal before the first verified pass still costs its XP');
  assert.equal(forfeited.xpForfeited, true, 'and the verdict says so, though the row already read passed');
  assert.equal(coinCredits(revealed).length, 0, 'no coins either');
  console.log('PASS integrity: an old unverified pass no longer blocks the first verified pass\'s XP and coins');
}

// ── a pass credits its coins and settles milestones at once (#587) ───────
// Server item 10: the coin credit and the milestone settlement ran one after
// the other although neither reads what the other writes. They now start
// together, and the answer still waits for both. Server item 8: the
// settlement credits only a Premium account, so a free account's pass skips
// it and still credits its XP coins. The tier comes from the request's
// remembered plan (lib/access.ts reads no database here, which answers free).
{
  const db = codingDatabase();
  const learner = 'user-parallel-0009';
  const timeline: string[] = [];
  const routine = db.client.rpc;
  db.client.rpc = (name: string, args: Record<string, unknown>) => {
    if (name !== 'credit_verified_xp_tokens' && name !== 'settle_coin_milestones') return routine(name, args);
    db.rpcCalls.push({ name, args });
    timeline.push(`start:${name}`);
    return new Promise((resolve) => setTimeout(() => {
      timeline.push(`end:${name}`);
      resolve({ data: name === 'settle_coin_milestones' ? {} : 3, error: null });
    }, 25));
  };
  const out = { statusCode: 200, body: null as null | { verdict?: string; xpAwarded?: number }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  const premiumReq = {
    method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.91' }, query: {},
    body: { session: encodeCodingSession({ taskId: 'js-double-numbers', track: 'javascript', userId: null }), code: solutionFor('js-double-numbers')!.solution, user_id: learner },
  };
  await withRequestContext(premiumReq as never, out as never, async () => {
    void requestMemo(`tier:${learner}`, async () => 'premium');
    await handleCodingSubmit(premiumReq as never, out as never, db.client as never);
  });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body?.verdict, 'passed');
  assert.ok((out.body?.xpAwarded ?? 0) > 0, 'the pass earns its XP');
  assert.deepEqual(timeline.slice(0, 2).sort(), ['start:credit_verified_xp_tokens', 'start:settle_coin_milestones'], `both routines start before either ends (${timeline.join(', ')})`);
  assert.equal(timeline.length, 4, 'and the answer waits for both');
  // A free account: the XP coins, no settlement.
  timeline.length = 0;
  const free = { ...out, statusCode: 200, body: null as null | { verdict?: string; xpAwarded?: number } };
  await handleCodingSubmit({
    method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.92' }, query: {},
    body: { session: encodeCodingSession({ taskId: 'js-double-numbers', track: 'javascript', userId: null }), code: solutionFor('js-double-numbers')!.solution, user_id: 'user-parallel-free-0010' },
  } as never, free as never, db.client as never);
  assert.equal(free.statusCode, 200, JSON.stringify(free.body));
  assert.ok((free.body?.xpAwarded ?? 0) > 0, 'a free account\'s pass earns its XP');
  assert.deepEqual(timeline, ['start:credit_verified_xp_tokens', 'end:credit_verified_xp_tokens'], 'and credits its coins without settle_coin_milestones, which credits only Premium accounts');
  console.log('PASS integrity: a pass credits its coins and settles milestones together for a Premium account, and a free account skips the settlement');
}

// ── a Submit reads what waits only on the caller while other work runs ───
// Server item 10: a Learn-linked Submit of Premium content asked the plan,
// then read the level attempt, after both per-task buckets had answered; a
// signed-in stage Submit read its passed stages after the code was graded.
// The attempt is now read as soon as the token check answers, while the
// plan is still being asked, and the stages while the code is graded. The
// gates still decide in their order on what was read.
{
  const db = codingDatabase();
  const learner = 'user-prefetch-0010';
  const levelAttempt = 'prefetchattempt0123456789';
  db.levels.set(levelAttempt, { user_id: learner, coding_task_ids: ['alg-dsa-stack'], completed_at: null, expires_at: new Date(Date.now() + 60 * 60_000).toISOString() });
  const session = encodeCodingSession({ taskId: 'alg-dsa-stack', track: 'algorithms', userId: learner, roadmapAttemptId: levelAttempt });
  const req = { method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.92' }, query: {}, body: { session, code: solutionFor('alg-dsa-stack')!.solution, user_id: learner } };
  const out = { statusCode: 200, body: null as null | { verdict?: string; applied?: boolean }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await withRequestContext(req as never, out as never, async () => {
    // A Premium account whose plan takes a moment to answer.
    void requestMemo(`tier:${learner}`, () => new Promise((resolve) => setTimeout(() => { db.events.push('tier:answered'); resolve('premium'); }, 30)));
    await handleCodingSubmit(req as never, out as never, db.client as never);
  });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.equal(out.body?.verdict, 'passed');
  assert.equal(out.body?.applied, true, 'the linked pass is recorded');
  const attemptRead = db.events.indexOf('read:roadmap_attempts');
  assert.ok(attemptRead >= 0 && attemptRead < db.events.indexOf('tier:answered'), `the level attempt is read while the plan is asked (${db.events.join(', ')})`);
  assert.equal(db.events.filter((event) => event === 'read:roadmap_attempts').length, 1, 'and read once');

  // The stage gate's read starts while the code holds its grading slot: a
  // probe of the same in-flight count, one per task, finds it taken.
  const stageId = 'js-evolving-calculator-1-start';
  const stageLearner = 'user-prefetch-0011';
  const probes: boolean[] = [];
  const stageDb = codingDatabase();
  const list = stageDb.client.from;
  stageDb.client.from = (table: string) => {
    const chain = list(table) as { then: (resolve: (value: unknown) => unknown) => unknown };
    const then = chain.then;
    if (table === 'coding_progress') chain.then = (resolve) => {
      const slot = enterInFlight(stageReq as never, 'grading', { item: gradingItem.task(stageId), perItem: 1, perCaller: 99 }, `user:${stageLearner}`);
      probes.push(slot === null);
      slot?.();
      return then(resolve);
    };
    return chain as never;
  };
  const stageReq = { method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.93' }, query: {}, body: { session: encodeCodingSession({ taskId: stageId, track: 'javascript', userId: stageLearner }), code: solutionFor(stageId)!.solution, user_id: stageLearner } };
  const stageOut = { statusCode: 200, body: null as null | { verdict?: string; applied?: boolean }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit(stageReq as never, stageOut as never, stageDb.client as never);
  assert.equal(stageOut.statusCode, 200, JSON.stringify(stageOut.body));
  assert.equal(stageOut.body?.verdict, 'passed');
  assert.equal(stageOut.body?.applied, true, 'the open stage is recorded');
  assert.deepEqual(probes, [true], 'the stage gate reads the passed stages once, while the code is graded');
  console.log('PASS integrity: a Submit reads the Learn attempt while the plan is asked and a stage\'s passed stages while it is graded');
}

// ── a task's XP again, after a reset and an hour (migration 058) ─────────
// Signed in, Reset tells the server (coding-reset); a pass the routine pays as
// a repeat is XP only, so the handler credits no coins for it, and the verdict
// carries when the XP opens again. A reveal after a pass reaches the routine
// that forfeits the open reset's XP, and never the one that would end a Learn
// level. A guest's reset records nothing.
{
  type Verdict = { verdict?: string; firstPass?: boolean; xpAwarded?: number; repeatXp?: unknown; error?: { code?: string } };
  const id = 'js-double-numbers';
  const reference = solutionFor(id)!;
  const taskXp = CODING_TASK_XP[CODING_TASKS.find((task) => task.id === id)!.tier];
  const learner = 'user-repeat-0007';
  const availableAt = '2026-10-09T13:32:00.000Z';
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let verdictData: Record<string, unknown> = {};
  const row = { task_id: id, track: 'javascript', status: 'passed', passes: 1, review_stage: 0, next_review_at: null, reveal_count: 0, best_passed_at: null };
  const db = {
    from: () => {
      const chain = {
        select: () => chain, eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [row], error: null }),
      };
      return chain;
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === 'record_coding_verdict') return Promise.resolve({ data: verdictData, error: null });
      if (name === 'record_coding_reset') return Promise.resolve({ data: { recorded: true, availableAt: '2026-10-09T15:32:00+02:00' }, error: null });
      return Promise.resolve({ data: name === 'record_coding_repeat_reveal' ? true : null, error: null });
    },
  };
  const reply = () => ({ statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } });
  const auth = (user?: string) => ({ 'x-forwarded-for': '203.0.113.72', ...(user ? { authorization: 'Bearer local-test' } : {}) });
  const session = encodeCodingSession({ taskId: id, track: 'javascript', userId: null });
  const submit = async () => {
    const out = reply();
    await handleCodingSubmit({ method: 'POST', headers: auth(learner), query: {}, body: { session, code: reference.solution, user_id: learner } } as never, out as never, db as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body as Verdict;
  };
  const coins = () => calls.filter((call) => call.name === 'credit_verified_xp_tokens').length;

  verdictData = { applied: true, firstPass: false, xpAwarded: true, xpKind: 'repeat', xpForfeited: false,
    repeatXp: { availableAt: '2026-10-09T15:32:00+02:00', needsReset: true, withheld: null } };
  const repeat = await submit();
  assert.equal(repeat.xpAwarded, taskXp, 'a repeat pays the task\'s XP');
  assert.equal(repeat.firstPass, false);
  assert.deepEqual(repeat.repeatXp, { availableAt, needsReset: true, withheld: null }, 'the verdict says when the XP opens again');
  assert.equal(coins(), 0, 'a repeat credits no coins');

  verdictData = { applied: true, firstPass: true, xpAwarded: true, xpKind: 'first', xpForfeited: false,
    repeatXp: { availableAt, needsReset: true, withheld: null } };
  await submit();
  assert.equal(coins(), 1, 'a first pass still credits its coins');

  verdictData = { applied: true, firstPass: false, xpAwarded: false, xpKind: null, xpForfeited: false,
    repeatXp: { availableAt, needsReset: true, withheld: 'reset' } };
  const withheld = await submit();
  assert.equal(withheld.xpAwarded, 0);
  assert.deepEqual(withheld.repeatXp, { availableAt, needsReset: true, withheld: 'reset' }, 'and why a pass paid nothing');

  // Reset, signed in: recorded for the account and the session's task.
  const reset = reply();
  await handleCodingReset({ method: 'POST', headers: auth(learner), query: {}, body: { session, user_id: learner } } as never, reset as never, db as never);
  assert.equal(reset.statusCode, 200, JSON.stringify(reset.body));
  assert.deepEqual(reset.body, { recorded: true, availableAt }, 'the reset answers when the XP opens');
  assert.deepEqual(calls.filter((call) => call.name === 'record_coding_reset').map((call) => call.args), [{ p_user_id: learner, p_task_id: id }]);
  // A guest's reset, and another account's session, record nothing.
  const guest = reply();
  await handleCodingReset({ method: 'POST', headers: auth(), query: {}, body: { session } } as never, guest as never, db as never);
  assert.equal(guest.statusCode, 401, 'a guest earns no XP, so its reset is not recorded');
  const foreign = reply();
  await handleCodingReset({ method: 'POST', headers: auth(learner), query: {}, body: { session: encodeCodingSession({ taskId: id, track: 'javascript', userId: 'user-someone-else' }), user_id: learner } } as never, foreign as never, db as never);
  assert.equal(foreign.statusCode, 403);
  assert.equal(calls.filter((call) => call.name === 'record_coding_reset').length, 1, 'neither reached the routine');

  // A reveal after the pass forfeits the open reset's XP, and nothing else.
  const revealed = reply();
  await handleCodingReveal({ method: 'POST', headers: auth(learner), query: {}, body: { session, hintsUsed: 0, user_id: learner } } as never, revealed as never, db as never);
  assert.equal(revealed.statusCode, 200, JSON.stringify(revealed.body));
  assert.deepEqual(calls.filter((call) => call.name.startsWith('record_coding_re') && call.name !== 'record_coding_reset').map((call) => call.name), ['record_coding_repeat_reveal'],
    'a reveal after a pass is recorded against the open reset, not as a level-ending reveal');
  console.log('PASS integrity: a task\'s repeat XP takes a reset, pays no coins, and says when it opens again');
}

// ── a failed system-design submission carries no key ────────────────────
// A failed or partly right submission says which answers were wrong and
// nothing of the key: no correct option, order or range, no explanation and
// no reference answer. Otherwise the key could be read, the task reopened
// under a new shuffle and passed for full XP. A pass carries all of it.
// System design is hidden (owner decision, 9 Oct 2026): no handler opens or
// grades one, so the grader is proven here directly, as the handlers called
// it, against every kind of design task, for the review before it returns.
{
  type Step = { correct: boolean; given: unknown; correctIndex?: number; correctOrder?: number[]; acceptedRange?: unknown; explanation?: string };
  type Verdict = { verdict?: string; design?: Step[] | null; designReference?: string | null };
  type Opened = { key: CodingDesignKey; task: { design?: { steps: { options: string[] }[] }; drill?: { options?: string[]; steps?: string[] } } };
  // A fresh shuffle per opening, as the task resource deals one per request.
  let deal = 0;
  const shuffle = <T,>(list: T[]): T[] => { deal += 1; return list.map((_, index) => list[(index + deal) % list.length]); };
  const open = (id: string): Opened => {
    const prepared = prepareDesign(byId(id), shuffle);
    return { key: prepared.key, task: { design: prepared.design, drill: prepared.drill } };
  };
  const submit = (opened: Opened, id: string, answers: unknown[]): Verdict => {
    const graded = gradeDesign(byId(id), opened.key, answers as DesignAnswer[]);
    return { verdict: graded.outcome, design: graded.verdicts as Step[], designReference: graded.reference };
  };
  const withheld = (verdict: Verdict, secrets: string[], label: string) => {
    assert.equal(verdict.designReference, null, `${label}: no reference answer`);
    for (const step of verdict.design ?? []) {
      assert.deepEqual(Object.keys(step).sort(), ['correct', 'given'], `${label}: a step carries whether it was right and the answer given, nothing else`);
    }
    const wire = JSON.stringify(verdict);
    for (const secret of secrets) assert.ok(!wire.includes(secret.slice(0, 60)), `${label}: no explanation or reference text`);
  };
  const byId = (id: string) => CODING_TASKS.find((task) => task.id === id)!;
  const guided = CODING_TASKS.find((task) => task.track === 'system-design' && task.design)!;
  const estimate = CODING_TASKS.find((task) => task.drill?.format === 'estimate')!;
  const choice = CODING_TASKS.find((task) => task.drill?.format === 'tradeoff')!;
  const sequence = CODING_TASKS.find((task) => task.drill?.format === 'sequence')!;

  // None of them opens, and a sealed session for one is refused before
  // anything is graded.
  {
    const reply = () => ({ statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } });
    const auth = { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.22' };
    for (const task of [guided, estimate, choice, sequence]) {
      const asked = reply();
      await handleCodingTask({ method: 'GET', headers: auth, query: { id: task.id, user_id: 'user-cccc-3333' } } as never, asked as never, codingDatabase().client as never);
      assert.equal(asked.statusCode, 404, `${task.id}: not found`);
      const prepared = prepareDesign(task, (list) => list);
      const graded = reply();
      const session = encodeCodingSession({ taskId: task.id, track: 'system-design', userId: 'user-cccc-3333', key: prepared.key });
      await handleCodingSubmit({ method: 'POST', headers: auth, query: {}, body: { session, answers: [0], user_id: 'user-cccc-3333' } } as never, graded as never, codingDatabase().client as never);
      assert.equal(graded.statusCode, 400, `${task.id}: Submit refuses it`);
      assert.equal((graded.body as { error?: { code?: string } }).error?.code, 'invalid_session');
    }
  }

  // A guided walkthrough: all wrong, then one short of the pass mark.
  const design = guided.design!;
  const secrets = [...design.steps.map((step) => step.explanation), design.reference];
  const rightFor = (opened: Opened) => opened.task.design!.steps.map((step, index) =>
    step.options.findIndex((option) => option === design.steps[index].options[design.steps[index].correct]));
  const first = open(guided.id);
  const right = rightFor(first);
  assert.ok(right.every((index) => index >= 0));
  const wrong = right.map((index, step) => (index + 1) % design.steps[step].options.length);
  const allWrong = submit(first, guided.id, wrong);
  assert.equal(allWrong.verdict, 'failed');
  assert.deepEqual(allWrong.design?.map((step) => step.correct), right.map(() => false));
  assert.deepEqual(allWrong.design?.map((step) => step.given), wrong, 'the learner\'s own answers come back');
  withheld(allWrong, secrets, 'all wrong');
  const second = open(guided.id);
  const secondRight = rightFor(second);
  const shortBy = design.passMark - 1;
  const partly = submit(second, guided.id, secondRight.map((index, step) => (step < shortBy ? index : (index + 1) % design.steps[step].options.length)));
  assert.equal(partly.verdict, 'failed');
  assert.equal(partly.design?.filter((step) => step.correct).length, shortBy, 'the right steps are marked right');
  withheld(partly, secrets, 'partly right');
  const third = open(guided.id);
  const thirdRight = rightFor(third);
  const pass = submit(third, guided.id, thirdRight);
  assert.equal(pass.verdict, 'passed');
  assert.deepEqual(pass.design?.map((step) => step.correctIndex), thirdRight, 'a pass carries the correct options');
  assert.deepEqual(pass.design?.map((step) => step.explanation), design.steps.map((step) => step.explanation), 'and the explanations');
  assert.equal(pass.designReference, design.reference, 'and the reference answer');

  // An estimate drill.
  const band = byId(estimate.id).drill!;
  const estimateOpened = open(estimate.id);
  const tooHigh = (band.max ?? 0) * 10 + 1;
  const missed = submit(estimateOpened, estimate.id, [tooHigh]);
  assert.equal(missed.verdict, 'failed');
  assert.deepEqual(missed.design, [{ correct: false, given: tooHigh }]);
  withheld(missed, [band.explanation], 'estimate');
  const inBand = submit(open(estimate.id), estimate.id, [band.answer!]);
  assert.equal(inBand.verdict, 'passed');
  assert.deepEqual(inBand.design?.[0].acceptedRange, { min: band.min, max: band.max, answer: band.answer }, 'a pass carries the accepted range');
  assert.equal(inBand.design?.[0].explanation, band.explanation);

  // A trade-off drill.
  const pick = byId(choice.id).drill!;
  const choiceOpened = open(choice.id);
  const choiceRight = choiceOpened.task.drill!.options!.findIndex((option) => option === pick.options![pick.correct!]);
  const choiceWrong = (choiceRight + 1) % pick.options!.length;
  const wrongPick = submit(choiceOpened, choice.id, [choiceWrong]);
  assert.deepEqual(wrongPick.design, [{ correct: false, given: choiceWrong }]);
  withheld(wrongPick, [pick.explanation], 'trade-off');
  const choiceAgain = open(choice.id);
  const rightPick = submit(choiceAgain, choice.id, [choiceAgain.task.drill!.options!.findIndex((option) => option === pick.options![pick.correct!])]);
  assert.equal(rightPick.verdict, 'passed');
  assert.equal(typeof rightPick.design?.[0].correctIndex, 'number', 'a pass carries the correct option');

  // A sequence drill.
  const order = byId(sequence.id).drill!;
  const orderFor = (opened: Opened) => order.steps!.map((step) => opened.task.drill!.steps!.findIndex((shown) => shown === step));
  const sequenceOpened = open(sequence.id);
  const reversed = [...orderFor(sequenceOpened)].reverse();
  const outOfOrder = submit(sequenceOpened, sequence.id, [reversed]);
  assert.deepEqual(outOfOrder.design, [{ correct: false, given: reversed }]);
  withheld(outOfOrder, [order.explanation], 'sequence');
  const sequenceAgain = open(sequence.id);
  const inOrder = submit(sequenceAgain, sequence.id, [orderFor(sequenceAgain)]);
  assert.equal(inOrder.verdict, 'passed');
  assert.deepEqual(inOrder.design?.[0].correctOrder, orderFor(sequenceAgain), 'a pass carries the correct order');
  console.log('PASS integrity: system design opens nowhere; its grader still gives a failed submission no key and a pass all of it');
}

// ── a checklist pass is the learner's word, and pays nothing ─────────────
// A React task graded `verify: 'checklist'` has no suite, so any code passes.
// That pass is recorded as unverified: no XP and so no coins, no link to the
// Learn level attempt the session names, and no junior and senior solutions.
// No task in the catalogue uses the mode any more, so the case turns a free
// React task with both solutions into one and puts it back afterwards.
{
  const db = codingDatabase();
  const learner = 'user-bbbb-2222';
  const levelAttempt = 'levelattemptchecklist01';
  const task = CODING_TASKS.find((one) => one.track === 'react' && one.verify === 'tests' && one.suite && isFreeCodingTask(one.id)
    && !evolvingStage(one.id) && solutionFor(one.id)?.junior && solutionFor(one.id)?.senior)!;
  const { verify, suite } = task;
  db.levels.set(levelAttempt, { user_id: learner, coding_task_ids: [task.id], completed_at: null, expires_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString() });
  task.verify = 'checklist';
  delete task.suite;
  try {
    const out = { statusCode: 200, body: null as null | { verdict?: string; xpAwarded?: number; applied?: boolean; solutions?: unknown }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingSubmit({
      method: 'POST', headers: { authorization: 'Bearer local-test' }, query: {},
      body: { session: encodeCodingSession({ taskId: task.id, track: 'react', userId: learner, roadmapAttemptId: levelAttempt }), code: 'const App = () => null;', user_id: learner },
    } as never, out as never, db.client as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.equal(out.body?.verdict, 'passed', 'the learner\'s confirmation still stands');
    assert.equal(out.body?.applied, true, 'the attempt is recorded');
    const [verdict] = db.rpcCalls.filter((call) => call.name === 'record_coding_verdict');
    assert.equal(verdict?.args.p_verified, false, 'recorded as unverified');
    assert.equal(verdict?.args.p_xp, 0, 'with no XP');
    assert.equal(verdict?.args.p_roadmap_attempt_id, null, 'and linked to no Learn level attempt');
    assert.equal(db.links.size, 0, 'so the Learn level never counts it');
    assert.equal(out.body?.xpAwarded, 0);
    assert.equal(db.xp.size, 0);
    assert.ok(!db.rpcCalls.some((call) => call.name === 'credit_verified_xp_tokens'), 'no coins');
    assert.equal(out.body?.solutions, null, 'a pass nothing checked opens no solutions');
  } finally {
    task.verify = verify;
    task.suite = suite;
  }
  console.log('PASS integrity: a checklist pass is recorded unverified, with no XP, coins, Learn link or solutions');
}

// ── a code-ordering puzzle round-trips through its session (CODE-7) ──────
// The task handler seals the presentation-id translation into the session;
// the submit handler must find it there again, or every arrangement is
// refused as "this session did not issue a puzzle".
{
  type Body = { session?: string; task?: { puzzle?: { lines: { id: string; code: string }[] } }; puzzle?: { accepted?: boolean } };
  const reply = () => ({ statusCode: 200, body: null as null | Body, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } });
  for (const id of ['js-sum-array', 'js-count-vowels']) {
    const authored = puzzleFor(id)!;
    const opened = reply();
    await handleCodingTask({ method: 'GET', headers: {}, query: { id } } as never, opened as never, null);
    assert.equal(opened.statusCode, 200);
    const lines = opened.body!.task!.puzzle!.lines;
    const byCode = new Map(lines.map((line) => [line.code, line.id]));
    const arrange = async (authoredOrder: readonly string[]) => {
      const order = authoredOrder.map((line) => byCode.get(authored.lines.find((one) => one.id === line)!.code)!);
      const sent = reply();
      await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: opened.body!.session, order } } as never, sent as never, null);
      return sent;
    };
    const right = await arrange(authored.accepted[0]);
    assert.equal(right.statusCode, 200, `${id}: ${JSON.stringify(right.body)}`);
    assert.equal(right.body?.puzzle?.accepted, true, `${id}: an accepted order is accepted`);
    const wrong = await arrange([...authored.accepted[0]].reverse());
    assert.equal(wrong.statusCode, 200);
    assert.equal(wrong.body?.puzzle?.accepted, false, `${id}: a reversed order is not`);
    const forged = reply();
    await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: opened.body!.session, order: lines.map((_, index) => `b${index + 2}`) } } as never, forged as never, null);
    assert.equal(forged.statusCode, 400, `${id}: an id the session never issued is refused`);
    // A right order padded with entries that are not ids is not the order
    // the learner sent; it is refused, not accepted with the junk dropped.
    const padded = reply();
    const rightIds = authored.accepted[0].map((line) => byCode.get(authored.lines.find((one) => one.id === line)!.code)!);
    await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: opened.body!.session, order: [...rightIds, {}, 42] } } as never, padded as never, null);
    assert.equal(padded.statusCode, 400, `${id}: an order padded with non-ids is refused`);
  }
  // A signed-in arrangement whose record fails is still answered, and the
  // lost record is logged rather than dropped without a trace.
  {
    const id = 'js-sum-array';
    const authored = puzzleFor(id)!;
    const opened = reply();
    await handleCodingTask({ method: 'GET', headers: {}, query: { id } } as never, opened as never, null);
    const byCode = new Map(opened.body!.task!.puzzle!.lines.map((line) => [line.code, line.id]));
    const order = authored.accepted[0].map((line) => byCode.get(authored.lines.find((one) => one.id === line)!.code)!);
    const failing = { rpc: async () => ({ data: null, error: { code: 'XX000', message: 'connection reset' } }) };
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    const sent = reply();
    try {
      await handleCodingSubmit({ method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.72' }, query: {}, body: { session: opened.body!.session, order, user_id: 'user-puzzle-0001' } } as never, sent as never, failing as never);
    } finally { console.log = log; }
    assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
    assert.equal(sent.body?.puzzle?.accepted, true);
    assert.ok(lines.some((line) => line.includes('"kind":"puzzle_unrecorded"') && line.includes('"reason":"XX000"')), 'the failed puzzle record is logged');
  }
  console.log('PASS integrity: a code-ordering puzzle submits through the session that issued it');
}

// ── the code cannot swallow its type tests (CODE-6) ──────────────────────
// Code typed `any` throughout fails the assertion that must reject a wrong
// argument. Ending the code inside an unterminated template literal, block
// comment or string used to pull every type-test line into that token, so
// the rejecting assertion "passed" and so did the task.
{
  const anyShipping = 'type Speed = any;\nconst shippingDays = (speed: any, weekend: any): any => (speed === "standard" ? 5 : speed === "express" ? 2 : 1) + (weekend ? 1 : 0);';
  const anyGroupBy = 'function groupBy(items: any, keyOf: any): any { const m = new Map(); for (const i of items) { const k = keyOf(i); m.has(k) ? m.get(k).push(i) : m.set(k, [i]); } return m; }';
  const submitTs = async (taskId: string, code: string) => {
    const out = { statusCode: 200, body: null as null | { verdict?: string; solutions?: unknown }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: encodeCodingSession({ taskId, track: 'typescript', userId: null }), code } } as never, out as never, null);
    assert.equal(out.statusCode, 200);
    return out.body!;
  };
  assert.equal((await submitTs('ts-shipping-speed', anyShipping)).verdict, 'failed', '`any` everywhere fails the rejecting type test');
  for (const tail of ['\ntype __Z = `', '\n/*', '\nconst __z = "', '\n// @ts-ignore']) {
    for (const [taskId, code] of [['ts-shipping-speed', anyShipping], ['ts-path-generics-1', anyGroupBy]] as const) {
      const verdict = await submitTs(taskId, code + tail);
      assert.notEqual(verdict.verdict, 'passed', `${taskId}: code ending in ${JSON.stringify(tail.trim())} must not pass its type tests`);
      assert.equal(verdict.solutions, null, `${taskId}: no solutions released`);
    }
  }
  console.log('PASS integrity: the code cannot swallow its type tests');
}

// ── React suites compare values the way Jest does (CODE-12) ──────────────
// toEqual compared JSON text: key order failed correct answers, any two Maps
// or Sets were equal, and NaN equalled null.
{
  const jest = createMiniJest();
  const { test, expect } = jest.globals as unknown as {
    test: (name: string, body: () => void) => void;
    expect: (value: unknown) => Record<string, (...args: unknown[]) => void> & { not: Record<string, (...args: unknown[]) => void> };
  };
  class Point { constructor(public x: number) {} }
  const cyclic: { self?: unknown; n: number } = { n: 1 };
  cyclic.self = cyclic;
  const cyclicToo: { self?: unknown; n: number } = { n: 1 };
  cyclicToo.self = cyclicToo;
  const expectations: [string, () => void][] = [
    ['key order does not matter', () => expect([{ id: 7, type: 'toggled' }]).toEqual([{ type: 'toggled', id: 7 }])],
    ['different Maps differ', () => expect(new Map([['a', 1]])).not.toEqual(new Map())],
    ['Maps compare entries', () => expect(new Map<unknown, unknown>([['a', 1], [{ k: 1 }, [2]]])).toEqual(new Map<unknown, unknown>([[{ k: 1 }, [2]], ['a', 1]]))],
    ['different Sets differ', () => expect(new Set([1, 2])).not.toEqual(new Set([3]))],
    ['Sets compare members', () => expect(new Set([1, { a: 2 }])).toEqual(new Set([{ a: 2 }, 1]))],
    ['NaN is not null', () => expect([NaN]).not.toEqual([null])],
    ['NaN equals NaN', () => expect({ v: NaN }).toEqual({ v: NaN })],
    ['0 and -0 differ', () => expect(0).not.toEqual(-0)],
    ['Dates compare by time', () => expect(new Date(5)).toEqual(new Date(5))],
    ['different Dates differ', () => expect(new Date(5)).not.toEqual(new Date(6))],
    ['an undefined property is ignored', () => expect({ a: 1, b: undefined }).toEqual({ a: 1 })],
    ['but not by toStrictEqual', () => expect({ a: 1, b: undefined }).not.toStrictEqual({ a: 1 })],
    ['toStrictEqual checks the class', () => expect(new Point(1)).not.toStrictEqual({ x: 1 })],
    ['toEqual does not', () => expect(new Point(1)).toEqual({ x: 1 })],
    ['arrays keep their order', () => expect([1, 2]).not.toEqual([2, 1])],
    ['an array is not an object', () => expect([1]).not.toEqual({ 0: 1 })],
    ['cycles are followed', () => expect(cyclic).toEqual(cyclicToo)],
  ];
  for (const [name, body] of expectations) test(name, body);
  const run = await jest.run();
  assert.deepEqual(run.cases.filter((one) => one.status === 'fail').map((one) => `${one.name}: ${one.error}`), [], 'mini-jest equality follows Jest');

  // A correct answer that builds its action with the keys in another order.
  const dispatchTask = CODING_TASKS.find((task) => task.id === 'react-easy3-dispatch-through-context')!;
  const dispatchSolution = solutionFor(dispatchTask.id)!;
  const reordered = dispatchSolution.solution.replace("dispatch({ type: 'toggled', id: task.id })", "dispatch({ id: task.id, type: 'toggled' })");
  assert.notEqual(reordered, dispatchSolution.solution);
  const reorderedRun = await runReactSuite({ suite: withHiddenCases(dispatchTask.suite!, dispatchSolution.hiddenSuite), appSource: reordered });
  assert.equal(reorderedRun.failed, 0, `key order passes the suite: ${reorderedRun.cases.filter((one) => one.status === 'fail').map((one) => one.error).join('; ')}`);
  console.log('PASS integrity: React suites compare values the way Jest does');
}

// ── a form the page lets submit fails its case ───────────────────────────
// In the preview a submission the component does not cancel reloads the
// frame and loses what it showed, yet 48 React tasks passed without
// preventDefault(). The runner fails the case that submitted, whatever the
// checks read, and the browser harness applies the same rule.
{
  const { FORM_SUBMIT_NOT_PREVENTED } = await import('../shared/coding-react-support');
  const suite = `import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
test('adding shows the item', () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Tea' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getByRole('listitem').textContent).toBe('Tea');
});
test('a check that fails after a submit', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});
test('the box starts empty', () => {
  render(<App />);
  expect(screen.getByLabelText('Item').value).toBe('');
});`;
  const page = (handler: string) => `import React, { useState } from 'react';
export default function App() {
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  return <form onSubmit={(event) => { ${handler} setItems([...items, text]); }}>
    <label>Item <input value={text} onChange={(event) => setText(event.target.value)} /></label>
    <button>Add</button>
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
  </form>;
}`;
  // The middle case fails on its own check, which skips its afterEach hooks;
  // the watch it leaves open must not reach the case after it.
  const failed = 'expected length 1 to be 2';
  const errors = async (handler: string) => (await runReactSuite({ suite, appSource: page(handler) })).cases.map((one) => one.error);
  assert.deepEqual(await errors('event.preventDefault();'), [null, failed, null], 'a form that cancels its submit passes');
  assert.deepEqual(await errors(''), [FORM_SUBMIT_NOT_PREVENTED, failed, null], 'a form left to submit fails the case that submitted it');
  assert.deepEqual(await errors('event.stopPropagation();'), [FORM_SUBMIT_NOT_PREVENTED, failed, null], 'stopping the submit on its way up does not hide it');
  console.log('PASS integrity: a form the page lets submit fails its case');
}

// ── Run and Submit agree (CODE-10) ───────────────────────────────────────
// The browser's Run and the server's Submit have to reach the same verdict:
// both in strict mode, one clock however the code asks for the time, and a
// structuredClone that copies what the browser's copies.
{
  const checks = (id: string) => {
    const task = CODING_TASKS.find((one) => one.id === id)!;
    const all = [...task.tests!, ...(solutionFor(id)?.hiddenTests ?? [])];
    return { calls: all.map((one) => one.call), expectations: all.map((one) => one.expected), shown: task.tests!.length };
  };
  const agree = async (id: string, code: string) => {
    const { calls, expectations, shown } = checks(id);
    const run = await evaluateInRunRealm({ code, calls: calls.slice(0, shown), expectations: expectations.slice(0, shown) });
    const submit = await runInSandbox({ code, calls, expectations, shownCalls: shown });
    assert.deepEqual(submit.results.slice(0, shown).map((one) => one.pass), run.results.map((one) => one.pass), `${id}: Run and Submit disagree`);
    return { run, submit };
  };
  const sloppy = await agree('js-sum-array', 'function sum(numbers) {\n  total = 0;\n  for (const n of numbers) total += n;\n  return total;\n}');
  assert.ok(sloppy.run.results.every((one) => one.pass === false && /total/.test(one.error ?? '')), 'Run reports an undeclared assignment, as Submit does');
  const timed = await agree('js-throttle-calls', 'const throttle = (fn, ms) => { let last = -Infinity; return (...args) => { const now = new Date().getTime(); if (now - last >= ms) { last = now; fn(...args); } }; };');
  assert.ok(allPassed(timed.submit), `new Date() reads the same clock as the timers: ${JSON.stringify(timed.submit.results)}`);
  const capturedClock = await agree('js-throttle-calls', 'const readClock = Date.now; const throttle = (fn, ms) => { let last = -Infinity; return (...args) => { const now = readClock(); if (now - last >= ms) { last = now; fn(...args); } }; };');
  assert.ok(allPassed(capturedClock.submit), `A captured Date.now alias keeps the same clock: ${JSON.stringify(capturedClock.submit.results)}`);
  // Runtime capability is separate from the manual-copy exercise: that task
  // retains opaque functions/Symbols, which native structuredClone rejects.
  // Its per-task prohibition is checked by checkCodingTaskRuntimePolicy.
  const cloneCases = [
    { call: '(() => {const source={a:[1,{b:2}]},copy=structuredClone(source);copy.a[1].b=99;return [source.a[1].b,copy.a[1].b,copy!==source,copy.a!==source.a];})()', expected: [2, 99, true, true] },
    { call: '(() => {const source=[],copy=structuredClone(source);return [copy,copy!==source];})()', expected: [[], true] },
    { call: 'structuredClone(null)', expected: null },
    { call: 'structuredClone(undefined)', expected: undefined },
    { call: 'structuredClone([1,[2,[3]]])', expected: [1, [2, [3]]] },
    { call: '(() => {const copy=structuredClone([NaN,Infinity,-0,3n]);return [Number.isNaN(copy[0]),copy[1]===Infinity,Object.is(copy[2],-0),copy[3]===3n];})()', expected: [true, true, true, true] },
    { call: '(() => {try{structuredClone(Symbol("leaf"));return "cloned";}catch(error){return error.name;}})()', expected: 'DataCloneError' },
  ];
  const cloneInput = { code: '', calls: cloneCases.map(one => one.call), expectations: cloneCases.map(one => one.expected) };
  for (const cloned of [await evaluateInRunRealm(cloneInput), await runInSandbox(cloneInput)]) {
    assert.ok(allPassed(cloned), `unrestricted structuredClone semantics: ${JSON.stringify(cloned.results)}`);
  }
  const semantics = await runInSandbox({
    code: '',
    calls: [
      'Date.now() === new Date().getTime() && new Date() instanceof Date && new Date(0).getTime() === 0 && typeof Date() === "string"',
      '(() => { const start = Date.now(); return new Promise((done) => setTimeout(() => done(new Date().getTime() - start), 250)); })()',
      '(() => { const inner = { n: 1 }; const m = new Map([["k", inner]]); const c = structuredClone(m); return [c instanceof Map, c.get("k").n, c.get("k") !== inner]; })()',
      '(() => { const s = structuredClone(new Set([1, 2])); return [s instanceof Set, s.size]; })()',
      '(() => { const o = { d: new Date(5), r: /a/g, u: undefined, n: NaN }; o.self = o; const c = structuredClone(o); return [c.self === c, c.d instanceof Date, c.d.getTime(), c.r.flags, "u" in c, Number.isNaN(c.n)]; })()',
      '(() => { try { structuredClone({ f() {} }); return "cloned"; } catch (error) { return error.name; } })()',
    ],
    expectations: [true, 250, [true, 1, true], [true, 2], [true, true, 5, 'g', true, true], 'DataCloneError'],
  });
  assert.deepEqual(semantics.results.map((one) => one.pass), [true, true, true, true, true, true], JSON.stringify(semantics.results));
  await checkStructuredCloneOwnKeys();
  console.log('PASS integrity: Run and Submit agree on strict mode, the clock and structuredClone');
}

// ── Run and Submit read UTC (owner decision of 9 October 2026, afternoon; C1-2) ──
// Submit graded in QuickJS, whose local time followed the server's zone, and
// Run in the learner's zone, so code that read local hours could pass on one
// and fail on the other. The morning's decision gave both Europe/Prague; the
// afternoon's replaced it with UTC: learner code reads UTC in both, with no
// summer time, whatever the host's or the browser's zone.
{
  /** [year, month, date, hours, minutes, seconds, day, offset] in UTC. */
  const utc = (t: number) => {
    const d = new Date(t);
    return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCDay(), 0];
  };
  // The clock changes of the zones the hosts below are in, a millisecond
  // either side (Europe/Prague's in March and October, Los Angeles's, and
  // Lord Howe's half-hour ones), and a winter and a summer noon. In UTC none
  // of them moves a local field.
  const instants = [
    '2026-03-29T00:59:59.999Z', '2026-03-29T01:00:00.000Z', '2026-10-25T00:59:59.999Z', '2026-10-25T01:00:00.000Z',
    '2026-03-08T09:59:59.999Z', '2026-03-08T10:00:00.000Z', '2026-11-01T08:59:59.999Z', '2026-11-01T09:00:00.000Z',
    '2026-04-04T14:59:59.999Z', '2026-04-04T15:00:00.000Z', '2026-10-03T15:29:59.999Z', '2026-10-03T15:30:00.000Z',
    '2026-01-15T11:00:00.000Z', '2026-07-15T10:00:00.000Z',
  ].map((text) => Date.parse(text));
  const fieldCalls = instants.map((t) => `(() => { const d = new Date(${t}); return [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getDay(), d.getTimezoneOffset()]; })()`);
  const known: [string, unknown][] = [
    // A wall-clock time is the UTC time of the same name, even in the hours
    // a clock change skips or repeats elsewhere.
    ['new Date(2026, 2, 29, 2, 30).toISOString()', '2026-03-29T02:30:00.000Z'],
    ['new Date(2026, 9, 25, 2, 30).toISOString()', '2026-10-25T02:30:00.000Z'],
    ['new Date(2026, 3, 5, 1, 45).toISOString()', '2026-04-05T01:45:00.000Z'],
    ['new Date("2026-07-01T12:00").toISOString()', '2026-07-01T12:00:00.000Z'],
    ['Date.parse("2026-10-25T02:30")', Date.parse('2026-10-25T02:30:00Z')],
    ['new Date("2026-01-01").toISOString()', '2026-01-01T00:00:00.000Z'],
    ['Date.parse("March 7, 2026 10:00")', Date.parse('2026-03-07T10:00:00Z')],
    ['(() => { const d = new Date(2026, 2, 28, 12); d.setDate(d.getDate() + 1); return d.toISOString(); })()', '2026-03-29T12:00:00.000Z'],
    ['(() => { const d = new Date(2026, 9, 24, 12); d.setHours(d.getHours() + 24); return d.toISOString(); })()', '2026-10-25T12:00:00.000Z'],
    ['Array.from({ length: 12 }, (_, month) => new Date(2026, month, 15).getTimezoneOffset())', Array.from({ length: 12 }, () => 0)],
    ['new Date(Date.UTC(2026, 2, 29, 1, 30)).toString()', 'Sun Mar 29 2026 01:30:00 GMT+0000 (Coordinated Universal Time)'],
    ['new Date(0).toTimeString()', '00:00:00 GMT+0000 (Coordinated Universal Time)'],
    ['String(new Date(Date.UTC(2026, 9, 25, 1, 30)))', 'Sun Oct 25 2026 01:30:00 GMT+0000 (Coordinated Universal Time)'],
    ['new Date(Date.UTC(2026, 9, 25, 0, 30)).toLocaleString("en-US")', '10/25/2026, 12:30:00 AM'],
    ['new Date(Date.UTC(2026, 9, 25, 1, 30)).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })', '01:30 AM UTC'],
    ['new Date(Date.UTC(2026, 9, 25, 23, 30)).toLocaleDateString("en-US", { dateStyle: "full" })', 'Sunday, October 25, 2026'],
    // A zone the code names is read as before: UTC, Europe/Prague with its
    // summer time, and any other refused with a message that says so.
    ['new Date(Date.UTC(2026, 0, 1, 23, 30)).toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "long" })', 'January 1, 2026'],
    ['new Date(Date.UTC(2026, 9, 25, 0, 30)).toLocaleString("en-US", { timeZone: "Europe/Prague", timeZoneName: "short" })', '10/25/2026, 2:30:00 AM GMT+2'],
    ['new Date(Date.UTC(2026, 9, 25, 1, 30)).toLocaleString("en-US", { timeZone: "Europe/Prague", timeZoneName: "short" })', '10/25/2026, 2:30:00 AM GMT+1'],
    ['(() => { try { return new Date(0).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }); } catch (error) { return [error.name, error.message]; } })()', ['RangeError', 'Only the Europe/Prague and UTC time zones are available in the checker, not Asia/Tokyo.']],
  ];
  const calls = [...fieldCalls, ...known.map(([call]) => call)];
  const expectations = [...instants.map(utc), ...known.map(([, value]) => value)];
  const failing = (result: { results: { pass: boolean | null; actual: string | null; error: string | null }[] }) =>
    result.results.flatMap((one, index) => (one.pass ? [] : [`${calls[index]} -> ${one.actual ?? one.error}, expected ${JSON.stringify(expectations[index])}`]));
  assert.deepEqual(failing(await runInSandbox({ code: '', calls, expectations })), [], 'Submit reads UTC');
  assert.deepEqual(failing(await evaluateInRunRealm({ code: '', calls, expectations })), [], 'Run reads UTC');
  // The host's own zone changes nothing. QuickJS takes its local time from
  // the process, and Run from the learner's browser.
  const hostZone = process.env.TZ;
  try {
    // Each zone with the host's own offsets in January and July, so the
    // switch is known to have reached the process.
    for (const [zone, offsets] of [['UTC', [0, 0]], ['America/Los_Angeles', [480, 420]], ['Asia/Tokyo', [-540, -540]], ['Australia/Lord_Howe', [-660, -630]]] as const) {
      process.env.TZ = zone;
      assert.deepEqual([new Date(2026, 0, 15).getTimezoneOffset(), new Date(2026, 6, 15).getTimezoneOffset()], offsets, `the host is in ${zone}`);
      const submit = await runInQuickJS({ code: '', calls, expectations });
      const run = await evaluateInRunRealm({ code: '', calls, expectations });
      assert.deepEqual(failing(submit), [], `Submit on a host in ${zone}`);
      assert.deepEqual(failing(run), [], `Run in a browser in ${zone}`);
      assert.deepEqual(run.results.map((one) => one.actual), submit.results.map((one) => one.actual), `Run and Submit print the same in ${zone}`);
    }
  } finally {
    if (hostZone === undefined) delete process.env.TZ;
    else process.env.TZ = hostZone;
  }

  // C1-2's two tasks. In UTC, counting local days and stepping local days
  // are right, so they pass on Submit and on Run alike, while the bug each
  // task is about still fails both the same way.
  const ordersTask = CODING_TASKS.find((task) => task.tests?.some((one) => one.call.startsWith('ordersPerDay(')))!;
  const ordersHidden = solutionFor(ordersTask.id)!.hiddenTests ?? [];
  const ordersVersion = (body: string) => solutionFor(ordersTask.id)!.solution.replace(/function ordersPerDay[\s\S]*?\n}\n?/, `${body}\n`);
  const localDays = ordersVersion(`const pad = (n) => String(n).padStart(2, "0");
function ordersPerDay(timestamps) {
  const counts = {};
  for (const stamp of timestamps) {
    const at = new Date(stamp);
    const day = String(at.getFullYear()).padStart(4, "0") + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate());
    counts[day] = (counts[day] ?? 0) + 1;
  }
  return counts;
}`);
  const textDays = ordersVersion(`function ordersPerDay(timestamps) {
  const counts = {};
  for (const stamp of timestamps) counts[stamp.slice(0, 10)] = (counts[stamp.slice(0, 10)] ?? 0) + 1;
  return counts;
}`);
  for (const [name, code, passes] of [['local getters', localDays, true], ['the text before the T', textDays, false]] as const) {
    assert.notEqual(code, solutionFor(ordersTask.id)!.solution, `${name}: the version replaced the reference`);
    const submit = await runChecks({ code, visible: ordersTask.tests!, hidden: ordersHidden, shuffle: (list) => list });
    const run = await evaluateInRunRealm({ code, calls: ordersTask.tests!.map((one) => one.call), expectations: ordersTask.tests!.map((one) => one.expected) });
    assert.equal(allPassed(submit.visible) && allPassed(submit.hidden!), passes, `${ordersTask.id} counted with ${name} ${passes ? 'passes' : 'fails'} Submit`);
    assert.deepEqual(run.results.map((one) => one.pass), submit.visible.results.map((one) => one.pass), `${ordersTask.id} counted with ${name}: Run agrees`);
  }
  const fill = CODING_TASKS.find((task) => task.id === 'ts-mh-fill-missing-days')!;
  const fillHidden = solutionFor(fill.id)!.hiddenTests!;
  const stepWith = (step: string) => `type Reading = [date: string, value: number];
const fillDays = (readings: readonly Reading[]): Reading[] => {
  const totals = new Map<string, number>();
  for (const [date, value] of readings) totals.set(date, (totals.get(date) ?? 0) + value);
  const days = [...totals.keys()].sort();
  if (days.length === 0) return [];
  const filled: Reading[] = [];
  const day = new Date(days[0] + "T00:00:00Z");
  const last = days[days.length - 1];
  let text = days[0];
  while (text <= last) {
    filled.push([text, totals.get(text) ?? 0]);
    ${step}
    text = day.toISOString().slice(0, 10);
  }
  return filled;
};`;
  for (const step of ['day.setDate(day.getDate() + 1);', 'day.setUTCDate(day.getUTCDate() + 1);', 'day.setHours(day.getHours() + 24);']) {
    const js = nodeTypeScriptChecker().toJavaScript(stepWith(step));
    const graded = await runChecks({ code: js, visible: fill.tests!, hidden: fillHidden, shuffle: (list) => list });
    const ran = await evaluateInRunRealm({ code: js, calls: fillHidden.map((one) => one.call), expectations: fillHidden.map((one) => one.expected) });
    assert.ok(allPassed(graded.visible) && allPassed(graded.hidden!), `fillDays stepping with ${step} passes every check: ${JSON.stringify(graded.hidden)}`);
    assert.deepEqual(ran.results.map((one) => one.pass), graded.hidden!.results.map((one) => one.pass), `fillDays stepping with ${step}: Run agrees on the hidden inputs`);
  }
  console.log('PASS integrity: Run and Submit read UTC, with no clock change, on any host');

  // React: the page realm the guest grades in reads UTC too, and its Intl
  // formats in UTC unless the code names a zone, whatever the host's zone.
  const zoneBefore = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Lord_Howe']) {
      process.env.TZ = zone;
      const react = await runReactSuite({ suite: UTC_REACT_SUITE, appSource: UTC_REACT_APP });
      assert.ok(react.compileError === null && react.failed === 0 && react.passed === 2, `${zone}: ${JSON.stringify(react.cases)}`);
    }
  } finally {
    if (zoneBefore === undefined) delete process.env.TZ;
    else process.env.TZ = zoneBefore;
  }
  console.log('PASS integrity: the React page realm reads UTC on any host');
}

// ── the grader has the browser's URL, encoders and base64 (owner decision 2, C1-3) ──
// Each built-in the grader adds, evaluated by the grader and by Node's own
// implementation of the same standard, on the inputs learners use.
{
  const builtIns: Record<string, string[]> = {
    URL: [
      'new URL("https://user:pw@example.com:8080/p/../a b?q=1 2#h é").href',
      'new URL("/path?x=1", "https://example.com/base/").href',
      'new URL("../up", "https://example.com/a/b/c").pathname',
      'new URL("HTTP://EXAMPLE.COM:80/").href',
      'new URL("https://example.com").origin',
      'new URL("https://例え.jp/").hostname',
      'new URL("http://[::1]:3000/x").host',
      'new URL("http://0x7f.1/").hostname',
      'new URL("mailto:someone@example.com").pathname',
      'new URL("file:///C:/x/../y").href',
      '(() => { const u = new URL("https://x.dev/p"); u.searchParams.set("q", "a&b=c"); u.hash = "top"; u.port = "8443"; u.pathname = "/a b"; return [u.href, u.search, u.host]; })()',
      '(() => { const u = new URL("https://x.dev/?a=1"); u.search = "?b=2"; return [u.searchParams.get("a"), u.searchParams.get("b"), u.href]; })()',
      '(() => { const u = new URL("https://a.b/?x=1"); u.searchParams.delete("x"); return u.href; })()',
      '(() => { const u = new URL("https://a.b/"); u.port = "nope"; u.protocol = "ftp"; return u.href; })()',
      '(() => { const u = new URL("https://a.b/"); u.href = "http://c.d/e?f#g"; return [u.host, u.searchParams.toString(), u.hash]; })()',
      '[URL.canParse("not a url"), URL.canParse("/x", "https://a.b"), URL.parse("nope"), URL.parse("/y", "https://a.b").href]',
      '(() => { try { new URL("not a url"); return "parsed"; } catch (error) { return error.name; } })()',
      'JSON.stringify({ u: new URL("https://a.b/c") }) + String(new URL("https://a.b/c d"))',
    ],
    URLSearchParams: [
      'new URLSearchParams("?a=1&b=2&a=3").getAll("a")',
      'new URLSearchParams({ q: "x y", n: 1 }).toString()',
      'new URLSearchParams([["a", "1"], ["b", "2"]]).toString()',
      'new URLSearchParams("a=%20&b=%zz&c=+&d=%E2%9C%93&e=%F0%9F%90%9F").toString()',
      '[[...new URLSearchParams("a=1&b=2").keys()], [...new URLSearchParams("a=1&b=2").values()], [...new URLSearchParams("a=1&b=2")]]',
      '(() => { const p = new URLSearchParams("c=3&a=1&b=2&a=0"); p.sort(); return p.toString(); })()',
      '(() => { const p = new URLSearchParams("a=1&a=2&b=3"); p.set("a", "9"); p.append("z", "é ✓"); p.delete("b"); return [p.toString(), p.size, p.has("a", "9"), p.has("a", "1")]; })()',
      'Object.fromEntries(new URLSearchParams("x=1&y=&z&w=a=b"))',
      'new URLSearchParams("&&a=1&&").toString() + "|" + new URLSearchParams("q=\\ud800").toString()',
      '(() => { const out = []; new URLSearchParams("a=1&b=2").forEach((value, key) => out.push(key + value)); return out; })()',
      '[Object.prototype.toString.call(new URLSearchParams()), Object.prototype.toString.call(new URLSearchParams().entries()), new URLSearchParams("a=1").get("b")]',
      '(() => { try { new URLSearchParams([["a"]]); return "built"; } catch (error) { return error.name; } })()',
    ],
    TextEncoder: [
      '[...new TextEncoder().encode("héllo ✓ 🐟")]',
      '[...new TextEncoder().encode("\\ud800x")]',
      '[new TextEncoder().encoding, new TextEncoder().encode().length]',
      '(() => { const out = new Uint8Array(5); const r = new TextEncoder().encodeInto("a✓🐟", out); return [r.read, r.written, [...out]]; })()',
    ],
    TextDecoder: [
      'new TextDecoder().decode(new Uint8Array([104, 195, 169, 0xE2, 0x9C, 0x93]))',
      'new TextDecoder().decode(new Uint8Array([0xEF, 0xBB, 0xBF, 65])).length',
      'new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xEF, 0xBB, 0xBF, 65])).length',
      '[...new TextDecoder().decode(new Uint8Array([0xC3, 0x28, 0xF0, 0x9F, 0x90, 0xA0, 0xFF, 0xE2, 0x82, 0xED, 0xA0, 0x80, 0xF0, 0x80]))].map((c) => c.codePointAt(0))',
      '(() => { try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xFF])); return "decoded"; } catch (error) { return error.name; } })()',
      '(() => { const d = new TextDecoder(); let s = ""; for (const b of new TextEncoder().encode("a✓🐟b")) s += d.decode(new Uint8Array([b]), { stream: true }); return s + d.decode(); })()',
      '[new TextDecoder().decode(new Uint8Array([97, 98]).buffer), new TextDecoder().decode(new DataView(new Uint8Array([99]).buffer)), new TextDecoder().decode(), new TextDecoder("UTF8").encoding]',
    ],
    atob: [
      'atob("aGVsbG8gd29ybGQ=")', 'atob(" aG k= ")', 'atob("YQ")', 'atob("")',
      '[...atob("AP+A")].map((c) => c.charCodeAt(0))',
      '["abc*", "YQ=", "Y", "a=b="].map((text) => { try { return atob(text); } catch (error) { return error.name; } })',
    ],
    btoa: [
      'btoa("hello world")', 'btoa("")', 'btoa(12345)', 'btoa(String.fromCharCode(0, 255, 128))',
      '(() => { try { return btoa("✓"); } catch (error) { return error.name; } })()',
    ],
  };
  for (const [name, calls] of Object.entries(builtIns)) {
    const grader = await runInSandbox({ code: '', calls, expectations: null });
    const node = await evaluateCalls({ code: '', calls, expectations: null });
    assert.equal(grader.codeError, null, `${name}: ${grader.codeError}`);
    calls.forEach((call, index) => {
      const mine = grader.results[index], theirs = node.results[index];
      assert.equal(mine.error, null, `${name}: ${call} threw ${mine.error}`);
      assert.equal(mine.actual, theirs.actual, `${name}: ${call}`);
    });
    console.log(`PASS integrity: the grader's ${name} behaves as the browser's (${calls.length} cases)`);
  }

  // C1-3: reading a query with URLSearchParams passed Run and failed Submit.
  const query = CODING_TASKS.find((task) => task.id === 'js-easy3-read-query')!;
  // The task now preserves raw text, while the string constructor decodes
  // form syntax. Its iterable constructor exercises the same browser API
  // without changing the task's literal key/value contract.
  const viaParams = `const parseQuery = query => Object.fromEntries(new URLSearchParams(
    query.split('&').filter(pair => pair !== '').map(pair => {
      const index = pair.indexOf('=');
      return index < 0 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)];
    })
  ));`;
  const querySubmit = await runChecks({ code: viaParams, visible: query.tests!, hidden: solutionFor(query.id)!.hiddenTests ?? [], shuffle: (list) => list });
  const queryRun = await evaluateInRunRealm({ code: viaParams, calls: query.tests!.map((one) => one.call), expectations: query.tests!.map((one) => one.expected) });
  assert.ok(allPassed(querySubmit.visible) && (!querySubmit.hidden || allPassed(querySubmit.hidden)), `URLSearchParams passes Submit: ${JSON.stringify(querySubmit)}`);
  assert.ok(allPassed(queryRun), 'and Run');

  // The host's URL parser is no global, answers strings only, and a URL is
  // the VM's own object. A huge URL is refused before the host sees it, and
  // a loop of URLs stops at the deadline like any other.
  const host = await runInSandbox({
    code: '',
    calls: [
      'Object.getOwnPropertyNames(globalThis).filter((name) => /host|devshark/i.test(name))',
      '[typeof __devsharkHostURL, typeof hostURL]',
      '(() => { const u = new URL("https://a.b/?q=1"); return [Object.getPrototypeOf(u) === URL.prototype, Object.getPrototypeOf(u.searchParams) === URLSearchParams.prototype, Object.getOwnPropertyNames(u).length, u.constructor.constructor("return typeof process")()]; })()',
      '(() => { try { new URL("https://a.b/" + "x".repeat(70000)); return "parsed"; } catch (error) { return error.name + ": " + /longer than the checker reads/.test(error.message); } })()',
      '(() => { let seen = ""; new URL({ toString() { seen += "once"; return "https://a.b/"; } }); return seen; })()',
    ],
    expectations: [[], ['undefined', 'undefined'], [true, true, 0, 'undefined'], 'TypeError: true', 'once'],
  });
  assert.deepEqual(host.results.map((one) => one.pass), [true, true, true, true, true], JSON.stringify(host.results));
  const loop = await runInSandbox({ code: 'const f = () => { for (;;) new URL("https://a.b/?" + Math.random()); };', calls: ['f()'], expectations: [1], deadlineMs: 400 });
  assert.equal(loop.timedOut, true, 'a URL loop stops at the deadline');
  console.log('PASS integrity: the host URL parser gives the VM strings only and keeps the limits');
}

// ── Run hides what the grader lacks, and both format alike (owner decision 2) ──
{
  // The grader's realm is what shared/coding-checker-globals.ts lists, which
  // is what the Run worker keeps.
  const listing = await runInSandbox({
    code: '',
    calls: [`(() => {
      void Date; void URL; (1).toLocaleString();
      const own = (o) => Object.getOwnPropertyNames(o).sort().join(' ');
      const members = {};
      for (const name of Object.getOwnPropertyNames(globalThis)) {
        if (name === 'globalThis' || name === 'console') continue;
        const value = globalThis[name];
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) continue;
        members[name] = own(value);
        if (typeof value === 'function' && value.prototype && typeof value.prototype === 'object') members[name + '.prototype'] = own(value.prototype);
      }
      const typed = Object.getPrototypeOf(Uint8Array);
      members['%TypedArray%'] = own(typed);
      members['%TypedArray%.prototype'] = own(typed.prototype);
      return [Object.getOwnPropertyNames(globalThis).sort(), members];
    })()`],
    expectations: null,
  });
  const [globals, members] = JSON.parse(listing.results[0].actual!) as [string[], Record<string, string>];
  assert.deepEqual(globals, [...CHECKER_GLOBALS].sort(), 'CHECKER_GLOBALS lists the grader\'s globals');
  assert.deepEqual(members, CHECKER_MEMBERS, 'CHECKER_MEMBERS lists the grader\'s built-in members');
  // Using what the grader lacks fails on Run too, and says why.
  const missing = ['Intl.NumberFormat', 'crypto.randomUUID()', 'fetch("/x")', 'new BroadcastChannel("x")', 'Array.fromAsync([1])'];
  const lacking = await evaluateInRunRealm({ code: '', calls: missing, expectations: null });
  const lackingSubmit = await runInSandbox({ code: '', calls: missing, expectations: null });
  assert.deepEqual(lacking.results.map((one) => one.error), [hiddenGlobalMessage('Intl'), hiddenGlobalMessage('crypto'), hiddenGlobalMessage('fetch'), hiddenGlobalMessage('BroadcastChannel'), lacking.results[4].error], JSON.stringify(lacking.results));
  assert.ok(lacking.results.every((one) => one.pass === false) && lackingSubmit.results.every((one) => one.pass === false), 'each fails on Run and on Submit');
  const probe = await evaluateInRunRealm({ code: '', calls: ['[typeof Intl, typeof crypto, typeof structuredClone, typeof queueMicrotask, typeof URL, typeof atob, Object.keys(performance).join()]'], expectations: null });
  const probeSubmit = await runInSandbox({ code: '', calls: ['[typeof Intl, typeof crypto, typeof structuredClone, typeof queueMicrotask, typeof URL, typeof atob, Object.keys(performance).join()]'], expectations: null });
  assert.equal(probe.results[0].actual, probeSubmit.results[0].actual, 'feature checks read the same in Run and Submit');
  // The locale-sensitive methods print and sort the same in both.
  const locale = [
    '(1234567.891).toLocaleString()', '(1234.5).toLocaleString("en-US", { style: "currency", currency: "USD" })', '(0.256).toLocaleString("en-US", { style: "percent" })',
    '(1234).toLocaleString("en-US", { notation: "compact" })', '(1234567n).toLocaleString()', '[1234.5, 0.5].toLocaleString()',
    '["b", "A", "a", "B", "á", "_x", "10", "9"].sort((x, y) => x.localeCompare(y))', '["item10", "item2"].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))',
    '"a".localeCompare("A", undefined, { sensitivity: "base" })', 'new Date(Date.UTC(2026, 0, 15, 8, 5)).toLocaleString()',
    '(() => { try { return (1).toLocaleString("en-US", { style: "unit", unit: "meter" }); } catch (error) { return error.name; } })()',
  ];
  const localeRun = await evaluateInRunRealm({ code: '', calls: locale, expectations: null });
  const localeSubmit = await runInSandbox({ code: '', calls: locale, expectations: null });
  const localeNode = await evaluateCalls({ code: '', calls: locale.slice(0, 9), expectations: null });
  assert.deepEqual(localeRun.results.map((one) => one.actual ?? one.error), localeSubmit.results.map((one) => one.actual ?? one.error), 'Run and Submit format and sort alike');
  assert.deepEqual(localeSubmit.results.slice(0, 9).map((one) => one.actual), localeNode.results.map((one) => one.actual), 'as an en-US browser does');
  console.log('PASS integrity: Run lacks what the grader lacks, says so, and formats as the grader does');
}

// ── each engine reaches the host functions listed here, and no others (F11-04) ──
// CHECKER_GLOBALS pins the names learner code sees, not what stands behind
// them. A host function can wait in a prelude's closure, as the URL parser
// does, and a rebuilt wasm can import more of the host than this one. So this
// block records every function and host reference the host hands a QuickJS
// context during one grader run and one React run, pins the vendored
// module's imports and exports next to its provenance hash, and checks that
// learner code loads no module in either engine. A new binding fails here
// until it is listed.
{
  const contexts = QuickJSContext.prototype;
  const runtimes = QuickJSRuntime.prototype;
  const { newFunctionWithOptions, newHostRef } = contexts;
  const { setModuleLoader } = runtimes;
  const handed: string[] = [];
  // newFunction and newConstructorFunction both go through newFunctionWithOptions.
  contexts.newFunctionWithOptions = function (this: QuickJSContext, args) {
    handed.push(`function ${args.name ?? ''}`);
    return newFunctionWithOptions.call(this, args);
  };
  contexts.newHostRef = function (this: QuickJSContext, value: object) {
    handed.push('host reference');
    return newHostRef.call(this, value);
  } as typeof newHostRef;
  runtimes.setModuleLoader = function (this: QuickJSRuntime, ...args: Parameters<typeof setModuleLoader>) {
    handed.push('module loader');
    return setModuleLoader.apply(this, args);
  };
  const load = 'const load = (name) => import(name).then(() => "loaded", (error) => String(error && error.message));';
  try {
    // In this thread, so the wrappers above see the run.
    const graded = await runInQuickJS({
      code: `${load}\nconst search = (text) => new URL(text).search;`,
      calls: ['search("https://a.b/?q=1")', 'Promise.all(["node:fs", "std", "os"].map(load))'],
      expectations: ['?q=1', ["could not load module 'node:fs'", "could not load module 'std'", "could not load module 'os'"]],
    });
    assert.deepEqual(graded.results.map((one) => one.pass), [true, true], JSON.stringify(graded));
    assert.deepEqual(handed.splice(0), ['function url'], 'a grader run hands QuickJS one host function, the URL parser, and no module loader');
    const react = await runReactSuite({
      suite: `import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import App, { load } from './App';
test('renders and updates', () => { const { container } = render(<App />); fireEvent.click(container.querySelector('button')); expect(container.textContent).toBe('1'); });
test('loads no module', async () => { expect(await Promise.all(['node:fs', 'fs', 'std', 'os', 'react'].map(load))).toEqual(["Cannot find module 'node:fs'", "Cannot find module 'fs'", "Cannot find module 'std'", "Cannot find module 'os'", 'loaded']); });`,
      appSource: `import React, { useState } from 'react';
export ${load}
export default function App() { const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{count}</button>; }`,
    });
    assert.deepEqual(react.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(react));
    assert.deepEqual(handed.splice(0), ['function capability', 'function schedule', 'function report'], 'a React run hands the learner engine three host functions and no module loader');
    // A static import resolves through the same fixed list.
    const fixed = await runReactSuite({
      suite: `import App from './App';\ntest('renders', () => { expect(typeof App).toBe('function'); });`,
      appSource: `import { readFileSync } from 'node:fs';\nexport const read = readFileSync;\nexport default function App() { return null; }`,
    });
    assert.equal(fixed.compileError, "compiling App: Cannot find module 'node:fs'", JSON.stringify(fixed));
    handed.splice(0);
  } finally {
    contexts.newFunctionWithOptions = newFunctionWithOptions;
    contexts.newHostRef = newHostRef;
    runtimes.setModuleLoader = setModuleLoader;
  }

  // The wasm both engines load (quickjs-variant.ts), checked against its
  // provenance. Its imports are all it can call in the host. Emscripten
  // minified their names: a.s calls a host function, a.i asks the interrupt
  // handler, a.h and a.g load and resolve a module (no loader is set, so they
  // refuse), a.t frees a host reference, and the other fifteen are the C
  // library's: assert and abort, the clock, the time zone and a timer, heap
  // growth, environment strings, stdout and file stubs, keep-alive and exit.
  // A rebuild that imports anything more fails here.
  const wasm = Buffer.from(vendoredQuickJS, 'base64');
  const provenance = JSON.parse(readFileSync(join(process.cwd(), 'lib/coding/vendor/provenance.json'), 'utf8')) as { artifact: { wasmSha256: string } };
  assert.equal(createHash('sha256').update(wasm).digest('hex'), provenance.artifact.wasmSha256, 'the engines load the wasm the provenance names');
  const compiled = new WebAssembly.Module(wasm);
  assert.deepEqual(
    WebAssembly.Module.imports(compiled).map(({ module, name, kind }) => `${module}.${name} ${kind}`),
    [...'bcdefghijklmnopqrst'].map((name) => `a.${name} function`).concat('a.a memory'),
    'the wasm imports nineteen host functions and its memory',
  );
  const exported = WebAssembly.Module.exports(compiled);
  assert.ok(exported.every(({ kind }) => kind === 'function'), 'the wasm exports functions only');
  assert.deepEqual(
    exported.map(({ name }) => name),
    'u v w x y z A B C D E F G H I J K L M N O P Q R S T U V W X Y Z _ $ aa ba ca da ea fa ga ha ia ja ka la ma na oa pa qa ra sa ta ua va wa xa ya za Aa Ba Ca Da Ea Fa Ga Ha Ia Ja Ka La Ma Na Oa'.split(' '),
    'the wasm exports 75 functions',
  );
  console.log('PASS integrity: QuickJS gets one host function in the grader and three in the React engine, no module loader, and the wasm imports 20 names and exports 75');
}

// ── prototype pollution stays inside the run that made it (F11-06) ───────
// The attacks above replace globals and Array.prototype.toJSON. Here learner
// code changes Object.prototype, Array.prototype, Function.prototype and the
// globals the controller could lean on. The controller took its intrinsics
// before the learner's code ran, so the run's own values still read right;
// every run gets a fresh QuickJS runtime (runInQuickJS), so neither the
// hidden run nor the next run on the thread sees the change, and the host
// realm that decodes the results never does.
{
  const source = `const pollute = () => {
  Object.prototype.x = 1; Object.prototype.toString = () => 'pwn'; Object.prototype.toJSON = () => 'pwn';
  Array.prototype.push = () => 0; Array.prototype[0] = 'p0';
  Function.prototype.constructor = null; Object.prototype.constructor = null;
  globalThis.JSON = null; globalThis.Object = null; globalThis.Array = null; globalThis.String = null;
  return { kept: [1, 2], text: 'a' };
};
const kept = () => ({ kept: [1, 2], text: 'a' });
const clean = () => [({}).x, [].push(1), [, 2][0], typeof Function.prototype.constructor, JSON.stringify({ a: [1] }), String([1, 2])];
const owned = () => JSON.parse('{"__proto__":{"x":1},"a":2}');`;
  const unchanged = [undefined, 1, undefined, 'function', '{"a":[1]}', '1,2'];
  const checks = await runChecks({
    code: source,
    // The calls run in order before any result is encoded, so each result
    // is encoded after pollute() has run, and a wrong one still fails.
    visible: [{ call: 'pollute()', expected: { kept: [1, 2], text: 'a' } }, { call: 'kept()', expected: { kept: [1, 2], text: 'b' } }, { call: 'clean()', expected: unchanged }],
    hidden: [{ call: 'clean()', expected: unchanged }, { call: '({}).hasOwnProperty("x")', expected: false }],
    shuffle: (list) => list,
  });
  assert.equal(checks.visible.codeError, null, JSON.stringify(checks.visible));
  assert.deepEqual(checks.visible.results.map((one) => one.pass), [true, false, false], `the run's own values still compare right: ${JSON.stringify(checks.visible.results)}`);
  assert.deepEqual(checks.visible.results.slice(0, 2).map((one) => one.actual), ['{"kept":[1,2],"text":"a"}', '{"kept":[1,2],"text":"a"}'], 'and display right');
  assert.ok(checks.visible.results[2].error, 'the run that polluted its realm sees the change itself');
  assert.deepEqual(checks.hidden?.results.map((one) => one.pass), [true, true], `the hidden run starts clean: ${JSON.stringify(checks.hidden)}`);
  const next = await runInSandbox({ code: source, calls: ['clean()'], expectations: [unchanged] });
  assert.equal(next.results[0]?.pass, true, `the next run on the thread starts clean: ${JSON.stringify(next)}`);
  // In this thread: the host realm that decodes the results keeps its
  // prototypes, and an own __proto__ key in a result is data.
  const hostPush = Array.prototype.push;
  // owned() runs before pollute() replaces JSON, and both results are
  // encoded after it.
  const inThread = await runInQuickJS({
    code: source,
    calls: ['owned()', 'owned()', 'pollute()'],
    expectations: [JSON.parse('{"__proto__":{"x":1},"a":2}'), { a: 2 }, { kept: [1, 2], text: 'a' }],
  });
  assert.deepEqual(inThread.results.map((one) => one.pass), [true, false, true], JSON.stringify(inThread));
  assert.equal(inThread.results[0].actual, '{"__proto__":{"x":1},"a":2}', 'an own __proto__ key is compared and shown as a key');
  assert.ok(!Object.hasOwn(Object.prototype, 'x') && ({} as { x?: unknown }).x === undefined, 'the host Object.prototype has no x');
  assert.equal(Array.prototype.push, hostPush, 'the host Array.prototype.push is untouched');
  assert.equal(JSON.stringify({ a: [1] }), '{"a":[1]}', 'the host JSON and toJSON are untouched');

  // The React learner engine freezes its own prototypes and refuses
  // constructor lookups; the page realm the suite runs in, the realm that
  // writes the verdict, and the next run see none of it.
  const pollutedSuite = `import React from 'react';
import { render } from '@testing-library/react';
import App, { tried } from './App';
test('the page realm is untouched', () => { const { container } = render(<App />); expect(container.textContent).toBe('undefined 1'); expect(({}).x).toBe(undefined); expect([].push(1)).toBe(1); expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('x'); });
test('every attempt was refused', () => { expect(tried()).toEqual(${JSON.stringify(Array(8).fill('TypeError').join(' '))}); });`;
  const polluted = await runReactSuite({
    suite: pollutedSuite,
    appSource: `import React from 'react';
const refused = [];
const attempt = (run) => { try { run(); refused.push('changed'); } catch (error) { refused.push(error.name); } };
attempt(() => { Object.prototype.x = 1; });
attempt(() => { Object.prototype.toJSON = () => 'pwn'; });
attempt(() => { Array.prototype.push = () => 0; });
attempt(() => { Array.prototype[0] = 'p0'; });
attempt(() => ({}).constructor.constructor('return this')());
attempt(() => [].constructor.constructor('return this')());
attempt(() => { Object.getPrototypeOf(document.body).x = 1; });
attempt(() => { document.body.constructor.prototype.x = 1; });
export const tried = () => refused.join(' ');
export default function App() { return <p>{String(({}).x) + ' ' + [].push(1)}</p>; }`,
  });
  assert.equal(polluted.compileError, null, JSON.stringify(polluted));
  assert.deepEqual(polluted.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(polluted));
  const nonce = 'b'.repeat(48);
  const reported = readGuestResult(guestResultLine(nonce, serializeGuestResult(polluted)), nonce, pollutedSuite);
  assert.equal(reported.passed, 2, 'the guest reporter reads the run as it ran');
  assert.ok(!Object.hasOwn(Object.prototype, 'x') && Array.prototype.push === hostPush, 'the host realm is untouched after a React run');
  const reference = CODING_TASKS.find((task) => task.id === 'react-easy2-disclosure')!;
  const after = await runReactSuite({ suite: withHiddenCases(reference.suite!, solutionFor(reference.id)!.hiddenSuite), appSource: solutionFor(reference.id)!.solution });
  assert.ok(after.compileError === null && after.failed === 0 && after.passed > 0, `the next reference run passes: ${JSON.stringify(after)}`);
  console.log('PASS integrity: prototype pollution leaves the run\'s own results, the hidden run, the next run and the host realm unchanged, in QuickJS and in the React engine');
}

// F11-33: output equality alone misses discarded serialization work. The
// program counts actual toJSON/getter calls in Run and in the real grader.
{
  const counterSource = (body: string) => `function probe(){let serializations=0,reads=0;const value={toJSON(){serializations++;return {get value(){reads++;return 'kept';}};}};${body};return [serializations,reads];}`;
  const beforeCap = `console.log(value);console.dir(value);`;
  const afterLines = `for(let i=0;i<${MAX_LOGS};i++)console.log(i);console.log(value);console.dir(value);console.log(value,value);`;
  const fullLines = Math.floor(MAX_LOG_CHARS / MAX_LOG_LINE_CHARS);
  const tailChars = MAX_LOG_CHARS % MAX_LOG_LINE_CHARS;
  const fillOutput = `for(let i=0;i<${fullLines};i++)console.log('x'.repeat(${MAX_LOG_LINE_CHARS}));${tailChars ? `console.log('x'.repeat(${tailChars}));` : ''}`;
  const afterCharacters = `${fillOutput}console.log(value);console.dir(value);console.log(value,value);`;
  const fullLogs = Array.from({length:fullLines},()=> 'x'.repeat(MAX_LOG_LINE_CHARS));
  if(tailChars) fullLogs.push('x'.repeat(tailChars));
  const fixtures = [
    {name:'before the cap, ordinary arguments still serialize',body:beforeCap,counts:[2,2],logs:['{"value":"kept"}','{"value":"kept"}']},
    {name:'after the line cap, formatting invokes no toJSON or getter',body:afterLines,counts:[0,0],logs:Array.from({length:MAX_LOGS},(_,i)=>String(i))},
    {name:'after the character cut, only the first overflowing argument serializes',body:afterCharacters,counts:[1,1],logs:[...fullLogs,LOG_OUTPUT_CUT]},
  ] as const;
  const failures: Error[]=[];
  for(const fixture of fixtures) {
    const input={code:counterSource(fixture.body),calls:['probe()'],expectations:[[...fixture.counts]]};
    const run=await evaluateCalls(input);
    const submit=await runInSandbox(input);
    try {
      for(const [name,result] of [['Run',run],['Submit',submit]] as const) {
        assert.equal(result.codeError,null,`${name}: ${fixture.name}`);
        assert.notEqual(result.timedOut,true,`${name}: ${fixture.name}`);
        assert.deepEqual(result.results,[{pass:true,actual:JSON.stringify(fixture.counts),error:null}],`${name}: ${fixture.name}`);
        assert.deepEqual(result.logs,fixture.logs,`${name}: ${fixture.name}`);
      }
      assert.deepEqual(submit.logs,run.logs,`F11-33 both runners keep identical logs: ${fixture.name}`);
      console.log(`PASS integrity F11-33: ${fixture.name}`);
    } catch(error) {
      console.error(`FAIL integrity F11-33: ${fixture.name}`,JSON.stringify({run,submit}));
      failures.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  if(failures.length) throw new AggregateError(failures,'F11-33 console serialization-cap parity failed');
}

// ── console output is capped by size (CODE-13) ───────────────────────────
// A hundred megabyte-long lines made a 20 MB Submit response, past what the
// platform sends, after the verdict was already recorded.
{
  // 200 lines of 20 000 characters: ten times the line cap and sixty times the
  // total cap, small enough to finish well inside the 2.5 s run deadline on a
  // loaded CI runner.
  const flood = 'const shout = () => { for (let i = 0; i < 200; i++) console.log("x".repeat(20_000)); return 1; };';
  const run = await evaluateCalls({ code: flood, calls: ['shout()'], expectations: [1] });
  const submit = await runInSandbox({ code: flood, calls: ['shout()'], expectations: [1] });
  for (const [where, logs] of [['Run', run.logs], ['Submit', submit.logs]] as const) {
    const total = logs.reduce((sum, line) => sum + line.length, 0);
    assert.ok(logs.every((line) => line.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length), `${where}: every line is cut to size`);
    assert.ok(total <= MAX_LOG_CHARS + LOG_OUTPUT_CUT.length, `${where}: the output is capped in all (${total})`);
    assert.equal(logs.at(-1), LOG_OUTPUT_CUT, `${where}: the cut is marked`);
  }
  assert.deepEqual(submit.logs, run.logs, 'both runners cut the same way');
  assert.equal(submit.results[0]?.pass, true, 'the calls still grade');
  const response = { statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({
    method: 'POST', headers: {},
    body: { session: encodeCodingSession({ taskId: 'js-sum-array', track: 'javascript', userId: null }), code: 'function sum(numbers) { for (let i = 0; i < 100; i++) console.log("y".repeat(50_000)); return numbers.reduce((a, b) => a + b, 0); }' },
  } as never, response as never, null);
  assert.equal(response.statusCode, 200);
  assert.ok(JSON.stringify(response.body).length < 200_000, `the Submit response stays small (${JSON.stringify(response.body).length} bytes)`);
  console.log('PASS integrity: console output is capped by size');

  // What the code throws is capped the same way: a top-level throw of five
  // million characters came back whole as the run's error.
  const thrown = await runInSandbox({ code: 'throw new Error("z".repeat(5e6));', calls: ['1'], expectations: [1] });
  assert.ok(thrown.codeError!.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length, `the run's error is cut (${thrown.codeError!.length})`);
  assert.ok(thrown.codeError!.endsWith(LOG_LINE_CUT), 'the cut is marked');
  const perCall = await runInSandbox({ code: 'const f = () => { throw new Error("a" + "\u{1F988}".repeat(2e5)); };', calls: ['f()'], expectations: [1] });
  const callError = perCall.results[0]?.error ?? '';
  assert.ok(callError.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length, `a call's error is cut (${callError.length})`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(callError), 'the cut keeps surrogate pairs whole');
  console.log('PASS integrity: thrown error text is capped by size');
}

// ── hidden checks cannot be answered by call order (CODE-11) ─────────────
// Every call used to share one program, visible first, so `A[k++]` served
// the hidden checks their answers in authored order, and the hidden pass
// count told a prober which guesses were right. Hidden checks now run in a
// fresh program, in an order shuffled per submission.
{
  const task = CODING_TASKS.find((one) => one.id === 'js-digit-sum')!;
  const hidden = solutionFor(task.id)!.hiddenTests!;
  const answers = [...task.tests!.map((one) => one.expected), ...hidden.map((one) => one.expected)];
  const visibleInputs = task.tests!.map(test => {
    const literal = /^digitSum\((\d+)\)$/.exec(test.call);
    assert(literal, 'Adapt the phase probe if visible authored call shapes change');
    return Number(literal[1]);
  });
  assert(hidden.every(test => test.call !== task.tests![0].call), 'the phase marker must not be a hidden input');
  // Numeric answers can coincide across visible and hidden cases. Arm the
  // ordered table only by seeing the visible input sequence, so a fresh
  // hidden program deterministically returns undefined rather than scoring
  // accidental equal answers. With a shared program and authored order this
  // attack would pass every case.
  const orderedAttack = `let k = 0; const A = ${JSON.stringify(answers)}; const inputs = ${JSON.stringify(visibleInputs)}; const digitSum = n => { if (k < inputs.length && n !== inputs[k]) return undefined; return A[k++]; };`;
  const phase = await runChecks({ code: orderedAttack, visible: task.tests!, hidden, shuffle: list => list });
  assert.ok(allPassed(phase.visible));
  assert.equal(phase.hidden!.results.filter(result => result.pass).length, 0, 'fresh hidden state cannot inherit the armed visible phase');
  const response = { statusCode: 200, body: null as null | { verdict?: string; hidden?: { passed: number; total: number } }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({
    method: 'POST', headers: {},
    body: { session: encodeCodingSession({ taskId: task.id, track: 'javascript', userId: null }), code: orderedAttack },
  } as never, response as never, null);
  assert.equal(response.statusCode, 200);
  assert.notEqual(response.body?.verdict, 'passed', 'answers served by call count do not pass');
  assert.equal(response.body?.hidden?.passed, 0, 'the hidden run starts from a fresh program');

  // Even knowing the hidden answers, serving them in authored order depends on
  // an order the learner never sees. Reversed here, so the check is exact.
  const known = Object.fromEntries(task.tests!.map((one) => [one.call, one.expected]));
  const byOrder = `const known = ${JSON.stringify(known)}; const H = ${JSON.stringify(hidden.map((one) => one.expected))}; let k = 0; const digitSum = (n) => { const seen = known["digitSum(" + n + ")"]; return seen === undefined ? H[k++] : seen; };`;
  const graded = await runChecks({ code: byOrder, visible: task.tests!, hidden, shuffle: (list) => [...list].reverse() });
  assert.ok(allPassed(graded.visible));
  assert.ok(!allPassed(graded.hidden!), 'hidden answers served in authored order fail a shuffled run');
  const fair = await runChecks({ code: solutionFor(task.id)!.solution, visible: task.tests!, hidden, shuffle: (list) => [...list].reverse() });
  assert.ok(allPassed(fair.visible) && allPassed(fair.hidden!), 'a real solution passes in any order');
  console.log('PASS integrity: hidden checks cannot be answered by call order');
}

// ── a run that outlives its deadline is stopped (CODE-5) ─────────────────
// QuickJS checks its deadline between bytecode instructions. A loop whose
// time goes into native calls ran for 54 s on the request thread, and a
// split-heavy one for nearly ten minutes, blocking every other request the
// instance served. The thread running it is stopped at the deadline plus a
// short grace, and the request thread keeps answering meanwhile.
{
  let worstLag = 0;
  let last = Date.now();
  const beat = setInterval(() => { const now = Date.now(); worstLag = Math.max(worstLag, now - last - 20); last = now; }, 20);
  const started = Date.now();
  const [native, split] = await Promise.all([
    runInSandbox({ code: 'let s = 0; while (true) { s += "x".repeat(2e6).length; } const f = () => 1;', calls: ['f()'], expectations: [1], deadlineMs: 300 }),
    runInSandbox({ code: 'const f = () => { let s = 0; while (true) { s += "ab".repeat(1e6).split("").length; } };', calls: ['f()'], expectations: [1], deadlineMs: 300 }),
  ]);
  const took = Date.now() - started;
  clearInterval(beat);
  assert.equal(native.timedOut, true);
  assert.equal(split.timedOut, true);
  assert.ok(took < 4_000, `both runaway runs were stopped near their deadline (${took} ms)`);
  assert.ok(worstLag < 500, `the request thread kept answering (worst lag ${worstLag} ms)`);
  const after = await runInSandbox({ code: 'const f = () => 1;', calls: ['f()'], expectations: [1] });
  assert.equal(after.results[0]?.pass, true, 'the next run gets a working thread');
  console.log(`PASS integrity: a runaway run is stopped in ${took} ms without blocking the request thread`);
}

// React syntax conversion runs off the request thread (F11-09).
// This red baseline imports no future pool or build helper.
{
  const task = CODING_TASKS.find(one => one.track === 'react' && one.verify === 'tests' && one.suite && isFreeCodingTask(one.id) && !evolvingStage(one.id))!;
  assert.ok(task, 'a free non-evolving React task is required');
  const code = `export default function App(){ const a=1; return ${Array(9000).fill('a').join('+')}; }`;
  assert.ok(Buffer.byteLength(code) < 20_000, 'the quadratic compiler probe fits the actual code cap');
  const out = { statusCode: 200, body: null as null | { verdict?: string; codeError?: string | null; graderUnavailable?: boolean }, setHeader() {}, status(status: number) { this.statusCode = status; return this; }, json(body: never) { this.body = body; return this; } };
  let worstLag = 0, last = Date.now(), ticks = 0;
  const beat = setInterval(() => { const now = Date.now(); worstLag = Math.max(worstLag, now - last - 20); last = now; ticks++; }, 20);
  const started = Date.now();
  try {
    await handleCodingSubmit({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.76' }, body: {
      session: encodeCodingSession({ taskId: task.id, track: 'react', userId: null }), code,
    } } as never, out as never, null);
    // Let a timer observe the delay even if a synchronous baseline resolved
    // Submit through microtasks before the first interval could run.
    await new Promise(resolve => setTimeout(resolve, 25));
  } finally { clearInterval(beat); }
  assert.ok(ticks > 0, 'the heartbeat must actually run');
  assert.equal(out.statusCode, 200);
  assert.equal(out.body?.verdict, 'error');
  assert.equal(out.body?.graderUnavailable, undefined, 'a stopped/nested compile is the existing learner error');
  assert.match(out.body?.codeError ?? '', /nests too deeply/);
  assert.ok(worstLag < 500, `React Submit kept the request thread answering (worst lag ${worstLag} ms)`);
  console.log(`PASS integrity: React syntax conversion keeps the request thread answering (${Date.now() - started} ms, worst lag ${worstLag} ms)`);
}

// ── type checking runs off the request thread (CODE-2) ───────────────────
// The compiler checks types synchronously. A kilobyte and a half of
// recursive conditional types kept it busy for about half a minute on the
// request thread, which also serves Learn. The check now runs on a worker
// thread, is stopped at its deadline, and the verdict says so.
{
  const recursive = "type B<N extends number, E, A extends unknown[] = []> = A['length'] extends N ? A : B<N, E, [...A, E]>;\n"
    + Array.from({ length: 30 }, (_, index) => `const q${index}: B<999, 'k${index}'>['length'] = 999;\n`).join('');
  const submit = async (code: string) => {
    const out = { statusCode: 200, body: null as null | { verdict?: string; codeError?: string | null; solutions?: unknown; failureHint?: unknown }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
    await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: encodeCodingSession({ taskId: 'ts-typed-slug', track: 'typescript', userId: null }), code } } as never, out as never, null);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body!;
  };
  // A first check loads the compiler on the thread before its clock starts.
  assert.equal((await submit(solutionFor('ts-typed-slug')!.solution)).verdict, 'passed', 'the reference passes on the worker thread');
  let worstLag = 0;
  let last = Date.now();
  const beat = setInterval(() => { const now = Date.now(); worstLag = Math.max(worstLag, now - last - 20); last = now; }, 20);
  const started = Date.now();
  const stuck = await submit(recursive + solutionFor('ts-typed-slug')!.solution);
  const took = Date.now() - started;
  clearInterval(beat);
  assert.equal(stuck.verdict, 'timeout', JSON.stringify(stuck));
  assert.equal(stuck.codeError, TYPE_CHECK_STOPPED_MESSAGE);
  assert.equal(stuck.solutions, null, 'a stopped check releases no solutions');
  // Audit C5-2: the timeout hint sent the learner looking for an endless loop.
  assert.equal(stuck.failureHint, null, 'a stopped type check carries no loop hint; its message names the type');
  assert.ok(took < TYPE_CHECK_DEADLINE_MS + 3_000, `the check was stopped near its deadline (${took} ms)`);
  // On this thread the same check held the event loop for half a minute; the
  // bound leaves room for a loaded CI machine.
  assert.ok(worstLag < 2_000, `the request thread kept answering (worst lag ${worstLag} ms)`);
  assert.equal((await submit(solutionFor('ts-typed-slug')!.solution)).verdict, 'passed', 'the next check gets a working thread');
  // The pool reports a stop the same way for every caller.
  const direct = await checkTypes(recursive, [[]], 300);
  assert.equal(direct.stopped, true);
  console.log(`PASS integrity: a runaway type check is stopped in ${took} ms without blocking the request thread`);
}

// ── a hidden run's error carries nothing the program wrote (CODE-3) ──────
// The controller called `then` on each call's promise after the call had
// run. Code that put a throwing getter on Promise.prototype.constructor
// threw there, during the hidden run, with the hidden inputs in the message,
// and the verdict returned it as the error.
{
  const leak = 'const seen = []; const digitSum = n => { seen.push(n); return 0; }; const visible = [493, 1234, 0, 7, 1000]; let reads = 0; Object.defineProperty(Promise.prototype, "constructor", { configurable: true, get() { reads++; if (seen.some(n => !visible.includes(n)) && reads === 3) throw new Error("HIDDEN " + JSON.stringify(seen)); return Promise; } });';
  const out = { statusCode: 200, body: null as null | { verdict?: string; codeError?: string | null; hidden?: unknown }, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({ method: 'POST', headers: {}, body: { session: encodeCodingSession({ taskId: 'js-digit-sum', track: 'javascript', userId: null }), code: leak } } as never, out as never, null);
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  assert.doesNotMatch(JSON.stringify(out.body), /HIDDEN|99999|305/, `no hidden input comes back: ${JSON.stringify(out.body)}`);
  assert.equal(out.body?.verdict, 'failed');
  // Whatever else stops a hidden run, only a fixed message comes back: here a
  // hidden call that does not compile, which the visible run never sees.
  const garbled = await runChecks({ code: 'const f = (x) => x;', visible: [{ call: 'f(1)', expected: 1 }], hidden: [{ call: 'f(', expected: 2 }], shuffle: (list) => list });
  assert.equal(garbled.visible.codeError, null);
  assert.equal(garbled.hidden?.codeError, HIDDEN_RUN_FAILED_MESSAGE);
  const hung = await runChecks({ code: 'const f = (x) => { if (x === 2) while (true) {} return x; };', visible: [{ call: 'f(1)', expected: 1 }], hidden: [{ call: 'f(2)', expected: 2 }], shuffle: (list) => list });
  assert.equal(hung.hidden?.timedOut, true);
  assert.equal(hung.hidden?.codeError, TIMEOUT_MESSAGE, 'a fixed message still comes back');
  console.log('PASS integrity: a hidden run reports no text the program wrote');
}

// ── a probe counts with the built-ins it started with (PATH-1) ───────────
// js-binary-search's hidden check counts array reads through a Proxy. Code
// that replaced the global Proxy, or RegExp.prototype.test, made every count
// zero, so a linear scan passed the binary-search budget.
{
  const task = CODING_TASKS.find((one) => one.id === 'js-binary-search')!;
  const hidden = solutionFor(task.id)!.hiddenTests!;
  const linear = 'const binarySearch = (sorted, target) => { for (let i = 0; i < sorted.length; i++) if (sorted[i] === target) return i; return -1; };';
  for (const [name, tamper] of [
    ['no tampering', ''],
    ['Proxy replaced', 'var Proxy = function (target) { return target; };'],
    ['global Proxy replaced', 'globalThis.Proxy = function (target) { return target; };'],
    ['RegExp test replaced', 'RegExp.prototype.test = function () { return false; };'],
  ] as const) {
    const run = await runChecks({ code: `${tamper}\n${linear}`, visible: task.tests!, hidden, shuffle: (list) => list });
    assert.ok(!allPassed(run.hidden!), `${name}: a linear scan passes the read budget`);
  }
  const reference = await runChecks({ code: solutionFor(task.id)!.solution, visible: task.tests!, hidden, shuffle: (list) => list });
  assert.ok(allPassed(reference.visible) && allPassed(reference.hidden!), 'the reference still passes');
  const redeclared = await runInSandbox({ code: 'var __probe = { Proxy: function (target) { return target; } };', calls: ['1'], expectations: [1] });
  assert.match(redeclared.codeError ?? '', /^SyntaxError: .*redefinition/, `the probe cannot be redeclared: ${redeclared.codeError}`);
  console.log('PASS integrity: a replaced Proxy or RegExp test does not zero a read count');
}

// ── one caller cannot hold the grader's threads (C1-1) ───────────────────
// The grader's queues had no bound and no deadline, and a guest may send
// thirty submits at once. Thirty runaway programs held every thread while
// another learner's correct Submit waited behind them: half a minute for
// JavaScript, and past the function's 45 s limit (a 504) for TypeScript. A
// caller now has at most GRADING_PER_TASK submits grading at once on one task
// and GRADING_PER_CALLER across tasks, and the rest of a burst is refused at
// once with 429 `grader_busy`. That is not a verdict: nothing is recorded, so
// it costs no XP and no streak day.
type Answer = {
  statusCode: number;
  headers: Record<string, string>;
  body: null | { verdict?: string; applied?: boolean; codeError?: string | null; error?: { code?: string } };
  setHeader(name: string, value: string): void;
  status(code: number): Answer;
  json(body: never): Answer;
};
const answer = (): Answer => ({
  statusCode: 200, headers: {}, body: null,
  setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const submitCode = async (input: { taskId: string; track: 'javascript' | 'typescript'; code: string; address: string; account?: string; db?: ReturnType<typeof codingDatabase> }) => {
  const out = answer();
  await handleCodingSubmit({
    method: 'POST', query: {},
    headers: { 'x-forwarded-for': input.address, ...(input.account ? { authorization: 'Bearer local-test' } : {}) },
    body: { session: encodeCodingSession({ taskId: input.taskId, track: input.track, userId: null }), code: input.code, ...(input.account ? { user_id: input.account } : {}) },
  } as never, out as never, (input.db?.client ?? null) as never);
  return out;
};
const runawayTypes = "type B<N extends number, E, A extends unknown[] = []> = A['length'] extends N ? A : B<N, E, [...A, E]>;\n"
  + Array.from({ length: 30 }, (_, index) => `const q${index}: B<999, 'k${index}'>['length'] = 999;\n`).join('');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** What a run came to and how long it took: its result, or the reason the
 * grader gave for not taking it. */
const timed = <T>(run: Promise<T>) => {
  const started = Date.now();
  return run.then(
    (value) => ({ value, busy: null as string | null, ms: Date.now() - started }),
    (error: unknown) => {
      if (!(error instanceof GraderBusyError)) throw error;
      assert.ok(error.retryAfterSeconds >= 1, 'a busy grader says when to try again');
      return { value: null, busy: error.reason, ms: Date.now() - started };
    },
  );
};
{
  const db = codingDatabase();
  const flooder = 'user-flood-0001';
  const runaway = "const double = (numbers) => { for (;;) { 'x'.repeat(2e6); } };";
  const flood = Array.from({ length: 12 }, () => submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: runaway, address: '203.0.113.41', account: flooder, db }));
  const started = Date.now();
  const other = await submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: solutionFor('js-double-numbers')!.solution, address: '203.0.113.42', account: 'user-calm-0002', db });
  const waited = Date.now() - started;
  const answers = await Promise.all(flood);
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
  assert.equal(other.body?.verdict, 'passed');
  // Before: the twelve runaway programs went first, three rounds of four
  // threads at 2.5 s each.
  assert.ok(waited < 5_000, `another learner's Submit did not wait behind the burst (${waited} ms)`);
  const refused = answers.filter((out) => out.statusCode === 429);
  assert.equal(refused.length, answers.length - GRADING_PER_TASK, `all but ${GRADING_PER_TASK} of the burst are refused: ${answers.map((out) => out.statusCode).join(',')}`);
  for (const out of refused) {
    assert.equal(out.body?.error?.code, 'grader_busy');
    assert.ok(Number(out.headers['retry-after']) >= 1, 'a refusal says when to try again');
  }
  assert.ok(answers.filter((out) => out.statusCode === 200).every((out) => out.body?.verdict === 'timeout'), 'the submits it took are graded as usual');
  const recorded = db.rpcCalls.filter((call) => call.name === 'record_coding_verdict' && call.args.p_user_id === flooder);
  assert.equal(recorded.length, GRADING_PER_TASK, 'a refused submit records nothing');
  const again = await submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: solutionFor('js-double-numbers')!.solution, address: '203.0.113.41', account: flooder, db });
  assert.equal(again.body?.verdict, 'passed', 'once its submits are answered the caller may submit again');
  console.log(`PASS integrity: a burst of runaway submits holds ${GRADING_PER_TASK} threads and another learner is answered in ${waited} ms`);
}
{
  const flood = Array.from({ length: 24 }, () => submitCode({ taskId: 'ts-typed-slug', track: 'typescript', code: runawayTypes + solutionFor('ts-typed-slug')!.solution, address: '203.0.113.43' }));
  const started = Date.now();
  const other = await submitCode({ taskId: 'ts-typed-slug', track: 'typescript', code: solutionFor('ts-typed-slug')!.solution, address: '203.0.113.44' });
  const waited = Date.now() - started;
  const answers = await Promise.all(flood);
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
  assert.equal(other.body?.verdict, 'passed');
  // Before: twelve rounds of two threads, past the function's limit. Now the
  // learner waits for one runaway check to be stopped, then for a new thread
  // to load the compiler, which a loaded machine takes its time over.
  assert.ok(waited < 30_000, `another learner's TypeScript Submit was answered in time (${waited} ms)`);
  assert.equal(answers.filter((out) => out.statusCode === 429 && out.body?.error?.code === 'grader_busy').length, answers.length - GRADING_PER_TASK);
  assert.ok(answers.filter((out) => out.statusCode === 200).every((out) => out.body?.verdict === 'timeout'));
  console.log(`PASS integrity: a burst of runaway type checks leaves another learner's TypeScript Submit answered in ${waited} ms`);
}

// ── grading in flight is counted per task (owner decision 9) ────────────
// The count was per caller, so a learner's submit still grading on one task
// refused their Submit on the next task. It is per task now, beneath a
// ceiling across tasks, and every answered submit gives its slot back.
{
  const free = CODING_TASKS.filter((task) => task.track === 'javascript' && isFreeCodingTask(task.id) && !evolvingStage(task.id) && task.tests && solutionFor(task.id)?.solution)
    .map((task) => task.id).filter((id) => id !== 'js-double-numbers').slice(0, 2);
  const [taskB, taskC] = free;
  assert.ok(taskB && taskC, 'two more free JavaScript tasks with a reference solution');
  const correct = (taskId: string) => solutionFor(taskId)!.solution;

  // One learner's runaway burst on task A, and their correct Submit on task B
  // sent with it: B is graded while A's two run, the rest of A is refused.
  const db = codingDatabase();
  const learner = 'user-two-tasks-0005';
  const address = '203.0.113.46';
  const runaway = "for (;;) { 'x'.repeat(2e6); }";
  const burst = Array.from({ length: 6 }, () => submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: runaway, address, account: learner, db }));
  const onB = await submitCode({ taskId: taskB, track: 'javascript', code: correct(taskB), address, account: learner, db });
  const answers = await Promise.all(burst);
  assert.equal(onB.statusCode, 200, JSON.stringify(onB.body));
  assert.equal(onB.body?.verdict, 'passed', 'a burst still grading on one task does not hold up the same learner\'s Submit on another');
  assert.equal(answers.filter((out) => out.statusCode === 429 && out.body?.error?.code === 'grader_busy').length, answers.length - GRADING_PER_TASK,
    `all but ${GRADING_PER_TASK} of the burst on one task are refused: ${answers.map((out) => out.statusCode).join(',')}`);

  // The ceiling: with GRADING_PER_CALLER of the learner's submits grading
  // across two tasks, a Submit on a third is refused and records nothing.
  const ceilingDb = codingDatabase();
  const busy = 'user-ceiling-0006';
  const hold = (taskId: string) => enterInFlight({ headers: { 'x-forwarded-for': address }, socket: {} } as never, 'grading',
    { item: gradingItem.task(taskId), perItem: GRADING_PER_TASK, perCaller: GRADING_PER_CALLER }, `user:${busy}`);
  const held = Array.from({ length: GRADING_PER_CALLER }, (_, n) => hold(n < GRADING_PER_TASK ? 'js-double-numbers' : taskB));
  assert.ok(held.every(Boolean), 'the learner\'s submits fill the ceiling across two tasks');
  const refused = await submitCode({ taskId: taskC, track: 'javascript', code: correct(taskC), address, account: busy, db: ceilingDb });
  assert.equal(refused.statusCode, 429, JSON.stringify(refused.body));
  assert.equal(refused.body?.error?.code, 'grader_busy');
  assert.equal(ceilingDb.attemptIds.length, 0, 'a Submit past the ceiling records nothing');
  for (const done of held) done?.();
  const graded = await submitCode({ taskId: taskC, track: 'javascript', code: correct(taskC), address, account: busy, db: ceilingDb });
  assert.equal(graded.body?.verdict, 'passed', 'once those are answered the third task is graded');

  // Every answered submit gives its slot back, a timeout as well as a pass:
  // more of them one after another than the ceiling holds are all graded.
  const verdicts: string[] = [];
  for (let n = 0; n <= GRADING_PER_CALLER; n += 1) {
    const out = await submitCode({ taskId: taskB, track: 'javascript', code: n === 0 ? runaway : correct(taskB), address, account: busy, db: ceilingDb });
    verdicts.push(`${out.statusCode} ${out.body?.verdict ?? out.body?.error?.code}`);
  }
  assert.deepEqual(verdicts, ['200 timeout', ...Array.from({ length: GRADING_PER_CALLER }, () => '200 passed')], 'no slot is kept after its submit is answered');
  console.log(`PASS integrity: grading in flight is counted per task, ${GRADING_PER_TASK} a task beneath ${GRADING_PER_CALLER} a learner, and every answered submit frees its slot`);
}

// ── a class submitting at once is graded, not turned away ───────────────
// The queue bounds the memory and the wait bounds the time. A class of
// SHARED_NETWORK_SEATS pressing Submit together queues 64 runs and 32 type
// checks, all correct and quick; with queues of 32 and 16 a third of them
// were told the grader was busy while the burst drained in half a second.
{
  const seats = SHARED_NETWORK_SEATS;
  const [jsBurst, tsBurst] = await Promise.all([
    Promise.all(Array.from({ length: seats * 2 }, () => timed(runInSandbox({ code: 'const f = () => 1;', calls: ['f()'], expectations: [1] })))),
    Promise.all(Array.from({ length: seats }, () => timed(checkTypes('const a: number = 1;', [[]])))),
  ]);
  assert.deepEqual(jsBurst.filter((run) => run.busy !== null).map((run) => run.busy), [], 'a class-sized burst of runs is graded');
  assert.deepEqual(tsBurst.filter((run) => run.busy !== null).map((run) => run.busy), [], 'a class-sized burst of type checks is graded');
  assert.ok(jsBurst.every((run) => (run.value as { results: { pass: boolean }[] }).results[0]?.pass === true), 'every run of the burst passes');
  console.log(`PASS integrity: ${seats * 2} runs and ${seats} type checks submitted together are all graded`);
}

// ── a run waits a bounded time in a bounded queue (C1-1) ─────────────────
// Every thread of both pools is held by a run that outlasts the wait. Runs
// queued behind them are told the grader is busy once they have waited their
// limit, and runs past the queue's length at once; through the handler that
// is a 503 `grader_busy`, recorded nowhere. Afterwards the pools are whole.
{
  const quick = () => runInSandbox({ code: 'const f = () => 1;', calls: ['f()'], expectations: [1] });
  const js = [
    ...Array.from({ length: 6 }, () => timed(runInSandbox({ code: 'while (true) {}', calls: ['1'], expectations: [1], deadlineMs: SANDBOX_SLOT_WAIT_MS + 2_000 }))),
    ...Array.from({ length: SANDBOX_MAX_WAITING + 8 }, () => timed(quick())),
  ];
  const ts = [
    ...Array.from({ length: 3 }, () => timed(checkTypes(runawayTypes, [[]], TS_CHECK_SLOT_WAIT_MS + 2_000))),
    ...Array.from({ length: TS_CHECK_MAX_WAITING + 4 }, () => timed(checkTypes('const a: number = 1;', [[]]))),
  ];
  // Through the handler, a Submit the threads cannot take is a 503 and not a
  // verdict.
  const db = codingDatabase();
  const busy = await submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: solutionFor('js-double-numbers')!.solution, address: '203.0.113.45', account: 'user-wait-0003', db });
  assert.equal(busy.statusCode, 503, JSON.stringify(busy.body));
  assert.equal(busy.body?.error?.code, 'grader_busy');
  assert.ok(Number(busy.headers['retry-after']) >= 1);
  assert.equal(db.attemptIds.length, 0, 'a Submit the grader could not take records nothing');
  const [jsRuns, tsRuns] = await Promise.all([Promise.all(js), Promise.all(ts)]);
  for (const [name, runs, waitMs] of [['sandbox', jsRuns, SANDBOX_SLOT_WAIT_MS], ['ts_check', tsRuns, TS_CHECK_SLOT_WAIT_MS]] as const) {
    const ran = runs.filter((run) => run.busy === null);
    const expired = runs.filter((run) => run.busy === `${name}_wait_expired`);
    const full = runs.filter((run) => run.busy === `${name}_queue_full`);
    assert.equal(ran.length + expired.length + full.length, runs.length, `${name}: every run ran or was told the grader is busy`);
    // A type checker can diagnose the recursive alias before its deadline,
    // freeing its slots and legitimately finishing every queued normal check.
    // Queue expiration is checked with held slots below, independently of
    // compiler speed; real expirations here must still obey the production cap.
    assert.ok(ran.length >= 1 && full.length >= 1, `${name}: ${ran.length} ran, ${expired.length} waited out, ${full.length} found the queue full`);
    if (name === 'sandbox') assert.ok(expired.length >= 1, 'an infinite JS loop holds its slot past the queue deadline');
    assert.ok(full.every((run) => run.ms < 1_000), `${name}: a full queue refuses at once`);
    assert.ok(expired.every((run) => run.ms >= waitMs - 50 && run.ms < waitMs + 3_000), `${name}: a queued run waits its limit and no longer: ${expired.map((run) => run.ms).join(',')}`);
  }
  assert.ok(jsRuns.filter((run) => run.busy === null).every((run) => (run.value as { timedOut?: boolean }).timedOut === true), 'only the runs holding a thread ran');
  // The threads come back: a full pool's worth of runs all get one.
  const after = await Promise.all(Array.from({ length: 6 }, () => quick()));
  assert.ok(after.every((run) => run.results[0]?.pass === true), 'the pool is whole again');
  assert.equal((await checkTypes('const a: number = 1;', [[]])).stopped, false, 'the type-check pool is whole again');
  console.log(`PASS integrity: a queued run waits at most ${SANDBOX_SLOT_WAIT_MS} ms (types ${TS_CHECK_SLOT_WAIT_MS} ms), a full queue refuses at once, and neither is a verdict`);
}

// Exercise the actual shared queue while its only slot is explicitly held.
// This always reaches expiry, even on a machine where TypeScript diagnoses
// the "runaway" type before the integration burst's production wait cap.
for (const name of ['sandbox', 'ts_check']) {
  const waitMs = 50;
  const slots = threadSlots({ threads: 1, waiting: 1, waitMs, name });
  await slots.acquire();
  const queued = timed(slots.acquire());
  const full = await timed(slots.acquire());
  assert.equal(full.busy, `${name}_queue_full`);
  const expired = await queued;
  assert.equal(expired.busy, `${name}_wait_expired`);
  assert.ok(expired.ms >= waitMs - 5 && expired.ms < waitMs + 3_000, `${name}: held-slot waiter respects the deadline`);
  slots.release();
  assert.equal((await timed(slots.acquire())).busy, null, `${name}: expired waiter does not consume the released slot`);
  slots.release();
  console.log(`PASS integrity: ${name} held-slot queue expires, refuses overflow and recovers`);
}

// ── a thread that would not start is tried again (C1-4) ──────────────────
// One failed start (a boot past its limit, a thread that died before it
// picked the run up) switched the instance to grading on the request thread
// for the rest of its life, where a runaway native-call loop blocks every
// request. A failed start now pauses new threads for a second, doubling up to
// thirty; on a deployment a run that would need one meanwhile is told the
// grader is busy, and never runs on the request thread. Here the bundles are
// replaced by ones that throw as they load, then put back. A pool keeps fewer
// threads loaded than it runs at once (two of four, one of two), so a full
// pool's worth of runs always needs a new thread.
{
  const sandboxBundle = join(process.cwd(), SANDBOX_WORKER_FILE);
  const typesBundle = join(process.cwd(), TS_CHECK_WORKER_FILE);
  const sandboxSource = readFileSync(sandboxBundle);
  const typesSource = readFileSync(typesBundle);
  const broken = "throw new Error('this thread does not start');\n";
  const clean = () => runInSandbox({ code: 'const f = () => 1;', calls: ['f()'], expectations: [1] });
  const cleanTypes = () => checkTypes('const a: number = 1;', [[]]);
  /** A full pool's worth of runs at once: what each ran into. */
  const fullPool = async (count: number, run: () => Promise<unknown>) => Promise.all(Array.from({ length: count }, () => timed(run())));
  const reasons = (runs: { busy: string | null }[]) => runs.map((run) => run.busy);
  let worstLag = 0;
  let last = Date.now();
  const beat = setInterval(() => { const now = Date.now(); worstLag = Math.max(worstLag, now - last - 20); last = now; }, 20);
  try {
    writeFileSync(sandboxBundle, broken);
    writeFileSync(typesBundle, broken);
    process.env.VERCEL = '1';
    // On a deployment a run whose thread would not start does not run here:
    // the loaded threads take their runs, the rest are told the grader is busy.
    const failed = await fullPool(4, clean);
    assert.ok(reasons(failed).includes('sandbox_worker_failed'), `a thread that did not start: ${reasons(failed).join(', ')}`);
    assert.ok(failed.every((run) => run.busy !== null || (run.value as { results: { pass: boolean | null }[] }).results[0]?.pass === true), 'only loaded threads ran');
    // During the pause no new thread is tried. A machine slow enough to
    // outlast a pause meets another failure, and a pause twice as long.
    let paused = await fullPool(4, clean);
    for (let tries = 0; tries < 4 && !reasons(paused).includes('sandbox_worker_backoff'); tries++) {
      assert.ok(reasons(paused).every((reason) => reason === null || reason === 'sandbox_worker_failed'), reasons(paused).join(', '));
      paused = await fullPool(4, clean);
    }
    assert.ok(reasons(paused).includes('sandbox_worker_backoff'), `during the pause: ${reasons(paused).join(', ')}`);
    assert.ok(reasons(paused).every((reason) => reason === null || reason === 'sandbox_worker_backoff'), 'during the pause no new thread is tried');
    const typesFailed = await fullPool(2, cleanTypes);
    assert.ok(reasons(typesFailed).includes('ts_check_worker_failed'), `a type-check thread that did not start: ${reasons(typesFailed).join(', ')}`);
    // Through the handler: with the loaded threads busy elsewhere, the Submit
    // needs a new one and is a 503 that records nothing.
    const occupy = fullPool(2, () => runInSandbox({ code: 'while (true) {}', calls: ['1'], expectations: [1], deadlineMs: 2_000 }));
    const db = codingDatabase();
    const refused = await submitCode({ taskId: 'js-double-numbers', track: 'javascript', code: solutionFor('js-double-numbers')!.solution, address: '203.0.113.46', account: 'user-boot-0004', db });
    await occupy;
    assert.equal(refused.statusCode, 503, JSON.stringify(refused.body));
    assert.equal(refused.body?.error?.code, 'grader_busy');
    assert.ok(Number(refused.headers['retry-after']) >= 1);
    assert.equal(db.attemptIds.length, 0, 'a grader that could not start records nothing');
    const occupyTypes = fullPool(1, () => checkTypes(runawayTypes, [[]], 2_000));
    const typed = await submitCode({ taskId: 'ts-typed-slug', track: 'typescript', code: solutionFor('ts-typed-slug')!.solution, address: '203.0.113.46' });
    await occupyTypes;
    assert.equal(typed.statusCode, 503, JSON.stringify(typed.body));
    // Off a deployment (tests, local runs) such a run still happens, in this
    // thread, as it did before the worker existed.
    delete process.env.VERCEL;
    assert.ok((await Promise.all(Array.from({ length: 4 }, () => clean()))).every((run) => run.results[0]?.pass === true), 'off a deployment every run is graded');
    process.env.VERCEL = '1';
    // The bundles are back. Once the pause is over new threads start, and a
    // runaway native-call loop is stopped there without holding up this one.
    writeFileSync(sandboxBundle, sandboxSource);
    writeFileSync(typesBundle, typesSource);
    const afterPause = async <T>(count: number, run: () => Promise<T>, paused: string) => {
      for (let tries = 0; tries < 40; tries++) {
        worstLag = 0;
        const runs = await fullPool(count, run);
        if (runs.every((one) => one.busy === null)) return runs.map((one) => one.value as T);
        assert.ok(reasons(runs).every((reason) => reason === null || reason === paused), `while paused, nothing else stops a run: ${reasons(runs).join(', ')}`);
        await sleep(1_000);
      }
      return assert.fail('the pause ended');
    };
    const stuck = await afterPause(4, () => runInSandbox({ code: "for (;;) { 'x'.repeat(2e6); }", calls: ['1'], expectations: [1], deadlineMs: 300 }), 'sandbox_worker_backoff');
    assert.ok(stuck.every((run) => run.timedOut), 'each runaway run was stopped');
    // On this thread the loop runs for minutes; the bound leaves room for a
    // loaded machine starting threads.
    assert.ok(worstLag < 2_000, `the runaway runs ran on worker threads, not this one (worst lag ${worstLag} ms)`);
    const stopped = await afterPause(2, () => checkTypes(runawayTypes, [[]], 300), 'ts_check_worker_backoff');
    assert.ok(stopped.every((outcome) => outcome.stopped), 'type checks run on threads again, under their deadline');
  } finally {
    clearInterval(beat);
    delete process.env.VERCEL;
    writeFileSync(sandboxBundle, sandboxSource);
    writeFileSync(typesBundle, typesSource);
  }
  console.log('PASS integrity: a thread that would not start is tried again after a pause, and no run moves to the request thread on a deployment');
}

// ── a thread that cannot run the program says the grader is busy ─────────
// A thread that started but could not run the program (QuickJS would not
// load or allocate, before any learner code ran) answered with a plain error,
// which the Submit handler turned into HTTP 500. It is the host's fault, so
// the caller is told the grader is busy, as for a thread that would not start.
{
  const sandboxBundle = join(process.cwd(), SANDBOX_WORKER_FILE);
  const sandboxSource = readFileSync(sandboxBundle);
  try {
    writeFileSync(sandboxBundle, "const { parentPort } = require('node:worker_threads');\nparentPort.on('message', () => { parentPort.postMessage({ type: 'start' }); parentPort.postMessage({ type: 'fail', message: 'QuickJS would not load' }); });\n");
    process.env.VERCEL = '1';
    // Two threads stay loaded with the real bundle, so four runs at once
    // need at least two new ones.
    const runs = await Promise.all(Array.from({ length: 4 }, () => timed(runInSandbox({ code: 'const f = () => 1;', calls: ['f()'], expectations: [1] }))));
    assert.ok(runs.some((run) => run.busy === 'sandbox_worker_run_failed'), runs.map((run) => run.busy).join(', '));
    assert.ok(runs.every((run) => run.busy === 'sandbox_worker_run_failed' || (run.value as { results: { pass: boolean | null }[] }).results[0]?.pass === true), 'the loaded threads still grade');
  } finally {
    delete process.env.VERCEL;
    writeFileSync(sandboxBundle, sandboxSource);
  }
  console.log('PASS integrity: a thread that cannot run the program says the grader is busy');
}

// ── deeply nested TypeScript gets a verdict (C1-5) ───────────────────────
// The handler transpiled TypeScript on the request thread after the type
// check. A thousand nested arrows overflowed the compiler's stack there, the
// RangeError escaped, and the learner got HTTP 500. The type-check thread now
// transpiles too; code nested past what it can compile is an error verdict.
{
  const solution = solutionFor('ts-typed-slug')!.solution;
  const submit = (code: string) => submitCode({ taskId: 'ts-typed-slug', track: 'typescript', code, address: '203.0.113.47' });
  const arrows = await submit(`const f = ${'() => '.repeat(1000)}1;\n${solution}`);
  assert.equal(arrows.statusCode, 200, JSON.stringify(arrows.body));
  assert.ok(typeof arrows.body?.verdict === 'string', 'a thousand nested arrows get a verdict');
  // Thousands of nested blocks: the checker gets through them and the
  // transpiler does not. Where one gives out and the other does not moves
  // with the compiler's warm-up, so several depths go in. Each is a verdict,
  // the type checker's stop or the transpiler's error, and at least one is
  // the transpiler's.
  const verdicts: string[] = [];
  for (const depth of [2500, 3500, 4500, 5500, 6500, 7500]) {
    const blocks = await submit(`function h(a: number) {\n${'{'.repeat(depth)}a++;${'}'.repeat(depth)}\n}\n${solution}`);
    assert.equal(blocks.statusCode, 200, JSON.stringify(blocks.body));
    assert.ok(
      (blocks.body?.verdict === 'error' && blocks.body.codeError === TRANSPILE_FAILED_MESSAGE)
        || (blocks.body?.verdict === 'timeout' && blocks.body.codeError === TYPE_CHECK_STOPPED_MESSAGE),
      `${depth} nested blocks: ${JSON.stringify(blocks.body)}`,
    );
    verdicts.push(blocks.body!.verdict!);
  }
  assert.ok(verdicts.includes('error'), `code the compiler cannot transpile is an error verdict: ${verdicts.join(', ')}`);
  assert.equal((await submit(solution)).body?.verdict, 'passed', 'the next Submit is graded as usual');
  console.log('PASS integrity: TypeScript nested past what the compiler can transpile is an error verdict, not an HTTP 500');
}
