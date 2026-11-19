// Real public handlers with invented PostgREST replies. This process must not
// use developer credentials, open a socket, or issue a state-changing RPC.
import './launch-test-env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { buildSync } from 'esbuild';
import type { VercelRequest, VercelResponse } from '../lib/vercel-types';

type Handler = (req: VercelRequest, res: VercelResponse) => unknown;
type Query = Record<string, string | string[]>;
type Headers = Record<string, string | string[]>;
type TransportCall = { method: string; path: string; body: Record<string, unknown> | null };
const ORIGIN = 'https://public-json-fixture.test';
const transport: TransportCall[] = [];
const unexpected: string[] = [];
let boardRevision = 1;
let failedRpc: string | null = null;
const originalFetch = globalThis.fetch;
const originalConnect = Object.getOwnPropertyDescriptor(Socket.prototype, 'connect')!;
let helperDirectory: string | undefined;

process.env.SUPABASE_URL = ORIGIN;
process.env.SUPABASE_ANON_KEY = 'invented-public-json-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'invented-public-json-service';
process.env.SESSION_SECRET = 'invented-public-json-secret-used-only-in-this-process';
process.env.LEARNING_PATH_FDE_ENABLED = 'true';

Object.defineProperty(Socket.prototype, 'connect', {
  ...originalConnect,
  value() { unexpected.push('socket'); throw new Error('Public JSON contracts forbid live sockets'); },
});
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin !== ORIGIN) {
    unexpected.push(`origin:${url.origin}`);
    throw new Error('Public JSON contracts forbid non-fixture transport');
  }
  const raw = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
  const body = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  transport.push({ method: request.method, path: url.pathname, body });
  if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
    return Response.json({ message: 'Invented token is invalid' }, { status: 401 });
  }
  if (request.method === 'GET' && ['/rest/v1/app_settings', '/rest/v1/question_edits'].includes(url.pathname)) {
    return Response.json([]);
  }
  const rpc = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname)?.[1];
  const boards = ['subject_leaderboard', 'category_leaderboard', 'daily_leaderboard_v2', 'window_leaderboard', 'month_xp_leaderboard', 'challenge_leaderboard'];
  if (request.method === 'POST' && rpc && boards.includes(rpc)) {
    if (rpc === failedRpc) return Response.json({ code: 'XX000', message: 'Invented read failure' }, { status: 500 });
    if (rpc === 'challenge_leaderboard') return Response.json([{
      id: 'invented-score', name: `Fixture shark ${boardRevision}`, score: 7,
      created_at: '2026-11-19T00:00:00Z', selected_topics: ['html'], all_topics: false,
    }]);
    return Response.json([{
      user_id: '11111111-1111-4111-8111-111111111111',
      name: `Fixture shark ${boardRevision}`, rank: 1, correct: 8, answered: 10,
      accuracy_pct: 80, xp: 100, photo_url: null,
    }]);
  }
  unexpected.push(`${request.method} ${url.pathname}`);
  throw new Error('Unexpected operation in public JSON fixture');
};

// Configuration above runs before handlers or their import-time clients load.
const [settingsModule, roadmapModule, boardsModule, questionsModule, challengeModule, dailyModule, settingsStore, limits] = await Promise.all([
  import('../api/settings'),
  import('../api/quiz/roadmap'),
  import('../api/leaderboard'),
  import('../api/quiz/questions'),
  import('../api/quiz/challenge'),
  import('../api/quiz/daily'),
  import('../lib/settings-store'),
  import('../lib/rate-limit'),
]);
const settings: Handler = settingsModule.default;
const roadmap: Handler = roadmapModule.default;
const boards: Handler = boardsModule.default;
const questions: Handler = questionsModule.default;
const challenge: Handler = challengeModule.default;
const daily: Handler = dailyModule.default;
settingsStore.setGameSettingsForTests(settingsStore.DEFAULT_SETTINGS);

after(() => {
  settingsStore.setGameSettingsForTests(null);
  globalThis.fetch = originalFetch;
  Object.defineProperty(Socket.prototype, 'connect', originalConnect);
  if (helperDirectory) rmSync(helperDirectory, { recursive: true, force: true });
  assert.deepEqual(unexpected, [], 'No undeclared transport or live socket was attempted');
});

