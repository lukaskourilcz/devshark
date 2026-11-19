import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const command = fileURLToPath(new URL('./ci-parity.mjs', import.meta.url));
const root = path.dirname(path.dirname(command));

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-parity-port-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, '.github/workflows'), { recursive: true });
  mkdirSync(path.join(directory, 'docs/quality'), { recursive: true });
  writeFileSync(path.join(directory, '.github/workflows/quality.yml'), readFileSync(path.join(root, '.github/workflows/quality.yml')));
  writeFileSync(path.join(directory, 'docs/quality/bundle-budget.json'), JSON.stringify({ measuredBuild: { env: { VITE_SUPABASE_URL: 'https://fixture.invalid', VITE_SUPABASE_ANON_KEY: 'fixture' } } }));
  writeFileSync(path.join(directory, 'capture.cjs'), `require('node:fs').appendFileSync('children.jsonl', JSON.stringify({ args: process.argv.slice(2), test: process.env.TEST_BASE_URL, responsive: process.env.RESPONSIVE_BASE_URL, theme: process.env.RESPONSIVE_THEME, zoom: process.env.RESPONSIVE_ZOOM, storybook: process.env.STORYBOOK_URL }) + '\\n');`);
  writeFileSync(path.join(directory, 'forbidden.cjs'), "require('node:fs').writeFileSync('unexpected-preview-start', 'started'); process.exit(1);");
  writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ private: true, scripts: {
    'check:responsive': 'node capture.cjs', 'test:browser': 'node capture.cjs',
    'audit:performance': 'node capture.cjs', preview: 'node forbidden.cjs',
  } }));
  const run = (args, timeout = 6000) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [command, ...args, '--log-dir', path.join(directory, 'logs')], {
      cwd: directory, env: { ...process.env, TEST_BASE_URL: 'http://inherited.invalid:9', RESPONSIVE_BASE_URL: 'http://inherited.invalid:10' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.on('error', reject);
    child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }); });
  });
  const children = () => readFileSync(path.join(directory, 'children.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  return { directory, run, children };
}

for (const value of ['', '0', '1023', '65536', '-1', '4174.5', '1e4', 'wrong']) {
  test(`rejects invalid preview port ${JSON.stringify(value)} before running a gate`, async (t) => {
    const f = fixture(t);
    const result = await f.run(['--list', '--preview-port', value]);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /--preview-port.*1024.*65535/);
    assert.equal(existsSync(path.join(f.directory, 'children.jsonl')), false);
  });
}

test('rejects a missing preview-port value', async (t) => {
  const f = fixture(t);
  const result = await f.run(['--list', '--preview-port']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--preview-port/);
});

test('lists boundary/custom ports without changing workflow drift checks', async (t) => {
  const f = fixture(t);
  for (const value of ['1024', '4174', '65535']) {
    const result = await f.run(['--list', `--preview-port=${value}`]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`http://localhost:${value}(?:\\s|$)`));
    assert.match(result.stdout, new RegExp(`--port ${value} --strictPort`));
    assert.doesNotMatch(result.stderr, /no longer matches/);
  }
});

test('sets the chosen URL on browser and responsive children without losing matrix env', async (t) => {
  const f = fixture(t);
  const selected = 'browser:chromium,check:responsive,check:responsive:dark,check:responsive:zoom200,check:responsive:zoom400';
  const result = await f.run(['--only', selected, '--preview-port', '4174']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const children = f.children();
  assert.equal(children.length, 5);
  for (const child of children) {
    assert.equal(child.test, 'http://localhost:4174');
    assert.equal(child.responsive, 'http://localhost:4174');
  }
  assert.ok(children.some((child) => child.theme === 'dark'));
  assert.deepEqual(children.filter((child) => child.zoom).map((child) => child.zoom).sort(), ['200', '400']);
  const summary = JSON.parse(readFileSync(path.join(f.directory, 'logs/summary.json'), 'utf8'));
  assert.equal(summary.previewUrl, 'http://localhost:4174');
  assert.equal(summary.previewPort, 4174);
});

test('targets custom preview in Lighthouse while preserving Storybook own URL', async (t) => {
  const f = fixture(t);
  const result = await f.run(['--only', 'audit:performance,browser:storybook', '--preview-port', '4174']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const children = f.children();
  assert.ok(children.some((child) => child.args.includes('--url=http://localhost:4174')));
  assert.ok(children.some((child) => child.storybook === 'http://localhost:6006'));
});

for (const status of [200, 503]) {
  test(`refuses the chosen occupied preview port with HTTP ${status} before starting a child`, async (t) => {
    const f = fixture(t);
    const server = createServer((request, response) => { response.writeHead(status).end('old fixture build'); });
    await new Promise((resolve) => server.listen(0, resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const port = server.address().port;
    const result = await f.run(['--only', 'preview', '--preview-port', String(port)], 3000);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, new RegExp(`http://localhost:${port} already answers`));
    assert.equal(existsSync(path.join(f.directory, 'unexpected-preview-start')), false);
    assert.equal(existsSync(path.join(f.directory, 'logs/summary.json')), false, 'port refusal precedes a gate run');
  });
}
