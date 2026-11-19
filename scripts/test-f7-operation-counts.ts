// Representative SDK transport counts against invented fetch fixtures (#636).
// Reuse loadFresh/compiler; do not import the executable stand-in suites as helpers.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bundleColdEntry } from './cold-start-bundle.mjs';
import { loadFresh } from './cold-start-contracts';

const USER = '11111111-1111-4111-8111-111111111111';
const SUPABASE = 'https://operation-counts-supabase.test';
const UPSTASH = 'https://operation-counts-upstash.test';
const ENV = { SUPABASE_URL: SUPABASE, SUPABASE_ANON_KEY: 'invented-counts-anon', SUPABASE_SERVICE_ROLE_KEY: 'invented-counts-service', UPSTASH_REDIS_REST_URL: UPSTASH, UPSTASH_REDIS_REST_TOKEN: 'invented-counts-upstash', UPSTASH_DISABLE_TELEMETRY: '1', SESSION_SECRET: 'invented-counts-secret-used-only-in-fixtures' };
const manifest = [
  { id: 'settings', entry: 'api/settings.ts', query: {} },
  { id: 'map', entry: 'api/quiz/roadmap.ts', query: {} },
  { id: 'catalogue', entry: 'api/quiz/roadmap.ts', query: { resource: 'learning-path-catalog' } },
  { id: 'brief', entry: 'api/quiz/roadmap.ts', query: { resource: 'coding-brief', id: 'js-double-numbers' } },
  { id: 'lesson', entry: 'api/quiz/roadmap.ts', query: { resource: 'lesson', id: 'dsa-v1-d01-l1' } },
  { id: 'leaderboard', entry: 'api/leaderboard.ts', query: { period: 'global' } },
  { id: 'progress', entry: 'api/quiz/roadmap.ts', query: { resource: 'progress' }, auth: true },
  { id: 'placement-start', entry: 'api/quiz/roadmap.ts', query: { resource: 'placement', subject: 'webdev' } },
  { id: 'placement-round', entry: 'api/quiz/roadmap.ts', query: { resource: 'placement' }, method: 'POST' },
  { id: 'answer', entry: 'api/quiz/roadmap.ts', query: { resource: 'answer' }, method: 'POST', auth: true },
] as const;

