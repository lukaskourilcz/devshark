import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const command = fileURLToPath(new URL('./restore-docs-archive.mjs', import.meta.url));
const ledger = 'docs/audit/devshark-content-ledger.json';
const native = 'docs/audit/wip/native/learn/review-dsa-readings.jsonl';
const archived = 'docs/audit/wip/final/review-example.jsonl';
const image = 'docs/ux-review-platform-2026-11-05/screenshots/a review.png';
const required = 'docs/audit/wip/tools/build-ledger.ts';

function record(path, body) {
  return { path, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'docs-archive-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const original = new Map([
    [ledger, Buffer.from('{"items":[]}\n')],
    [native, Buffer.from('{"id":"retained-native"}\n')],
    [archived, Buffer.from('{"id":"old-review","notes":"Keep the exact bytes."}\n')],
    [image, Buffer.from([137, 80, 78, 71, 0, 13, 10, 255, 128])],
    [required, Buffer.from('// Retained historical review tool.\n')],
  ]);
  for (const [path, body] of original) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Archive fixture', GIT_AUTHOR_EMAIL: 'archive-fixture@example.test',
    GIT_COMMITTER_NAME: 'Archive fixture', GIT_COMMITTER_EMAIL: 'archive-fixture@example.test' };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('add', '--', ...original.keys());
  git('commit', '--quiet', '-m', 'Archive fixture source');
  const manifest = {
    schemaVersion: 1,
    sourceCommit: git('rev-parse', 'HEAD'),
    repository: 'https://github.com/lukaskourilcz/devshark',
    archivedFiles: [record(archived, original.get(archived)), record(image, original.get(image))],
    preservedInputs: [record(ledger, original.get(ledger)), record(native, original.get(native))],
    requiredPaths: [required],
  };
  manifest.sourceUrl = `${manifest.repository}/tree/${manifest.sourceCommit}`;
  const manifestPath = join(root, 'archive-manifest.json');
  const output = join(root, 'restored');
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest));
  save();
  rmSync(join(root, archived));
  rmSync(join(root, image));
  const run = (...args) => spawnSync(process.execPath, [command, '--manifest', manifestPath, ...args],
    { cwd: root, encoding: 'utf8' });
  return { root, manifest, save, output, run, original };
}

test('requires an explicit verification or restoration action', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Choose --verify or --output/);
});

test('restores historical text and binary bytes under their original paths', (t) => {
  const f = fixture(t);
  const result = f.run('--output', f.output);
  assert.equal(result.status, 0, result.stderr);
  for (const path of [archived, image]) assert.deepEqual(readFileSync(join(f.output, path)), f.original.get(path));
  assert.equal(existsSync(join(f.output, ledger)), false, 'the current ledger is retained, not archived');
  assert.match(result.stdout, /Restored 2 archived files/);
});

test('verification reads the pinned Git blobs without recreating archived files', (t) => {
  const f = fixture(t);
  const result = f.run('--verify');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Verified 2 archived files/);
  assert.equal(existsSync(join(f.root, archived)), false);
  assert.equal(existsSync(f.output), false);
});

test('historical restoration leaves later reviewed ledger content untouched', (t) => {
  const f = fixture(t);
  const laterLedger = '{"items":["later approved review"]}\n';
  writeFileSync(join(f.root, ledger), laterLedger);
  const result = f.run('--output', f.output);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(f.output, archived)), f.original.get(archived));
  assert.equal(readFileSync(join(f.root, ledger), 'utf8'), laterLedger);
  assert.equal(existsSync(join(f.output, ledger)), false);
});

test('a manifest hash mismatch fails before writing any restored bytes', (t) => {
  const f = fixture(t);
  f.manifest.archivedFiles[1].sha256 = '0'.repeat(64);
  f.save();
  const result = f.run('--output', f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SHA-256 mismatch.*a review\.png/);
  assert.equal(existsSync(f.output), false);
});

test('a missing Git blob names the unrecoverable path and writes nothing', (t) => {
  const f = fixture(t);
  f.manifest.archivedFiles[0].path = 'docs/audit/wip/final/missing.jsonl';
  f.save();
  const result = f.run('--output', f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing archive blob.*missing\.jsonl/);
  assert.equal(existsSync(f.output), false);
});

test('a missing required native input fails the archive check', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, native));
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing preserved input.*review-dsa-readings\.jsonl/);
});

test('a changed retained ledger fails instead of silently validating a new record', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ledger), '{"items":["changed"]}\n');
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Preserved input changed.*devshark-content-ledger\.json/);
});

test('surviving review tools remain required even when their inputs are archived', (t) => {
  const f = fixture(t);
  rmSync(join(f.root, required));
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required path.*build-ledger\.ts/);
});

test('rejects a moving archive ref', (t) => {
  const f = fixture(t);
  f.manifest.sourceCommit = 'main';
  f.save();
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /full 40-character commit/);
});

test('rejects an archive navigation URL that points at moving main', (t) => {
  const f = fixture(t);
  f.manifest.sourceUrl = `${f.manifest.repository}/tree/main`;
  f.save();
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source URL must point to the pinned commit/);
});

test('refuses to archive the ledger or any native history file', (t) => {
  const f = fixture(t);
  f.manifest.archivedFiles.push(record(native, f.original.get(native)));
  f.save();
  const result = f.run('--verify');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Protected input cannot be archived/);
});

test('refuses path traversal before restoration', (t) => {
  const f = fixture(t);
  f.manifest.archivedFiles[0].path = '../escaped.jsonl';
  f.save();
  const result = f.run('--output', f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid archive path/);
  assert.equal(existsSync(f.output), false);
});

test('refuses to overwrite a nonempty destination', (t) => {
  const f = fixture(t);
  mkdirSync(f.output);
  writeFileSync(join(f.output, 'keep.txt'), 'existing work');
  const result = f.run('--output', f.output);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Destination must be empty/);
  assert.deepEqual(readdirSync(f.output), ['keep.txt']);
  assert.equal(readFileSync(join(f.output, 'keep.txt'), 'utf8'), 'existing work');
});
