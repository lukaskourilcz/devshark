// Local native HTTP reuse through the existing SDK wrappers (#636).
// No CLI, deployed origin, real credential, custom dispatcher or native-pool mutation.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Socket, type AddressInfo } from 'node:net';
import type { VercelRequest } from '../lib/vercel-types';

type Lane = 'db' | 'auth' | 'upstash';
type Mode = 'ok' | 'error' | 'close' | 'hang';
type Row = { lane: Lane; phase: string; socket: number; status: number; ended: boolean; closed: boolean };
const rows: Row[] = [];
const changes = new EventEmitter();
const sockets = new Map<Socket, number>();
const closedSockets = new Set<number>();
let mode: Mode = 'ok', phase = 'prepare', sequence = 0;
const USER = '11111111-1111-4111-8111-111111111111';
const TAIL = 'x'.repeat(4096);
const nativeFetch = globalThis.fetch;
const nativeConnect = Socket.prototype.connect;
const ownedEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'UPSTASH_DISABLE_TELEMETRY', 'NODE_ENV', 'VERCEL_ENV', 'VERCEL'];
const savedEnv = new Map(ownedEnv.map(key => [key, process.env[key]]));

function bounded<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}
async function body(req: IncomingMessage): Promise<string> {
  let value = '';
  for await (const chunk of req) { value += String(chunk); assert.ok(value.length <= 16384, 'Fixture body cap'); }
  return value;
}
function until(predicate: () => boolean): Promise<void> {
  return new Promise(resolve => {
    const check = () => { if (predicate()) { changes.removeListener('change', check); resolve(); } };
    changes.on('change', check); check();
  });
}
function splitJson(res: ServerResponse, value: unknown) {
  const text = JSON.stringify(value);
  res.setHeader('Content-Type', 'application/json');
  res.write(text.slice(0, text.length - 1));
  // One event-loop turn gives the fixture a genuine, incomplete body at headers.
  setImmediate(() => res.end(text.slice(-1)));
}
const fixture = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://fixture.invalid').pathname;
  let lane: Lane;
  if (path === '/rest/v1/connection_fixture' && req.method === 'GET') lane = 'db';
  else if (path === '/auth/v1/user' && req.method === 'GET') lane = 'auth';
  else if ((path === '/' || path === '/pipeline') && req.method === 'POST') {
    lane = 'upstash';
    const wire = JSON.parse(await body(req));
    const commands = path === '/pipeline' ? wire : [wire];
    assert.ok(commands.every((command: unknown[]) => Array.isArray(command) && String(command[0]).toUpperCase() === 'SET'), 'Only the existing invented one-time SET fixture is allowed');
  } else { res.writeHead(500); res.end('Unexpected local fixture path'); throw new Error('Unexpected fixture operation'); }
  const row: Row = { lane, phase, socket: sockets.get(req.socket)!, status: mode === 'error' ? (lane === 'auth' ? 401 : 400) : 200, ended: false, closed: false };
  rows.push(row);
  res.once('finish', () => { row.ended = true; changes.emit('change'); });
  res.once('close', () => { row.closed = true; changes.emit('change'); });
  res.statusCode = row.status;
  if (mode === 'close') res.setHeader('Connection', 'close');
  if (mode === 'hang') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); changes.emit('change'); return; }
  if (mode === 'error') splitJson(res, lane === 'upstash' ? { error: 'invented fixture refusal' } : { code: 'fixture_refusal', error_code: 'bad_jwt', message: 'invented fixture refusal', details: null, hint: null });
  else if (lane === 'db') splitJson(res, [{ id: 1, tail: TAIL }]);
  else if (lane === 'auth') splitJson(res, { id: USER, aud: 'authenticated', role: 'authenticated', email: null, app_metadata: {}, user_metadata: { fixtureTail: TAIL } });
  else splitJson(res, path === '/pipeline' ? [{ result: 'OK' }] : { result: 'OK' });
  changes.emit('change');
});
fixture.keepAliveTimeout = 10000;
fixture.on('connection', socket => {
  const id = sockets.size + 1; sockets.set(socket, id);
  socket.once('close', () => { closedSockets.add(id); changes.emit('change'); });
});
await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
const port = (fixture.address() as AddressInfo).port;
const origin = `http://127.0.0.1:${port}`;
const denied: string[] = [];

