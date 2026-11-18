// Trusted React/jsdom/Testing Library and suites live in a Node page realm.
// Learner modules run in QuickJS/WASM through typed, serialized capabilities
// (react-learner.ts). No learner object can reach the page realm's intrinsics,
// DOM implementation, React internals, tests, matchers or result authority.
//
// This module is used for trusted local reference tests and inside a fresh,
// network-denied microVM only. API handlers call react-isolated.ts; an outage
// never falls back to in-process execution. React/RTL load lazily with the
// development build needed by act. The suite's page keeps UTC and forwards
// unhandled rejections to window, including the private learner Promise kernel.

import { compileFunction, createContext, runInContext, type Context } from 'node:vm';
import { types } from 'node:util';
import { transform } from 'sucrase';
import { failUncancelledSubmits, FETCH_STUB_SOURCE, type FormSubmitTarget } from '../../shared/coding-react-support';
import { createMiniJest, type MiniJestRun } from '../../shared/coding-mini-jest';
import { cutErrorText } from '../../shared/coding-error-text';
import { LOCAL_FETCH_SOURCE } from '../../shared/coding-fullstack-support';
import { UTC_TIME_SOURCE, type UtcTimeOptions } from '../../shared/coding-utc-time';
import { createReactLearner, type ReactLearner } from './react-learner';

/** How long one suite may take before it is called a timeout. */
export const REACT_SUITE_TIMEOUT_MS = 5_000;

type TestingLibrary = typeof import('@testing-library/react');

interface Runtime {
  testing: TestingLibrary;
  /** What a `require` inside the learner's module or the suite resolves to. */
  modules: Record<string, unknown>;
  /** jsdom's window, where unhandled rejections are reported. */
  window: Record<string, unknown>;
}

/** jsdom's browser globals, installed on the host for React and Testing Library. */
const DOM_GLOBALS = [
  'window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'InputEvent',
  'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'AbortController', 'DOMException',
  'MutationObserver', 'SVGElement', 'Text', 'Element', 'CustomEvent', 'FocusEvent',
];

/** Everything the page realm's global object carries besides its own
 * JavaScript built-ins: the jsdom globals above and the web APIs a component
 * may call. Nothing here leads to `process`, `require` or the filesystem. */
const PAGE_GLOBALS = [
  ...DOM_GLOBALS, 'navigator',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'structuredClone',
  'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortSignal', 'atob', 'btoa', 'crypto', 'performance',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob',
];

/** A console that goes nowhere: the result travels on stdout, and nothing a
 * component logs is shown to anyone. */
const SILENT_CONSOLE = `(() => {
  const console = {};
  for (const name of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'timeLog', 'count', 'countReset', 'assert', 'clear']) console[name] = () => {};
  return console;
})()`;

/** The suite hands Testing Library regular expressions and functions made in
 * the page realm, and Testing Library tells a matcher's kind with `instanceof
 * RegExp` and `instanceof Function`, which is false for a value from another
 * realm. So in this process both answer by what the value is, whichever realm
 * made it. Only processes that grade React load this module; the API does
 * not. */
function recognizeOtherRealms() {
  const ordinary = Function.prototype[Symbol.hasInstance];
  const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!;
  const isRegExp = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return false;
    try { source.call(value); return true; } catch { return false; }
  };
  Object.defineProperty(RegExp, Symbol.hasInstance, {
    configurable: true,
    value(this: unknown, value: unknown) { return (this === RegExp && isRegExp(value)) || ordinary.call(this, value); },
  });
  Object.defineProperty(Function, Symbol.hasInstance, {
    configurable: true,
    value(this: unknown, value: unknown) { return (this === Function && typeof value === 'function') || ordinary.call(this, value); },
  });
}

/** A fresh page realm for one run. The global object starts with no
 * prototype, so `this.constructor` inside it finds the realm's own `Object`
 * and never the host's. Its `Date` reads UTC, as the browser frame's does
 * (shared/coding-utc-time.ts), and its `Intl` formats dates in UTC unless
 * the code names another zone. */
function createPageRealm(): Context {
  const page = createContext(Object.create(null), {
    name: 'react-page',
    codeGeneration: { strings: false, wasm: false },
  });
  const host = globalThis as Record<string, unknown>;
  for (const key of PAGE_GLOBALS) {
    if (host[key] !== undefined) Object.defineProperty(page, key, { value: host[key], configurable: true, writable: true });
  }
  Object.defineProperty(page, 'console', { value: runInContext(SILENT_CONSOLE, page), configurable: true, writable: true });
  const utcTime = runInContext(`(${UTC_TIME_SOURCE})`, page) as (date: unknown, options: UtcTimeOptions) => unknown;
  const intl=runInContext('Intl',page);
  const pageDate = utcTime(runInContext('Date', page), { inPlace: true, intl });
  Object.defineProperty(page, 'Date', { value: pageDate, configurable: true, writable: true });
  Object.defineProperty(page, 'Intl', { value: intl, configurable: true, writable: true });
  return page;
}

