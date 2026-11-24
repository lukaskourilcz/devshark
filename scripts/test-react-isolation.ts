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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mock } from 'node:test';
import type { VercelRequest, VercelResponse } from '../lib/vercel-types';
import { constants as osConstants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUEST_ENV, GUEST_NODE_FLAGS, readGuestRun, type GuestInput } from '../lib/coding/react-guest';
import type { ReactSuiteOutcome } from '../lib/coding/react-runner';
import { compileReactLearner } from '../lib/coding/react-transpile';
import { REACT_COMPILE_WORKER_FILE } from '../lib/coding/react-compile-pool';
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

// These probes run in the existing bounded guest child. A broken re-entry
// deadline can hang or exhaust that child, so it must not run in this process.
async function learnerDeadlineContracts() {
  const failures: Error[] = [];
  const probe = async (name: string, check: () => Promise<void>) => {
    try { await check(); console.log(`PASS local guest ${name}`); }
    catch (error) { console.error(`FAIL local guest ${name}`, error); failures.push(error instanceof Error ? error : new Error(String(error))); }
  };
  const renders = `import React from 'react';import {render} from '@testing-library/react';import App from './App';test('render completes or reports its learner interrupt',()=>{const {container}=render(<App/>);expect(container.textContent).toBe('Done');});`;
  const loops = [
    ['React.Children callback', `for(;;) React.Children.forEach([1],()=>{});`],
    ['click listener', `const button=document.createElement('button');button.addEventListener('click',()=>{});for(;;) button.click();`],
  ] as const;

  await probe('F11-11 finite module and render callbacks remain usable', async () => {
    const result = await runGuest(
      `import React from 'react';let count=0;const button=document.createElement('button');button.addEventListener('click',()=>{count++;});button.click();React.Children.forEach([1,2],()=>{count++;});export const read=()=>count;export default function App(){React.Children.forEach([1],()=>{});return <p>Done</p>;}`,
      `import React from 'react';import {render} from '@testing-library/react';import App,{read} from './App';test('finite nested callbacks',()=>{const {container}=render(<App/>);expect(container.textContent).toBe('Done');expect(read()).toBe(3);});test('a later ordinary entry still works',()=>{expect(read()).toBe(3);});`,
    );
    assert.equal(result.compileError, null, JSON.stringify(result));
    assert.equal(result.timedOut, false, JSON.stringify(result));
    assert.deepEqual(result.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(result));
  });

  for (const [name, loop] of loops) {
    await probe(`F11-11 render re-entry: ${name}`, async () => {
      const result = await runGuest(`import React from 'react';export default function App(){${loop}return null;}`, renders);
      console.log(`OBS F11-11 render re-entry ${name}`, JSON.stringify(result));
      assert.equal(result.compileError, null, JSON.stringify(result));
      assert.equal(result.timedOut, true, JSON.stringify(result));
      assert.equal(result.total, 1, JSON.stringify(result));
      assert.equal(result.cases[0]?.status, 'fail', JSON.stringify(result));
      assert.match(result.cases[0]?.error ?? '', /interrupted/, JSON.stringify(result));
      assert.ok(result.cases[0].durationMs < 4000, `${name}: ${JSON.stringify(result)}`);
    });
    await probe(`F11-11 module re-entry: ${name}`, async () => {
      const started = Date.now();
      const result = await runGuest(
        `import React from 'react';${loop}\nexport default function App(){return null;}`,
        `test('the authored suite still reports after the module fails',()=>{expect(1).toBe(1);});`,
      );
      const elapsed = Date.now() - started;
      console.log(`OBS F11-11 module re-entry ${name}`, JSON.stringify({elapsedMs: elapsed, result}));
      assert.equal(result.timedOut, true, JSON.stringify(result));
      assert.match(result.compileError ?? '', /interrupted/, JSON.stringify(result));
      assert.deepEqual(result.cases.map((one) => one.status), ['pass'], JSON.stringify(result));
      // Module loading has no case duration; this includes guest startup and
      // compilation, in addition to the unchanged 2.5 s learner budget.
      assert.ok(elapsed < 5000, `${name}: ${elapsed} ms including guest startup: ${JSON.stringify(result)}`);
    });
  }

  await probe('F11-14 module interrupt survives an authored suite setup error', async () => {
    const result = await runGuest(
      `while(true){};export default function App(){return null;}`,
      `throw new Error('authored suite setup failed');`,
    );
    console.log('OBS F11-14 module interrupt and suite setup error', JSON.stringify(result));
    assert.match(result.compileError ?? '', /compiling suite: authored suite setup failed/, JSON.stringify(result));
    assert.equal(result.timedOut, true, JSON.stringify(result));
    assert.deepEqual(result.cases, [], JSON.stringify(result));
    assert.equal(result.failed, 1, JSON.stringify(result));
  });

  await probe('F11-12/F11-14 one real interrupt stops retries and later entries', async () => {
    const result = await runGuest(
      `import React from 'react';export function spin(){while(true){}}export default function App(){spin();return null;}`,
      `import React from 'react';import {render} from '@testing-library/react';import App,{spin} from './App';test('busy render',()=>{render(<App/>);});test('later learner call',()=>{spin();});test('later authored case',()=>{expect(2+2).toBe(4);});`,
    );
    console.log('OBS F11-12/F11-14 busy render and later entries', JSON.stringify(result));
    assert.equal(result.compileError, null, JSON.stringify(result));
    assert.equal(result.timedOut, true, JSON.stringify(result));
    assert.deepEqual(result.cases.map((one) => one.name), ['busy render', 'later learner call', 'later authored case'], JSON.stringify(result));
    assert.deepEqual(result.cases.map((one) => one.status), ['fail', 'fail', 'pass'], JSON.stringify(result));
    for (const one of result.cases.slice(0, 2)) assert.match(one.error ?? '', /interrupted/, JSON.stringify(result));
    assert.ok(result.cases[0].durationMs < 4000, JSON.stringify(result));
    assert.ok(result.cases[1].durationMs < 500, JSON.stringify(result));
  });
  if (failures.length) throw new AggregateError(failures, 'F11-11/12/14 learner deadline controls failed');
}

