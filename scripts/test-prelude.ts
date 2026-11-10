/* The rate-limit prelude's round trips (#587, server item 2).
 *
 * A read or a class-sized write takes an address bucket, the caller's token
 * check and the caller's own bucket. They used to run one after another;
 * the token check now runs while the address bucket answers, and the
 * caller's bucket still waits for both. Against local stand-ins for Upstash
 * (answering the sliding-window script as @upstash/ratelimit expects) and
 * Supabase Auth, each answering after DELAY_MS, this pins:
 *  - the token check starts before the address bucket has answered, and the
 *    caller's bucket starts only after both: two waves, not three;
 *  - a request its address bucket refuses answers 429 and spends nothing of
 *    the caller's bucket;
 *  - once an address was refused on this instance, its next requests have
 *    their token checked only after the bucket admits them, for a minute.
 * Run as its own process by scripts/test-request-timing.ts, since the
 * modules read these settings when they load. Nothing leaves the machine. */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const DELAY_MS = 80;
interface Call { kind: 'upstash' | 'auth'; key?: string; start: number; end: number }
const calls: Call[] = [];
/** Addresses whose address bucket the Upstash stand-in refuses. */
const refused = new Set<string>();
let hungConnections = 0;
let closedConnections = 0;

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = '';
  req.on('data', (chunk) => { text += chunk; });
  req.on('end', () => resolve(text));
});
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};
const later = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

// @upstash/redis sends commands to /pipeline in batches (auto-pipelining)
// and expects one { result } per command.
const upstash = createServer(async (req, res) => {
  const start = performance.now();
  const body = JSON.parse(await readBody(req)) as unknown[];
  const commands = (req.url === '/pipeline' ? body : [body]) as unknown[][];
  if (commands.some((command) => String(command[3] ?? '').includes(':limiter_transport:'))) {
    hungConnections += 1;
    res.once('close', () => { closedConnections += 1; });
    return;
  }
  await later();
  const results = commands.map((command) => {
    const key = String(command[3] ?? '');
    calls.push({ kind: 'upstash', key, start, end: performance.now() });
    const name = String(command[0]).toLowerCase();
    if (name !== 'evalsha' && name !== 'eval') return { result: 'OK' };
    const address = [...refused].find((one) => key.includes(`:${one}:`));
    // [remaining, limit]: -1 refuses, as the sliding-window script answers.
    return { result: address && key.includes('_address:') ? [-1, 100] : [10, 100] };
  });
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(req.url === '/pipeline' ? results : results[0]));
});
const auth = createServer(async (req, res) => {
  const start = performance.now();
  await later();
  calls.push({ kind: 'auth', start, end: performance.now() });
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ id: `1a2b3c4d-0000-4000-8000-${token.padStart(12, '0').slice(-12)}`, aud: 'authenticated', role: 'authenticated', email: null, app_metadata: {}, user_metadata: {} }));
});

