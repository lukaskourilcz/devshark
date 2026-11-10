/* Learn integrity against a stand-in database.
 *
 * Runs the real `api/quiz/roadmap.ts` against a local stand-in that answers
 * the way PostgREST does for the learning tables and routines, with the
 * state kept in memory. It covers what only shows once a database answers:
 *
 *  - a Learn session answers only to the account it was issued to, so a
 *    level fetched without a token (the progression guard runs only for a
 *    signed-in request) cannot be answered and completed with one;
 *  - the progress a completion returns is the progress the GET returns,
 *    spaced-mastery fields included, because the browser replaces its copy
 *    with it;
 *  - a topic granted to an account opens its levels as the progress GET
 *    reports it open, and only once the account's address is confirmed;
 *  - a failed progress read answers 503 rather than refusing the level as if
 *    the learner had not earned it;
 *  - a coding task whose solution was revealed in the attempt does not
 *    complete the level;
 *  - a guest's level passes on its questions with its coding marked
 *    unverified, while an account's still waits for a recorded coding pass;
 *  - a part test already passed in a topic outside the learner's plan is
 *    served under `?test=` as it is under `?checkpoint=`;
 *  - a level lost on hearts counts for the streak once, and a database
 *    without the streak routine (before migration 048) does not fail it;
 *  - a replayed step that passes says what migration 060 paid: its XP again
 *    an hour after it last paid, as XP only (no coins, no referral), or when
 *    the XP opens again; a database before 060 completes it as before.
 *
 * Nothing leaves the machine. */

import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { learnCheckpointXp, learnLevelXp } from '../shared/progression';

const LEARNER = { id: '5a0e7c1e-2f7a-4c3d-9a61-5d2f0c9e8a41', email: 'learner@example.invalid', token: 'learn-contract-learner' };
const OTHER = { id: '9b1f3a2e-5b6d-4e8f-9a0b-1c2d3e4f5a6b', email: 'other@example.invalid', token: 'learn-contract-other' };
const OWNER = { id: '3c2d1e0f-6a7b-4c8d-9e0f-a1b2c3d4e5f6', email: 'owner@example.invalid', token: 'learn-contract-owner' };
const BROKEN = { id: '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d', email: 'broken@example.invalid', token: 'learn-contract-broken' };
// Someone who signed up with the owner's address and never confirmed it.
const OWNER_UNCONFIRMED = { id: '4e3d2c1b-7a8b-4c9d-8e0f-b1c2d3e4f5a6', email: OWNER.email, token: 'learn-contract-owner-unconfirmed', unconfirmed: true };
/** On the backend track, whose plan has no HTML. */
const BACKEND = {
  id: '2e4f6a8b-1c3d-4e5f-8a9b-0c1d2e3f4a5b', email: 'backend@example.invalid', token: 'learn-contract-backend',
  meta: { devquiz_learning_preference_v1: { schemaVersion: 1, baseTrack: 'backend', specialization: null } },
};
const HEARTS = { id: '6f5e4d3c-2b1a-4f0e-9d8c-7b6a5f4e3d2c', email: 'hearts@example.invalid', token: 'learn-contract-hearts' };
const REPEAT = { id: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d', email: 'repeat@example.invalid', token: 'learn-contract-repeat' };
/** A Premium account past the Big O introduction, for DSA level 3. */
const DSA = { id: '1d2c3b4a-5f6e-4d7c-8b9a-a0b1c2d3e4f5', email: 'dsa@example.invalid', token: 'learn-contract-dsa' };
const RECOVERY = { id: '9acd8fb2-b9c7-445f-a506-ad6fb5053d75', email: 'recovery@example.invalid', token: 'learn-contract-recovery' };
const USERS: Array<{ id: string; email: string; token: string; meta?: Record<string, unknown>; unconfirmed?: boolean }> = [LEARNER, OTHER, OWNER, BROKEN, OWNER_UNCONFIRMED, BACKEND, HEARTS, REPEAT, DSA, RECOVERY];
const PREMIUM = new Set([OWNER.id, DSA.id]);
const DAY = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  roadmap_progress: [],
  roadmap_attempts: [],
  roadmap_attempt_answers: [],
  roadmap_attempt_coding: [],
};
/** Every routine the handler called, with its arguments, in order. */
const rpcCalls: { name: string; args: Row }[] = [];
/** Every table the handler read, in order. */
const tableReads: string[] = [];
/** Answer advance_verified_streak as a database before migration 048 does. */
let streakRoutineMissing = false;
let atomicLearn = false;
let failAtomicLearn = false;
let atomicCoinCredits = 0;
/** Answer complete_verified_roadmap_attempt_v2 as a database before 060 does. */
let repeatRoutineMissing = false;
/** Hold the backend beyond the request's 5 s upstream deadline. */
let stallLearn = false;
/** Migration 060's user_learn_step_xp (when each step last paid, ms) and the
 * repeat awards it paid, by award id. */
const stepPaidAt = new Map<string, number>();
const repeatAwards = new Map<string, number>();

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = '';
  req.on('data', (chunk) => { text += chunk; });
  req.on('end', () => resolve(text));
});

