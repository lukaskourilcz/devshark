// The browser runner's clock, phase by phase (audit C3-7 and C5-2). A worker
// that never loads is the connection's problem, not the learner's; a type that
// keeps the checker busy is stopped within seconds and named as a type
// problem; only a run that started and did not finish is a loop.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runCodeTests, warmRunner, holdCompiler, compilerStarted, TYPE_CHECK_TIMEOUT_MS, COMPILE_TIMEOUT_MS, COMPILER_KEEP_MS, ABANDONED_CHECK_GRACE_MS } from '../src/coding/runner/run-tests';
import type { RunnerRequest } from '../src/coding/runner/worker';
import { RUN_TIMEOUT_MS, TIMEOUT_MESSAGE, TYPE_CHECK_STOPPED_MESSAGE } from '../../shared/coding-evaluate';

// The worker's compiler, with a checker that runs out of stack on any real
// code (a type that keeps recursing). The compiler itself is never loaded.
vi.mock('typescript', () => ({ default: {} }));
vi.mock('../../shared/coding-ts-check', async (original) => ({
  ...(await original<typeof import('../../shared/coding-ts-check')>()),
  createTypeScript: () => ({
    check: (code: string) => {
      if (code) throw new RangeError('Maximum call stack size exceeded');
      return { codeErrors: [], typeTests: [] };
    },
    toJavaScript: (code: string) => code,
  }),
}));

type Script = (worker: FakeWorker, request: RunnerRequest) => void;
let script: Script = () => {};
let started = 0;
const workers: FakeWorker[] = [];
class FakeWorker {
  constructor() { started += 1; workers.push(this); }
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  terminated = false;
  requests: RunnerRequest[] = [];
  post(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  postMessage(request: RunnerRequest) { this.requests.push(request); queueMicrotask(() => script(this, request)); }
  terminate() { this.terminated = true; }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const run = (track: 'javascript' | 'typescript') => runCodeTests({ track, code: 'x', tests: [{ call: 'f()', expected: 1 }] });

it('reports a worker that never loaded as the runner, not as the code', async () => {
  script = (worker) => worker.onerror?.(new Event('error'));
  const outcome = await run('javascript');
  expect(outcome.runnerUnavailable).toBe(true);
  expect(outcome.codeError).toBeNull();
  expect(outcome.timedOut).toBe(false);
});

it('reports an error the learner’s code threw as a code error', async () => {
  script = (worker) => { worker.post({ phase: 'running' }); worker.onerror?.(Object.assign(new Event('error'), { message: 'Uncaught Error: boom' })); };
  const outcome = await run('javascript');
  expect(outcome.runnerUnavailable).toBeUndefined();
  expect(outcome.codeError).toBe('Uncaught Error: boom');
});

it('does not call a slow download an infinite loop', async () => {
  script = () => { /* the worker script never arrives */ };
  const pending = run('javascript');
  await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1);
  let settled = false;
  void pending.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(COMPILE_TIMEOUT_MS);
  expect(await pending).toMatchObject({ runnerUnavailable: true, timedOut: false });
});

it('stops a runaway type check within seconds and names the types', async () => {
  script = (worker) => { worker.post({ phase: 'compiling' }); worker.post({ phase: 'checking' }); };
  const pending = run('typescript');
  await vi.advanceTimersByTimeAsync(TYPE_CHECK_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ timedOut: true, codeError: TYPE_CHECK_STOPPED_MESSAGE });
  expect(TYPE_CHECK_TIMEOUT_MS).toBeLessThan(10_000);
});

it('names a run that started and never finished a loop', async () => {
  script = (worker) => worker.post({ phase: 'running' });
  const pending = run('javascript');
  await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ timedOut: true, codeError: TIMEOUT_MESSAGE });
});

it('passes on a compiler that did not download as unavailable', async () => {
  script = (worker) => { worker.post({ phase: 'compiling' }); worker.post({ phase: 'done', results: [], logs: [], codeError: null, check: null, runnerUnavailable: true }); };
  expect(await run('typescript')).toMatchObject({ runnerUnavailable: true, codeError: null });
});

