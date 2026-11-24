import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { headerNames, readVercelConfig, vercelAnswer } from '../scripts/vercel-headers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// A built client in miniature: one file of each kind vercel.json routes.
const APP_DOCUMENT = '<!doctype html><title>devShark fixture app</title>\n';
const SITE = {
  'index.html': '<!doctype html><title>devShark fixture home</title>\n',
  'app.html': APP_DOCUMENT,
  'assets/main-x.js': 'export {};\n',
  'assets/main-x.js.map': '{"version":3,"sources":[],"mappings":""}\n',
  'assets/coding-worker/worker-x.js': 'self.onmessage = () => {};\n',
  'sandbox/index.html': '<!doctype html><title>sandbox fixture</title>\n',
  'sandbox/assets/index-x.js': 'export {};\n',
  'brand/x.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
  'premium/index.html': '<!doctype html><title>premium fixture</title>\n',
  'coding/javascript/js-double-numbers/index.html': '<!doctype html><title>task fixture</title>\n',
};

/** Starts docker/server.mjs over a scratch client/dist holding `files`.
 * Lines the adapter writes to stderr also land in `stderr`. `vercelConfig`
 * replaces the repository's vercel.json in the scratch copy; `env` adds to
 * the adapter's environment. */
async function startAdapter(t, { files = {}, stderr = [], vercelConfig, env = {} } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'devshark-docker-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const handlers = join(scratch, 'docker/dist/api');
  await Promise.all([
    mkdir(join(scratch, 'client/dist'), { recursive: true }),
    mkdir(join(handlers, 'user'), { recursive: true }),
  ]);
  await Promise.all(Object.keys(files).map((file) => mkdir(dirname(join(scratch, 'client/dist', file)), { recursive: true })));
  await Promise.all([
    ...['docker/server.mjs', 'package.json', ...(vercelConfig ? [] : ['vercel.json'])].map((file) =>
      copyFile(join(root, file), join(scratch, file))),
    ...(vercelConfig ? [writeFile(join(scratch, 'vercel.json'), JSON.stringify(vercelConfig))] : []),
    ...Object.entries(files).map(([file, body]) => writeFile(join(scratch, 'client/dist', file), body)),
    writeFile(join(handlers, 'manifest.json'), '["probe.cjs","user/[op].cjs"]'),
    // A dynamic segment, which the adapter decodes into the query.
    writeFile(join(handlers, 'user/[op].cjs'), 'module.exports = (req, res) => res.json({ op: req.query.op });\n'),
    build({
      stdin: {
        contents: `
          import { checkRateLimit } from './lib/rate-limit.ts';
          export default (req, res) => {
            if (req.method === 'POST') return res.json({ size: req.body.length });
            if (checkRateLimit(req, res, { key: 'fixture', capacity: 2, refillPerSecond: 1 / 3600 })) {
              res.json({ ok: true });
            }
          };
        `,
        resolveDir: root,
      },
      platform: 'node',
      format: 'cjs',
      bundle: true,
      packages: 'external',
      outfile: join(handlers, 'probe.cjs'),
    }),
  ]);

  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const { port } = reservation.address();
  await new Promise((resolve) => reservation.close(resolve));

  const server = spawn(process.execPath, ['docker/server.mjs'], {
    cwd: scratch,
    env: { ...env, NODE_PATH: join(root, 'node_modules'), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: server.stdout });
  createInterface({ input: server.stderr }).on('line', (line) => {
    stderr.push(line);
    process.stderr.write(`${line}\n`);
  });
  const closed = once(server, 'close');
  t.after(async () => {
    lines.close();
    server.kill();
    await closed;
  });
  await Promise.race([
    once(lines, 'line', { signal: AbortSignal.timeout(5_000) }),
    closed.then(([code]) => { throw new Error(`Docker adapter exited with code ${code}`); }),
  ]);
  return `http://127.0.0.1:${port}`;
}

test('Docker API uses the peer address even when a client spoofs proxy headers', async (t) => {
  const url = `${await startAdapter(t)}/api/probe`;
  const statuses = [];
  for (const headers of [
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-for': '192.0.2.2' },
    { 'x-real-ip': '192.0.2.3' },
    {},
  ]) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    statuses.push(response.status);
    await response.arrayBuffer();
  }
  assert.deepEqual(statuses, [200, 200, 429, 429, 429, 429]);
});