async function localGuest() {
  execFileSync(process.execPath, ['scripts/build-react-runner.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
  await learnerDeadlineContracts();
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(request.url ?? '');
    if (request.url === '/trusted-xhr-negative') { request.socket.destroy(); return; }
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end('loaded');
  });
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

    const trustedPage = await runGuest(
      'export default function App(){return null;}',
      `test('trusted page has no native fetch',()=>{expect(typeof globalThis.fetch).toBe('undefined');expect(typeof window.fetch).toBe('undefined');});
test('web data APIs remain available',()=>{for(const name of ['Headers','Request','Response','FormData','Blob'])expect(typeof globalThis[name]).toBe('function');});`,
    );
    assert.equal(trustedPage.compileError, null);
    assert.deepEqual(trustedPage.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(trustedPage));
    console.log('PASS local guest: no trusted Node fetch; web data APIs remain');

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

    const fixture = await runGuest(
      `export const load = url => fetch(url).then(response=>response.json());export default function App(){return null;}`,
      `import {load} from './App';
test('the authored fetch fixture and suite overrides still delegate',async()=>{
  const before=globalThis.fetch;expect(typeof before).toBe('undefined');
  require('./fetchStub');const fixture=globalThis.fetch;expect(typeof fixture).toBe('function');
  try{
    expect((await load('/api/users/1')).name).toBe('Leanne Graham');
    globalThis.fetch=()=>Promise.resolve({json:()=>Promise.resolve({name:'suite override'})});
    expect((await load('/api/users/1')).name).toBe('suite override');
    globalThis.fetch=fixture;expect((await load('/api/users/1')).name).toBe('Leanne Graham');
  }finally{globalThis.fetch=before;}
  expect(typeof globalThis.fetch).toBe('undefined');
});`,
    );
    assert.equal(fixture.compileError, null);
    assert.equal(fixture.failed, 0, JSON.stringify(fixture));
    assert.equal(fixture.passed, 1);
    assert.deepEqual(hits, [], 'trusted deterministic fixtures made no network request');
    console.log('PASS local guest: authored fixture delegation, override and restoration remain');

    // A real local success and socket refusal prove this probe uses jsdom's
    // actual XHR transport rather than passing because fetch disappeared.
    const xhr = await runGuest(
      'export default function App(){return null;}',
      `const request=url=>new Promise((resolve,reject)=>{
  const xhr=new window.XMLHttpRequest();xhr.open('GET',url);xhr.timeout=700;
  xhr.onload=()=>resolve({event:'load',status:xhr.status,text:xhr.responseText});
  xhr.onerror=()=>resolve({event:'error',status:xhr.status});
  xhr.ontimeout=()=>reject(new Error('local XHR control timed out'));xhr.send();
});
test('actual XHR reaches a CORS-enabled local server',async()=>{expect(typeof fetch).toBe('undefined');const result=await request('${base}/trusted-xhr-positive');expect(result.event).toBe('load');expect(result.status).toBe(200);expect(result.text).toBe('loaded');});
test('actual XHR reports a server socket refusal',async()=>{const result=await request('${base}/trusted-xhr-negative');expect(result.event).toBe('error');expect(result.status).toBe(0);});`,
    );
    assert.equal(xhr.compileError, null);
    assert.deepEqual(xhr.cases.map((one) => one.status), ['pass', 'pass'], JSON.stringify(xhr));
    await settle();
    assert.deepEqual(hits, ['/trusted-xhr-positive', '/trusted-xhr-negative'], 'both real XHR controls reached the local transport');
    console.log('PASS local guest: jsdom XHR positive and transport-refusal controls exercise actual requests');

    // This authored suite saves/calls/restores its current withFetch fixture.
    // Keep its real reference and incomplete starter as opposite controls.
    const task = CODING_TASKS.find((one) => one.id === 'react-mh-wait-for-export');
    const reference = task && solutionFor(task.id)?.solution;
    assert.ok(task?.suite && reference, 'the authored fetch control exists');
    const authored = await runGuest(reference, task.suite);
    assert.equal(authored.compileError, null);
    assert.equal(authored.failed, 0, JSON.stringify(authored));
    assert.ok(authored.passed > 0);
    const incomplete = await runGuest(task.starter, task.suite);
    assert.equal(incomplete.compileError, null);
    assert.ok(incomplete.failed > 0, 'removing native fetch does not make the authored suite pass an incomplete starter');
    console.log('PASS local guest: authored withFetch reference passes and incomplete starter fails');

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
      // Credentialed VM-only acceptance: make a real jsdom XHR send with
      // deny-all unchanged. A cross-origin failure alone can also be CORS;
      // record this as a bounded refusal probe, not a complete policy proof.
      // The local positive/negative transport controls above are separate.
      'network',
      'function App(){ return null; }',
      `test('network denied',async()=>{
expect(typeof fetch).toBe('undefined');expect(typeof window.XMLHttpRequest).toBe('function');
let sent=false;const result=await new Promise(resolve=>{
 const xhr=new window.XMLHttpRequest();xhr.open('GET','https://example.com/');xhr.timeout=700;
 xhr.onload=()=>resolve({event:'load',status:xhr.status});xhr.onerror=()=>resolve({event:'error',status:xhr.status});xhr.ontimeout=()=>resolve({event:'timeout',status:xhr.status});
 xhr.send();sent=true;
});expect(sent).toBe(true);expect(['error','timeout']).toContain(result.event);expect(result.status).toBe(0);
});`,
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


// F11-19: fresh processes keep these controls independent of the instance's
// verified-artifact cache. Each cwd contains its own fake Sandbox SDK; none
// of these cases can call the real SDK or start a VM.
const ARTIFACT_FIXTURE = Buffer.from('local runner copy-integrity fixture\n');
const artifactDigest = (bytes: Buffer) => JSON.stringify(createHash('sha256').update(bytes).digest('hex')) + '\n';
const artifactPath = () => join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs');
const sidecarPath = () => join(process.cwd(), 'lib/coding/generated/react-sandbox.sha256.cjs');

type ArtifactFixtureState = {
  creates: number;
  uploads: Buffer[];
  createError?: () => unknown;
  stop?: () => Promise<void>;
  command?: (nonce: string) => { exitCode: number; stdout: () => Promise<string> };
};
async function artifactProbe(name: string) {
  const { runIsolatedReactSuite } = await import('../lib/coding/react-isolated');
  const state = (globalThis as unknown as { __reactArtifactFixture: ArtifactFixtureState }).__reactArtifactFixture;
  assert.ok(state, 'the fresh process loaded only the fabricated local SDK');
  const input = { appSource: 'export default function App(){ return null; }', suite: "test('fixture',()=>{});" };
  if (name === 'vm-admission') {
    const completedStops: Array<() => void> = [];
    let ready: () => void = () => {};
    const waitingForThree = new Promise<void>(resolve => { ready = resolve; });
    state.stop = () => new Promise<void>(resolve => {
      completedStops.push(resolve);
      if (completedStops.length === 3) ready();
    });
    const admitted = Array.from({ length: 3 }, () => runIsolatedReactSuite(input));
    await waitingForThree;
    const busy = { name: 'GraderBusyError', reason: 'react_vm_queue_full' };
    await assert.rejects(runIsolatedReactSuite(input), busy);
    assert.equal(state.creates, 3, 'a fourth caller starts no VM while three stops are pending');
    completedStops.shift()!();
    await Promise.race(admitted);
    state.stop = async () => {};
    await runIsolatedReactSuite(input);
    for (const finish of completedStops) finish();
    await Promise.all(admitted);
    assert.equal(state.creates, 4);
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      state.stop = async () => { throw new Error('disconnected fixture'); };
      for (let i = 0; i < 3; i++) await runIsolatedReactSuite(input);
      await assert.rejects(runIsolatedReactSuite(input), busy);
      mock.timers.tick(25_000);
      state.stop = async () => {};
      await runIsolatedReactSuite(input);
      assert.equal(state.creates, 8);
    } finally { mock.timers.reset(); }
    console.log('PASS vm-admission control completed');
    return;
  }
  if (name === 'startup-cause') {
    // Only a cause's class name or HTTP status reaches the error name that is
    // logged; its message, which may carry provider text, never does. A failed
    // create holds its admission until the VM would have expired, so this
    // control stays within the instance's three admissions.
    const cases: Array<[() => unknown, string]> = [
      [() => Object.assign(new Error('secret provider text'), { response: { status: 404 } }), 'ReactRunnerStartupHttp404'],
      [() => Object.assign(new Error('secret provider text'), { name: 'VercelOidcTokenError' }), 'ReactRunnerStartupVercelOidcTokenError'],
      [() => Object.assign(new Error('secret provider text'), { name: 'not a class name' }), 'ReactRunnerStartup'],
    ];
    for (const [createError, expected] of cases) {
      state.createError = createError;
      await assert.rejects(runIsolatedReactSuite(input), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, expected);
        assert.doesNotMatch(`${error.name} ${error.message}`, /secret provider text/);
        return true;
      });
    }
    console.log('PASS startup-cause control completed');
    process.exit(0);
  }
  if (name === 'snapshot-versions') {
    const { withRequestContext } = await import('../lib/http');
    const warnings: string[] = [];
    const warn = mock.method(console, 'warn', (line: string) => { warnings.push(line); });
    const verdict = {
      cases: [{ name: 'fixture', status: 'pass', error: null, durationMs: 0 }],
      passed: 1, failed: 0, total: 1, compileError: null, timedOut: false,
    };
    try {
      for (const stale of [false, true]) {
        const requestId = stale ? 'fixture-older-react' : 'fixture-current-react';
        state.command = nonce => ({
          exitCode: 0,
          stdout: async () => {
            const versions = stale ? `\n${nonce}:versions {"react":"19.2.4/19.2.3"}\n` : '';
            return versions + `\n${nonce} ${JSON.stringify(verdict)}\n`;
          },
        });
        const req: VercelRequest = { headers: { 'x-request-id': requestId }, method: 'POST', query: {}, socket: {} };
        const headers = new Headers();
        const unexpectedResponse = (): never => assert.fail('successful snapshot grading wrote an HTTP response');
        const res: VercelResponse = {
          setHeader(name, value) { headers.set(name, String(value)); return this; },
          status: unexpectedResponse, json: unexpectedResponse, send: unexpectedResponse,
          end: unexpectedResponse, redirect: unexpectedResponse,
        };
        const result = await withRequestContext(req, res, () => runIsolatedReactSuite(input));
        assert.equal(headers.get('x-request-id'), requestId);
        assert.deepEqual(result, verdict);
        assert.equal(warnings.length, stale ? 1 : 0);
      }
      const { ts, ...record } = JSON.parse(warnings[0]);
      assert.equal(typeof ts, 'string');
      assert.deepEqual(record, {
        route: 'coding/react', level: 'warn', request_id: 'fixture-older-react',
        kind: 'snapshot_version_drift', versions: { react: '19.2.4/19.2.3' },
      });
    } finally {
      warn.mock.restore();
    }
    return;
  }
  if (name !== 'verified-cache') {
    await assert.rejects(runIsolatedReactSuite(input), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'React grading infrastructure is unavailable');
      if (name === 'missing-runner' || name === 'missing-sidecar') assert.match(error.name, /^ReactRunnerArtifact/);
      else assert.equal(error.name, 'ReactRunnerArtifactIntegrity');
      return true;
    });
    assert.equal(state.creates, 0, 'invalid bytes never reach Sandbox.create');
    assert.deepEqual(state.uploads, [], 'invalid bytes are never uploaded');
    // The repaired files must be read by the same module after its failure.
    writeFileSync(artifactPath(), ARTIFACT_FIXTURE);
    writeFileSync(sidecarPath(), artifactDigest(ARTIFACT_FIXTURE));
  }
  assert.equal((await runIsolatedReactSuite(input)).timedOut, true, 'the local SDK fixture returned its fixed exit code');
  assert.equal(state.creates, 1);
  assert.equal(state.uploads.length, 1);
  assert.deepEqual(state.uploads[0], ARTIFACT_FIXTURE);
  // A successfully checked deployment artifact is cached per instance. This
  // preserves the existing contract instead of adding a per-Submit disk read.
  writeFileSync(artifactPath(), 'changed only after the verified read');
  writeFileSync(sidecarPath(), 'changed only after the verified read');
  await runIsolatedReactSuite(input);
  assert.equal(state.creates, 2);
  assert.equal(state.uploads.length, 2);
  assert.equal(state.uploads[0], state.uploads[1], 'the same verified Buffer is reused');
}

