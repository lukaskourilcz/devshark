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
    env: { ...process.env, CHROME_BIN: '/no-responsive-test-browser', RESPONSIVE_ZOOM: '', ...env },
  });
  assert.equal(result.error, undefined, 'the matrix command finishes without a browser');
  return result;
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
