// Tiny source fixtures; no real handler profiling in CI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PROBES, main, options } from './perf-cold-start.mjs';

function fixture(t, contents) {
  const root = mkdtempSync(join(tmpdir(), 'cold-import-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const probe of PROBES) { const file = join(root, probe.file); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, probe.id === 'health' ? contents : 'export default null;'); }
  mkdirSync(join(root, 'client'), { recursive: true }); writeFileSync(join(root, 'package-lock.json'), '{}'); writeFileSync(join(root, 'client/package-lock.json'), '{}');
  return root;
}
test('each import sample gets a fresh credential-free process and separate wall/CPU/heap fields', async t => {
  const root = fixture(t, `
    if (process.env.COLD_TEST_SECRET || process.env.NODE_OPTIONS || process.env.NODE_ENV !== 'development') throw new Error('inherited environment');
    globalThis.__counter = (globalThis.__counter || 0) + 1;
    if (globalThis.__counter !== 1) throw new Error('reused realm');
    console.warn('provider-message-do-not-retain');
    export default null;
  `);
  const previous = process.env.COLD_TEST_SECRET; process.env.COLD_TEST_SECRET = 'invented-test-value';
  let report;
  try { report = await main(options(['--local', '--handlers=health', '--samples=3']), root); }
  finally { if (previous === undefined) delete process.env.COLD_TEST_SECRET; else process.env.COLD_TEST_SECRET = previous; }
  assert.equal(report.rows.length, 3); assert(report.rows.every(row => row.ok)); assert.equal(new Set(report.rows.map(row => row.pid)).size, 3);
  for (const row of report.rows) {
    for (const field of ['importWallMs', 'childProcessWallMs', 'heapBeforeBytes', 'heapAfterBytes', 'heapDeltaBytes']) assert(Number.isFinite(row[field]));
    assert(Number.isFinite(row.cpu.userMicros)); assert(Number.isFinite(row.cpu.systemMicros)); assert.equal(row.deniedAttempts, 0); assert.equal(row.suppressedLogCalls, 1);
  }
  assert.equal(report.artifacts.length, 1); assert(report.artifacts[0].artifactBytes > 0); assert(Number.isFinite(report.artifacts[0].compileWallMs));
  assert(!JSON.stringify(report).includes('provider-message'));
  assert.deepEqual(readdirSync(join(root, 'node_modules/.cache/shark')), [], 'only the owned artifact prefix is removed');
  assert.equal(readFileSync(join(root, 'package-lock.json'), 'utf8'), '{}');
});
test('caught fetch/http/socket attempts still fail an import and open no connection', async t => {
  const root = fixture(t, `
    try { require('node:http').request('http://127.0.0.1:1'); } catch {}
    try { require('node:net').connect({ host: '127.0.0.1', port: 1 }); } catch {}
    fetch('https://never-requested.test').catch(() => {});
    export default null;
  `);
  const report = await main(options(['--local', '--handlers=health', '--samples=1']), root);
  assert.equal(report.rows[0].ok, false); assert.equal(report.rows[0].error, 'network_or_process_attempted'); assert.equal(report.rows[0].deniedAttempts, 3); assert.equal(report.totals.sent, 0);
});
test('failed imports remain failed raw rows without source/provider error text', async t => {
  const root = fixture(t, `throw new Error('private-provider-message'); export default null;`);
  const report = await main(options(['--local', '--handlers=health', '--samples=1']), root);
  assert.equal(report.rows[0].ok, false); assert.equal(report.rows[0].error, 'import_failed'); assert(!JSON.stringify(report).includes('private-provider'));
});

test('compiler failure leaves explicit unmeasured rows and cleans its artifact prefix', async t => {
  const root = fixture(t, 'const = invalid syntax;');
  const report = await main(options(['--local', '--handlers=health', '--samples=3']), root);
  assert.equal(report.rows.length, 3); assert(report.rows.every(row => row.skipped && row.error === 'compile_failed' && row.importWallMs === undefined));
  assert.equal(report.artifacts[0].error, 'compile_failed'); assert.equal(report.totals.attempted, 0); assert.equal(report.totals.skipped, 3);
  assert.deepEqual(readdirSync(join(root, 'node_modules/.cache/shark')), []);
});

test('opt-in evaluation markers report only fixed approved modules', async t => {
  const root = fixture(t, `import { value } from '../lib/rewards/handlers'; if (value !== 1) throw new Error('fixture import'); export default null;`);
  const markedFile = join(root, 'lib/rewards/handlers.ts'); mkdirSync(dirname(markedFile), { recursive: true });
  writeFileSync(markedFile, "globalThis.__evaluated = [...(globalThis.__evaluated || []), 'unapproved-private-path']; export const value = 1;");
  const unmarked = await main(options(['--local', '--handlers=health', '--samples=1']), root);
  assert.equal(unmarked.rows[0].ok, true);
  assert.deepEqual(unmarked.rows[0].markers, []);
  const marked = await main(options(['--local', '--handlers=health', '--samples=1', '--markers']), root);
  assert.equal(marked.rows[0].ok, true);
  assert.deepEqual(marked.rows[0].markers, ['lib/rewards/handlers.ts']);
  assert(!JSON.stringify(marked).includes('unapproved-private-path'));
  assert.notEqual(marked.artifacts[0].artifactSha256, unmarked.artifacts[0].artifactSha256, 'instrumented artifacts are identified separately');
});

test('direct local CLI completes its awaited import and writes all samples', async t => {
  const root = fixture(t, 'export default null;');
  const output = join(root, 'local-report.json');
  const script = fileURLToPath(new URL('./perf-cold-start.mjs', import.meta.url));
  const result = await new Promise(resolve => {
    execFile(process.execPath, [script, '--local', '--handlers=health', '--samples=3', '--markers', `--output=${output}`], { cwd: root, timeout: 10000 }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.rows.length, 3);
  assert(report.rows.every(row => row.ok));
  assert.match(result.stdout, /^health import: observations=3 errors=0 skipped=0 require=/m);
});