it('loads the runner ahead of the first Run, unless the browser asks to save data', () => {
  script = () => {};
  started = 0;
  warmRunner('typescript')();
  expect(started).toBe(1);
  vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
  warmRunner('typescript')();
  expect(started).toBe(1);
});

// Perf baseline #587 C01: every TypeScript Run started a worker that loaded
// and evaluated the 4 MB compiler again. One compiler worker now stays loaded
// and only checks and transpiles; the learner's code still runs in a fresh
// worker per Run, so no Run sees another's realm.
const typescript: Script = (worker, request) => {
  if (request.warm) { worker.post({ phase: 'warm', ready: true }); return; }
  if (request.compileOnly) {
    worker.post({ phase: 'compiling' });
    worker.post({ phase: 'checking' });
    worker.post({ phase: 'compiled', js: `${request.code};`, check: { codeErrors: [], typeTests: [] } });
    return;
  }
  worker.post({ phase: 'running' });
  worker.post({ phase: 'done', results: [{ pass: true, actual: '1' }], logs: [], codeError: null, check: null });
};
const typed = (signal?: AbortSignal) => runCodeTests({ track: 'typescript', code: 'const f = (): number => 1', tests: [{ call: 'f()', expected: 1 }], typeTests: [], signal });
const settleCompiler = async () => { await vi.advanceTimersByTimeAsync(COMPILER_KEEP_MS + 1); };

it('keeps one compiler between TypeScript Runs and runs each one in a fresh worker', async () => {
  script = typescript;
  workers.length = 0;
  const first = await typed();
  const second = await typed();
  expect(first).toMatchObject({ results: [{ pass: true }], check: { codeErrors: [], typeTests: [] }, codeError: null });
  expect(second).toMatchObject({ results: [{ pass: true }], check: { codeErrors: [], typeTests: [] } });
  const compilers = workers.filter((worker) => worker.requests.some((request) => request.compileOnly));
  expect(compilers).toHaveLength(1);
  expect(compilers[0].requests.map((request) => request.compileOnly)).toEqual([true, true]);
  // The compiler never runs code; each Run's JavaScript runs in a worker of its own.
  const runs = workers.filter((worker) => worker !== compilers[0]);
  expect(runs).toHaveLength(2);
  expect(runs.every((worker) => worker.requests.length === 1 && worker.requests[0].track === 'javascript' && worker.terminated)).toBe(true);
  expect(runs[0].requests[0].code).toBe('const f = (): number => 1;');
  expect(compilers[0].terminated).toBe(false);
  // Nobody holds it: it closes once it has been idle for a while.
  await settleCompiler();
  expect(compilers[0].terminated).toBe(true);
  expect(compilerStarted()).toBe(false);
});

it('drops a compiler whose check ran away, so the next Run starts a fresh one', async () => {
  script = (worker, request) => (request.compileOnly ? (worker.post({ phase: 'compiling' }), worker.post({ phase: 'checking' })) : typescript(worker, request));
  workers.length = 0;
  const pending = typed();
  await vi.advanceTimersByTimeAsync(TYPE_CHECK_TIMEOUT_MS + 1);
  expect(await pending).toMatchObject({ timedOut: true, codeError: TYPE_CHECK_STOPPED_MESSAGE, check: null });
  expect(workers[0].terminated).toBe(true);
  script = typescript;
  expect(await typed()).toMatchObject({ results: [{ pass: true }] });
  expect(workers.filter((worker) => worker.requests.some((request) => request.compileOnly))).toHaveLength(2);
  await settleCompiler();
});

it('waits for another active caller without cancelling its TypeScript check', async () => {
  let finishFirst: (() => void) | undefined;
  script = (worker, request) => {
    if (request.compileOnly && !finishFirst) {
      worker.post({ phase: 'compiling' });
      worker.post({ phase: 'checking' });
      finishFirst = () => worker.post({ phase: 'compiled', js: request.code, check: { codeErrors: [], typeTests: [] } });
      return;
    }
    typescript(worker, request);
  };
  workers.length = 0;
  const first = typed();
  await vi.advanceTimersByTimeAsync(0);
  const second = typed();
  await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS + 1);
  expect(workers[0].terminated).toBe(false);
  expect(workers[0].requests.filter((request) => request.compileOnly)).toHaveLength(1);
  finishFirst?.();
  await vi.advanceTimersByTimeAsync(0);
  expect(await first).toMatchObject({ results: [{ pass: true }] });
  expect(await second).toMatchObject({ results: [{ pass: true }] });
  expect(workers.filter((worker) => worker.requests.some((request) => request.compileOnly))).toHaveLength(1);
  await settleCompiler();
});

