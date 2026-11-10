/* Handlers against a real token check.
 *
 * The launch contracts run the handlers through lib/auth.ts's local fallback,
 * where the signed-in account is simply the `user_id` the request names, so
 * they cannot catch a handler that trusts a client-supplied `user_id`. This
 * suite runs the real `api/user/[op].ts`, `api/quiz/roadmap.ts`,
 * `api/leaderboard.ts` and the public handlers against a local stand-in that
 * answers `/auth/v1/user` the way Supabase Auth does (a token names one
 * account, with its email, confirmation and app metadata) and PostgREST's
 * tables and routines with nothing stored. Every read and write the stand-in
 * sees is recorded, so a check can say which account it was for.
 *
 * It holds:
 *  - a token for account A with a body or query `user_id` of B reads and
 *    writes A's rows: the leaderboard switch, a coding op and a garden op;
 *  - the admin allow-list counts a confirmed address only, and the admin
 *    role in app metadata keeps working; the fulfilment op takes the admin
 *    bucket before its gate, GET included;
 *  - an answer about one person is never stored by a shared cache unless its
 *    handler says so, and the public ones still say so;
 *  - the reads a script can drive take a per-account bucket and an address
 *    bucket, and a leaderboard `limit` is rounded to a few fixed sizes;
 *  - with Upstash configured and failing, a one-time claim is refused with
 *    503 instead of falling back to this instance's memory.
 *
 * Upstash is a second stand-in that answers every command with an error, so
 * the rate limits here run on their in-memory fallback. Nothing leaves the
 * machine. */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

interface Account {
  id: string;
  token: string;
  email: string;
  confirmed: boolean;
  appMetadata?: Record<string, unknown>;
  userMetadata?: Record<string, unknown>;
  identities?: Record<string, unknown>[];
}
const A: Account = { id: '1a2b3c4d-0000-4000-8000-00000000000a', token: 'caller-a', email: 'a@example.invalid', confirmed: true };
const B: Account = { id: '1a2b3c4d-0000-4000-8000-00000000000b', token: 'caller-b', email: 'b@example.invalid', confirmed: true };
const ADMIN_EMAIL = 'admin@example.invalid';
// Someone who signed up with the admin's address and never clicked the link.
const LISTED_UNCONFIRMED: Account = { id: '1a2b3c4d-0000-4000-8000-00000000000c', token: 'listed-unconfirmed', email: ADMIN_EMAIL, confirmed: false };
const LISTED_CONFIRMED: Account = { id: '1a2b3c4d-0000-4000-8000-00000000000d', token: 'listed-confirmed', email: ADMIN_EMAIL, confirmed: true };
const ROLE_ADMIN: Account = { id: '1a2b3c4d-0000-4000-8000-00000000000e', token: 'role-admin', email: 'role@example.invalid', confirmed: false, appMetadata: { role: 'admin' } };
// An account made with an email and password (owner decision 3): no Google
// identity, so no name or picture, and `email` as its provider.
const EMAIL: Account = {
  id: '1a2b3c4d-0000-4000-8000-00000000000f',
  token: 'email-password',
  email: 'ada@example.invalid',
  confirmed: true,
  appMetadata: { provider: 'email', providers: ['email'] },
  identities: [{
    identity_id: '1a2b3c4d-0000-4000-8000-0000000000f1',
    id: '1a2b3c4d-0000-4000-8000-00000000000f',
    user_id: '1a2b3c4d-0000-4000-8000-00000000000f',
    provider: 'email',
    identity_data: { email: 'ada@example.invalid', email_verified: true, phone_verified: false, sub: '1a2b3c4d-0000-4000-8000-00000000000f' },
  }],
};
// An account whose own rows the database is too slow to read.
const SLOW: Account = { id: '1a2b3c4d-0000-4000-8000-000000000010', token: 'slow-rows', email: 'slow@example.invalid', confirmed: true };
// An account whose sharkname row the database fails to read.
const HANDLES_DOWN: Account = { id: '1a2b3c4d-0000-4000-8000-000000000011', token: 'handles-down', email: 'handles@example.invalid', confirmed: true };
// An account whose data erasure the database is too slow to run.
const SLOW_ERASURE: Account = { id: '1a2b3c4d-0000-4000-8000-000000000012', token: 'slow-erasure', email: 'erasure@example.invalid', confirmed: true };
/** A token shaped as Supabase issues them: a JWT whose payload names the
 * account (`sub`) and its expiry (`exp`, seconds). Only such a token is
 * accepted again across requests (lib/auth.ts, "Accepted tokens"); the plain
 * tokens above never are, so the checks above count one Auth call each. */
