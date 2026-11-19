import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const installed = path.dirname(require.resolve('@playwright/test/package.json'));
const cli = path.join(installed, 'cli.js');
const entry = pathToFileURL(path.join(installed, 'index.mjs')).href;

function workflowOutputs() {
  const lines = readFileSync(path.join(root, '.github/workflows/quality.yml'), 'utf8').split('\n');
  const browser = lines.find(line => line.includes('npm run test:browser -- --project=chromium --workers=2 ') && line.includes('tests/browser/public.spec.ts'));
  const storybook = lines.find(line => line.includes('npm run test:browser -- --project=chromium ') && line.includes('tests/browser/storybook.spec.ts'));
  assert.ok(browser && storybook, 'Both real workflow invocations must be found');
  return [browser, storybook].map(line => ({
    output: /(?:^|\s)--output(?:=|\s+)([^\s]+)/.exec(line)?.[1] ?? 'test-results',
    report: /(?:^|\s)PLAYWRIGHT_HTML_REPORT=([^\s]+)/.exec(line)?.[1] ?? 'playwright-report',
  }));
}
function files(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('a later successful Storybook invocation preserves earlier browser failure diagnostics and report', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'ci-browser-artifacts-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'specs'));
  writeFileSync(path.join(directory, 'playwright.config.mjs'), "export default { testDir: './specs', captureGitInfo: { commit: false, diff: false }, reporter: [['line'], ['html', { open: 'never' }]], fullyParallel: false, workers: 1 };\n");
  writeFileSync(path.join(directory, 'specs/failure.spec.mjs'),
    'import { test, expect } from ' + JSON.stringify(entry) + ';\n' +
    "import { mkdirSync, writeFileSync } from 'node:fs';\nimport path from 'node:path';\n" +
    "test('earlier browser failure', async ({}, info) => { const file = info.outputPath('failure-note.txt'); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, 'preserve this earlier diagnostic'); await info.attach('diagnostic', { path: file, contentType: 'text/plain' }); expect('actual').toBe('intentional failure'); });\n");
  writeFileSync(path.join(directory, 'specs/followup.spec.mjs'),
    'import { test, expect } from ' + JSON.stringify(entry) + ";\ntest('later Storybook success', () => { expect(1).toBe(1); });\n");
  const [browser, storybook] = workflowOutputs();
  const run = (spec, outputs) => spawnSync(process.execPath, [cli, 'test', '--config=playwright.config.mjs', '--output=' + outputs.output, spec], {
    cwd: directory,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', CI: 'true', PLAYWRIGHT_HTML_REPORT: path.join(directory, outputs.report) },
    encoding: 'utf8', timeout: 20_000, maxBuffer: 1 << 20,
  });
  const first = run('failure.spec.mjs', browser);
  assert.equal(first.status, 1, first.stdout + first.stderr);
  assert.match(first.stdout, /1 failed/, 'The earlier fixture must actually fail');
  const diagnostic = files(path.join(directory, browser.output)).find(file => file.endsWith('/failure-note.txt'));
  assert.ok(diagnostic, 'The earlier failure must produce a real output diagnostic');
  const report = path.join(directory, browser.report, 'index.html');
  assert.ok(existsSync(report), 'The earlier failure must produce its HTML report');
  const reportHash = hash(report);
  const second = run('followup.spec.mjs', storybook);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.match(second.stdout, /1 passed/, 'The later fixture must actually pass');
  assert.ok(existsSync(diagnostic), 'The later successful invocation deleted the earlier failure diagnostic');
  assert.equal(readFileSync(diagnostic, 'utf8'), 'preserve this earlier diagnostic');
  assert.equal(hash(report), reportHash, 'The later invocation replaced the earlier HTML failure report');
  assert.ok(existsSync(path.join(directory, storybook.report, 'index.html')), 'Both reports remain available');
});
