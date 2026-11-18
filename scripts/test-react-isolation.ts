// The React grader's isolation (Epic F, F11, #640).
//
// Part one always runs. It builds the guest bundle and starts it with the
// flags and environment the API hands the VM (lib/coding/react-guest.ts),
// on this machine, with a local HTTP server standing in for the network.
// The network is open here, so what passes proves what the guest itself
// refuses before the VM's deny-all policy: learner code reaches no network
// or Node name, its fetch refuses without a fixture, and markup that names
// a resource loads nothing and runs no script.
//
// Part two runs probes and reference solutions in the Vercel Sandbox VM. It
// needs REACT_RUNNER_SNAPSHOT_ID and Sandbox credentials; without the
// snapshot id it prints SKIP and the reason.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUEST_ENV, GUEST_NODE_FLAGS, readGuestRun, type GuestInput } from '../lib/coding/react-guest';
import type { ReactSuiteOutcome } from '../lib/coding/react-runner';
import { compileReactLearner } from '../lib/coding/react-transpile';
import { CODING_TASKS } from '../lib/coding/catalog';
import { solutionFor } from '../lib/coding/solutions/index';
import { FETCH_STUB_SOURCE } from '../shared/coding-react-support';
import { LOCAL_FETCH_SOURCE } from '../shared/coding-fullstack-support';

/** Probes that pass the same way on this machine and in the VM. */
const SHARED_PROBES: [name: string, appSource: string, suite: string][] = [
  [
    // Learner code has no `process` at all, so no environment to read.
    'credentials',
    'function App(){ return null; }',
    `test('no application credentials',()=>{ expect(typeof process).toBe('undefined'); expect(typeof globalThis.process).toBe('undefined'); });`,
  ],
  [
    'page realm',
    `export const reach = () => [typeof require === 'function' && (() => { try { require('fs'); return 'fs'; } catch { return 'no fs'; } })(), ...[() => Function('return this')(), () => globalThis.constructor.constructor('return process')(), () => document.createElement.constructor('return process')()].map((run) => { try { run(); return 'reached'; } catch { return 'blocked'; } })];
export default function App(){ return null; }`,
    `import { reach } from './App';
test('nothing leads to Node',()=>{ expect(reach()).toEqual(['no fs','blocked','blocked','blocked']); });`,
  ],
];

const GUEST_BUNDLE = join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs');

/** One run of the real guest bundle, as the VM runs it: the same flags, the
 * same environment and nothing else, an input file it deletes before
 * learner code runs, and the verdict read from its stdout by the API's rules. */