const jwt = (sub: string, lifetimeSeconds: number) => [
  Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + lifetimeSeconds })).toString('base64url'),
  'stand-in-signature',
].join('.');
const jwtAccount = (n: number, lifetimeSeconds = 3600, extra: Partial<Account> = {}): Account => {
  const id = `1a2b3c4d-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
  return { id, token: jwt(id, lifetimeSeconds), email: `jwt-${n}@example.invalid`, confirmed: true, ...extra };
};
const JWT_LEARNER = jwtAccount(1);
const JWT_TOGETHER = jwtAccount(2);
const JWT_SHORT = jwtAccount(3, 30);
const JWT_ADMIN = jwtAccount(4, 3600, { appMetadata: { role: 'admin' } });
const JWT_DELETED = jwtAccount(5);
const JWT_OUTAGE = jwtAccount(6);
const JWT_WRITER = jwtAccount(7);
const JWT_GET_WRITER = jwtAccount(8);
const JWT_ACCOUNTS = [JWT_LEARNER, JWT_TOGETHER, JWT_SHORT, JWT_ADMIN, JWT_DELETED, JWT_OUTAGE, JWT_WRITER, JWT_GET_WRITER];
// An account whose saved learner profile Supabase Auth returns with the
// token check, as it returns every account's user_metadata.
const PROFILED: Account = {
  id: '1a2b3c4d-0000-4000-8000-000000000013',
  token: 'profiled-learner',
  email: 'profiled@example.invalid',
  confirmed: true,
  userMetadata: {
    devquiz_learner_profile_v2: {
      schemaVersion: 2, baseTrack: 'backend', specialization: null, sections: ['software-engineer'],
      goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: '2026-09-01T00:00:00Z',
    },
  },
};
const ACCOUNTS = [A, B, LISTED_UNCONFIRMED, LISTED_CONFIRMED, ROLE_ADMIN, EMAIL, SLOW, HANDLES_DOWN, SLOW_ERASURE, PROFILED, ...JWT_ACCOUNTS];
/** Tokens the stand-in now refuses (a session ended elsewhere), and tokens
 * for which it answers 500, as Supabase Auth does when it is down. */
const revokedTokens = new Set<string>();
const failingTokens = new Set<string>();
// A token presented while Supabase Auth answers 500 (not one of ACCOUNTS).
const AUTH_DOWN: Account = { id: '1a2b3c4d-0000-4000-8000-0000000000aa', token: 'auth-is-down', email: 'down@example.invalid', confirmed: true };
// Tokens presented while Supabase Auth does not answer at all (the connection
// drops), and while it answers 429 to its own rate limit.
const AUTH_UNREACHABLE: Account = { ...AUTH_DOWN, token: 'auth-unreachable' };
const AUTH_THROTTLED: Account = { ...AUTH_DOWN, token: 'auth-throttled' };

type Row = Record<string, unknown>;
interface Seen { method: string; path: string; filters: Record<string, string>; body: unknown }
const seen: Seen[] = [];
/** A Learn question the eligibility gate retires, reported before it was. */
const RETIRED_REPORTED = 'rm-js-21';
/** While true, the one-time quiz claim fails as an unreachable database would. */
let claimFails = false;
let healthReadFails = false;
let healthReadHangs = false;
let closedHealthReads = 0;
const dailyMarkers = new Map<string, { grade_key: string; created_at: string }>();
let dailyMarkerUnavailable = false;
/** Token checks Supabase Auth answered, so a test can count a request's. */
let authChecks = 0;
let authDeleteError: { status: number; code: string } | null = null;
let cardWriteError: { code: string; message: string } | null = null;
/** How a read of the auth event log answers: normally, failing, or as a
 * table the migration has not created yet. */
let authEventsRead: 'ok' | 'down' | 'missing' = 'ok';
const SLOW_REPORT = 'stand-in: answer after the timeout';
// An admin question save with this text answers after the timeout too.
const SLOW_QUESTION = 'stand-in: save after the timeout';
// A topic board asked with this minimum answers after the timeout too.
const SLOW_BOARD_MIN_ATTEMPTS = 97;
const SLOW_PATH_PROGRESS = 'slow-path-progress';
const SLOW_PATH_OPEN = 'slow-path-open-attempt';
const SLOW_PATH_ACCEPT = 'slow-path-accept-result';
let fdeFixtureVersion: number | undefined;
const upstashCommands: string[] = [];
// A Challenge run saved with this score finds the run already on the board
// with another one.
const CONFLICTING_CHALLENGE_SCORE = 2;

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = '';
  req.on('data', (chunk) => { text += chunk; });
  req.on('end', () => resolve(text));
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function startStandIns() {
  const supabase = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stand-in');
    if(url.pathname==='/rest/v1/user_stats'&&req.method==='GET'&&req.headers.apikey==='anon-verified-caller') {
      res.setHeader('content-type','application/json');res.statusCode=403;
      res.end(JSON.stringify({code:'42501',message:'permission denied for table user_stats'}));return;
    }
    res.setHeader('content-type', 'application/json');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (url.pathname === '/auth/v1/user') {
      authChecks += 1;
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      // Supabase Auth itself failing, for any token.
      if (token === AUTH_DOWN.token) return send(500, { message: 'stand-in auth is down' });
      if (token === AUTH_UNREACHABLE.token) { req.socket.destroy(); return; }
      if (token === AUTH_THROTTLED.token) return send(429, { message: 'stand-in: request rate limit reached' });
      if (failingTokens.has(token)) return send(500, { message: 'stand-in auth is down' });
      if (revokedTokens.has(token)) return send(403, { code: 'session_not_found', message: 'Session from session_id claim in JWT does not exist' });
      const account = ACCOUNTS.find((one) => one.token === token);
      if (!account) return send(401, { message: 'invalid token' });
      return send(200, {
        id: account.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: account.email,
        ...(account.confirmed ? { email_confirmed_at: '2026-09-01T00:00:00Z' } : {}),
        app_metadata: account.appMetadata ?? {},
        user_metadata: account.userMetadata ?? {},
        identities: account.identities ?? [],
      });
    }
    // The admin API deleting a sign-in identity (account erasure).
    const adminUser = /^\/auth\/v1\/admin\/users\/([\w-]+)$/.exec(url.pathname);
    if (adminUser && req.method === 'DELETE') {
      seen.push({ method: 'DELETE', path: url.pathname, filters: {}, body: await readBody(req).then((raw) => raw ? JSON.parse(raw) as unknown : undefined) });
      if (authDeleteError) {
        res.setHeader('X-Supabase-Api-Version', '2024-01-01');
        return send(authDeleteError.status, { code: authDeleteError.code, message: 'stand-in: identity deletion' });
      }
      return send(200, {});
    }
    // The admin API saving an account's user_metadata (a learning preference).
    if (adminUser && req.method === 'PUT') {
      const saved = await readBody(req).then((raw) => raw ? JSON.parse(raw) as Row : {});
      seen.push({ method: 'PUT', path: url.pathname, filters: {}, body: saved });
      return send(200, { id: adminUser[1], aud: 'authenticated', user_metadata: saved.user_metadata ?? {} });
    }
    const raw = req.method === 'GET' ? '' : await readBody(req);
    const body = raw ? JSON.parse(raw) as unknown : undefined;
    // A database too slow to answer within lib/http.ts's five seconds.
    if (url.pathname === '/rest/v1/question_reports' && (body as Row | undefined)?.detail === SLOW_REPORT) {
      setTimeout(() => send(201, [body]), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/question_edits' && (body as Row | undefined)?.question === SLOW_QUESTION) {
      setTimeout(() => send(201, [body]), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/allocate_shark_name' && (body as Row | undefined)?.p_user_id === SLOW.id) {
      setTimeout(() => send(200, { handle: 'slowSharkie1', ordinal: '1', base: 'slowSharkie' }), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/delete_user_data' && (body as Row | undefined)?.p_user_id === SLOW_ERASURE.id) {
      setTimeout(() => send(200, null), 8_500);
      return;
    }
    if (req.method === 'GET' && url.searchParams.get('user_id') === `eq.${SLOW.id}`) {
      setTimeout(() => send(200, []), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/learning_path_progress' && url.searchParams.get('enrollment_id') === `eq.${SLOW_PATH_PROGRESS}`) {
      setTimeout(() => send(200, []), 5_500);
      return;
    }
    if ((url.pathname === '/rest/v1/rpc/open_learning_path_attempt' && (body as Row | undefined)?.p_enrollment_id === SLOW_PATH_OPEN)
        || (url.pathname === '/rest/v1/rpc/accept_learning_path_result' && (body as Row | undefined)?.p_attempt_id === SLOW_PATH_ACCEPT)) {
      setTimeout(() => send(200, null), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/rpc/category_leaderboard' && (body as Row | undefined)?.p_min_attempts === SLOW_BOARD_MIN_ATTEMPTS) {
      setTimeout(() => send(200, []), 5_500);
      return;
    }
    if (url.pathname === '/rest/v1/auth_events' && req.method === 'GET' && authEventsRead === 'down') return send(500, { code: '08006', message: 'stand-in: connection failure' });
    if (url.pathname === '/rest/v1/auth_events' && req.method === 'GET' && authEventsRead === 'missing') return send(404, { code: 'PGRST205', message: "Could not find the table 'public.auth_events' in the schema cache" });
    const filters = Object.fromEntries([...url.searchParams.entries()].filter(([, value]) => value.startsWith('eq.')).map(([key, value]) => [key, value.slice(3)]));
    seen.push({ method: req.method ?? 'GET', path: url.pathname, filters, body });
    if (cardWriteError && url.pathname === '/rest/v1/flashcards' && req.method === 'POST') return send(409, cardWriteError);
    if (healthReadFails && url.pathname === '/rest/v1/quiz_submissions' && url.searchParams.get('select') === 'grade_key') return send(500, { code: '42501', message: 'permission denied for table quiz_submissions' });
    if (healthReadHangs && url.pathname === '/rest/v1/quiz_submissions' && url.searchParams.get('select') === 'grade_key') {
      res.once('close', () => { if (!res.writableEnded) closedHealthReads++; });
      return;
    }
    if (url.pathname === '/rest/v1/quiz_submissions' && url.searchParams.get('select') === 'grade_key,created_at') {
      if (dailyMarkerUnavailable) return send(500, { code: '08006', message: 'stand-in: start marker unavailable' });
      const keys = url.searchParams.get('grade_key')?.slice(4, -1).split(',') ?? [];
      return send(200, [...dailyMarkers.values()].filter((row) => keys.includes(row.grade_key)));
    }
    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname)?.[1];
    if (rpc) {
      if (rpc === 'claim_quiz_submission' && claimFails) return send(500, { code: '08006', message: 'stand-in: connection failure' });
      if (rpc === 'claim_quiz_submission' && typeof (body as Row | undefined)?.p_grade_key === 'string' &&
          String((body as Row).p_grade_key).startsWith('daily-start:')) {
        // Another instance won the insert between this request's read and its claim.
        const gradeKey = String((body as Row).p_grade_key);
        dailyMarkers.set(gradeKey, { grade_key: gradeKey, created_at: new Date(Date.now() - 10_000).toISOString() });
        return send(200, 'replay');
      }
      if (rpc === 'allocate_shark_name') return send(200, { handle: 'sleepySharkie17', ordinal: '17', base: 'sleepySharkie' });
      if (rpc === 'referral_summary') return send(200, { code: 'ab234567' });
      if (rpc === 'request_friend' && (body as Row | undefined)?.p_handle === 'locked-friend') {
        return send(500, { code: '55P03', message: 'canceling statement due to lock timeout' });
      }
      // Migration 064 raises for a run already saved with another score.
      if (rpc === 'save_completed_challenge_score' && (body as Row).p_score === CONFLICTING_CHALLENGE_SCORE) return send(400, { code: 'P0001', message: 'challenge_score_conflict' });
      if (rpc === 'save_completed_challenge_score') return send(200, { id: 'score-17', name: 'sleepySharkie17', score: (body as Row).p_score, selected_topics: (body as Row).p_topics, all_topics: (body as Row).p_all_topics, created_at: new Date().toISOString() });
      // The Premium check: account A is Premium, so every coding task opens.
      if (rpc === 'is_premium') return send(200, (body as Row | undefined)?.p_user === A.id);
      if (rpc.endsWith('leaderboard') || rpc === 'friend_lookup') return send(200, []);
      return send(200, null);
    }
    if (url.pathname === '/rest/v1/question_reports' && req.method === 'GET') {
      return send(200, [{ id: 'report-retired', question_id: RETIRED_REPORTED, reason: 'incorrect-answer', detail: null, reporter_sub: null, created_at: '2026-10-01T10:00:00Z' }]);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const single = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
      if (url.pathname === '/rest/v1/learning_path_enrollments' && filters.user_id === A.id
          && [SLOW_PATH_PROGRESS, SLOW_PATH_OPEN, SLOW_PATH_ACCEPT].includes(filters.enrollment_id)) {
        return send(200, {
          enrollment_id: filters.enrollment_id, user_id: A.id, path_id: 'fde',
          status: 'active', curriculum_version: fdeFixtureVersion,
        });
      }
      if (url.pathname === '/rest/v1/user_handles' && req.method === 'GET' && filters.user_id === HANDLES_DOWN.id) return send(500, { code: '08006', message: 'stand-in: connection failure' });
      if (url.pathname === '/rest/v1/user_handles' && req.method === 'GET') return send(200, single ? { leaderboard_name_mode: 'nickname' } : []);
      if (req.method === 'POST' || req.method === 'PATCH') {
        const row = (Array.isArray(body) ? body[0] : body) as Row;
        return send(201, single ? row : [row]);
      }
      return single ? send(406, { code: 'PGRST116', message: 'no rows' }) : send(200, []);
    }
    send(404, { message: 'no route' });
  });
  // Upstash, unreachable in all but name: every command fails.
  const upstash = createServer(async (req, res) => {
    upstashCommands.push(await readBody(req));
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'ERR stand-in is down' }));
  });
  const [supabasePort, upstashPort] = await Promise.all([listen(supabase), listen(upstash)]);
  // lib/http.ts, lib/auth.ts, lib/admin-auth.ts and lib/rate-limit.ts read
  // these when they load, so they are set before anything is imported.
  process.env.SUPABASE_URL = `http://127.0.0.1:${supabasePort}`;
  process.env.SUPABASE_ANON_KEY = 'anon-verified-caller';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-verified-caller';
  process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${upstashPort}`;
  process.env.UPSTASH_REDIS_REST_TOKEN = 'upstash-verified-caller';
  process.env.ADMIN_EMAILS = ADMIN_EMAIL;
  // The garden reads its settings when asked, not on import.
  Object.assign(process.env, {
    GITHUB_APP_ID: '424242',
    GITHUB_APP_SLUG: 'devshark-verified-caller',
    GITHUB_APP_PRIVATE_KEY: 'unused-by-these-checks',
    GITHUB_APP_CLIENT_ID: 'Iv1.verified-caller',
    GITHUB_APP_CLIENT_SECRET: 'verified-caller-secret',
  });
  for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'NODE_ENV', 'VERCEL_ENV', 'VERCEL', 'DEV_PASSWORD', 'ALLOW_LEGACY_DEV_PASSWORD', 'OWNER_EMAIL', 'STRIPE_SECRET_KEY']) {
    delete process.env[key];
  }
  return [supabase, upstash];
}

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    headersSent: false,
    setHeader(key: string, value: string) { res.headers[key.toLowerCase()] = String(value); return res; },
    getHeader(key: string) { return res.headers[key.toLowerCase()]; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; res.headersSent = true; return res; },
    send(body: unknown) { res.body = body; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}
type Response = ReturnType<typeof mockResponse>;

let address = 0;
const nextAddress = () => `10.40.${Math.floor(++address / 250)}.${address % 250}`;

async function main() {
  const servers = await startStandIns();
  try {
    const [
      { default: userOps },
      { default: roadmap },
      { default: leaderboard },
      { default: settings },
      { default: health },
      { default: flashcards },
      tokens,
      rateLimit,
      http,
      { CODING_TASKS },
      { default: challenge },
      { default: submit },
      { default: questions },
      reportsStore,
      questionsStore,
      { default: adminOps },
      { default: daily },
    ] = await Promise.all([
      import('../api/user/[op]'),
      import('../api/quiz/roadmap'),
      import('../api/leaderboard'),
      import('../api/settings'),
      import('../api/health'),
      import('../api/flashcards'),
      import('../lib/quiz-tokens'),
      import('../lib/rate-limit'),
      import('../lib/http'),
      import('../lib/coding/catalog'),
      import('../api/quiz/challenge'),
      import('../api/quiz/submit'),
      import('../api/quiz/questions'),
      import('../lib/reports-store'),
      import('../lib/questions-store'),
      import('../api/admin/[op]'),
      import('../api/quiz/daily'),
    ]);

    type Handler = (req: never, res: never) => unknown;
    const call = async (handler: Handler, input: { method?: string; query?: Record<string, string>; body?: unknown; account?: Account; from?: string; authorization?: string | string[] }) => {
      const res = mockResponse();
      await handler({
        method: input.method ?? 'GET',
        headers: {
          ...(input.account ? { authorization: `Bearer ${input.account.token}` } : {}),
          ...(input.authorization !== undefined ? { authorization: input.authorization } : {}),
          'x-forwarded-for': input.from ?? nextAddress(),
        },
        query: input.query ?? {},
        url: '/api',
        body: input.body,
      } as never, res as never);
      return res;
    };
    const user = (op: string, input: Omit<Parameters<typeof call>[1], 'query'> & { query?: Record<string, string> }) =>
      call(userOps as Handler, { ...input, query: { op, ...(input.query ?? {}) } });
    const reads = (path: string) => seen.filter((one) => one.path === path);
    const errorCode = (res: Response) => (res.body as { error?: { code?: string } } | undefined)?.error?.code;

    // These GETs can write account rows, so a warm token must still be
    // refused before the write when Supabase has ended the session.
    const writer = JWT_GET_WRITER;
    const writeOnRead = [
      ['badges', () => user('badges', { account: writer, query: { subject: 'webdev' } }), '/rest/v1/rpc/sync_user_badges'],
      ['freezes', () => user('freezes', { account: writer }), '/rest/v1/rpc/refresh_streak_freezes'],
      ['friends-handle', () => user('friends-handle', { account: writer }), '/rest/v1/rpc/allocate_shark_name'],
      ['leaderboard-name', () => user('leaderboard-name', { account: writer }), '/rest/v1/rpc/allocate_shark_name'],
      ['referral', () => user('referral', { account: writer }), '/rest/v1/rpc/referral_summary'],
      ['daily', () => call(daily as Handler, { account: writer }), '/rest/v1/rpc/claim_quiz_submission'],
      ['Learn coding level', () => call(roadmap as Handler, { account: writer, query: { topic: 'dsa', level: '1' } }), '/rest/v1/roadmap_attempts'],
    ] as const;
    for (const [label, read, writePath] of writeOnRead) {
      assert.equal((await user('identity', { account: writer })).statusCode, 200);
      revokedTokens.add(writer.token);
      try {
        seen.length = 0;
        authChecks = 0;
        const refused = await read();
        assert.equal(refused.statusCode, 401, `${label} refuses a revoked token even after a successful read`);
        assert.equal(errorCode(refused), 'invalid_token');
        assert.equal(authChecks, 1, `${label} checks Auth once`);
        assert.ok(!reads(writePath).some((row) => row.method === 'POST'), `${label} writes nothing after refusal`);
      } finally {
        revokedTokens.delete(writer.token);
      }
      assert.equal((await user('identity', { account: writer })).statusCode, 200);
      seen.length = 0;
      authChecks = 0;
      const accepted = await read();
      assert.equal(accepted.statusCode, 200, `${label} works for an active session (${JSON.stringify(accepted.body)})`);
      assert.equal(authChecks, 1, `${label} checks even an active cached token`);
      assert.ok(reads(writePath).some((row) => row.method === 'POST'), `${label} can write for an active account`);
    }
    seen.length = 0;
    authChecks = 0;
    const guestDaily = await call(daily as Handler, {});
    assert.equal(guestDaily.statusCode, 200, 'a guest may still start the daily challenge');
    assert.equal(authChecks, 0, 'a guest does not ask Supabase Auth');
    assert.equal(reads('/rest/v1/rpc/claim_quiz_submission').length, 0, 'a guest daily writes no start marker');
    const guestLevel = await call(roadmap as Handler, { query: { topic: 'dsa', level: '1' } });
    assert.equal(guestLevel.statusCode, 200, 'a guest may still start a free coding level');
    assert.equal(authChecks, 0, 'opening a guest level does not ask Supabase Auth');
    assert.equal((reads('/rest/v1/roadmap_attempts').find((row) => row.method === 'POST')?.body as Row)?.user_id, null);
    console.log('PASS verified caller: GETs that write account rows ask Auth fresh, and guest starts still work');

    seen.length = 0;
    const startedDaily = await call(daily as Handler, { account: A });
    assert.equal(startedDaily.statusCode, 200, JSON.stringify(startedDaily.body));
    const dailySession = tokens.decodeSessionEnvelope((startedDaily.body as { sessionId: string }).sessionId);
    const claim = reads('/rest/v1/rpc/claim_quiz_submission').find((row) => row.method === 'POST');
    const dailyMarker = dailyMarkers.get(String((claim?.body as Row | undefined)?.p_grade_key));
    assert.ok(dailyMarker);
    assert.equal(dailySession?.startedAt, Date.parse(dailyMarker.created_at), 'a concurrent daily start uses the winning database marker');
    dailyMarkerUnavailable = true;
    try {
      const unknownStart = await call(daily as Handler, { account: A });
      assert.equal(unknownStart.statusCode, 503, JSON.stringify(unknownStart.body));
      assert.equal(errorCode(unknownStart), 'daily_start_unavailable');
      assert.equal(await call(daily as Handler, {}).then((response) => response.statusCode), 200, 'guests do not depend on the ranked start marker');
    } finally {
      dailyMarkerUnavailable = false;
    }
    console.log('PASS verified caller: a ranked daily uses the stored start even when another request won the insert');

    const guestToken = (guestDaily.body as { sessionId: string }).sessionId;
    const guestQuiz = tokens.decodeSessionEnvelope(guestToken)!;
    const guestAnswers = Object.fromEntries(guestQuiz.questions.map(({ questionId, correctAnswer }) => [questionId, correctAnswer]));
    const authBeforeMalformed = authChecks;
    seen.length = 0;
    for (const authorization of ['', 'Bearer', 'Bearer wrong token', 'Basic invalid', ['Bearer first', 'Bearer second']]) {
      const start = await call(daily as Handler, { authorization });
      assert.equal(start.statusCode, 401, `daily start refuses malformed credentials: ${JSON.stringify(authorization)}`);
      const grade = await call(submit as Handler, { method: 'POST', body: { sessionId: guestToken, answers: guestAnswers }, authorization });
      assert.equal(grade.statusCode, 401, 'quiz grading must not silently submit malformed credentials as a guest');
    }
    assert.equal(authChecks, authBeforeMalformed, 'locally malformed credentials need no upstream Auth request');
    assert.equal(reads('/rest/v1/rpc/claim_quiz_submission').length, 0, 'malformed credentials must not spend a grading claim');
    console.log('PASS verified caller: optional Auth distinguishes a guest from malformed credentials');

    const cardBody = { subject: 'webdev', question_id: guestQuiz.questions[0].questionId, question: 'Synthetic question', correct_answer: 'Synthetic answer' };
    try {
      cardWriteError = { code: '23503', message: 'flashcard_account_missing' };
      const erasedCard = await call(flashcards as Handler, { method: 'POST', account: A, body: cardBody });
      assert.equal(erasedCard.statusCode, 401, 'a card write rejected by the deleted-account guard requires sign-in');
      assert.equal(errorCode(erasedCard), 'invalid_token');
      cardWriteError = { code: '55P03', message: 'canceling statement due to lock timeout' };
      const busyCard = await call(flashcards as Handler, { method: 'POST', account: A, body: cardBody });
      assert.equal(busyCard.statusCode, 503, 'a card that waits behind erasure may be retried');
      assert.equal(errorCode(busyCard), 'flashcard_busy');
    } finally {
      cardWriteError = null;
    }
    console.log('PASS verified caller: a card write distinguishes erasure from a busy owner lock');

    const busyFriend = await user('friends-request', { method: 'POST', account: A, body: { handle: 'locked-friend' } });
    assert.equal(busyFriend.statusCode, 503, JSON.stringify(busyFriend.body));
    assert.equal(errorCode(busyFriend), 'friendship_busy');
    console.log('PASS verified caller: a friendship lock timeout is retryable');

    const publicChallenge = await call(challenge as Handler, { query: { resource: 'leaderboard' } });
    assert.equal(publicChallenge.statusCode, 200, JSON.stringify(publicChallenge.body));
    assert.match(publicChallenge.headers['cache-control'] ?? '', /^public,/);
    const exhaustedBoardAddress = nextAddress();
    const boardClock = Date.now;
    const frozenBoardTime = boardClock();
    Date.now = () => frozenBoardTime;
    try {
      const boardRequest = { headers: { 'x-forwarded-for': exhaustedBoardAddress } } as never;
      for (let i = 0; i < rateLimit.RATE_LIMITS.readAddress.capacity; i++) {
        assert.ok(rateLimit.checkRateLimit(boardRequest, mockResponse() as never, rateLimit.RATE_LIMITS.readAddress));
      }
      const before = reads('/rest/v1/rpc/challenge_leaderboard').length;
      const busyBoard = await call(challenge as Handler, { from: exhaustedBoardAddress, query: { resource: 'leaderboard', nonce: 'cache-miss' } });
      assert.equal(busyBoard.statusCode, 429, 'a Challenge board cache miss respects the public board address limit');
      assert.equal(reads('/rest/v1/rpc/challenge_leaderboard').length, before, 'a rejected cache miss does no database work');
    } finally {
      Date.now = boardClock;
    }
    console.log('PASS verified caller: Challenge leaderboard cache misses are rate-limited before SQL');

    // Leaderboard identity is independent of friends and cannot publish a full email.
    seen.length = 0;
    const preference = await user('leaderboard-name', { method: 'PUT', account: EMAIL, body: { mode: 'account', accountName: 'spoof@example.com', user_id: B.id } });
    assert.equal(preference.statusCode, 200, JSON.stringify(preference.body));
    assert.deepEqual(preference.body, { mode: 'account', nickname: 'sleepySharkie17', accountName: 'ada', showPhoto: false, picture: null });
    const preferenceWrite = reads('/rest/v1/user_handles').find(row => row.method === 'PATCH');
    assert.equal(preferenceWrite?.filters.user_id, EMAIL.id);
    assert.deepEqual(preferenceWrite?.body, { leaderboard_name_mode: 'account', leaderboard_account_name: 'ada' });
    assert.ok(!seen.some(row => row.path === '/rest/v1/rpc/set_friend_display'));
    const unavailable = await user('leaderboard-name', { method: 'PUT', account: LISTED_UNCONFIRMED, body: { mode: 'account' } });
    assert.equal(unavailable.statusCode, 409);
    assert.equal(errorCode(unavailable), 'account_name_unavailable');
    // A photo switch whose name row cannot be read changes nothing: a write
    // beside a failed read answered 503, and the Profile put the old switch
    // back while the photo was already on the boards.
    seen.length = 0;
    const photoBlind = await user('leaderboard-name', { method: 'PUT', account: HANDLES_DOWN, body: { showPhoto: true } });
    assert.equal(photoBlind.statusCode, 503, JSON.stringify(photoBlind.body));
    assert.equal(errorCode(photoBlind), 'leaderboard_name_unavailable');
    assert.ok(!reads('/rest/v1/user_stats').some((one) => one.method === 'POST'), 'no photo switch is written when the setting cannot be read');
    console.log('PASS verified caller: leaderboard names use the verified profile or confirmed email prefix, independently of friends');

    // A signed-in Challenge batch verifies its token once, for the rate limit
    // and the run alike.
    authChecks = 0;
    const signedInBatch = await call(challenge as Handler, { account: A, query: { categories: 'javascript' } });
    assert.equal(signedInBatch.statusCode, 200, JSON.stringify(signedInBatch.body));
    assert.equal(tokens.decodeChallengeRun((signedInBatch.body as { runToken: string }).runToken)?.userId, A.id, 'the run is the token\'s account\'s');
    assert.equal(authChecks, 1, 'a Challenge batch asks Supabase Auth once');

    // Completion writes positive scores automatically; zero allocates nothing.
    const completedRun = tokens.createChallengeRun(true, 'webdev', { topics: ['javascript'], allTopics: false, userId: null });
    const strikes = ['a','b','c'].map(id => tokens.encodeScoreProof(completedRun.runId, id, 'webdev', false));
    seen.length = 0;
    const zero = await call(challenge as Handler, { method: 'POST', query: { resource: 'complete' }, body: { runToken: completedRun.runToken, proofs: strikes } });
    assert.equal(zero.statusCode, 200);
    assert.equal(reads('/rest/v1/rpc/save_completed_challenge_score').length, 0);
    assert.equal(reads('/rest/v1/rpc/allocate_shark_name').length, 0);
    const positive = await call(challenge as Handler, { method: 'POST', query: { resource: 'complete' }, body: { runToken: completedRun.runToken, proofs: [...strikes, tokens.encodeScoreProof(completedRun.runId, 'right', 'webdev', true)], name: 'spoofed' } });
    assert.equal(positive.statusCode, 200, JSON.stringify(positive.body));
    const scoreWrite = reads('/rest/v1/rpc/save_completed_challenge_score')[0].body as Row;
    assert.equal(scoreWrite.p_score, 1);
    assert.equal(scoreWrite.p_user_id, null);
    assert.deepEqual(scoreWrite.p_topics, ['javascript']);
    assert.equal(scoreWrite.p_all_topics, false);
    assert.equal(scoreWrite.name, undefined);
    const foreignRun = await call(challenge as Handler, { method: 'POST', account: B, query: { resource: 'complete' }, body: { runToken: completedRun.runToken, proofs: [...strikes, tokens.encodeScoreProof(completedRun.runId, 'right', 'webdev', true)] } });
    assert.equal(foreignRun.statusCode, 400);
    assert.equal(reads('/rest/v1/rpc/save_completed_challenge_score').length, 1);
    const conflicting = await call(challenge as Handler, { method: 'POST', query: { resource: 'complete' }, body: { runToken: completedRun.runToken, proofs: [...strikes, ...['right', 'also-right'].map((id) => tokens.encodeScoreProof(completedRun.runId, id, 'webdev', true))] } });
    assert.equal(conflicting.statusCode, 409, `a run already saved with another score is a conflict, not an outage (${JSON.stringify(conflicting.body)})`);
    assert.equal(errorCode(conflicting), 'run_already_saved');
    console.log('PASS verified caller: completed positive Challenge runs save automatically; zero and foreign sessions write nothing; a conflicting save answers 409');

    // ── a token for A with a user_id of B acts for A ──────────────────────
    seen.length = 0;
    const visibleGet = await user('leaderboard-visibility', { account: A, query: { user_id: B.id } });
    assert.equal(visibleGet.statusCode, 200, JSON.stringify(visibleGet.body));
    assert.deepEqual(reads('/rest/v1/user_stats').map((one) => one.filters.user_id), [A.id], 'the switch is read for the token\'s account');
    seen.length = 0;
    const visiblePut = await user('leaderboard-visibility', { method: 'PUT', account: A, query: { user_id: B.id }, body: { visible: true, user_id: B.id } });
    assert.equal(visiblePut.statusCode, 200, JSON.stringify(visiblePut.body));
    const upsert = reads('/rest/v1/user_stats').find((one) => one.method === 'POST');
    assert.equal((upsert?.body as Row | undefined)?.user_id, A.id, 'the switch is written for the token\'s account');
    assert.equal((upsert?.body as Row | undefined)?.email, A.email, 'with the token\'s email');
    console.log('PASS verified caller: leaderboard visibility reads and writes the token\'s account');

    // What friends see (op=identity, migration 055) is the token's account's too.
    seen.length = 0;
    const identityGet = await user('identity', { account: A, query: { user_id: B.id } });
    assert.equal(identityGet.statusCode, 200, JSON.stringify(identityGet.body));
    assert.deepEqual(reads('/rest/v1/user_handles').map((one) => one.filters.user_id), [A.id], 'what friends see is read for the token\'s account');
    seen.length = 0;
    const identityPut = await user('identity', { method: 'PUT', account: A, query: { user_id: B.id }, body: { showRealName: false, user_id: B.id } });
    assert.equal(identityPut.statusCode, 200, JSON.stringify(identityPut.body));
    assert.deepEqual(reads('/rest/v1/rpc/set_friend_display').map((one) => (one.body as Row).p_user_id), [A.id], 'and written for it');
    console.log('PASS verified caller: what friends see reads and writes the token\'s account');

    const codingTask = CODING_TASKS.find((task) => task.track === 'javascript')!;
    seen.length = 0;
    const draft = await user('coding-draft', { method: 'POST', account: A, query: { user_id: B.id }, body: { id: codingTask.id, code: 'const mine = 1;', user_id: B.id } });
    assert.equal(draft.statusCode, 200, JSON.stringify(draft.body));
    assert.deepEqual(reads('/rest/v1/rpc/save_coding_draft_v2').map((one) => (one.body as Row).p_user_id), [A.id], 'a draft is saved for the token\'s account');
    seen.length = 0;
    const progress = await user('coding-progress', { account: A, query: { user_id: B.id } });
    assert.equal(progress.statusCode, 200, JSON.stringify(progress.body));
    const progressReads = seen.filter((one) => one.method === 'GET' && 'user_id' in one.filters);
    assert.ok(progressReads.length > 0 && progressReads.every((one) => one.filters.user_id === A.id), `coding progress is read for the token's account (${JSON.stringify(progressReads.map((one) => one.filters))})`);
    console.log('PASS verified caller: a coding op reads and writes the token\'s account');

    // The caller's part of a task page (#587 C23) is read for the token's
    // account, as the combined task read is; the brief reads no row at all.
    seen.length = 0;
    const taskState = await call(roadmap as Handler, { account: A, query: { resource: 'coding-state', id: codingTask.id, user_id: B.id } });
    assert.equal(taskState.statusCode, 200, JSON.stringify(taskState.body));
    const stateReads = seen.filter((one) => one.method === 'GET' && 'user_id' in one.filters);
    assert.ok(stateReads.some((one) => one.path === '/rest/v1/coding_drafts'), 'the state read reads the draft');
    assert.ok(stateReads.length > 0 && stateReads.every((one) => one.filters.user_id === A.id), `the task state is read for the token's account (${JSON.stringify(stateReads.map((one) => [one.path, one.filters]))})`);
    seen.length = 0;
    const authBefore = authChecks;
    const brief = await call(roadmap as Handler, { account: A, query: { resource: 'coding-brief', id: codingTask.id, user_id: B.id } });
    assert.equal(brief.statusCode, 200, JSON.stringify(brief.body));
    assert.deepEqual(seen.map((one) => one.path), [], 'the brief reads no row');
    assert.equal(authChecks, authBefore, 'and asks Supabase Auth nothing, whatever token it carries');
    console.log('PASS verified caller: a task page\'s state is the token\'s account\'s, and its brief reads nobody');

    const connect = await user('github-connect-start', { method: 'POST', account: A, query: { user_id: B.id }, body: { user_id: B.id } });
    assert.equal(connect.statusCode, 200, JSON.stringify(connect.body));
    const state = new URL((connect.body as { url: string }).url).searchParams.get('state')!;
    assert.equal(tokens.decodeGithubConnectState(state)?.userId, A.id, 'a garden connect is started for the token\'s account');
    seen.length = 0;
    const connection = await user('github-connection', { account: A, query: { user_id: B.id } });
    assert.equal(connection.statusCode, 200, JSON.stringify(connection.body));
    assert.deepEqual(reads('/rest/v1/github_connections').map((one) => one.filters.user_id), [A.id], 'the garden connection is read for the token\'s account');
    console.log('PASS verified caller: a garden op acts for the token\'s account');

    // ── the admin gate: a confirmed address, or the role ─────────────────
    const fulfilment = (account?: Account, from?: string) => user('fulfilment', { account, from });
    const unconfirmed = await fulfilment(LISTED_UNCONFIRMED);
    assert.equal(unconfirmed.statusCode, 403, `an allow-listed address nobody confirmed is not an admin (${JSON.stringify(unconfirmed.body)})`);
    const confirmed = await fulfilment(LISTED_CONFIRMED);
    assert.equal(confirmed.statusCode, 200, `a confirmed allow-listed address is an admin (${JSON.stringify(confirmed.body)})`);
    const role = await fulfilment(ROLE_ADMIN);
    assert.equal(role.statusCode, 200, `the admin role works without a confirmed address (${JSON.stringify(role.body)})`);
    console.log('PASS verified caller: the admin allow-list counts a confirmed address, the role still works');
    // Supabase Auth that is down refused nobody: the admin hears that, not 403.
    const gateDown = await fulfilment(AUTH_DOWN);
    assert.equal(gateDown.statusCode, 503, `an Auth outage at the admin gate is not "not an admin" (${JSON.stringify(gateDown.body)})`);
    assert.equal(errorCode(gateDown), 'auth_unavailable');
    // A fulfilment write verifies its token for the write limit and the gate
    // once: an unknown item is refused after the gate.
    authChecks = 0;
    const stockWrite = await user('fulfilment', { method: 'POST', account: ROLE_ADMIN, body: { op: 'stock', sku: 'not-an-item' } });
    assert.equal(stockWrite.statusCode, 400, `the admin passed the gate (${JSON.stringify(stockWrite.body)})`);
    assert.equal(authChecks, 1, 'an admin write asks Supabase Auth once, for the rate limit and the gate alike');
    console.log('PASS verified caller: the admin gate answers 503 during an Auth outage and reuses the verified token');

    // The fulfilment op takes the admin bucket before the gate, GET included.
    // With the clock still: the bucket refills a token a second.
    const clock = Date.now;
    const stopped = clock();
    Date.now = () => stopped;
    const gateAddress = nextAddress();
    const gate: number[] = [];
    for (let n = 0; n <= rateLimit.RATE_LIMITS.admin.capacity; n += 1) gate.push((await fulfilment(undefined, gateAddress)).statusCode);
    Date.now = clock;
    assert.deepEqual(gate.slice(0, -1).filter((status) => status !== 403), [], `the gate refuses a caller without a session (${gate.join(',')})`);
    assert.equal(gate.at(-1), 429, 'and the admin bucket runs out before the gate is asked again');
    console.log('PASS verified caller: the fulfilment op is rate-limited before its admin gate');

    // ── the admin console's API ──────────────────────────────────────────
    const admin = (op: string, input: Omit<Parameters<typeof call>[1], 'query'> & { query?: Record<string, string> }) =>
      call(adminOps as Handler, { account: ROLE_ADMIN, ...input, query: { op, ...(input.query ?? {}) } });
    const question = { question: 'Which hook keeps state?', options: ['useState', 'useRef'], correctIndex: 0, category: 'react', tags: ['hooks'], difficulty: 2 };
    // A save the database is too slow to take is the database busy, which the
    // console may retry: 503 upstream_timeout, not 500.
    const slowSave = await admin('save', { method: 'POST', body: { ...question, question: SLOW_QUESTION } });
    assert.equal(slowSave.statusCode, 503, `a timed-out admin save answers 503 (${JSON.stringify(slowSave.body)})`);
    assert.equal(errorCode(slowSave), 'upstream_timeout');
    console.log('PASS verified caller: an admin op whose database call times out answers 503');

    // An option the save cannot take is refused, never dropped: the correct
    // index points into the list as sent, and dropping the first of these
    // stored useRef as the answer to a question whose answer is useState.
    seen.length = 0;
    const shifted = await admin('save', { method: 'POST', body: { ...question, options: ['x'.repeat(2001), 'useState', 'useRef'], correctIndex: 1 } });
    assert.equal(shifted.statusCode, 400, `a save with an option too long is refused (${JSON.stringify(shifted.body)})`);
    assert.deepEqual(reads('/rest/v1/question_edits'), [], 'and nothing is written');
    for (const options of [['useState', 7], ['useState', '']]) {
      const refused = await admin('save', { method: 'POST', body: { ...question, options } });
      assert.equal(refused.statusCode, 400, `a save with the options ${JSON.stringify(options)} is refused`);
    }
    console.log('PASS verified caller: an admin save refuses an invalid option instead of dropping it and moving the answer');

    // Postgres refuses U+0000 in text and JSONB, which answered 500: the
    // console's writes holding one are refused before the database, and a
    // question that spells the escape out as text still saves.
    seen.length = 0;
    for (const [op, body] of [
      ['save', { ...question, explanation: 'NUL \u0000 here' }],
      ['save', { ...question, options: ['useState', 'use\u0000Ref'] }],
      ['settings', { settings: { devTips: ['tip \u0000'] } }],
      ['delete', { id: 'rm-js-\u00001' }],
    ] as const) {
      const refused = await admin(op, { method: 'POST', body });
      assert.equal(refused.statusCode, 400, `op=${op} holding U+0000 is refused (${JSON.stringify(refused.body)})`);
    }
    assert.deepEqual(seen.filter((one) => one.method !== 'GET'), [], 'and nothing is written');
    const spelled = await admin('save', { method: 'POST', body: { ...question, question: 'What does "\\u0000" print?' } });
    assert.equal(spelled.statusCode, 200, `a question that spells the escape out saves (${JSON.stringify(spelled.body)})`);
    console.log('PASS verified caller: an admin write holding U+0000 is refused with 400');

    // A report id is a UUID column: one that is not is refused before the
    // cast fails in Postgres, and a real one is dismissed.
    seen.length = 0;
    const notReport = await admin('reports', { method: 'POST', body: { id: 'report-1' } });
    assert.equal(notReport.statusCode, 400, `dismissing a report by a non-UUID id is refused (${JSON.stringify(notReport.body)})`);
    assert.deepEqual(reads('/rest/v1/question_reports'), [], 'before the database is asked');
    const dismissed = await admin('reports', { method: 'POST', body: { id: '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b' } });
    assert.equal(dismissed.statusCode, 200, JSON.stringify(dismissed.body));
    assert.equal(reads('/rest/v1/question_reports').filter((one) => one.method === 'DELETE').length, 1, 'a report id is dismissed');
    console.log('PASS verified caller: dismissing a report refuses an id that is not a UUID');

    // A save or delete naming an id that is neither the bank's nor a custom
    // question's wrote an override row no listing shows: refused with 404.
    seen.length = 0;
    for (const [op, body] of [
      ['delete', { id: 'rm-js-no-such-question' }],
      ['save', { ...question, id: 'rm-js-no-such-question' }],
    ] as const) {
      const refused = await admin(op, { method: 'POST', body });
      assert.equal(refused.statusCode, 404, `op=${op} for an id the bank lacks is refused (${JSON.stringify(refused.body)})`);
      assert.equal(errorCode(refused), 'unknown_question');
    }
    assert.deepEqual(reads('/rest/v1/question_edits'), [], 'and nothing is written');
    console.log('PASS verified caller: an admin save or delete refuses an id that is not a question');

    // Every write the console makes leaves an audit line naming the admin.
    const realLog = console.log;
    const audit: string[] = [];
    console.log = (line: unknown) => { audit.push(String(line)); };
    try {
      assert.equal((await admin('delete', { method: 'POST', body: { id: 'rm-js-1' } })).statusCode, 200);
      assert.equal((await admin('reset', { method: 'POST', body: { id: 'rm-js-1' } })).statusCode, 200);
      assert.equal((await admin('bulkhide', { method: 'POST', body: { maxImportance: 1 } })).statusCode, 200);
    } finally {
      console.log = realLog;
    }
    for (const op of ['delete', 'reset', 'bulkhide']) {
      const line = audit.map((one) => JSON.parse(one) as Row).find((one) => one.route === 'admin' && one.op === op);
      assert.equal(line?.by, ROLE_ADMIN.id, `op=${op} logs the admin who made it (${JSON.stringify(line)})`);
    }
    console.log('PASS verified caller: an admin write logs the admin account that made it');

    // A quality scan names its categories once: a repeated parameter arrives
    // as an array, which read as no filter and scanned the whole bank.
    const repeated = await admin('quality', { query: { categories: ['react', 'css'] as unknown as string } });
    assert.equal(repeated.statusCode, 400, 'a repeated categories parameter is refused');
    const scoped = await admin('quality', { query: { categories: 'react,css' } });
    assert.equal(scoped.statusCode, 200, `a quality scan of two categories answers (${errorCode(scoped)})`);
    console.log('PASS verified caller: a quality scan refuses a repeated categories parameter');

    // A long explanation is cut to 4,000 characters by code point, so an
    // emoji at the cut is kept whole rather than stored as half a pair.
    seen.length = 0;
    const long = await admin('save', { method: 'POST', body: { ...question, explanation: `${'a'.repeat(3_999)}🦈 and more` } });
    assert.equal(long.statusCode, 200, JSON.stringify(long.body));
    const stored = (reads('/rest/v1/question_edits').find((one) => one.method === 'POST')?.body as Row | undefined)?.explanation as string;
    assert.equal(stored, `${'a'.repeat(3_999)}🦈`, 'the cut keeps the emoji whole');
    console.log('PASS verified caller: an admin save cuts long text by code point');

    // ── nothing about one person in a shared cache ──────────────────────
    const personal: [string, Response][] = [
      ['stats', await user('stats', { account: A })],
      ['xp', await user('xp', { account: A })],
      ['streak', await user('streak', { account: A })],
      ['flashcards', await call(flashcards as Handler, { account: A, query: { subject: 'webdev' } })],
      ['roadmap progress', await call(roadmap as Handler, { account: A, query: { resource: 'progress' } })],
      ['a refusal', await user('stats', {})],
    ];
    for (const [label, res] of personal) {
      assert.equal(res.headers['cache-control'], 'private, no-store', `${label} (${res.statusCode}) is kept out of shared caches`);
    }
    const publicReads: [string, Response, RegExp][] = [
      ['settings', await call(settings as Handler, {}), /^public, s-maxage=15/],
      ['health', await call(health as Handler, {}), /^no-store$/],
      ['the all-time board', await call(leaderboard as Handler, { query: { period: 'global' } }), /^public, s-maxage=60/],
      ['the Learn map', await call(roadmap as Handler, {}), /^public, max-age=60, s-maxage=60, stale-while-revalidate=300$/],
    ];
    for (const [label, res, expected] of publicReads) {
      assert.equal(res.statusCode, 200, `${label}: ${JSON.stringify(res.body)}`);
      assert.match(res.headers['cache-control'] ?? '', expected, `${label} keeps its own header`);
    }
    console.log('PASS verified caller: personal answers are private, no-store; public ones keep their headers');

    // A health check the database answers with an error is logged with the
    // reason, as a check that throws is: a 503 with no line saying why sent
    // the owner to guess which dependency failed.
    {
      const lines: Row[] = [];
      const original = console.log;
      healthReadFails = true;
      console.log = (line: unknown) => {
        try { lines.push(JSON.parse(String(line)) as Row); } catch { original(line); }
      };
      let down: Response;
      try {
        down = await call(health as Handler, {});
      } finally {
        console.log = original;
        healthReadFails = false;
      }
      assert.equal(down.statusCode, 503, `a failing service-role read is degraded (${JSON.stringify(down.body)})`);
      const logged = lines.find((line) => line.route === 'health' && line.dependency === 'service_role');
      assert.deepEqual({ level: logged?.level, reason: logged?.reason }, { level: 'error', reason: '42501' }, 'and logged with its reason');
    }
    console.log('PASS verified caller: a failed health check is logged with its reason');

    // The probe is public and not rate limited: probes that arrive together
    // share one check, so a flood of them is not a flood of database reads.
    // Each answer is still fresh: the next probe checks again.
    {
      const before = { database: reads('/rest/v1/user_stats').length, serviceRole: reads('/rest/v1/quiz_submissions').length };
      const together = await Promise.all([call(health as Handler, {}), call(health as Handler, {}), call(health as Handler, {})]);
      for (const res of together) assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.deepEqual(
        { database: reads('/rest/v1/user_stats').length - before.database, serviceRole: reads('/rest/v1/quiz_submissions').length - before.serviceRole },
        { database: 1, serviceRole: 1 },
        'three probes at once read each dependency once',
      );
      await call(health as Handler, {});
      assert.equal(reads('/rest/v1/user_stats').length - before.database, 2, 'a later probe checks again');
    }
    console.log('PASS verified caller: health probes that arrive together share one check');

    healthReadHangs = true;
    try {
      const timedOutHealth = await call(health as Handler, {});
      assert.equal(timedOutHealth.statusCode, 503, 'a stalled dependency still fails readiness');
      for (let wait = 0; wait < 20 && closedHealthReads === 0; wait++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(closedHealthReads, 1, 'the deadline cancels the stalled HTTP request, not only the caller’s wait');
    } finally {
      healthReadHangs = false;
    }
    assert.equal((await call(health as Handler, {})).statusCode, 200, 'the next health probe can recover');
    console.log('PASS verified caller: a timed-out health probe aborts its stalled request');

    // ── the retired progress PUT ─────────────────────────────────────────
    // It answered with the progress read and wrote nothing; the server writes
    // progress itself on each completion. Retired, it reads nothing either.
    seen.length = 0;
    const progressPut = await call(roadmap as Handler, { method: 'PUT', account: A, body: { data: {}, extra: { unlocked: ['react'], wallets: { webdev: { balance: 999 } } } } });
    assert.equal(progressPut.statusCode, 405, `a progress PUT is refused (${JSON.stringify(progressPut.body)})`);
    assert.equal(progressPut.headers.allow, 'GET, POST', 'and the route names the methods it serves');
    assert.deepEqual(reads('/rest/v1/roadmap_progress'), [], 'and the progress row is neither read nor written');
    console.log('PASS verified caller: the retired progress PUT answers 405 and touches no progress row');

    // ── reads a script can drive ─────────────────────────────────────────
    const lookup = (account: Account) => user('friends-lookup', { account, query: { handle: 'shark_fan' } });
    assert.equal((await lookup(A)).statusCode, 200);
    // The buckets refill with time (the address one at 32 a second), so the
    // clock stands still while they are drained and asked, or a slow runner
    // would find a token again.
    const realNow = Date.now;
    const frozen = realNow();
    Date.now = () => frozen;
    const drain = (config: { key: string; capacity: number; refillPerSecond: number }, identity?: string, from?: string) => {
      const res = mockResponse();
      const req = { headers: { 'x-forwarded-for': from ?? '0.0.0.0' }, query: {} } as never;
      for (let n = 0; n < config.capacity; n += 1) rateLimit.checkRateLimit(req, res as never, config, identity);
    };
    drain(rateLimit.RATE_LIMITS.readPerUser, `user:${A.id}`);
    const limited = await lookup(A);
    assert.equal(limited.statusCode, 429, `a friend lookup past the account's read budget is refused (${JSON.stringify(limited.body)})`);
    assert.equal((await lookup(B)).statusCode, 200, 'another account keeps its own budget');
    const walletLimited = await user('wallet', { account: A, query: { subject: 'webdev' } });
    assert.equal(walletLimited.statusCode, 429, 'the wallet read shares the account\'s read budget');
    const badgesLimited = await user('badges', { account: A, query: { subject: 'webdev' } });
    assert.equal(badgesLimited.statusCode, 429, 'so do badges');
    const eligibility = await call(roadmap as Handler, { account: A, query: { resource: 'eligibility' } });
    assert.equal(eligibility.statusCode, 429, 'so does the Learn plan');

    const school = nextAddress();
    drain(rateLimit.RATE_LIMITS.readAddress, undefined, school);
    const map = await call(roadmap as Handler, { from: school });
    assert.equal(map.statusCode, 429, 'the Learn map past the address budget is refused');
    const level = await call(roadmap as Handler, { from: school, query: { topic: 'javascript', level: '1' } });
    assert.equal(level.statusCode, 429, 'so is a Learn step');
    const board = await call(leaderboard as Handler, { from: school, query: { period: 'global' } });
    assert.equal(board.statusCode, 429, 'so is a leaderboard read the CDN did not answer');
    assert.equal((await call(roadmap as Handler, {})).statusCode, 200, 'another address keeps its own budget');
    Date.now = realNow;
    console.log('PASS verified caller: wallet, badges, friend lookup, Learn and leaderboard reads are rate-limited');

    const limits: [string | undefined, number][] = [[undefined, 100], ['1', 10], ['10', 10], ['11', 25], ['37', 50], ['100', 100], ['101', 200], ['5000', 200], ['-3', 10], ['junk', 100]];
    for (const [asked, served] of limits) {
      seen.length = 0;
      const res = await call(leaderboard as Handler, { query: { period: 'global', ...(asked === undefined ? {} : { limit: asked }) } });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal((reads('/rest/v1/rpc/subject_leaderboard')[0]?.body as Row | undefined)?.p_limit, served, `limit=${asked} is served as ${served}`);
    }
    console.log('PASS verified caller: a leaderboard limit is one of a few sizes');

    // A daily board names a real day: 2026-02-30 has the right shape, and the
    // routine's date cast would fail on it. A period or date repeated in the
    // query string names neither.
    for (const query of [{ period: 'daily', date: '2026-02-30' }, { period: 'daily', date: '2026-13-01' }, { period: 'daily', date: '0000-01-01' }, { period: 'daily', date: ['2026-10-01', '2026-10-02'] }, { period: ['daily', 'global'] }] as Record<string, string>[]) {
      seen.length = 0;
      const refused = await call(leaderboard as Handler, { query });
      assert.equal(refused.statusCode, 400, `${JSON.stringify(query)} is a bad request (${JSON.stringify(refused.body)})`);
      assert.equal(reads('/rest/v1/rpc/daily_leaderboard_v2').length, 0, 'and asks no routine');
    }
    const leapDay = await call(leaderboard as Handler, { query: { period: 'daily', date: '2028-02-29' } });
    assert.equal(leapDay.statusCode, 200, `a leap day is a day (${JSON.stringify(leapDay.body)})`);
    console.log('PASS verified caller: a daily board refuses a date that is no calendar day');

    // A learning-preference write verifies its token for the per-account
    // limit, and the op reads the caller through lib/auth.ts's tryAuth:
    // Supabase Auth is asked once for both.
    authChecks = 0;
    const preferenceSave = await user('learning-preference', { method: 'PUT', account: A, body: { schemaVersion: 1, baseTrack: 'frontend', specialization: null } });
    // The account carries no saved answers, so the save writes the track
    // alone; the caller was verified by then.
    assert.notEqual(preferenceSave.statusCode, 401, JSON.stringify(preferenceSave.body));
    assert.equal(authChecks, 1, 'a learning-preference write asks Supabase Auth once, for the rate limit and the op alike');
    console.log('PASS verified caller: a learning-preference write verifies its token once');

    // The write merges with the answers Supabase Auth returned with that
    // token check (#587, server item 23): no admin re-read of the account.
    // A PUT never trusts an earlier acceptance, so the record is this
    // request's own.
    seen.length = 0;
    authChecks = 0;
    const partialSave = await user('learning-preference', { method: 'PUT', account: PROFILED, body: { schemaVersion: 1, baseTrack: 'frontend', specialization: null } });
    assert.equal(partialSave.statusCode, 200, JSON.stringify(partialSave.body));
    assert.equal(authChecks, 1, 'the preference write asks Supabase Auth once');
    assert.equal(seen.filter((one) => one.method === 'GET' && one.path === `/auth/v1/admin/users/${PROFILED.id}`).length, 0,
      'and does not read the account again through the admin API');
    const adminWrites = seen.filter((one) => one.method === 'PUT' && one.path === `/auth/v1/admin/users/${PROFILED.id}`);
    assert.equal(adminWrites.length, 1, 'the preference is written once, for the verified account');
    const writtenProfile = (adminWrites[0].body as { user_metadata?: Record<string, Row> }).user_metadata?.devquiz_learner_profile_v2;
    assert.equal(writtenProfile?.baseTrack, 'frontend', 'the save changes the track it sent');
    assert.deepEqual([writtenProfile?.goals, writtenProfile?.experience, writtenProfile?.studyTime, writtenProfile?.sections],
      [['level-up'], 'some', '30-60', ['software-engineer']], 'and keeps the saved answers the token check returned');
    console.log('PASS verified caller: a learning-preference write merges with the verified account, without an admin re-read');

    // A board routine that does not answer in time is the database busy, not
    // a fault: 503, which the client may retry, rather than 500.
    const slowBoard = await call(leaderboard as Handler, { query: { period: 'category', category: 'javascript', min_attempts: String(SLOW_BOARD_MIN_ATTEMPTS) } });
    assert.equal(slowBoard.statusCode, 503, `a board whose routine timed out answers 503 (${JSON.stringify(slowBoard.body)})`);
    assert.equal(errorCode(slowBoard), 'upstream_timeout');
    console.log('PASS verified caller: a timed-out leaderboard answers 503');

    // The account ops and learning-path routes keep the same retryable
    // error, including the path handler's enrollment and progress catches.
    {
      const { pathById } = await import('../lib/learning-paths/catalog');
      const path = pathById('fde')!;
      const lesson = path.modules.filter((module) => !module.requiresAtLeast)
        .flatMap((module) => module.activities).find((activity) => activity.kind === 'lesson')!;
      const oldSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      process.env.LEARNING_PATH_FDE_ENABLED = 'true';
      fdeFixtureVersion = path.version;
      const pathStart = (account: Account, enrollmentId: string) => call(roadmap as Handler, {
        account, method: 'POST', query: { resource: 'learning-path-start' },
        body: { enrollmentId, activityId: lesson.id },
      });
      const pathSubmit = (account: Account, enrollmentId: string) => call(roadmap as Handler, {
        account, method: 'POST', query: { resource: 'learning-path-submit' },
        body: {
          session: tokens.encodeLearningPathSession({
            attemptId: enrollmentId, enrollmentId, userId: account.id, pathId: path.id,
            activityId: lesson.id, activityKind: lesson.kind, purpose: lesson.purpose,
            curriculumVersion: path.version, rubricVersion: path.rubric.version,
          }).token,
          idempotencyKey: 'test-slow-path-submit', acknowledged: true,
        },
      });
      try {
        const accountReads = ['streak', 'xp', 'stats', 'leaderboard-visibility', 'identity', 'friends-handle'];
        const slowResponses = await Promise.all([
          ...accountReads.map(async (op) => [op, await user(op, { account: SLOW })] as const),
          ...['learning-path-enrollment', 'learning-path-progress', 'learning-path-draft'].map(async (op) => [
            op, await user(op, { account: SLOW, query: { enrollmentId: 'slow-path-enrollment', activityId: lesson.id } }),
          ] as const),
          pathStart(SLOW, 'slow-path-enrollment').then((res) => ['path start enrollment', res] as const),
          pathSubmit(SLOW, 'slow-path-enrollment').then((res) => ['path submit enrollment', res] as const),
          pathSubmit(A, SLOW_PATH_PROGRESS).then((res) => ['path submit progress', res] as const),
          pathStart(A, SLOW_PATH_OPEN).then((res) => ['path start attempt write', res] as const),
          pathSubmit(A, SLOW_PATH_ACCEPT).then((res) => ['path submit result write', res] as const),
        ]);
        for (const [label, res] of slowResponses) {
          assert.equal(res.statusCode, 503, `${label} times out with 503 (${JSON.stringify(res.body)})`);
          assert.equal(errorCode(res), 'upstream_timeout', `${label} reports an upstream timeout`);
        }
      } finally {
        if (oldSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = oldSwitch;
        fdeFixtureVersion = undefined;
      }
      console.log('PASS verified caller: account and learning-path operations that time out answer 503 upstream_timeout');
    }

    // ── this month's XP board (migration 056) ───────────────────────────
    // Shared and cached for a minute without a session; with one it is the
    // token's own line, never the account a query names, and private.
    seen.length = 0;
    const monthShared = await call(leaderboard as Handler, { query: { period: 'month' } });
    assert.equal(monthShared.statusCode, 200, JSON.stringify(monthShared.body));
    assert.match(monthShared.headers['cache-control'] ?? '', /^public, s-maxage=60$/, 'the shared month board is cached for a minute');
    const sharedBody = monthShared.body as { period: string; month: string; subject: string; me?: unknown };
    assert.equal(sharedBody.period, 'month');
    assert.match(sharedBody.month, /^\d{4}-(0[1-9]|1[0-2])$/, 'the board names its month');
    assert.equal(sharedBody.month, new Date().toISOString().slice(0, 7), 'the current UTC month');
    assert.equal(sharedBody.subject, 'webdev');
    assert.equal('me' in sharedBody, false, 'a shared board carries nobody\'s own line');
    const sharedRead = reads('/rest/v1/rpc/month_xp_leaderboard')[0]?.body as Row | undefined;
    assert.deepEqual(sharedRead, { p_subject: 'webdev', p_limit: 100, p_viewer: null, p_month: sharedBody.month },
      'the board asks for the subject\'s month, for nobody in particular');
    assert.equal(reads('/rest/v1/rpc/month_xp_leaderboard_rank').length, 0, 'and no own place');

    seen.length = 0;
    const monthMine = await call(leaderboard as Handler, { account: A, query: { period: 'month', me: '1', user_id: B.id } });
    assert.equal(monthMine.statusCode, 200, JSON.stringify(monthMine.body));
    assert.equal(monthMine.headers['cache-control'], 'private, no-store', 'a personal month board stays out of shared caches');
    assert.equal(monthMine.headers.vary, 'Authorization');
    assert.deepEqual((monthMine.body as { me?: unknown }).me, { rank: null, xp: 0 }, 'no XP this month, no place');
    assert.equal((reads('/rest/v1/rpc/month_xp_leaderboard')[0]?.body as Row | undefined)?.p_viewer, A.id, 'the viewer is the token\'s account');
    assert.equal((reads('/rest/v1/rpc/month_xp_leaderboard_rank')[0]?.body as Row | undefined)?.p_user, A.id, 'and so is the own place');

    const foreign = await call(leaderboard as Handler, { query: { period: 'month', categories: 'javascript,geography-capitals' } });
    assert.equal(foreign.statusCode, 400, 'a month board for another subject is refused');
    assert.equal(errorCode(foreign), 'invalid_subject_scope');
    console.log('PASS verified caller: this month\'s XP board is shared without a session and the token\'s own with one');

    // ── a Supabase call that does not answer in time ─────────────────────
    const hung = new Promise<never>(() => {});
    await assert.rejects(
      http.withTimeout(hung, 5),
      (error: unknown) => error instanceof http.ServiceUnavailableError && error.code === 'upstream_timeout',
      'a timed-out Supabase call is the service being unavailable',
    );
    const timedOut = mockResponse();
    await http.withRequestContext(
      { method: 'GET', headers: { 'x-forwarded-for': nextAddress() }, query: {}, url: '/api' } as never,
      timedOut as never,
      () => http.withTimeout(hung, 5),
    );
    assert.equal(timedOut.statusCode, 503, `a handler whose Supabase call timed out answers 503, not 500 (${JSON.stringify(timedOut.body)})`);
    assert.equal(errorCode(timedOut), 'upstream_timeout');
    console.log('PASS verified caller: a Supabase timeout answers 503 upstream_timeout');

    // ── the distributed limiter down ─────────────────────────────────────
    // Every Upstash command fails here. A request still passes on the
    // in-memory bucket, and right after a failure the next one does not ask
    // Upstash again: a hung Upstash held each bucket for the whole deadline.
    {
      const clock = Date.now;
      const later = clock() + 3_600_000;
      Date.now = () => later;
      try {
        const bucket = { key: `limiter-pause-${later}`, capacity: 5, refillPerSecond: 1 };
        const req = { headers: { 'x-forwarded-for': nextAddress() }, socket: {} } as never;
        upstashCommands.length = 0;
        assert.equal(await rateLimit.enforceRateLimit(req, mockResponse() as never, bucket), true, 'a limiter outage lets the request through');
        const asked = upstashCommands.length;
        assert.ok(asked > 0, 'the first request asks Upstash');
        assert.equal(await rateLimit.enforceRateLimit(req, mockResponse() as never, bucket), true);
        assert.equal(upstashCommands.length, asked, 'the next one, just after the failure, keeps to the in-memory bucket');
      } finally {
        Date.now = clock;
      }
    }
    console.log('PASS verified caller: a failing distributed limiter is not asked again straight away');

    // ── what an escaped error logs ───────────────────────────────────────
    const { AuthError } = await import('../lib/auth');
    const escapedLogs = async (thrown: Error) => {
      const lines: Row[] = [];
      const original = console.log;
      console.log = (line: unknown) => {
        try { lines.push(JSON.parse(String(line)) as Row); } catch { original(line); }
      };
      const res = mockResponse();
      try {
        await http.withRequestContext(
          { method: 'GET', headers: { 'x-forwarded-for': nextAddress() }, query: {}, url: '/api/escaped' } as never,
          res as never,
          () => { throw thrown; },
        );
      } finally {
        console.log = original;
      }
      return { res, failure: lines.find((line) => line.route === 'request' && 'level' in line) };
    };
    const refused = await escapedLogs(new AuthError(401, 'unauthorized', 'Sign in again'));
    assert.equal(refused.res.statusCode, 401);
    assert.deepEqual({ level: refused.failure?.level, status: refused.failure?.status }, { level: 'warn', status: 401 },
      'a refused token is logged as the 401 it answers, not as a 500 error');
    const authDown = await escapedLogs(new AuthError(503, 'auth_unavailable', 'Sign-in is unavailable'));
    assert.equal(authDown.res.statusCode, 503);
    assert.deepEqual({ level: authDown.failure?.level, status: authDown.failure?.status }, { level: 'error', status: 503 },
      'Auth being down is an error logged with the 503 it answers');
    const timedOutLog = await escapedLogs(new http.UpstreamTimeoutError());
    assert.equal(timedOutLog.res.statusCode, 503);
    assert.deepEqual(
      { level: timedOutLog.failure?.level, status: timedOutLog.failure?.status, category: timedOutLog.failure?.category },
      { level: 'error', status: 503, category: 'upstream_timeout' },
      'a timeout answered 503 is still logged at level error, as the 500 it replaced was',
    );
    console.log('PASS verified caller: an escaped AuthError is logged with the status it answers, and a 503 at level error');

    // ── Supabase Auth down ───────────────────────────────────────────────
    for (const query of [{ resource: 'due' }, { resource: 'review', count: '5', categories: 'javascript' }] as Record<string, string>[]) {
      const down = await call(questions as Handler, { account: AUTH_DOWN, query });
      assert.equal(down.statusCode, 503, `${query.resource}: a sign-in service that is down is not an invalid session (${JSON.stringify(down.body)})`);
      assert.equal(errorCode(down), 'auth_unavailable');
    }
    // No answer, or Auth's own rate limit, decides nothing about the token
    // either: supabase-js reports the first with status 0, and both read 401.
    for (const account of [AUTH_UNREACHABLE, AUTH_THROTTLED]) {
      const undecided = await call(questions as Handler, { account, query: { resource: 'due' } });
      assert.equal(undecided.statusCode, 503, `${account.token}: Supabase Auth that did not decide is not an invalid session (${JSON.stringify(undecided.body)})`);
      assert.equal(errorCode(undecided), 'auth_unavailable');
    }
    const refusedToken = await call(questions as Handler, { account: { ...A, token: 'not-a-token' }, query: { resource: 'due' } });
    assert.equal(refusedToken.statusCode, 401, 'a token Supabase refuses is still 401');
    assert.equal(errorCode(refusedToken), 'unauthorized');
    console.log('PASS verified caller: Today\'s due list and a review keep 503 when Supabase Auth is down, unreachable or throttled, and 401 for a refused token');

    // ── a quiz submit whose one-time claim cannot be taken ───────────────
    claimFails = true;
    try {
      const sessionId = tokens.encodeSession([{ questionId: 'q-claim-1', correctAnswer: 0 }], { subject: 'webdev' });
      const unclaimed = await call(submit as Handler, { method: 'POST', account: A, body: { sessionId, answers: { 'q-claim-1': 0 } } });
      assert.equal(unclaimed.statusCode, 503, `a submit is not graded without its claim, and says to retry (${JSON.stringify(unclaimed.body)})`);
      assert.equal(errorCode(unclaimed), 'claim_unavailable');
    } finally {
      claimFails = false;
    }
    console.log('PASS verified caller: a quiz submit whose one-time claim fails answers 503');

    // ── the admin's report list ──────────────────────────────────────────
    assert.equal((await questionsStore.getWithheldQuestions()).get(RETIRED_REPORTED), 'retired', 'the fixture is a question the gate withholds');
    const [retiredReport] = await reportsStore.listReports();
    assert.equal(retiredReport?.questionId, RETIRED_REPORTED);
    assert.ok(retiredReport.questionSummary, 'a report on a question retired since still shows what the question was');
    console.log('PASS verified caller: the admin report list summarises a reported question the gate has retired');

    // ── question reports ─────────────────────────────────────────────────
    seen.length = 0;
    const reported = await call(submit as Handler, { method: 'POST', account: A, query: { resource: 'report' }, body: { question_id: 'q-report-1', reason: 'typo', detail: 'A typo in the second option' } });
    assert.equal(reported.statusCode, 200, JSON.stringify(reported.body));
    assert.equal((reads('/rest/v1/question_reports')[0]?.body as Row | undefined)?.reporter_sub, A.id, 'a report names the token\'s account');
    seen.length = 0;
    const nul = await call(submit as Handler, { method: 'POST', query: { resource: 'report' }, body: { question_id: 'q-report-1', reason: 'other', detail: 'before\u0000after' } });
    assert.equal(nul.statusCode, 400, `Postgres text cannot hold U+0000, so the report is refused before its insert (${JSON.stringify(nul.body)})`);
    assert.equal(reads('/rest/v1/question_reports').length, 0, 'and nothing is written');
    const slowReport = await call(submit as Handler, { method: 'POST', query: { resource: 'report' }, body: { question_id: 'q-report-1', reason: 'other', detail: SLOW_REPORT } });
    assert.equal(slowReport.statusCode, 503, `a report insert that times out answers 503, as every timeout does (${JSON.stringify(slowReport.body)})`);
    assert.equal(errorCode(slowReport), 'upstream_timeout');
    console.log('PASS verified caller: a question report is saved for its reporter, one holding U+0000 is refused, and a timed-out one answers 503');

    // ── one-time claims with Upstash configured and failing ──────────────
    upstashCommands.length = 0;
    await assert.rejects(
      rateLimit.claimOnce('placement:verified-caller-attempt-0001:1', 60),
      (error: unknown) => error instanceof http.ServiceUnavailableError && error.code === 'claim_unavailable',
      'a claim Upstash does not record is refused, not taken from this instance\'s memory',
    );
    assert.ok(upstashCommands.some((command) => command.includes('once:placement:verified-caller-attempt-0001:1')), 'the claim was asked of Upstash');

    const placement = await call(roadmap as Handler, { query: { resource: 'placement', subject: 'webdev' } });
    assert.equal(placement.statusCode, 200, JSON.stringify(placement.body));
    const round = placement.body as { placementToken: string; questions: { id: string }[] };
    const graded = await call(roadmap as Handler, { method: 'POST', query: { resource: 'placement' }, body: { placementToken: round.placementToken, answers: Object.fromEntries(round.questions.map((q) => [q.id, 0])) } });
    assert.equal(graded.statusCode, 503, `a placement round is not graded without its claim (${JSON.stringify(graded.body)})`);
    assert.equal(errorCode(graded), 'claim_unavailable');

    // The design walkthrough's one-check claim is not reachable any more:
    // system design is hidden (owner decision, 9 Oct 2026), so its task does
    // not open and no walkthrough session is dealt.
    const design = CODING_TASKS.find((task) => task.track === 'system-design' && task.design)!;
    const opened = await call(roadmap as Handler, { account: A, query: { resource: 'coding-task', id: design.id } });
    assert.equal(opened.statusCode, 404, JSON.stringify(opened.body));
    console.log('PASS verified caller: a one-time claim Upstash cannot record answers 503');

    // ── an account made with an email and password ──────────────────────
    seen.length = 0;
    authChecks = 0;
    const event = await user('authevent', { method: 'POST', account: EMAIL, body: {} });
    assert.equal(event.statusCode, 200, JSON.stringify(event.body));
    assert.equal(authChecks, 1, 'a sign-in report asks Supabase Auth once, for the rate limit and the log alike');
    const logged = reads('/rest/v1/auth_events').find((one) => one.method === 'POST')?.body as Row | undefined;
    assert.deepEqual(
      { user_id: logged?.user_id, email: logged?.email, provider: logged?.provider },
      { user_id: EMAIL.id, email: EMAIL.email, provider: 'email' },
      'a sign-in with a password is logged with its provider',
    );
    // The /dev Logs tab: a log that could not be read is an error with Retry,
    // not an empty log that looks like nobody signed in. Before the migration
    // there is no log, and that stays empty.
    const { listAuthEvents } = await import('../lib/auth-events-store');
    authEventsRead = 'down';
    await assert.rejects(listAuthEvents(), 'a failed read of the auth log is not an empty log');
    authEventsRead = 'missing';
    assert.deepEqual(await listAuthEvents(), [], 'no auth log table yet reads as no events');
    authEventsRead = 'ok';
    seen.length = 0;
    const named = await user('leaderboard-visibility', { method: 'PUT', account: EMAIL, body: { visible: true } });
    assert.equal(named.statusCode, 200, JSON.stringify(named.body));
    const shownRow = reads('/rest/v1/user_stats').find((one) => one.method === 'POST')?.body as Row | undefined;
    assert.deepEqual(
      { name: shownRow?.name, picture: shownRow?.picture, email: shownRow?.email },
      { name: null, picture: null, email: EMAIL.email },
      'without a Google identity the boards get no name and no picture, and never the address',
    );
    seen.length = 0;
    authChecks = 0;
    const deleted = await user('delete-account', { method: 'DELETE', account: EMAIL, body: { confirmation: 'DELETE' } });
    assert.equal(deleted.statusCode, 200, `an email account deletes like any other (${JSON.stringify(deleted.body)})`);
    assert.equal(authChecks, 1, 'a deletion asks Supabase Auth once, for the rate limit and the deletion alike');
    assert.deepEqual(reads('/rest/v1/rpc/delete_user_data').map((one) => (one.body as Row).p_user_id), [EMAIL.id, EMAIL.id], 'its data is erased, before and after the identity');
    assert.equal(seen.filter((one) => one.method === 'DELETE' && one.path === `/auth/v1/admin/users/${EMAIL.id}`).length, 1, 'and its sign-in identity is deleted');
    console.log('PASS verified caller: an email and password account signs in, stays unnamed on boards, and deletes');

    try {
      seen.length = 0;
      authDeleteError = { status: 404, code: 'user_not_found' };
      const goneAlready = await user('delete-account', { method: 'DELETE', account: A, body: { confirmation: 'DELETE' } });
      assert.equal(goneAlready.statusCode, 200, 'another request already deleting the identity is a successful deletion');
      assert.deepEqual(goneAlready.body, { ok: true });
      assert.equal(reads('/rest/v1/rpc/delete_user_data').length, 2, 'the confirmed-absent identity still gets the final cleanup');

      seen.length = 0;
      authDeleteError = { status: 500, code: 'unexpected_failure' };
      const unknownDelete = await user('delete-account', { method: 'DELETE', account: B, body: { confirmation: 'DELETE' } });
      assert.equal(unknownDelete.statusCode, 500, 'an unknown identity outcome cannot be reported as deleted');
      assert.equal(errorCode(unknownDelete), 'auth_delete_failed');
      assert.equal(reads('/rest/v1/rpc/delete_user_data').length, 1, 'final cleanup is reserved for a confirmed identity deletion');
    } finally {
      authDeleteError = null;
    }
    console.log('PASS verified caller: only a confirmed missing identity makes deletion idempotent');

    // A sign-in report while Supabase Auth is down says so; 401 would say the
    // session ended.
    const eventDown = await user('authevent', { method: 'POST', account: AUTH_DOWN, body: {} });
    assert.equal(eventDown.statusCode, 503, `a sign-in report during an Auth outage is not an invalid session (${JSON.stringify(eventDown.body)})`);
    assert.equal(errorCode(eventDown), 'auth_unavailable');
    console.log('PASS verified caller: a sign-in report verifies its token once and keeps 503 during an Auth outage');

    const slowErasure = await user('delete-account', { method: 'DELETE', account: SLOW_ERASURE, body: { confirmation: 'DELETE' } });
    assert.equal(slowErasure.statusCode, 503, `an erasure that timed out answers 503 like every other timeout, not 504 (${JSON.stringify(slowErasure.body)})`);
    assert.equal(errorCode(slowErasure), 'upstream_timeout');
    console.log('PASS verified caller: an account erasure that times out answers 503 upstream_timeout');

    // ── a token Auth accepted, across requests (#587, server item 1) ─────
    {
      const realNow = Date.now;
      let offset = 0;
      Date.now = () => realNow() + offset;
      try {
        const identity = (account: Account) => user('identity', { account });
        authChecks = 0;
        assert.equal((await identity(JWT_LEARNER)).statusCode, 200);
        assert.equal((await identity(JWT_LEARNER)).statusCode, 200);
        assert.equal(authChecks, 1, 'a second request with a token Auth accepted is not asked again');
        // Requests that arrive together share one Auth call.
        authChecks = 0;
        const together = await Promise.all([identity(JWT_TOGETHER), identity(JWT_TOGETHER), identity(JWT_TOGETHER)]);
        assert.deepEqual(together.map((one) => one.statusCode), [200, 200, 200]);
        assert.equal(authChecks, 1, 'three requests with one new token at once ask Auth once');
        // A plain token (not a JWT) is never kept.
        authChecks = 0;
        await identity(A);
        await identity(A);
        assert.equal(authChecks, 2, 'a token without a readable expiry is asked every time');
        // A refusal and an outage are never kept.
        authChecks = 0;
        const stranger = { ...JWT_LEARNER, token: jwt('1a2b3c4d-0000-4000-8000-0000000001ff', 3600) };
        assert.equal((await identity(stranger)).statusCode, 401);
        assert.equal((await identity(stranger)).statusCode, 401);
        assert.equal(authChecks, 2, 'a refused token is asked again');
        failingTokens.add(JWT_OUTAGE.token);
        authChecks = 0;
        assert.equal((await identity(JWT_OUTAGE)).statusCode, 503);
        assert.equal((await identity(JWT_OUTAGE)).statusCode, 503);
        failingTokens.delete(JWT_OUTAGE.token);
        assert.equal((await identity(JWT_OUTAGE)).statusCode, 200, 'an outage is not remembered once Auth is back');
        assert.equal(authChecks, 3, 'each request during an outage asks again');
        // At most a minute.
        offset += 59_000;
        authChecks = 0;
        await identity(JWT_LEARNER);
        assert.equal(authChecks, 0, 'still accepted 59 s later');
        offset += 2_000;
        await identity(JWT_LEARNER);
        assert.equal(authChecks, 1, 'asked again once the minute is up');
        // Never past the token's own expiry.
        authChecks = 0;
        await identity(JWT_SHORT);
        offset += 31_000;
        await identity(JWT_SHORT);
        assert.equal(authChecks, 2, 'a token is asked again once it has expired, within the minute');
        // Revocation: a session ended elsewhere keeps working on reads that
        // trust the acceptance for the rest of its minute, and no longer.
        authChecks = 0;
        assert.equal((await identity(JWT_LEARNER)).statusCode, 200);
        revokedTokens.add(JWT_LEARNER.token);
        assert.equal((await identity(JWT_LEARNER)).statusCode, 200, 'an ended session is trusted for the rest of its minute');
        offset += 60_001;
        assert.equal((await identity(JWT_LEARNER)).statusCode, 401, 'and refused once the minute is up');
        assert.equal((await identity(JWT_LEARNER)).statusCode, 401, 'and stays refused');
        assert.equal(authChecks, 2, 'the two reads inside the minute were not asked; both after it were');
        // Only reads trust an acceptance: every write, and the wallet read
        // that settles coin grants, asks Auth, so a session ended elsewhere
        // earns and writes nothing more.
        authChecks = 0;
        assert.equal((await identity(JWT_WRITER)).statusCode, 200);
        assert.equal((await identity(JWT_WRITER)).statusCode, 200);
        assert.equal(authChecks, 1, 'a read trusts the acceptance');
        await user('identity', { method: 'PUT', account: JWT_WRITER, body: {} });
        await user('identity', { method: 'PUT', account: JWT_WRITER, body: {} });
        assert.equal(authChecks, 3, 'every write asks Auth, even for a token accepted a moment ago');
        await user('wallet', { account: JWT_WRITER });
        await user('wallet', { account: JWT_WRITER });
        assert.equal(authChecks, 5, 'the wallet read settles grants, so it asks Auth every time');
        revokedTokens.add(JWT_WRITER.token);
        assert.equal((await identity(JWT_WRITER)).statusCode, 200, 'an ended session may still read for the rest of its minute');
        const endedWrite = await user('identity', { method: 'PUT', account: JWT_WRITER, body: {} });
        assert.equal(endedWrite.statusCode, 401, `but a write on it is refused at once (${JSON.stringify(endedWrite.body)})`);
        const endedWallet = await user('wallet', { account: JWT_WRITER });
        assert.equal(endedWallet.statusCode, 401, `and so is the wallet (${JSON.stringify(endedWallet.body)})`);
        // The admin desk asks Auth on every request, accepted or not.
        authChecks = 0;
        assert.equal((await identity(JWT_ADMIN)).statusCode, 200);
        assert.equal((await user('fulfilment', { account: JWT_ADMIN })).statusCode, 200);
        assert.equal((await user('fulfilment', { account: JWT_ADMIN })).statusCode, 200);
        assert.equal(authChecks, 3, 'the admin gate asks Auth on every request');
        revokedTokens.add(JWT_ADMIN.token);
        const demoted = await user('fulfilment', { account: JWT_ADMIN });
        assert.equal(demoted.statusCode, 403, `an admin whose session ended is refused at once (${JSON.stringify(demoted.body)})`);
        // A deleted account's token is forgotten on the instance that deleted it.
        authChecks = 0;
        assert.equal((await identity(JWT_DELETED)).statusCode, 200);
        const gone = await user('delete-account', { method: 'DELETE', account: JWT_DELETED, body: { confirmation: 'DELETE' } });
        assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
        assert.equal(authChecks, 2, 'a deletion asks Auth itself, even for an accepted token');
        await identity(JWT_DELETED);
        assert.equal(authChecks, 3, 'and its token is not accepted again without asking');
      } finally {
        Date.now = realNow;
        revokedTokens.clear();
        failingTokens.clear();
      }
      console.log('PASS verified caller: a token Auth accepted is trusted by reads for at most a minute and never past its expiry, refusals and outages are asked again, writes, the wallet, the admin desk and deletion always ask');
    }

    console.log('Verified-caller contracts passed: a token acts for its own account whatever user_id says, admin by confirmed address or role, private caching by default, read limits, and one-time claims that fail closed.');
  } finally {
    for (const server of servers) {
      server.close();
      server.closeAllConnections();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
