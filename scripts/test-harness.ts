// Drives the self-hosted React harness (client/sandbox) in a real browser and
// asserts the postMessage protocol the workbench depends on.
//
// This is the check the Sandpack predecessor never had. Its "Submit hangs
// until a page refresh" defect lived exactly here: a results listener that
// outlived its client, so tests ran and the verdict never came back. Every
// assertion below is one of the guarantees that makes that class of bug
// impossible — one `ready`, one `done` per run, tokens that make a late
// message from an earlier run identifiable, and an opaque origin.
//
// Run:   npm run test:harness           (needs an existing client build)
// Env:   CHROME_BIN=/path/to/chromium   when Chromium is not on a usual path
//
// Exits 0 with a notice when no Chromium is available, so it can sit in a
// pipeline that does not always provide a browser.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import { CODING_TASKS } from '../lib/coding/catalog';
import { solutionFor } from '../lib/coding/solutions/index';

// The npm script bundles this file into node_modules/.cache, so the module's
// own path says nothing useful; npm always runs it from the package root.
const DIST = path.join(process.cwd(), 'client', 'dist');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

function resolveChrome(): string | null {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  return CHROME_CANDIDATES.find((one) => existsSync(one)) ?? null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * The page that drives the frame. It stands in for the workbench: same iframe
 * attributes, same message plumbing, plus a log the test can read back.
 */
const DRIVER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>harness driver</title></head>
<body>
<script>
  window.__log = [];
  window.__origins = [];
  try { localStorage.setItem('driver-secret', 'parent-only'); } catch (e) {}
  var frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-forms');
  frame.src = '/sandbox/index.html';
  frame.style.width = '480px';
  frame.style.height = '320px';
  document.body.appendChild(frame);
  window.__frame = frame;
  window.addEventListener('message', function (event) {
    if (event.source !== frame.contentWindow) return;
    window.__origins.push(String(event.origin));
    window.__log.push(event.data);
  });
  window.__send = function (message) {
    frame.contentWindow.postMessage(message, '*');
  };
  window.__reset = function () { window.__log = []; window.__origins = []; };
  // The parent must not be able to reach into an opaque-origin frame.
  window.__reachesFrame = function () {
    try { return frame.contentDocument !== null; } catch (e) { return false; }
  };
</script>
</body></html>`;

interface Rpc {
  (method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function rpc(ws: WebSocket): Rpc {
  let id = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: Record<string, unknown> };
    if (typeof message.id !== 'number') return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result ?? {});
  });
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const reqId = id++;
      pending.set(reqId, { resolve, reject });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
}

async function evaluate<T>(call: Rpc, expression: string): Promise<T> {
  const { result, exceptionDetails } = (await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result: { value: T }; exceptionDetails?: { text: string } };
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 25_000): Promise<T> {
  const started = Date.now();
  let last: T | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${label}; last value: ${JSON.stringify(last)?.slice(0, 2000)}`);
}

interface Message { type: string; token?: string; [key: string]: unknown }

const problems: string[] = [];
let checks = 0;
function check(condition: boolean, description: string): void {
  checks++;
  if (!condition) problems.push(description);
}

/** The fixture: a real React task and its reference solution. */
function fixtureTask() {
  const task = CODING_TASKS.find((one) => one.track === 'react' && one.suite && solutionFor(one.id)?.solution);
  if (!task) throw new Error('No React task with a suite and a solution in the catalogue');
  return { task, solution: solutionFor(task.id)!.solution };
}