try {
  // Guard all fetch calls, including optional SDK paths; delegate native transport.
  globalThis.fetch = (input, init) => {
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (target.origin !== origin || target.username || target.password) { denied.push('fetch'); throw new Error('Non-fixture fetch refused'); }
    return nativeFetch(input, init);
  };
  Socket.prototype.connect = function (this: Socket, ...args: any[]) {
    const value = Array.isArray(args[0]) ? args[0][0] : args[0];
    const host = typeof value === 'object' ? value.host ?? value.hostname : args[1];
    const destination = typeof value === 'object' ? Number(value.port) : Number(value);
    if (host !== '127.0.0.1' || destination !== port) { denied.push('socket'); throw new Error('Non-fixture socket refused'); }
    return nativeConnect.apply(this, args as never);
  } as typeof Socket.prototype.connect;
  for (const key of ownedEnv) delete process.env[key];
  Object.assign(process.env, { SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'invented-connections-anon', SUPABASE_SERVICE_ROLE_KEY: 'invented-connections-service', UPSTASH_REDIS_REST_URL: origin, UPSTASH_REDIS_REST_TOKEN: 'invented-connections-upstash', UPSTASH_DISABLE_TELEMETRY: '1', NODE_ENV: 'development' });
  const [{ createServiceClient }, { requireAuth }, { claimOnce }] = await Promise.all([import('../lib/http'), import('../lib/auth'), import('../lib/rate-limit')]);
  const client = createServiceClient();
  assert.ok(client);
  const request = (): VercelRequest => ({ method: 'POST', headers: { authorization: `Bearer invented-connection-${++sequence}` }, query: {}, url: '/api/fixture', socket: { remoteAddress: '127.0.0.1' } });
  const call = async (lane: Lane, expectedError = false) => {
    if (lane === 'db') {
      const result = await client.from('connection_fixture').select('id,tail');
      if (expectedError) { assert.equal(result.status, 400); assert.equal(result.error?.code, 'fixture_refusal'); }
      else { assert.equal(result.error, null); assert.deepEqual(result.data, [{ id: 1, tail: TAIL }]); }
    } else if (lane === 'auth') {
      if (expectedError) await assert.rejects(requireAuth(request()), error => (error as { status?: number }).status === 401);
      else assert.equal((await requireAuth(request())).sub, USER);
    } else {
      if (expectedError) await assert.rejects(claimOnce(`f7_connection:${++sequence}`, 60), error => (error as { code?: string }).code === 'claim_unavailable');
      else assert.equal(await claimOnce(`f7_connection:${++sequence}`, 60), true);
    }
  };
  const report: unknown[] = [];
  const snapshot = (selected: Row[]) => ({ requests: selected.length, sockets: new Set(selected.map(row => row.socket)).size, rows: selected.map(row => ({ ...row })) });
  const reused = (selected: Row[]) => selected.length >= 4 && new Set(selected.map(row => row.socket)).size <= selected.length / 2;
  // Same-origin native control separates fixture/pool behavior from SDK lanes.
  mode = 'ok'; phase = 'native-consumed-control';
  const nativeBegin = rows.length;
  for (let i = 0; i < 12; i++) await bounded((async () => {
    const res = await globalThis.fetch(`${origin}/rest/v1/connection_fixture`);
    assert.equal(res.status,200); assert.deepEqual(await res.json(),[{id:1,tail:TAIL}]);
  })(),2000,'Native consumed-body control hung');
  const nativeRows = rows.slice(nativeBegin);
  assert.equal(nativeRows.length,12); assert.ok(nativeRows.every(row => row.ended));
  assert.ok(reused(nativeRows),'The native same-origin control must demonstrate reuse');
  report.push({lane:'native-fetch',scenario:'healthy-control',...snapshot(nativeRows)});
  for (const lane of ['db', 'auth', 'upstash'] as const) {
    mode = 'ok'; const begin = rows.length;
    for (let i = 0; i < 12; i++) { phase = i === 0 ? 'initial' : i < 4 ? 'warm' : 'repeat'; await bounded(call(lane), 2000, 'Healthy fixture operation hung'); }
    const selected = rows.slice(begin);
    assert.equal(selected.length, 12, `${lane}: exactly one transport per uncached operation`);
    assert.ok(selected.every(row => row.lane === lane && row.ended), `${lane}: full SDK response bodies finish`);
    assert.ok(reused(selected), `${lane}: consumed native responses reuse sockets`);
    const warm = new Set(selected.slice(0, 4).map(row => row.socket));
    assert.ok(selected.slice(4).some(row => warm.has(row.socket)), `${lane}: repeat operations reuse an earlier socket`);
    report.push({ lane, scenario: 'healthy', ...snapshot(selected) });

    mode = 'error'; phase = 'http-error'; const errors = rows.length;
    for (let i = 0; i < 8; i++) await bounded(call(lane, true), 2000, 'HTTP error body was not consumed');
    const failed = rows.slice(errors);
    assert.equal(failed.length, 8, `${lane}: HTTP refusal does not replay`);
    assert.ok(failed.every(row => row.ended)); assert.ok(reused(failed), `${lane}: HTTP error bodies permit reuse`);
    report.push({ lane, scenario: 'http-error', ...snapshot(failed) });


  }

  // An explicit PostgREST signal must cancel transport after response headers.
  mode = 'hang'; phase = 'db-abort'; let begin = rows.length;
  const controller = new AbortController();
  const query = Promise.resolve(client.from('connection_fixture').select('id,tail').abortSignal(controller.signal));
  await bounded(until(() => rows.length > begin), 1000, 'Abort fixture was not reached');
  controller.abort();
  const aborted = await bounded(query, 1000, 'Explicit SDK abort did not settle');
  assert.equal(aborted.status, 0); assert.ok(aborted.error);
  await bounded(until(() => rows[begin].closed && closedSockets.has(rows[begin].socket)), 1000, 'Explicit abort left the fixture transport open');
  assert.equal(rows.length - begin, 1); assert.equal(rows[begin].ended, false);
  report.push({ lane: 'db', scenario: 'abort', ...snapshot(rows.slice(begin)) });
  mode = 'ok'; phase = 'db-recovery'; begin = rows.length;
  await bounded(call('db'), 2000, 'DB did not recover after abort');
  report.push({lane:'db',scenario:'recovery',...snapshot(rows.slice(begin))});

  // Exercise existing production deadlines and no-retry semantics unmodified.
  for (const lane of ['auth', 'upstash'] as const) {
    mode = 'hang'; phase = `${lane}-deadline`; begin = rows.length;
    const pending = lane === 'auth' ? requireAuth(request()) : claimOnce(`f7_connection:${++sequence}`, 60);
    await assert.rejects(bounded<unknown>(pending, lane === 'auth' ? 4000 : 1500, 'Existing SDK deadline did not settle'), error => lane === 'auth' ? (error as { code?: string; status?: number }).code === 'auth_unavailable' && (error as { status?: number }).status === 503 : (error as { code?: string }).code === 'claim_unavailable');
    await bounded(until(() => rows[begin]?.closed === true && closedSockets.has(rows[begin].socket)), 1000, 'Deadline left a fixture transport open');
    assert.equal(rows.length - begin, 1, `${lane}: no replay after timeout`); assert.equal(rows[begin].ended, false);
    report.push({ lane, scenario: 'deadline', ...snapshot(rows.slice(begin)) });
    mode = 'ok'; phase = `${lane}-recovery`; begin = rows.length;
    await bounded(call(lane), 2000, `${lane} did not recover`);
    report.push({lane,scenario:'recovery',...snapshot(rows.slice(begin))});
  }
  // Destructive close controls run last: never contaminate healthy pool observations.
  for (const lane of ['db', 'auth', 'upstash'] as const) {
    mode = 'close'; phase = 'connection-close-control'; const closing = rows.length;
    for (let i = 0; i < 4; i++) await bounded(call(lane), 2000, 'Close control operation hung');
    const control = rows.slice(closing);
    assert.equal(control.length, 4); assert.equal(new Set(control.map(row => row.socket)).size, 4);
    assert.equal(reused(control), false, 'The reuse assertion rejects a deliberately closing server');
    report.push({ lane, scenario: 'close-control', ...snapshot(control) });
  }
  assert.deepEqual(denied, []);
  console.log(JSON.stringify({ fixture: 'local-upstream-connections', status: 'pass', report }));
} catch (error) {
  // Preserve sanitized wire evidence even when the first assertion fails.
  console.log(JSON.stringify({fixture:'local-upstream-connections',status:'fail',rows,denied}));
  throw error;
} finally {
  fixture.closeAllConnections();
  await new Promise<void>(resolve => fixture.close(() => resolve()));
  globalThis.fetch = nativeFetch; Socket.prototype.connect = nativeConnect;
  for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  changes.removeAllListeners();
}
