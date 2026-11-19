// Fresh real handlers and invented SDK responses. No live transport is allowed.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bundleColdEntry } from './cold-start-bundle.mjs';
import { loadFresh } from './cold-start-contracts';

const FDE_MARKERS = [
  'lib/learning-paths/catalog.ts',
  'lib/learning-paths/content/fde.ts',
  'lib/learning-paths/validate.ts',
];
const CHALLENGE_MARKERS = ['lib/rewards/handlers.ts', ...FDE_MARKERS];
const USER = '11111111-1111-4111-8111-111111111111';

// Runs before requiring the handler, so import-time requests cannot escape.
function fixturePrelude(admin = false): string {
  return `
    process.env.SUPABASE_URL = 'https://f7-import-fixture.test';
    process.env.SUPABASE_ANON_KEY = 'invented-f7-anon';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'invented-f7-service';
    process.env.SESSION_SECRET = 'invented-f7-session-secret-never-used-outside-tests';
    process.env.NODE_ENV = 'production';
    process.env.DEV_PASSWORD = 'invented-disabled-legacy';
    process.env.ALLOW_LEGACY_DEV_PASSWORD = 'false';
    process.env.LEARNING_PATH_FDE_ENABLED = 'true';
    process.env.UPSTASH_REDIS_REST_URL = '';
    process.env.UPSTASH_REDIS_REST_TOKEN = '';
    const userId = ${JSON.stringify(USER)};
    const otherId = '22222222-2222-4222-8222-222222222222';
    const tokenFor = sub => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture-signature'].join('.');
    const token = tokenFor(userId), otherToken = tokenFor(otherId);
    let adminAllowed = ${admin};
    const calls = [], unexpected = [], awards = new Map(), credits = new Set();
    const settings = { ownerEmail: 'f7-owner@example.invalid', coins: { xpRate: 0.2, premiumMultiplier: 3, dailyXpCap: 777 } };
    const send = (body, status = 200) => Response.json(body, { status });
    globalThis.fetch = async (input, init = {}) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== 'https://f7-import-fixture.test') { unexpected.push('foreign_origin'); throw new Error('unexpected fixture origin'); }
      const body = request.method === 'GET' ? null : JSON.parse(await request.text());
      calls.push({ path: url.pathname, method: request.method, body });
      if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
        const id = request.headers.get('authorization') === 'Bearer ' + otherToken ? otherId : userId;
        return send({ id, aud: 'authenticated', role: 'authenticated', email: 'f7@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: adminAllowed && id === userId ? { admin: true } : {}, user_metadata: { admin: true } });
      }
      if (url.pathname === '/rest/v1/app_settings' && request.method === 'GET') return send([{ value: settings }]);
      if (['/rest/v1/question_edits', '/rest/v1/question_reports'].includes(url.pathname) && request.method === 'GET') return send([]);
      if (url.pathname === '/rest/v1/verified_activity_awards' && request.method === 'GET') return send([{ xp: 10 }]);
      if (url.pathname === '/rest/v1/rpc/save_completed_challenge_score' && request.method === 'POST') return send({ id: 'f7-score', name: 'f7Shark', score: body.p_score, created_at: '2026-11-19T00:00:00Z', selected_topics: body.p_topics, all_topics: body.p_all_topics });
      if (url.pathname === '/rest/v1/rpc/record_challenge_completion_v2' && request.method === 'POST') {
        const awarded = !awards.has(body.p_run_id); awards.set(body.p_run_id, body.p_xp);
        return send({ awarded, xp: body.p_xp, xpHeld: null });
      }
      if (url.pathname === '/rest/v1/rpc/credit_verified_xp_tokens' && request.method === 'POST') {
        const first = !credits.has(body.p_award_id); credits.add(body.p_award_id);
        return send(first ? 2 : 0);
      }
      if (url.pathname === '/rest/v1/rpc/settle_coin_milestones' && request.method === 'POST') return send({ premium: false, credited: [], streak: 1 });
      unexpected.push(url.pathname); throw new Error('unexpected fixture operation');
    };
    require('node:net').Socket.prototype.connect = () => { unexpected.push('socket'); throw new Error('live socket forbidden'); };
  `;
}

const responseFixture = `
  const call = async (method, query, body = undefined, bearer = token) => {
    const res = { statusCode: 200, headers: {}, body: null, headersSent: false,
      setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
      getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; },
      send(body) { this.body = body; this.headersSent = true; return this; },
      end() { this.headersSent = true; } };
    await mod.default({ method, query, body, url: '/api/fixture', headers: { ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), 'x-forwarded-for': '198.51.100.77' }, socket: { remoteAddress: '127.0.0.1' } }, res);
    return { status: res.statusCode, body: res.body, cache: res.headers['cache-control'], allow: res.headers.allow };
  };
`;