let runtime: Runtime | null = null;
let runtimeError: string | null = null;

/** Whether a value is a promise of any realm, asked without running its code. */
const isPromise = types.isPromise;

/** A CJS package loaded through `import()` exposes its exports as `default`. */
const cjs = (namespace: unknown): unknown =>
  (namespace as { default?: unknown })?.default ?? namespace;

/**
 * jsdom + a development React + Testing Library, prepared once per warm
 * instance. The globals go on `globalThis` because that is where React and
 * Testing Library look for the document.
 */
async function ensureRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  if (runtimeError) throw new Error(runtimeError);

  const { JSDOM, VirtualConsole } = await import('jsdom');
  // window.console goes nowhere, like the page realm's own console: the
  // verdict travels on stdout, and nothing a component logs is shown to anyone.
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  const win = dom.window as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (win[key] !== undefined) Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  recognizeOtherRealms();

  // The narrow window described at the top of the file: load React, the
  // renderer and Testing Library against the development build, then restore
  // the environment for everything else in the process.
  const previous = process.env.NODE_ENV;
  let modules: Record<string, unknown>;
  try {
    process.env.NODE_ENV = 'development';
    const react = cjs(await import('react')) as { act?: unknown };
    const reactDom = cjs(await import('react-dom'));
    const reactDomClient = cjs(await import('react-dom/client'));
    const jsxRuntime = cjs(await import('react/jsx-runtime'));
    const testing = cjs(await import('@testing-library/react')) as TestingLibrary;
    if (typeof react.act !== 'function') {
      runtimeError = 'React was loaded without `act`, so no Testing Library suite can run';
      throw new Error(runtimeError);
    }
    modules = {
      react,
      'react-dom': reactDom,
      'react-dom/client': reactDomClient,
      'react/jsx-runtime': jsxRuntime,
      'react/jsx-dev-runtime': jsxRuntime,
      '@testing-library/react': testing,
      '@testing-library/jest-dom': {},
    };
    runtime = { testing, modules, window: win };
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  return runtime;
}

/** Loads jsdom, React and Testing Library now rather than on the first
 * suite, so the React guest can lock its realm down (lib/coding/realm-lockdown.ts)
 * after they are in and before any learner code runs. */
export async function prepareReactRuntime(): Promise<void> {
  await ensureRuntime();
}

/**
 * How the runner waits for what a case or a hook returned. A promise, from
 * either realm, is followed with the page realm's own
 * `Promise.prototype.then`, captured before the suite or the component runs,
 * and the value it resolves with is dropped. Awaiting it the ordinary way asks
 * the promise for `then`, and in the page realm the component can replace
 * that: a `then` that settled at once passed every async case, whatever the
 * case went on to check. Any other value is awaited as before; the work it
 * stands for has already run by the time a case returns it, unless it is a
 * thenable such as the one React's `act` returns, whose own `then` is used.
 */
function followInPage(page: Context): (value: unknown) => unknown {
  const pageThen = runInContext('Promise.prototype.then', page) as (this: unknown, ...args: unknown[]) => unknown;
  const apply = Reflect.apply;
  return (value) => {
    if (!isPromise(value)) return value;
    return new Promise<void>((resolve, reject) => {
      try {
        apply(pageThen, value, [() => resolve(), (reason: unknown) => reject(reason)]);
      } catch (error) {
        reject(error);
      }
    });
  };
}

/** The same compile the browser frame performs, so both agree on the syntax. */
const compile = (source: string): string =>
  transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: 'file.tsx' }).code;

/** Evaluates a CommonJS module inside the page realm. `require` is the only
 * way out, and it resolves a fixed list of names. */
function runModule(page: Context, source: string, resolve: (request: string) => unknown, extra: Record<string, unknown> = {}) {
  const module = runInContext('({ exports: {} })', page) as { exports: Record<string, unknown> };
  const names = ['require', 'module', 'exports', ...Object.keys(extra)];
  compileFunction(compile(source), names, { parsingContext: page })(resolve, module, module.exports, ...Object.values(extra));
  return module.exports;
}

// A promise the component leaves rejected with no handler, such as an aborted
// fetch with no catch, only logs a line in the browser. In Node it would end
// the whole process, and the learner would read a runner failure instead of a
// verdict. So while a suite runs, one listener takes those rejections, tells
// the page the way a browser would, and the checks decide. It stays until a
// turn after the last run ends, because a rejection from the last case's
// cleanup is reported after the run returns.
let runsInFlight = 0;
const ignoreRejection = (reason: unknown, promise: unknown) => {
  const page = runtime?.window as { Event?: new (type: string, init: object) => object; dispatchEvent?: (event: object) => boolean } | undefined;
  if (!page?.Event || !page.dispatchEvent) return;
  try {
    const event = new page.Event('unhandledrejection', { cancelable: true });
    Object.defineProperties(event, { reason: { value: reason }, promise: { value: promise } });
    page.dispatchEvent(event);
  } catch {
    // A listener that throws is the suite's problem, never the runner's.
  }
};
function holdRejections(starting: boolean) {
  if (starting) {
    runsInFlight += 1;
    if (!process.listeners('unhandledRejection').includes(ignoreRejection)) process.on('unhandledRejection', ignoreRejection);
    return;
  }
  runsInFlight -= 1;
  setTimeout(() => {
    if (runsInFlight === 0) process.off('unhandledRejection', ignoreRejection);
  }, 0);
}

