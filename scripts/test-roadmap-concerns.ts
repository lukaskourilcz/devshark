import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadFresh } from './cold-start-contracts';

const LESSON_MARKERS = ['lib/learn-lessons/serve.ts', 'lib/learn-lessons/index.ts', 'lib/learn-lessons/dsa/index.ts', 'lib/learn-lessons/dsa-advanced/index.ts'];
const ENV = {
  SUPABASE_URL: 'https://roadmap-concerns-fixture.test',
  SUPABASE_ANON_KEY: 'invented-roadmap-concerns-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'invented-roadmap-concerns-service',
  SESSION_SECRET: 'invented-roadmap-concerns-session-secret-used-only-in-tests',
};
const beforeImport = `
  const calls = [], unexpected = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    calls.push({ method: request.method, path: url.pathname });
    if (url.origin !== 'https://roadmap-concerns-fixture.test' || request.method !== 'GET') {
      unexpected.push('non-fixture-read'); throw new Error('Unexpected roadmap fixture transport');
    }
    if (url.pathname === '/auth/v1/user') return Response.json({
      id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
      email: 'roadmap@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {},
    });
    if (['/rest/v1/question_edits', '/rest/v1/app_settings', '/rest/v1/roadmap_progress'].includes(url.pathname)) return Response.json([]);
    unexpected.push('unknown-read'); throw new Error('Unexpected roadmap fixture read');
  };
  require('node:net').Socket.prototype.connect = () => { unexpected.push('socket'); throw new Error('Live socket forbidden'); };
`;
const responseFixture = `
  const read = async (query, options = {}) => {
    const res = { statusCode: 200, headersSent: false, headers: {}, body: undefined, ended: false,
      setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); return this; },
      getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; },
      send(body) { this.body = body; this.headersSent = true; return this; },
      end() { this.ended = true; this.headersSent = true; } };
    const started = performance.now();
    await mod.default({ method: options.method || 'GET', query, url: '/api/quiz/roadmap',
      headers: { 'x-forwarded-for': '198.51.100.17', ...options.headers }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return { ...res, elapsedMs: performance.now() - started };
  };
  const evaluated = () => [...new Set(globalThis.__evaluated || [])].sort();
  const graderLoaded = () => Object.keys(require.cache).some(path => /node_modules\\/(?:typescript|quickjs-emscripten|@jitl)\\//.test(path));
`;

test('roadmap entry defers the full lesson reader and catalogue', async () => {
  const fresh = await loadFresh('api/quiz/roadmap.ts', '({ evaluated: globalThis.__evaluated || [], unexpected, calls })', ENV, LESSON_MARKERS, beforeImport);
  assert.deepEqual(fresh.probe, { evaluated: [], unexpected: [], calls: [] });
});

for (const [name, query, signedIn] of [
  ['public map', {}, false],
  ['public catalogue', { resource: 'learning-path-catalog' }, false],
  ['free brief', { resource: 'coding-brief', id: 'js-double-numbers' }, false],
  ['authenticated progress', { resource: 'progress' }, true],
  ['legacy unknown GET map fallback', { resource: 'unrecognized-resource' }, false],
] as [string, Record<string, string>, boolean][]) {
  test(`${name} answers without evaluating the full lesson reader/catalogue`, async () => {
    const fresh = await loadFresh('api/quiz/roadmap.ts', `(async () => {
      ${responseFixture}
      const before = evaluated();
      const res = await read(${JSON.stringify(query)}, ${signedIn ? "{ headers: { authorization: 'Bearer invented-roadmap-token' } }" : '{}'});
      return { before, after: evaluated(), status: res.statusCode, body: res.body, cache: res.headers['cache-control'], etag: res.headers.etag, unexpected, calls };
    })()`, ENV, LESSON_MARKERS, beforeImport);
    const value = fresh.probe as { before: string[]; after: string[]; status: number; body: any; cache: string; etag?: string; unexpected: string[]; calls: { path: string }[] };
    assert.equal(value.status, 200, JSON.stringify(value.body));
    assert.deepEqual(value.unexpected, []);
    assert.deepEqual(value.before, []);
    assert.deepEqual(value.after, []);
    if (signedIn) {
      assert.equal(value.cache, 'private, no-store');
      assert.equal(value.etag, undefined);
      assert.deepEqual(value.body, { data: {}, extra: { unlocked: [] } });
      assert.equal(value.calls.filter(call => call.path === '/auth/v1/user').length, 1, 'The outer request reuses one verified caller');
    } else {
      assert.match(value.cache, /^public,/);
      assert.match(value.etag ?? '', /^W\/"[a-f0-9]{64}"$/);
      if (!query.resource || query.resource === 'unrecognized-resource') {
        assert.ok(value.body.topics.includes('dsa'));
        assert.equal(value.body.structure.dsa.levels[0].lessonId, 'dsa-v1-d01-l1', 'Map lesson IDs remain available without full lesson text');
      }
    }
  });
}

