import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repo = fileURLToPath(new URL('../', import.meta.url));
const checker = path.join(repo, 'scripts/check-unused.mjs');
const config = JSON.parse(readFileSync(path.join(repo, 'knip.json'), 'utf8'));

/** Run the real Knip/checker against a small import graph, not a mocked report. */
function fixture(files = {}, baseline = []) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'devshark-unused-'));
  const put = (name, body) => {
    const target = path.join(cwd, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  try {
    symlinkSync(path.join(repo, 'node_modules'), path.join(cwd, 'node_modules'), 'dir');
    put('package.json', JSON.stringify({ name: 'unused-contract-fixture', private: true, type: 'module' }));
    put('knip.json', JSON.stringify({
      entry: ['app.ts', 'api/**/*.ts'],
      project: ['app.ts', 'api/**/*.ts', 'lib/**/*.ts', 'shared/**/*.ts', 'client/**/*.ts'],
      ...(config.tags ? { tags: config.tags } : {}),
    }));
    put('app.ts', "import { used } from './lib/value'; console.log(used);\n");
    put('lib/value.ts', 'export const used = 1;\n');
    put('docs/quality/unused-baseline.json', JSON.stringify(baseline));
    for (const [name, body] of Object.entries(files)) {
      if (body === null) rmSync(path.join(cwd, name));
      else put(name, body);
    }
    const run = spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8', timeout: 20_000 });
    assert.equal(run.error, undefined, 'the real checker completes');
    const report = JSON.parse(readFileSync(path.join(cwd, 'artifacts/unused.json'), 'utf8'));
    return { ...run, report, output: run.stdout + run.stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test('F2-40: an obsolete baseline entry fails even when there are no new findings', () => {
  const run = fixture({}, ['client/src/lib/eligibility.ts:files:client/src/lib/eligibility.ts']);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /stale|obsolete/i);
  assert.match(run.output, /eligibility/);
});

test('a still-current reviewed file finding remains accepted', () => {
  const run = fixture({ 'lib/orphan.ts': 'export const orphan = 1;' }, ['lib/orphan.ts:files:lib/orphan.ts']);
  assert.equal(run.status, 0, run.output);
});

test('F14-08: a new unused lib value export fails', () => {
  const run = fixture({ 'lib/value.ts': 'export const used = 1; export const abandoned = 2;' });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /lib\/value\.ts:exports:abandoned/);
});

test('F14-08: a new unused shared value export fails', () => {
  const run = fixture({
    'app.ts': "import { used } from './shared/value'; console.log(used);",
    'shared/value.ts': 'export const used = 1; export const abandoned = 2;',
    'lib/value.ts': null,
  });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /shared\/value\.ts:exports:abandoned/);
});

test('a baseline cannot approve an unused server export instead of reviewing its API', () => {
  const run = fixture({ 'lib/value.ts': 'export const used = 1; export const abandoned = 2;' }, ['lib/value.ts:exports:abandoned']);
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /export/i);
});

test('client exports remain visible in the audit without widening the server gate', () => {
  const run = fixture({
    'app.ts': "import { used } from './client/value'; console.log(used);",
    'client/value.ts': 'export const used = 1; export const advisory = 2;',
    'lib/value.ts': null,
  });
  assert.equal(run.status, 0, run.output);
  assert.ok(run.report.issues.some(issue => issue.file === 'client/value.ts' && issue.exports.some(value => value.name === 'advisory')), 'the real export finding remains in unused.json');
});

test('a specifically documented public contract is retained without ignoring its whole module', () => {
  const run = fixture({ 'lib/value.ts': 'export const used = 1;\n/** Authoring adapter consumed by an external caller. @public */\nexport const publicContract = 2;' });
  assert.equal(run.status, 0, run.output);
  const privateTwin = fixture({ 'lib/value.ts': 'export const used = 1;\n/** Authoring adapter consumed by an external caller. @public */\nexport const publicContract = 2;\nexport const unreviewed = 3;' });
  assert.equal(privateTwin.status, 1, privateTwin.output);
  assert.match(privateTwin.output, /lib\/value\.ts:exports:unreviewed/);
});

test('API entry exports and unresolved-import failures retain their existing contracts', () => {
  const entry = fixture({ 'api/handler.ts': 'export default function handler() { return 1; }' });
  assert.equal(entry.status, 0, entry.output);
  const unresolved = fixture({ 'app.ts': "import { missing } from './missing'; console.log(missing);", 'lib/value.ts': null });
  assert.equal(unresolved.status, 1, unresolved.output);
  assert.match(unresolved.output, /unresolved:.*missing/);
});
