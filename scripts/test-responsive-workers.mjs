// Exercise the scheduler used by the CLI without launching a browser or server.
import assert from 'node:assert/strict';
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
