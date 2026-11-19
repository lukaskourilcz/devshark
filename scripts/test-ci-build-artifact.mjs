import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const command = path.resolve('scripts/ci-build-artifact.mjs');
function fixture(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'devshark-ci-build-'));
  const source = path.join(dir, 'source'); const destination = path.join(dir, 'destination');
  const file = (root, name, value) => { const target = path.join(root, name); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, value); };
  const sha = '1'.repeat(40);
  const exec = (root, action, expected = sha) => spawnSync(process.execPath, [command, action, path.join(dir, 'build.tar')], { cwd: root, env: { ...process.env, GITHUB_SHA: expected }, encoding: 'utf8' });
  try {
    mkdirSync(destination); file(source, 'client/dist/index.html', '<h1>devShark</h1>');
    file(source, 'client/dist/.vite/manifest.json', '{"main":{}}');
    file(source, 'client/dist/assets/main.js.map', '{"sources":["source.tsx"]}');
    file(source, 'client/dist/sandbox/index.html', '<h1>Sandbox</h1>');
    file(source, 'lib/coding/generated/runner.cjs', 'module.exports = {};');
    run({ dir, source, destination, file, exec });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('shares the exact build including hidden provenance, source maps and grader output', () => fixture(({ source, destination, exec }) => {
  const packed = exec(source, 'pack'); assert.equal(packed.status, 0, packed.stderr);
  const restored = exec(destination, 'restore'); assert.equal(restored.status, 0, restored.stderr);
  for (const name of ['client/dist/.vite/manifest.json', 'client/dist/assets/main.js.map', 'client/dist/sandbox/index.html', 'lib/coding/generated/runner.cjs']) {
    assert.deepEqual(readFileSync(path.join(destination, name)), readFileSync(path.join(source, name)));
  }
}));

test('refuses another head before writing destination build files', () => fixture(({ source, destination, exec }) => {
  assert.equal(exec(source, 'pack').status, 0);
  const result = exec(destination, 'restore', '2'.repeat(40));
  assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /head/i);
  assert.equal(existsSync(path.join(destination, 'client/dist')), false);
}));

test('rejects tampered build bytes before replacing an existing destination', () => fixture(({ dir, source, destination, file, exec }) => {
  assert.equal(exec(source, 'pack').status, 0);
  file(source, 'client/dist/index.html', 'tampered');
  execFileSync('tar', ['-rf', path.join(dir, 'build.tar'), 'client/dist/index.html'], { cwd: source });
  file(destination, 'client/dist/index.html', 'keep this build');
  const result = exec(destination, 'restore'); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /hash/i);
  assert.equal(readFileSync(path.join(destination, 'client/dist/index.html'), 'utf8'), 'keep this build');
}));

test('refuses packing without the hidden Vite provenance manifest', () => fixture(({ source, exec }) => {
  rmSync(path.join(source, 'client/dist/.vite/manifest.json'));
  const result = exec(source, 'pack'); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /manifest/i);
}));