test('Docker API answers 413 as soon as a body crosses the limit', async (t) => {
  const url = `${await startAdapter(t)}/api/probe`;
  const limit = 4.5 * 1024 * 1024;
  const atLimit = await fetch(url, {
    method: 'POST',
    body: Buffer.alloc(limit),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(atLimit.status, 200);
  assert.deepEqual(await atLimit.json(), { size: limit });

  const oversized = Buffer.alloc(limit + 1);
  const knownLength = await fetch(url, {
    method: 'POST',
    body: oversized,
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(knownLength.status, 413);
  assert.equal(knownLength.headers.get('connection'), 'close');
  await knownLength.arrayBuffer();

  // Leave the chunked request open: the server must answer without waiting
  // for the sender to finish an oversized body.
  const chunked = await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', signal: AbortSignal.timeout(5_000) }, (res) => {
      res.once('end', () => resolve([res.statusCode, res.headers.connection]));
      res.once('error', reject);
      res.resume();
    });
    req.once('error', reject);
    req.write(oversized);
  });
  assert.deepEqual(chunked, [413, 'close']);
});

// The adapter reads vercel.json itself, so a header rule cannot be missing
// from it, but the phases can: which rules run before the filesystem check,
// which only once a file matched, and what answers a path with no file.
// scripts/vercel-headers.mjs models Vercel's answer from the same vercel.json.
const config = readVercelConfig(root);
const isSiteFile = (pathname) => Object.hasOwn(SITE, pathname.slice(1));

/** Requests `pathname` and compares the status and every header name
 * vercel.json sets with Vercel's answer under `vercelConfig`. Returns the body.
 * The request says it came over HTTPS, as every request to Vercel does. */
async function assertVercelAnswer(origin, pathname, vercelConfig = config) {
  const expected = vercelAnswer(vercelConfig, pathname, isSiteFile);
  const response = await fetch(origin + pathname, {
    redirect: 'manual',
    headers: { 'x-forwarded-proto': 'https' },
    signal: AbortSignal.timeout(5_000),
  });
  const body = await response.text();
  if (expected.status !== null) assert.equal(response.status, expected.status, `${pathname} (${expected.ends}): status`);
  for (const name of headerNames(vercelConfig)) {
    const actual = response.headers.get(name) ?? undefined;
    if (name === 'cache-control' && expected.headers[name] === undefined) {
      // vercel.json leaves this one to the server: Vercel sends
      // public, max-age=0, must-revalidate, the adapter no-cache on HTML.
      assert.ok(actual === undefined || actual === 'no-cache', `${pathname}: vercel.json sets no Cache-Control, the adapter sent ${actual}`);
      continue;
    }
    assert.equal(actual, expected.headers[name], `${pathname} (${expected.ends}): ${name}`);
  }
  return { response, body };
}

