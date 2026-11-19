import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const checker = path.resolve('scripts/check-binary-size.mjs');
function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'devshark-binary-size-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const file = (name, content) => { mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); writeFileSync(path.join(root, name), content); };
  try {
    git('init', '-q');
    file('existing image.bin', Buffer.alloc(500_001));
    file('README.md', 'fixture\n');
    git('add', '.');
    git('-c', 'user.name=Binary gate fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Baseline');
    const base = git('rev-parse', 'HEAD');
    const check = (ref = base) => spawnSync(process.execPath, [checker, '--base', ref], { cwd: root, encoding: 'utf8' });
    run({ root, git, file, check });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts unchanged historical binaries and new binaries at exactly 500 kB', () => fixture(({ git, file, check }) => {
  file('nested/exact limit.bin', Buffer.alloc(500_000)); git('add', '.');
  const result = check(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /500000/);
}));

test('rejects a new oversized binary after it is committed', () => fixture(({ git, file, check }) => {
  file('new image.bin', Buffer.alloc(500_001)); git('add', '.');
  git('-c', 'user.name=Binary gate fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Add image');
  const result = check(); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /new image\.bin.*500001/);
}));

test('rejects changed oversized historical binaries', () => fixture(({ file, check }) => {
  const bytes = Buffer.alloc(500_001); bytes[0] = 1; file('existing image.bin', bytes);
  const result = check(); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /existing image\.bin/);
}));

test('checks untracked files while allowing large valid UTF-8 text', () => fixture(({ file, check }) => {
  file('large.txt', 'Příliš žluťoučký 🦈\n'.repeat(30_000));
  assert.equal(check().status, 0);
  file('untracked.bin', Buffer.alloc(500_001));
  const result = check(); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /untracked\.bin/);
}));

test('detects invalid UTF-8 without NUL bytes as binary', () => fixture(({ file, check }) => {
  file('opaque.dat', Buffer.alloc(500_001, 0xff));
  const result = check(); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /opaque\.dat/);
}));

test('rejects renamed oversized files and ignores deleted historical files', () => fixture(({ git, check }) => {
  git('mv', 'existing image.bin', 'renamed image.bin');
  const result = check(); assert.equal(result.status, 1, result.stderr); assert.match(result.stderr, /renamed image\.bin/);
  git('rm', '-f', 'renamed image.bin'); assert.equal(check().status, 0);
}));

test('fails closed for an invalid base rather than silently accepting every file', () => fixture(({ check }) => {
  const result = check('missing-base'); assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /base/i);
}));
