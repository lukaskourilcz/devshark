// Loopback servers and temporary files; never production.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PROBES, assertInventory, cacheAllowsMarker, main, options, originClassification, remoteSample, summaries, timingSpans } from './perf-cold-start.mjs';

const spans = 'auth_http;dur=0.0;desc="0 calls", app;dur=12.3, instance;desc="first", db_http;dur=5.0;desc="2 calls"';
async function server(t, handler) {
  const instance = createServer(handler); instance.listen(0, '127.0.0.1'); await once(instance, 'listening');
  t.after(() => new Promise(resolve => instance.close(resolve)));
  return `http://127.0.0.1:${instance.address().port}`;
}
test('cold-start CLI refuses unsafe origins/options before a connection', () => {
  for (const argv of [[], ['--url=https://x.test/private'], ['--url=https://user:pass@x.test'], ['--url=https://@x.test'], ['--url=https://x.test?'], ['--url=https://x.test/#'], ['--url=http://x.test'], ['--url=https://x.test', '--local'], ['--local', '--bypass-cache'], ['--local', '--samples=0'], ['--local', '--samples=11'], ['--local', '--samples=3x'], ['--local', '--handlers=wallet'], ['--local', '--handlers=health,health'], ['--url=https://x.test', '--interval-ms=0'], ['--url=https://x.test', '--markers'], ['--local', '--retry'], ['--local=true']]) assert.throws(() => options(argv));
  assert.equal(options(['--url=http://127.0.0.1:1234', '--interval-ms=0']).samples, 3);
  assert.equal(options(['--local']).ids.length, 12);
});
test('manifest names all twelve physical handlers and never silently walks a new one', t => {
  assert.equal(new Set(PROBES.map(probe => probe.file)).size, 12);
  assert.deepEqual(PROBES.map(({ file, path }) => [file, path]), [
    ['api/health.ts', '/api/health'], ['api/settings.ts', '/api/settings'],
    ['api/leaderboard.ts', '/api/leaderboard?period=global&limit=10'],
    ['api/quiz/questions.ts', '/api/quiz/questions?resource=curation'], ['api/quiz/roadmap.ts', '/api/quiz/roadmap'],
    ['api/quiz/challenge.ts', '/api/quiz/challenge?resource=__perf_probe__'], ['api/quiz/daily.ts', '/api/quiz/daily?qotd=__perf_probe__'],
    ['api/quiz/submit.ts', '/api/quiz/submit'], ['api/flashcards.ts', '/api/flashcards?subject=webdev'],
    ['api/user/[op].ts', '/api/user/__perf_probe__'], ['api/play/[action].ts', '/api/play/__perf_probe__'], ['api/admin/[op].ts', '/api/admin/__perf_probe__'],
  ], 'explicit business-safety manifest, never inferred arbitrary URLs');

  const root = mkdtempSync(join(tmpdir(), 'cold-inventory-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const probe of PROBES) { const file = join(root, probe.file); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'export default null;'); }
  assert.doesNotThrow(() => assertInventory(root));
  writeFileSync(join(root, 'api/extra.ts'), 'export default null;'); assert.throws(() => assertInventory(root));
});
test('duration spans are named, finite one-decimal values; malformed or duplicate spans are unknown', () => {
  assert.deepEqual(timingSpans(spans), { appMs: 12.3, dbHttpMs: 5, dbCalls: 2, authHttpMs: 0, authCalls: 0, marker: 'first', valid: true });
  for (const value of [undefined, 'app;dur=NaN', spans.replace('app;dur=', 'renamed;dur='), spans.replace('12.3', '12.3.4'), spans + ', app;dur=1.0']) assert.equal(timingSpans(value).valid, false);
  assert.equal(timingSpans('instance;desc="first,token"').marker, null);
});
test('public/cache-unknown/replayed answers cannot establish first origin invocation', () => {
  for (const value of [undefined, 'private', 'public,no-store', 'no-store,max-age=60', 'no-store,s-maxage=0', 'no-store,stale-while-revalidate=0', ['no-store', 'PUBLIC'], 'no-store,custom=1']) assert.equal(cacheAllowsMarker(value), false);
  for (const value of ['private,no-store', ['private', 'NO-STORE'], 'no-store,max-age="0"']) assert.equal(cacheAllowsMarker(value), true);
  for (const cache of ['HIT', 'STALE']) assert.deepEqual(originClassification({ 'x-vercel-cache': cache, 'server-timing': spans, 'cache-control': 'private,no-store' }), { cache, instance: 'replayed', timingStatus: 'replayed', spans: null });
  assert.equal(originClassification({ 'server-timing': spans, 'cache-control': 'no-store' }).instance, 'unknown');
  assert.equal(originClassification({ 'x-vercel-cache': 'MISS', 'server-timing': spans, 'cache-control': 'public,s-maxage=60' }).instance, 'unknown');
  assert.equal(originClassification({ 'x-vercel-cache': 'MISS', 'server-timing': spans, 'cache-control': 'private,no-store' }).instance, 'first');
  assert.equal(originClassification({ 'x-vercel-cache': 'MISS', 'server-timing': spans.replace('12.3', 'NaN'), 'cache-control': 'no-store' }).instance, 'unknown');
});
test('remote probes use only the fixed GETs, no credentials/body/proxy headers and fresh sockets', async t => {
  const seen = []; const sockets = new Set();
  const origin = await server(t, (req, res) => {
    seen.push({ method: req.method, path: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie, forwarded: req.headers['x-forwarded-for'], userAgent: req.headers['user-agent'] }); sockets.add(req.socket);
    const probe = PROBES.find(item => item.path === req.url); assert(probe);
    const [status, code] = probe.outcomes[0]; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private,no-store', 'X-Vercel-Cache': 'MISS', 'Server-Timing': spans, 'X-Vercel-Id': 'arn1::iad1::opaque-do-not-store', ...(probe.id === 'submit' ? { Allow: 'POST' } : {}) });
    res.end(JSON.stringify(code ? { error: { code, message: 'provider-token-do-not-store', requestId: 'opaque-do-not-store' } } : probe.id === 'health' ? { ok: true, status: 'healthy' } : {}));
  });
  const config = options([`--url=${origin}`, '--samples=1', '--interval-ms=0']);
  const report = await main(config);
  assert.equal(report.rows.length, 12); assert(report.rows.every(row => row.ok)); assert.deepEqual(report.totals, { planned: 12, attempted: 12, sent: 12, responses: 12, skipped: 0 });
  assert.equal(sockets.size, 12);
  assert.deepEqual(seen.map(item => item.path), PROBES.map(probe => probe.path));
  assert(seen.every(item => item.method === 'GET' && item.authorization === undefined && item.cookie === undefined && item.forwarded === undefined && item.userAgent === 'devShark-EpicF-cold-start/1'));
  assert(!JSON.stringify(report).includes('do-not-store'));
  assert(report.rows.every(row => row.region.join(',') === 'arn1,iad1'));
});
test('unexpected response/redirect has no fallback or automatic retry', async t => {
  let requests = 0;
  const origin = await server(t, (_req, res) => { requests++; res.writeHead(302, { Location: '/private?token=secret' }); res.end('secret body'); });
  const report = await main(options([`--url=${origin}`, '--handlers=health', '--samples=1', '--interval-ms=0']));
  assert.equal(requests, 1); assert.equal(report.rows[0].error, 'redirect_refused'); assert(!JSON.stringify(report).includes('secret'));
});
test('429 stops the remaining planned samples globally', async t => {
  let requests = 0;
  const origin = await server(t, (_req, res) => { requests++; res.writeHead(429); res.end(); });
  const report = await main(options([`--url=${origin}`, '--samples=3', '--interval-ms=0']));
  assert.equal(requests, 1); assert.equal(report.rows.filter(row => row.skipped).length, 35); assert.equal(report.totals.attempted, 1);
});
test('deadline and response-size bounds fail once without retries', async t => {
  let requests = 0;
  const origin = await server(t, (_req, res) => { requests++; setTimeout(() => res.end('{}'), 250); });
  const timeout = await remoteSample(origin, PROBES[0], { timeoutMs: 100 });
  assert.equal(timeout.error, 'timeout'); assert(requests <= 1, 'deadline failure cannot trigger retries');
  const big = await server(t, (_req, res) => res.end(Buffer.alloc(1024 * 1024 + 1)));
  assert.equal((await remoteSample(big, PROBES[0])).error, 'response_too_large');
});

test('cache-busting nonce is restricted to four proven public resource branches', async t => {
  const nonces = [];
  const origin = await server(t, (req, res) => {
    const url = new URL(req.url, 'http://fixture'); const nonce = url.searchParams.get('__perf_probe'); url.searchParams.delete('__perf_probe');
    const path = url.pathname + (url.search ? url.search : ''); const probe = PROBES.find(item => item.path === path); assert(probe);
    nonces.push({ id: probe.id, present: nonce !== null });
    const [status, code] = probe.outcomes[0]; res.writeHead(status, { 'Content-Type': 'application/json', ...(probe.id === 'submit' ? { Allow: 'POST' } : {}) }); res.end(JSON.stringify(code ? { error: { code } } : probe.id === 'health' ? { ok: true, status: 'healthy' } : {}));
  });
  const report = await main(options([`--url=${origin}`, '--samples=1', '--interval-ms=0', '--bypass-cache']));
  assert(report.rows.every(row => row.ok));
  assert.deepEqual(nonces.filter(item => item.present).map(item => item.id), ['settings', 'leaderboard', 'questions', 'roadmap']);
});
test('method-refusal probe also requires its exact Allow contract', async t => {
  const origin = await server(t, (_req, res) => { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'method_not_allowed' } })); });
  const result = await remoteSample(origin, PROBES.find(probe => probe.id === 'submit'));
  assert.equal(result.ok, false); assert.equal(result.error, 'unexpected_response');
});

