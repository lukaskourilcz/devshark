// The responsive matrix must describe the geometry it will measure. These
// cases need no preview, browser, network connection or generated client.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./check-responsive.mjs', import.meta.url));
function run(flags = [], env = {}) {
  const result = spawnSync(process.execPath, [script, '--print-matrix', '--base-url=http://127.0.0.1:9', ...flags], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, CHROME_BIN: '/no-responsive-test-browser', RESPONSIVE_ZOOM: '', RESPONSIVE_WORKERS: '', RESPONSIVE_DEBUG_PORT: '', ...env },
  });
  assert.equal(result.error, undefined, 'the matrix command finishes without a browser');
  return result;
}

test('F14: the default sweep uses one worker and covers every viewport once', () => {
  const selected = matrix();
  assert.equal(selected.workers, 1);
  assert.deepEqual(selected.shards, [{ worker: 1, viewportLabels: selected.viewports.map(({ label }) => label), probes: selected.routes.length * selected.viewports.length }]);
});

test('F14: two workers shard complete viewport groups without changing geometry or routes', () => {
  const ordinary = matrix(['--routes=/,/quiz,/shop', '--widths=390,768,1280', '--zoom=200']);
  const parallel = matrix(['--routes=/,/quiz,/shop', '--widths=390,768,1280', '--zoom=200', '--workers=2']);
  assert.equal(parallel.workers, 2);
  assert.deepEqual(parallel.routes, ordinary.routes);
  assert.deepEqual(parallel.viewports, ordinary.viewports);
  assert.deepEqual(parallel.shards, [
    { worker: 1, viewportLabels: ordinary.viewports.filter((_, index) => index % 2 === 0).map(({ label }) => label), probes: 6 },
    { worker: 2, viewportLabels: [ordinary.viewports[1].label], probes: 3 },
  ]);
});

test('F14: worker environment is supported and the CLI overrides it', () => {
  assert.equal(matrix([], { RESPONSIVE_WORKERS: '2' }).workers, 2);
  assert.equal(matrix(['--workers=1'], { RESPONSIVE_WORKERS: '2' }).workers, 1);
  assert.equal(matrix(['--widths=390', '--workers=2']).shards.length, 1, 'one viewport needs one session');
});

for (const value of ['0', '3', '-1', '1.5', '2junk', 'abc']) {
  test(`F14: invalid worker count ${value} fails before browser startup`, () => {
    const result = run([], { RESPONSIVE_WORKERS: value });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /workers/i);
  });
}

test('F14: a missing worker option value cannot silently use the default', () => {
  assert.equal(run(['--workers']).status, 2);
});

test('F14: an explicit fixed debug port is refused with concurrent sessions', () => {
  const result = run(['--workers=2'], { RESPONSIVE_DEBUG_PORT: '9333' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /debug.port.*workers|workers.*debug.port/i);
  assert.equal(matrix(['--workers=1'], { RESPONSIVE_DEBUG_PORT: '9333' }).workers, 1);
  assert.equal(matrix(['--workers=2'], { RESPONSIVE_DEBUG_PORT: '0' }).workers, 2);
});

for (const value of ['abc', '9333junk', '-1', '65536']) {
  test(`F14: invalid explicit debug port ${value} fails before browser startup`, () => {
    assert.equal(run([], { RESPONSIVE_DEBUG_PORT: value }).status, 2);
  });
}
function matrix(flags, env) {
  const result = run(flags, env);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('F6-01: the default matrix names the learner routes covered by release acceptance', () => {
  const selected = matrix();
  assert.ok(selected.routes.length >= 15, 'at least fifteen learner routes');
  for (const route of ['/', '/learn', '/learn/web-developer', '/coding', '/coding/javascript', '/coding/javascript/js-double-numbers', '/leaderboard', '/profile', '/premium', '/play', '/challenge', '/today', '/cards', '/shop', '/privacy', '/terms']) {
    assert.ok(selected.routes.includes(route), `${route} belongs to the measured matrix`);
  }
});

test('F6-02: 820px and 1366px profiles are selectable beside the existing landscape profile', () => {
  const selected = matrix(['--routes=/', '--widths=820,1024,1366']);
  assert.deepEqual(selected.viewports.map(({ physicalWidth }) => physicalWidth), [820, 1024, 1366]);
  const landscape = selected.viewports.find(({ physicalWidth }) => physicalWidth === 1024);
  assert.equal(landscape.physicalHeight, 768);
});

test('F6-02: malformed width input cannot silently select a different profile', () => {
  const result = run(['--widths=390garbage']);
  assert.equal(result.status, 2, 'invalid matrix input uses the usage exit code');
  assert.match(result.stderr, /width.*390garbage|390garbage.*width/i);
});

for (const [zoom, width, height] of [[200, 640, 400], [400, 320, 200]]) {
  test(`F6-03: ${zoom} percent zoom reflows a 1280px viewport to ${width} CSS pixels`, () => {
    const selected = matrix(['--routes=/', '--widths=1280'], { RESPONSIVE_ZOOM: String(zoom) });
    assert.equal(selected.zoom, zoom);
    assert.equal(selected.viewports.length, 1);
    const viewport = selected.viewports[0];
    assert.equal(viewport.physicalWidth, 1280);
    assert.equal(viewport.physicalHeight, 800);
    assert.equal(viewport.width, width);
    assert.equal(viewport.height, height);
    assert.equal(viewport.mobile, false, 'browser zoom preserves the desktop input mode');
  });
}

test('F6-03: ordinary scale preserves the selected CSS viewport', () => {
  const selected = matrix(['--routes=/', '--widths=390']);
  assert.equal(selected.zoom, 100);
  assert.equal(selected.viewports[0].physicalWidth, 390);
  assert.equal(selected.viewports[0].width, 390);
  assert.equal(selected.viewports[0].height, 844);
});

for (const zoom of ['abc', '0', '125', '125junk', '1000', '200.5']) {
  test(`F6-03: invalid zoom ${zoom} fails before a browser or preview is required`, () => {
    const result = run(['--routes=/', '--widths=1280'], { RESPONSIVE_ZOOM: zoom });
    assert.equal(result.status, 2, 'invalid zoom uses the usage exit code');
    assert.match(result.stderr, /zoom/i);
  });
}