// Wire shapes below derive from test-prelude/test-learn-round-trips and
// test-verified-caller's upstashAnswer. No production auth/claim core is copied.
const beforeImport = String.raw`
  const events = [], unexpected = [], claims = new Set(), pending = new Set();
  let tick = 0, addressRefused = false;
  const epoch = performance.now();
  const sleep = () => new Promise(resolve => setTimeout(resolve, 40));
  const roles = ['read_address', 'read_user', 'quiz_session_address', 'quiz_session', 'roadmap_answer_address', 'roadmap_answer'];
  const roleOf = key => roles.find(role => String(key).includes(':' + role + ':')) || 'other-fixed-bucket';
  const answerCommand = command => {
    const name = String(command[0]).toUpperCase();
    if (name === 'EVAL' || name === 'EVALSHA') {
      const role = roleOf(command[3]);
      const limit = Number(command[3 + Number(command[2])]);
      return addressRefused && role.endsWith('_address') ? [-1, limit] : [Math.max(1, limit - 1), limit];
    }
    if (name === 'SET' && command.slice(3).some(arg => String(arg).toUpperCase() === 'NX')) {
      const key = String(command[1]); if (claims.has(key)) return null; claims.add(key); return 'OK';
    }
    if (name === 'PING') return 'PONG';
    unexpected.push('unapproved-upstash-command'); throw new Error('Unapproved fixture command');
  };
  globalThis.fetch = async (input, init) => {
    if (events.length >= 64) { unexpected.push('transport-cap'); throw new Error('Fixture transport cap exceeded'); }
    const request = new Request(input, init), url = new URL(request.url);
    const start = performance.now() - epoch, startOrder = ++tick;
    let kind, label, commands = [], result, status = 200;
    if (url.origin === 'https://operation-counts-upstash.test' && request.method === 'POST' && ['/', '/pipeline'].includes(url.pathname)) {
      kind = 'upstash'; label = url.pathname === '/pipeline' ? 'pipeline' : 'single';
      const wire = JSON.parse(await request.text()), list = label === 'pipeline' ? wire : [wire];
      if (!Array.isArray(list) || !list.every(Array.isArray)) throw new Error('Malformed fixture commands');
      commands = list.map(command => ({ name: String(command[0]).toUpperCase(), role: ['EVAL','EVALSHA'].includes(String(command[0]).toUpperCase()) ? roleOf(command[3]) : String(command[0]).toUpperCase() === 'SET' ? 'placement-claim' : 'health' }));
      const values = list.map(command => ({ result: answerCommand(command) }));
      result = label === 'pipeline' ? values : values[0];
    } else if (url.origin === 'https://operation-counts-supabase.test' && url.pathname === '/auth/v1/user' && request.method === 'GET') {
      kind = 'auth'; label = 'verify-user';
      if (request.headers.get('authorization') === 'Bearer invented-invalid-counts-token') { status = 401; result = { message: 'Invalid invented fixture token' }; }
      else result = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: null, app_metadata: {}, user_metadata: {} };
    } else if (url.origin === 'https://operation-counts-supabase.test' && request.method === 'GET' && ['/rest/v1/app_settings','/rest/v1/question_edits','/rest/v1/roadmap_progress'].includes(url.pathname)) {
      kind = 'rest'; label = url.pathname.split('/').pop();
      const single = String(request.headers.get('accept')).includes('vnd.pgrst.object');
      result = single ? null : [];
      if (single) { status = 406; result = { code: 'PGRST116', message: 'No fixture row' }; }
    } else if (url.origin === 'https://operation-counts-supabase.test' && request.method === 'POST' && url.pathname === '/rest/v1/rpc/subject_leaderboard') {
      kind = 'rest'; label = 'rpc:subject_leaderboard';
      result = [{ user_id: '11111111-1111-4111-8111-111111111111', name: 'Fixture shark', rank: 1, correct: 8, answered: 10, accuracy_pct: 80, xp: 100, photo_url: null }];
    } else if (url.origin === 'https://operation-counts-supabase.test' && request.method === 'POST' && url.pathname === '/rest/v1/rpc/record_roadmap_answer_v2') {
      kind = 'rest'; label = 'rpc:record_roadmap_answer_v2';
      const args = await request.json();
      if (args.p_user_id !== '11111111-1111-4111-8111-111111111111') throw new Error('Fixture grade owner mismatch');
      result = { selectedIndex: args.p_selected_index, correctAnswer: args.p_correct_index, isCorrect: args.p_selected_index === args.p_correct_index };
    } else { unexpected.push('undeclared-transport'); throw new Error('Operation ledger forbids undeclared transport'); }
    const event = { kind, label, method: request.method, commands, start, startOrder, end: null, endOrder: null, status };
    events.push(event);
    const waiting = sleep(); pending.add(waiting);
    try { await waiting; } finally { pending.delete(waiting); }
    event.end = performance.now() - epoch; event.endOrder = ++tick;
    return Response.json(result, { status });
  };
  require('node:net').Socket.prototype.connect = () => { unexpected.push('socket'); throw new Error('Live sockets forbidden'); };
  const summarize = selected => {
    const ordered = [...selected].sort((a,b) => a.startOrder - b.startOrder), depths = [];
    for (let index = 0; index < ordered.length; index++) {
      const prior = ordered.slice(0,index).map((event,i) => event.endOrder < ordered[index].startOrder ? depths[i] : 0);
      depths.push(1 + Math.max(0, ...prior));
    }
    return { authHttp: selected.filter(event => event.kind === 'auth').length, restHttp: selected.filter(event => event.kind === 'rest').length,
      upstashHttp: selected.filter(event => event.kind === 'upstash').length, upstashVisibleCommands: selected.reduce((n,event) => n + event.commands.length,0),
      observedTransportWaves: Math.max(0,...depths), events: ordered.map((event,index) => ({ ...event, observedWave: depths[index] })) };
  };
`;