async function artifactIntegrity(onlyVmAdmission = false) {
  const failures: Error[] = [];
  if (!onlyVmAdmission) try {
    const runner = readFileSync(GUEST_BUNDLE);
    const sidecar = 'lib/coding/generated/react-sandbox.sha256.cjs';
    const digest: unknown = JSON.parse(readFileSync(sidecar, 'utf8'));
    assert.equal(typeof digest, 'string', 'the sidecar is passive JSON string data, never evaluated');
    assert.match(digest as string, /^[a-f0-9]{64}$/);
    assert.equal(digest, createHash('sha256').update(runner).digest('hex'), 'the real builder writes a digest of the exact emitted guest');
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { functions: Record<string, { includeFiles: string }> };
    const included = globSync(config.functions['api/quiz/roadmap.ts'].includeFiles);
    assert.ok(included.includes(sidecar), 'the actual Vercel include pattern selects the produced sidecar');
    assert.ok(included.includes('lib/coding/generated/react-sandbox.cjs'), 'the actual Vercel include pattern selects its runner');
    console.log('PASS artifact integrity: the real emitted guest and passive sidecar agree and both match Vercel inclusion');
  } catch (error) { failures.push(error as Error); }
  const controls = ['tampered-runner', 'missing-sidecar', 'malformed-sidecar', 'wrong-digest-type', 'missing-runner', 'verified-cache', 'snapshot-versions', 'vm-admission', 'startup-cause'];
  for (const name of onlyVmAdmission ? ['vm-admission'] : controls) {
    const dir = mkdtempSync(join(tmpdir(), 'react-artifact-'));
    try {
      const generated = join(dir, 'lib/coding/generated');
      mkdirSync(generated, { recursive: true });
      writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}\n');
      writeFileSync(join(generated, 'react-sandbox.cjs'), ARTIFACT_FIXTURE);
      writeFileSync(join(generated, 'react-sandbox.sha256.cjs'), artifactDigest(ARTIFACT_FIXTURE));
      if (name === 'snapshot-versions') {
        // This control compares package warnings. Use the actual built compiler
        // so neither verdict has to fall back to an in-thread compile.
        symlinkSync(join(process.cwd(), REACT_COMPILE_WORKER_FILE), join(dir, REACT_COMPILE_WORKER_FILE));
      }
      // The SDK is intentionally fabricated here, rather than patching a real
      // provider module and accidentally falling through to its create method.
      writeFileSync(join(generated, 'vercel-sandbox.cjs'), `
const state = globalThis.__reactArtifactFixture = { creates: 0, uploads: [] };
exports.Sandbox = { create: async () => {
  state.creates++;
  if (state.createError) throw state.createError();
  let nonce;
  return {
    writeFiles: async files => {
      state.uploads.push(files.find(file => file.path.endsWith('/runner.cjs')).content);
      nonce = JSON.parse(files.find(file => file.path.endsWith('/input.json')).content).nonce;
    },
    runCommand: async () => state.command ? state.command(nonce) : ({exitCode:124,stdout:async()=>''}),
    stop: async () => { if (state.stop) await state.stop(); },
  };
}};
`);
      if (name === 'tampered-runner') writeFileSync(join(generated, 'react-sandbox.cjs'), 'tampered fixture');
      if (name === 'missing-sidecar') rmSync(join(generated, 'react-sandbox.sha256.cjs'));
      if (name === 'malformed-sidecar') writeFileSync(join(generated, 'react-sandbox.sha256.cjs'), 'not JSON digest data');
      if (name === 'wrong-digest-type') writeFileSync(join(generated, 'react-sandbox.sha256.cjs'), '{}\n');
      if (name === 'missing-runner') rmSync(join(generated, 'react-sandbox.cjs'));
      const child = spawnSync(process.execPath, [process.argv[1], '--artifact-probe', name], {
        cwd: dir, env: { ...GUEST_ENV, REACT_RUNNER_SNAPSHOT_ID: 'local-artifact-fixture' },
        encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(child.status, 0, `${name}: ${child.error?.message ?? child.stderr}`);
      if (name === 'vm-admission') {
        assert.match(child.stdout, /PASS vm-admission control completed/, 'the fourth request must settle without waiting for a slot');
        console.log('PASS React VM admission: three independent callers; fourth refused; success and uncertain stop release');
      }
      else if (name === 'startup-cause') {
        assert.match(child.stdout, /PASS startup-cause control completed/);
        console.log('PASS React VM startup failure names its cause class or HTTP status, never its message');
      }
      else if (name === 'snapshot-versions') console.log('PASS older React snapshot logs one request-correlated warning and preserves the passing verdict');
      else console.log(`PASS artifact integrity: ${name}; verified-byte reuse and failed-cache repair`);
    } catch (error) { failures.push(error as Error); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
  if (failures.length) throw new AggregateError(failures, 'React artifact copy-integrity controls failed');
}

async function main() {
  if (process.argv[2] === '--artifact-probe') { await artifactProbe(process.argv[3]); return; }
  if (process.argv[2] === '--vm-admission') { await artifactIntegrity(true); return; }
  if (process.argv[2] === '--artifact-integrity') {
    execFileSync(process.execPath, ['scripts/build-react-runner.mjs'], { stdio: ['ignore', 'ignore', 'inherit'] });
    await artifactIntegrity();
    return;
  }
  execFileSync(process.execPath, ['--test', 'scripts/test-grading-smoke-operations.mjs'], { stdio: 'inherit' });
  await localGuest();
  await artifactIntegrity();
  await sandboxVM();
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