/** `col=eq.value` filters, the only kind these handlers send. */
function filtersOf(url: URL): [string, string][] {
  return [...url.searchParams.entries()]
    .filter(([key, value]) => !['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key) && value.startsWith('eq.'))
    .map(([key, value]) => [key, value.slice(3)]);
}
const matches = (row: Row, filters: [string, string][]) => filters.every(([key, value]) => String(row[key]) === value);

/** The subset of record_roadmap_answer_v2 the handler relies on: open the
 * attempt on the first answer, refuse another account's attempt, keep the
 * first answer to each question. */
function recordAnswer(args: Row): { status: number; body: unknown } {
  let attempt = tables.roadmap_attempts.find((row) => row.attempt_id === args.p_attempt_id);
  if (!attempt) {
    attempt = {
      attempt_id: args.p_attempt_id, user_id: args.p_user_id ?? null, subject: args.p_subject, topic: args.p_topic,
      kind: args.p_kind, ref: args.p_ref, total_questions: args.p_total_questions, pass_pct: args.p_pass_pct,
      required_level_start: args.p_required_start ?? null, required_level_end: args.p_required_end ?? null, completed_at: null,
    };
    tables.roadmap_attempts.push(attempt);
  }
  if ((attempt.user_id ?? null) !== (args.p_user_id ?? null) || attempt.completed_at) {
    return { status: 400, body: { code: 'P0001', message: 'invalid_roadmap_attempt' } };
  }
  let answer = tables.roadmap_attempt_answers.find((row) => row.attempt_id === args.p_attempt_id && row.question_id === args.p_question_id);
  if (!answer) {
    answer = {
      attempt_id: args.p_attempt_id, question_id: args.p_question_id,
      selected_index: args.p_selected_index, correct_index: args.p_correct_index,
      is_correct: args.p_selected_index === args.p_correct_index,
    };
    tables.roadmap_attempt_answers.push(answer);
  }
  return { status: 200, body: { selectedIndex: answer.selected_index, correctAnswer: answer.correct_index, isCorrect: answer.is_correct } };
}

/** The subset of complete_verified_roadmap_attempt (migration 025) the
 * handler relies on, including the mastery fields it writes on a level. */
function completeAttempt(args: Row): { status: number; body: unknown } {
  const attempt = tables.roadmap_attempts.find((row) => row.attempt_id === args.p_attempt_id);
  if (!attempt || attempt.user_id !== args.p_user_id || (typeof attempt.expires_at === 'string' && Date.parse(attempt.expires_at) < Date.now())) {
    return { status: 400, body: { code: 'P0001', message: 'invalid_roadmap_attempt' } };
  }
  if (attempt.completed_at) return { status: 200, body: false };
  const answers = tables.roadmap_attempt_answers.filter((row) => row.attempt_id === attempt.attempt_id);
  if (answers.length !== attempt.total_questions) return { status: 400, body: { code: 'P0001', message: 'incomplete_roadmap_attempt' } };
  let row = tables.roadmap_progress.find((one) => one.user_id === args.p_user_id);
  if (!row) {
    row = { user_id: args.p_user_id, data: {}, extra: {} };
    tables.roadmap_progress.push(row);
  }
  const data = row.data as Record<string, { levels: Record<string, Row>; checkpoints: Record<string, Row> }>;
  const topic = String(attempt.topic);
  data[topic] ??= { levels: {}, checkpoints: {} };
  if (attempt.required_level_start != null) {
    for (let level = Number(attempt.required_level_start); level <= Number(attempt.required_level_end); level++) {
      if (data[topic].levels[String(level)]?.passed !== true) return { status: 400, body: { code: 'P0001', message: 'roadmap_prerequisite_not_met' } };
    }
  }
  const pct = Math.round((100 * answers.filter((one) => one.is_correct).length) / Number(attempt.total_questions));
  const passed = pct >= Number(attempt.pass_pct);
  attempt.completed_at = new Date().toISOString();
  attempt.passed = passed;
  const kind = attempt.kind === 'level' ? 'levels' : 'checkpoints';
  const existing = data[topic][kind][String(attempt.ref)] ?? {};
  const entry: Row = { passed: existing.passed === true || passed, bestPct: Math.max(Number(existing.bestPct ?? 0), pct) };
  if (kind === 'levels') {
    const today = DAY(0);
    const days = Array.isArray(existing.passDays) ? [...existing.passDays as string[]] : [];
    if (passed && !days.includes(today)) days.push(today);
    entry.passDays = days;
    entry.mastered = existing.mastered === true || days.length >= 3;
    if (passed) entry.lastPassDay = today;
    else if (existing.lastPassDay) entry.lastPassDay = existing.lastPassDay;
  }
  data[topic][kind][String(attempt.ref)] = entry;
  return { status: 200, body: true };
}

/** The subset of complete_verified_roadmap_attempt_v2 (migration 060) the
 * handler relies on: 056's completion, then a replay that passes pays the
 * step's XP again when the step last paid an hour ago or more. */
function completeAttemptV2(args: Row): { status: number; body: unknown } {
  const attempt = tables.roadmap_attempts.find((row) => row.attempt_id === args.p_attempt_id);
  const kind = attempt?.kind === 'level' ? 'levels' : 'checkpoints';
  const progress = tables.roadmap_progress.find((one) => one.user_id === args.p_user_id)?.data as Record<string, Record<string, Record<string, Row>>> | undefined;
  const wasPassed = progress?.[String(attempt?.topic)]?.[kind]?.[String(attempt?.ref)]?.passed === true;
  const done = completeAttempt(args);
  if (done.status !== 200) return done;
  if (done.body !== true) return { status: 200, body: { applied: false, passed: null, firstPass: false, repeatXp: null } };
  if (attempt!.passed !== true) return { status: 200, body: { applied: true, passed: false, firstPass: false, repeatXp: null } };
  const key = `${args.p_user_id}:${attempt!.topic}:${attempt!.kind}:${attempt!.ref}`;
  const xp = attempt!.kind === 'level' ? learnLevelXp(Number(attempt!.ref)) : learnCheckpointXp(Number(attempt!.ref));
  const now = Date.now();
  let paid = 0;
  let withheld: string | null = null;
  if (!wasPassed) stepPaidAt.set(key, now);
  else if (now - (stepPaidAt.get(key) ?? -Infinity) >= 60 * 60_000) {
    stepPaidAt.set(key, now);
    repeatAwards.set(`learn-repeat:${args.p_attempt_id}`, xp);
    paid = xp;
  } else withheld = 'cooldown';
  return {
    status: 200,
    body: { applied: true, passed: true, firstPass: !wasPassed, repeatXp: { xp: paid, availableAt: new Date(stepPaidAt.get(key)! + 60 * 60_000).toISOString(), withheld } },
  };
}

async function startStandIn() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stand-in');
    res.setHeader('content-type', 'application/json');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
      const user = USERS.find((one) => one.token === token);
      if (!user) return send(401, { message: 'invalid token' });
      return send(200, { id: user.id, email: user.email, ...(user.unconfirmed ? {} : { email_confirmed_at: '2026-09-01T00:00:00Z' }), aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: user.meta ?? {} });
    }
    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (rpc) {
      const raw = await readBody(req);
      const args = (raw ? JSON.parse(raw) : {}) as Row;
      rpcCalls.push({ name: rpc[1], args });
      if (rpc[1] === 'advance_verified_streak' && streakRoutineMissing) {
        return send(404, { code: 'PGRST202', message: 'Could not find the function public.advance_verified_streak(p_user_id) in the schema cache' });
      }
      if (stallLearn && rpc[1] === 'record_roadmap_answer_v2') {
        await new Promise((resolve) => setTimeout(resolve, 5500));
        return send(504, { message: 'late test fixture' });
      }
      if (rpc[1] === 'record_roadmap_answer_v2') { const out = recordAnswer(args); return send(out.status, out.body); }
      if (rpc[1] === 'complete_verified_roadmap_attempt') { const out = completeAttempt(args); return send(out.status, out.body); }
      if (rpc[1] === 'complete_verified_roadmap_attempt_v3' || rpc[1] === 'complete_roadmap_attempt_on_hearts') {
        if (!atomicLearn) return send(404, { code: 'PGRST202', message: 'Routine is missing from the schema cache' });
        if (failAtomicLearn) return send(500, { code: '42883', message: 'function public.fixture_failed_reward_write() does not exist' });
        if (rpc[1] === 'complete_roadmap_attempt_on_hearts') {
          const attempt = tables.roadmap_attempts.find(one => one.attempt_id === args.p_attempt_id)!;
          const applied = !attempt.completed_at;
          if (applied) Object.assign(attempt, { completed_at: new Date().toISOString(), passed: false, score_pct: 0 });
          return send(200, applied);
        }
        const out = completeAttemptV2(args);
        if ((out.body as Row | null)?.firstPass === true) atomicCoinCredits += 1;
        return send(out.status, out.body);
      }
      if (rpc[1] === 'complete_verified_roadmap_attempt_v2') {
        if (repeatRoutineMissing) {
          return send(404, { code: 'PGRST202', message: 'Could not find the function public.complete_verified_roadmap_attempt_v2(p_attempt_id, p_coding_task_ids, p_user_id) in the schema cache' });
        }
        const out = completeAttemptV2(args);
        return send(out.status, out.body);
      }
      if (rpc[1] === 'is_premium') return send(200, PREMIUM.has(String(args.p_user)));
      // Rewards, concept reviews: nothing to report.
      return send(200, null);
    }
    const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (table) {
      if (stallLearn && (table === 'roadmap_progress' || table === 'roadmap_attempts')) {
        await new Promise((resolve) => setTimeout(resolve, 5500));
        return send(504, { message: 'late test fixture' });
      }
      const filters = filtersOf(url);
      // A database blip for one account's progress row.
      if (table === 'roadmap_progress' && filters.some(([key, value]) => key === 'user_id' && value === BROKEN.id)) {
        return send(500, { code: '57014', message: 'canceling statement due to statement timeout' });
      }
      const rows = tables[table] ?? [];
      const single = String(req.headers.accept ?? '').includes('vnd.pgrst.object');
      if (req.method === 'GET') {
        tableReads.push(table);
        const found = rows.filter((row) => matches(row, filters));
        return single ? (found.length === 1 ? send(200, found[0]) : send(406, { code: 'PGRST116', message: 'no rows' })) : send(200, found);
      }
      if (req.method === 'PATCH') {
        const patch = JSON.parse(await readBody(req)) as Row;
        const found = rows.filter((row) => matches(row, filters));
        for (const row of found) Object.assign(row, patch);
        return send(200, found);
      }
      if (req.method === 'POST') {
        const inserted = JSON.parse(await readBody(req)) as Row | Row[];
        const list = Array.isArray(inserted) ? inserted : [inserted];
        rows.push(...list);
        return send(201, single ? list[0] : list);
      }
      return send(200, []);
    }
    send(404, { message: 'no route' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  // lib/http.ts and lib/auth.ts read these when they load, so they are set
  // before anything from the repository is imported.
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-learn-contract';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-learn-contract';
  process.env.OWNER_EMAIL = OWNER.email;
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
    headersSent: false,
    setHeader(key: string, value: string) { res.headers[key.toLowerCase()] = value; return res; },
    getHeader(key: string) { return res.headers[key.toLowerCase()]; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; res.headersSent = true; return res; },
    send(body: unknown) { res.body = body; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

async function main() {
  const server = await startStandIn();
  try {
    const [{ default: roadmap }, tokens, store] = await Promise.all([import('../api/quiz/roadmap'), import('../lib/quiz-tokens'), import('../lib/questions-store')]);
    let address = 0;
    const call = async (method: string, query: Record<string, string>, token?: string, body?: unknown) => {
      const res = mockResponse();
      address += 1;
      await roadmap({
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': `10.30.0.${address % 250}` },
        query,
        url: '/api/quiz/roadmap',
        body,
      } as never, res as never);
      return res;
    };
    const answerAll = async (sessionId: string, token?: string) => {
      const session = tokens.decodeSessionEnvelope(sessionId)!;
      const statuses: number[] = [];
      for (const question of session.questions) {
        const res = await call('POST', { resource: 'answer' }, token, { sessionId, questionId: question.questionId, selectedIndex: question.correctAnswer });
        statuses.push(res.statusCode);
      }
      return statuses;
    };

    // The Big O introduction opens before placement, but no later DSA step does.
    for (const level of ['1', '2']) {
      const intro = await call('GET', { topic: 'dsa', level }, LEARNER.token);
      assert.equal(intro.statusCode, 200, `free beginner Big O lesson ${level}: ${JSON.stringify(intro.body)}`);
    }
    const laterDsa = await call('GET', { topic: 'dsa', level: '3' }, LEARNER.token);
    assert.notEqual(laterDsa.statusCode, 200, 'the introduction must not unlock the rest of DSA');

    // ── A guest's session cannot be completed by an account ────────────────
    // JavaScript level 10 opens part two: a new account is refused it when it
    // asks with its token. Fetched without the token, the same level is served
    // as a preview; answering and completing it with the token must not record
    // it for the account.
    const attemptsBeforePreview = tables.roadmap_attempts.filter(row => row.user_id === LEARNER.id).length;
    const refused = await call('GET', { topic: 'javascript', level: '10' }, LEARNER.token);
    assert.equal(refused.statusCode, 403, 'a new account is refused a level it has not reached');
    const preview = await call('GET', { topic: 'javascript', level: '10' });
    assert.equal(preview.statusCode, 200, 'a guest is served the preview');
    const previewSession = preview.body.sessionId as string;
    const foreign = await answerAll(previewSession, LEARNER.token);
    assert.ok(foreign.every((status) => status === 409), `a guest session is not answered with a token (${foreign.join(',')})`);
    const foreignAnswer = await call('POST', { resource: 'answer' }, LEARNER.token, { sessionId: previewSession, questionId: tokens.decodeSessionEnvelope(previewSession)!.questions[0].questionId, selectedIndex: 0 });
    assert.equal(foreignAnswer.body?.error?.code, 'session_owner_mismatch', 'the refusal names why, so the client can restart the level');
    const foreignComplete = await call('POST', { resource: 'complete' }, LEARNER.token, { sessionId: previewSession });
    assert.equal(foreignComplete.statusCode, 409, 'a guest session is not completed with a token');
    assert.equal(foreignComplete.body?.error?.code, 'session_owner_mismatch');
    assert.equal(tables.roadmap_progress.find((row) => row.user_id === LEARNER.id), undefined, 'nothing was recorded for the account');
    assert.equal(tables.roadmap_attempts.filter((row) => row.user_id === LEARNER.id).length, attemptsBeforePreview, 'the guest preview opened no additional attempt for the account');
    // The coding tasks inside the level carry the same owner.
    const codingItem = (preview.body.coding ?? [])[0] as { session: string } | undefined;
    assert.ok(codingItem, 'JavaScript level 10 carries a coding task');
    assert.equal(tokens.decodeCodingSession(codingItem.session)?.userId, null, 'a guest level seals a guest coding session');

    // An account's session answers to that account alone: not to a guest (a
    // learner who signed out mid-level) and not to another account. This
    // fetch and the answer below also carry the stray `lang: 'cs'` an old
    // cached client may still send (#485): it is ignored, never refused, and
    // the copy served is English.
    const own = await call('GET', { topic: 'javascript', level: '1', lang: 'cs' }, LEARNER.token);
    assert.equal(own.statusCode, 200);
    const englishById = await store.getEffectiveQuestionsById('webdev');
    for (const served of own.body.questions as { id: string; question: string; options: string[] }[]) {
      const english = englishById.get(served.id)!;
      assert.equal(served.question, english.question, `${served.id} is served in English whatever lang says`);
      assert.deepEqual([...served.options].sort(), [...english.options].sort(), `${served.id} offers its English options`);
    }
    assert.equal(tokens.decodeSessionEnvelope(own.body.sessionId)?.userId, LEARNER.id, 'the session is sealed to the account');
    const ownCoding = (own.body.coding ?? [])[0] as { session: string } | undefined;
    assert.ok(ownCoding);
    const linked = tokens.decodeCodingSession(ownCoding.session)!;
    assert.ok(tables.roadmap_attempts.some(row => row.attempt_id === linked.roadmapAttemptId), 'the parent exists before the intro link is opened');
    const openedCoding = await call('POST', { resource: 'coding-task', id: linked.taskId }, LEARNER.token, { session: ownCoding.session });
    assert.equal(openedCoding.statusCode, 200, JSON.stringify(openedCoding.body));
    assert.equal(openedCoding.body.session, ownCoding.session, 'a new coding tab retains its original Learn session');
    const foreignCoding = await call('POST', { resource: 'coding-task', id: linked.taskId }, OTHER.token, { session: ownCoding.session });
    assert.equal(foreignCoding.statusCode, 409, 'a linked coding tab refuses a different owner');
    const wrongCoding = await call('POST', { resource: 'coding-task', id: 'js-sum-array' }, LEARNER.token, { session: ownCoding.session });
    assert.equal(wrongCoding.statusCode, 400, 'the link cannot change its task');
    const beforeStatus = JSON.stringify(tables);
    const status = await call('POST', { resource: 'attempt-status' }, LEARNER.token, { sessionId: own.body.sessionId });
    assert.equal(status.statusCode, 200, JSON.stringify(status.body));
    assert.equal(JSON.stringify(tables), beforeStatus, 'checking a Learn attempt changes no records');
    assert.ok(ownCoding, 'JavaScript level 1 carries a coding task');
    assert.equal(tokens.decodeCodingSession(ownCoding.session)?.userId, LEARNER.id, 'and so is its coding task');
    const firstQuestion = tokens.decodeSessionEnvelope(own.body.sessionId)!.questions[0];
    const signedOut = await call('POST', { resource: 'answer' }, undefined, { sessionId: own.body.sessionId, questionId: firstQuestion.questionId, selectedIndex: 0 });
    assert.equal(signedOut.statusCode, 409, 'a signed-in session is not answered after signing out');
    const otherAccount = await call('POST', { resource: 'answer' }, OTHER.token, { sessionId: own.body.sessionId, questionId: firstQuestion.questionId, selectedIndex: 0 });
    assert.equal(otherAccount.statusCode, 409, 'nor by another account');
    const ownAnswer = await call('POST', { resource: 'answer' }, LEARNER.token, { sessionId: own.body.sessionId, questionId: firstQuestion.questionId, selectedIndex: firstQuestion.correctAnswer, lang: 'cs' });
    assert.equal(ownAnswer.statusCode, 200, `the account itself answers (${JSON.stringify(ownAnswer.body)})`);
    assert.equal(ownAnswer.body.isCorrect, true);
    assert.equal(ownAnswer.body.explanation, englishById.get(firstQuestion.questionId)!.explanation, 'a stray lang still gets the English explanation');
    stallLearn = true;
    try {
      const stalled = await Promise.all([
        call('POST', { resource: 'answer' }, LEARNER.token, { sessionId: own.body.sessionId, questionId: firstQuestion.questionId, selectedIndex: firstQuestion.correctAnswer }),
        call('POST', { resource: 'complete' }, LEARNER.token, { sessionId: own.body.sessionId }),
        call('GET', { resource: 'progress' }, LEARNER.token),
      ]);
      assert.deepEqual(stalled.map((res) => [res.statusCode, res.body?.error?.code]), [
        [503, 'upstream_timeout'], [503, 'upstream_timeout'], [503, 'upstream_timeout'],
      ], 'Learn answers, completion and progress report retryable upstream timeouts');
    } finally {
      stallLearn = false;
    }
    // A guest keeps playing a guest session.
    const guestLevel = await call('GET', { topic: 'html', level: '1' });
    const guestStatuses = await answerAll(guestLevel.body.sessionId);
    assert.ok(guestStatuses.every((status) => status === 200), `a guest answers a guest session (${guestStatuses.join(',')})`);
    console.log('PASS learn: a session answers only to the account it was issued to');

    // ── The completion returns the progress the GET returns ────────────────
    // HTML level 1 is mastered and level 2 is due for its second pass. After
    // passing level 2 again, the progress in the completion response, which
    // the browser stores as its copy, must equal what the GET reads.
    tables.roadmap_progress.push({
      user_id: LEARNER.id,
      extra: {},
      data: {
        html: {
          checkpoints: {},
          levels: {
            '1': { passed: true, bestPct: 100, passDays: [DAY(9), DAY(6), DAY(2)], mastered: true, masteredAt: DAY(2), lastPassDay: DAY(2) },
            '2': { passed: true, bestPct: 88, passDays: [DAY(2)], mastered: false, lastPassDay: DAY(2) },
          },
        },
      },
    });
    const level2 = await call('GET', { topic: 'html', level: '2' }, LEARNER.token);
    assert.equal(level2.statusCode, 200, JSON.stringify(level2.body));
    assert.ok((await answerAll(level2.body.sessionId, LEARNER.token)).every((status) => status === 200));
    const completed = await call('POST', { resource: 'complete' }, LEARNER.token, { sessionId: level2.body.sessionId });
    assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
    assert.equal(completed.body.passed, true);
    const read = await call('GET', { resource: 'progress' }, LEARNER.token);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(completed.body.progress.html, read.body.data.html, 'the completion returns the stored progress, mastery included');
    assert.equal(completed.body.progress.html.levels['1'].mastered, true, 'a mastered level stays mastered');
    assert.deepEqual(completed.body.progress.html.levels['2'].passDays, [DAY(2), DAY(0)], 'the new passing day is kept');
    assert.equal(completed.body.progress.html.levels['2'].lastPassDay, DAY(0), 'so Today counts the level as done today');
    console.log('PASS learn: a completion returns the progress the GET returns, spaced mastery included');

    // ── A granted topic opens its levels ───────────────────────────────────
    const granted = await call('GET', { resource: 'progress' }, OWNER.token);
    assert.ok(granted.body.extra.unlocked.includes('system-design'), 'the progress GET reports the grant');
    const grantedLevel = await call('GET', { topic: 'system-design', level: '1' }, OWNER.token);
    assert.equal(grantedLevel.statusCode, 200, `a granted topic serves its first level (${JSON.stringify(grantedLevel.body?.error)})`);
    const notGranted = await call('GET', { topic: 'system-design', level: '1' }, OTHER.token);
    assert.equal(notGranted.body?.error?.code, 'topic_locked', 'an account without the grant is still refused');
    // The grant is keyed on the address, so an unconfirmed one gets nothing.
    const unconfirmed = await call('GET', { resource: 'progress' }, OWNER_UNCONFIRMED.token);
    assert.equal(unconfirmed.statusCode, 200, JSON.stringify(unconfirmed.body));
    assert.ok(!unconfirmed.body.extra.unlocked.includes('system-design'), 'an unconfirmed owner address is not granted the topic');
    const unconfirmedLevel = await call('GET', { topic: 'system-design', level: '1' }, OWNER_UNCONFIRMED.token);
    assert.equal(unconfirmedLevel.body?.error?.code, 'topic_locked', 'nor served its levels');
    console.log('PASS learn: a granted topic opens its levels');

    // ── A revealed coding task does not complete the level ─────────────────
    // Every answer right, the level's coding task passed, but its solution was
    // revealed in this attempt: the level is not passed and the task stays
    // pending, as complete_verified_roadmap_attempt records it from 047.
    for (const revealed of [true, false]) {
      const level = await call('GET', { topic: 'javascript', level: '1' }, OTHER.token);
      assert.equal(level.statusCode, 200, JSON.stringify(level.body));
      assert.ok((await answerAll(level.body.sessionId, OTHER.token)).every((status) => status === 200));
      const attemptId = tokens.decodeSessionEnvelope(level.body.sessionId)!.attemptId;
      const taskIds = (level.body.coding as Array<{ task: { id: string } }>).map((item) => item.task.id);
      assert.ok(taskIds.length > 0, 'JavaScript level 1 carries a coding task');
      for (const taskId of taskIds) tables.roadmap_attempt_coding.push({ attempt_id: attemptId, task_id: taskId, passed: true, verified: true, revealed });
      const done = await call('POST', { resource: 'complete' }, OTHER.token, { sessionId: level.body.sessionId });
      assert.equal(done.statusCode, 200, JSON.stringify(done.body));
      if (revealed) {
        assert.equal(done.body.passed, false, 'a level whose coding solution was revealed is not passed');
        assert.deepEqual(done.body.codingPending, taskIds, 'the revealed task is still pending');
      } else {
        assert.equal(done.body.passed, true, 'the same level passes when the task was solved without a reveal');
        assert.deepEqual(done.body.codingPending, []);
      }
    }
    console.log('PASS learn: a revealed coding task does not complete the level');

    // ── A guest's level passes on its questions ────────────────────────────
    // A guest's coding passes are never stored, so requiring them failed
    // every guest level with a coding task. The guest passes on the answers,
    // told the coding was not verified, and nothing is recorded for them. An
    // account without a recorded coding pass still waits for one.
    {
      const progressRows = tables.roadmap_progress.length;
      const guest = await call('GET', { topic: 'javascript', level: '1' });
      assert.equal(guest.statusCode, 200, JSON.stringify(guest.body));
      assert.ok((guest.body.coding ?? []).length > 0, 'JavaScript level 1 carries a coding task');
      assert.ok((await answerAll(guest.body.sessionId)).every((status) => status === 200));
      const guestDone = await call('POST', { resource: 'complete' }, undefined, { sessionId: guest.body.sessionId });
      assert.equal(guestDone.statusCode, 200, JSON.stringify(guestDone.body));
      assert.equal(guestDone.body.passed, true, 'a guest passes the level on its questions');
      assert.equal(guestDone.body.codingUnverified, true, 'and is told the coding was not verified');
      assert.deepEqual(guestDone.body.codingPending, []);
      assert.equal(guestDone.body.progress, undefined, 'no stored progress comes back for a guest');
      assert.equal(tables.roadmap_progress.length, progressRows, 'nothing is recorded for a guest');

      const signedIn = await call('GET', { topic: 'javascript', level: '1' }, LEARNER.token);
      assert.equal(signedIn.statusCode, 200, JSON.stringify(signedIn.body));
      assert.ok((await answerAll(signedIn.body.sessionId, LEARNER.token)).every((status) => status === 200));
      const taskIds = (signedIn.body.coding as Array<{ task: { id: string } }>).map((item) => item.task.id);
      const signedDone = await call('POST', { resource: 'complete' }, LEARNER.token, { sessionId: signedIn.body.sessionId });
      assert.equal(signedDone.statusCode, 200, JSON.stringify(signedDone.body));
      assert.equal(signedDone.body.passed, false, 'an account still needs a recorded coding pass');
      assert.deepEqual(signedDone.body.codingPending, taskIds);
      assert.equal(signedDone.body.waiting, true, 'an unrevealed pending task leaves the attempt open');
      assert.equal(tables.roadmap_attempts.find(row => row.attempt_id === tokens.decodeSessionEnvelope(signedIn.body.sessionId)!.attemptId)?.completed_at ?? null, null);
      assert.equal(signedDone.body.codingUnverified, undefined, 'an account is never told its coding went unverified');
    }
    console.log('PASS learn: a guest passes a level on its questions; an account still needs its coding pass');

    // ── A failed progress read is not a refusal ────────────────────────────
    const blip = await call('GET', { topic: 'javascript', level: '2' }, BROKEN.token);
    assert.equal(blip.statusCode, 503, `a progress read that fails answers 503 (${JSON.stringify(blip.body)})`);
    assert.equal(blip.body?.error?.code, 'progress_unavailable');
    console.log('PASS learn: a failed progress read answers 503, not "complete the preceding steps"');

    // ── A passed part test outside the plan is served on both names ────────
    // HTML is not on the backend track. The map draws a passed part test as
    // passed and opens it with `?test=`; that answered 403 not_in_plan while
    // `?checkpoint=`, the older name for the same test, served it.
    {
      const map = await call('GET', {});
      const htmlLevelCount = (map.body.structure.html.levels as unknown[]).length;
      assert.ok(htmlLevelCount > 3, 'HTML has levels to pass');
      // Every HTML level passed but the last, and the first part test.
      const htmlLevels = Object.fromEntries(Array.from({ length: htmlLevelCount - 1 }, (_, i) => [String(i + 1), { passed: true, bestPct: 100 }]));
      tables.roadmap_progress.push({
        user_id: BACKEND.id,
        extra: {},
        data: { html: { levels: htmlLevels, checkpoints: { '1': { passed: true, bestPct: 95 } } } },
      });
      const viaTest = await call('GET', { topic: 'html', test: '1' }, BACKEND.token);
      assert.equal(viaTest.statusCode, 200, `a passed part test outside the plan is served under ?test= (${JSON.stringify(viaTest.body?.error)})`);
      assert.equal(viaTest.body.kind, 'checkpoint');
      assert.equal(viaTest.body.ref, 1);
      const viaCheckpoint = await call('GET', { topic: 'html', checkpoint: '1' }, BACKEND.token);
      assert.equal(viaCheckpoint.statusCode, 200, 'and still under ?checkpoint=');
      const notPassed = await call('GET', { topic: 'html', test: '2' }, BACKEND.token);
      assert.equal(notPassed.statusCode, 403, 'a part test never passed outside the plan is still refused');
      assert.equal(notPassed.body?.error?.code, 'not_in_plan');
      const nextLevel = await call('GET', { topic: 'html', level: String(htmlLevelCount) }, BACKEND.token);
      assert.equal(nextLevel.body?.error?.code, 'not_in_plan', 'as is a level never passed');
    }
    console.log('PASS learn: a passed part test outside the plan is served under ?test= and ?checkpoint=');

    // ── A level lost on hearts counts for the streak ───────────────────────
    // Three wrong answers end a level before every question is answered. The
    // handler closes that attempt itself, without the completion routine that
    // advances the streak for a passed or failed level, so it advances it.
    const loseOnHearts = async () => {
      const level = await call('GET', { topic: 'javascript', level: '1' }, HEARTS.token);
      assert.equal(level.statusCode, 200, JSON.stringify(level.body));
      const session = tokens.decodeSessionEnvelope(level.body.sessionId)!;
      for (const question of session.questions.slice(0, 3)) {
        const options = (level.body.questions as Array<{ id: string; options: string[] }>).find((one) => one.id === question.questionId)!.options.length;
        const wrong = await call('POST', { resource: 'answer' }, HEARTS.token, { sessionId: level.body.sessionId, questionId: question.questionId, selectedIndex: (question.correctAnswer + 1) % options });
        assert.equal(wrong.statusCode, 200, JSON.stringify(wrong.body));
        assert.equal(wrong.body.isCorrect, false);
      }
      rpcCalls.length = 0;
      const done = await call('POST', { resource: 'complete' }, HEARTS.token, { sessionId: level.body.sessionId });
      assert.equal(done.statusCode, 200, JSON.stringify(done.body));
      assert.equal(done.body.passed, false, 'a level lost on hearts is not passed');
      assert.equal(done.body.applied, true, 'and this request closed it');
      return level.body.sessionId as string;
    };
    {
      const sessionId = await loseOnHearts();
      assert.equal(rpcCalls.some((one) => one.name === 'complete_verified_roadmap_attempt'), false, 'the attempt is closed by the handler, not the completion routine');
      const streaks = rpcCalls.filter((one) => one.name === 'advance_verified_streak');
      assert.equal(streaks.length, 1, `the streak routine runs once (${JSON.stringify(rpcCalls.map((one) => one.name))})`);
      assert.deepEqual(streaks[0].args, { p_user_id: HEARTS.id }, 'for the learner who lost the level');
      // A retried completion finds the attempt closed and counts nothing again.
      rpcCalls.length = 0;
      const again = await call('POST', { resource: 'complete' }, HEARTS.token, { sessionId });
      assert.equal(again.statusCode, 200, JSON.stringify(again.body));
      assert.equal(again.body.applied, false);
      assert.equal(rpcCalls.some((one) => one.name === 'advance_verified_streak'), false, 'a retried completion does not count the day again');
      // A guest's level lost on hearts has no streak to count.
      const guest = await call('GET', { topic: 'javascript', level: '1' });
      const guestSession = tokens.decodeSessionEnvelope(guest.body.sessionId)!;
      for (const question of guestSession.questions.slice(0, 3)) {
        const options = (guest.body.questions as Array<{ id: string; options: string[] }>).find((one) => one.id === question.questionId)!.options.length;
        await call('POST', { resource: 'answer' }, undefined, { sessionId: guest.body.sessionId, questionId: question.questionId, selectedIndex: (question.correctAnswer + 1) % options });
      }
      rpcCalls.length = 0;
      const guestDone = await call('POST', { resource: 'complete' }, undefined, { sessionId: guest.body.sessionId });
      assert.equal(guestDone.statusCode, 200, JSON.stringify(guestDone.body));
      assert.equal(rpcCalls.some((one) => one.name === 'advance_verified_streak'), false, 'a guest has no streak');
      // Before migration 048 the routine is missing: the level still closes.
      streakRoutineMissing = true;
      try {
        await loseOnHearts();
        assert.equal(rpcCalls.filter((one) => one.name === 'advance_verified_streak').length, 1, 'the routine was asked');
      } finally {
        streakRoutineMissing = false;
      }
    }
    console.log('PASS learn: a level lost on hearts counts for the streak once, and closes without the routine');

    // A failed atomic reward remains retryable and does not run a legacy
    // routine after an installed entrypoint failed inside its transaction.
    {
      atomicLearn = true;
      try {
        const level = await call('GET', { topic: 'html', level: '1' }, RECOVERY.token);
        assert.equal(level.statusCode, 200);
        const sessionId = level.body.sessionId as string;
        assert.ok((await answerAll(sessionId, RECOVERY.token)).every(status => status === 200));
        rpcCalls.length = 0;
        failAtomicLearn = true;
        const failed = await call('POST', { resource: 'complete' }, RECOVERY.token, { sessionId });
        assert.equal(failed.statusCode, 503);
        assert.equal(failed.body.error.code, 'progress_unavailable');
        assert.equal(rpcCalls.some(one => one.name === 'complete_verified_roadmap_attempt_v2'), false, 'a broken helper is not a missing entrypoint');
        failAtomicLearn = false;
        const recovered = await call('POST', { resource: 'complete' }, RECOVERY.token, { sessionId });
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body.applied, true);
        assert.equal(atomicCoinCredits, 1);
        const replay = await call('POST', { resource: 'complete' }, RECOVERY.token, { sessionId });
        assert.equal(replay.body.applied, false);
        assert.equal(atomicCoinCredits, 1);
        assert.equal(rpcCalls.some(one => one.name === 'credit_verified_xp_tokens'), false, 'the reward ran inside completion');

        await loseOnHearts();
        assert.ok(rpcCalls.some(one => one.name === 'complete_roadmap_attempt_on_hearts'), 'the server closes the last heart with the streak');
        assert.equal(rpcCalls.some(one => one.name === 'advance_verified_streak'), false, 'no separate streak write');
      } finally {
        atomicLearn = false;
        failAtomicLearn = false;
      }
    }

    // ── A replayed step pays its XP again after an hour ────────────────────
    // Migration 060: a pass of a step already passed pays the step's XP
    // again when it last paid an hour ago or more, as XP only. The response
    // says what it paid, or when the XP opens again, for the toast.
    {
      const playLevel = async (correct: boolean) => {
        const level = await call('GET', { topic: 'html', level: '1' }, REPEAT.token);
        assert.equal(level.statusCode, 200, JSON.stringify(level.body));
        const session = tokens.decodeSessionEnvelope(level.body.sessionId)!;
        for (const question of session.questions) {
          const options = (level.body.questions as Array<{ id: string; options: string[] }>).find((one) => one.id === question.questionId)!.options.length;
          const answer = await call('POST', { resource: 'answer' }, REPEAT.token, {
            sessionId: level.body.sessionId, questionId: question.questionId,
            selectedIndex: correct ? question.correctAnswer : (question.correctAnswer + 1) % options,
          });
          if (answer.statusCode !== 200) break; // out of hearts
        }
        rpcCalls.length = 0;
        tableReads.length = 0;
        const done = await call('POST', { resource: 'complete' }, REPEAT.token, { sessionId: level.body.sessionId });
        assert.equal(done.statusCode, 200, JSON.stringify(done.body));
        return done;
      };
      const credits = () => rpcCalls.filter((one) => one.name === 'credit_verified_xp_tokens' || one.name === 'credit_referral');
      const xp = learnLevelXp(1);

      const first = await playLevel(true);
      assert.equal(first.body.passed, true);
      assert.equal(first.body.repeatXp?.xp, 0, 'a first pass pays learning XP, not repeat XP');
      assert.equal(first.body.repeatXp?.withheld, null);
      assert.ok(credits().some((one) => one.name === 'credit_verified_xp_tokens'), 'a first pass credits its coins');
      assert.equal(tableReads.filter((table) => table === 'roadmap_progress').length, 1,
        `060 says it was the first pass, so the progress row is read once, after the completion (${tableReads.join(', ')})`);
      assert.equal(tableReads.includes('concept_reviews'), false, 'an HTML level names no concept, so no review state is read');

      const soon = await playLevel(true);
      assert.equal(soon.body.passed, true);
      assert.deepEqual({ xp: soon.body.repeatXp?.xp, withheld: soon.body.repeatXp?.withheld }, { xp: 0, withheld: 'cooldown' }, 'a replay inside the hour pays nothing');
      assert.ok(Math.abs(Date.parse(soon.body.repeatXp.availableAt) - Date.now() - 60 * 60_000) < 60_000, `and says the XP opens an hour after the first pass (${soon.body.repeatXp.availableAt})`);
      assert.deepEqual(credits(), [], 'and credits nothing');

      for (const key of stepPaidAt.keys()) if (key.startsWith(REPEAT.id)) stepPaidAt.set(key, Date.now() - 60 * 60_000);
      const later = await playLevel(true);
      assert.deepEqual({ xp: later.body.repeatXp?.xp, withheld: later.body.repeatXp?.withheld }, { xp, withheld: null }, `an hour later the level pays its ${xp} XP again`);
      const paidAttempt = String(rpcCalls.find((one) => one.name === 'complete_verified_roadmap_attempt_v2')?.args.p_attempt_id);
      assert.equal(repeatAwards.get(`learn-repeat:${paidAttempt}`), xp, 'under the attempt\'s own award');
      assert.deepEqual(credits(), [], 'as XP only: no coins and no referral');

      for (const key of stepPaidAt.keys()) if (key.startsWith(REPEAT.id)) stepPaidAt.set(key, Date.now() - 2 * 60 * 60_000);
      const failed = await playLevel(false);
      assert.equal(failed.body.passed, false);
      assert.equal(failed.body.repeatXp, undefined, 'a failed replay says nothing about repeat XP');

      // Before 060 the routine of 056 completes the replay as before.
      repeatRoutineMissing = true;
      try {
        const old = await playLevel(true);
        assert.equal(old.body.applied, true, 'a database before 060 still records the replay');
        assert.equal(old.body.passed, true);
        assert.equal(old.body.repeatXp, undefined, 'and says nothing about repeat XP');
        const names = rpcCalls.map((one) => one.name);
        assert.ok(names.indexOf('complete_verified_roadmap_attempt_v2') >= 0 && names.indexOf('complete_verified_roadmap_attempt') > names.indexOf('complete_verified_roadmap_attempt_v2'),
          `the handler asked 060's routine, then 056's (${names.join(', ')})`);
      } finally {
        repeatRoutineMissing = false;
      }
    }
    console.log('PASS learn: a replayed step pays its XP again after an hour, as XP only, and says when it opens');
    // ── DSA level 3 seals its coding task (#493) ──────────────────────────
    // The retired DSA path's exercises fill the DSA levels through the same parent
    // attempt as JavaScript: the level seals the task, stores the attempt with
    // that task list before the intro is served, and hands back a coding
    // session bound to the attempt, which the coding resource accepts.
    {
      tables.roadmap_progress.push({ user_id: DSA.id, extra: { unlocked: ['dsa'] }, data: { dsa: { levels: { '1': { passed: true, bestPct: 100 }, '2': { passed: true, bestPct: 100 } }, checkpoints: {} } } });
      const level = await call('GET', { topic: 'dsa', level: '3' }, DSA.token);
      assert.equal(level.statusCode, 200, `DSA level 3 opens past the introduction: ${JSON.stringify(level.body?.error)}`);
      const coding = level.body.coding as Array<{ task: { id: string; topic?: string; tests?: unknown[] }; session: string }>;
      assert.deepEqual(coding.map((item) => item.task.id), ['alg-dsa-reverse-in-place'], 'DSA level 3 seals the reverse-in-place task');
      assert.equal(coding[0].task.topic, 'dsa', 'the sealed task carries its DSA topic');
      const attemptId = tokens.decodeSessionEnvelope(level.body.sessionId)!.attemptId;
      const attempt = tables.roadmap_attempts.find((row) => row.attempt_id === attemptId);
      assert.ok(attempt, 'the parent attempt is stored before the intro is served');
      assert.deepEqual(attempt!.coding_task_ids, ['alg-dsa-reverse-in-place'], 'with the sealed task list');
      const session = tokens.decodeCodingSession(coding[0].session);
      assert.equal(session?.roadmapAttemptId, attemptId, 'the coding session is bound to the level attempt');
      assert.equal(session?.taskId, 'alg-dsa-reverse-in-place');
      const opened = await call('POST', { resource: 'coding-task', id: 'alg-dsa-reverse-in-place' }, DSA.token, { session: coding[0].session });
      assert.equal(opened.statusCode, 200, `the coding resource opens the linked task: ${JSON.stringify(opened.body?.error)}`);
      assert.equal(opened.body.task.id, 'alg-dsa-reverse-in-place');
      // The aligned Foundations introduction now seals its coding task too.
      const intro = await call('GET', { topic: 'dsa', level: '1' });
      assert.equal(intro.statusCode, 200, JSON.stringify(intro.body?.error));
      assert.deepEqual((intro.body.coding ?? []).map((item: { task: { id: string } }) => item.task.id), ['alg-dsa-sum-of-evens'], 'DSA level 1 seals its aligned single-pass task');
    }
    console.log('PASS learn: DSA level 3 seals its coding task into the parent attempt and the coding resource opens it');

    // A direct visit to the public guide's second intro must be completable,
    // rather than open successfully and then fail its SQL prerequisite.
    const bigO=await call('GET',{topic:'dsa',level:'2'},OTHER.token);
    assert.equal(bigO.statusCode,200,JSON.stringify(bigO.body));
    const bigOCoding = bigO.body.coding as Array<{ task: { id: string }; session: string }>;
    assert.deepEqual(bigOCoding.map(item => item.task.id), ['alg-dsa-halving-steps'], 'the second introductory level seals repeated halving');
    const freeCoding = await call('POST', { resource: 'coding-task', id: bigOCoding[0].task.id }, OTHER.token, { session: bigOCoding[0].session });
    assert.equal(freeCoding.statusCode, 200, 'a free account opens coding sealed to its free Learn level');
    assert.ok((await answerAll(bigO.body.sessionId,OTHER.token)).every(status=>status===200));
    const bigOPending = await call('POST', { resource: 'complete' }, OTHER.token, { sessionId: bigO.body.sessionId });
    assert.equal(bigOPending.body.passed, false, 'answering the questions alone leaves the coding pending');
    assert.deepEqual(bigOPending.body.codingPending, ['alg-dsa-halving-steps']);
    const bigOAttempt = tokens.decodeSessionEnvelope(bigO.body.sessionId)!.attemptId;
    tables.roadmap_attempt_coding.push({ attempt_id: bigOAttempt, task_id: bigOCoding[0].task.id, passed: true, verified: true, revealed: false });
    const bigODone=await call('POST',{resource:'complete'},OTHER.token,{sessionId:bigO.body.sessionId});
    assert.equal(bigODone.statusCode,200,JSON.stringify(bigODone.body));
    assert.equal(bigODone.body.passed,true,'a free beginner completes Big O without DSA level one or placement');
    console.log('PASS learn: Big O level two can be completed directly without placement or an earlier DSA level');

    // ── An attempt past its two hours answers 409, not 500 ──────────────────
    // The completion routine raises invalid_roadmap_attempt for an attempt
    // that ran out; the learner restarts the level, so the answer says so in
    // the code the client already reads as expired.
    {
      const level = await call('GET', { topic: 'html', level: '1' }, OTHER.token);
      assert.equal(level.statusCode, 200, JSON.stringify(level.body));
      assert.ok((await answerAll(level.body.sessionId, OTHER.token)).every((status) => status === 200));
      const attemptId = tokens.decodeSessionEnvelope(level.body.sessionId)!.attemptId;
      const attempt = tables.roadmap_attempts.find((row) => row.attempt_id === attemptId)!;
      attempt.expires_at = new Date(Date.now() - 60_000).toISOString();
      const expired = await call('POST', { resource: 'complete' }, OTHER.token, { sessionId: level.body.sessionId });
      assert.equal(expired.statusCode, 409, `an expired attempt is refused as expired (${JSON.stringify(expired.body)})`);
      assert.equal(expired.body?.error?.code, 'invalid_session');
    }
    console.log('PASS learn: a completion of an expired attempt answers 409 invalid_session');

    // ── A lapsed plan whose progress cannot be read ────────────────────────
    // A Premium level sealed while the account was Premium, answered after
    // the plan lapsed. The gate keeps a passed level open for review, so when
    // the progress row cannot be read it cannot say "not passed": 503
    // entitlement_unavailable, as lib/access.ts answers, never the 402
    // upgrade sheet for a level the learner may have passed.
    {
      const [{ contentTier, FREE_LEARN_LEVELS }, { serverContentIndex }] = await Promise.all([import('../shared/tiers'), import('../lib/access')]);
      // The first React level past the free ones.
      const premiumLevel = { topic: 'react', level: Number(FREE_LEARN_LEVELS.react) + 1 };
      assert.equal(contentTier({ kind: 'learn-level', ...premiumLevel }, serverContentIndex()), 'premium', 'React has a Premium level');
      const sealFor = (userId: string) => tokens.encodeSession([{ questionId: 'lapsed-plan-question', correctAnswer: 0 }], {
        scope: 'roadmap', subject: 'webdev', topic: premiumLevel.topic, roadmapKind: 'level', ref: premiumLevel.level, userId,
      });
      const broken = sealFor(BROKEN.id);
      const unread = await call('POST', { resource: 'answer' }, BROKEN.token, { sessionId: broken, questionId: 'lapsed-plan-question', selectedIndex: 0 });
      assert.deepEqual([unread.statusCode, unread.body?.error?.code], [503, 'entitlement_unavailable'], `an unreadable progress row is not "never passed" (${JSON.stringify(unread.body)})`);
      const unreadDone = await call('POST', { resource: 'complete' }, BROKEN.token, { sessionId: broken });
      assert.deepEqual([unreadDone.statusCode, unreadDone.body?.error?.code], [503, 'entitlement_unavailable'], `nor when the level is completed (${JSON.stringify(unreadDone.body)})`);
      const fresh = await call('POST', { resource: 'answer' }, OTHER.token, { sessionId: sealFor(OTHER.id), questionId: 'lapsed-plan-question', selectedIndex: 0 });
      assert.deepEqual([fresh.statusCode, fresh.body?.error?.code], [402, 'premium_required'], `a Premium level never passed is still refused with 402 (${JSON.stringify(fresh.body)})`);
    }
    console.log('PASS learn: a lapsed plan whose progress cannot be read answers 503 entitlement_unavailable, not 402');
  } finally {
    server.close();
  }
  console.log('Learn integrity passed against a stand-in database.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