async function collect(item: (typeof manifest)[number], tokenArtifact: string, pairedCold = false): Promise<any> {
  const value = await loadFresh(item.entry, `(async () => {
    const item = ${JSON.stringify(item)}, tokens = require(${JSON.stringify(tokenArtifact)});
    const bearer = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: '${USER}', exp: Math.floor(Date.now()/1000) + 3600 })).toString('base64url') + '.invented-fixture-signature';
    let address = 0, cursor, firstRoundToken, answerSession;
    const rows = [], setup = [];
    const response = () => ({ statusCode: 200, headersSent: false, headers: {}, body: undefined,
      setHeader(name,value) { this.headers[name.toLowerCase()] = String(value); return this; }, getHeader(name) { return this.headers[name.toLowerCase()]; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; this.headersSent = true; return this; },
      send(value) { this.body = value; this.headersSent = true; return this; }, end() { this.headersSent = true; } });
    const call = async (method, query, body, authorization, headers = {}) => {
      const res = response();
      await mod.default({ method, query, body, url: '/api/operation-counts', socket: { remoteAddress: '127.0.0.1' },
        headers: { 'x-forwarded-for': '198.51.100.' + (++address), ...(authorization ? { authorization: 'Bearer ' + authorization } : {}), ...headers } }, res);
      return res;
    };
    const capture = async (state, run, into = rows) => {
      const from = events.length; const res = await run();
      // A first refused address may have an already-started Auth check. Retain it.
      while (pending.size) await Promise.all([...pending]);
      // No response payload, URL/query/header/identifier values enter a report.
      const cache = res.headers['cache-control'];
      const cacheClass = cache === 'private, no-store' ? 'private-no-store' : typeof cache === 'string' && cache.startsWith('public,') ? 'public' : 'unknown';
      into.push({ state, status: res.statusCode, cacheClass, ...summarize(events.slice(from)) }); return res;
    };
    if (events.length || unexpected.length) throw new Error('Unexpected import-time fixture traffic');
    const fake = (startOrder,endOrder,commands=[]) => ({kind:'upstash',commands,startOrder,endOrder});
    if (summarize([]).observedTransportWaves !== 0 || summarize([fake(1,3),fake(2,4)]).observedTransportWaves !== 1 || summarize([fake(1,2),fake(3,4)]).observedTransportWaves !== 2 || summarize([fake(1,2,[{name:'SET'},{name:'PING'}])]).upstashVisibleCommands !== 2) throw new Error('Counter/wave self-test failed');
    let originDenied = false, socketDenied = false;
    try { await fetch('https://unapproved-operation-fixture.invalid'); } catch { originDenied = unexpected.pop() === 'undeclared-transport'; }
    const socket = new (require('node:net').Socket)();
    try { socket.connect(443,'unapproved-operation-fixture.invalid'); } catch { socketDenied = unexpected.pop() === 'socket'; } finally { socket.destroy(); }
    if (!originDenied || !socketDenied || events.length || unexpected.length) throw new Error('Fixture transport denial self-test failed');
    const safety = { originDenied, socketDenied, classifierCases:4 };
    if (item.id === 'placement-round') {
      const first = await capture('required-start-setup', () => call('GET',{ resource:'placement', subject:'webdev' }), setup);
      if (first.statusCode !== 200 || !first.body.placementToken) throw new Error('Required placement setup failed');
      cursor = first.body.placementToken; firstRoundToken = cursor;
    }
    if (item.id === 'answer') answerSession = tokens.encodeSession([{questionId:'invented-counts-question',correctAnswer:1}],
      { scope:'roadmap',subject:'webdev',topic:'html',roadmapKind:'level',ref:1,attemptId:'invented-counts-attempt',userId:'${USER}' });
    const run = headers => {
      let body;
      if (item.id === 'placement-round') body = { placementToken: cursor, answers: {} };
      if (item.id === 'answer') body = { sessionId: answerSession, questionId:'invented-counts-question', selectedIndex:1 };
      return call(item.method || 'GET',item.query,body,item.auth ? bearer : undefined,headers);
    };
    if (${pairedCold} && item.id === 'settings') {
      await capture('two-concurrent-cold-callers', async () => {
        const [a,b] = await Promise.all([run(),run()]);
        if (a.statusCode !== 200 || b.statusCode !== 200 || JSON.stringify(a.body) !== JSON.stringify(b.body)) throw new Error('Coalesced settings caller failed');
        return a;
      });
      return { id:item.id, representative:true, fixtureTransport:'invented-fetch-no-sockets', setup, rows, unexpected, safety };
    }
    const first = await capture(item.id === 'placement-round' ? 'questions-warm-by-required-setup' : 'first-in-fresh-handler-child', () => run());
    if (item.id === 'placement-round' && first.statusCode === 200) cursor = first.body.placementToken;
    const repeated = await capture(item.id === 'progress' ? 'accepted-token-and-settings-warm' : 'immediate-repeat-existing-caches', () => run());
    if (first.headers.etag) await capture('conditional-content-revalidation', () => run({ 'if-none-match':first.headers.etag }));
    if (!['settings','catalogue'].includes(item.id)) {
      addressRefused = true;
      await capture('address-rate-refusal-first',()=>run({'x-forwarded-for':'198.51.100.240'}));
      await capture('address-rate-refusal-repeat-same-address',()=>run({'x-forwarded-for':'198.51.100.240'}));
      addressRefused = false;
    }
    if (item.id === 'placement-round') await capture('replayed-first-round-refusal', () => call('POST',item.query,{placementToken:firstRoundToken,answers:{}}));
    else if (item.id === 'answer') {
      const foreign = tokens.encodeSession([{questionId:'invented-counts-question',correctAnswer:1}],{scope:'roadmap',subject:'webdev',topic:'html',roadmapKind:'level',ref:1,attemptId:'invented-counts-foreign',userId:'22222222-2222-4222-8222-222222222222'});
      await capture('foreign-owner-refusal',()=>call('POST',item.query,{sessionId:foreign,questionId:'invented-counts-question',selectedIndex:1},bearer));
    } else if (item.id === 'progress') await capture('invalid-token-refusal',()=>call('GET',item.query,undefined,'invented-invalid-counts-token'));
    else if (item.id === 'placement-start') await capture('invalid-subject-refusal',()=>call('GET',{resource:'placement',subject:'constructor'}));
    else if (item.id === 'leaderboard') await capture('invalid-period-refusal',()=>call('GET',{period:'invented-invalid-period'}));
    else await capture('wrong-method-refusal',()=>call(item.id === 'lesson' ? 'DELETE' : 'POST',item.query));
    return { id:item.id, representative:true, fixtureTransport:'invented-fetch-no-sockets', setup, rows, unexpected, safety };
  })()`, ENV, [], beforeImport);
  return value.probe;
}

