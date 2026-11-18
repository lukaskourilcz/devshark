// Contracts of the read-only performance tools (#630). No case launches a
// browser or sends a request: the CI tests job installs no Playwright browser,
// so every run points CHROME_BIN at a file that does not exist and --url at a
// port nothing listens on.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveOptions, UsageError } from './measure-web-performance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const measure = join(root, 'scripts/measure-web-performance.mjs');
const closedOrigin = 'http://127.0.0.1:9';

function runMeasure(t, flags) {
  const scratch = mkdtempSync(join(tmpdir(), 'devshark-perf-tools-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'lab.json');
  const result = spawnSync(process.execPath, [measure, `--url=${closedOrigin}`, ...flags, `--output=${output}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CHROME_BIN: join(scratch, 'no-such-chrome') },
  });
  return { ...result, output };
}

for (const [name, flags, mention] of [
  ['a sample count that is not a number', ['--samples=abc'], /--samples/],
  ['zero samples', ['--samples=0'], /--samples/],
  ['a profile it has no viewport for', ['--profiles=tablet'], /--profiles/],
  ['a route without a leading slash', ['--routes=learn'], /--routes/],
  ['a misspelt flag', ['--sample=3'], /--sample\b/],
]) {
  test(`perf:measure refuses ${name} before it launches a browser`, (t) => {
    const run = runMeasure(t, flags);
    assert.equal(run.error, undefined, 'the process ran to its end');
    assert.equal(run.status, 2, `exit code 2 (stderr: ${run.stderr.trim()})`);
    assert.match(run.stderr, /Usage: /);
    assert.match(run.stderr, mention);
    assert.equal(existsSync(run.output), false, 'a refused run writes no lab file');
  });
}

test('perf:measure reads a bare switch as on and splits a value at its first =', () => {
  const args = parseArgs(['--fixture', '--url=https://devshark.app/?a=b', '--samples=3', '--routes=/quiz?mode=a=b,/learn']);
  assert.deepEqual(args, { fixture: true, url: 'https://devshark.app/?a=b', samples: '3', routes: '/quiz?mode=a=b,/learn' });
  const options = resolveOptions(args);
  assert.equal(options.fixture, true);
  assert.equal(options.origin, 'https://devshark.app');
  assert.deepEqual(options.routes, ['/quiz?mode=a=b', '/learn']);
  assert.equal(options.samples, 3);
});

test('perf:measure refuses flags it cannot read', () => {
  for (const argv of [['--url'], ['--fixture=1'], ['--samples=3', '--samples=4'], ['learn'], ['--routes=/,'], ['--profiles=mobile,mobile'], ['--url=ftp://example.test'], ['--routes=//example.test'], ['--samples=1e1']]) {
    assert.throws(() => resolveOptions(parseArgs(argv)), UsageError, argv.join(' '));
  }
});