test('a200 HTML protection/error page is not an accepted API measurement', async t => {
  const origin = await server(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>private login</p>'); });
  const result = await remoteSample(origin, PROBES[0]);
  assert.equal(result.ok, false); assert.equal(result.error, 'unexpected_response'); assert(!JSON.stringify(result).includes('private login'));
});

test('successful reads require complete JSON objects without an error envelope', async t => {
  for (const body of ['{broken', 'null', '[]', JSON.stringify({ error: { code: 'unexpected_private_error' } })]) {
    const origin = await server(t, (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body);
    });
    const result = await remoteSample(origin, PROBES.find(probe => probe.id === 'settings'));
    assert.equal(result.ok, false);
    assert.equal(result.error, 'unexpected_response');
    assert(!JSON.stringify(result).includes('unexpected_private_error'));
  }
  const origin = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ publicPayload: 'x'.repeat(10000) }));
  });
  assert.equal((await remoteSample(origin, PROBES.find(probe => probe.id === 'settings'))).ok, true, 'valid public JSON larger than the error-prefix bound remains measurable');
});

test('a body timeout retains the status of response headers already received', async t => {
  const origin = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders();
  });
  const result = await remoteSample(origin, PROBES[0], { timeoutMs: 100 });
  assert.equal(result.error, 'timeout');
  assert.equal(result.status, 200);
  assert.equal(typeof result.raw.headersMs, 'number');
});

