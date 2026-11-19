// Refactor boundary plus real placement operations with invented transport.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bundleColdEntry } from './cold-start-bundle.mjs';
import { loadFresh } from './cold-start-contracts';

const USER = '11111111-1111-4111-8111-111111111111';
const MARKERS = ['lib/roadmap/placement.ts'];
const ENV = {
  SUPABASE_URL: 'https://placement-concern-fixture.test',
  SUPABASE_ANON_KEY: 'invented-placement-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'invented-placement-service',
  SESSION_SECRET: 'invented-placement-secret-used-only-in-this-process',
};
const beforeImport = `
  const calls = [], unexpected = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    calls.push({ path: url.pathname, method: request.method });
    if (url.origin !== 'https://placement-concern-fixture.test' || request.method !== 'GET') {
      unexpected.push('non-fixture-read'); throw new Error('Unexpected placement fixture transport');
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.headers.get('authorization') === 'Bearer expired-placement-fixture') return Response.json({ message: 'Invalid fixture session' }, { status: 401 });
      return Response.json({ id: '${USER}', aud: 'authenticated', role: 'authenticated', email: 'placement@example.invalid',
        email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: {}, user_metadata: {} });
    }
    if (['/rest/v1/question_edits', '/rest/v1/app_settings'].includes(url.pathname)) return Response.json([]);
    unexpected.push('unknown-read'); throw new Error('Unexpected placement fixture read');
  };
  require('node:net').Socket.prototype.connect = () => { unexpected.push('socket'); throw new Error('Live socket forbidden'); };
`;
const fixture = `
  let address = 0;
  const call = async (method, query, body, bearer) => {
    const res = { statusCode: 200, headersSent: false, headers: {}, body: undefined,
      setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); return this; },
      getHeader(name) { return this.headers[name.toLowerCase()]; }, status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; this.headersSent = true; return this; }, send(body) { this.body = body; this.headersSent = true; return this; },
      end() { this.headersSent = true; } };
    await mod.default({ method, query, body, url: '/api/quiz/roadmap',
      headers: { 'x-forwarded-for': '198.51.100.' + (++address), ...(bearer ? { authorization: 'Bearer ' + bearer } : {}) },
      socket: { remoteAddress: '127.0.0.1' } }, res);
    return res;
  };
  const start = () => call('GET', { resource: 'placement', subject: 'webdev' });
  const round = (placementToken, answers, bearer) => call('POST', { resource: 'placement' }, { placementToken, answers }, bearer);
  const snapshot = res => ({ status: res.statusCode, body: res.body, cache: res.headers['cache-control'], etag: res.headers.etag || null, allow: res.headers.allow || null });
`;

async function probe(expression: string): Promise<any> {
  const parent = join(process.cwd(), 'node_modules/.cache/shark');
  mkdirSync(parent, { recursive: true });
  const owned = mkdtempSync(join(parent, 'placement-concern-'));
  try {
    const tokenArtifact = join(owned, 'tokens.cjs');
    await bundleColdEntry('lib/quiz-tokens.ts', tokenArtifact);
    const result = await loadFresh('api/quiz/roadmap.ts', `(async () => {
      const tokens = require(${JSON.stringify(tokenArtifact)});
      ${fixture}
      ${expression}
    })()`, ENV, MARKERS, beforeImport);
    return result.probe;
  } finally { rmSync(owned, { recursive: true, force: true }); }
}

