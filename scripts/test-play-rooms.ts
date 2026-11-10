/* Live rooms (Play): the timing, host and switch rules of api/play/[action].ts.
 *
 * Runs the real handler through supabase-js against a local stand-in that
 * answers the PostgREST requests it makes, over in-memory `matches`,
 * `match_participants`, `match_answers` and `app_settings` tables and the two
 * routines of migration 005, plus Supabase Auth's /user for sign-in. The rules:
 *
 * - an answer after the question's clock (and the expiry grace) is refused;
 * - a classroom host presents: no answers, no scoreboard row;
 * - a multiplayer host (a competitor) cannot read the live answer distribution;
 * - a lobby whose host stopped sending heartbeats is closed;
 * - a player reads only the questions already shown, and the server's clock;
 * - a classroom scoreboard counts only closed questions, "Reveal answer"
 *   closes the question, and a pupil's answer is acknowledged, never graded
 *   back (migration 056); a multiplayer one counts every answer;
 * - the Play switch in the app settings turns every action off;
 * - a room names each player itself: the Google name, else the sharkname,
 *   else "Player" and a number, never the part of the address before the @
 *   an older client sent for an account without a Google name.
 *
 * Nothing leaves the machine. */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, unknown>;

// The host signs in with Google; one and two made their accounts with an
// email and a password, so they have no name, and only one has a sharkname.
const googleIdentity = (fullName: string) => ({ provider: 'google', identity_data: { full_name: fullName, email: 'grace@example.com' } });
const emailIdentity = (email: string) => ({ provider: 'email', identity_data: { email, email_verified: true } });
const USERS = {
  host: { id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e01', token: 'play-contract-host', email: 'grace@example.com', identities: [googleIdentity('Grace Hopper')] },
  one: { id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e02', token: 'play-contract-one', email: 'ada.lovelace@example.com', identities: [emailIdentity('ada.lovelace@example.com')] },
  two: { id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e03', token: 'play-contract-two', email: 'alan.turing@example.com', identities: [emailIdentity('alan.turing@example.com')] },
  // Host the rooms of the later checks: one account may open five rooms a minute.
  three: { id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e04', token: 'play-contract-three', email: 'edsger.dijkstra@example.com', identities: [emailIdentity('edsger.dijkstra@example.com')] },
  four: { id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e05', token: 'play-contract-four', email: 'barbara.liskov@example.com', identities: [emailIdentity('barbara.liskov@example.com')] },
} as const;
type Who = keyof typeof USERS;

const tables: Record<string, Row[]> = {
  matches: [], match_participants: [], match_answers: [], app_settings: [],
  // Migration 055's sharknames: only `one` has one.
  user_handles: [{ user_id: '5d0c6a52-3f7e-4b8e-9c1a-0a1b2c3d4e02', handle: 'el-tiburon-loco' }],
};
const UNIQUE: Record<string, string[][]> = {
  matches: [['id'], ['code']],
  match_participants: [['match_id', 'user_id']],
  match_answers: [['match_id', 'user_id', 'question_idx']],
  app_settings: [['key']],
  user_handles: [['user_id']],
};
let clock = 0;
let beforeMatchPatch: (() => void) | undefined;
/** Errors the database answers once each: the next request with this method
 * and path gets the status and body instead of its rows. A 500, because
 * supabase-js retries a read that met a 503. */
const faults: Array<{ method: string; path: string; status: number; body: Row; delayMs?: number }> = [];
const DB_DOWN = { code: 'XX000', details: null, hint: null, message: 'the database could not answer' };
/** The arguments of every match_scoreboard call, in order. */
const scoreboardCalls: Row[] = [];

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = '';
  req.on('data', (chunk) => { text += chunk; });
  req.on('end', () => resolve(text));
});

/** The PostgREST filters the handler uses: eq, in and is. */
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [column, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(column)) continue;
    const value = String(row[column] ?? 'null');
    if (raw.startsWith('eq.')) {
      if (value !== raw.slice(3)) return false;
    } else if (raw.startsWith('in.(')) {
      const list = raw.slice(4, -1).split(',').map((one) => one.replace(/^"|"$/g, ''));
      if (!list.includes(value)) return false;
    } else if (raw.startsWith('is.')) {
      if (value !== raw.slice(3)) return false;
    } else {
      throw new Error(`stand-in: unsupported filter ${column}=${raw}`);
    }
  }
  return true;
}

function project(row: Row, select: string | null): Row {
  if (!select || select === '*') return { ...row };
  return Object.fromEntries(select.split(',').map((column) => [column, row[column] ?? null]));
}

function reply(req: IncomingMessage, res: ServerResponse, rows: Row[], params: URLSearchParams, status = 200) {
  const prefer = String(req.headers.prefer ?? '');
  const shaped = rows.map((row) => project(row, params.get('select')));
  if (/count=exact/.test(prefer)) res.setHeader('content-range', `${shaped.length ? `0-${shaped.length - 1}` : '*'}/${shaped.length}`);
  if (String(req.headers.accept ?? '').includes('vnd.pgrst.object+json')) {
    if (shaped.length !== 1) {
      res.statusCode = 406;
      res.end(JSON.stringify({ code: 'PGRST116', details: `The result contains ${shaped.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' }));
      return;
    }
    res.statusCode = status;
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(shaped[0]));
    return;
  }
  res.statusCode = status;
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(shaped));
}

/** match_scoreboard of migration 056: with p_before_idx it counts only the
 * answers to earlier questions. */
function scoreboard(matchId: string, beforeIdx: number | null = null): Row[] {
  return tables.match_participants
    .filter((p) => p.match_id === matchId)
    .map((p) => {
      const answers = tables.match_answers.filter((a) => a.match_id === matchId && a.user_id === p.user_id &&
        (beforeIdx === null || Number(a.question_idx) < beforeIdx));
      return {
        user_id: p.user_id,
        display_name: p.display_name,
        correct: answers.filter((a) => a.is_correct).length,
        score: answers.reduce((sum, a) => sum + (a.is_correct ? 100 + Number(a.speed_bonus) : 0), 0),
        total_ms: answers.reduce((sum, a) => sum + Number(a.duration_ms), 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.total_ms - b.total_ms);
}

function distribution(matchId: string, questionIdx: number): Row[] {
  const byOption = new Map<number, { selected_idx: number; count: number; correct: boolean }>();
  for (const answer of tables.match_answers.filter((a) => a.match_id === matchId && a.question_idx === questionIdx)) {
    const bucket = byOption.get(Number(answer.selected_idx)) ?? { selected_idx: Number(answer.selected_idx), count: 0, correct: true };
    bucket.count += 1;
    bucket.correct = bucket.correct && answer.is_correct === true;
    byOption.set(bucket.selected_idx, bucket);
  }
  return [...byOption.values()].sort((a, b) => a.selected_idx - b.selected_idx);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://stand-in');
  res.setHeader('content-type', 'application/json');

  if (url.pathname === '/auth/v1/user') {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = Object.values(USERS).find((one) => one.token === token);
    if (!user) {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: 'invalid token' }));
      return;
    }
    res.end(JSON.stringify({ id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, app_metadata: {}, user_metadata: {}, identities: user.identities }));
    return;
  }

  const fault = faults.findIndex((one) => one.method === req.method && one.path === url.pathname);
  if (fault >= 0) {
    const [one] = faults.splice(fault, 1);
    setTimeout(() => {
      res.statusCode = one.status;
      res.end(JSON.stringify(one.body));
    }, one.delayMs ?? 0);
    return;
  }

  const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
  if (rpc) {
    const args = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
    if (rpc[1] === 'match_scoreboard') {
      scoreboardCalls.push(args);
      const before = typeof args.p_before_idx === 'number' ? args.p_before_idx : null;
      return void res.end(JSON.stringify(scoreboard(String(args.p_match_id), before)));
    }
    if (rpc[1] === 'match_question_distribution') {
      return void res.end(JSON.stringify(distribution(String(args.p_match_id), Number(args.p_question_idx))));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: `Could not find the function public.${rpc[1]} in the schema cache` }));
    return;
  }

  const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
  if (!table) {
    res.statusCode = 404;
    res.end(JSON.stringify({ message: 'no route' }));
    return;
  }
  // Tables this contract does not model (the question bank's edits): empty.
  if (!(table in tables)) {
    if (req.method === 'GET' || req.method === 'HEAD') return reply(req, res, [], url.searchParams);
    res.statusCode = 201;
    res.end();
    return;
  }

  const rows = tables[table];
  const prefer = String(req.headers.prefer ?? '');
  const representation = /return=representation/.test(prefer);
  if (req.method === 'GET' || req.method === 'HEAD') {
    let found = rows.filter((row) => matches(row, url.searchParams));
    const order = url.searchParams.get('order');
    if (order) {
      const [column, direction] = order.split('.');
      found = [...found].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (direction === 'desc' ? -1 : 1));
    }
    return reply(req, res, found, url.searchParams);
  }
  if (req.method === 'POST') {
    const payload = JSON.parse(await readBody(req)) as Row | Row[];
    const written: Row[] = [];
    for (const input of Array.isArray(payload) ? payload : [payload]) {
      const row: Row = { ...input };
      clock += 1;
      if (table === 'matches') row.id ??= randomUUID();
      if (table === 'match_participants') row.joined_at ??= new Date(Date.now() + clock).toISOString();
      if (table === 'match_answers') row.answered_at ??= new Date().toISOString();
      const upsert = /resolution=merge-duplicates/.test(prefer);
      const keys = UNIQUE[table];
      const clash = rows.find((other) => keys.some((key) => key.every((column) => other[column] === row[column])));
      if (clash && !upsert) {
        res.statusCode = 409;
        res.end(JSON.stringify({ code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint' }));
        return;
      }
      if (clash) Object.assign(clash, input);
      else rows.push(row);
      written.push(clash ?? row);
    }
    if (!representation) {
      res.statusCode = 201;
      res.end();
      return;
    }
    return reply(req, res, written, url.searchParams, 201);
  }
  if (req.method === 'PATCH') {
    const patch = JSON.parse(await readBody(req)) as Row;
    if (table === 'matches' && beforeMatchPatch) {
      const interleave = beforeMatchPatch;
      beforeMatchPatch = undefined;
      interleave();
    }
    const hit = rows.filter((row) => matches(row, url.searchParams));
    hit.forEach((row) => Object.assign(row, patch));
    if (!representation) {
      res.statusCode = 204;
      res.end();
      return;
    }
    return reply(req, res, hit, url.searchParams);
  }
  if (req.method === 'DELETE') {
    tables[table] = rows.filter((row) => !matches(row, url.searchParams));
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 405;
  res.end(JSON.stringify({ message: 'method' }));
}

async function startStandIn() {
  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'stand-in failure' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  // lib/http.ts, lib/auth.ts and lib/play-helpers.ts read these when they
  // load, so they are set before anything from the repository is imported.
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-play-contract';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-play-contract';
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'NODE_ENV', 'VERCEL_ENV', 'VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
  }
  return server;
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    setHeader(key: string, value: string) { res.headers[key.toLowerCase()] = value; return res; },
    getHeader(key: string) { return res.headers[key.toLowerCase()]; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
    end() { return res; },
  };
  return res;
}

async function main() {
  const server = await startStandIn();
  try {
    const [{ default: play }, settings] = await Promise.all([
      import('../api/play/[action]'),
      import('../lib/settings-store'),
    ]);
    let address = 0;
    const call = async (who: Who | null, method: 'GET' | 'POST', action: string, input: Row = {}) => {
      const res = mockResponse();
      address += 1;
      await play({
        method,
        headers: { 'x-forwarded-for': `10.30.0.${address % 250}`, ...(who ? { authorization: `Bearer ${USERS[who].token}` } : {}) },
        query: { action, ...(method === 'GET' ? input : {}) },
        body: method === 'POST' ? input : undefined,
        url: `/api/play/${action}`,
      } as never, res as never);
      return res;
    };
    const room = (code: string) => tables.matches.find((match) => match.code === code)!;
    const correctIndex = (code: string, idx: number) => (room(code).questions as Array<{ correct_index: number }>)[idx].correct_index;
    const open = async (mode: 'multiplayer' | 'classroom', players: Who[], host: Who = 'host') => {
      const created = await call(host, 'POST', 'create', { host_name: 'Host', mode, count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, `a ${mode} room opens (${JSON.stringify(created.body)})`);
      const code = created.body.code as string;
      for (const who of players) {
        const joined = await call(who, 'POST', 'join', { code, display_name: who });
        assert.equal(joined.statusCode, 200, `${who} joins the ${mode} room`);
      }
      assert.equal((await call(host, 'POST', 'control', { code, action: 'start' })).statusCode, 200, `the ${mode} room starts`);
      return code;
    };
    const rewind = (code: string, ms: number) => {
      room(code).question_started_at = new Date(Date.now() - ms).toISOString();
    };

    // 1. A multiplayer host competes, so the live answer distribution (counts
    //    per option and which one is correct) is closed to them until the end.
    {
      const code = await open('multiplayer', ['one', 'two']);
      const answered = await call('one', 'POST', 'answer', { code, question_idx: 0, selected_idx: (correctIndex(code, 0) + 1) % 4 });
      assert.equal(answered.statusCode, 200);
      const peek = await call('host', 'GET', 'distribution', { code, q: '0' });
      assert.equal(peek.statusCode, 403, 'a competing host cannot read the live distribution');
      assert.equal(peek.body?.buckets, undefined, 'and gets no buckets');

      // 2. An answer after the clock and the grace is refused, and scores
      //    nothing; an answer on the buzzer, inside the grace, still counts.
      rewind(code, 30_000 + 1_000);
      const buzzer = await call('two', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(buzzer.statusCode, 200, 'an answer inside the grace lands');
      assert.equal(buzzer.body.is_correct, true);
      assert.equal(buzzer.body.advanced, false, 'the host has not answered yet');
      rewind(code, 50_000);
      const late = await call('host', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(late.statusCode, 409, `an answer 20 s after a 30 s question closed is refused (${JSON.stringify(late.body)})`);
      assert.equal(late.body.error.code, 'time_up');
      assert.equal(tables.match_answers.filter((a) => a.user_id === USERS.host.id).length, 0, 'the late answer is not recorded');
      // A retry of an answer that landed in time replays it rather than
      // turning it into a late one.
      const retry = await call('two', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(retry.statusCode, 200, 'a retry of an in-time answer replays it');
      assert.equal(retry.body.is_correct, true);

      // The expired question moves on at the next read, and the distribution
      // opens once the match is over. Every client reads once when the clock
      // runs out, so the reads land together: each one gets the next
      // question, not only the read that moved the room on.
      const reads = await Promise.all((['one', 'two', 'host'] as const).map((who) => call(who, 'GET', 'state', { code })));
      assert.deepEqual(reads.map((read) => read.body.match.current_index), [1, 1, 1], 'every read at the expiry sees the next question');
      assert.equal(room(code).current_index, 1, 'the room moved on once');
      assert.equal((await call('host', 'POST', 'control', { code, action: 'finish' })).statusCode, 200);
      const after = await call('host', 'GET', 'distribution', { code, q: '0' });
      assert.equal(after.statusCode, 200, 'the host reads the distribution after the end');
      assert.equal(after.body.buckets.length, 2);
    }

    // 3. A classroom host presents: they read the live distribution, cannot
    //    answer, and have no scoreboard row; a student's late answer is refused.
    {
      const code = await open('classroom', ['one']);
      const hostAnswer = await call('host', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(hostAnswer.statusCode, 403, 'the classroom host cannot answer');
      assert.equal(hostAnswer.body.error.code, 'host_cannot_answer');
      assert.equal((await call('host', 'GET', 'distribution', { code, q: '0' })).statusCode, 200, 'the presenter reads the live distribution');
      rewind(code, 10 * 60_000);
      const late = await call('one', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(late.statusCode, 409, 'a student answering ten minutes into a 30 s question is refused');
      assert.equal(late.body.error.code, 'time_up');
      assert.equal((await call('host', 'POST', 'control', { code, action: 'finish' })).statusCode, 200);
      const board = (await call('one', 'GET', 'state', { code })).body.scoreboard as Array<{ user_id: string; score: number }>;
      assert.deepEqual(board.map((row) => row.user_id), [USERS.one.id], 'only the student is on the classroom scoreboard');
      assert.equal(board[0].score, 0, 'nobody scored');
    }

    // A multiplayer host competes, so they keep their row.
    {
      const code = await open('multiplayer', ['one']);
      const board = (await call('one', 'GET', 'state', { code })).body.scoreboard as Array<{ user_id: string }>;
      assert.ok(board.some((row) => row.user_id === USERS.host.id), 'a multiplayer host is on the scoreboard');
    }

    // 4. A lobby whose host stopped sending heartbeats is closed at the next
    //    read, like a running room; one whose host is present stays open.
    {
      const created = await call('host', 'POST', 'create', { host_name: 'Host', mode: 'multiplayer', count: 5, categories: ['javascript'], duration_s: 30 });
      const code = created.body.code as string;
      await call('one', 'POST', 'join', { code, display_name: 'one' });
      assert.equal((await call('one', 'GET', 'state', { code })).body.match.status, 'lobby', 'a lobby with its host stays open');
      // A multiplayer host competes: in the lobby they read no more than anyone.
      const hostLobby = (await call('host', 'GET', 'state', { code })).body.match;
      assert.deepEqual(hostLobby.questions, [], 'a competing host reads no question in the lobby');
      assert.equal(hostLobby.question_count, 5);
      const staleHeartbeat = new Date(Date.now() - 6 * 60_000).toISOString();
      room(code).last_heartbeat_at = staleHeartbeat;
      beforeMatchPatch = () => { room(code).last_heartbeat_at = new Date().toISOString(); };
      const revived = await call('one', 'GET', 'state', { code });
      assert.equal(revived.body.match.status, 'lobby', 'a heartbeat received before the finish update keeps the lobby open');
      assert.equal(room(code).status, 'lobby', 'the room itself stays open');
      room(code).last_heartbeat_at = staleHeartbeat;
      const state = await call('one', 'GET', 'state', { code });
      assert.equal(state.body.match.status, 'finished', 'a lobby the host left is closed');
      assert.equal(state.body.match.started_at ?? null, null, 'and reads as never started');
    }

    // 6. A player reads only the questions already shown: none in the lobby,
    //    up to the current one while the room runs, and never the key. The
    //    round's length travels as `question_count`, and every join and state
    //    carries the server's clock. `two` hosts this room: the host above has
    //    opened as many rooms as one account may in a minute.
    {
      const created = await call('two', 'POST', 'create', { host_name: 'Two', mode: 'classroom', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, `a classroom room opens (${JSON.stringify(created.body)})`);
      const code = created.body.code as string;
      const nearNow = (value: unknown, what: string) => {
        assert.equal(typeof value, 'string', `${what} carries server_now`);
        assert.ok(Math.abs(Date.parse(value as string) - Date.now()) < 5_000, `${what}: server_now is the server's clock`);
      };
      const joined = await call('one', 'POST', 'join', { code, display_name: 'one' });
      assert.deepEqual(joined.body.questions, [], 'a player joining the lobby receives no question');
      assert.equal(joined.body.question_count, 5, 'the join says how long the round is');
      nearNow(joined.body.server_now, 'the join');
      for (const who of ['one', null] as const) {
        const lobby = await call(who, 'GET', 'state', { code });
        assert.deepEqual(lobby.body.match.questions, [], `${who ?? 'an anonymous reader'} reads no question in the lobby`);
        assert.equal(lobby.body.match.question_count, 5);
        nearNow(lobby.body.server_now, 'the state');
      }
      const presenter = await call('two', 'GET', 'state', { code });
      assert.equal(presenter.body.match.questions.length, 5, 'the classroom presenter holds the whole round');
      assert.equal(typeof presenter.body.match.questions[0].correct_index, 'number', 'with its key');

      assert.equal((await call('two', 'POST', 'control', { code, action: 'start' })).statusCode, 200);
      const shown = (await call('one', 'GET', 'state', { code })).body.match;
      assert.equal(shown.questions.length, 1, 'the first question is the only one a running room shows');
      assert.equal(shown.questions[0].id, (room(code).questions as Array<{ id: string }>)[0].id);
      assert.equal(shown.questions[0].correct_index, undefined, 'without its key');
      assert.equal(shown.questions[0].explanation, undefined, 'or its explanation');
      assert.equal(shown.question_count, 5);
      assert.equal((await call(null, 'GET', 'state', { code })).body.match.questions.length, 1, 'an anonymous reader gets no more');
      assert.equal((await call('two', 'POST', 'control', { code, action: 'advance' })).statusCode, 200);
      assert.equal((await call('one', 'GET', 'state', { code })).body.match.questions.length, 2, 'the next question opens with the room');

      assert.equal((await call('two', 'POST', 'control', { code, action: 'finish' })).statusCode, 200);
      const finished = (await call('one', 'GET', 'state', { code })).body.match;
      assert.equal(finished.questions.length, 5, 'a finished round shows every question');
      assert.equal(typeof finished.questions[4].correct_index, 'number', 'with its key');
    }

    // 7. While a classroom room runs, its scoreboard counts only closed
    //    questions: the ones before the current one, and the current one once
    //    the teacher revealed it or its clock ran out (056). "Reveal answer"
    //    closes the question: a later answer to it is refused. `one` presents
    //    this room; `two` and `host` are the class.
    {
      const created = await call('one', 'POST', 'create', { host_name: 'One', mode: 'classroom', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, `a classroom room opens (${JSON.stringify(created.body)})`);
      const code = created.body.code as string;
      for (const who of ['two', 'host'] as const) {
        assert.equal((await call(who, 'POST', 'join', { code, display_name: who })).statusCode, 200, `${who} joins the class`);
      }
      assert.equal((await call('one', 'POST', 'control', { code, action: 'start' })).statusCode, 200);
      const scoreOf = async (reader: Who, who: Who) => {
        const state = await call(reader, 'GET', 'state', { code });
        assert.equal(state.statusCode, 200);
        return (state.body.scoreboard as Array<{ user_id: string; score: number }>).find((row) => row.user_id === USERS[who].id)!.score;
      };

      // The answer is acknowledged, not graded: nothing in the reply says
      // whether it scored, while the question is open or after.
      const ACK = { ok: true, accepted: true, advanced: false };
      const first = await call('two', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.body, ACK, 'a classroom answer is only acknowledged');
      assert.equal(await scoreOf('host', 'two'), 0, 'a pupil sees no points for the open question');
      assert.equal(await scoreOf('one', 'two'), 0, 'nor does the projected presenter screen');
      assert.equal(scoreboardCalls.at(-1)?.p_before_idx, 0, 'the scoreboard is asked for the questions before the open one');

      // Only the presenter reveals, and only in a classroom.
      const pupilReveal = await call('two', 'POST', 'control', { code, action: 'reveal' });
      assert.equal(pupilReveal.statusCode, 403, 'a pupil cannot reveal');
      assert.equal(room(code).revealed_idx ?? null, null);
      const reveal = await call('one', 'POST', 'control', { code, action: 'reveal' });
      assert.equal(reveal.statusCode, 200, `the presenter reveals (${JSON.stringify(reveal.body)})`);
      assert.deepEqual(reveal.body, { ok: true, status: 'running', current_index: 0, revealed_idx: 0 });
      assert.equal(room(code).revealed_idx, 0, 'the room records the closed question');
      assert.equal((await call('one', 'POST', 'control', { code, action: 'reveal' })).statusCode, 200, 'revealing again changes nothing');

      const closed = await call('host', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(closed.statusCode, 409, `an answer after the reveal is refused (${JSON.stringify(closed.body)})`);
      assert.equal(closed.body.error.code, 'question_closed');
      assert.equal(tables.match_answers.filter((a) => a.user_id === USERS.host.id).length, 0, 'and not recorded');
      const retry = await call('two', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(retry.statusCode, 200, 'a retry of an answer sent before the reveal replays it');
      assert.deepEqual(retry.body, ACK, 'with the same acknowledgement');
      // The pupil learns the result from the scoreboard once the question closed.
      const counted = await scoreOf('two', 'two');
      assert.ok(counted >= 100, `the closed question counts at once: ${counted}`);
      assert.equal(await scoreOf('one', 'two'), counted, 'on the presenter screen too');
      const joined = await call('host', 'POST', 'join', { code, display_name: 'host' });
      assert.equal(joined.body.revealed_idx, 0, 'a pupil joining again learns the question is closed');

      // The next question is open: its answer adds nothing until it closes,
      // here by its clock (30 s and the 2 s grace, on the server's clock).
      assert.equal((await call('one', 'POST', 'control', { code, action: 'advance' })).statusCode, 200);
      const second = await call('two', 'POST', 'answer', { code, question_idx: 1, selected_idx: correctIndex(code, 1) });
      assert.equal(second.statusCode, 200, 'the next question takes answers');
      // A wrong answer gets the very same reply as a right one.
      const wrong = await call('host', 'POST', 'answer', { code, question_idx: 1, selected_idx: (correctIndex(code, 1) + 1) % 4 });
      assert.equal(wrong.statusCode, 200);
      assert.deepEqual([second.body, wrong.body], [ACK, ACK], 'a right and a wrong answer cannot be told apart');
      assert.equal(await scoreOf('host', 'two'), counted, 'the open question adds nothing');
      rewind(code, 31_000);
      assert.equal(await scoreOf('host', 'two'), counted, 'nor inside the grace');
      rewind(code, 33_000);
      assert.ok(await scoreOf('host', 'two') >= counted + 100, 'a question whose clock ran out counts');
      assert.equal(await scoreOf('host', 'host'), 0, 'and the wrong answer scored nothing, which the pupil now sees');

      // Once the round is over, every answer counts and the call is the one
      // it always was.
      assert.equal((await call('one', 'POST', 'control', { code, action: 'finish' })).statusCode, 200);
      assert.ok(await scoreOf('two', 'two') >= counted + 100);
      assert.equal('p_before_idx' in (scoreboardCalls.at(-1) ?? {}), false, 'a finished room counts every answer');
    }

    // A multiplayer room has no reveal, and its scoreboard counts every
    // answer, the open question's included: a player learns that someone
    // scored, never which option. `two` opens it.
    {
      const created = await call('two', 'POST', 'create', { host_name: 'Two', mode: 'multiplayer', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, `a multiplayer room opens (${JSON.stringify(created.body)})`);
      const code = created.body.code as string;
      assert.equal((await call('one', 'POST', 'join', { code, display_name: 'one' })).statusCode, 200);
      assert.equal((await call('two', 'POST', 'control', { code, action: 'start' })).statusCode, 200);
      const reveal = await call('two', 'POST', 'control', { code, action: 'reveal' });
      assert.equal(reveal.statusCode, 400, 'a multiplayer room has no reveal');
      assert.equal(room(code).revealed_idx ?? null, null);
      const graded = await call('one', 'POST', 'answer', { code, question_idx: 0, selected_idx: correctIndex(code, 0) });
      assert.equal(graded.statusCode, 200);
      assert.equal(graded.body.is_correct, true, 'a multiplayer player gets their own result at once, as before');
      assert.equal(typeof graded.body.speed_bonus, 'number');
      const board = (await call('two', 'GET', 'state', { code })).body.scoreboard as Array<{ user_id: string; score: number }>;
      assert.ok(board.find((row) => row.user_id === USERS.one.id)!.score >= 100, 'the open question counts in multiplayer, as before');
      assert.equal('p_before_idx' in (scoreboardCalls.at(-1) ?? {}), false, 'with the call it always made');
    }

    // 8. A code repeated in the query string arrives as an array: the reads
    //    refuse it as a bad request instead of failing with a 500.
    {
      const code = await open('multiplayer', ['one'], 'three');
      const doubled = await call('one', 'GET', 'state', { code: [code, code] });
      assert.equal(doubled.statusCode, 400, `a repeated code is a bad request (${JSON.stringify(doubled.body)})`);
      assert.equal(doubled.body.error.code, 'bad_request');
      const peek = await call('three', 'GET', 'distribution', { code: [code, code], q: '0' });
      assert.equal(peek.statusCode, 400, 'the distribution refuses it too');
      assert.equal((await call('one', 'GET', 'state', { code: 'X'.repeat(17) })).statusCode, 400, 'a code longer than any room code is refused');

      // 9. A room the database could not read is not a room that is gone: a
      //    404 would tell the player to leave a room that is still running.
      for (const [who, method, action, input] of [
        ['one', 'POST', 'answer', { code, question_idx: 0, selected_idx: 0 }],
        ['three', 'GET', 'distribution', { code, q: '0' }],
        ['three', 'POST', 'heartbeat', { code }],
      ] as const) {
        faults.push({ method: 'GET', path: '/rest/v1/matches', status: 500, body: DB_DOWN });
        const failed = await call(who, method, action, input);
        assert.equal(failed.statusCode, 503, `${action} answers 503 when the room cannot be read (${JSON.stringify(failed.body)})`);
        assert.equal(failed.body.error.code, 'backend_unavailable');
      }
      assert.equal(faults.length, 0, 'every injected failure was met');
      assert.equal((await call('three', 'POST', 'heartbeat', { code })).statusCode, 200, 'the room is still there');

      // A read that does not answer within lib/http.ts's five seconds is the
      // database busy: 503 upstream_timeout, as every handler answers it.
      faults.push({ method: 'GET', path: '/rest/v1/matches', status: 200, body: {}, delayMs: 5_500 });
      const slow = await call('one', 'GET', 'state', { code });
      assert.equal(slow.statusCode, 503, `a room read that timed out answers 503 (${JSON.stringify(slow.body)})`);
      assert.equal(slow.body.error.code, 'upstream_timeout');
    }

    // 10. An answer names one of the options the question showed: an index
    //     past them is refused and not recorded, so it never reaches the
    //     scoreboard or the distribution as an option nobody saw.
    {
      const code = await open('multiplayer', ['one'], 'three');
      const options = (room(code).questions as Array<{ options: string[] }>)[0].options.length;
      const past = await call('one', 'POST', 'answer', { code, question_idx: 0, selected_idx: options });
      assert.equal(past.statusCode, 400, `an option index past the question's ${options} is refused (${JSON.stringify(past.body)})`);
      assert.equal(tables.match_answers.filter((a) => a.match_id === room(code).id).length, 0, 'and not recorded');
      assert.equal((await call('one', 'POST', 'answer', { code, question_idx: 0, selected_idx: options - 1 })).statusCode, 200, 'the last option is an answer');
    }

    // 11. A topic list with an entry that is not a topic id is refused as a
    //     whole, rather than opening a room on the part that was strings.
    for (const categories of [['javascript', 7], ['javascript', { id: 'react' }], 'javascript']) {
      const refused = await call('four', 'POST', 'create', { mode: 'multiplayer', count: 5, categories, duration_s: 30 });
      assert.equal(refused.statusCode, 400, `categories ${JSON.stringify(categories)} are refused (${JSON.stringify(refused.body)})`);
    }

    // 12. Two hosts drawing the same room code at once: the unique key refuses
    //     the second insert, and that host gets a room under a new code
    //     instead of a 500.
    {
      faults.push({ method: 'POST', path: '/rest/v1/matches', status: 409, body: { code: '23505', details: 'Key (code)=(TAKEN1) already exists.', hint: null, message: 'duplicate key value violates unique constraint "matches_code_key"' } });
      const created = await call('three', 'POST', 'create', { mode: 'multiplayer', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, `a code clash draws a new code (${JSON.stringify(created.body)})`);
      assert.equal(faults.length, 0, 'the clash happened');
      assert.equal(room(created.body.code).host_id, USERS.three.id, 'the room is stored under the code it answered');
    }

    // 5. The Play switch turns every action off, rooms already open included.
    {
      const code = await open('multiplayer', ['one']);
      await settings.saveGameSettings({ ...settings.DEFAULT_SETTINGS, features: { ...settings.DEFAULT_SETTINGS.features, multiplayer: false } });
      for (const [who, method, action, input] of [
        ['host', 'POST', 'create', { host_name: 'Host', mode: 'multiplayer', count: 5, categories: ['javascript'], duration_s: 30 }],
        ['two', 'POST', 'join', { code, display_name: 'two' }],
        ['one', 'GET', 'state', { code }],
        [null, 'GET', 'state', { code }],
        ['one', 'POST', 'answer', { code, question_idx: 0, selected_idx: 0 }],
        ['host', 'POST', 'control', { code, action: 'finish' }],
        ['host', 'POST', 'heartbeat', { code }],
        ['host', 'GET', 'distribution', { code, q: '0' }],
      ] as const) {
        const res = await call(who, method, action, input);
        assert.equal(res.statusCode, 503, `${action} is off while Play is switched off`);
        assert.equal(res.body.error.code, 'feature_disabled');
      }
      await settings.saveGameSettings(settings.DEFAULT_SETTINGS);
      assert.equal((await call('one', 'GET', 'state', { code })).statusCode, 200, 'switching Play back on reopens the room');
    }

    // 6. A room names its players itself (round 4): the Google name, else the
    //    sharkname, else "Player" and a number. What the body says is ignored:
    //    an older client sent the part of the address before the @.
    {
      const created = await call('one', 'POST', 'create', { host_name: 'ada.lovelace', mode: 'classroom', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(created.statusCode, 200, JSON.stringify(created.body));
      const code = created.body.code as string;
      assert.equal(created.body.host_name, 'el-tiburon-loco', 'a host without a Google name is named by their sharkname, not the body');
      assert.equal((await call('host', 'POST', 'join', { code, display_name: 'grace' })).statusCode, 200);
      // A client that sends no name at all joins too.
      assert.equal((await call('two', 'POST', 'join', { code })).statusCode, 200, 'a join needs no display_name');
      const state = (await call('one', 'GET', 'state', { code })).body as { match: { host_name: string }; participants: { user_id: string; display_name: string }[] };
      const named = Object.fromEntries(state.participants.map((p) => [p.user_id, p.display_name]));
      assert.equal(state.match.host_name, 'el-tiburon-loco');
      assert.equal(named[USERS.one.id], 'el-tiburon-loco', 'an email account is named by its sharkname');
      assert.equal(named[USERS.host.id], 'Grace Hopper', 'a Google account by its Google name');
      assert.match(named[USERS.two.id], /^Player \d{4}$/, 'an email account without a sharkname is "Player" and a number');
      // The same number in every room, as a host too.
      const again = await call('two', 'POST', 'create', { mode: 'multiplayer', count: 5, categories: ['javascript'], duration_s: 30 });
      assert.equal(again.statusCode, 200, JSON.stringify(again.body));
      assert.equal(again.body.host_name, named[USERS.two.id], 'a player keeps their number across rooms');
      // No part of any address reaches a room.
      const stored = JSON.stringify([tables.matches, tables.match_participants]);
      for (const user of Object.values(USERS)) {
        const local = user.email.split('@')[0];
        assert.ok(!stored.includes(local), `${local} is not stored in a room`);
      }
    }
  } finally {
    server.close();
  }
  console.log('Play room contracts passed: late answers, the classroom host, the live distribution, abandoned lobbies, the questions a player reads, the classroom reveal and scoreboard, the Play switch, and room names that never come from an address.');
}

await main();
