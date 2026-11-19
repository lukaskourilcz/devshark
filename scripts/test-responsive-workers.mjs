// Exercise the scheduler used by the CLI without launching a browser or server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const viewports = [390, 768, 1280].map((width) => ({ label: String(width), width, height: 800 }));
const routes = ['/', '/quiz', '/shop'];
const scheduler = () => import('./responsive-workers.mjs');

function fixture(overrides = {}) {
  const opened = [], closed = [], attempts = [], references = [];
  let serial = 0;
  return {
    opened, closed, attempts, references,
    options: {
      routes, viewports, workers: 2,
      openSession: async (worker) => {
        const session = { worker, id: ++serial, close: () => closed.push(session.id) };
        opened.push(session);
        return session;
      },
      reference: async (session, vp) => { references.push([session.id, vp.label]); return `not-found-${session.id}`; },
      probe: async (session, route, vp, heading) => {
        attempts.push([session.id, route, vp.label]);
        assert.equal(heading, `not-found-${session.id}`, 'each session uses its own reference');
        return { route, viewport: vp.label, marker: session.id };
      },
      ...overrides,
    },
  };
}

test('two sessions run concurrently, retain all probes and return deterministic matrix order', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture();
  let active = 0, peak = 0;
  const probe = f.options.probe;
  f.options.probe = async (...args) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, args[2].width === 390 ? 5 : 1));
    const result = await probe(...args);
    active--;
    return result;
  };
  const rows = await runViewportWorkers(f.options);
  assert.equal(peak, 2);
  assert.equal(f.opened.length, 2);
  assert.deepEqual(rows.map(({ route, viewport }) => [viewport.label, route]), viewports.flatMap((vp) => routes.map((route) => [vp.label, route])));
  assert.ok(rows.every(({ result, error }) => result && !error));
  assert.deepEqual([...f.closed].sort(), [1, 2], 'both independent sessions close exactly once');
});

test('a failed probe closes its session, refreshes the reference and retries once', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture({ workers: 1, viewports: viewports.slice(0, 1) });
  const probe = f.options.probe;
  f.options.probe = async (...args) => {
    if (args[0].id === 1 && args[1] === '/quiz') throw new Error('renderer wedged');
    assert.ok(args[0].id === 1 || f.closed.includes(1), 'old session closes before replacement is used');
    return probe(...args);
  };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(({ error }) => !error));
  assert.deepEqual(f.references, [[1, '390'], [2, '390']]);
  assert.deepEqual(f.closed, [1, 2]);
});

test('an exhausted route retry remains an error result and does not drop either worker coverage', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture();
  const probe = f.options.probe;
  let failures = 0;
  f.options.probe = async (...args) => {
    if (args[1] === '/quiz' && args[2].width === 390) { failures++; throw new Error('route still broken'); }
    return probe(...args);
  };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.equal(failures, 2, 'exactly one retry');
  assert.equal(rows.filter(({ error }) => error).length, 1);
  assert.match(rows[1].error, /route still broken/);
  assert.equal(rows.at(-1).result.route, '/shop');
  assert.deepEqual([...f.closed].sort(), f.opened.map(({ id }) => id).sort());
});

test('one worker failing to start reports every assigned probe and keeps the other worker results', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture();
  const open = f.options.openSession;
  f.options.openSession = async (worker) => { if (worker === 1) throw new Error('browser refused'); return open(worker); };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.equal(rows.filter(({ error }) => /browser refused/.test(error ?? '')).length, 6);
  assert.equal(rows.filter(({ result }) => result).length, 3);
  assert.deepEqual(f.closed, [1]);
});

test('abort closes every current session immediately and never opens replacements', async () => {
  const { runViewportWorkers } = await scheduler();
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  let entered = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  f.options.probe = async () => {
    if (++entered === 2) {
      controller.abort();
      assert.deepEqual([...f.closed].sort(), [1, 2], 'signal releases both live sessions immediately');
      release();
    }
    await gate;
    throw new Error('socket closed');
  };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.ok(rows.every(({ error }) => /abort/i.test(error)));
  assert.equal(f.opened.length, 2);
  assert.equal(f.closed.length, 2);
});

test('a session resolving after abort is closed and cannot probe', async () => {
  const { runViewportWorkers } = await scheduler();
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  const open = f.options.openSession;
  f.options.openSession = async (...args) => { const s = await open(...args); controller.abort(); return s; };
  f.options.probe = async () => assert.fail('an aborted late session must not probe');
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.ok(rows.every(({ error }) => /abort/i.test(error)));
  assert.deepEqual([...f.closed].sort(), f.opened.map(({ id }) => id).sort());
});