async function main(): Promise<void> {
  const chrome = resolveChrome();
  if (!chrome) {
    console.log('Harness check skipped: no Chrome/Chromium found. Set CHROME_BIN to run it.');
    return;
  }
  if (!existsSync(path.join(DIST, 'sandbox', 'index.html'))) {
    console.error('Harness check needs a client build: run `npm run build` first.');
    process.exit(1);
  }
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('The harness check needs Node.js 22 or newer (the version declared in package.json).');
  }

  const { task, solution } = fixtureTask();
  const suite = task.suite as string;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/__driver.html') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(DRIVER);
      return;
    }
    // Serve the build, and nothing above it.
    const target = path.join(DIST, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(DIST) || !existsSync(target) || target.endsWith(path.sep)) {
      res.writeHead(404).end('not found');
      return;
    }
    // Mirror the production header for /sandbox/*: the sandbox document has an
    // opaque origin, so its `crossorigin` module script is a CORS request that
    // only loads when the asset answers with Access-Control-Allow-Origin.
    const headers: Record<string, string> = {
      'content-type': MIME[path.extname(target)] ?? 'application/octet-stream',
    };
    if (url.pathname.startsWith('/sandbox/')) {
      headers['access-control-allow-origin'] = '*';
    }
    res.writeHead(200, headers);
    res.end(readFileSync(target));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  const userData = mkdtempSync(path.join(tmpdir(), 'shark-harness-profile-'));
  const debugPort = 9600 + (process.pid % 300);
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userData}`,
    'about:blank',
  ];
  if (platform() === 'linux') args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const browser = spawn(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { browser.kill('SIGTERM'); } catch { /* gone */ }
    try { server.close(); } catch { /* gone */ }
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* gone */ }
  };
  process.on('exit', cleanup);

  try {
    const tab = await waitFor(
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${debugPort}/json`);
          const tabs = (await res.json()) as { type: string; webSocketDebuggerUrl: string }[];
          return tabs.find((one) => one.type === 'page') ?? null;
        } catch {
          return null;
        }
      },
      (value) => value !== null,
      'the browser to expose a page',
    );
    const ws = new globalThis.WebSocket(tab!.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('Cannot reach Chrome DevTools.')), { once: true });
    });
    const call = rpc(ws);
    await call('Page.enable');
    await call('Runtime.enable');

    const log = () => evaluate<Message[]>(call, 'window.__log');
    const reset = () => evaluate<null>(call, 'window.__reset(), null');
    const send = (message: Record<string, unknown>) =>
      evaluate<null>(call, `window.__send(${JSON.stringify(message)}), null`);
    const settled = (token: string) =>
      waitFor(log, (entries) => entries.some((one) => one.type === 'done' && one.token === token), `done for ${token}`);

    await call('Page.navigate', { url: `http://127.0.0.1:${port}/__driver.html` });
    await waitFor(
      async () => (await evaluate<string>(call, 'document.readyState')),
      (value) => value === 'complete',
      'the driver page to load',
    );

    // 1. Exactly one `ready`, and it is the first thing the frame says.
    const afterReady = await waitFor(log, (entries) => entries.some((one) => one.type === 'ready'), 'ready');
    check(afterReady.filter((one) => one.type === 'ready').length === 1, 'the frame announced `ready` more than once');
    check(afterReady[0]?.type === 'ready', '`ready` was not the frame\'s first message');

    // 2. The frame is opaque-origin: its messages carry origin "null" and the
    //    parent cannot reach into its document, so it cannot read parent state.
    const origins = await evaluate<string[]>(call, 'window.__origins');
    check(origins.every((one) => one === 'null'), `frame messages carried a real origin: ${origins.join(', ')}`);
    check((await evaluate<boolean>(call, 'window.__reachesFrame()')) === false, 'the parent can reach into the frame document');

    // 3. A passing run: compiled, one `test` per case, one `done` with the token.
    await reset();
    const passToken = 'tok-pass';
    await send({ type: 'run', token: passToken, files: { '/App.js': solution, '/App.test.js': suite }, preview: true, tests: true });
    const passLog = await settled(passToken);
    if (process.env.HARNESS_DEBUG === '1') console.log('pass-run log:', JSON.stringify(passLog, null, 2));
    const done = passLog.find((one) => one.type === 'done' && one.token === passToken) as
      | { passed: number; failed: number; total: number; ran: boolean }
      | undefined;
    check(passLog.some((one) => one.type === 'compiled' && one.token === passToken), 'no `compiled` before the results');
    check(passLog.every((one) => one.type === 'ready' || one.token === passToken), 'a message carried the wrong token');
    const cases = passLog.filter((one) => one.type === 'test');
    check(cases.length > 0, 'the suite reported no cases');
    check(!!done && done.total === cases.length, `\`done\` counted ${done?.total} cases, the frame reported ${cases.length}`);
    check(!!done && done.failed === 0 && done.passed === cases.length, `the reference solution for ${task.id} did not pass in the browser`);
    check(!!done && done.ran === true, '`done` did not mark the suite as run');
    check(passLog.filter((one) => one.type === 'done').length === 1, 'more than one `done` for a single run');
    check(!passLog.some((one) => one.type === 'preview-error'), 'the reference solution raised a preview error');
    const compiledAt = passLog.findIndex((one) => one.type === 'compiled');
    const firstCaseAt = passLog.findIndex((one) => one.type === 'test');
    check(compiledAt >= 0 && compiledAt < firstCaseAt, 'a result arrived before `compiled`');

    // 4. A wrong solution fails rather than erroring out.
    await reset();
    const failToken = 'tok-fail';
    await send({
      type: 'run',
      token: failToken,
      files: { '/App.js': 'function App() { return <p>nothing here</p>; }', '/App.test.js': suite },
      preview: true,
      tests: true,
    });
    const failLog = await settled(failToken);
    const failDone = failLog.find((one) => one.type === 'done') as { failed: number } | undefined;
    check(!!failDone && failDone.failed > 0, 'an empty component still passed the suite');

    // 5. A syntax error is reported as a compile error, and the run still ends.
    await reset();
    const brokenToken = 'tok-broken';
    await send({ type: 'run', token: brokenToken, files: { '/App.js': 'function App( { return <p>;', '/App.test.js': suite }, preview: true, tests: true });
    const brokenLog = await settled(brokenToken);
    check(brokenLog.some((one) => one.type === 'compile-error' && one.token === brokenToken), 'a syntax error produced no `compile-error`');
    check(!brokenLog.some((one) => one.type === 'test'), 'a file that does not compile still ran cases');

    // 6. A component that throws while rendering reports `preview-error`. The
    //    preview renders through createRoot after the frame has said `done`, so
    //    the error lands a moment later (compiled > done > preview-error), and
    //    the app keeps a run current after `done` to receive it
    //    (useReactHarness). Wait for it the same way: reading the log the
    //    instant `done` lands raced the render.
    await reset();
    const throwToken = 'tok-throw';
    await send({
      type: 'run',
      token: throwToken,
      files: { '/App.js': 'function App() { throw new Error("boom from the component"); }' },
      preview: true,
      tests: false,
    });
    await settled(throwToken);
    const throwLog = await waitFor(
      log,
      (entries) => entries.some((one) => one.type === 'preview-error' && one.token === throwToken),
      `preview-error for ${throwToken}`,
      5_000,
    ).catch(() => log());
    check(throwLog.some((one) => one.type === 'preview-error' && one.token === throwToken), 'a component that throws produced no `preview-error`');
    check((throwLog.find((one) => one.type === 'done' && one.token === throwToken) as { ran: boolean } | undefined)?.ran === false, 'a preview-only run reported itself as having run tests');

    // The frame instruments learner modules after compiling JSX. Normal
    // nested loops, labels, continue and an empty loop keep their results.
    await reset();
    const finiteToken = 'tok-finite-loops';
    await send({
      type: 'run', token: finiteToken, preview: false, tests: true,
      files: {
        '/App.js': `function App() {
          let sum = 0;
          rows: for (const row of [[1, 2], [3, 4]]) for (const n of row) {
            if (n % 2 === 0) continue rows;
            sum += n;
          }
          for (let i = 0; i < 2; i++);
          return <output data-testid="total">{sum}</output>;
        }`,
        '/App.test.js': `import React from 'react';
          import {render, screen} from '@testing-library/react';
          import App from './App';
          test('sum stays four', () => { render(<App />); expect(screen.getByTestId('total').textContent).toBe('4'); });
        `,
      },
    });
    const finiteLog = await settled(finiteToken);
    check(finiteLog.some(entry => entry.type === 'done' && entry.passed === 1 && entry.failed === 0), 'finite learner loops changed their result');

    // 7. `fetch` is the stub: the fixture answers, and no request leaves the frame.
    await reset();
    const fetchToken = 'tok-fetch';
    const fetchSuite = `
      import { render, screen, waitFor } from '@testing-library/react';
      import App from './App';
      test('fetch is answered by the stub', async () => {
        render(<App />);
        await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('Leanne Graham'));
      });
    `;
    const fetchApp = `
      function App() {
        const [who, setWho] = useState('...');
        useEffect(() => {
          // A real request would never resolve inside this frame.
          fetch('https://jsonplaceholder.typicode.com/users')
            .then((r) => r.json())
            .then((rows) => setWho(rows[0].name));
        }, []);
        return <p data-testid="who">{who}</p>;
      }
    `;
    await send({ type: 'run', token: fetchToken, files: { '/App.js': fetchApp, '/App.test.js': fetchSuite }, preview: false, tests: true });
    const fetchLog = await settled(fetchToken);
    const fetchDone = fetchLog.find((one) => one.type === 'done') as { passed: number; failed: number } | undefined;
    check(!!fetchDone && fetchDone.failed === 0 && fetchDone.passed === 1, 'the fetch stub did not answer with the fixture data');

    // 8. A second run started while the first is in flight: only the newer
    //    token settles, so the parent can never mistake a stale result for
    //    the current one. This is the Sandpack defect, made impossible.
    await reset();
    const staleToken = 'tok-stale';
    const freshToken = 'tok-fresh';
    const slowSuite = `
      import { render, screen } from '@testing-library/react';
      import App from './App';
      test('slow case', async () => {
        render(<App />);
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(screen.getByTestId('mark').textContent).toBe('ok');
      });
    `;
    const markApp = (mark: string) => `function App() { return <p data-testid="mark">${mark}</p>; }`;
    await send({ type: 'run', token: staleToken, files: { '/App.js': markApp('ok'), '/App.test.js': slowSuite }, preview: true, tests: true });
    await send({ type: 'run', token: freshToken, files: { '/App.js': markApp('ok'), '/App.test.js': slowSuite }, preview: true, tests: true });
    const raced = await settled(freshToken);
    check(!raced.some((one) => one.type === 'done' && one.token === staleToken), 'the superseded run still reported `done`');
    check(raced.some((one) => one.type === 'done' && one.token === freshToken), 'the newer run never reported `done`');
    check(
      raced.filter((one) => one.type === 'done').length === 1,
      'a superseded run and its replacement both settled, so a stale verdict can reach the parent',
    );

    // 9. The frame recovers: a normal run still works after all of that.
    await reset();
    const afterToken = 'tok-after';
    await send({ type: 'run', token: afterToken, files: { '/App.js': solution, '/App.test.js': suite }, preview: true, tests: true });
    const afterLog = await settled(afterToken);
    const afterDone = afterLog.find((one) => one.type === 'done') as { failed: number; passed: number } | undefined;
    check(!!afterDone && afterDone.failed === 0 && afterDone.passed > 0, 'the frame did not recover after a superseded run');

    // Every authored React stage uses the actual browser sandbox, in catalogue
    // order and without reloading the frame between runs. This catches missing
    // browser APIs and leaked state that a jsdom-only content check cannot see.
    for (const candidate of CODING_TASKS.filter(task => task.track === 'react' && task.suite)) {
      await reset();
      const token = `catalog-${candidate.id}`;
      await send({type:'run',token,files:{'/App.js':solutionFor(candidate.id)!.solution,'/App.test.js':candidate.suite},preview:true,tests:true});
      const entries = await settled(token);
      const result = entries.find(entry => entry.type === 'done' && entry.token === token) as {passed:number;failed:number;total:number}|undefined;
      const errors = entries.filter(entry => entry.type === 'compile-error' || entry.type === 'preview-error' || (entry.type === 'test' && entry.status === 'fail'));
      check(Boolean(result && result.total > 0 && result.failed === 0 && errors.length === 0), `${candidate.id}: ${JSON.stringify(errors).slice(0,1500)}`);
    }
  } finally {
    cleanup();
  }

  if (problems.length > 0) {
    console.error(`Harness protocol check failed (${problems.length} of ${checks} assertions):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`Harness protocol check passed: ${checks} assertions against the built sandbox in Chromium.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