test('the first lesson loads its deferred source and preserves strong ETag/bodyless 304 and timing', async () => {
  const fresh = await loadFresh('api/quiz/roadmap.ts', `(async () => {
    ${responseFixture}
    const before = evaluated();
    const first = await read({ resource: 'lesson', id: 'dsa-v1-d01-l1' });
    const repeat = await read({ resource: 'lesson', id: 'dsa-v1-d01-l1' }, { headers: { 'if-none-match': 'W/' + first.headers.etag } });
    return { before, after: evaluated(), status: first.statusCode, body: first.body, etag: first.headers.etag,
      cache: first.headers['cache-control'], timing: first.headers['server-timing'], requestId: first.headers['x-request-id'],
      repeat: { status: repeat.statusCode, hasBody: repeat.body !== undefined, ended: repeat.ended, etag: repeat.headers.etag, cache: repeat.headers['cache-control'] },
      grader: graderLoaded(), unexpected, calls };
  })()`, ENV, LESSON_MARKERS, beforeImport);
  const value = fresh.probe as any;
  assert.deepEqual(value.before, []);
  assert.deepEqual(value.after, [...LESSON_MARKERS].sort());
  assert.equal(value.status, 200);
  assert.equal(value.body.lesson.id, 'dsa-v1-d01-l1');
  assert.ok(value.body.lesson.sections.length > 0);
  assert.equal(value.etag, `"${value.body.hash}"`);
  assert.equal(value.cache, 'public, max-age=300, s-maxage=86400');
  assert.deepEqual(value.repeat, { status: 304, hasBody: false, ended: true, etag: value.etag, cache: value.cache });
  assert.equal((value.timing.match(/(?:^|,)\s*app;/g) ?? []).length, 1, 'One outer timing wrapper remains');
  assert.equal(typeof value.requestId, 'string');
  assert.equal(value.grader, false);
  assert.deepEqual(value.unexpected, []);
  assert.deepEqual(value.calls, [], 'Public lesson reading verifies no account and reads no table');
});

test('deferred lesson dispatch preserves method, malformed/unknown ID and wildcard refusal behavior', async () => {
  const fresh = await loadFresh('api/quiz/roadmap.ts', `(async () => {
    ${responseFixture}
    const responses = [];
    for (const [method, id] of [['DELETE', 'dsa-v1-d01-l1'], ['GET', '../invalid'], ['GET', 'invented-unknown-lesson']]) {
      const res = await read({ resource: 'lesson', id }, { method, headers: { 'if-none-match': '*' } });
      responses.push({ status: res.statusCode, code: res.body.error.code, cache: res.headers['cache-control'], etag: res.headers.etag || null, allow: res.headers.allow || null });
    }
    return { responses, unexpected, calls };
  })()`, ENV, LESSON_MARKERS, beforeImport);
  assert.deepEqual(fresh.probe, { responses: [
    { status: 405, code: 'method_not_allowed', cache: 'private, no-store', etag: null, allow: 'GET' },
    { status: 400, code: 'bad_request', cache: 'private, no-store', etag: null, allow: null },
    { status: 404, code: 'not_found', cache: 'private, no-store', etag: null, allow: null },
  ], unexpected: [], calls: [] });
});

