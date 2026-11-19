// Draft only: synthetic state and loopback transport, never a real share/JWT.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PROBES, options } from './perf-cold-start.mjs';

const ORIGIN = 'https://fixture-only-preview.vercel.app';
const TOKEN = 'eyJmaXh0dXJlIjoiZnJvbnRkb29yIn0.eyJleHAiOjQxMDI0NDQ4MDB9.c2lnbmF0dXJl';
const cookie = () => ({ name: '_vercel_jwt', value: TOKEN, domain: 'fixture-only-preview.vercel.app', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' });
const state = () => ({ cookies: [cookie()], origins: [] });
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cold-preview-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const probe of PROBES) { const file = join(root, probe.file); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'export default null;'); }
  return root;
}
function save(root, value, text = false) {
  const file = join(root, 'approved-state.json');
  writeFileSync(file, text ? value : JSON.stringify(value), { mode: 0o600 });
  return file;
}

test('optional state is remote-only and preserves strict bare-origin/flag parsing', () => {
  assert.equal(options([`--url=${ORIGIN}`, '--preview-state=/owned/state.json']).previewState, '/owned/state.json');
  for (const args of [
    ['--local', '--preview-state=/owned/state.json'],
    ['--url=http://127.0.0.1:1234', '--preview-state=/owned/state.json'],
    ['--url=https://devshark.app', '--preview-state=/owned/state.json'],
    [`--url=${ORIGIN}?_vercel_share=not-accepted-here`, '--preview-state=/owned/state.json'],
    [`--url=${ORIGIN}`, '--preview-state='],
    [`--url=${ORIGIN}`, '--preview-state=/one', '--preview-state=/two'],
    [`--url=${ORIGIN}`, '--cookie=not-supported'],
    [`--url=${ORIGIN}`, '--headers=not-supported'],
  ]) assert.throws(() => options(args));
});

test('state is exact-origin frontdoor only, with no app cookies or localStorage', async t => {
  const { loadPreviewAccess } = await import('./cold-start-preview-access.mjs');
  const root = fixture(t);
  const file = save(root, state());
  const access = loadPreviewAccess(ORIGIN, file);
  assert.deepEqual(access.headersFor(new URL('/api/health', ORIGIN)), { Cookie: `_vercel_jwt=${TOKEN}`, 'x-vercel-skip-toolbar': '1' });
  assert(!JSON.stringify(access).includes(TOKEN));
  for (const target of ['https://other-preview.vercel.app/api/health', 'https://fixture-only-preview.vercel.app.evil.test/api/health', 'https://devshark.app/api/health', 'http://fixture-only-preview.vercel.app/api/health']) assert.throws(() => access.headersFor(new URL(target)));
  access.dispose(); assert.throws(() => access.headersFor(new URL('/api/health', ORIGIN)));
  assert.equal(readFileSync(file, 'utf8'), JSON.stringify(state()), 'input state is never rewritten');
});

test('invalid/mixed/expired state and unsafe cookie values fail without echoing content', async t => {
  const { loadPreviewAccess } = await import('./cold-start-preview-access.mjs');
  const root = fixture(t);
  const invalid = [
    { ...state(), origins: [{ origin: ORIGIN, localStorage: [{ name: 'sb-auth-token', value: TOKEN }] }] },
    { ...state(), cookies: [cookie(), { ...cookie(), name: 'sb-auth-token' }] },
    { ...state(), authorization: TOKEN },
    ...[
      { name: 'sb-auth-token' }, { domain: '.vercel.app' }, { domain: '.fixture-only-preview.vercel.app' }, { domain: 'other-preview.vercel.app' },
      { path: '/api' }, { secure: false }, { httpOnly: false }, { expires: 1 }, { sameSite: 'None' },
      { value: 'x'.repeat(8193) }, { value: TOKEN + '; sb-auth-token=private' }, { value: TOKEN + '\r\nAuthorization: private' }, { value: 'not-a-jwt' },
    ].map(change => ({ cookies: [{ ...cookie(), ...change }], origins: [] })),
  ];
  for (const value of invalid) {
    const file = save(root, value);
    assert.throws(() => loadPreviewAccess(ORIGIN, file), error => error.message === 'invalid protected Preview access state' && !String(error.stack).includes(TOKEN));
  }
  for (const text of ['{broken', 'x'.repeat(32769)]) assert.throws(() => loadPreviewAccess(ORIGIN, save(root, text, true)));
  const file = save(root, state()); chmodSync(file, 0o644); assert.throws(() => loadPreviewAccess(ORIGIN, file));
  chmodSync(file, 0o600); const link = join(root, 'state-link.json'); symlinkSync(file, link); assert.throws(() => loadPreviewAccess(ORIGIN, link));
});

