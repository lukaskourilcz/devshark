import type { TaskRuntimePolicy } from '../../../../shared/coding-task-runtime';
// The coding runner worker. Learner code runs here, off the main thread, so a
// hung loop is terminated by the caller instead of freezing the page. The
// worker is served from its own path with a policy that allows `new Function`
// (see vercel.json); the page itself keeps its strict policy.
//
// Each worker serves one run. Just before the learner's code runs, its realm
// becomes the grader's (shared/coding-run-realm.ts): UTC, the grader's
// locale methods, and none of the globals the grader lacks, so Run
// and Submit agree.
//
// One worker per task screen only compiles (`compileOnly`): it keeps the
// TypeScript compiler loaded across Runs and never runs the learner's code,
// so its realm stays the browser's (run-tests.ts, perf baseline #587 C01).
import { evaluateCalls, TYPE_CHECK_STOPPED_MESSAGE } from '../../../../shared/coding-evaluate';
import { cutRunDisplay } from './display-result';
import { prepareRunRealm } from '../../../../shared/coding-run-realm';
import type { TypeTestInput } from '../../../../shared/coding-ts-check';

// Taken now: the run removes `self` and `postMessage` from this realm.
const post = self.postMessage.bind(self) as (message: unknown) => void;

export interface RunnerRequest {
  runtimePolicy?: TaskRuntimePolicy;
  track: 'javascript' | 'typescript';
  code: string;
  calls: string[];
  expectations: unknown[] | null;
  typeTests?: TypeTestInput[];
  /** Only load what a run would need (see warmRunner), then say so. With
   * `compiler`, a TypeScript worker also loads the compiler. */
  warm?: boolean;
  compiler?: boolean;
  /** Type-check and transpile only, and answer `compiled` with the
   * JavaScript; never run it (the compiler worker in run-tests.ts). */
  compileOnly?: boolean;
}

self.onmessage = async (event: MessageEvent<RunnerRequest>) => {
  const request = event.data;
  if (request.warm) {
    // `ready` false: the compiler did not load, and this worker's module map
    // keeps the failure, so the caller starts another.
    const ready = request.track === 'typescript' && request.compiler ? Boolean(await import('./ts-compiler').catch(() => null)) : true;
    self.postMessage({ phase: 'warm', ready });
    return;
  }
  try {
    if (request.track === 'typescript') {
      self.postMessage({ phase: 'compiling' });
      // A compiler that does not download is the connection's problem, and
      // the caller says so instead of reporting it as the learner's error.
      const compiler = await import('./ts-compiler').catch(() => null);
      if (!compiler) {
        self.postMessage({ phase: 'done', results: [], logs: [], codeError: null, check: null, runnerUnavailable: true });
        return;
      }
      // The compiler and its libs are loaded: from here the clock is the
      // learner's types, and a runaway one is stopped as such.
      self.postMessage({ phase: 'checking' });
      const compiled = compiler.compileTypeScript(request.code, request.typeTests ?? []);
      // A checker that ran out of stack was stopped by the types, as one that
      // ran out of time is: the same words the clock and Submit use. As a raw
      // RangeError it read as the learner's code throwing, with that hint.
      if (!compiled.check) {
        post({ phase: 'done', results: [], logs: [], codeError: TYPE_CHECK_STOPPED_MESSAGE, check: null, timedOut: true });
        return;
      }
      // Nothing to run, but the types were checked: keep them on screen.
      if (compiled.js === null) {
        post({ phase: 'done', ...cutRunDisplay({ results: [], logs: [], codeError: compiled.transpileError }), check: compiled.check });
        return;
      }
      // The caller runs the JavaScript in a fresh worker of its own.
      if (request.compileOnly) {
        post({ phase: 'compiled', js: compiled.js, check: compiled.check });
        return;
      }
      self.postMessage({ phase: 'running' });
      const hidden = prepareRunRealm(self, request.runtimePolicy);
      const run = await evaluateCalls({ code: compiled.js, calls: request.calls, expectations: request.expectations, hidden });
      post({ phase: 'done', ...cutRunDisplay(run), check: compiled.check });
      return;
    }
    self.postMessage({ phase: 'running' });
    const hidden = prepareRunRealm(self, request.runtimePolicy);
    const run = await evaluateCalls({ code: request.code, calls: request.calls, expectations: request.expectations, hidden });
    post({ phase: 'done', ...cutRunDisplay(run), check: null });
  } catch (error) {
    post({ phase: 'done', ...cutRunDisplay({ results: [], logs: [], codeError: String((error as Error)?.message ?? error) }), check: null });
  }
};