// The local benchmark records operation work separately from module import.
// These observations are evidence, never a performance assertion or a proxy
// for a platform cold start. Each lane gets one fresh handler and two warm calls.
test('first and warm map, progress and lesson calls retain their fixture contracts', async () => {
  const lanes = [];
  for (const [operation, query, signedIn] of [
    ['map', {}, false],
    ['progress', { resource: 'progress' }, true],
    ['lesson', { resource: 'lesson', id: 'dsa-v1-d01-l1' }, false],
  ] as [string, Record<string, string>, boolean][]) {
    const fresh = await loadFresh('api/quiz/roadmap.ts', `(async () => {
      ${responseFixture}
      const rows = [];
      for (let i = 0; i < 3; i++) {
        const countBefore = calls.length;
        const res = await read(${JSON.stringify(query)}, ${signedIn ? "{ headers: { authorization: 'Bearer invented-roadmap-token' } }" : '{}'});
        rows.push({ phase: i === 0 ? 'first' : 'warm', ordinal: i, elapsedMs: res.elapsedMs, status: res.statusCode,
          cache: res.headers['cache-control'], etag: res.headers.etag || null, timing: res.headers['server-timing'],
          bodyKind: ${signedIn ? "res.body && Object.keys(res.body).sort().join(',')" : operation === 'lesson' ? "res.body && res.body.lesson && res.body.lesson.id" : "res.body && res.body.topics && res.body.topics.includes('dsa') ? 'map-with-dsa' : 'unexpected'"},
          reads: calls.slice(countBefore), evaluated: evaluated() });
      }
      return { rows, unexpected };
    })()`, ENV, LESSON_MARKERS, beforeImport);
    lanes.push({ operation, ...(fresh.probe as { rows: any[]; unexpected: string[] }) });
  }
  if (process.env.F7_ROADMAP_OPERATION_OUTPUT) {
    const paths = ['api/quiz/roadmap.ts', 'lib/learn-lessons/serve.ts', 'lib/learn-lessons/index.ts',
      'scripts/test-roadmap-concerns.ts', 'scripts/cold-start-contracts.ts', 'scripts/cold-start-bundle.mjs',
      'package-lock.json', 'client/package-lock.json'];
    const files = Object.fromEntries(paths.map(path => {
      const bytes = readFileSync(path);
      return [path, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
    }));
    writeFileSync(process.env.F7_ROADMAP_OPERATION_OUTPUT, JSON.stringify({
      recordedUtc: new Date().toISOString(), sourceHead: process.env.F7_ROADMAP_SOURCE_HEAD || 'unrecorded',
      node: process.version, compiler: { typescript: JSON.parse(readFileSync('node_modules/typescript/package.json', 'utf8')).version,
        esbuild: JSON.parse(readFileSync('node_modules/esbuild/package.json', 'utf8')).version },
      scope: 'Fresh-process instrumented CJS handler, invented GET-only transport, zero fixture delay; import excluded from per-call elapsedMs',
      limits: 'One first and two warm observations per operation; no thresholds, platform cold-start, total-cold-lesson or causal performance claim',
      files, lanes,
    }, null, 2) + '\n');
  }
  for (const { operation, rows, unexpected } of lanes) {
    assert.deepEqual(unexpected, [], operation);
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.status, 200, operation);
      assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
      assert.equal(row.bodyKind, operation === 'progress' ? 'data,extra' : operation === 'lesson' ? 'dsa-v1-d01-l1' : 'map-with-dsa');
      assert.equal(row.reads.filter((read: { path: string }) => read.path === '/auth/v1/user').length, operation === 'progress' ? 1 : 0);
      assert.equal((row.timing.match(/(?:^|,)\s*app;/g) ?? []).length, 1);
      if (operation === 'progress') {
        assert.equal(row.cache, 'private, no-store');
        assert.equal(row.etag, null);
      } else assert.match(row.cache, /^public,/);
    }
  }
});