it('keeps the compiler a cancelled Run was loading for the next Run', async () => {
  let compile: (() => void) | null = null;
  script = (worker, request) => {
    if (!request.compileOnly || compile) { typescript(worker, request); return; }
    // The first check waits for the compiler's download.
    worker.post({ phase: 'compiling' });
    compile = () => typescript(worker, request);
  };
  workers.length = 0;
  const controller = new AbortController();
  const cancelled = typed(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await cancelled).toMatchObject({ codeError: 'Cancelled', results: [] });
  // The compiler goes on loading; the next Run waits for it, then uses it.
  const next = typed();
  await vi.advanceTimersByTimeAsync(0);
  compile!();
  await vi.advanceTimersByTimeAsync(0);
  expect(workers.filter((worker) => worker.requests.some((request) => request.compileOnly))).toHaveLength(1);
  expect(workers[0].terminated).toBe(false);
  expect(await next).toMatchObject({ results: [{ pass: true }] });
  await settleCompiler();
});

// A Submit's browser preview is cancelled once the server answers. Its check
// went on in the shared compiler, and a runaway one held the next Run for its
// whole 8 s before that Run could start its own.
it('waits a moment for a check a cancelled Run left behind, then drops it and starts afresh', async () => {
  let first = true;
  script = (worker, request) => {
    if (request.compileOnly && first) { first = false; worker.post({ phase: 'compiling' }); worker.post({ phase: 'checking' }); return; }
    typescript(worker, request);
  };
  workers.length = 0;
  const controller = new AbortController();
  const cancelled = typed(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  expect(await cancelled).toMatchObject({ codeError: 'Cancelled' });
  let settled = false;
  const next = typed().then((outcome) => { settled = true; return outcome; });
  await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS - 1);
  expect(settled).toBe(false);
  expect(workers[0].terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  expect(workers[0].terminated).toBe(true);
  expect(await next).toMatchObject({ results: [{ pass: true }] });
  expect(ABANDONED_CHECK_GRACE_MS).toBeLessThan(TYPE_CHECK_TIMEOUT_MS);
  await settleCompiler();
});

// A Run's own worker used to be stopped the moment the Run was cancelled or
// its task left. The shared compiler's check goes on alone, so a runaway one
// is dropped after the same grace, not left to spin for its whole 8 s.
it('drops a check its cancelled Run left behind after the grace, with no next Run waiting', async () => {
  for (const abortWhile of ['checking', 'loading'] as const) {
    let check: (() => void) | null = null;
    script = (worker, request) => {
      if (!request.compileOnly) { typescript(worker, request); return; }
      worker.post({ phase: 'compiling' });
      check = () => worker.post({ phase: 'checking' });
      if (abortWhile === 'checking') check();
    };
    workers.length = 0;
    const controller = new AbortController();
    const cancelled = typed(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await cancelled).toMatchObject({ codeError: 'Cancelled' });
    // A cancelled download goes on: the next Run wants that compiler.
    if (abortWhile === 'loading') {
      await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS * 3);
      expect(workers[0].terminated).toBe(false);
      check!();
    }
    await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS - 1);
    expect(workers[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(workers[0].terminated).toBe(true);
    expect(compilerStarted()).toBe(false);
  }
});

it('keeps the compiler when a cancelled Run\'s check finishes within the grace', async () => {
  let finish: (() => void) | null = null;
  script = (worker, request) => {
    if (!request.compileOnly) { typescript(worker, request); return; }
    worker.post({ phase: 'compiling' });
    worker.post({ phase: 'checking' });
    finish = () => worker.post({ phase: 'compiled', js: `${request.code};`, check: { codeErrors: [], typeTests: [] } });
  };
  workers.length = 0;
  const controller = new AbortController();
  const cancelled = typed(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await cancelled;
  await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS / 2);
  finish!();
  await vi.advanceTimersByTimeAsync(ABANDONED_CHECK_GRACE_MS);
  expect(workers[0].terminated).toBe(false);
  expect(compilerStarted()).toBe(true);
  await settleCompiler();
  expect(workers[0].terminated).toBe(true);
});

it('holds the compiler while a TypeScript task is open, and lets it go after the screen leaves', async () => {
  script = typescript;
  workers.length = 0;
  const release = holdCompiler();
  expect(workers).toHaveLength(1);
  expect(workers[0].requests[0]).toMatchObject({ warm: true, compiler: true, track: 'typescript' });
  await vi.advanceTimersByTimeAsync(COMPILER_KEEP_MS * 3);
  expect(workers[0].terminated).toBe(false);
  // A Run while it is held uses it.
  await typed();
  expect(workers.filter((worker) => worker.requests.some((request) => request.compileOnly))).toEqual([workers[0]]);
  release();
  await vi.advanceTimersByTimeAsync(COMPILER_KEEP_MS - 1);
  expect(workers[0].terminated).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  expect(workers[0].terminated).toBe(true);
  // Asking the browser to save data loads it on the first Run instead.
  const before = workers.length;
  vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } });
  holdCompiler()();
  expect(workers).toHaveLength(before);
});

