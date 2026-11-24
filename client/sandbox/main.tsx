// The self-hosted React harness. One sandboxed iframe (opaque origin, no
// network) renders the learner's App for the Preview tab and runs the task's
// Testing Library suite for the Results tab. The parent drives it with
// postMessage; every message carries the run token, so a late result from an
// earlier run is ignored by the parent. There is no second client, no hidden
// "done" gate and no listener that outlives its target, which is what made
// the Sandpack-based predecessor hang until a refresh.
import React from 'react';
import * as ReactDOM from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import * as JsxRuntime from 'react/jsx-runtime';
import * as RTL from '@testing-library/react';
import { transform } from 'sucrase';
import { createPreviewLoopCheck, guardPreviewLoops } from './loop-budget';
import { createMiniJest } from '../../shared/coding-mini-jest';
import { asRunnableModule, failUncancelledSubmits, FETCH_STUB_SOURCE } from '../../shared/coding-react-support';
import { LOCAL_FETCH_SOURCE } from '../../shared/coding-fullstack-support';
import { installUtcTime } from '../../shared/coding-utc-time';

interface RunMessage {
  type: 'run';
  token: string;
  files: Record<string, string>;
  preview: boolean;
  tests: boolean;
}

type Outgoing =
  | { type: 'ready' }
  | { type: 'compiled'; token: string }
  | { type: 'compile-error'; token: string; message: string }
  | { type: 'test'; token: string; name: string; status: 'pass' | 'fail'; error: string | null; durationMs: number }
  | { type: 'console'; token: string; level: string; text: string }
  | { type: 'preview-error'; token: string; message: string }
  | { type: 'done'; token: string; passed: number; failed: number; total: number; ran: boolean };

const post = (message: Outgoing) => window.parent.postMessage(message, '*');

// Learner code here reads UTC, as it does in the grader's React guest,
// whatever the learner's own zone. The frame exists only for learner code,
// so its Date is rewritten in place.
installUtcTime(window, { intl: Intl });

// Testing Library wants this while a suite runs; React warns about unwrapped
// updates when it is left on, so the preview render turns it off again.
const actEnvironment = (on: boolean) => {
  (window as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = on;
};
actEnvironment(false);

// Suites and the preview share this fetch stub: the sandbox has no network.
// eslint-disable-next-line no-new-func -- fixtures authored in the repository, not learner input
new Function(FETCH_STUB_SOURCE)();

// Opaque-origin frames intentionally have no real browser storage. Exercises
// get isolated, in-memory Storage objects, never the parent account's storage.
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: key => { values.delete(String(key)); },
    clear: () => values.clear(),
  };
}
for (const name of ['localStorage', 'sessionStorage']) {
  Object.defineProperty(window, name, { value: memoryStorage(), configurable: false });
}

const reportedLoopErrors = new WeakSet<Error>();
let currentToken = '';
let previewRoot: ReactDOMClient.Root | null = null;

const forward = (level: 'log' | 'info' | 'warn' | 'error' | 'debug') => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    if (!currentToken) return;
    const text = args.map((value) => {
      if (typeof value === 'string') return value;
      try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
    }).join(' ');
    post({ type: 'console', token: currentToken, level, text: text.slice(0, 2_000) });
  };
};
(['log', 'info', 'warn', 'error', 'debug'] as const).forEach(forward);

const compile = (source: string): string =>
  transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'automatic', production: true, filePath: 'file.tsx' }).code;

const BUILTINS: Record<string, unknown> = {
  react: React,
  'react-dom': ReactDOM,
  'react-dom/client': ReactDOMClient,
  'react/jsx-runtime': JsxRuntime,
  'react/jsx-dev-runtime': JsxRuntime,
  '@testing-library/react': RTL,
  '@testing-library/jest-dom': {},
};

type Program = ReturnType<typeof guardPreviewLoops>;

