// Actual handlers with synthetic SDK transport, never live APIs.
import assert from 'node:assert/strict';
import { loadFresh } from './cold-start-contracts';

const cases = [
  ['api/health.ts', '/api/health', {}, 200, null],
  ['api/settings.ts', '/api/settings', {}, 200, null],
  ['api/leaderboard.ts', '/api/leaderboard', { period: 'global', limit: '10' }, 200, null],
  ['api/quiz/questions.ts', '/api/quiz/questions', { resource: 'curation' }, 200, null],
  ['api/quiz/roadmap.ts', '/api/quiz/roadmap', {}, 200, null],
  ['api/quiz/challenge.ts', '/api/quiz/challenge', { resource: '__perf_probe__' }, 404, 'unknown_resource'],
  ['api/quiz/daily.ts', '/api/quiz/daily', { qotd: '__perf_probe__' }, 400, 'bad_request'],
  ['api/quiz/submit.ts', '/api/quiz/submit', {}, 405, 'method_not_allowed'],
  ['api/flashcards.ts', '/api/flashcards', { subject: 'webdev' }, 401, 'missing_token'],
  ['api/user/[op].ts', '/api/user/__perf_probe__', { op: '__perf_probe__' }, 404, 'unknown_op'],
  ['api/play/[action].ts', '/api/play/__perf_probe__', { action: '__perf_probe__' }, 404, 'unknown_action'],
  ['api/admin/[op].ts', '/api/admin/__perf_probe__', { op: '__perf_probe__' }, 403, 'forbidden'],
] as const;
export async function coldProbeSafetyContracts(): Promise<void> {
  const variants: Array<{ spec: readonly [string, string, Readonly<Record<string, string>>, number, string | null]; configured: boolean; legacy?: boolean; authMissing?: boolean; featureOff?: boolean; rpcMissing?: boolean }> = [
    ...cases.map(spec => ({ spec, configured: true })),
    { spec: ['api/flashcards.ts', '/api/flashcards', { subject: 'webdev' }, 503, 'not_configured'], configured: false },
    { spec: ['api/user/[op].ts', '/api/user/__perf_probe__', { op: '__perf_probe__' }, 503, 'not_configured'], configured: false },
    { spec: ['api/play/[action].ts', '/api/play/__perf_probe__', { action: '__perf_probe__' }, 503, 'not_configured'], configured: false },
    { spec: ['api/admin/[op].ts', '/api/admin/__perf_probe__', { op: '__perf_probe__' }, 403, 'forbidden'], configured: true, legacy: true },
    { spec: ['api/flashcards.ts', '/api/flashcards', { subject: 'webdev' }, 503, 'auth_not_configured'], configured: true, authMissing: true },
    { spec: ['api/play/[action].ts', '/api/play/__perf_probe__', { action: '__perf_probe__' }, 503, 'feature_disabled'], configured: true, featureOff: true },
    { spec: ['api/leaderboard.ts', '/api/leaderboard', { period: 'global', limit: '10' }, 503, 'rpc_missing'], configured: true, rpcMissing: true },
  ];
  for (const { spec, configured, legacy = false, authMissing = false, featureOff = false, rpcMissing = false } of variants) {
    const [entry, url, query, status, code] = spec;
    const beforeImport = `
      process.env.SUPABASE_URL = ${JSON.stringify(configured ? 'https://cold-probe-fixture.test' : '')};
      process.env.SUPABASE_ANON_KEY = ${JSON.stringify(configured && !authMissing ? 'cold-probe-fixture-anon' : '')};
      process.env.SUPABASE_SERVICE_ROLE_KEY = ${JSON.stringify(configured ? 'cold-probe-fixture-service' : '')};
      process.env.DEV_PASSWORD = ${JSON.stringify(legacy ? 'invented-fixture-legacy-value' : '')};
      process.env.ALLOW_LEGACY_DEV_PASSWORD = ${JSON.stringify(legacy ? 'true' : 'false')};
      process.env.NODE_ENV = ${JSON.stringify(authMissing ? 'production' : 'development')};
      process.env.SESSION_SECRET = 'invented-fixture-session-material-not-used';
      process.env.VITE_PRODUCT = 'devshark'; process.env.VITE_LOCK_SUBJECT = 'webdev';
      let seals = 0; const writes = []; const reads = []; let auth = 0;
      const crypto = require('node:crypto'); const cipher = crypto.createCipheriv;
      crypto.createCipheriv = () => { seals++; throw new Error('sealed session forbidden'); };
      globalThis.fetch = async (input, init = {}) => {
        const request = input instanceof Request ? input : new Request(input, init);
        const target = new URL(request.url);
        if (target.origin !== 'https://cold-probe-fixture.test') throw new Error('unexpected transport');
        if (target.pathname.startsWith('/auth/')) { auth++; throw new Error('anonymous probe must not call Auth'); }
        // subject_leaderboard uses HTTP POST for a read-only SQL RPC. No
        // write/settlement/grade RPC, query mutation or other POST is allowed.
        if (request.method !== 'GET' && !(request.method === 'POST' && target.pathname === '/rest/v1/rpc/subject_leaderboard')) {
          writes.push(target.pathname); throw new Error('business write forbidden');
        }
        reads.push({ path: target.pathname, method: request.method });
        if (${rpcMissing} && target.pathname === '/rest/v1/rpc/subject_leaderboard') return Response.json({ code: 'PGRST202', message: 'fixture missing read routine' }, { status: 404 });
        return Response.json(target.pathname === '/rest/v1/app_settings' ? [{ value: { features: { multiplayer: ${!featureOff} } } }] : []);
      };
      require('node:net').Socket.prototype.connect = () => { writes.push('socket'); throw new Error('unexpected socket'); };
    `;
    const expression = `(async () => {
      if (typeof seals !== 'number') throw new Error('before-import safety fixture unavailable');
      const call = async (query) => {
        const res = { statusCode: 200, headers: {}, body: null,
          setHeader(name,value) { this.headers[name.toLowerCase()] = value; return this; }, getHeader(name) { return this.headers[name.toLowerCase()]; },
          status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, end() {} };
        await mod.default({ method: 'GET', url: ${JSON.stringify(url)}, headers: ${legacy} ? { 'x-dev-password': 'invented-fixture-legacy-value' } : {}, body: ${legacy} ? { password: 'invented-fixture-legacy-value' } : undefined, query, socket: { remoteAddress: '127.0.0.1' } }, res);
        return { status: res.statusCode, code: res.body?.error?.code ?? null, body: res.body, allow: res.headers.allow };
      };
      try {
        const first = await call(${JSON.stringify(query)});
        const nonce = ${status === 200 && ['api/settings.ts', 'api/leaderboard.ts', 'api/quiz/questions.ts', 'api/quiz/roadmap.ts'].includes(entry) ? `await call({ ...${JSON.stringify(query)}, __perf_probe: 'fixed-safety-fixture' })` : 'null'};
        return { first, nonce, seals, writes, reads, auth };
      } finally { crypto.createCipheriv = cipher; }
    })()`;
    const fresh = await loadFresh(entry, expression, {}, [], beforeImport);
    const result = fresh.probe as { first: { status: number; code: string | null; body: unknown; allow?: string }; nonce: { body: unknown } | null; seals: number; writes: unknown[]; reads: unknown[]; auth: number };
    assert.equal(result.first.status, status, entry); assert.equal(result.first.code, code, entry);
    assert.equal(result.seals, 0, `${entry}: no session encryption`); assert.deepEqual(result.writes, [], `${entry}: no business-write transport`); assert.equal(result.auth, 0, `${entry}: no anonymous Auth transport`);
    if (entry === 'api/quiz/submit.ts') assert.equal(result.first.allow, 'POST');
    if (result.nonce) assert.deepEqual(result.nonce.body, result.first.body, `${entry}: diagnostic nonce is ignored`);
  }
  console.log('PASS probe safety: exact anonymous resources/refusals issue no session, business-write transport or Auth request');
}
