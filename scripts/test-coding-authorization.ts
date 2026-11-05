// First: no exported Supabase project may verify the stand-in tokens below.
import './launch-test-env';
import { createCodingSession as encodeCodingSession } from '../lib/coding/session';
import assert from 'node:assert/strict';
import { handleCodingDraft, handleCodingProgress, handleCodingSubmit, handleCodingReveal, handleCodingTask, JAVASCRIPT_LEVELS_SELECT } from '../lib/coding/handlers';
import { requestMemo, withRequestContext } from '../lib/http';
import { handleCodingBookmarks, canSaveCodingTask } from '../lib/coding/practice-handlers';
import { CODING_TASKS } from '../lib/coding/catalog';
import { codingTaskById } from '../lib/coding/active';
import { codingContent, contentTier } from '../shared/tiers';
import { serverContentIndex } from '../lib/access';

const solved = 'const double=ns=>ns.map(n=>n*2)';

function response() {
  return {statusCode:200,body:null as unknown,setHeader(){},status(code:number){this.statusCode=code;return this;},json(body:unknown){this.body=body;return this;}};
}

// Without Supabase configured, a request with a Bearer token is the account its
// user_id names (lib/auth.ts's local fallback); without one it is a guest.
function request(session: string, account: string | null) {
  const signedIn = account ? { headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: account } } : { headers: {}, query: {} };
  return { method: 'POST', ...signedIn, body: { session, code: solved, hintsUsed: 20, ...(account ? { user_id: account } : {}) } };
}

const errorCode = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code;

