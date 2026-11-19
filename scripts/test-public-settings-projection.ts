// The public projection is narrower than the private administrator settings.
// All credentials/transport are invented; no live sockets or database writes.
import './launch-test-env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { after, test } from 'node:test';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import type { VercelRequest, VercelResponse } from '../lib/vercel-types';

const ORIGIN = 'https://public-settings-projection-fixture.test';
const OWNER = '11111111-1111-4111-8111-111111111111';
process.env.SUPABASE_URL = ORIGIN;
process.env.SUPABASE_ANON_KEY = 'invented-settings-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'invented-settings-service';
process.env.OWNER_EMAIL = 'settings-owner@example.invalid';
process.env.BILLING_ENABLED = 'false';
process.env.LEARNING_PATH_FDE_ENABLED = 'false';
const originalFetch = globalThis.fetch;
const originalConnect = Object.getOwnPropertyDescriptor(Socket.prototype, 'connect')!;
const unexpected: string[] = [];
let written: any = null;
Object.defineProperty(Socket.prototype, 'connect', { ...originalConnect, value() {
  unexpected.push('socket'); throw new Error('Settings projection tests forbid live sockets');
} });
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (url.origin !== ORIGIN) { unexpected.push('origin'); throw new Error('Non-fixture origin'); }
  if (url.pathname === '/auth/v1/user' && request.method === 'GET') return Response.json({
    id: OWNER, aud: 'authenticated', role: 'authenticated', email: 'settings-owner@example.invalid',
    email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { role: 'admin' }, user_metadata: {},
  });
  if (url.pathname === '/rest/v1/app_settings' && request.method === 'POST') {
    written = await request.json(); return new Response(null, { status: 201 });
  }
  unexpected.push('operation'); throw new Error('Undeclared fixture transport');
};
const [{ default: publicSettings }, { default: admin }, store] = await Promise.all([
  import('../api/settings'), import('../api/admin/[op]'), import('../lib/settings-store'),
]);
const stored = structuredClone(store.DEFAULT_SETTINGS);
const custom = { ...structuredClone(stored), devTips: ['A private editor still owns this tip.'], shop: { prices: { ...stored.shop.prices, 'ring-emerald': 777 }, pathUnlockPrice: 333 } };
let address = 0;
async function call(handler = publicSettings, input: { method?: string; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {}) {
  const res = { statusCode: 200, headersSent: false, headers: {} as Record<string, string>, body: undefined as any, ended: false,
    setHeader(name: string, value: unknown) { assert.equal(this.headersSent, false); this.headers[name.toLowerCase()] = String(value); return this; },
    getHeader(name: string) { return this.headers[name.toLowerCase()]; }, status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; this.headersSent = true; return this; },
    send(body: unknown) { this.body = body; this.headersSent = true; return this; },
    end() { this.ended = true; this.headersSent = true; return this; },
  };
  await handler({ method: input.method ?? 'GET', query: input.query ?? {}, body: input.body,
    url: handler === publicSettings ? '/api/settings' : '/api/admin/settings', socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-forwarded-for': `198.18.12.${++address}`, ...input.headers } } as VercelRequest, res as unknown as VercelResponse);
  return res;
}
after(() => {
  store.setGameSettingsForTests(null); globalThis.fetch = originalFetch;
  Object.defineProperty(Socket.prototype, 'connect', originalConnect);
  assert.deepEqual(unexpected, [], 'No undeclared transport or socket was attempted');
});

// Capture the real current handler's serialized body before omission assertions.
// Byte observations are separate from latency and use Node's default codecs.
store.setGameSettingsForTests(stored);
const measured = await call();
assert.equal(measured.statusCode, 200); assert.equal(measured.headersSent, true);
const bytes = Buffer.from(JSON.stringify(measured.body));
if (process.env.F7_SETTINGS_RESULT_OUTPUT) {
  const paths = ['api/settings.ts', 'lib/settings-store.ts', 'client/src/lib/gameConfig.ts', 'package-lock.json', 'client/package-lock.json'];
  const sources = Object.fromEntries(paths.map(path => { const body = readFileSync(path); return [path, { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }]; }));
  writeFileSync(process.env.F7_SETTINGS_RESULT_OUTPUT, JSON.stringify({ recordedUtc: new Date().toISOString(),
    sourceHead: process.env.F7_SETTINGS_SOURCE_HEAD || 'unrecorded', node: process.version,
    method: 'Actual handler, invented configuration, JSON.stringify; gzipSync and brotliCompressSync use Node default options',
    limits: 'Local representation bytes, not deployed compression/transfer bytes or latency. No private admin response is recorded.',
    sources, status: measured.statusCode, cache: measured.headers['cache-control'], etag: measured.headers.etag,
    rawBytes: bytes.length, gzipDefaultBytes: gzipSync(bytes).length, brotliDefaultBytes: brotliCompressSync(bytes).length,
    publicBody: measured.body,
  }, null, 2) + '\n');
}

test('public settings omit unused dev tips while retaining their private stored value', async () => {
  store.setGameSettingsForTests(custom);
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(res.body, 'devTips'), false);
  assert.deepEqual((await store.getGameSettings()).devTips, custom.devTips);
});

test('public settings omit retired cosmetic prices while retaining their private stored value', async () => {
  store.setGameSettingsForTests(custom);
  const res = await call();
  assert.equal(Object.hasOwn(res.body, 'shop'), false);
  assert.deepEqual((await store.getGameSettings()).shop, custom.shop);
});

test('active public fields, exact cache policy and private method refusals remain intact', async () => {
  store.setGameSettingsForTests(custom);
  const res = await call();
  assert.deepEqual(res.body.quiz, { defaultCount: custom.quiz.defaultCount, countOptions: custom.quiz.countOptions,
    maxCount: custom.quiz.maxCount, defaultDifficulty: custom.quiz.defaultDifficulty, defaultCategoryIds: custom.quiz.defaultCategoryIds });
  for (const key of ['daily', 'features', 'leveling', 'coins'] as const) assert.deepEqual(res.body[key], custom[key]);
  assert.deepEqual(res.body.play, { defaultDurationS: custom.play.defaultDurationS, durationOptionsS: custom.play.durationOptionsS, countOptions: custom.play.countOptions });
  assert.equal('ownerEmail' in res.body, false); assert.equal(res.headers['cache-control'], 'public, s-maxage=15, stale-while-revalidate=60');
  assert.equal(typeof res.body.learningPaths.paths, 'object'); assert.equal(res.body.merch.redemptionOpen, false);
  assert.equal(res.body.billing.enabled, false); assert.equal(res.body.merchPromo, null);
  const refused = await call(publicSettings, { method: 'POST', headers: { 'if-none-match': '*' } });
  assert.equal(refused.statusCode, 405); assert.equal(refused.headers.allow, 'GET');
  assert.equal(refused.headers['cache-control'], 'private, no-store'); assert.equal(refused.headers.etag, undefined);
});

test('private-only edits do not change the public validator; active edits still revalidate', async () => {
  store.setGameSettingsForTests(stored); const first = await call();
  store.setGameSettingsForTests(custom);
  const unchanged = await call(publicSettings, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(unchanged.statusCode, 304); assert.equal(unchanged.body, undefined); assert.equal(unchanged.ended, true);
  store.setGameSettingsForTests({ ...custom, quiz: { ...custom.quiz, maxCount: 31 } });
  const changed = await call(publicSettings, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(changed.statusCode, 200); assert.equal(changed.body.quiz.maxCount, 31); assert.notEqual(changed.headers.etag, first.headers.etag);
});

test('the authenticated admin GET and save preserve tips and legacy prices unchanged', async () => {
  store.setGameSettingsForTests(custom); written = null;
  const headers = { authorization: 'Bearer invented-settings-admin-token' };
  const read = await call(admin, { headers, query: { op: 'settings' } });
  assert.equal(read.statusCode, 200); assert.equal(read.headers['cache-control'], 'no-store'); assert.equal(read.headers.etag, undefined);
  assert.deepEqual(read.body.settings.devTips, custom.devTips); assert.deepEqual(read.body.settings.shop, custom.shop);
  const saved = await call(admin, { method: 'POST', headers, query: { op: 'settings' }, body: { settings: custom } });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.settings.devTips, custom.devTips); assert.deepEqual(saved.body.settings.shop, custom.shop);
  assert.deepEqual(written.value.devTips, custom.devTips); assert.deepEqual(written.value.shop, custom.shop);
});