type Snapshot = { status: number; body: any; cache?: string; allow?: string };
type Call = { path: string; method: string; body: Record<string, unknown> | null };
type Result = { loaded: string[]; unexpected: string[]; calls: Call[]; response: Snapshot };
const rpc = (name: string) => `/rest/v1/rpc/${name}`;

test('Challenge entry evaluates no rewards handler or FDE catalogue', async () => {
  const fresh = await loadFresh('api/quiz/challenge.ts', '({ loaded: globalThis.__evaluated ?? [], calls, unexpected })', {}, CHALLENGE_MARKERS, fixturePrelude());
  const result = fresh.probe as { loaded: string[]; calls: Call[]; unexpected: string[] };
  assert.deepEqual(result.unexpected, []);
  assert.deepEqual(result.calls, [], 'requiring the handler opens no SDK transport');
  assert.deepEqual(result.loaded, []);
});

test('Challenge completion keeps verified XP, idempotent credit arguments and ownership', async () => {
  const parent = join(process.cwd(), 'node_modules/.cache/shark');
  mkdirSync(parent, { recursive: true });
  const owned = mkdtempSync(join(parent, 'f7-import-fixture-'));
  try {
    const tokensFile = join(owned, 'tokens.cjs');
    await bundleColdEntry('lib/quiz-tokens.ts', tokensFile);
    const fresh = await loadFresh('api/quiz/challenge.ts', `(async () => {
      ${responseFixture}
      const tokens = require(${JSON.stringify(tokensFile)});
      const run = tokens.createChallengeRun(true, 'webdev', { topics: ['html'], allTopics: false, userId, gradingVersion: 2 });
      const proof = (id, correct) => tokens.encodeScoreProof(run.runId, id, 'webdev', correct, 2);
      const strikes = ['f7-strike-1', 'f7-strike-2', 'f7-strike-3'].map(id => proof(id, false));
      const right = proof('f7-right-1', true);
      const proofs = [...strikes, right, proof('f7-right-2', true), right];
      const first = await call('POST', { resource: 'complete' }, { runToken: run.runToken, proofs, user_id: otherId });
      const repeated = await call('POST', { resource: 'complete' }, { runToken: run.runToken, proofs });
      const beforeForeign = calls.filter(call => call.path.startsWith('/rest/v1/rpc/')).length;
      const foreign = await call('POST', { resource: 'complete' }, { runToken: run.runToken, proofs }, otherToken);
      const afterForeign = calls.filter(call => call.path.startsWith('/rest/v1/rpc/')).length;
      const zeroRun = tokens.createChallengeRun(true, 'webdev', { topics: ['html'], allTopics: false, userId, gradingVersion: 2 });
      const zero = await call('POST', { resource: 'complete' }, { runToken: zeroRun.runToken, proofs: ['f7-zero-1', 'f7-zero-2', 'f7-zero-3'].map(id => tokens.encodeScoreProof(zeroRun.runId, id, 'webdev', false, 2)) });
      const afterZero = calls.filter(call => call.path.startsWith('/rest/v1/rpc/')).length;
      return { runId: run.runId, first, repeated, foreign, zero, beforeForeign, afterForeign, afterZero, calls, unexpected, credits: [...credits] };
    })()`, {}, [], fixturePrelude());
    const result = fresh.probe as { runId: string; first: Snapshot; repeated: Snapshot; foreign: Snapshot; zero: Snapshot; beforeForeign: number; afterForeign: number; afterZero: number; calls: Call[]; unexpected: string[]; credits: string[] };
    assert.deepEqual(result.unexpected, []);
    assert.equal(result.first.status, 200);
    assert.deepEqual({ awarded: result.first.body.awarded, score: result.first.body.score, xp: result.first.body.xp }, { awarded: true, score: 2, xp: 10 });
    assert.equal(result.first.cache, 'private, no-store');
    assert.equal(result.repeated.status, 200);
    assert.deepEqual({ awarded: result.repeated.body.awarded, score: result.repeated.body.score, xp: result.repeated.body.xp }, { awarded: false, score: 2, xp: 10 });
    const creditCalls = result.calls.filter(call => call.path === rpc('credit_verified_xp_tokens'));
    assert.equal(creditCalls.length, 2, 'a replay can reconcile credit under the same deduplication key');
    for (const call of creditCalls) assert.deepEqual(call.body, { p_user_id: USER, p_award_id: `challenge:${result.runId}`, p_subject: 'webdev', p_xp: 10, p_rate: 0.2, p_premium_multiplier: 3, p_daily_cap: 777 });
    assert.deepEqual(result.credits, [`challenge:${result.runId}`]);
    const names = result.calls.map(call => call.path);
    assert(names.indexOf(rpc('save_completed_challenge_score')) < names.indexOf(rpc('record_challenge_completion_v2')));
    assert(names.indexOf(rpc('record_challenge_completion_v2')) < names.indexOf(rpc('credit_verified_xp_tokens')));
    assert(names.indexOf(rpc('credit_verified_xp_tokens')) < names.indexOf(rpc('settle_coin_milestones')));
    assert.equal(result.calls.filter(call => call.path === rpc('settle_coin_milestones')).length, 1);
    assert.equal(result.foreign.status, 400);
    assert.equal(result.foreign.body.error.code, 'invalid_run');
    assert.equal(result.afterForeign, result.beforeForeign);
    assert.equal(result.zero.status, 200);
    assert.deepEqual(result.zero.body, { ok: true, awarded: false, score: 0, xp: 0, record: null });
    assert.equal(result.afterZero, result.afterForeign);
  } finally {
    rmSync(owned, { recursive: true, force: true });
  }
});