async function cli(root, args, preload, timeout = 10000) {
  const script = fileURLToPath(new URL('./perf-cold-start.mjs', import.meta.url));
  return new Promise(resolve => execFile(process.execPath, [...(preload ? ['--import', preload] : []), script, ...args], { cwd: root, timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({ code: error ? error.code ?? (error.killed ? 'TIMEOUT' : 'FAILED') : 0, stdout, stderr })));
}

function transportFixture(root, loopback) {
  const preload = join(root, 'transport-fixture.mjs');
  writeFileSync(preload, `import http from 'node:http'; import https from 'node:https';
    https.request = (url, options, callback) => {
      if (url.origin !== ${JSON.stringify(ORIGIN)} || options.method !== 'GET') throw new Error('fixture transport refused');
      return http.request(new URL(url.pathname + url.search, ${JSON.stringify(loopback)}), { ...options, agent: new http.Agent({ keepAlive: false, proxyEnv: {} }) }, callback);
    };
    const timeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...args) => timeout(fn, ms === 1100 ? 0 : ms, ...args);
  `);
  return preload;
}

test('direct protected-preview CLI sends exactly 36 fixed API samples and no exchange/document requests', async t => {
  const root = fixture(t); const file = save(root, state()); const output = join(root, 'report.json');
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, path: request.url, headers: request.headers });
    const probe = PROBES.find(item => item.path === request.url); assert(probe, 'fixed probe only');
    const [status, code] = probe.outcomes[0];
    response.writeHead(status, { 'Content-Type': 'application/json', ...(probe.id === 'submit' ? { Allow: 'POST' } : {}),
      // A sample response must never expand the collector into an app-cookie jar.
      'Set-Cookie': 'sb-auth-token=private-application-session; Path=/; Secure' });
    response.end(JSON.stringify(code ? { error: { code } } : probe.id === 'health' ? { ok: true, status: 'healthy' } : {}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const loopback = `http://127.0.0.1:${server.address().port}`;
  // Test-only adapter: logical HTTPS Preview requests terminate on loopback.
  // The collector gets no generic transport/header flag and cannot use this hook.
  const preload = transportFixture(root, loopback);
  const result = await cli(root, [`--url=${ORIGIN}`, '--samples=3', '--interval-ms=1100', `--preview-state=${file}`, `--output=${output}`], preload);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(seen.length, 36); assert(seen.every(row => row.method === 'GET' && row.path.startsWith('/api/')));
  assert(seen.every(row => row.headers.cookie === `_vercel_jwt=${TOKEN}` && row.headers['x-vercel-skip-toolbar'] === '1' && !row.headers.authorization));
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.frontdoorAccess.exchangeRequests, 0);
  assert.deepEqual(report.totals, { planned: 36, attempted: 36, sent: 36, responses: 36, skipped: 0 });
  assert(!JSON.stringify(report).includes(TOKEN)); assert(!result.stdout.includes(TOKEN)); assert(!result.stderr.includes(TOKEN));
  assert(!JSON.stringify(report).includes(file)); assert(!JSON.stringify(report).includes('private-application-session'));
});

test('direct CLI refuses bad state/output collision before transport and redacts all input', async t => {
  const root = fixture(t); const file = save(root, { ...state(), authorization: TOKEN });
  const preload = join(root, 'deny-transport.mjs');
  writeFileSync(preload, "import https from 'node:https'; https.request = () => { process.stderr.write('TRANSPORT_CALLED'); throw new Error('fixture refused'); };");
  const result = await cli(root, [`--url=${ORIGIN}`, '--samples=1', `--preview-state=${file}`, `--output=${join(root, 'report.json')}`], preload);
  assert.equal(result.code, 2); assert(!result.stderr.includes('TRANSPORT_CALLED'));
  assert(!result.stderr.includes(TOKEN)); assert(!result.stdout.includes(TOKEN)); assert(!result.stderr.includes(file));
  save(root, state());
  const hardlink = join(root, 'state-hardlink.json'); linkSync(file, hardlink);
  const symlink = join(root, 'state-output-link.json'); symlinkSync(file, symlink);
  for (const output of [file, hardlink, symlink]) {
    const collision = await cli(root, [`--url=${ORIGIN}`, '--samples=1', `--preview-state=${file}`, `--output=${output}`], preload);
    assert.equal(collision.code, 2); assert(!collision.stderr.includes('TRANSPORT_CALLED'));
    assert(!collision.stderr.includes(TOKEN)); assert(!collision.stderr.includes(file));
    assert.equal(readFileSync(file, 'utf8'), JSON.stringify(state()));
  }
});

test('a named pipe cannot block the regular-file access-state check', async t => {
  const root = fixture(t); const pipe = join(root, 'state-pipe.json');
  await new Promise((resolve, reject) => execFile('mkfifo', [pipe], error => error ? reject(error) : resolve()));
  chmodSync(pipe, 0o600);
  const preload = join(root, 'deny-transport.mjs');
  writeFileSync(preload, "import https from 'node:https'; https.request = () => { process.stderr.write('TRANSPORT_CALLED'); throw new Error('fixture refused'); };");
  const result = await cli(root, [`--url=${ORIGIN}`, '--samples=1', `--preview-state=${pipe}`, `--output=${join(root, 'report.json')}`], preload, 1000);
  assert.equal(result.code, 2, 'non-regular state must be refused, not time out while opening');
  assert(!result.stderr.includes('TRANSPORT_CALLED')); assert(!result.stderr.includes(pipe));
});

test('an output alias introduced during sampling cannot overwrite the input state', async t => {
  for (const kind of ['hardlink', 'symlink']) {
    const root = fixture(t); const file = save(root, state()); const output = join(root, 'report.json');
    const server = createServer((_request, response) => {
      if (kind === 'hardlink') linkSync(file, output); else symlinkSync(file, output);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, status: 'healthy' }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const preload = transportFixture(root, `http://127.0.0.1:${server.address().port}`);
    const result = await cli(root, [`--url=${ORIGIN}`, '--handlers=health', '--samples=1', `--preview-state=${file}`, `--output=${output}`], preload);
    assert.deepEqual({ code: result.code, statePreserved: readFileSync(file, 'utf8') === JSON.stringify(state()) }, { code: 2, statePreserved: true }, `${kind} created after preflight must be refused at the final writer`);
    assert(!result.stdout.includes(TOKEN)); assert(!result.stderr.includes(TOKEN)); assert(!result.stderr.includes(file));
  }
});