it('keeps holding the compiler that replaced a dropped one while the task is open', async () => {
  script = (worker, request) => (request.compileOnly && !request.code.includes('ok') ? (worker.post({ phase: 'compiling' }), worker.post({ phase: 'checking' })) : typescript(worker, request));
  workers.length = 0;
  const release = holdCompiler();
  const runaway = typed();
  await vi.advanceTimersByTimeAsync(TYPE_CHECK_TIMEOUT_MS + 1);
  expect(await runaway).toMatchObject({ codeError: TYPE_CHECK_STOPPED_MESSAGE });
  expect(workers[0].terminated).toBe(true);
  await runCodeTests({ track: 'typescript', code: 'const ok = 1', tests: [{ call: 'ok', expected: 1 }] });
  const replacement = workers.find((worker) => worker !== workers[0] && worker.requests.some((request) => request.compileOnly))!;
  await vi.advanceTimersByTimeAsync(COMPILER_KEEP_MS * 2);
  expect(replacement.terminated).toBe(false);
  release();
  await settleCompiler();
  expect(replacement.terminated).toBe(true);
});

it('loads no compiler to warm the runner: that is holdCompiler\'s job', () => {
  script = () => {};
  workers.length = 0;
  warmRunner('typescript')();
  expect(workers).toHaveLength(1);
  expect(workers[0].requests[0]).toMatchObject({ warm: true, track: 'typescript' });
  expect(workers[0].requests[0].compiler).toBeUndefined();
});

// Perf baseline #587 C23: every visit to a task, a return included, started a
// worker only to fetch the runner's script again. Once it has answered, the
// script is in the cache for every track.
it('warms the runner once per page, whichever track asks', async () => {
  workers.length = 0;
  script = (worker) => worker.post({ phase: 'warm', ready: true });
  warmRunner('javascript');
  await vi.advanceTimersByTimeAsync(0);
  expect(workers).toHaveLength(1);
  expect(workers[0].terminated).toBe(true);
  warmRunner('javascript')();
  warmRunner('typescript')();
  expect(workers).toHaveLength(1);
});

// A checker that ran out of stack reported the raw RangeError as the
// learner's code throwing, with the hint for a throw; the server and the
// runner's own clock both call it a stopped type check.
it('names a checker that ran out of stack a stopped type check, as Submit does', async () => {
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal('postMessage', (message: Record<string, unknown>) => { posted.push(message); });
  await import('../src/coding/runner/worker');
  const onmessage = (self as unknown as { onmessage: (event: { data: unknown }) => Promise<void> }).onmessage;
  await onmessage({ data: { track: 'typescript', code: 'type Loop<T> = Loop<[T]>;', calls: ['f()'], expectations: [1], typeTests: [] } });
  expect(posted.map((message) => message.phase)).toEqual(['compiling', 'checking', 'done']);
  expect(posted[posted.length - 1]).toMatchObject({ codeError: TYPE_CHECK_STOPPED_MESSAGE, timedOut: true, check: null, results: [] });
});