async function runGuest(appSource: string, suite: string): Promise<ReactSuiteOutcome> {
  const dir = mkdtempSync(join(tmpdir(), 'react-isolation-'));
  const input = join(dir, 'input.json');
  const nonce = randomBytes(24).toString('hex');
  const compiledFixtures = { './fetchStub': compileReactLearner(FETCH_STUB_SOURCE, false), './localFetch': compileReactLearner(LOCAL_FETCH_SOURCE, false) };
  writeFileSync(input, JSON.stringify({ suite, appSource, nonce, compiledApp: compileReactLearner(appSource), compiledFixtures } satisfies GuestInput));
  try {
    const guest = spawn(process.execPath, [...GUEST_NODE_FLAGS, GUEST_BUNDLE, input], { cwd: dir, env: { ...GUEST_ENV }, stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    guest.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    const stop = setTimeout(() => guest.kill('SIGKILL'), 20_000);
    const [code, signal] = (await once(guest, 'close')) as [number | null, NodeJS.Signals | null];
    clearTimeout(stop);
    return readGuestRun(code ?? (signal ? 128 + osConstants.signals[signal] : null), stdout, nonce, suite);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function localGuest() {
  execFileSync(process.execPath, ['scripts/build-react-runner.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const hits: string[] = [];
  const server = createServer((request, response) => { hits.push(request.url ?? ''); response.end('loaded'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // A request that reaches the server after the guest has gone still counts.
  const settle = () => new Promise((done) => setTimeout(done, 300));
  try {
    for (const [name, appSource, suite] of SHARED_PROBES) {
      const result = await runGuest(appSource, suite);
      assert.equal(result.passed, 1, `${name}: ${JSON.stringify(result)}`);
      console.log(`PASS local guest ${name}`);
    }

    // Neither the network nor Node, bare or on the window capability. jsdom's
    // window has XMLHttpRequest and WebSocket; the capability shows neither.
    const network = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'navigator', 'require', 'process', 'importScripts', 'WebAssembly'];
    const unreachable = await runGuest(
      `export const kinds = (target, names) => names.map((name) => name + ' ' + typeof target[name]);
export default function App(){ return null; }`,
      `import { kinds } from './App';
const names = ${JSON.stringify(network)};
test('no network or Node name', () => { expect(kinds(globalThis, names)).toEqual(names.map((name) => name + ' undefined')); });
test('none on window either', () => { expect(kinds(window, [...names, 'fetch'])).toEqual([...names, 'fetch'].map((name) => name + ' undefined')); });`,
    );
    assert.deepEqual(unreachable.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(unreachable));
    console.log(`PASS local guest: ${network.join(', ')} are unreachable from learner code`);

    // The learner's fetch is the fixture guard (react-learner.ts). With no
    // fixture installed it refuses, and nothing reaches the server.
    const fetched = await runGuest(
      `export const load = () => fetch('${base}/learner-fetch').then(() => 'fetched', (error) => error.message);
export default function App(){ return null; }`,
      `import { load } from './App';
test('fetch refuses', async () => { expect(await load()).toBe('No training fetch fixture is installed'); });`,
    );
    await settle();
    assert.equal(fetched.passed, 1, JSON.stringify(fetched));
    assert.deepEqual(hits, [], 'the learner\'s fetch reached nothing');
    console.log('PASS local guest: learner fetch refuses without a fixture and reaches nothing');

    // jsdom runs with resource loading and scripts off (react-runner.ts).
    // Markup set through innerHTML or setAttribute, a script element built
    // by hand and a link the component clicks load nothing, and no inline
    // script or handler runs.
    const resources = await runGuest(
      `import React, { useEffect } from 'react';
export default function App() {
  useEffect(() => {
    document.body.innerHTML += '<img src="${base}/img"><link rel="stylesheet" href="${base}/css"><script src="${base}/script"></script><iframe src="${base}/frame"></iframe><video src="${base}/video"></video><audio src="${base}/audio"></audio><object data="${base}/object"></object><embed src="${base}/embed"><img src="${base}/missing" onerror="window.__ran = 1"><script>window.__ran = 2</script>';
    const image = document.createElement('img'); image.setAttribute('src', '${base}/set-attribute'); document.body.appendChild(image);
    const script = document.createElement('script'); script.setAttribute('src', '${base}/script-element'); document.body.appendChild(script);
    const inline = document.createElement('script'); inline.textContent = 'window.__ran = 3'; document.body.appendChild(inline);
    const link = document.createElement('a'); link.setAttribute('href', '${base}/navigate'); document.body.appendChild(link); link.click();
  }, []);
  return <p>markup</p>;
}`,
      `import React from 'react';
import { render } from '@testing-library/react';
import App from './App';
test('nothing loads and nothing runs', async () => { render(<App />); await new Promise((done) => setTimeout(done, 400)); expect(window.__ran).toBe(undefined); });`,
    );
    await settle();
    assert.equal(resources.passed, 1, JSON.stringify(resources));
    assert.deepEqual(hits, [], 'no resource the markup named was requested');
    console.log('PASS local guest: jsdom loads no resource the markup names and runs no inline script or handler');
  } finally {
    server.close();
  }
}

async function sandboxVM() {
  if (!process.env.REACT_RUNNER_SNAPSHOT_ID) {
    console.log('SKIP isolated VM probes: REACT_RUNNER_SNAPSHOT_ID is not set, so no Vercel Sandbox VM can start here (docs/react-grading-operations.md, "Configuration and rollout")');
    return;
  }
  // Loaded only now: the module reads the bundled Sandbox SDK as it loads.
  const { runIsolatedReactSuite } = await import('../lib/coding/react-isolated');
  const probes: [name: string, appSource: string, suite: string][] = [
    ...SHARED_PROBES,
    [
      // The suite's own fetch: only the VM's deny-all policy stops it.
      'network',
      'function App(){ return null; }',
      `test('network denied',async()=>{let connected=false;try{await fetch('https://example.com',{signal:AbortSignal.timeout(700)});connected=true;}catch{}expect(connected).toBe(false);});`,
    ],
  ];
  for (const [name, appSource, suite] of probes) {
    const result = await runIsolatedReactSuite({ appSource, suite });
    assert.equal(result.passed, 1, `${name}: ${JSON.stringify(result)}`);
    console.log(`PASS isolated ${name}`);
  }
  for (const id of [
    'react-evolving-form-2',
    'react-uselocalstorage-hook',
    'react-fullstack-stockroom-6',
  ]) {
    const task = CODING_TASKS.find((task) => task.id === id);
    if (!task?.suite) throw new Error(`Missing fixture ${id}`);
    const appSource = solutionFor(task.id)?.solution;
    if (!appSource) throw new Error(`Missing solution ${id}`);
    const result = await runIsolatedReactSuite({
      appSource,
      suite: task.suite,
    });
    assert.equal(result.failed, 0, `${id}: ${JSON.stringify(result)}`);
    console.log(`PASS isolated ${id}: ${result.passed} tests`);
  }
  // The reported forgery: write the verdict file and exit before the suite
  // runs. The component has no `process`, and the API reads no file.
  const forged = await runIsolatedReactSuite({
    appSource: `process.getBuiltinModule('fs').writeFileSync('/vercel/sandbox/result.json', JSON.stringify({ cases: [{ name: 'ok', status: 'pass', error: null, durationMs: 0 }], passed: 1, failed: 0, total: 1, compileError: null, timedOut: false })); process.exit(0); export default function App(){ return null }`,
    suite: `import App from './App'; \ntest('renders nothing yet', () => { expect(typeof App).toBe('function'); });`,
  });
  assert.equal(forged.passed, 0, JSON.stringify(forged));
  assert.match(forged.compileError ?? '', /'?process'? is not defined/);
  console.log('PASS a forged result.json and early exit are not a verdict');
  const stuck = await runIsolatedReactSuite({
    appSource: 'while(true){}; export default function App(){return null}',
    suite: `import App from './App'; test('render',()=>{expect(App).toBeTruthy()});`,
  });
  assert.equal(stuck.timedOut, true, JSON.stringify(stuck));
  console.log(
    'PASS synchronous infinite loop terminates outside the API process',
  );
}

async function main() {
  await localGuest();
  await sandboxVM();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