const [upstashPort, authPort] = await Promise.all([listen(upstash), listen(auth)]);
process.env.SUPABASE_URL = `http://127.0.0.1:${authPort}`;
process.env.SUPABASE_ANON_KEY = 'anon-prelude';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-prelude';
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${upstashPort}`;
process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-prelude';
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'NODE_ENV', 'VERCEL_ENV', 'VERCEL']) delete process.env[key];

try {
  const [{ limitRead, enforceClassRateLimit, enforceRateLimit, RATE_LIMITS }, { withRequestContext }] = await Promise.all([
    import('../lib/rate-limit'),
    import('../lib/http'),
  ]);
  const response = () => {
    const res = {
      statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown, headersSent: false,
      setHeader(key: string, value: string) { res.headers[key.toLowerCase()] = String(value); return res; },
      getHeader(key: string) { return res.headers[key.toLowerCase()]; },
      status(code: number) { res.statusCode = code; return res; },
      json(body: unknown) { res.body = body; res.headersSent = true; return res; },
      end() { res.headersSent = true; return res; },
    };
    return res;
  };
  // A plain token, so lib/auth.ts never keeps it: each request asks Auth.
  const prelude = async (limit: (req: never, res: never) => Promise<boolean>, address: string, token: string) => {
    const req = { method: 'GET', headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': address }, query: {}, url: '/api/prelude', socket: {} };
    const res = response();
    let admitted = false;
    await withRequestContext(req as never, res as never, async () => { admitted = await limit(req as never, res as never); });
    return { admitted, status: res.statusCode };
  };
  const read = (req: never, res: never) => limitRead(req, res);
  const answer = (req: never, res: never) => enforceClassRateLimit(req, res, RATE_LIMITS.roadmapAnswerAddress, RATE_LIMITS.roadmapAnswer);

  // Warm the limiter module and the HTTP clients, so the timings below are
  // the round trips alone.
  await prelude(read, '198.51.100.1', '1');

  for (const [name, limit, own] of [['limitRead', read, 'read_user'], ['enforceClassRateLimit', answer, 'roadmap_answer:']] as const) {
    calls.length = 0;
    const outcome = await prelude(limit, '198.51.100.2', '2');
    assert.deepEqual(outcome, { admitted: true, status: 200 }, `${name}: admitted`);
    const address = calls.find((one) => one.kind === 'upstash' && one.key?.includes('_address:'));
    const check = calls.find((one) => one.kind === 'auth');
    const caller = calls.find((one) => one.kind === 'upstash' && one.key?.includes(own));
    assert.ok(address && check && caller, `${name}: an address bucket, a token check and the caller's bucket (${JSON.stringify(calls)})`);
    assert.ok(check.start < address.end, `${name}: the token check starts before the address bucket has answered`);
    assert.ok(caller.start >= address.end && caller.start >= check.end, `${name}: the caller's bucket waits for both`);
    const waves = caller.end - Math.min(address.start, check.start);
    assert.ok(waves < DELAY_MS * 2.75, `${name}: two waves of ${DELAY_MS} ms, not three (${waves.toFixed(0)} ms)`);
  }
  console.log('PASS prelude: the token check runs while the address bucket answers, and the caller\'s bucket waits for both');

  // A refused address: 429, the caller's bucket untouched.
  const flood = '203.0.113.9';
  refused.add(flood);
  calls.length = 0;
  assert.deepEqual(await prelude(read, flood, '3'), { admitted: false, status: 429 }, 'a refused address answers 429');
  assert.equal(calls.filter((one) => one.kind === 'upstash' && one.key?.includes('read_user')).length, 0, 'and spends nothing of the caller\'s bucket');
  // The bucket stays refused, and now the token waits for it: no Auth call.
  calls.length = 0;
  assert.deepEqual(await prelude(read, flood, '4'), { admitted: false, status: 429 });
  assert.equal(calls.filter((one) => one.kind === 'auth').length, 0, 'a refused address no longer reaches Supabase Auth');
  // Admitted again, its token is checked after the bucket, then in parallel
  // once the hold is over.
  refused.delete(flood);
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 120_000; // past the address window and the hold
    calls.length = 0;
    assert.deepEqual(await prelude(read, flood, '5'), { admitted: true, status: 200 }, 'admitted once the window passed');
    const address = calls.find((one) => one.kind === 'upstash' && one.key?.includes('_address:'))!;
    const check = calls.find((one) => one.kind === 'auth')!;
    assert.ok(check.start < address.end, 'and its token is checked alongside the bucket again');
  } finally {
    Date.now = realNow;
  }
  console.log('PASS prelude: a refused address answers 429 without the caller\'s bucket, and reaches Auth only after its bucket admits it for a minute');

  // The handlers that take the address tier themselves and check the caller
  // after it (a coding Submit, a learning-path start, submit and draft save)
  // check the token while the address bucket answers too, and the caller's
  // bucket still waits for both.
  {
    const [{ handleCodingSubmit }, paths] = await Promise.all([import('../lib/coding/handlers'), import('../lib/learning-paths/handlers')]);
    const cases: [string, string, (req: never, res: never) => Promise<unknown>, string | null][] = [
      ['coding-submit', 'POST', (req, res) => handleCodingSubmit(req, res, null), null],
      ['learning-path-start', 'POST', (req, res) => paths.handleActivityStart(req, res, null), 'learning_path_start:'],
      ['learning-path-submit', 'POST', (req, res) => paths.handleActivitySubmit(req, res, null), null],
      ['learning-path-draft', 'PUT', (req, res) => paths.handlePathDraft(req, res, null), null],
    ];
    let n = 10;
    for (const [name, method, run, own] of cases) {
      calls.length = 0;
      const req = { method, headers: { authorization: `Bearer ${n}`, 'x-forwarded-for': `198.51.100.${n}` }, query: {}, url: '/api/prelude', socket: {}, body: {} };
      const res = response();
      n += 1;
      await withRequestContext(req as never, res as never, async () => { await run(req as never, res as never); });
      // A request answered before its token check returned leaves it running.
      await later();
      assert.notEqual(res.statusCode, 429, `${name}: admitted`);
      const address = calls.find((one) => one.kind === 'upstash' && one.key?.includes('_address:'));
      const check = calls.find((one) => one.kind === 'auth');
      assert.ok(address && check, `${name}: an address bucket and a token check (${JSON.stringify(calls)})`);
      assert.ok(check.start < address.end, `${name}: the token check starts before the address bucket has answered`);
      assert.equal(calls.filter((one) => one.kind === 'auth').length, 1, `${name}: the handler reads the same check`);
      if (own) {
        const caller = calls.find((one) => one.kind === 'upstash' && one.key?.includes(own));
        assert.ok(caller && caller.start >= address.end && caller.start >= check.end, `${name}: the caller's bucket waits for both`);
      }
    }
    // A refused address: 429, and the hold keeps its next request away from Auth.
    const flood = '203.0.113.77';
    refused.add(flood);
    try {
      for (const expectAuth of [true, false]) {
        calls.length = 0;
        const req = { method: 'PUT', headers: { authorization: 'Bearer 99', 'x-forwarded-for': flood }, query: {}, url: '/api/prelude', socket: {}, body: {} };
        const res = response();
        await withRequestContext(req as never, res as never, async () => { await paths.handlePathDraft(req as never, res as never, null); });
        await later();
        assert.equal(res.statusCode, 429, 'a refused address answers 429');
        assert.equal(calls.filter((one) => one.kind === 'auth').length, expectAuth ? 1 : 0, expectAuth ? 'the first refusal was checked meanwhile' : 'a refused address no longer reaches Supabase Auth');
      }
    } finally {
      refused.delete(flood);
    }
  }
  console.log('PASS prelude: a coding Submit and the learning-path start, submit and draft save check the token while their address bucket answers');
  // Stop the HTTP request as well as releasing the learner's request. The
  // stand-in never sends headers, so closing it requires a transport abort.
  const config = { key: 'limiter_transport', capacity: 1, refillPerSecond: 1 / 3600 };
  const transport = (req: never, res: never) => enforceRateLimit(req, res, config, 'user:limiter_transport');
  assert.deepEqual(await prelude(transport, '198.51.100.91', '91'), { admitted: true, status: 200 });
  const closeDeadline = Date.now() + 1_000;
  while (!closedConnections && Date.now() < closeDeadline) await later();
  assert.equal(closedConnections, 1, 'the fallback cancels the hanging Upstash transport');
  assert.deepEqual(await prelude(transport, '198.51.100.91', '91'), { admitted: false, status: 429 });
  assert.equal(hungConnections, 1, 'the paused limiter spends only from the local bucket');
  console.log('PASS prelude: distributed limiter timeout aborts its HTTP request and falls back locally');
} finally {
  upstash.closeAllConnections();
  upstash.close();
  auth.close();
}