async function main() {
  const accountA = encodeCodingSession({taskId:'js-double-numbers',track:'javascript',userId:'account-a'});
  const linkedA = encodeCodingSession({taskId:'js-double-numbers',track:'javascript',userId:'account-a',roadmapAttemptId:'account-a-attempt-0123456789'});
  for (const [name, handler] of [['submit', handleCodingSubmit], ['reveal', handleCodingReveal]] as const) {
    // A guest holding account A's session.
    const guest = response();
    await handler(request(accountA, null) as never, guest as never, null);
    assert.equal(guest.statusCode, 403, `${name}: a guest is refused another account's session before grading or database access`);
    assert.equal(errorCode(guest.body), 'invalid_session');

    // Account B, signed in, holding account A's session.
    const other = response();
    await handler(request(accountA, 'account-b') as never, other as never, null);
    assert.equal(other.statusCode, 403, `${name}: signed-in account B is refused account A's session`);
    assert.equal(errorCode(other.body), 'invalid_session');
    assert.ok(!JSON.stringify(other.body).includes('map(n'), `${name}: the refusal carries no solution`);
  }

  // Account A with its own session passes the ownership check: the reveal
  // answers with the solution, and the submit is graded and only then stops at
  // the missing database.
  const ownReveal = response();
  await handleCodingReveal(request(accountA, 'account-a') as never, ownReveal as never, null);
  assert.equal(ownReveal.statusCode, 200, 'the owner may reveal after the hint ladder');
  assert.ok((ownReveal.body as { solution?: string }).solution, 'the owner gets the solution');
  const ownSubmit = response();
  await handleCodingSubmit(request(accountA, 'account-a') as never, ownSubmit as never, null);
  assert.notEqual(errorCode(ownSubmit.body), 'invalid_session', 'the owner is not refused its own session');
  assert.equal(errorCode(ownSubmit.body), 'not_configured', 'the owner\'s submit reaches the progress write');
  const missingParent=response();
  await handleCodingReveal(request(linkedA,'account-a') as never,missingParent as never,null);
  assert.equal(missingParent.statusCode,503,'a Learn-linked reveal requires a readable parent attempt');
  assert.ok(!(missingParent.body as {solution?:string}).solution,'no reference is revealed before the linked parent is verified');

  console.log('Coding account-bound submit and reveal authorization passed: guests and other signed-in accounts are refused, the owner is not.');

  // The level attempt ends after the link check (completed in another tab, or
  // expired): the routine re-checks it under its lock and raises. That is the
  // ended link the learner reopens, 409 invalid_session, not a 500.
  const endedLink = {
    from: () => {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain,
        maybeSingle: async () => ({ data: { user_id: 'account-a', completed_at: null, expires_at: new Date(Date.now() + 600_000).toISOString(), coding_task_ids: ['js-double-numbers'] }, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
    rpc: async () => ({ data: null, error: { code: 'P0001', message: 'invalid_roadmap_attempt' } }),
  };
  const endedSubmit = response();
  await handleCodingSubmit({ ...request(linkedA, 'account-a'), headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '203.0.113.71' } } as never, endedSubmit as never, endedLink as never);
  assert.deepEqual([endedSubmit.statusCode, errorCode(endedSubmit.body)], [409, 'invalid_session'], `a verdict for an attempt that ended mid-submit is an ended link (${JSON.stringify(endedSubmit.body)})`);
  const endedReveal = response();
  await handleCodingReveal(request(linkedA, 'account-a') as never, endedReveal as never, endedLink as never);
  assert.deepEqual([endedReveal.statusCode, errorCode(endedReveal.body)], [409, 'invalid_session'], `a reveal for an attempt that ended mid-request is an ended link (${JSON.stringify(endedReveal.body)})`);
  assert.ok(!(endedReveal.body as { solution?: string }).solution, 'an ended link reveals nothing');
  console.log('Coding Learn link ended mid-submit and mid-reveal passed: 409 invalid_session, not 500.');

  // #493: a Learn-linked DSA session is gated as the DSA level it belongs to.
  // DSA level 6 is Premium, so a guest and a free account are refused with
  // the shared 402 before anything is graded; DSA level 1 is free, so a
  // linked session there passes the tier gate and stops at the missing
  // parent attempt instead.
  for (const account of [null, 'account-free'] as const) {
    const linked = encodeCodingSession({ taskId: 'alg-dsa-stack', track: 'algorithms', userId: account, roadmapAttemptId: 'dsa-level-six-attempt-012345' });
    const refused = response();
    await handleCodingSubmit({ ...request(linked, account), body: { session: linked, code: 'const createStack = () => ({});', hintsUsed: 0 } } as never, refused as never, null);
    assert.equal(refused.statusCode, 402, `${account ?? 'a guest'}: a DSA level 6 task is Premium (${JSON.stringify(refused.body)})`);
    assert.equal(errorCode(refused.body), 'premium_required');
    assert.equal((refused.body as { error?: { ref?: string } }).error?.ref, 'dsa:6', 'the refusal names the DSA level');
  }
  const linkedFree = encodeCodingSession({ taskId: 'alg-dsa-sum-of-evens', track: 'algorithms', userId: null, roadmapAttemptId: 'dsa-level-one-attempt-01234' });
  const openLevel = response();
  await handleCodingSubmit({ ...request(linkedFree, null), body: { session: linkedFree, code: 'const sumOfEvens = values => 0;', hintsUsed: 0 } } as never, openLevel as never, null);
  assert.notEqual(openLevel.statusCode, 402, `a guest's DSA level 1 session passes the tier gate (${JSON.stringify(openLevel.body)})`);
  const thirdFree = encodeCodingSession({ taskId: 'alg-dsa-reverse-in-place', track: 'algorithms', userId: null, roadmapAttemptId: 'dsa-level-three-attempt-0123' });
  const openThird = response();
  await handleCodingSubmit({ ...request(thirdFree, null), body: { session: thirdFree, code: 'const reverseInPlace = values => values.reverse();', hintsUsed: 0 } } as never, openThird as never, null);
  assert.notEqual(openThird.statusCode, 402, 'the aligned third-level task uses the free Learn tier rather than its standalone Coding tier');
  console.log('Coding Learn-linked DSA sessions passed: level 6 is refused to guests and free accounts as dsa:6, level 1 passes the tier gate.');

  // A task opens with the account's own draft and the time it was saved, so
  // the browser can open the newer of it and the copy on the device (C5-4).
  // Another account's draft is never read.
  const drafts: Record<string, { code: string; updated_at: string }> = {
    'account-a:js-double-numbers': { code: 'const double = (ns) => ns;', updated_at: '2026-10-09T10:00:00.000Z' },
  };
  const database = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { filters[column] = value; return chain; },
        maybeSingle: async () => ({ data: table === 'coding_drafts' ? drafts[`${filters.user_id}:${filters.task_id}`] ?? null : null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
  const open = async (account: string) => {
    const out = response();
    await handleCodingTask({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { id: 'js-double-numbers', user_id: account } } as never, out as never, database as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body as { draft: string | null; draftUpdatedAt?: string | null };
  };
  const own = await open('account-a');
  assert.equal(own.draft, 'const double = (ns) => ns;');
  assert.equal(own.draftUpdatedAt, '2026-10-09T10:00:00.000Z', 'the draft comes with the time it was saved');
  // The cleared Learn levels open JavaScript tier 3. A roadmap row that cannot
  // be read is an error, not "no levels cleared": that answered 200 with the
  // task locked and no session for a learner who had opened it.
  {
    const unreadable = {
      from: (table: string) => {
        const chain = {
          select: () => chain, eq: () => chain,
          maybeSingle: async () => (table === 'roadmap_progress' ? { data: null, error: { code: '57014', message: 'statement timeout' } } : { data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    };
    const out = response();
    const logged: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      await handleCodingTask({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { id: 'js-double-numbers', user_id: 'account-a' } } as never, out as never, unreadable as never);
    } finally { console.log = log; }
    assert.deepEqual([out.statusCode, errorCode(out.body)], [500, 'db_error'], `an unreadable roadmap row is not read as no cleared levels (${JSON.stringify(out.body)})`);
    assert.ok(logged.some((line) => line.includes('"kind":"task_progress_unavailable"')), 'the failed read is logged, not only answered');
  }
  // An account draft that cannot be read is not "no draft": answered as none,
  // the page opened the starter over the account's saved code.
  {
    const unreadableDraft = {
      from: (table: string) => {
        const chain = {
          select: () => chain, eq: () => chain,
          maybeSingle: async () => (table === 'coding_drafts' ? { data: null, error: { code: '57014', message: 'statement timeout' } } : { data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
        };
        return chain;
      },
    };
    const out = response();
    const logged: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
    try {
      await handleCodingTask({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { id: 'js-double-numbers', user_id: 'account-a' } } as never, out as never, unreadableDraft as never);
    } finally { console.log = log; }
    assert.deepEqual([out.statusCode, errorCode(out.body)], [500, 'db_error'], `an unreadable draft is not answered as no draft (${JSON.stringify(out.body)})`);
    assert.ok(logged.some((line) => line.includes('"reason":"draft_unavailable"')), 'the failed draft read is logged');
  }
  // #587 server item 9: the task page reads the account's passed ids and this
  // task's own row, not every coding_progress row in full, and only the
  // JavaScript levels of the roadmap row, not the whole blob. The answer is
  // the same: ten cleared Learn levels open JavaScript tier 3, this task's
  // progress comes back, and a passed task counts for the ladder.
  {
    const tierThree = CODING_TASKS.find((task) => codingTaskById(task.id) && task.track === 'javascript' && task.tier === 3 && !task.id.includes('evolving')
      && contentTier(codingContent(task.id), serverContentIndex()) === 'free')
      ?? CODING_TASKS.find((task) => codingTaskById(task.id) && task.track === 'javascript' && task.tier === 3 && !task.id.includes('evolving'))!;
    const levels = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), { passed: true }]));
    type Read = { table: string; columns: string; filters: Record<string, unknown>; single: boolean };
    const reads: Read[] = [];
    const ownRow = { task_id: tierThree.id, track: 'javascript', status: 'in_progress', passes: 0, review_stage: 0, next_review_at: null, reveal_count: 2, best_passed_at: null, updated_at: '2026-11-03T17:00:00Z' };
    const progressDb = {
      from: (table: string) => {
        const read: Read = { table, columns: '', filters: {}, single: false };
        const chain = {
          select: (columns: string) => { read.columns = columns; return chain; },
          eq: (column: string, value: unknown) => { read.filters[column] = value; return chain; },
          maybeSingle: async () => {
            read.single = true; reads.push(read);
            // The stand-in answers what PostgREST would for the columns asked.
            if (table === 'roadmap_progress') return { data: read.columns === 'data' ? { data: { javascript: { levels }, html: { levels } } } : read.columns === JAVASCRIPT_LEVELS_SELECT ? { levels } : null, error: null };
            if (table === 'coding_progress' && read.filters.task_id === tierThree.id) return { data: ownRow, error: null };
            return { data: null, error: null };
          },
          then: (resolve: (value: unknown) => unknown) => {
            reads.push(read);
            const rows = table === 'coding_progress' ? [{ ...ownRow }, { ...ownRow, task_id: 'js-double-numbers', status: 'passed', passes: 1 }] : [];
            return resolve({ data: read.filters.status === 'passed' ? rows.filter((row) => row.status === 'passed').map(({ task_id, status }) => ({ task_id, status })) : rows, error: null });
          },
        };
        return chain;
      },
    };
    const out = response();
    await withRequestContext({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { id: tierThree.id, user_id: 'account-ladder' } } as never, out as never, async () => {
      await requestMemo('tier:account-ladder', async () => 'premium');
      await handleCodingTask({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { id: tierThree.id, user_id: 'account-ladder' } } as never, out as never, progressDb as never);
    });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    const body = out.body as { locked: string | null; session: string | null; progress: { revealCount?: number; updatedAt?: string } | null };
    assert.equal(body.locked, null, 'ten cleared JavaScript Learn levels, read from the levels alone, open tier 3');
    assert.ok(body.session, 'and the task page seals a session for it');
    assert.equal(body.progress?.revealCount, 2, 'this task\'s own progress row comes back');
    assert.equal(body.progress?.updatedAt, ownRow.updated_at, 'the existing activity time is available for automatic resume');
    const progressReads = reads.filter((read) => read.table === 'coding_progress');
    assert.deepEqual(progressReads.map((read) => [read.columns, read.filters, read.single]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), [
      ['task_id,status', { user_id: 'account-ladder', status: 'passed' }, false],
      ['task_id,track,status,passes,review_stage,next_review_at,reveal_count,best_passed_at,updated_at', { user_id: 'account-ladder', task_id: tierThree.id }, true],
    ], 'the task page reads the passed ids and its own row, never every row in full');
    assert.deepEqual(reads.filter((read) => read.table === 'roadmap_progress').map((read) => read.columns), [JAVASCRIPT_LEVELS_SELECT], 'only the JavaScript levels of the roadmap row are read');

    reads.length = 0;
    const listed = response();
    await handleCodingProgress({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-ladder' } } as never, listed as never, progressDb as never);
    assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
    const progress = listed.body as { tasks: Record<string, unknown>; javascriptLevelsCleared: number };
    assert.equal(progress.javascriptLevelsCleared, 10, 'coding-progress counts the cleared levels from the levels alone');
    assert.deepEqual(Object.keys(progress.tasks).sort(), [tierThree.id, 'js-double-numbers'].sort(), 'and still lists every row the account has');
    assert.deepEqual(reads.filter((read) => read.table === 'roadmap_progress').map((read) => read.columns), [JAVASCRIPT_LEVELS_SELECT], 'coding-progress reads only the JavaScript levels too');
  }
  console.log('Coding task page and coding-progress reads passed: passed ids, the own row and the JavaScript levels only, same answer (#587 item 9).');

  // A pass alone cannot claim a saved solution. The query projects only ids,
  // belongs to the verified caller, and omits blank or missing stage drafts.
  {
    const ids = ['js-fullstack-links-1', 'js-fullstack-links-2', 'js-fullstack-links-3'];
    const codeRows = [
      { user_id: 'account-stage-code', task_id: ids[0], code: 'const saved = true;' },
      { user_id: 'account-stage-code', task_id: ids[1], code: ' \n\t' },
      { user_id: 'another-account', task_id: ids[2], code: 'const privateCode = true;' },
    ];
    const reads: { table: string; columns: string; filters: Record<string, unknown> }[] = [];
    const db = { from(table: string) {
      const read = { table, columns: '', filters: {} as Record<string, unknown> };
      const chain = {
        select(columns: string) { read.columns = columns; return chain; },
        eq(column: string, value: unknown) { read.filters[column] = value; return chain; },
        in(column: string, value: unknown) { read.filters[column] = value; return chain; },
        not(column: string, operator: string, value: string) { read.filters[column] = [operator, value]; return chain; },
        maybeSingle: async () => ({ data: { levels: [] }, error: null }),
        then(resolve: (result: unknown) => unknown) {
          reads.push(read);
          const data = table === 'coding_progress'
            ? ids.map(task_id => ({ task_id, track: 'javascript', status: 'passed', passes: 1, review_stage: 0, reveal_count: 0, best_passed_at: null }))
            : codeRows.filter(row => row.user_id === read.filters.user_id && (read.filters.task_id as string[]).includes(row.task_id) && row.code.trim()).map(row => ({ task_id: row.task_id }));
          return resolve({ data, error: null });
        },
      };
      return chain;
    } };
    const out = response();
    await handleCodingProgress({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-stage-code' } } as never, out as never, db as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.deepEqual((out.body as { stagesWithSavedCode: string[] }).stagesWithSavedCode, [ids[0]]);
    const drafts = reads.find(row => row.table === 'coding_drafts')!;
    assert.equal(drafts.columns, 'task_id');
    assert.equal(drafts.filters.user_id, 'account-stage-code');
    assert.deepEqual(drafts.filters.code, ['match', '^[[:space:]]*$']);
    assert.ok(!JSON.stringify(out.body).includes('const saved'), 'source code is never part of progress');
  }
  console.log('Saved stage checkmarks require passed status and caller-owned nonblank code, without transferring source.');

  const other = await open('account-b');
  assert.equal(other.draft, null);
  assert.equal(other.draftUpdatedAt, null, 'no draft, no time');
  console.log('Coding task draft passed: the account\'s own draft opens with its time, and no other account\'s.');

  // V3-1: a draft save answers with the time the account now holds the code,
  // which the browser's copy then builds on. Before migration 059 the save
  // goes through save_coding_draft and the time is read back: when another
  // save landed between the write and the read-back, the row holds other code
  // and no time is given.
  let landedBetween: string | null = null;
  const saving = {
    rpc: async (fn: string, args: { p_user_id: string; p_task_id: string; p_code: string }) => {
      if (fn === 'save_coding_draft_v2') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.save_coding_draft_v2' } };
      drafts[`${args.p_user_id}:${args.p_task_id}`] = { code: landedBetween ?? args.p_code, updated_at: '2026-10-09T10:05:00.123456+00:00' };
      return { data: null, error: null };
    },
    from: database.from,
  };
  const save = async (code: string) => {
    const out = response();
    await handleCodingDraft({ method: 'POST', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-a' }, body: { id: 'js-double-numbers', code, user_id: 'account-a' } } as never, out as never, saving as never);
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    return out.body as { ok: boolean; updatedAt: string | null };
  };
  assert.deepEqual(await save('const double = (ns) => ns.map((n) => n * 2);'), { ok: true, updatedAt: '2026-10-09T10:05:00.123456+00:00' }, 'a save returns the time it was stored');
  landedBetween = '// another device';
  assert.deepEqual(await save('const double = (ns) => ns;'), { ok: true, updatedAt: null }, 'no time for a save another one overtook');
  console.log('Coding draft save passed: it returns the time the account holds the code, and none when another save overtook it.');

  // Owner decision 10 (migration 059): a save names the account draft's time
  // its code builds on, and one built on an older time is refused with 409
  // and the stored time, never the stored code. A client from before sends
  // no base and writes as it always did. save_coding_draft_v2 is played here
  // by a stand-in that keeps its rule; supabase/tests/220 covers the routine.
  const stored = new Map<string, { code: string; updated_at: string }>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let tick = 0;
  const conditional = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === 'record_coding_verdict') return { data: { applied: true, firstPass: false, xpAwarded: false, codeChanged: true }, error: null };
      if (fn !== 'save_coding_draft_v2') return { data: null, error: null };
      const key = `${args.p_user_id}:${args.p_task_id}`;
      const row = stored.get(key);
      if (row && row.code === args.p_code) return { data: { saved: true, updatedAt: row.updated_at }, error: null };
      if (row && args.p_force !== true && row.updated_at !== args.p_base) return { data: { saved: false, conflict: true, updatedAt: row.updated_at }, error: null };
      tick += 1;
      const updatedAt = `2026-10-09T11:00:0${tick}.12345${tick}+00:00`;
      stored.set(key, { code: String(args.p_code), updated_at: updatedAt });
      return { data: { saved: true, updatedAt }, error: null };
    },
    from: database.from,
  };
  const post = async (body: Record<string, unknown>) => {
    const out = response();
    calls.length = 0;
    await handleCodingDraft({ method: 'POST', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-c' }, body: { id: 'js-double-numbers', user_id: 'account-c', ...body } } as never, out as never, conditional as never);
    return { status: out.statusCode, body: out.body as { ok?: boolean; updatedAt?: string | null; error?: { code?: string; updatedAt?: string } }, args: calls.find((one) => one.fn === 'save_coding_draft_v2')?.args };
  };
  const first = await post({ code: '// first', base: null });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.args?.p_base, first.args?.p_force], [null, false], 'a save names its base and is not forced');
  const t1 = first.body.updatedAt!;
  assert.ok(t1, 'a first save answers with its time');
  const second = await post({ code: '// second', base: t1 });
  assert.equal(second.status, 200, 'a save built on the stored time is written');
  assert.equal(second.args?.p_base, t1, 'the base reaches the routine as sent, microseconds and all');
  const t2 = second.body.updatedAt!;
  const stale = await post({ code: '// a tab that loaded before', base: t1 });
  assert.equal(stale.status, 409, 'a save built on an older time is refused');
  assert.equal(stale.body.error?.code, 'draft_conflict');
  assert.equal(stale.body.error?.updatedAt, t2, 'the refusal names the stored time');
  assert.ok(!JSON.stringify(stale.body).includes('// second'), 'the refusal does not carry the other device\'s code');
  assert.equal(stored.get('account-c:js-double-numbers')?.code, '// second', 'nothing was written');
  const mine = await post({ code: '// a tab that loaded before', base: stale.body.error?.updatedAt });
  assert.equal(mine.status, 200, 'keeping this code is a save built on the time the refusal named');
  const legacy = await post({ code: '// a client from before 059' });
  assert.equal(legacy.status, 200, 'a save without a base still writes');
  assert.equal(legacy.args?.p_force, true, 'a save without a base is forced, as every save was before');
  for (const base of ['yesterday', 42, '2026-10-09', { at: t1 }]) {
    const bad = await post({ code: '// x', base });
    assert.deepEqual([bad.status, bad.body.error?.code, bad.args], [400, 'bad_request', undefined], `base ${JSON.stringify(base)} is refused before the database`);
  }
  // Postgres text cannot hold U+0000, so the routine raised on such code and
  // the save answered 500 db_error. It is refused as a bad request before the
  // database, as the size limit is.
  {
    const nul = await post({ code: 'const a = "\u0000";', base: null });
    assert.deepEqual([nul.status, nul.body.error?.code, nul.args], [400, 'bad_request', undefined], `code holding U+0000 is refused before the database (${JSON.stringify(nul.body)})`);
  }
  // save_coding_draft_v2 gives up after three concurrent first saves with
  // coding_draft_busy. That is a retry, not a 500.
  {
    const busy = { from: database.from, rpc: async () => ({ data: null, error: { code: 'P0001', message: 'coding_draft_busy' } }) };
    const out = response();
    await handleCodingDraft({ method: 'POST', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-c' }, body: { id: 'js-double-numbers', user_id: 'account-c', code: '// x', base: null } } as never, out as never, busy as never);
    assert.deepEqual([out.statusCode, errorCode(out.body)], [503, 'draft_busy'], `a busy draft save asks for a retry (${JSON.stringify(out.body)})`);
  }
  console.log('Coding draft conflict passed: a save built on an older draft time is refused with 409 and the stored time, never its code; no base writes as before.');

  // An evolving stage's Submit stores the submitted code as the stage draft,
  // forced, and hands the time back, so the browser's next save builds on it
  // instead of meeting the stage's own write as a conflict.
  const stageId = 'js-evolving-calculator-1-start';
  const stageSession = encodeCodingSession({ taskId: stageId, track: 'javascript', userId: 'account-c' });
  const submitted = response();
  calls.length = 0;
  await handleCodingSubmit({ method: 'POST', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '203.0.113.59' }, query: { user_id: 'account-c' }, body: { session: stageSession, code: '// not there yet', user_id: 'account-c' } } as never, submitted as never, conditional as never);
  assert.equal(submitted.statusCode, 200, JSON.stringify(submitted.body));
  const stageWrite = calls.find((one) => one.fn === 'save_coding_draft_v2');
  assert.equal(stageWrite?.args.p_force, true, 'the stage draft is written whatever the account held');
  assert.equal((submitted.body as { draftUpdatedAt?: string }).draftUpdatedAt, stored.get(`account-c:${stageId}`)?.updated_at, 'the verdict carries the time the stage draft was stored');
  {
    const nulSubmit = response();
    calls.length = 0;
    await handleCodingSubmit({ method: 'POST', headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': '203.0.113.59' }, query: { user_id: 'account-c' }, body: { session: stageSession, code: '// not there yet \u0000', user_id: 'account-c' } } as never, nulSubmit as never, conditional as never);
    assert.deepEqual([nulSubmit.statusCode, errorCode(nulSubmit.body)], [400, 'bad_request'], `a stage Submit whose code holds U+0000 is a bad request, not a failed stage write (${JSON.stringify(nulSubmit.body)})`);
    assert.equal(calls.some((one) => one.fn === 'save_coding_draft_v2' || one.fn === 'record_coding_verdict'), false, 'nothing is written for it');
  }
  console.log('Coding evolving stage draft passed: Submit stores the stage code and returns its time.');

  // V3-2: an id no task could have (/coding/javascript/no-such-task) is as
  // unknown as one that fits the pattern; both are 404, and the browser shows
  // its not-found page instead of retrying a 400. No id at all is a bad request.
  const ask = async (id: unknown) => {
    const out = response();
    await handleCodingTask({ method: 'GET', headers: {}, query: id === undefined ? {} : { id } } as never, out as never, null);
    return { status: out.statusCode, code: errorCode(out.body) };
  };
  for (const id of ['no-such-task', 'Counter', 'js_digit_sum', 'js-no-such-task-123']) {
    assert.deepEqual(await ask(id), { status: 404, code: 'not_found' }, `${id} is not found`);
  }
  assert.deepEqual(await ask(undefined), { status: 400, code: 'bad_request' }, 'a request without an id is refused');
  assert.deepEqual(await ask(['js-digit-sum', 'js-sum-array']), { status: 400, code: 'bad_request' }, 'two ids are refused');
  const retired = CODING_TASKS.find((task) => !codingTaskById(task.id) && task.track !== 'system-design');
  if (retired) assert.deepEqual(await ask(retired.id), { status: 410, code: 'task_retired' }, `${retired.id} is retired`);
  // A task on the hidden system design track is as unknown as one that never
  // existed: 404, not 410, so nothing tells a visitor it is there.
  const hidden = CODING_TASKS.filter((task) => task.track === 'system-design');
  assert.ok(hidden.length > 0);
  // One design walkthrough and one drill; the launch contracts ask for all of them.
  for (const task of [hidden.find((one) => one.design)!, hidden.find((one) => one.drill)!]) {
    assert.deepEqual(await ask(task.id), { status: 404, code: 'not_found' }, `${task.id} is not found`);
  }
  assert.equal((await ask('js-double-numbers')).status, 200, 'a task in the catalogue opens');
  console.log(`Coding task ids passed: unknown ids are 404 whatever their shape, system design ones included${retired ? ', a retired one 410' : ''}, and a missing id 400.`);

  // A star saved on system design before it was hidden stays in the table
  // and never comes back to the browser, in the saved list or a collection.
  const starred = {
    from: (table: string) => {
      const rows: Record<string, unknown[]> = {
        coding_bookmarks: [{ task_id: 'sd-url-shortener' }, { task_id: 'js-double-numbers' }],
        coding_collections: [{ collection_id: 'collection-0001', name: 'Later', position: 0 }],
        coding_collection_items: [{ collection_id: 'collection-0001', task_id: 'dd-requests-per-second', position: 0 }, { collection_id: 'collection-0001', task_id: 'js-digit-sum', position: 1 }],
      };
      const chain = {
        select: () => chain, eq: () => chain, order: () => chain, in: () => chain, maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  const listed = response();
  await handleCodingBookmarks({ method: 'GET', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-a' } } as never, listed as never, starred as never);
  assert.equal(listed.statusCode, 200, JSON.stringify(listed.body));
  assert.deepEqual(listed.body, { saved: ['js-double-numbers'], collections: [{ collectionId: 'collection-0001', name: 'Later', position: 0, taskIds: ['js-digit-sum'] }] }, 'no system design id comes back');
  assert.equal(canSaveCodingTask('alg-valid-palindrome', new Set(), 'free', 0), true, 'a free open task may be saved');
  const higher = CODING_TASKS.find((task) => codingTaskById(task.id) && task.tier === 4 && task.track === 'javascript')!;
  assert.equal(canSaveCodingTask(higher.id, new Set(), 'premium', 0), false, 'Premium does not bypass the progression gate for Save');
  assert.equal(canSaveCodingTask('sd-url-shortener', new Set(), 'premium', 99), false, 'hidden tasks cannot be saved');
  let writes = 0;
  const bookmarkDb = { ...starred, rpc: async () => { writes += 1; return { data: true, error: null }; } };
  const mutateBookmark = async (body: unknown, db = bookmarkDb) => {
    const out = response();
    await handleCodingBookmarks({ method: 'PUT', headers: { authorization: 'Bearer stand-in-token' }, query: { user_id: 'account-a' }, body } as never, out as never, db as never);
    return out;
  };
  const barred = await mutateBookmark({ op: 'save', taskId: higher.id, saved: true });
  assert.equal(barred.statusCode, 402, JSON.stringify(barred.body));
  assert.equal(errorCode(barred.body), 'premium_required', 'Save preserves the shared Premium refusal contract');
  assert.equal(writes, 0, 'a locked bookmark is rejected before the write');
  const collectionBarred = await mutateBookmark({ op: 'collection-item', taskId: higher.id, collectionId: 'collection-0001', present: true });
  assert.equal(collectionBarred.statusCode, 402);
  assert.equal(writes, 0, 'collections cannot bypass the bookmark gate');
  assert.equal((await mutateBookmark({ op: 'save', taskId: 'alg-valid-palindrome', saved: true })).statusCode, 200);
  assert.equal(writes, 1, 'an open free challenge can be saved');
  assert.equal((await mutateBookmark({ op: 'save', taskId: higher.id, saved: false })).statusCode, 200);
  assert.equal(writes, 2, 'existing locked bookmarks can still be removed');
  console.log('Coding bookmarks passed: a star saved on system design is not listed.');

  // A free account (a lapsed plan) submits a Premium task. When its passed
  // tasks cannot be read, the gate cannot tell review from a new start: that
  // is 503 entitlement_unavailable, the same as lib/access.ts answers, never
  // the 402 upgrade sheet for work the learner may already have passed.
  {
    const premium = CODING_TASKS.find((task) => codingTaskById(task.id) && !task.id.endsWith('-start')
      && contentTier(codingContent(task.id), serverContentIndex()) === 'premium')!;
    assert.ok(premium, 'a Premium coding task exists');
    const lapsed = encodeCodingSession({ taskId: premium.id, track: premium.track, userId: 'account-lapsed' });
    const progressFor = (read: { data: unknown; error: unknown }) => ({
      from: (table: string) => {
        const chain = {
          select: () => chain, eq: () => chain, in: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) => resolve(table === 'coding_progress' ? read : { data: [], error: null }),
        };
        return chain;
      },
      // Past the gate the verdict write finds no database, which is not the point here.
      rpc: async () => ({ data: null, error: { code: '57014', message: 'stand-in has no routines' } }),
    });
    const submit = async (database: unknown, address: string) => {
      const out = response();
      await handleCodingSubmit({ ...request(lapsed, 'account-lapsed'), headers: { authorization: 'Bearer stand-in-token', 'x-forwarded-for': address }, body: { session: lapsed, code: 'const x = 1;', hintsUsed: 0, user_id: 'account-lapsed' } } as never, out as never, database as never);
      return out;
    };
    const unread = await submit(progressFor({ data: null, error: { code: '57014', message: 'statement timeout' } }), '203.0.113.81');
    assert.deepEqual([unread.statusCode, errorCode(unread.body)], [503, 'entitlement_unavailable'], `an unreadable passed-tasks read is not "never passed" (${JSON.stringify(unread.body)})`);
    const fresh = await submit(progressFor({ data: [], error: null }), '203.0.113.82');
    assert.deepEqual([fresh.statusCode, errorCode(fresh.body)], [402, 'premium_required'], 'a Premium task never passed is still refused with 402');
    const passed = await submit(progressFor({ data: [{ task_id: premium.id, status: 'passed' }], error: null }), '203.0.113.83');
    assert.notEqual(passed.statusCode, 402, 'a Premium task already passed stays open for review');
  }
  console.log('Coding lapsed-plan gate passed: a failed passed-tasks read answers 503 entitlement_unavailable, not 402.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