function makeRequire(files: Record<string, string>, extra: Record<string, unknown>, programs: Map<string, Program>, checkLoop: () => void) {
  const cache = new Map<string, unknown>();
  const require = (request: string): unknown => {
    if (request in BUILTINS) return BUILTINS[request];
    if (request === './fetchStub' || request === './fetchStub.js') return {};
    const key = request.replace(/^\.\//, '/').replace(/\.(jsx?|tsx?)$/, '');
    const file = key === '/localFetch' ? LOCAL_FETCH_SOURCE : files[`${key}.js`] ?? files[`${key}.jsx`] ?? files[key];
    if (file === undefined) throw new Error(`Cannot find module '${request}'`);
    if (cache.has(key)) return cache.get(key);
    const module = { exports: {} as Record<string, unknown> };
    cache.set(key, module.exports);
    let program = programs.get(key);
    if (!program) {
      const js = compile(file);
      // The task suite and the full-stack fetch fixture belong to the
      // project. Only learner-authored modules need a loop check.
      program = key === '/App.test' || key === '/localFetch' ? { code: js, parameter: '' } : guardPreviewLoops(js);
      programs.set(key, program);
    }
    const names = ['require', 'module', 'exports', ...Object.keys(extra)];
    const values: unknown[] = [require, module, module.exports, ...Object.values(extra)];
    if (program.parameter) {
      names.push(program.parameter);
      values.push(checkLoop);
    }
    // eslint-disable-next-line no-new-func -- the learner's code runs inside this sandboxed, network-less frame
    new Function(...names, program.code)(...values);
    cache.set(key, module.exports);
    return module.exports;
  };
  return require;
}

function unmountPreview() {
  if (previewRoot) {
    try { previewRoot.unmount(); } catch { /* already gone */ }
    previewRoot = null;
  }
  const root = document.getElementById('root');
  if (root) root.innerHTML = '';
}

async function run(message: RunMessage) {
  // Whatever happens below, the parent gets exactly one answer. An unhandled
  // throw here would leave it waiting out its timeout with no verdict, which
  // is the failure mode this harness exists to rule out.
  try {
    await runInner(message);
  } catch (error) {
    if (currentToken !== message.token) return;
    post({ type: 'preview-error', token: message.token, message: `harness: ${String((error as Error)?.message ?? error).split('\n')[0]}` });
    post({ type: 'done', token: message.token, passed: 0, failed: 0, total: 0, ran: false });
  }
}

async function runInner(message: RunMessage) {
  currentToken = message.token;
  unmountPreview();
  RTL.cleanup();
  localStorage.clear();
  sessionStorage.clear();
  const files = message.files;
  if (typeof files['/App.js'] !== 'string') {
    post({ type: 'compile-error', token: message.token, message: 'Missing /App.js' });
    return;
  }

  const programs = new Map<string, Program>();
  const checkLoop = createPreviewLoopCheck(error => {
    reportedLoopErrors.add(error);
    if (currentToken === message.token) post({ type: 'preview-error', token: message.token, message: error.name + ': ' + error.message });
  });
  // Keep the compiled App for both local Run and Preview.
  try {
    programs.set('/App', guardPreviewLoops(compile(asRunnableModule(files['/App.js']))));
  } catch (error) {
    post({ type: 'compile-error', token: message.token, message: String((error as Error)?.message ?? error).split('\n')[0] });
    post({ type: 'done', token: message.token, passed: 0, failed: 0, total: 0, ran: false });
    return;
  }
  post({ type: 'compiled', token: message.token });

  let passed = 0;
  let failed = 0;
  let total = 0;
  if (message.tests && typeof files['/App.test.js'] === 'string') {
    actEnvironment(true);
    const jest = createMiniJest();
    try {
      makeRequire(files, jest.globals, programs, checkLoop)('./App.test.js');
    } catch (error) {
      post({ type: 'test', token: message.token, name: 'suite', status: 'fail', error: `compiling suite: ${String((error as Error)?.message ?? error).split('\n')[0]}`, durationMs: 0 });
      failed = 1;
      total = 1;
    }
    if (total === 0) {
      // Same rule as the grader's React runner: a form the
      // component lets submit fails its case instead of reloading this frame.
      const stopWatchingSubmits = failUncancelledSubmits(jest.globals, window);
      const outcome = await jest.run({ afterEach: () => RTL.cleanup(), timeoutMs: 5_000 }).finally(stopWatchingSubmits);
      for (const one of outcome.cases) {
        post({ type: 'test', token: message.token, name: one.name, status: one.status, error: one.error, durationMs: one.durationMs });
      }
      passed = outcome.passed;
      failed = outcome.failed;
      total = outcome.total;
      if (total === 0) {
        post({ type: 'test', token: message.token, name: 'suite', status: 'fail', error: 'The suite registered no test cases', durationMs: 0 });
        failed = 1;
        total = 1;
      }
    }
    RTL.cleanup();
    actEnvironment(false);
  }
  if (currentToken !== message.token) return;

  if (message.preview) {
    try {
      const app = makeRequire(files, {}, programs, checkLoop)('./App') as { default?: React.ComponentType };
      const App = app.default;
      if (typeof App !== 'function') throw new Error('App.js has no default export');
      const container = document.getElementById('root')!;
      previewRoot = ReactDOMClient.createRoot(container);
      previewRoot.render(React.createElement(App));
    } catch (error) {
      if (!(error instanceof Error && reportedLoopErrors.has(error))) {
        post({ type: 'preview-error', token: message.token, message: String((error as Error)?.message ?? error).split('\n')[0] });
      }
    }
  }
  post({ type: 'done', token: message.token, passed, failed, total, ran: message.tests });
}

window.addEventListener('message', (event: MessageEvent<RunMessage>) => {
  if (event.source !== window.parent) return;
  const data = event.data;
  if (!data || data.type !== 'run' || typeof data.token !== 'string' || !data.files) return;
  void run(data);
});

window.addEventListener('error', (event) => {
  // A previously replaced preview may still have a pending callback. The
  // guard reported under its original token; never relabel it as the new run.
  if (event.error instanceof Error && reportedLoopErrors.has(event.error)) return;
  if (currentToken) post({ type: 'preview-error', token: currentToken, message: String(event.message).slice(0, 500) });
});

post({ type: 'ready' });