test('a screenshot/report callback failure is retained without losing remaining coverage or cleanup', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture({ onResult: async ({ route, viewport }) => { if (route === '/quiz' && viewport.width === 390) throw new Error('artifact disk full'); } });
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.match(rows[1].error, /artifact disk full/);
  assert.ok(rows[1].result, 'retain the actual measurement when only its artifact failed');
  assert.equal(rows.filter(({ error }) => error).length, 1);
  assert.deepEqual([...f.closed].sort(), [1, 2]);
});

test('a reference failure releases its session and recalibrates before measuring', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture({ workers: 1, viewports: viewports.slice(0, 1) });
  const reference = f.options.reference;
  f.options.reference = async (...args) => { if (args[0].id === 1) throw new Error('reference missing'); return reference(...args); };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(({ result, error }) => result && !error));
  assert.deepEqual(f.references, [[2, '390']]);
  assert.deepEqual(f.closed, [1, 2]);
});

test('cleanup failure still closes the other worker and fails the completed report', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture();
  const open = f.options.openSession;
  f.options.openSession = async (...args) => {
    const session = await open(...args);
    const close = session.close;
    session.close = () => { close(); if (session.id === 1) throw new Error('cleanup fixture failed'); };
    return session;
  };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.equal(rows.filter(({ result }) => result).length, 9);
  assert.ok(rows.some(({ error }) => /cleanup fixture failed/.test(error ?? '')));
  assert.deepEqual([...f.closed].sort(), [1, 2]);
});

test('a restart reporting error is retained while both workers finish all remaining probes', async () => {
  const { runViewportWorkers } = await scheduler();
  const f = fixture({ onRestart: () => { throw new Error('restart log failed'); } });
  const probe = f.options.probe;
  f.options.probe = async (...args) => { if (args[1] === '/quiz' && args[2].width === 390) throw new Error('restart needed'); return probe(...args); };
  const rows = await runViewportWorkers(f.options);
  assert.equal(rows.length, 9);
  assert.match(rows[1].error, /restart log failed/);
  assert.ok(rows.at(-1).result);
  assert.deepEqual([...f.closed].sort(), f.opened.map(({ id }) => id).sort());
});

async function cliFixture(mode, check) {
  const directory = mkdtempSync(path.join(tmpdir(), 'responsive-workers-fixture-'));
  const log = path.join(directory, 'launches.jsonl');
  const fake = path.join(directory, 'fake-chrome.cjs');
  // This executable is a Node fixture, never Chrome: it records the actual
  // CLI launch contract then exits, or waits for the CLI's signal cleanup.
  writeFileSync(fake, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({pid:process.pid,args:process.argv.slice(2)})+'\\n');\n${mode === 'exit' ? 'process.exit(7);' : 'setInterval(()=>{},1000);'}\n`);
  chmodSync(fake, 0o755);
  const server = createServer((_request, response) => response.end('fixture preview'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const script = fileURLToPath(new URL('./check-responsive.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, '--routes=/,/quiz', '--widths=390,1280', '--workers=2', `--base-url=http://127.0.0.1:${server.address().port}`, `--output-dir=${directory}/shots`], {
    env: { ...process.env, CHROME_BIN: fake, RESPONSIVE_DEBUG_PORT: '', RESPONSIVE_ZOOM: '', RESPONSIVE_AUTH: 'guest', RESPONSIVE_LOCALE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { output += data; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  const launches = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  try { await check({ child, done, launches, output: () => output }); }
  finally {
    child.kill('SIGKILL');
    await done;
    await new Promise((resolve) => server.close(resolve));
    for (const { pid, args } of launches()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already stopped */ }
      rmSync(args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length), { recursive: true, force: true });
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

test('actual CLI retries exited fixture processes, retains all errors and removes unique profiles', { timeout: 15_000 }, async () => {
  await cliFixture('exit', async ({ done, launches, output }) => {
    assert.deepEqual(await done, { code: 1, signal: null });
    assert.match(output(), /4 probes .* 4 unprobed/);
    const started = launches();
    assert.equal(started.length, 8, 'every failed probe gets one retry');
    const profiles = started.map(({ args }) => {
      assert.ok(args.includes('--remote-debugging-port=0'), 'real launch uses ephemeral ports');
      return args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
    });
    assert.equal(new Set(profiles).size, 8);
    assert.ok(profiles.every((profile) => !existsSync(profile)), 'failed and restarted processes leave no profiles');
  });
});

test('actual CLI SIGTERM releases both fixture processes during startup', { timeout: 15_000 }, async () => {
  await cliFixture('hold', async ({ child, done, launches }) => {
    const deadline = Date.now() + 5000;
    while (launches().length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(launches().length, 2, 'both independent sessions started');
    child.kill('SIGTERM');
    assert.deepEqual(await done, { code: 143, signal: null });
    for (const { pid, args } of launches()) {
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.throws(() => process.kill(pid, 0), 'the child fixture process is stopped');
      assert.equal(existsSync(args.find((arg) => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length)), false);
    }
  });
});