test('placement concern loads on a positive placement call and stays absent from entry and map', async () => {
  const value = await probe(`
    const before = [...(globalThis.__evaluated || [])];
    const map = await call('GET', {});
    const afterMap = [...(globalThis.__evaluated || [])];
    const placed = await start();
    return { before, afterMap, afterPlacement: [...(globalThis.__evaluated || [])], map: snapshot(map), placed: snapshot(placed), unexpected };
  `);
  assert.deepEqual(value.before, []);
  assert.deepEqual(value.afterMap, []);
  assert.deepEqual(value.afterPlacement, MARKERS, 'The positive control proves the concern actually loaded');
  assert.equal(value.map.status, 200);
  assert.equal(value.map.cache, 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
  assert.equal(value.placed.status, 200);
  assert.equal(value.placed.body.round, 1);
  assert.equal(value.placed.body.asked, 0);
  assert.equal(value.placed.body.total, 20);
  assert.equal(value.placed.body.questions.length, 5);
  assert.deepEqual(value.unexpected, []);
});

test('placement keeps the shared answer-free projection, private responses and one-use round claims', async () => {
  const value = await probe(`
    const first = await start(), state = tokens.decodePlacementRun(first.body.placementToken);
    const answers = Object.fromEntries(state.items.map(item => [item.questionId, item.correctAnswer]));
    const accepted = await round(first.body.placementToken, answers);
    const replay = await round(first.body.placementToken, {});
    const other = await start(), otherState = tokens.decodePlacementRun(other.body.placementToken);
    const malformed = await round(other.body.placementToken, 'not-an-object');
    const recovered = await round(other.body.placementToken, Object.fromEntries(otherState.items.map(item => [item.questionId, -1])));
    return { first: snapshot(first), accepted: snapshot(accepted), replay: snapshot(replay), malformed: snapshot(malformed), recovered: snapshot(recovered), unexpected };
  `);
  for (const question of value.first.body.questions) {
    assert.equal('correctAnswer' in question, false);
    assert.equal('explanation' in question, false);
    assert.equal('tags' in question, false);
    assert.deepEqual(Object.keys(question).filter(key => !['id', 'introduction', 'question', 'options', 'category', 'difficulty', 'review'].includes(key)), []);
  }
  for (const response of [value.first, value.accepted, value.recovered]) {
    assert.equal(response.status, 200);
    assert.equal(response.cache, 'private, no-store');
    assert.equal(response.etag, null);
  }
  assert.equal(value.accepted.body.asked, 5);
  assert.equal(value.accepted.body.lastRoundCorrect, 5);
  assert.equal(value.accepted.body.lastRoundSize, 5);
  assert.equal(value.replay.status, 409);
  assert.equal(value.replay.body.error.code, 'placement_round_used');
  assert.equal('review' in value.replay.body, false);
  assert.equal('lastRoundCorrect' in value.replay.body, false);
  assert.equal(value.malformed.status, 400);
  assert.equal(value.malformed.body.error.code, 'bad_request');
  assert.equal(value.recovered.body.lastRoundCorrect, 0);
  assert.deepEqual(value.unexpected, []);
});

test('final authentication is resolved before claiming the round and mints only its verified caller receipt', async () => {
  const value = await probe(`
    const first = await start(), state = tokens.decodePlacementRun(first.body.placementToken), item = state.items[0];
    const final = tokens.encodePlacementRun({ subject: 'webdev', attemptId: 'fixture-r2-final-auth-claim', round: 4, difficulty: 3,
      history: Array.from({ length: 19 }, (_, i) => ({ questionId: 'fixture-history-' + i, category: item.category, isCorrect: true })), items: [item] });
    const answers = { [item.questionId]: item.correctAnswer };
    const refused = await round(final, answers, 'expired-placement-fixture');
    const accepted = await round(final, answers, 'valid-placement-fixture');
    const receipt = tokens.decodeQuizResultReceipt(accepted.body.resultReceipt);
    const replay = await round(final, answers, 'valid-placement-fixture');
    return { refused: snapshot(refused), accepted: snapshot(accepted), receipt, replay: snapshot(replay),
      authCalls: calls.filter(call => call.path === '/auth/v1/user').length, unexpected };
  `);
  assert.equal(value.refused.status, 401);
  assert.equal(value.accepted.status, 200, 'The refused round was not consumed');
  assert.equal(value.accepted.body.done, true);
  assert.equal(value.accepted.body.total, 20);
  assert.equal(value.accepted.body.correct, 20);
  assert.equal(value.receipt.userId, USER);
  assert.equal(value.receipt.purpose, 'assessment');
  assert.equal(value.receipt.total, 20);
  assert.equal(value.replay.status, 409);
  assert.equal('resultReceipt' in value.replay.body, false);
  assert.equal(value.authCalls, 3, 'One caller verification per final request, shared with its rate prelude');
  assert.deepEqual(value.unexpected, []);
});

test('placement retains scope/method/token refusals and voids retired items before review', async () => {
  const value = await probe(`
    const wrongSubject = await call('GET', { resource: 'placement', subject: 'constructor' });
    const wrongMethod = await call('DELETE', { resource: 'placement', subject: 'webdev' });
    const malformed = await round(['not-a-token'], {});
    const first = await start(), state = tokens.decodePlacementRun(first.body.placementToken), item = state.items[0];
    const token = tokens.encodePlacementRun({ ...state, attemptId: 'fixture-r2-retired-item-claim', history: [],
      items: [item, { questionId: 'fixture-retired-item', category: item.category, correctAnswer: 0 }] });
    const result = await round(token, { [item.questionId]: item.correctAnswer, 'fixture-retired-item': 0 });
    return { wrongSubject: snapshot(wrongSubject), wrongMethod: snapshot(wrongMethod), malformed: snapshot(malformed), result: snapshot(result), unexpected };
  `);
  assert.equal(value.wrongSubject.status, 400);
  assert.equal(value.wrongSubject.body.error.code, 'invalid_subject_scope');
  assert.equal(value.wrongMethod.status, 405);
  assert.equal(value.wrongMethod.allow, 'GET, POST');
  assert.equal(value.malformed.status, 400);
  assert.equal(value.malformed.body.error.code, 'invalid_session');
  assert.equal(value.result.status, 200);
  assert.equal(value.result.body.voided, 1);
  assert.equal(value.result.body.lastRoundSize, 1);
  assert.equal(value.result.body.lastRoundCorrect, 1);
  assert.equal(value.result.body.asked, 1);
  assert.equal(value.result.body.review.length, 1);
  assert.deepEqual(value.unexpected, []);
});