for (const op of ['settings', 'reports']) {
  test(`authorized admin ${op} read preserves its response without FDE evaluation`, async () => {
    const fresh = await loadFresh('api/admin/[op].ts', `(async () => {
      ${responseFixture}
      const response = await call('GET', ${JSON.stringify({ op })});
      return { response, calls, unexpected, loaded: globalThis.__evaluated ?? [] };
    })()`, {}, FDE_MARKERS, fixturePrelude(true));
    const result = fresh.probe as Result;
    assert.deepEqual(result.unexpected, []);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.cache, 'no-store');
    assert.equal(result.calls.filter(call => call.path === '/auth/v1/user').length, 1);
    if (op === 'settings') assert.equal(result.response.body.settings.ownerEmail, 'f7-owner@example.invalid');
    else assert.deepEqual(result.response.body, { reports: [] });
    assert.deepEqual(result.loaded, []);
  });
}

test('admin readiness loads the catalogue only for its authorized GET response', async () => {
  const fresh = await loadFresh('api/admin/[op].ts', `(async () => {
    ${responseFixture}
    const response = await call('GET', { op: 'learning-paths' });
    return { response, calls, unexpected, loaded: globalThis.__evaluated ?? [] };
  })()`, {}, FDE_MARKERS, fixturePrelude(true));
  const result = fresh.probe as Result;
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.cache, 'private, no-store');
  assert.equal(result.calls.filter(call => call.path === '/auth/v1/user').length, 1);
  assert.deepEqual(result.response.body.paths.map((path: { pathId: string }) => path.pathId), ['fde']);
  const path = result.response.body.paths[0];
  assert.deepEqual(Object.keys(path).sort(), ['contentReady', 'enabledInEnv', 'inventory', 'issues', 'pathId', 'version']);
  assert.equal(path.version, 1);
  assert.equal(path.enabledInEnv, true);
  assert.equal(path.contentReady, true);
  assert(path.inventory.modules > 0 && path.inventory.checks > 0 && path.inventory.codeExercises > 0);
  assert.deepEqual([...result.loaded].sort(), [...FDE_MARKERS].sort());
});

test('admin GET rechecks a previously accepted JWT after role revocation', async () => {
  const fresh = await loadFresh('api/admin/[op].ts', `(async () => {
    ${responseFixture}
    const first = await call('GET', { op: 'settings' });
    adminAllowed = false;
    const revoked = await call('GET', { op: 'settings' });
    return { first, revoked, calls, unexpected };
  })()`, {}, [], fixturePrelude(true));
  const result = fresh.probe as { first: Snapshot; revoked: Snapshot; calls: Call[]; unexpected: string[] };
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.first.status, 200);
  assert.equal(result.revoked.status, 403);
  assert.equal(result.revoked.body.error.code, 'forbidden');
  assert.equal(result.calls.filter(call => call.path === '/auth/v1/user').length, 2, 'the first accepted JWT must not bypass fresh admin authorization');
});

for (const [method, bearer, expected, code] of [
  ['POST', true, 405, 'method_not_allowed'],
  ['GET', false, 403, 'forbidden'],
] as const) {
  test(`admin readiness ${method} ${bearer ? 'method refusal' : 'anonymous refusal'} loads no catalogue`, async () => {
    const fresh = await loadFresh('api/admin/[op].ts', `(async () => {
      ${responseFixture}
      const response = await call(${JSON.stringify(method)}, { op: 'learning-paths' }, undefined, ${bearer ? 'token' : 'null'});
      return { response, calls, unexpected, loaded: globalThis.__evaluated ?? [] };
    })()`, {}, FDE_MARKERS, fixturePrelude(true));
    const result = fresh.probe as Result;
    assert.deepEqual(result.unexpected, []);
    assert.equal(result.response.status, expected);
    assert.equal(result.response.body.error.code, code);
    if (method === 'POST') assert.equal(result.response.allow, 'GET');
    assert.deepEqual(result.loaded, []);
    assert.equal(result.calls.filter(call => call.path.startsWith('/rest/')).length, 0);
  });
}