test('app document headers support provider popups and keep exercise asset sharing scoped', async (t) => {
  const origin = await startAdapter(t, { files: SITE });
  for (const path of ['/', '/coding/javascript/js-double-numbers', '/premium/index.html']) {
    const { headers } = await fetch(origin + path);
    assert.match(headers.get('content-security-policy'), /(?:^|; )object-src 'none'(?:;|$)/);
    assert.equal(headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.equal(headers.get('cross-origin-resource-policy'), 'same-origin');
  }
  for (const [path, cors] of [
    ['/assets/main-x.js', 'https://devshark.app'],
    ['/assets/coding-worker/worker-x.js', 'https://devshark.app'],
    ['/sandbox/index.html', '*'],
    ['/sandbox/assets/index-x.js', '*'],
    ['/brand/x.svg', 'https://devshark.app'],
    ['/api/probe', null],
  ]) {
    const { headers } = await fetch(origin + path);
    assert.equal(headers.get('access-control-allow-origin'), cors, path);
    assert.equal(headers.get('cross-origin-opener-policy'), null, path);
    assert.equal(headers.get('cross-origin-resource-policy'), path.includes('coding-worker') || path.startsWith('/api/') ? 'same-origin' : null, path);
  }
});

test('Docker answers each path with the headers vercel.json gives it on Vercel', async (t) => {
  const origin = await startAdapter(t, { files: SITE });
  const paths = [
    '/', '/premium', '/coding/javascript/js-double-numbers',
    ...Object.keys(SITE).map((file) => `/${file}`),
    '/cs/topics', '/roadmap/specializations/fde', '/assets/missing-x.js', '/api/probe',
  ];
  for (const pathname of paths) await assertVercelAnswer(origin, pathname);
});

// The header routes match the raw path, so an encoded ../ must not reach a
// file the raw path does not name: /assets/coding-worker/..%2f..%2findex.html
// served the app document under the worker's policy (no frame-ancestors, no
// X-Frame-Options) with a year-long immutable cache. Vercel answers 404.
for (const pathname of ['/assets/coding-worker/..%2f..%2findex.html', '/sandbox/..%2findex.html']) {
  test(`Docker serves no file through an encoded ../ (${pathname})`, async (t) => {
    const origin = await startAdapter(t, { files: SITE });
    const { response, body } = await assertVercelAnswer(origin, pathname);
    assert.equal(response.status, 404);
    assert.notEqual(body, APP_DOCUMENT, 'the app document must not answer under another path\'s policy');
  });
}

// A rewrite is a check route: when its destination is no file, Vercel goes on
// to the next rewrite with the rewritten path, and a path nothing serves gets
// Vercel's own plain-text 404. The adapter took the first matching rewrite
// only and answered everything else with index.html, so it ran the app under
// the sandbox policy at /sandbox/<missing> and refused a task page the build
// did not prerender, which Vercel serves with the app (C3-17).
test('Docker tries the rewrites in order and answers a page nothing serves with a plain 404', async (t) => {
  const origin = await startAdapter(t, { files: SITE });
  for (const pathname of ['/sandbox/nope', '/topics/a/b']) {
    const { response, body } = await assertVercelAnswer(origin, pathname);
    assert.equal(response.status, 404, `${pathname}: status`);
    assert.match(response.headers.get('content-type') ?? '', /^text\/plain/, `${pathname}: content type`);
    assert.notEqual(body, APP_DOCUMENT, `${pathname} must not answer with the app document`);
  }
  const { response, body } = await assertVercelAnswer(origin, '/coding/javascript/no-such-task');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(body, APP_DOCUMENT, 'a task page with no prerendered file gets the app, which says the task does not exist');
});

// Vercel refuses a path whose percent escapes do not decode before any route
// runs: 400 over HTTP/1.1, a reset stream over HTTP/2. decodeURIComponent threw
// in the adapter instead, so each such request answered 500 without the
// security headers and wrote an error line to the log.
test('Docker answers a malformed percent escape with 400 and logs no error', async (t) => {
  const stderr = [];
  const origin = await startAdapter(t, { files: SITE, stderr });
  for (const pathname of ['/assets/%E0%A4%A.js', '/premium/%E0%A4%A', '/api/user/%E0%A4%A']) {
    const response = await fetch(origin + pathname, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    await response.arrayBuffer();
    assert.equal(response.status, 400, `${pathname}: status`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${pathname} keeps the main-phase headers`);
  }
  // A path parameter that decodes still reaches the handler.
  const decoded = await fetch(`${origin}/api/user/caf%C3%A9`, { signal: AbortSignal.timeout(5_000) });
  assert.deepEqual(await decoded.json(), { op: 'café' });
  assert.deepEqual(stderr.filter((line) => line.includes('"level":"error"')), [], 'no error lines in the log');
});

// A main-phase route with a status and neither a Location nor a dest ends the
// request on Vercel, as the filesystem-phase 404 does. The adapter skipped
// such a route and served the file, so a rule that blocks the public source
// maps would hold on Vercel and not in the image.
test('Docker answers a status-only route before the filesystem check', async (t) => {
  const routes = structuredClone(config.routes);
  routes.splice(routes.findIndex((route) => route.handle === 'filesystem'), 0, {
    src: '^/(?:sandbox/)?assets/.+\\.map$',
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });
  const blocksMaps = { ...config, routes };
  const origin = await startAdapter(t, { files: SITE, vercelConfig: blocksMaps });
  const { response, body } = await assertVercelAnswer(origin, '/assets/main-x.js.map', blocksMaps);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store', 'the route\'s own header, not the immutable asset cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', 'the main-phase headers before it');
  assert.notEqual(body, SITE['assets/main-x.js.map'], 'the map is not served');
  // The script next to it is still a file with the year-long cache.
  const { response: script } = await assertVercelAnswer(origin, '/assets/main-x.js', blocksMaps);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('cache-control') ?? '', /immutable/);
});

// upgrade-insecure-requests makes the browser fetch every same-origin
// subresource over https, and browsers exempt only loopback. With the token in
// the app policy, the image reached over plain HTTP at a LAN address loaded
// none of its scripts (9 of 10 requests failed with ERR_SSL_PROTOCOL_ERROR).
// The adapter keeps the token only for a request that came over TLS or through
// a proxy that says it did.
test('Docker drops upgrade-insecure-requests from the CSP of a plain-HTTP request', async (t) => {
  const TOKEN = 'upgrade-insecure-requests';
  const routes = structuredClone(config.routes);
  for (const route of routes) {
    const csp = route.headers?.['Content-Security-Policy'];
    if (csp && !csp.includes(TOKEN)) route.headers['Content-Security-Policy'] = `${csp}; ${TOKEN}`;
  }
  const upgrades = { ...config, routes };
  const origin = await startAdapter(t, { files: SITE, vercelConfig: upgrades });
  for (const pathname of ['/', '/assets/main-x.js', '/sandbox/index.html', '/assets/missing-x.js', '/sandbox/nope']) {
    const plain = await fetch(origin + pathname, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    await plain.arrayBuffer();
    const withoutToken = vercelAnswer(config, pathname, isSiteFile).headers['content-security-policy']?.split('; ').filter(directive => directive !== TOKEN).join('; ');
    assert.equal(plain.headers.get('content-security-policy'), withoutToken, `${pathname} over plain HTTP: the policy without ${TOKEN}`);

    const { response: forwarded } = await assertVercelAnswer(origin, pathname, upgrades);
    assert.ok(forwarded.headers.get('content-security-policy')?.endsWith(`; ${TOKEN}`), `${pathname} behind an HTTPS proxy keeps ${TOKEN}`);
  }
});

// The Dockerfile sets CSP_CONNECT_EXTRA to VITE_SUPABASE_URL, an http(s)
// origin. Play rooms subscribe to Supabase Realtime over ws(s) on the same
// host, so with only the http source the browser blocked the socket and Play
// fell back to polling. Each http(s) source brings its socket source along.
test('Docker adds the realtime socket of each origin CSP_CONNECT_EXTRA names', async (t) => {
  const origin = await startAdapter(t, {
    files: SITE,
    env: { CSP_CONNECT_EXTRA: 'http://127.0.0.1:54321 https://local-ref.supabase.example:8443/' },
  });
  const response = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5_000) });
  await response.arrayBuffer();
  const connect = /(?:^|;)\s*connect-src ([^;]*)/.exec(response.headers.get('content-security-policy') ?? '')?.[1].split(/\s+/) ?? [];
  for (const source of [
    'http://127.0.0.1:54321', 'ws://127.0.0.1:54321',
    'https://local-ref.supabase.example:8443/', 'wss://local-ref.supabase.example:8443',
  ]) assert.ok(connect.includes(source), `the app connect-src allows ${source}: ${connect.join(' ')}`);
});

// CSP_CONNECT_EXTRA is there so the app can sign in against a Supabase that is
// not *.supabase.co. The adapter appended it to every connect-src, so the
// coding worker, which runs learner code and talks to nothing but its own
// origin on Vercel, could also reach that Supabase and its socket.
test('Docker keeps the coding worker policy as vercel.json sets it when CSP_CONNECT_EXTRA is set', async (t) => {
  const origin = await startAdapter(t, { files: SITE, env: { CSP_CONNECT_EXTRA: 'http://127.0.0.1:54321' } });
  for (const pathname of ['/assets/coding-worker/worker-x.js', '/assets/coding-worker/missing.js']) {
    const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(5_000) });
    await response.arrayBuffer();
    const expected = vercelAnswer(config, pathname, isSiteFile).headers['content-security-policy'];
    assert.equal(response.headers.get('content-security-policy'), expected, `${pathname}: the worker policy`);
  }
});

// Retiring an asset must also block an old copied file before filesystem/fallback.
test('the retired public triage URL is never served from a copied asset', async (t) => {
  const origin = await startAdapter(t, { files: { 'triage-verdicts.json': '{"verdicts":{"private":"reviewer-note-canary"}}' } });
  const filename = 'triage-verdicts.json';
  const encoded = [...filename].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');
  const aliases = ['/triage-verdicts.json', '/%74riage-verdicts.json', '/triage-verdicts%2ejson', '/triage-verdicts%2Ejson', `/${encoded}`, `/${encoded.toUpperCase()}`];
  for (const method of ['GET', 'HEAD']) for (const alias of aliases) for (const query of ['', '?old=1']) {
    await t.test(`${method} ${alias}${query}`, async () => {
      const response = await fetch(`${origin}${alias}${query}`, { method });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), '');
    });
  }
});

test('retiring triage preserves other encoded files and ordinary missing-path behavior', async (t) => {
  const files = { ...SITE, 'café.json': 'public unicode filename', 'triage%2dverdicts.json': 'public literal percent filename', 'triage-verdicts.json.backup': 'public distinct filename' };
  const origin = await startAdapter(t, { files });
  for (const [pathname, body] of [
    ['/caf%C3%A9.json', files['café.json']],
    ['/triage%252dverdicts.json', files['triage%2dverdicts.json']],
    ['/triage-verdicts.json.backup', files['triage-verdicts.json.backup']],
    ['/ordinary-missing-page', APP_DOCUMENT],
  ]) {
    const response = await fetch(origin + pathname);
    assert.equal(response.status, 200, pathname);
    assert.equal(await response.text(), body, pathname);
  }
});