function response() {
  const res = {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    ended: false,
    jsonWrites: 0,
    endBody: undefined as unknown,
    setHeader(name: string, value: string | number | readonly string[]) {
      assert.equal(res.headersSent, false, 'Headers are set before the response is written');
      res.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(',') : String(value);
      return res;
    },
    getHeader(name: string) { return res.headers[name.toLowerCase()]; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; res.jsonWrites++; res.headersSent = true; return res; },
    send(body: unknown) { res.body = body; res.headersSent = true; return res; },
    end(body?: unknown) { res.endBody = body; res.ended = true; res.headersSent = true; },
    redirect() { throw new Error('Public JSON contracts do not expect a redirect'); },
  };
  return res;
}

let addresses = 0;
const nextAddress = () => `198.18.${Math.floor(++addresses / 250)}.${addresses % 250 + 1}`;
const request = (query: Query, options: { method?: string; headers?: Headers; address?: string } = {}): VercelRequest => ({
  method: options.method ?? 'GET', url: '/api/public-json-contract', query,
  headers: { 'x-forwarded-for': options.address ?? nextAddress(), ...options.headers },
  socket: { remoteAddress: '127.0.0.1' },
});
async function call(handler: Handler, query: Query = {}, options: Parameters<typeof request>[1] = {}) {
  const res = response();
  await handler(request(query, options), res);
  return res;
}
const contentTag = (body: unknown) => `W/"${createHash('sha256').update(JSON.stringify(body)).digest('hex')}"`;
const noValidator = (res: ReturnType<typeof response>, status: number) => {
  assert.equal(res.statusCode, status, JSON.stringify(res.body));
  assert.equal(res.headers.etag, undefined, 'Private and refused responses have no public validator');
  assert.notEqual(res.statusCode, 304);
};