test('summary median averages the middle pair for an even number of successful samples', () => {
  const rows = [1, 3].map(firstByteMs => ({ handler: 'health', ok: true, status: 200, cache: 'MISS', instance: 'repeat', timingStatus: 'parsed', spans: { appMs: firstByteMs }, raw: { firstByteMs } }));
  const result = summaries(rows)[0];
  assert.deepEqual(result.clientFirstByteMs, { samples: 2, median: 2, min: 1, max: 3 });
  assert.deepEqual(result.classes[0].originAppMs, { samples: 2, median: 2, min: 1, max: 3 });
});

async function cli(args) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./perf-cold-start.mjs', import.meta.url)), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

test('direct CLI prints measured handler rows, writes its JSON and uses a distinct usage exit code', async t => {
  const invalid = await cli([]);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /choose exactly one/);
  const dir = mkdtempSync(join(tmpdir(), 'cold-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'report.json');
  const origin = await server(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private,no-store', 'X-Vercel-Cache': 'MISS', 'Server-Timing': spans });
    res.end(JSON.stringify({ ok: true, status: 'healthy' }));
  });
  const result = await cli([`--url=${origin}`, '--handlers=health', '--samples=1', '--interval-ms=0', `--output=${output}`]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^health read: observations=1 errors=0 skipped=0 client-first-byte=/m);
  const report = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].ok, true);
  assert.deepEqual(report.totals, { planned: 1, attempted: 1, sent: 1, responses: 1, skipped: 0 });
});
