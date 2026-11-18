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

