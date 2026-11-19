import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
    const runner = 'module.exports = {};';
    file(source, 'lib/coding/generated/react-sandbox.cjs', runner);
    file(source, 'lib/coding/generated/react-sandbox.sha256.cjs', JSON.stringify(createHash('sha256').update(runner).digest('hex')) + '\n');
    run({ dir, source, destination, file, exec });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('shares the exact build including hidden provenance, source maps and grader output', () => fixture(({ source, destination, exec }) => {
  const packed = exec(source, 'pack'); assert.equal(packed.status, 0, packed.stderr);
  const restored = exec(destination, 'restore'); assert.equal(restored.status, 0, restored.stderr);
  for (const name of ['client/dist/.vite/manifest.json', 'client/dist/assets/main.js.map', 'client/dist/sandbox/index.html', 'lib/coding/generated/react-sandbox.cjs', 'lib/coding/generated/react-sandbox.sha256.cjs']) {
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


test('refuses packing a guest without its passive digest sidecar', () => fixture(({ source, exec }) => {
  rmSync(path.join(source, 'lib/coding/generated/react-sandbox.sha256.cjs'));
  const packed = exec(source, 'pack');
  assert.equal(packed.status, 1, packed.stderr); assert.match(packed.stderr, /artifact|guest|digest|sidecar/i);
}));

test('refuses packing a changed guest whose generic archive hashes would otherwise agree', () => fixture(({ source, file, exec }) => {
  file(source, 'lib/coding/generated/react-sandbox.cjs', 'changed runner with stale digest');
  const packed = exec(source, 'pack');
  assert.equal(packed.status, 1, packed.stderr); assert.match(packed.stderr, /artifact|guest|digest|integrity/i);
}));

for (const change of ['missing-sidecar', 'changed-runner']) {
  test(`refuses restoring ${change} even with a recomputed generic inventory and preserves the destination`, () => fixture(({ dir, source, destination, file, exec }) => {
    assert.equal(exec(source, 'pack').status, 0);
    const manifestPath = path.join(source, 'artifacts/client-build-manifest.json');
    const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (change === 'missing-sidecar') {
      rmSync(path.join(source, 'lib/coding/generated/react-sandbox.sha256.cjs'));
      metadata.files = metadata.files.filter((one) => one.path !== 'lib/coding/generated/react-sandbox.sha256.cjs');
    } else {
      const runner = 'changed runner with stale digest';
      file(source, 'lib/coding/generated/react-sandbox.cjs', runner);
      metadata.files.find((one) => one.path === 'lib/coding/generated/react-sandbox.cjs').sha256 = createHash('sha256').update(runner).digest('hex');
    }
    writeFileSync(manifestPath, JSON.stringify(metadata, null, 2) + '\n');
    execFileSync('tar', ['-cf', path.join(dir, 'build.tar'), 'client/dist', 'lib/coding/generated', 'artifacts/client-build-manifest.json'], { cwd: source });
    file(destination, 'client/dist/index.html', 'keep this client');
    file(destination, 'lib/coding/generated/keep.cjs', 'keep this generated tree');
    const restored = exec(destination, 'restore');
    assert.equal(restored.status, 1, restored.stderr); assert.match(restored.stderr, /artifact|guest|digest|sidecar|integrity/i);
    assert.equal(readFileSync(path.join(destination, 'client/dist/index.html'), 'utf8'), 'keep this client');
    assert.equal(readFileSync(path.join(destination, 'lib/coding/generated/keep.cjs'), 'utf8'), 'keep this generated tree');
  }));
}