const ownedParent = join(process.cwd(),'node_modules/.cache/shark');
mkdirSync(ownedParent,{recursive:true});
const owned = mkdtempSync(join(ownedParent,'operation-counts-'));
function assertSafeReport(value: unknown): void {
  const serialized = JSON.stringify(value);
  const privateEnv = Object.entries(ENV).filter(([key]) => key !== 'UPSTASH_DISABLE_TELEMETRY').map(([,value]) => value);
  for (const privateValue of [USER, '22222222-2222-4222-8222-222222222222', ...privateEnv, 'Bearer ', 'eyJhbGci']) {
    assert.equal(serialized.includes(privateValue),false,'The operation artifact contains no fixture identity, credential, origin or sealed token');
  }
  const privateKeys = new Set(['headers','body','args','authorization','token','placementToken','sessionId','userId']);
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    for (const [key,child] of Object.entries(item)) {
      assert.equal(privateKeys.has(key),false,'The operation artifact contains no raw request/response payload field');
      pending.push(child);
    }
  }
}
try {
  assertSafeReport({status:200,authHttp:1,cacheClass:'private-no-store'});
  assert.throws(()=>assertSafeReport({headers:{authorization:'fixture'}}),/operation artifact/);
  assert.throws(()=>assertSafeReport({data:USER}),/operation artifact/);
  const tokenArtifact = join(owned,'tokens.cjs');
  await bundleColdEntry('lib/quiz-tokens.ts',tokenArtifact);
  const result = [];
  for (const item of manifest) {
    const operation = await collect(item,tokenArtifact);
    assertSafeReport(operation);
    // Emit each sanitized observation before assertions, preserving a failed case.
    console.log(JSON.stringify({kind:'representative-operation-observation',operation}));
    assert.deepEqual(operation.unexpected,[]);
    assert.deepEqual(operation.safety,{originDenied:true,socketDenied:true,classifierCases:4});
    assert.equal(operation.rows[0].status,200, item.id + ' first operation must actually succeed');
    assert.equal(operation.rows[1].status,200, item.id + ' repeat must actually succeed');
    for (const row of operation.rows) {
      assert.ok(row.events.every((event:any) => Number.isFinite(event.end) && Number.isInteger(event.endOrder)), 'No unfinished transport is silently dropped');
      assert.equal(row.authHttp + row.restHttp + row.upstashHttp,row.events.length);
      if (row.state === 'conditional-content-revalidation') assert.equal(row.status,304);
      if (row.state.startsWith('address-rate-refusal')) { assert.equal(row.status,429); assert.equal(row.restHttp,0); assert.ok(row.events.every((event:any) => event.commands.every((command:any) => command.role.endsWith('_address'))), 'A refused address spends no caller/claim command'); }
      if (row.state === 'address-rate-refusal-repeat-same-address') assert.equal(row.authHttp,0, 'A refused address does not start a second Auth check');
    }
    if (['catalogue','brief','lesson'].includes(item.id)) assert.ok(operation.rows.every((row:any) => row.authHttp === 0 && row.restHttp === 0));
    if (item.id === 'catalogue') assert.ok(operation.rows.every((row:any) => row.upstashHttp === 0));
    if (item.id === 'progress') { assert.equal(operation.rows[0].authHttp,1); assert.equal(operation.rows[1].authHttp,0); assert.ok(operation.rows.every((row:any) => row.cacheClass === 'private-no-store')); }
    const refusal = operation.rows.at(-1);
    if (item.id === 'answer') { assert.equal(refusal.status,409); assert.equal(refusal.restHttp,0); }
    if (item.id === 'placement-round') assert.equal(refusal.status,409);
    if (item.id === 'progress') { assert.equal(refusal.status,401); assert.equal(refusal.restHttp,0); }
    if (['placement-start','leaderboard'].includes(item.id)) { assert.equal(refusal.status,400); assert.equal(refusal.restHttp,0); }
    if (!['answer','placement-round','progress','placement-start','leaderboard'].includes(item.id)) assert.equal(refusal.status,405);
    result.push(operation);
  }
  const coalesced = await collect(manifest[0],tokenArtifact,true);
  assertSafeReport(coalesced);
  console.log(JSON.stringify({kind:'representative-operation-control',control:coalesced}));
  assert.equal(coalesced.rows.length,1); assert.equal(coalesced.rows[0].restHttp,1); assert.equal(coalesced.rows[0].authHttp,0); assert.equal(coalesced.rows[0].upstashHttp,0);
  console.log(JSON.stringify({ kind:'representative-operation-ledger', measuredProduction:false, operations:result, controls:[coalesced] }));
} finally { rmSync(owned,{recursive:true,force:true}); }
