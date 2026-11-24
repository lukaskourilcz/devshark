// Disposable transport and SDK doubles. These controls never contact a provider.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devshark-grading-operations-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('all ten anonymous submissions use only the approved frontdoor, with credentials omitted from the receipt', t => {
  const dir = fixture(t);
  const bundle = join(dir, 'load.mjs');
  execFileSync('esbuild', [join(root, 'scripts/check-grading-load.ts'), '--bundle', '--platform=node', '--format=esm', '--packages=external', `--outfile=${bundle}`, '--log-level=warning']);
  const host = 'grading-fixture.vercel.app';
  const token = 'eyJtb2NrIjoxfQ.eyJtb2NrIjoyfQ.bW9jaw';
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ origins: [], cookies: [{ name: '_vercel_jwt', value: token, domain: host, path: '/', expires: -1, secure: true, httpOnly: true, sameSite: 'Lax' }] }), { mode: 0o600 });
  const preload = join(dir, 'transport.mjs');
  writeFileSync(preload, `import assert from 'node:assert/strict';
let gets = 0, posts = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url.origin, 'https://${host}');
  assert.equal(options.redirect, 'error');
  const headers = new Headers(options.headers);
  assert.equal(headers.get('cookie'), '_vercel_jwt=${token}');
  assert.equal(headers.get('authorization'), null);
  if (options.method === 'POST') {
    posts++; assert.equal(JSON.parse(options.body).session, 'synthetic-session');
    return Response.json({verdict:'passed',xpAwarded:0,applied:false});
  }
  gets++; return Response.json({session:'synthetic-session'});
};
process.on('beforeExit', () => assert.deepEqual([gets, posts],[10,10]));`);
  const output = execFileSync(process.execPath, ['--import', preload, bundle], { cwd: dir, env: { SMOKE_BASE_URL: `https://${host}`, SMOKE_PREVIEW_STATE: state }, encoding: 'utf8' });
  const report = readFileSync(join(dir, 'artifacts/grading-load.json'), 'utf8');
  assert.equal(JSON.parse(report).samples.length, 10);
  for (const secret of [token, 'synthetic-session']) assert.ok(!output.includes(secret) && !report.includes(secret));
});

test('temporary snapshots use the requested TTL, release defaults persist, invalid duration starts no VM', t => {
  const dir = fixture(t);
  const preload = join(dir, 'sdk.mjs');
  const sdk = join(dir, 'fixture-sdk.mjs');
  writeFileSync(preload, `import {registerHooks} from 'node:module'; import {pathToFileURL} from 'node:url';
registerHooks({ resolve(name, ctx, next) { return name === '@vercel/sandbox' ? {url:pathToFileURL(${JSON.stringify(sdk)}).href,shortCircuit:true} : next(name,ctx); } });`);
  writeFileSync(sdk, `export const Sandbox = { create: async () => { console.log('fixture:create');return { writeFiles:async()=>{},runCommand:async()=>({exitCode:0}),snapshot:async({expiration})=>({snapshotId:'ttl-'+expiration}),stop:async()=>{ console.log('fixture:stop'); } }; } };`);
  const run = value => spawnSync(process.execPath, ['--import', preload, join(root, 'scripts/prepare-react-snapshot.mjs')], { cwd: root, env: value === undefined ? {} : { REACT_SNAPSHOT_TTL_HOURS:value }, encoding:'utf8' });
  for (const [input, milliseconds] of [['1', 3_600_000], [undefined, 0]]) {
    const result = run(input);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`REACT_RUNNER_SNAPSHOT_ID=ttl-${milliseconds}\\nfixture:stop`));
  }
  for (const input of ['', '0', '-1', '0.5', '1e4', '9007199254740991']) {
    const result = run(input);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be a positive whole number/);
    assert.ok(!result.stdout.includes('fixture:create'));
  }
});