export interface ReactSuiteOutcome extends MiniJestRun {
  /** Set when the component or the suite could not be compiled or loaded. */
  compileError: string | null;
  /** True when a case ran past the per-case budget. */
  timedOut: boolean;
}

/** Runs `suite` against `appSource` (a component body or a full module). */
export async function runReactSuite(input: { suite: string; appSource: string; compiledApp?: string; compiledFixtures?: Record<string,string> }): Promise<ReactSuiteOutcome> {
  const { testing, modules, window: pageWindow } = await ensureRuntime();
  const jest = createMiniJest();
  const page = createPageRealm();
  const follow = followInPage(page);
  let compileError: string | null = null;
  let appModule: unknown = null;
  let learner: ReactLearner | undefined;
  try {
    const { compileReactLearner } = input.compiledApp ? {compileReactLearner:undefined} : await import('./react-transpile');
    learner = await createReactLearner({
      source: input.compiledApp ?? compileReactLearner!(input.appSource), page, modules,
      fixtures: input.compiledFixtures ?? {'./fetchStub':compileReactLearner!(FETCH_STUB_SOURCE,false),'./localFetch':compileReactLearner!(LOCAL_FETCH_SOURCE,false)},
      makeError:runInContext('(message,name)=>{const error=new Error(message);error.name=name;return error;}',page),
      report: (type,reason) => {
        if(type==='unhandled') ignoreRejection(reason,undefined);
        else if(type==='callback-error') ignoreRejection(reason,undefined);
      },
    });
    appModule=learner.exports;
  } catch(error) {
    compileError=cutErrorText(`compiling App: ${(error as Error).message.split('\n')[0]}`);
    appModule={__esModule:true,default:()=>null};
  }

  const resolve = (request: string): unknown => {
    if (request === './App' || request === './App.js' || request === './App.jsx') {
      if (appModule) return appModule;
      return {default:()=>null};
    }
    if (request === './fetchStub' || request === './fetchStub.js') return runModule(page, FETCH_STUB_SOURCE, resolve);
    if (request === './localFetch') return runModule(page, LOCAL_FETCH_SOURCE, resolve);
    if (request in modules) return modules[request];
    throw new Error(`Cannot find module '${request}'`);
  };
  try {
    runModule(page, input.suite, resolve, jest.globals);
  } catch (error) {
    learner?.dispose();
    return {
      cases: [], passed: 0, failed: 1, total: 1, timedOut: false,
      compileError: cutErrorText(`compiling suite: ${(error as Error).message.split('\n')[0]}`),
    };
  }
  // A form the component lets submit fails its case, as in the browser
  // harness (client/sandbox): in the preview that submission reloads the
  // frame and loses what it showed.
  const stopWatchingSubmits = failUncancelledSubmits(jest.globals, pageWindow as unknown as FormSubmitTarget);
  let run: MiniJestRun;
  holdRejections(true);
  try {
    run = await jest.run({ afterEach: () => testing.cleanup(), timeoutMs: REACT_SUITE_TIMEOUT_MS, follow });
  } finally {
    holdRejections(false);
    stopWatchingSubmits();
    learner?.dispose();
  }
  // A case that threw has an error, even an empty one. Mini-jest reads an
  // empty message as no error, so a component that threw `new Error('')`
  // passed every case that rendered it.
  if (run.cases.some((one) => one.status === 'pass' && one.error !== null)) {
    const cases = run.cases.map((one) => (one.status === 'pass' && one.error !== null
      ? { ...one, status: 'fail' as const, error: one.error || 'threw an error with no message' }
      : one));
    const passed = cases.filter((one) => one.status === 'pass').length;
    run = { cases, passed, failed: cases.length - passed, total: cases.length };
  }
  run = { ...run, cases: run.cases.map((one) => (one.error === null ? one : { ...one, error: cutErrorText(one.error) })) };
  const timedOut = /interrupted/i.test(compileError??'') || run.cases.some((one) => one.status === 'fail' && /timed out|interrupted/i.test(one.error ?? ''));
  if (run.total === 0) {
    return { ...run, failed: 1, total: 1, timedOut, compileError: compileError ?? 'suite registered no test cases' };
  }
  return { ...run, timedOut, compileError };
}