interface PublicCase { name: string; handler: Handler; query: Query; cache: string; vary?: string; lesson?: boolean }
const cases: PublicCase[] = [
  { name: 'settings', handler: settings, query: {}, cache: 'public, s-maxage=15, stale-while-revalidate=60' },
  { name: 'Learn map', handler: roadmap, query: {}, cache: 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' },
  { name: 'learning-path catalogue', handler: roadmap, query: { resource: 'learning-path-catalog' }, cache: 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
  { name: 'free coding brief', handler: roadmap, query: { resource: 'coding-brief', id: 'js-double-numbers' }, cache: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
  { name: 'existing lesson', handler: roadmap, query: { resource: 'lesson', id: 'dsa-v1-d01-l1' }, cache: 'public, max-age=300, s-maxage=86400', lesson: true },
  ...['global', 'category', 'daily', '7d', '30d', 'month'].map((period): PublicCase => ({
    name: `${period} leaderboard`, handler: boards,
    query: { period, ...(period === 'category' ? { category: 'html' } : {}), ...(period === 'daily' ? { date: '2026-11-19' } : {}) },
    cache: 'public, s-maxage=60', ...(['7d', '30d', 'month'].includes(period) ? { vary: 'Authorization' } : {}),
  })),
  { name: 'curation coverage', handler: questions, query: { resource: 'curation' }, cache: 'public, s-maxage=60, stale-while-revalidate=300' },
  { name: 'Challenge leaderboard', handler: challenge, query: { resource: 'leaderboard', categories: 'html' }, cache: 'public, s-maxage=15, stale-while-revalidate=60' },
];

for (const item of cases) {
  test(`${item.name}: content validator, weak/list/wildcard matching and bodyless 304 preserve cache policy`, async () => {
    const first = await call(item.handler, item.query);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal(first.headers['cache-control'], item.cache);
    assert.equal(first.headers.vary, item.vary);
    const etag = first.headers.etag;
    assert.ok(etag, `${item.name} publishes an explicit source-level ETag`);
    if (item.lesson) {
      assert.equal(etag, `"${(first.body as { hash: string }).hash}"`, 'The published lesson hash keeps its existing strong tag');
    } else {
      assert.equal(etag, contentTag(first.body), 'Only the actual JSON content contributes to the weak tag');
    }
    const strong = etag.replace(/^W\//, '');
    for (const header of [etag, strong, `W/${strong}`, `"different", W/${strong}`, ['"different"', strong], '*']) {
      const conditional = await call(item.handler, item.query, { headers: { 'if-none-match': header } });
      assert.equal(conditional.statusCode, 304, `If-None-Match ${JSON.stringify(header)} matches`);
      assert.equal(conditional.headers.etag, etag);
      assert.equal(conditional.headers['cache-control'], item.cache);
      assert.equal(conditional.headers.vary, item.vary);
      assert.equal(conditional.ended, true);
      assert.equal(conditional.body, undefined);
      assert.equal(conditional.endBody, undefined);
      assert.equal(conditional.jsonWrites, 0, 'A 304 writes no JSON body');
      assert.ok(conditional.headers['server-timing'], 'The normal timing wrapper still sees the write');
    }
    const changed = await call(item.handler, item.query, { headers: { 'if-none-match': '"a-different-content-version"' } });
    assert.equal(changed.statusCode, 200);
    assert.deepEqual(changed.body, first.body, 'A nonmatching version receives the unchanged public representation');
  });
}

test('settings: a changed public projection changes its tag while request metadata does not', async () => {
  const first = await call(settings);
  assert.ok(first.headers.etag, 'Settings publish a validator before checking invalidation');
  assert.equal('ownerEmail' in (first.body as object), false);
  const same = await call(settings, {}, { headers: { 'x-request-id': 'invented-different-request' } });
  assert.equal(same.headers.etag, first.headers.etag);
  const nextCount = settingsStore.DEFAULT_SETTINGS.quiz.countOptions.find((count) => count !== settingsStore.DEFAULT_SETTINGS.quiz.defaultCount);
  assert.ok(nextCount, 'The real settings offer a different supported count');
  settingsStore.setGameSettingsForTests({
    ...settingsStore.DEFAULT_SETTINGS,
    quiz: { ...settingsStore.DEFAULT_SETTINGS.quiz, defaultCount: nextCount },
  });
  try {
    const changed = await call(settings, {}, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(changed.statusCode, 200);
    assert.notEqual(changed.headers.etag, first.headers.etag);
    assert.equal(changed.headers.etag, contentTag(changed.body));
    assert.equal((changed.body as { quiz: { defaultCount: number } }).quiz.defaultCount, nextCount);
  } finally { settingsStore.setGameSettingsForTests(settingsStore.DEFAULT_SETTINGS); }
});

test('public boards: revalidation still reads the authoritative board and changed names invalidate the tag', async () => {
  const query = { period: '30d' };
  const first = await call(boards, query);
  assert.ok(first.headers.etag);
  const before = transport.filter((one) => one.path.endsWith('/window_leaderboard')).length;
  const unchanged = await call(boards, query, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(unchanged.statusCode, 304);
  assert.equal(transport.filter((one) => one.path.endsWith('/window_leaderboard')).length, before + 1, 'Conditional handling does not skip the existing read');
  boardRevision++;
  try {
    const changed = await call(boards, query, { headers: { 'if-none-match': first.headers.etag } });
    assert.equal(changed.statusCode, 200);
    assert.notEqual(changed.headers.etag, first.headers.etag);
    assert.equal(changed.headers['cache-control'], 'public, s-maxage=60', 'No stale extension delays a name privacy change');
    assert.match(JSON.stringify(changed.body), /Fixture shark 2/);
  } finally { boardRevision = 1; }
});

for (const period of ['7d', '30d', 'month']) {
  for (const personal of ['me', 'unverified bearer']) {
    test(`${period} leaderboard: ${personal} remains private even with If-None-Match *`, async () => {
      const res = await call(boards, { period, ...(personal === 'me' ? { me: '1' } : {}) }, {
        headers: { 'if-none-match': '*', ...(personal === 'unverified bearer' ? { authorization: 'Bearer invented-invalid-token' } : {}) },
      });
      noValidator(res, 200);
      assert.equal(res.headers['cache-control'], 'private, no-store');
      assert.equal(res.headers.vary, 'Authorization');
      assert.equal((res.body as { me: unknown }).me, null);
    });
  }
}

test('private due and coding-state responses remain complete and untagged', async () => {
  const due = await call(questions, { resource: 'due', categories: 'html' }, { headers: { 'if-none-match': '*' } });
  noValidator(due, 200);
  assert.equal(due.headers['cache-control'], 'private, no-store');
  assert.deepEqual(due.body, { due: [], estimatedMinutes: 0 });
  // React does not warm the QuickJS worker; this checks the real state path
  // without running a grader or changing any account.
  const state = await call(roadmap, { resource: 'coding-state', id: 'react-heading-and-intro' }, { headers: { 'if-none-match': '*' } });
  noValidator(state, 200);
  assert.equal(state.headers['cache-control'], 'private, no-store');
  assert.equal((state.body as { signedIn: boolean }).signedIn, false);
  assert.ok('session' in (state.body as object));
});

test('quiz, Challenge, Daily and QOTD sessions remain private despite wildcard validators', async () => {
  for (const [handler, query] of [
    [questions, { categories: 'html', count: '1' }],
    [challenge, { categories: 'html' }],
    [daily, { categories: 'html' }],
    [daily, { qotd: 'today' }],
  ] as [Handler, Query][]) {
    const res = await call(handler, query, { headers: { 'if-none-match': '*' } });
    noValidator(res, 200);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.equal(typeof (res.body as { sessionId: string }).sessionId, 'string');
  }
});

for (const item of cases.filter((one) => !one.name.includes('leaderboard') || one.handler === challenge || one.name === 'global leaderboard')) {
  test(`${item.name}: method refusal precedes conditional evaluation`, async () => {
    const res = await call(item.handler, item.query, { method: 'DELETE', headers: { 'if-none-match': '*' } });
    noValidator(res, 405);
    assert.ok(res.headers.allow?.includes('GET'));
    assert.equal(res.headers['cache-control'], 'private, no-store');
  });
}

test('invalid map, brief, lesson and board requests cannot become 304', async () => {
  for (const [handler, query, status] of [
    [roadmap, { topic: 'invented-topic' }, 400],
    [roadmap, { resource: 'coding-brief', id: 'invented-missing-task' }, 404],
    [roadmap, { resource: 'lesson', id: 'invented-missing-lesson' }, 404],
    [boards, { period: 'daily', date: '2026-02-30' }, 400],
    [boards, { period: 'global', categories: 'invented-category' }, 400],
    [boards, { period: 'category', category: 'invented-category' }, 400],
    [boards, { period: 'invented-period' }, 400],
    [challenge, { resource: 'leaderboard', categories: 'invented-category' }, 400],
  ] as [Handler, Query, number][]) {
    const res = await call(handler, query, { headers: { 'if-none-match': '*' } });
    noValidator(res, status);
    assert.equal(res.headers['cache-control'], 'private, no-store');
  }
});

test('a Premium brief keeps its guest refusal even with a wildcard validator', async () => {
  const [{ ACTIVE_CODING_TASKS }, { serverContentIndex }, { contentTier, codingContent }] = await Promise.all([
    import('../lib/coding/active'), import('../lib/access'), import('../shared/tiers'),
  ]);
  const premium = ACTIVE_CODING_TASKS.find((task) => contentTier(codingContent(task.id), serverContentIndex()) === 'premium');
  assert.ok(premium, 'The real active catalogue contains a Premium task');
  const res = await call(roadmap, { resource: 'coding-brief', id: premium.id }, { headers: { 'if-none-match': '*' } });
  noValidator(res, 402);
  assert.equal(res.headers['cache-control'], 'private, no-store');
});

test('failed board reads keep their error status and never reuse a success validator', async () => {
  for (const [handler, query, rpc, status] of [
    [boards, { period: 'global' }, 'subject_leaderboard', 500],
    [challenge, { resource: 'leaderboard', categories: 'html' }, 'challenge_leaderboard', 503],
  ] as [Handler, Query, string, number][]) {
    failedRpc = rpc;
    try {
      const res = await call(handler, query, { headers: { 'if-none-match': '*' } });
      noValidator(res, status);
      assert.equal(res.headers['cache-control'], 'private, no-store');
    } finally { failedRpc = null; }
  }
});

test('exhausted address and curation limits precede conditional responses and board reads', async () => {
  const now = Date.now;
  Date.now = () => 1_795_046_400_000;
  try {
    const address = nextAddress();
    const req = request({}, { address });
    for (let i = 0; i < limits.RATE_LIMITS.readAddress.capacity; i++) {
      assert.equal(limits.checkRateLimit(req, response(), limits.RATE_LIMITS.readAddress), true);
    }
    const before = transport.length;
    for (const [handler, query] of [
      [roadmap, {}], [roadmap, { resource: 'coding-brief', id: 'js-double-numbers' }],
      [roadmap, { resource: 'lesson', id: 'dsa-v1-d01-l1' }],
      [boards, { period: 'global' }], [challenge, { resource: 'leaderboard', categories: 'html' }],
    ] as [Handler, Query][]) {
      const res = await call(handler, query, { address, headers: { 'if-none-match': '*' } });
      noValidator(res, 429);
      assert.ok(Number(res.headers['retry-after']) > 0);
    }
    assert.equal(transport.length, before, 'A refused read does not reach its public data source');
    const curationAddress = nextAddress();
    const curationRequest = request({}, { address: curationAddress });
    for (let i = 0; i < limits.RATE_LIMITS.quizSessionAddress.capacity; i++) {
      assert.equal(limits.checkRateLimit(curationRequest, response(), limits.RATE_LIMITS.quizSessionAddress), true);
    }
    const curation = await call(questions, { resource: 'curation' }, { address: curationAddress, headers: { 'if-none-match': '*' } });
    noValidator(curation, 429);
    assert.equal(curation.headers['cache-control'], 'private, no-store');
  } finally { Date.now = now; }
});

interface PublicJsonHelper {
  matchesEntityTag(header: string | string[] | undefined, etag: string): boolean;
  sendPublicJson(req: VercelRequest, res: VercelResponse, body: unknown): unknown;
}
let helper: PublicJsonHelper | undefined;
function publicJsonHelper(): PublicJsonHelper {
  if (helper) return helper;
  const source = join(process.cwd(), 'lib/public-json.ts');
  assert.ok(existsSync(source), 'The shared content-only public JSON helper must exist');
  helperDirectory = mkdtempSync(join(tmpdir(), 'devshark-public-json-helper-'));
  const outfile = join(helperDirectory, 'public-json.cjs');
  buildSync({ entryPoints: [source], outfile, bundle: true, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  helper = createRequire(import.meta.url)(outfile) as PublicJsonHelper;
  assert.equal(typeof helper.matchesEntityTag, 'function');
  assert.equal(typeof helper.sendPublicJson, 'function');
  return helper;
}

test('helper: weak comparison parses quoted commas, header arrays and empty list members', () => {
  const { matchesEntityTag: matches } = publicJsonHelper();
  for (const [header, tag] of [
    ['"version"', 'W/"version"'], ['W/"version"', '"version"'],
    [' "different", W/"a,b" ', '"a,b"'], [['"different"', '"a,b"'], 'W/"a,b"'],
    [', , "version",,', '"version"'], ['""', 'W/""'], ['\t * \t', '"version"'],
  ] as [string | string[], string][]) assert.equal(matches(header, tag), true, JSON.stringify({ header, tag }));
});

test('helper: malformed tags, mixed wildcard lists and partial matches never revalidate', () => {
  const { matchesEntityTag: matches } = publicJsonHelper();
  for (const header of [undefined, '', 'version', 'w/"version"', '"version', '"version"junk', '"version",invalid', '*,"version"', '\n*\n', '"ver"', '"VERSION"']) {
    assert.equal(matches(header, 'W/"version"'), false, JSON.stringify(header));
  }
  assert.equal(matches('*', 'unquoted'), false, 'An invalid current entity tag is not a representation validator');
});

test('helper: tags cover actual content without changing the JSON adapter or adding request metadata', () => {
  const { sendPublicJson: send } = publicJsonHelper();
  const body = { items: [{ label: 'A comma, and Unicode: žralok' }], enabled: true };
  const first = response();
  first.setHeader('Cache-Control', 'public, s-maxage=60');
  send(request({}), first, body);
  assert.equal(first.headers.etag, contentTag(body));
  assert.equal(first.body, body, 'The existing JSON writer receives the original projection');
  assert.equal(first.jsonWrites, 1);
  const repeat = response();
  repeat.setHeader('Cache-Control', 'public, s-maxage=60');
  send(request({}, { headers: { authorization: 'Bearer unrelated', 'x-request-id': 'another-request' } }), repeat, body);
  assert.equal(repeat.headers.etag, first.headers.etag);
  const changed = response();
  changed.setHeader('Cache-Control', 'public, s-maxage=60');
  send(request({}, { headers: { 'if-none-match': first.headers.etag } }), changed, { ...body, enabled: false });
  assert.equal(changed.statusCode, 200);
  assert.notEqual(changed.headers.etag, first.headers.etag);
});

test('helper: a public array policy keeps Vary and ends a matching response without a body', () => {
  const { sendPublicJson: send } = publicJsonHelper();
  const body = { stable: true };
  const res = response();
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  res.setHeader('Vary', 'Authorization');
  Object.defineProperty(res, 'getHeader', { value: () => ['public', 's-maxage=60'] });
  send(request({}, { headers: { 'if-none-match': contentTag(body).replace(/^W\//, '') } }), res, body);
  assert.equal(res.statusCode, 304);
  assert.equal(res.headers.etag, contentTag(body));
  assert.equal(res.headers['cache-control'], 'public, s-maxage=60');
  assert.equal(res.headers.vary, 'Authorization');
  assert.equal(res.ended, true);
  assert.equal(res.endBody, undefined);
  assert.equal(res.jsonWrites, 0);
});

test('helper: private/no-store policies, non-200 statuses and non-GET methods retain ordinary JSON', () => {
  const { sendPublicJson: send } = publicJsonHelper();
  const body = { value: 'the existing representation' };
  for (const policy of ['private, no-store', 'no-store', 'public, private', 'public, no-store', 'PUBLIC, PrIvAtE="field"', 's-maxage=60']) {
    const res = response();
    res.setHeader('Cache-Control', policy);
    send(request({}, { headers: { 'if-none-match': '*' } }), res, body);
    noValidator(res, 200);
    assert.equal(res.body, body);
    assert.equal(res.headers['cache-control'], policy);
  }
  for (const status of [201, 206, 400, 402, 404, 405, 429, 500, 503]) {
    const res = response();
    res.status(status).setHeader('Cache-Control', 'public, s-maxage=60');
    send(request({}, { headers: { 'if-none-match': '*' } }), res, body);
    noValidator(res, status);
    assert.equal(res.body, body);
  }
  for (const method of ['HEAD', 'POST']) {
    const res = response();
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    send(request({}, { method, headers: { 'if-none-match': '*' } }), res, body);
    noValidator(res, 200);
    assert.equal(res.body, body);
  }
});

test('helper: unknown or unreadable policies and non-JSON values use the existing writer', () => {
  const { sendPublicJson: send } = publicJsonHelper();
  for (const mode of ['missing policy', 'missing getter', 'throwing getter', 'undefined body']) {
    const res = response();
    if (mode !== 'missing policy') res.setHeader('Cache-Control', 'public, s-maxage=60');
    if (mode === 'missing getter') Object.defineProperty(res, 'getHeader', { value: undefined });
    if (mode === 'throwing getter') Object.defineProperty(res, 'getHeader', { value: () => { throw new Error('Unreadable adapter header'); } });
    const body = mode === 'undefined body' ? undefined : { existing: true };
    send(request({}, { headers: { 'if-none-match': '*' } }), res, body);
    noValidator(res, 200);
    assert.equal(res.body, body);
    assert.equal(res.jsonWrites, 1);
  }
});
