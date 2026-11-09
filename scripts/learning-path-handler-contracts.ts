import { decodeLearningPathSession } from '../lib/quiz-tokens';
// Handler contracts for the learning paths, run by `npm run test:paths`.
//
// The handlers are called directly with a stand-in for Supabase that answers
// only what each case needs. Nothing here reaches a network: auth takes the
// local development fallback (a `user_id` in the body), which is what every
// suite in this repository runs under, and the plan check reads the free tier.
//
//   * a submit re-checks the path's switch and a paused enrollment
//   * a resubmitted write-up keeps its submission, and a submit sends the
//     module's requirements so the database decides completion
//   * a preference save that cannot read the saved answers writes nothing
//   * a path reward: paused with merchandise (MERCH_ENABLED), so a read and a
//     claim answer 404 merch_unavailable and touch nothing; with the switch
//     on, the address is checked, not cut to fit, completion is read for the
//     published curriculum version, a raced second claim, a refused field
//   * rate limits are the learner's own, with a class-sized address backstop
//   * a learner with submits already grading on an activity, or on enough
//     of them, is told the grader is busy; another activity is not held up
//   * a submit is limited per activity, beneath a ceiling per learner
//   * a started check carries its scenario in the activity summary only, with
//     its questions in authored order, and every off-loop decision in the
//     handlers and the shared arithmetic goes through isOffLoopModule

import { readFileSync } from 'node:fs';
import { LEARNING_PATHS, activitySummary } from '../lib/learning-paths/catalog';
import {
  handleActivityStart,
  handleActivitySubmit,
  handleEnrollment,
  handleLearningPreference,
  handlePathDraft,
  handlePathProgress,
  handlePathReward,
  moduleRequirements,
} from '../lib/learning-paths/handlers';
import { requestMemo, withRequestContext } from '../lib/http';
import { createLearningPathSession as encodeLearningPathSession } from '../lib/learning-paths/session';
import { enterInFlight, RATE_LIMITS, SHARED_NETWORK_SEATS } from '../lib/rate-limit';
import { GRADING_PER_CALLER, GRADING_PER_TASK, gradingItem } from '../lib/coding/grader-capacity';
import { LEARNER_PROFILE_META_KEY, isOffLoopModule } from '../shared/learning-paths';
import { MERCH_ENABLED } from '../shared/rewards';
import { diagnosticEvidence } from '../lib/learning-paths/competencies';
import { gradeCheck } from '../lib/learning-paths/grade';
import { solutionFor } from '../lib/learning-paths/solutions';
import { settleMilestonesAfterPass } from '../lib/rewards/coins';
import type { StartActivityResponse, SubmitActivityResponse } from '../shared/learning-path-api';

type Fail = (message: string) => void;

interface Captured {
  statusCode: number;
  body: unknown;
}

function response(): Captured & Record<string, unknown> {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
    setHeader() { return res; },
    status(code: number) { res.statusCode = code; return res; },
    json(value: unknown) { res.body = value; res.headersSent = true; return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

const request = (method: string, address: string, body: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ method, headers: { 'x-forwarded-for': address, ...((extra.headers as object) ?? {}) }, query: extra.query ?? {}, body, socket: {} }) as never;

const code = (res: Captured) => (res.body as { error?: { code?: string } } | undefined)?.error?.code;

/** A chainable stand-in for the few Supabase calls these handlers make: a
 * single row through `maybeSingle()`, a list when the chain is awaited. */
function fakeSupabase(options: {
  rows?: Record<string, unknown>;
  lists?: Record<string, unknown[]>;
  rpc?: (name: string, params: Record<string, unknown>) => { data?: unknown; error?: unknown } | Promise<{ data?: unknown; error?: unknown }>;
  auth?: Record<string, unknown>;
  onQuery?: (table: string, operation: string, args: unknown[]) => void;
  rowErrors?: Record<string, unknown>;
}) {
  const from = (table: string) => {
    const chain = {
      select: (...args: unknown[]) => { options.onQuery?.(table, 'select', args); return chain; },
      eq: (...args: unknown[]) => { options.onQuery?.(table, 'eq', args); return chain; },
      order: (...args: unknown[]) => { options.onQuery?.(table, 'order', args); return chain; },
      limit: (...args: unknown[]) => { options.onQuery?.(table, 'limit', args); return chain; },
      maybeSingle: async () => { options.onQuery?.(table, 'maybeSingle', []); return { data: options.rows?.[table] ?? null, error: options.rowErrors?.[table] ?? null }; },
      then: <A>(resolve: (value: { data: unknown[]; error: null }) => A) => resolve({ data: options.lists?.[table] ?? [], error: null }),
    };
    return chain;
  };
  return {
    from,
    rpc: async (name: string, params: Record<string, unknown>) => ({ data: null, error: null, ...((await options.rpc?.(name, params)) ?? {}) }),
    auth: { admin: options.auth ?? {} },
  } as never;
}

/** The development auth fallback announces itself on every call; a few
 * hundred of those would bury the report. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    return await run();
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

export async function handlerContracts(fail: Fail): Promise<void> {
  const stamp = Date.now();
  // The FDE path, the only published one since E5 (#496). The submit
  // contracts take an authored JavaScript exercise past the first loop
  // module, which the free taster does not open.
  const path = LEARNING_PATHS.find((one) => one.id === 'fde')!;
  const codeActivity = path.modules.filter(module => !isOffLoopModule(module)).slice(1).flatMap((module) => module.activities)
    .find((activity) => activity.kind === 'code' && !activity.reuseTaskId && activity.code?.language === 'javascript')!;
  const learner = `user-paths-${stamp}`;
  const enrollmentId = `ENROLL${stamp}`.padEnd(20, 'a');
  const session = encodeLearningPathSession({
    attemptId: `ATTEMPT${stamp}`.padEnd(20, 'a'),
    enrollmentId,
    userId: learner,
    pathId: 'fde',
    activityId: codeActivity.id,
    activityKind: codeActivity.kind,
    purpose: codeActivity.purpose,
    curriculumVersion: path.version,
    rubricVersion: path.rubric.version,
  }).token;
  const submitBody = { user_id: learner, session, idempotencyKey: 'KEY0123456789abcdefghij', code: 'const x = 1;' };
  const enrollmentRow = (status: string) => ({
    enrollment_id: enrollmentId, user_id: learner, path_id: 'fde', curriculum_version: path.version,
    base_track_at_enrollment: null, status, started_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  });
  const switchBefore = process.env.LEARNING_PATH_FDE_ENABLED;

  await quietly(async () => {
    /* ── a submit re-checks the switch and the enrollment ─────────────── */
    try {
      delete process.env.LEARNING_PATH_FDE_ENABLED;
      let res = response();
      await handleActivitySubmit(request('POST', `submit-${stamp}`, submitBody), res as never, fakeSupabase({ rows: { learning_path_enrollments: enrollmentRow('active') } }));
      if (res.statusCode !== 503 || code(res) !== 'path_unavailable') {
        fail(`submit to a path whose switch is off answers ${res.statusCode} ${code(res)}, not 503 path_unavailable`);
      }

      process.env.LEARNING_PATH_FDE_ENABLED = 'true';
      res = response();
      await handleActivitySubmit(request('POST', `submit-${stamp}`, submitBody), res as never, fakeSupabase({ rows: { learning_path_enrollments: enrollmentRow('paused') } }));
      if (res.statusCode !== 409 || code(res) !== 'enrollment_paused') {
        fail(`submit to a paused enrollment answers ${res.statusCode} ${code(res)}, not 409 enrollment_paused`);
      }

      // An open path and an active enrollment go on to the plan check, which
      // the free tier these suites run on refuses.
      res = response();
      await handleActivitySubmit(request('POST', `submit-${stamp}`, submitBody), res as never, fakeSupabase({ rows: { learning_path_enrollments: enrollmentRow('active') } }));
      if (res.statusCode !== 402) fail(`submit to an active enrollment answers ${res.statusCode} ${code(res)}, not the plan check's 402`);
    } finally {
      if (switchBefore === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
      else process.env.LEARNING_PATH_FDE_ENABLED = switchBefore;
    }

    /* ── free enrollment, diagnostic and first module; later activity gate ── */
    {
      const fde = LEARNING_PATHS.find(path => path.id === 'fde')!;
      const required = fde.modules.filter(module => !isOffLoopModule(module));
      const first = required[0];
      const second = required[1].activities[0];
      const freeUser = `free-taster-${stamp}`;
      const row = { ...enrollmentRow('active'), user_id: freeUser, path_id: 'fde', curriculum_version: fde.version };
      const recorded: Record<string, { state: string }> = {};
      const lists = { learning_path_progress: [{ module_id: first.id, activity_states: recorded, completed_at: null }] };
      let completedFirst = false;
      let calls = 0;
      const db = fakeSupabase({ rows: { learning_path_enrollments: row }, lists, rpc: (name, params) => {
        calls += 1;
        if (name === 'upsert_learning_path_enrollment') return { data: { found: true, created: true, enrollment: row } };
        if (name === 'open_learning_path_attempt') return { data: { ok: true, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
        if (name === 'accept_learning_path_result') {
          const result = params.p_result as SubmitActivityResponse;
          recorded[result.activityId] = { state: result.state };
          if (params.p_module_id === first.id && params.p_module_complete === true) completedFirst = true;
          return { data: { ok: true, replayed: false, result } };
        }
        return {};
      } });
      const before = process.env.LEARNING_PATH_FDE_ENABLED;
      process.env.LEARNING_PATH_FDE_ENABLED = 'true';
      try {
        let res = response();
        await handleEnrollment(request('POST', `taster-enroll-${stamp}`, { user_id: freeUser, action: 'enroll', pathId: 'fde', curriculumVersion: fde.version, baseTrack: 'fullstack' }), res as never, db);
        if (res.statusCode !== 200) fail(`a free account cannot enroll: ${res.statusCode} ${code(res)}`);
        const diagnostic = fde.modules.flatMap(module => module.activities).find(activity => activity.id === fde.diagnosticActivityId)!;
        for (const activity of [diagnostic, ...first.activities]) {
          res = response();
          await handleActivityStart(request('POST', `taster-start-${stamp}-${activity.id}`, { user_id: freeUser, enrollmentId, activityId: activity.id }), res as never, db);
          if (res.statusCode !== 200) { fail(`free taster cannot start ${activity.id}: ${res.statusCode} ${code(res)}`); continue; }
          const opened = res.body as StartActivityResponse;
          const sealed = decodeLearningPathSession(opened.session)!;
          const artifact = Object.fromEntries((activity.artifact?.fields ?? []).map(field => [field.id, field.kind === 'list' ? ['Local fixture'] : field.kind === 'url' ? 'https://example.invalid/' : 'Local fixture']));
          res = response();
          await handleActivitySubmit(request('POST', `taster-submit-${stamp}-${activity.id}`, { user_id: freeUser, session: opened.session,
            idempotencyKey: `TASTER${stamp}${calls}`.padEnd(24, 'a'), acknowledged: true, answers: sealed.answerKey, artifact }), res as never, db);
          const result = res.body as SubmitActivityResponse;
          if (res.statusCode !== 200 || !['verified_pass', 'self_reviewed'].includes(result.state)) fail(`free taster cannot finish ${activity.id}: ${res.statusCode} ${code(res)} ${result.state}`);
        }
        if (!completedFirst) fail('the free first module never sent satisfied completion requirements');
        const beforeRefusal = calls;
        res = response();
        await handleActivityStart(request('POST', `taster-refuse-${stamp}`, { user_id: freeUser, enrollmentId, activityId: second.id }), res as never, db);
        const error = (res.body as { error?: { kind?: string; ref?: string } })?.error;
        if (res.statusCode !== 402 || code(res) !== 'premium_required' || error?.kind !== 'learning-path-activity' || error.ref !== `fde:${second.id}`) fail(`second module must answer activity-scoped 402, got ${res.statusCode} ${JSON.stringify(res.body)}`);
        if (calls !== beforeRefusal) fail('a refused Premium start opened an attempt');
        // This same account now represents a lapsed learner with stored passes.
        for (const state of ['verified_pass', 'self_reviewed']) {
          recorded[second.id] = { state };
          res = response();
          await handleActivityStart(request('POST', `taster-review-${stamp}-${state}`, { user_id: freeUser, enrollmentId, activityId: second.id }), res as never, db);
          if (res.statusCode !== 200) fail(`a lapsed account cannot reopen ${state} work: ${res.statusCode} ${code(res)}`);
        }
      } finally {
        if (before === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = before;
      }
    }

    /* ── diagnostic recommendations use actual latest item evidence ───── */
    {
      const fde = LEARNING_PATHS.find(path => path.id === 'fde')!;
      const module = fde.modules.find(one => one.activities.some(a => a.id === fde.diagnosticActivityId))!;
      const diagnostic = module.activities.find(a => a.id === fde.diagnosticActivityId)!;
      const key = diagnostic.questions!.map(q => q.correct);
      const answers = key.map((value, index) => index < 2 ? (value + 1) % 4 : value);
      const expectedCounts = diagnosticEvidence(diagnostic, gradeCheck(diagnostic, key, answers).verdicts);
      const id = `FDEDIAG${stamp}`.padEnd(20, 'a');
      const row = { ...enrollmentRow('active'), enrollment_id: id, path_id: 'fde', curriculum_version: fde.version };
      const token = encodeLearningPathSession({ attemptId: `DIAG${stamp}`.padEnd(20, 'a'), enrollmentId: id,
        userId: learner, pathId: 'fde', activityId: diagnostic.id, activityKind: 'check', purpose: 'diagnostic',
        curriculumVersion: fde.version, rubricVersion: fde.rubric.version, answerKey: key }).token;
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const sent: Record<string, unknown>[] = [];
        let acceptedResult: unknown;
        const submitDiagnostic = async () => {
          const req = request('POST', `diagnostic-${stamp}`, { user_id: learner, session: token,
            idempotencyKey: 'KEYdiagnostic0123456789', answers, score: 1, competencies: { integration: 1 }, domainScores: { integration: 1 } });
          const res = response();
          await withRequestContext(req, res as never, async () => {
            await requestMemo(`tier:${learner}`, async () => 'premium');
            await handleActivitySubmit(req, res as never, fakeSupabase({ rows: { learning_path_enrollments: row },
              rpc: (name, params) => {
                if (name !== 'accept_learning_path_result') fail(`diagnostic called unexpected RPC ${name}`);
                sent.push(params);
                if (!acceptedResult) acceptedResult = params.p_result;
                return { data: { ok: true, replayed: sent.length > 1, result: acceptedResult } };
              } }));
          });
          return res;
        };
        let res = await submitDiagnostic();
        const result = res.body as SubmitActivityResponse;
        if (res.statusCode !== 200 || result.state !== 'verified_pass' || result.score !== 0.8333) fail(`diagnostic aggregate contract failed: ${JSON.stringify(res.body)}`);
        if (JSON.stringify(sent[0]?.p_domain_scores) !== JSON.stringify(expectedCounts)) fail('diagnostic did not persist trusted per-item counts');
        if (result.domainScores || JSON.stringify(result.module).includes('diagnostic:v1:')) fail('internal diagnostic counts leaked as public domain labels');
        if (sent[0]?.p_module_complete !== false || JSON.stringify(sent[0]?.p_module_requires) !== '[]') fail('optional diagnostic acquired completion requirements');
        res = await submitDiagnostic();
        if (!(res.body as SubmitActivityResponse).replayed || sent[0]?.p_request_hash !== sent[1]?.p_request_hash) fail('diagnostic replay lost the accepted result/hash contract');
        const priorPass = { module_id: module.id, activity_states: { [diagnostic.id]: { state: 'verified_pass', score: 1, domainScores: null } }, completed_at: null };
        for (const evidence of [expectedCounts, null]) {
          const queries: { table: string; op: string; args: unknown[] }[] = [];
          const req = request('GET', `diagnostic-progress-${stamp}`, { user_id: learner }, { query: { enrollmentId: id } });
          res = response();
          await handlePathProgress(req, res as never, fakeSupabase({ rows: { learning_path_enrollments: row,
            learning_path_evidence: { domain_scores: evidence } }, lists: { learning_path_progress: [priorPass] },
            onQuery: (table, op, args) => queries.push({ table, op, args }) }));
          const body = res.body as { competencies?: { competencyId: string; state: string; score: number | null }[]; recommendedBridges?: string[] };
          if (res.statusCode !== 200) fail(`diagnostic progress failed: ${JSON.stringify(res.body)}`);
          if (evidence) {
            if (body.competencies?.find(c => c.competencyId === 'integration')?.state !== 'gap'
                || body.competencies?.find(c => c.competencyId === 'handoff')?.state !== 'demonstrated') fail('latest evidence was replaced by the best aggregate score');
            const ranked = body.recommendedBridges ?? [];
            if (!ranked.slice(0, 2).includes('fde-bridge-backend-data') || !ranked.slice(0, 2).includes('fde-bridge-python')
                || ranked.indexOf('fde-bridge-backend-data') > ranked.indexOf('fde-bridge-operator-interface')) fail('bridge ranking ignored the actual integration gap');
          } else if (!body.competencies?.every(c => c.state === 'not_assessed' && c.score === null)) fail('aggregate-only legacy progress invented competency mastery');
          for (const [column, value] of [['user_id', learner], ['enrollment_id', id], ['activity_id', diagnostic.id]]) {
            if (!queries.some(q => q.table === 'learning_path_evidence' && q.op === 'eq' && q.args[0] === column && q.args[1] === value)) fail(`diagnostic evidence query omitted ${column} scope`);
          }
          if (!queries.some(q => q.table === 'learning_path_evidence' && q.op === 'order' && q.args[0] === 'revision' && (q.args[1] as { ascending?: boolean }).ascending === false)
              || !queries.some(q => q.table === 'learning_path_evidence' && q.op === 'limit' && q.args[0] === 1)) fail('diagnostic query did not select exactly the latest revision');
          if (JSON.stringify(res.body).includes('diagnostic:v1:')) fail('stored internal count labels leaked into public progress');
        }
        res = response();
        await handlePathProgress(request('GET', `diagnostic-offline-${stamp}`, { user_id: learner }, { query: { enrollmentId: id } }), res as never,
          fakeSupabase({ rows: { learning_path_enrollments: row }, rowErrors: { learning_path_evidence: { message: 'offline' } } }));
        if (res.statusCode !== 500 || code(res) !== 'db_error') fail('unavailable diagnostic evidence became a fabricated assessment');
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a scenario reaches the attempt through the activity summary ─── */
    // No published check carries a scenario yet, so one FDE exercise check
    // gains one for this case and loses it afterwards. The start response must
    // carry it in `activity` (activitySummary, the field the workspace reads),
    // keep the questions in authored order so the scenario reads as one case,
    // and add no duplicate of it to the check payload.
    {
      const fde = LEARNING_PATHS.find((path) => path.id === 'fde')!;
      const check = fde.modules.filter((one) => !isOffLoopModule(one)).flatMap((one) => one.activities)
        .find((activity) => activity.kind === 'check' && activity.purpose === 'exercise' && (activity.questions?.length ?? 0) >= 3)!;
      const id = `FDESTART${stamp}`.padEnd(20, 'a');
      const row = { ...enrollmentRow('active'), enrollment_id: id, path_id: 'fde', curriculum_version: fde.version };
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      const scenarioBefore = Object.prototype.hasOwnProperty.call(check, 'scenario');
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        check.scenario = 'A support lead says the weekly export is wrong. Answer the questions below in order.';
        const req = request('POST', `start-scenario-${stamp}`, { user_id: learner, enrollmentId: id, activityId: check.id });
        const res = response();
        await withRequestContext(req, res as never, async () => {
          await requestMemo(`tier:${learner}`, async () => 'premium');
          await handleActivityStart(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: row },
            lists: { learning_path_progress: [] },
            rpc: (name) => name === 'open_learning_path_attempt'
              ? { data: { ok: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
              : (fail(`starting a check called unexpected RPC ${name}`), {}),
          }));
        });
        const body = res.body as StartActivityResponse;
        if (res.statusCode !== 200) fail(`starting a scenario check answered ${res.statusCode} ${code(res)}`);
        else {
          if (JSON.stringify(body.activity) !== JSON.stringify(activitySummary(check))) fail('the start response activity is not the public activity summary');
          if (body.activity.scenario !== check.scenario) fail('the scenario did not reach the attempt');
          if (JSON.stringify(body.check?.questions.map((question) => question.id)) !== JSON.stringify(check.questions!.map((question) => question.id))) {
            fail('a started check changed the authored question order a scenario relies on');
          }
          if (body.check && 'scenario' in body.check) fail('the check payload repeats the scenario beside the activity summary');
        }
      } finally {
        if (!scenarioBefore) delete check.scenario;
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a Premium activity start asks the tier beside the enrollment ── */
    // #587, server item 21: the plan check's tier read does not wait for the
    // enrollment read; a free activity still asks for no tier at all.
    {
      const fde = LEARNING_PATHS.find((one) => one.id === 'fde')!;
      const premiumCheck = fde.modules.filter((one) => !isOffLoopModule(one)).slice(1).flatMap((one) => one.activities)
        .find((activity) => activity.kind === 'check')!;
      const freeActivity = fde.modules.find((one) => !isOffLoopModule(one))!.activities[0];
      const id = `FDETIER${stamp}`.padEnd(20, 'a');
      const starter = `user-paths-start-tier-${stamp}`;
      const row = { ...enrollmentRow('active'), enrollment_id: id, user_id: starter, path_id: 'fde', curriculum_version: fde.version };
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      const startWatched = async (activityId: string) => {
        const order: string[] = [];
        let watching = false;
        class WatchedTier<T> extends Promise<T> {
          static get [Symbol.species]() { return Promise; }
          then<A = T, B = never>(onDone?: ((value: T) => A | PromiseLike<A>) | null, onFail?: ((reason: unknown) => B | PromiseLike<B>) | null) {
            if (watching) order.push('tier');
            return super.then(onDone, onFail);
          }
        }
        const req = request('POST', `start-tier-${stamp}`, { user_id: starter, enrollmentId: id, activityId });
        const res = response();
        await withRequestContext(req, res as never, async () => {
          void requestMemo(`tier:${starter}`, () => new WatchedTier<'premium'>((resolve) => resolve('premium')));
          watching = true;
          await handleActivityStart(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: row },
            lists: { learning_path_progress: [] },
            onQuery: (table, op) => { if (op === 'select' && table === 'learning_path_enrollments') order.push('enrollment'); },
            rpc: (name) => name === 'open_learning_path_attempt'
              ? { data: { ok: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
              : {},
          }));
        });
        watching = false;
        return { res, order };
      };
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const premium = await startWatched(premiumCheck.id);
        if (premium.res.statusCode !== 200) fail(`a Premium start answered ${premium.res.statusCode} ${code(premium.res)}`);
        const firstTier = premium.order.indexOf('tier');
        if (firstTier < 0 || firstTier > premium.order.indexOf('enrollment')) {
          fail(`a Premium activity start asked the tier only after the enrollment read: ${premium.order.join(' > ')}`);
        }
        const free = await startWatched(freeActivity.id);
        if (free.res.statusCode !== 200) fail(`a free start answered ${free.res.statusCode} ${code(free.res)}`);
        if (free.order.includes('tier')) fail('a free activity start asked for the tier');
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a draft that cannot be read is logged, and the activity opens ─ */
    {
      const id = `DRAFTERR${stamp}`.padEnd(20, 'a');
      const row = { ...enrollmentRow('active'), enrollment_id: id };
      const requestId = `req-draft-read-${stamp}`;
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      const lines: string[] = [];
      const log = console.log;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        console.log = (line: unknown) => { lines.push(String(line)); };
        const req = request('POST', `draft-read-${stamp}`, { user_id: learner, enrollmentId: id, activityId: codeActivity.id }, { headers: { 'x-request-id': requestId } });
        const res = response();
        await withRequestContext(req, res as never, async () => {
          await requestMemo(`tier:${learner}`, async () => 'premium');
          await handleActivityStart(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: row },
            rowErrors: { learning_path_drafts: { code: '57014', message: 'canceling statement due to statement timeout' } },
            lists: { learning_path_progress: [] },
            rpc: (name) => name === 'open_learning_path_attempt'
              ? { data: { ok: true, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } }
              : {},
          }));
        });
        if (res.statusCode !== 200) fail(`a failed draft read must still open the activity, got ${res.statusCode} ${code(res)}`);
        else if ((res.body as StartActivityResponse).draft !== null) fail('a failed draft read must open without a draft');
        else if ((res.body as StartActivityResponse).draftUnavailable !== true) fail('a failed draft read must say the draft is unknown, so the browser keeps its copy');
        const logged = lines.map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
          .find((entry) => entry?.kind === 'draft_read_failed');
        if (!logged) fail('a failed draft read must be logged');
        else if (logged.request_id !== requestId || logged.code !== '57014') fail(`the draft read failure must carry the request id and error code, got ${JSON.stringify(logged)}`);
      } finally {
        console.log = log;
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a stored enrollment of the retired DSA path ─────────────────── */
    // E5 (#496) deletes no data, so a learning_path_enrollments row with
    // path_id 'dsa-foundations' may still exist beside an FDE one. The list
    // leaves it out instead of casting it to a LearningPathId, and progress
    // or an activity start on it answers 404 without reaching any path data.
    {
      const fde = LEARNING_PATHS.find((one) => one.id === 'fde')!;
      const retiredId = `RETIRED${stamp}`.padEnd(20, 'a');
      const fdeId = `FDELIST${stamp}`.padEnd(20, 'a');
      const retiredRow = { ...enrollmentRow('active'), enrollment_id: retiredId, path_id: 'dsa-foundations', curriculum_version: 1 };
      const fdeRow = { ...enrollmentRow('active'), enrollment_id: fdeId, path_id: 'fde', curriculum_version: fde.version };
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        let res = response();
        await handleEnrollment(request('GET', `retired-list-${stamp}`, { user_id: learner }), res as never,
          fakeSupabase({ lists: { learning_path_enrollments: [fdeRow, retiredRow] } }));
        const listed = (res.body as { enrollments?: { enrollmentId: string; pathId: string }[] } | undefined)?.enrollments ?? [];
        if (res.statusCode !== 200) fail(`listing enrollments beside a retired row answered ${res.statusCode} ${code(res)}`);
        if (listed.some((one) => one.pathId === 'dsa-foundations' || one.enrollmentId === retiredId)) fail('a stored dsa-foundations enrollment reached the client');
        if (listed.length !== 1 || listed[0]?.enrollmentId !== fdeId || listed[0]?.pathId !== 'fde') fail('the FDE enrollment beside a retired row was not listed');

        const touched: string[] = [];
        const retiredDb = fakeSupabase({ rows: { learning_path_enrollments: retiredRow }, lists: { learning_path_progress: [] },
          onQuery: (table, op) => { if (op === 'select') touched.push(table); },
          rpc: (name) => (fail(`a retired enrollment reached RPC ${name}`), {}) });
        res = response();
        await handlePathProgress(request('GET', `retired-progress-${stamp}`, { user_id: learner }, { query: { enrollmentId: retiredId } }), res as never, retiredDb);
        if (res.statusCode !== 404 || code(res) !== 'not_found') fail(`progress on a retired enrollment answered ${res.statusCode} ${code(res)}`);

        const activityId = 'dsa-v1-d01-linear-accumulator';
        const req = request('POST', `retired-start-${stamp}`, { user_id: learner, enrollmentId: retiredId, activityId });
        res = response();
        await withRequestContext(req, res as never, async () => {
          await requestMemo(`tier:${learner}`, async () => 'premium');
          await handleActivityStart(req, res as never, retiredDb);
        });
        if (res.statusCode !== 404 || code(res) !== 'not_found') fail(`starting an activity on a retired enrollment answered ${res.statusCode} ${code(res)}`);
        if (touched.some((table) => table !== 'learning_path_enrollments')) fail(`a retired enrollment read path data: ${touched.join(', ')}`);
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── two enrolls at once ──────────────────────────────────────────── */
    // A double click or a second tab: both requests find no row and both
    // insert, so the later one meets the (user, path, version) unique key. It
    // is answered with the enrollment the first one created, not a 500.
    {
      const fde = LEARNING_PATHS.find((one) => one.id === 'fde')!;
      const racer = `user-enroll-race-${stamp}`;
      const row = { ...enrollmentRow('active'), user_id: racer };
      const calls: string[] = [];
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const res = response();
        await handleEnrollment(request('POST', `enroll-race-${stamp}`, { user_id: racer, action: 'enroll', pathId: 'fde', curriculumVersion: fde.version }), res as never,
          fakeSupabase({ rpc: (name) => {
            calls.push(name);
            return calls.length === 1
              ? { error: { code: '23505', message: 'duplicate key value violates unique constraint "learning_path_enrollments_user_id_path_id_curriculum_version_key"' } }
              : { data: { found: true, created: false, enrollment: row } };
          } }));
        const listed = (res.body as { enrollments?: { enrollmentId: string }[] } | undefined)?.enrollments;
        if (res.statusCode !== 200 || listed?.[0]?.enrollmentId !== enrollmentId || calls.length !== 2) {
          fail(`an enroll that lost the race to the unique key answers ${res.statusCode} ${code(res)} after ${calls.length} calls, not 200 with the existing enrollment`);
        }
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a draft save the routine would refuse is the learner's 4xx ───── */
    // save_learning_path_draft raises on a revision past 1,000,000 and on a
    // stored form past 64 kB; a raise must not reach the learner as a 500.
    {
      const writer = `user-draft-bounds-${stamp}`;
      const draft = { user_id: writer, enrollmentId, activityId: codeActivity.id, content: { code: 'const x = 1;' } };
      const called: string[] = [];
      let res = response();
      await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 1_000_001 }), res as never,
        fakeSupabase({ rpc: (name) => { called.push(name); return {}; } }));
      if (res.statusCode !== 400 || called.length > 0) fail(`a draft revision past the routine's bound answers ${res.statusCode} after ${called.length} calls, not 400 before any`);
      res = response();
      await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 3 }), res as never,
        fakeSupabase({ rpc: () => ({ error: { code: 'P0001', message: 'invalid_learning_path_draft' } }) }));
      if (res.statusCode !== 413 || code(res) !== 'too_large') fail(`a draft the routine refuses as oversized answers ${res.statusCode} ${code(res)}, not 413 too_large`);
      // Two first saves at once: the later insert meets the (enrollment,
      // activity) key. The other copy is newer, so it is a conflict, not a 500.
      res = response();
      await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 0 }), res as never,
        fakeSupabase({ rpc: () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "learning_path_drafts_pkey"' } }) }));
      if (res.statusCode !== 409 || code(res) !== 'draft_conflict') fail(`a first draft save that lost the race to the key answers ${res.statusCode} ${code(res)}, not 409 draft_conflict`);
      // JSONB cannot store U+0000; the character is refused before the
      // routine, while code that spells the escape out as text still saves.
      called.length = 0;
      res = response();
      await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 0, content: { code: 'const x = "\u0000";' } }), res as never,
        fakeSupabase({ rpc: (name) => { called.push(name); return {}; } }));
      if (res.statusCode !== 400 || called.length > 0) fail(`a draft holding U+0000 answers ${res.statusCode} after ${called.length} calls, not 400 before any`);
      res = response();
      await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 0, content: { code: 'const nul = "\\u0000";' } }), res as never,
        fakeSupabase({ rpc: () => ({ data: { revision: 1, updated_at: new Date().toISOString() } }) }));
      if (res.statusCode === 400) fail('code that spells \\u0000 out as text was refused as a NUL');
      for (const content of [{ code: 42 }, { artifact: ['not fields'] }, { artifact: { decision: { text: 'nested' } } }, { artifact: { notes: ['valid', 3] } }]) {
        called.length = 0;
        res = response();
        await handlePathDraft(request('PUT', `draft-bounds-${stamp}`, { ...draft, expectedRevision: 0, content }), res as never,
          fakeSupabase({ rpc: (name) => { called.push(name); return { data: { ok: true, revision: 1 } }; } }));
        if (res.statusCode !== 400 || called.length > 0) fail(`a malformed draft was sent to storage: ${JSON.stringify(content)}, status ${res.statusCode}, calls ${called.length}`);
      }
    }

    /* ── every off-loop decision goes through one helper ──────────────── */
    // A shelf module is off the loop even if its optional flag slipped. The
    // validator refuses that, but completion, the next action and the reward's
    // module count must not depend on the validator alone.
    for (const file of ['lib/learning-paths/handlers.ts', 'shared/learning-paths.ts']) {
      if (/\bmodule\.optional\b/.test(readFileSync(file, 'utf8'))) {
        fail(`${file} reads module.optional directly; use isOffLoopModule so a shelf module is off the loop too`);
      }
    }

    /* ── a burst is refused before it reaches the grader ──────────────── */
    // The coding section's grader threads take path code too. One learner may
    // have GRADING_PER_TASK submits grading at once on one activity (C1-1;
    // per activity since owner decision 9), and GRADING_PER_CALLER across
    // them all. One more is a 429 `grader_busy`, recorded nowhere. A full
    // activity holds up no other activity, and once one of the learner's
    // submits is answered the next is graded.
    try {
      process.env.LEARNING_PATH_FDE_ENABLED = 'true';
      const burster = `user-paths-burst-${stamp}`;
      const otherCode = path.modules.flatMap((module) => module.activities).find((activity) => activity.kind === 'code' && activity.code?.language === 'javascript' && activity.id !== codeActivity.id)!;
      const bodyFor = (activity: typeof codeActivity) => ({
        ...submitBody,
        user_id: burster,
        session: encodeLearningPathSession({
          attemptId: `BURST${stamp}`.padEnd(20, 'a'), enrollmentId, userId: burster, pathId: 'fde',
          activityId: activity.id, activityKind: activity.kind, purpose: activity.purpose,
          curriculumVersion: path.version, rubricVersion: path.rubric.version,
        }).token,
      });
      const written: string[] = [];
      const submitAsPremium = async (activity = codeActivity) => {
        const res = response();
        const req = request('POST', `burst-${stamp}`, bodyFor(activity));
        await withRequestContext(req, res as never, async () => {
          await requestMemo(`tier:${burster}`, async () => 'premium');
          await handleActivitySubmit(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: { ...enrollmentRow('active'), user_id: burster } },
            rpc: (name) => { written.push(name); return ['accept_learning_path_result','accept_learning_path_coding_result'].includes(name) ? { data: { ok: true, replayed: false } } : {}; },
          }));
        });
        return res;
      };
      const graded = (res: Captured) => res.statusCode === 200 && Boolean((res.body as SubmitActivityResponse | undefined)?.code);
      const hold = (activityId: string) => enterInFlight(request('POST', `burst-${stamp}`, {}), 'grading',
        { item: gradingItem.activity('fde', activityId), perItem: GRADING_PER_TASK, perCaller: GRADING_PER_CALLER }, `user:${burster}`);
      const grading = Array.from({ length: GRADING_PER_TASK }, () => hold(codeActivity.id));
      let res = await submitAsPremium();
      if (res.statusCode !== 429 || code(res) !== 'grader_busy') fail(`a submit past the learner's grading limit on one activity answers ${res.statusCode} ${code(res)}, not 429 grader_busy`);
      if (written.length > 0) fail(`a submit the grader did not take wrote ${written.join(', ')}`);
      res = await submitAsPremium(otherCode);
      if (!graded(res)) fail(`a full activity held up a submit on another activity: ${res.statusCode} ${code(res)}`);
      // The ceiling: GRADING_PER_CALLER grading across two activities.
      const more = Array.from({ length: GRADING_PER_CALLER - GRADING_PER_TASK }, () => hold(otherCode.id));
      res = await submitAsPremium(otherCode);
      if (res.statusCode !== 429 || code(res) !== 'grader_busy') fail(`a submit past the learner's grading ceiling answers ${res.statusCode} ${code(res)}, not 429 grader_busy`);
      grading[0]?.();
      res = await submitAsPremium();
      if (!graded(res)) fail(`once one of the learner's submits is answered the next is graded, not ${res.statusCode} ${code(res)}`);
      grading[1]?.();
      for (const done of more) done?.();
    } finally {
      if (switchBefore === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
      else process.env.LEARNING_PATH_FDE_ENABLED = switchBefore;
    }

    /* ── a verified code pass and the coin routines after it ─────────── */
    // #587, server item 8: settle_coin_milestones credits only inside
    // `IF is_premium(...)` (migration 052), so after a verified pass a free
    // account (here a lapsed one resubmitting a passed exercise) skips it and
    // a Premium account still runs it. The XP coin credit runs for both.
    // #587, server item 20: the tier of a Premium activity is asked before
    // the enrollment read answers, the progress rows are read while the
    // grader runs (and once, when the plan check's "already passed" exception
    // read them first), and the XP credit and the settlement run together.
    {
      const passer = `user-paths-pass-${stamp}`;
      const codeModule = path.modules.find((module) => module.activities.some((activity) => activity.id === codeActivity.id))!;
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      const passAs = async (tier: 'free' | 'premium', tag: string) => {
        const calls: string[] = [];
        // What the handler asked for, in order: the tier (a subscription to
        // the remembered tier answer), the enrollment read, the progress read.
        const order: string[] = [];
        let watching = false;
        class WatchedTier<T> extends Promise<T> {
          static get [Symbol.species]() { return Promise; }
          then<A = T, B = never>(onDone?: ((value: T) => A | PromiseLike<A>) | null, onFail?: ((reason: unknown) => B | PromiseLike<B>) | null) {
            if (watching) order.push('tier');
            return super.then(onDone, onFail);
          }
        }
        // Whether the progress read was issued while this submit held its
        // grading slot: a probe for one more slot with a ceiling of one is
        // refused exactly then.
        let progressDuringGrading: boolean | null = null;
        let progressReads = 0;
        const probe = () => {
          const slot = enterInFlight(request('POST', `pass-probe-${stamp}`, {}), 'grading',
            { item: gradingItem.activity('fde', codeActivity.id), perItem: 1_000, perCaller: 1 }, `user:${passer}`);
          slot?.();
          return slot === null;
        };
        // The XP credit answers once the settlement has started, or after
        // 300 ms: run one after the other, the settlement starts only then.
        let settleStarted: () => void = () => {};
        const settling = new Promise<void>((resolve) => { settleStarted = resolve; });
        let creditWaited = false;
        const req = request('POST', `pass-${tag}-${stamp}`, {
          user_id: passer,
          session: encodeLearningPathSession({
            attemptId: `PASS${tag}${stamp}`.padEnd(20, 'a'), enrollmentId, userId: passer, pathId: 'fde',
            activityId: codeActivity.id, activityKind: codeActivity.kind, purpose: codeActivity.purpose,
            curriculumVersion: path.version, rubricVersion: path.rubric.version,
          }).token,
          idempotencyKey: `KEYpass${tag}${stamp}`.slice(0, 24).padEnd(24, 'a'),
          code: solutionFor(codeActivity.id)!.solution,
        });
        const res = response();
        await withRequestContext(req, res as never, async () => {
          void requestMemo(`tier:${passer}`, () => new WatchedTier<'free' | 'premium'>((resolve) => resolve(tier)));
          watching = true;
          await handleActivitySubmit(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: { ...enrollmentRow('active'), user_id: passer } },
            lists: { learning_path_progress: [{ module_id: codeModule.id, activity_states: { [codeActivity.id]: { state: 'verified_pass', score: 1 } }, completed_at: null }] },
            onQuery: (table, op) => {
              if (op !== 'select') return;
              if (table === 'learning_path_enrollments') order.push('enrollment');
              if (table === 'learning_path_progress') {
                order.push('progress');
                progressReads += 1;
                progressDuringGrading ??= probe();
              }
            },
            rpc: async (name, params) => {
              calls.push(name);
              if (name.startsWith('accept_learning_path')) {
                const packet = (params.p_accept ?? params) as { p_result: SubmitActivityResponse };
                return { data: { ok: true, replayed: false, result: { ...packet.p_result, xpAwarded: 20 }, coding: { xpKind: 'first' } } };
              }
              if (name === 'settle_coin_milestones') settleStarted();
              if (name === 'credit_verified_xp_tokens' && tier === 'premium') {
                creditWaited = await Promise.race([settling.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 300))]);
              }
              return { data: name === 'credit_verified_xp_tokens' ? 2 : {} };
            },
          }));
        });
        watching = false;
        return { res, calls, order, progressDuringGrading, progressReads, creditWaited };
      };
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const free = await passAs('free', 'free');
        if (free.res.statusCode !== 200 || (free.res.body as SubmitActivityResponse).state !== 'verified_pass') {
          fail(`a lapsed account's verified pass answered ${free.res.statusCode} ${JSON.stringify(free.res.body).slice(0, 200)}`);
        }
        if (!free.calls.includes('credit_verified_xp_tokens')) fail(`a free account's verified pass credited no XP coins: ${free.calls.join(', ')}`);
        if (free.calls.includes('settle_coin_milestones')) fail('a free account ran settle_coin_milestones, which credits only Premium accounts');
        const premium = await passAs('premium', 'prem');
        if (premium.res.statusCode !== 200) fail(`a Premium verified pass answered ${premium.res.statusCode} ${code(premium.res)}`);
        if (!premium.calls.includes('credit_verified_xp_tokens') || !premium.calls.includes('settle_coin_milestones')) {
          fail(`a Premium verified pass must credit its XP coins and settle the milestones: ${premium.calls.join(', ')}`);
        }
        // Item 20, on the Premium submit (no "already passed" read).
        const firstTier = premium.order.indexOf('tier');
        if (firstTier < 0 || firstTier > premium.order.indexOf('enrollment')) {
          fail(`the tier of a Premium activity was not asked beside the enrollment read: ${premium.order.join(' > ')}`);
        }
        if (premium.progressDuringGrading !== true) fail('the progress rows were read after grading, not while the grader ran');
        if (premium.progressReads !== 1) fail(`a submit read its progress rows ${premium.progressReads} times`);
        if (premium.creditWaited) fail('the XP coin credit and the milestone settlement ran one after the other');
        // On the lapsed account the plan check's "already passed" exception
        // read the rows before grading, and the projection reuses that read.
        if (free.progressReads !== 1) fail(`a lapsed account's submit read its progress rows ${free.progressReads} times, not once`);
        // A plan that cannot be read is not "free": the routine runs and decides.
        const unread: string[] = [];
        await settleMilestonesAfterPass(fakeSupabase({ rpc: (name) => { unread.push(name); return { data: {} }; } }), passer, 'webdev',
          async () => { throw new Error('entitlement_unavailable'); });
        if (!unread.includes('settle_coin_milestones')) fail('an unreadable plan skipped settle_coin_milestones instead of letting it decide');
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a lesson, check or write-up submit reads its rows beside the enrollment ── */
    // #587, server item 20: outside a code activity the progress rows are
    // read beside the enrollment read, not after it, scoped to the caller's
    // own rows; a paused enrollment still answers 409 and writes nothing.
    {
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const reader = `user-paths-rows-${stamp}`;
        const lesson = path.modules.filter((module) => !isOffLoopModule(module)).flatMap((module) => module.activities).find((activity) => activity.kind === 'lesson')!;
        for (const status of ['active', 'paused'] as const) {
          const events: string[] = [];
          const progressScope: unknown[][] = [];
          const written: string[] = [];
          const req = request('POST', `rows-${status}-${stamp}`, {
            user_id: reader,
            session: encodeLearningPathSession({
              attemptId: `ROWS${status}${stamp}`.slice(0, 20).padEnd(20, 'a'), enrollmentId, userId: reader, pathId: 'fde',
              activityId: lesson.id, activityKind: lesson.kind, purpose: lesson.purpose,
              curriculumVersion: path.version, rubricVersion: path.rubric.version,
            }).token,
            idempotencyKey: `KEYrows${status}${stamp}`.slice(0, 24).padEnd(24, 'a'),
            acknowledged: true,
          });
          const res = response();
          await withRequestContext(req, res as never, async () => {
            await requestMemo(`tier:${reader}`, async () => 'premium');
            await handleActivitySubmit(req, res as never, fakeSupabase({
              rows: { learning_path_enrollments: { ...enrollmentRow(status), user_id: reader } },
              lists: { learning_path_progress: [] },
              onQuery: (table, op, args) => {
                if (op === 'select') events.push(`select ${table}`);
                if (op === 'maybeSingle') events.push(`answered ${table}`);
                if (table === 'learning_path_progress' && op === 'eq') progressScope.push(args);
              },
              rpc: (name) => { written.push(name); return name.startsWith('accept_learning_path') ? { data: { ok: true, replayed: false } } : {}; },
            }));
          });
          const reads = events.filter((one) => one === 'select learning_path_progress').length;
          // A paused enrollment may have spent the early read; it uses nothing of it.
          if (status === 'active' ? reads !== 1 : reads > 1) fail(`a ${status} lesson submit read its progress rows ${reads} times`);
          if (events.indexOf('select learning_path_progress') > events.indexOf('answered learning_path_enrollments')) {
            fail(`a lesson submit read its progress rows after the enrollment answered: ${events.join(' > ')}`);
          }
          if (!progressScope.some((args) => args[0] === 'user_id' && args[1] === reader)
              || !progressScope.some((args) => args[0] === 'enrollment_id' && args[1] === enrollmentId)) {
            fail(`the early progress read was not scoped to the caller's own enrollment rows: ${JSON.stringify(progressScope)}`);
          }
          if (status === 'active') {
            if (res.statusCode !== 200 || (res.body as SubmitActivityResponse).state !== 'self_reviewed') fail(`a lesson submit answered ${res.statusCode} ${JSON.stringify(res.body).slice(0, 200)}`);
          } else {
            if (res.statusCode !== 409 || code(res) !== 'enrollment_paused') fail(`a lesson submit to a paused enrollment answered ${res.statusCode} ${code(res)}`);
            if (written.length > 0) fail(`a lesson submit to a paused enrollment wrote ${written.join(', ')}`);
          }
        }
      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── a resubmitted write-up, and the requirements a submit sends ──── */
    // An FDE module that requires a written piece, already completed: the
    // piece submitted in full, every other requirement met. The learner sends
    // it again with every field empty. The plan check reads Premium here.
    {
      const fde = LEARNING_PATHS.find((path) => path.id === 'fde')!;
      const module = fde.modules.find((one) => !isOffLoopModule(one)
        && one.requires.some((requirement) => one.activities.find((activity) => activity.id === requirement.activityId)?.kind === 'artifact'))!;
      const writeUp = module.activities.find((activity) => activity.kind === 'artifact' && module.requires.some((one) => one.activityId === activity.id))!;
      const fdeEnrollment = `FDEENROLL${stamp}`.padEnd(20, 'a');
      const fdeSession = encodeLearningPathSession({
        attemptId: `FDEATTEMPT${stamp}`.padEnd(20, 'a'),
        enrollmentId: fdeEnrollment,
        userId: learner,
        pathId: 'fde',
        activityId: writeUp.id,
        activityKind: writeUp.kind,
        purpose: writeUp.purpose,
        curriculumVersion: fde.version,
        rubricVersion: fde.rubric.version,
      }).token;
      const recorded = Object.fromEntries(module.requires.map((requirement) => [requirement.activityId, {
        state: requirement.state, score: requirement.state === 'verified_pass' ? 1 : null,
        verification: requirement.state === 'verified_pass' ? 'machine_verified' : 'self_reviewed', attempts: 1, updatedAt: '2026-09-01T00:00:00Z',
      }]));
      const fdeRow = { ...enrollmentRow('active'), enrollment_id: fdeEnrollment, path_id: 'fde', curriculum_version: fde.version, base_track_at_enrollment: 'fullstack' };
      const submitWriteUp = async (rpc: (name: string, params: Record<string, unknown>) => { data?: unknown; error?: unknown }) => {
        const res = response();
        const req = request('POST', `writeup-${stamp}`, { user_id: learner, session: fdeSession, idempotencyKey: 'KEYwriteup0123456789ab', artifact: {} });
        await withRequestContext(req, res as never, async () => {
          await requestMemo(`tier:${learner}`, async () => 'premium');
          await handleActivitySubmit(req, res as never, fakeSupabase({
            rows: { learning_path_enrollments: fdeRow },
            lists: { learning_path_progress: [{ module_id: module.id, activity_states: recorded, completed_at: '2026-09-01T00:00:00Z' }] },
            rpc,
          }));
        });
        return res;
      };
      const fdeSwitch = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        const sent: Record<string, unknown>[] = [];
        let res = await submitWriteUp((_name, params) => { sent.push(params); return { data: { ok: true, replayed: false, revision: 2 } }; });
        const answer = res.body as SubmitActivityResponse | undefined;
        const projected = answer?.module?.activities.find((activity) => activity.activityId === writeUp.id);
        if (res.statusCode !== 200 || answer?.state !== 'needs_revision') {
          fail(`an empty resubmission of ${writeUp.id} answers ${res.statusCode} ${answer?.state ?? JSON.stringify(res.body)}, not 200 needs_revision`);
        }
        if (projected?.state !== 'self_reviewed' || answer?.module?.completed !== true) {
          fail(`an empty resubmission of a submitted write-up projects it as ${projected?.state} (module completed: ${answer?.module?.completed}), not self_reviewed in a completed module`);
        }
        if (sent[0]?.p_state !== 'needs_revision') fail(`the weaker attempt is recorded as ${String(sent[0]?.p_state)}, not needs_revision evidence`);
        const requirements = module.requires.map((one) => one.activityId);
        const sentRequirements = sent[0]?.p_module_requires as { activityId: string; states: string[] }[] | undefined;
        if (JSON.stringify(sentRequirements) !== JSON.stringify(moduleRequirements(module))
            || sentRequirements?.map((one) => one.activityId).join() !== requirements.join()
            || !sentRequirements?.find((one) => one.activityId === writeUp.id)?.states.includes('self_reviewed')) {
          fail(`a submit sends the requirements ${JSON.stringify(sentRequirements)}, not ${module.id}'s own`);
        }

        // A database without migration 054 has no requirements parameter: the
        // result is recorded without it rather than refused.
        sent.length = 0;
        res = await submitWriteUp((_name, params) => {
          sent.push(params);
          return 'p_module_requires' in params
            ? { error: { code: 'PGRST202', message: 'Could not find the function public.accept_learning_path_result(p_artifact, p_attempt_id, p_criteria, p_domain_scores, p_idempotency_key, p_module_complete, p_module_id, p_module_requires, p_request_hash, p_result, p_score, p_state, p_user_id, p_verification_kind) in the schema cache' } }
            : { data: { ok: true, replayed: false, revision: 2 } };
        });
        if (res.statusCode !== 200 || sent.length !== 2 || 'p_module_requires' in (sent[1] ?? {})) {
          fail(`before migration 054 a submit answers ${res.statusCode} after ${sent.length} calls, not 200 after a second call without p_module_requires`);
        }      } finally {
        if (fdeSwitch === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = fdeSwitch;
      }
    }

    /* ── any-N completion requires the atomic quota routine ─────────── */
    {
      const fde = LEARNING_PATHS.find(path => path.id === 'fde')!;
      const module = fde.modules.find(one => one.requiresAtLeast)!;
      const check = module.activities.find(one => one.kind === 'check')!;
      const key = check.questions!.map(one => one.correct);
      const id = `QUOTAENROLL${stamp}`.padEnd(20, 'a');
      const token = encodeLearningPathSession({ attemptId: `QUOTAATTEMPT${stamp}`.padEnd(20, 'a'),
        enrollmentId: id, userId: learner, pathId: 'fde', activityId: check.id,
        activityKind: 'check', purpose: check.purpose, curriculumVersion: fde.version,
        rubricVersion: fde.rubric.version, answerKey: key }).token;
      const before = process.env.LEARNING_PATH_FDE_ENABLED;
      try {
        process.env.LEARNING_PATH_FDE_ENABLED = 'true';
        for (const installed of [true, false]) {
          const calls: { name: string; params: Record<string, unknown> }[] = [];
          const req = request('POST', `quota-${stamp}-${installed}`, { user_id: learner,
            session: token, idempotencyKey: 'KEYquota0123456789abcd', answers: key });
          const res = response();
          await withRequestContext(req, res as never, async () => {
            await requestMemo(`tier:${learner}`, async () => 'premium');
            await handleActivitySubmit(req, res as never, fakeSupabase({
              rows: { learning_path_enrollments: { ...enrollmentRow('active'), enrollment_id: id, path_id: 'fde', curriculum_version: fde.version } },
              rpc: (name, params) => {
                calls.push({ name, params });
                return installed ? { data: { ok: true, replayed: false } }
                  : { error: { code: 'PGRST202', message: 'Could not find the function public.accept_learning_path_quota_result in the schema cache' } };
              },
            }));
          });
          const packet = calls[0]?.params.p_accept as Record<string, unknown> | undefined;
          const quota = calls[0]?.params.p_module_quota as { count: number; of: string[]; states: string[] } | undefined;
          if (calls.length !== 1 || calls[0]?.name !== 'accept_learning_path_quota_result'
              || JSON.stringify(packet?.p_module_requires) !== JSON.stringify(moduleRequirements(module))
              || quota?.count !== 9 || quota.of.length !== 12 || JSON.stringify(quota.states) !== '["verified_pass"]') {
            fail(`quota submit sent the wrong completion packet: ${JSON.stringify(calls)}`);
          }
          if (installed ? res.statusCode !== 200 : res.statusCode !== 503 || code(res) !== 'migration_required') {
            fail(`quota routine installed=${installed}: ${res.statusCode} ${code(res)}`);
          }
        }
      } finally {
        if (before === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = before;
      }
    }

    /* ── a preference save that cannot read the saved answers ─────────── */
    {
      const writes: unknown[] = [];
      const updateUserById = async (...args: unknown[]) => { writes.push(args); return { data: {}, error: null }; };
      const put = { user_id: learner, baseTrack: 'frontend', specialization: null };
      let res = response();
      await handleLearningPreference(
        request('PUT', `pref-${stamp}`, put, { headers: { authorization: 'Bearer test' } }),
        res as never,
        fakeSupabase({ auth: { getUserById: async () => ({ data: { user: null }, error: { message: 'upstream timeout', status: 504 } }), updateUserById } }),
      );
      if (res.statusCode !== 503) fail(`a preference save whose read failed answers ${res.statusCode}, not 503`);
      if (writes.length !== 0) fail('a preference save whose read failed still wrote the account, over the saved answers');

      // With the read answering, a partial save keeps the saved answers. The
      // stored record still carries the skill-path list that E5 (#496)
      // retired; the save drops it rather than refuse the account.
      const saved = {
        schemaVersion: 2, baseTrack: 'backend', specialization: null, skillPaths: ['retired-skill-path'],
        goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: '2026-09-01T00:00:00Z',
      };
      res = response();
      await handleLearningPreference(
        request('PUT', `pref-${stamp}`, put, { headers: { authorization: 'Bearer test' } }),
        res as never,
        fakeSupabase({ auth: { getUserById: async () => ({ data: { user: { user_metadata: { [LEARNER_PROFILE_META_KEY]: saved } } }, error: null }), updateUserById } }),
      );
      const written = (writes.at(-1) as [string, { user_metadata: Record<string, { goals?: string[] }> }] | undefined)?.[1]?.user_metadata;
      const profile = written ? Object.values(written).find((value) => Array.isArray(value?.goals)) : undefined;
      if (res.statusCode !== 200 || JSON.stringify(profile?.goals) !== JSON.stringify(['level-up'])) {
        fail(`a partial preference save answered ${res.statusCode} and wrote goals ${JSON.stringify(profile?.goals)}, not the saved ones`);
      }
      if (profile && 'skillPaths' in profile) fail('a preference save kept the retired skillPaths field');

      // Learn sections (#487): a save may carry the opt-in sections, a save
      // without them keeps the saved list, and an unknown section is refused
      // before anything is written.
      const profileWritten = () => {
        const meta = (writes.at(-1) as [string, { user_metadata: Record<string, { goals?: string[]; sections?: string[] }> }] | undefined)?.[1]?.user_metadata;
        return meta ? Object.values(meta).find((value) => Array.isArray(value?.goals)) : undefined;
      };
      const reading = (stored: Record<string, unknown>) => fakeSupabase({
        auth: { getUserById: async () => ({ data: { user: { user_metadata: { [LEARNER_PROFILE_META_KEY]: stored } } }, error: null }), updateUserById },
      });
      res = response();
      await handleLearningPreference(
        request('PUT', `pref-sections-${stamp}`, { ...put, sections: ['software-engineer', 'software-engineer'] }, { headers: { authorization: 'Bearer test' } }),
        res as never,
        reading(saved),
      );
      if (res.statusCode !== 200 || JSON.stringify(profileWritten()?.sections) !== JSON.stringify(['software-engineer'])) {
        fail(`a save with sections answered ${res.statusCode} and wrote ${JSON.stringify(profileWritten()?.sections)}, not ['software-engineer']`);
      }
      res = response();
      await handleLearningPreference(
        request('PUT', `pref-keep-${stamp}`, put, { headers: { authorization: 'Bearer test' } }),
        res as never,
        reading({ ...saved, sections: ['software-engineer'] }),
      );
      if (res.statusCode !== 200 || JSON.stringify(profileWritten()?.sections) !== JSON.stringify(['software-engineer'])) {
        fail(`a save without sections answered ${res.statusCode} and wrote ${JSON.stringify(profileWritten()?.sections)}, not the saved list`);
      }
      const before = writes.length;
      for (const sections of [['data-scientist'], 'software-engineer', ['software-engineer', 7]]) {
        res = response();
        await handleLearningPreference(
          request('PUT', `pref-bad-${stamp}`, { ...put, sections }, { headers: { authorization: 'Bearer test' } }),
          res as never,
          reading(saved),
        );
        if (res.statusCode !== 400) fail(`a save with sections ${JSON.stringify(sections)} answers ${res.statusCode}, not 400`);
      }
      if (writes.length !== before) fail('a save with unknown sections still wrote the account');
    }

    /* ── the path reward ──────────────────────────────────────────────── */
    {
      const claims: Record<string, unknown>[] = [];
      const claim = { user_id: learner, pathId: 'fde', shirt: ' m ', name: ' Ann ', line1: 'x'.repeat(120), line2: 'y'.repeat(120), city: 'Brno', postal: '60200', country: 'cz' };

      // Merchandise is paused until next quarter (owner decision 10). A
      // finished path's read and claim both answer 404 merch_unavailable, and
      // neither reaches the database, whatever the progress rows say.
      if (MERCH_ENABLED) fail('merchandise ships switched off until next quarter (MERCH_ENABLED)');
      for (const [method, body, extra] of [
        ['GET', { user_id: learner }, { query: { pathId: 'fde' } }],
        ['POST', claim, {}],
      ] as const) {
        const touched: string[] = [];
        const paused = response();
        await handlePathReward(request(method, `reward-paused-${stamp}`, body, extra), paused as never, fakeSupabase({
          rows: { path_reward_claims: { order_id: 'reward-0123456789abcdef01234567' } },
          rpc: (name) => { touched.push(name); return { data: [{ granted: true, reward_order_id: 'reward-x', already: false }] }; },
        }));
        if (paused.statusCode !== 404 || code(paused) !== 'merch_unavailable' || touched.length > 0) {
          fail(`a ${method} path-reward request while merchandise is paused answers ${paused.statusCode} ${code(paused)} after ${touched.length} database calls, not 404 merch_unavailable`);
        }
      }
      // A signed-out request is still asked to sign in first.
      {
        const anonymous = response();
        await handlePathReward(request('POST', `reward-anon-${stamp}`, { pathId: 'fde' }), anonymous as never, fakeSupabase({}));
        if (anonymous.statusCode !== 401) fail(`a signed-out path-reward claim answers ${anonymous.statusCode}, not 401`);
      }

      // The rest drives the claim as it comes back with the switch on.
      const pathRewardOn = (...args: Parameters<typeof handlePathReward>) => handlePathReward(args[0], args[1], args[2], true);
      // A second claim that lost the race to the first one's claim row.
      let res = response();
      await pathRewardOn(request('POST', `reward-${stamp}`, claim), res as never, fakeSupabase({
        rows: { path_reward_claims: { order_id: 'reward-0123456789abcdef01234567' } },
        rpc: (_name, params) => {
          claims.push(params);
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint "path_reward_claims_pkey"' } };
        },
      }));
      const answer = res.body as { granted?: boolean; already?: boolean; orderId?: string } | undefined;
      if (res.statusCode !== 200 || answer?.granted !== false || answer?.already !== true || answer?.orderId !== 'reward-0123456789abcdef01234567') {
        fail(`a raced second reward claim answers ${res.statusCode} ${JSON.stringify(res.body)}, not the first claim's order`);
      }
      // The claim is checked for the curriculum version this deployment
      // publishes, with the fields trimmed and the codes in capitals.
      const sent = claims[0] ?? {};
      if (sent.p_curriculum_version !== path.version || sent.p_shirt !== 'M' || sent.p_name !== 'Ann' || sent.p_country !== 'CZ'
          || String(sent.p_line1).length !== 120) {
        fail(`a reward claim sends ${JSON.stringify({ ...sent, p_line1: String(sent.p_line1).length, p_line2: String(sent.p_line2).length })}`);
      }

      // An address the package cannot be posted to is refused with what to
      // fix, and never cut to fit or sent to the database: a line longer than
      // merch_orders holds (120), a country that is not an ISO 3166-1 code, a
      // size the shop does not print.
      const refusals: Array<[string, Record<string, unknown>, string, RegExp]> = [
        ['a 121-character street', { line1: 'x'.repeat(121) }, 'invalid_address', /street/],
        ['a 121-character second line', { line2: 'y'.repeat(121) }, 'invalid_address', /second address line/],
        ['a 121-character town', { city: 'z'.repeat(121) }, 'invalid_address', /town/],
        ['a 121-character postcode', { postal: '1'.repeat(121) }, 'invalid_address', /postcode/],
        ['a missing name', { name: '  ' }, 'invalid_address', /name/],
        ['the country ZZ', { country: 'ZZ' }, 'invalid_address', /ISO code/],
        ['the country UK', { country: 'UK' }, 'invalid_address', /ISO code/],
        ['the country "CZE"', { country: 'CZE' }, 'invalid_address', /ISO code/],
        ['the shirt size XXLARGE', { shirt: 'XXLARGE' }, 'bad_request', /shirt size/],
      ];
      for (const [label, change, expected, message] of refusals) {
        const called: string[] = [];
        res = response();
        await pathRewardOn(request('POST', `reward-${stamp}`, { ...claim, ...change }), res as never, fakeSupabase({
          rpc: (name) => { called.push(name); return { data: [{ granted: true, reward_order_id: 'reward-x', already: false }] }; },
        }));
        const error = (res.body as { error?: { code?: string; message?: string } } | undefined)?.error;
        if (res.statusCode !== 400 || error?.code !== expected || !message.test(error?.message ?? '') || called.length > 0) {
          fail(`a reward claim with ${label} answers ${res.statusCode} ${JSON.stringify(res.body)} after ${called.length} database calls, not 400 ${expected}`);
        }
      }

      // Before migration 054 neither routine takes the version: the call is
      // made again without it.
      const tried: Record<string, unknown>[] = [];
      res = response();
      await pathRewardOn(request('GET', `reward-${stamp}`, { user_id: learner }, { query: { pathId: 'fde' } }), res as never, fakeSupabase({
        rpc: (_name, params) => {
          tried.push(params);
          return 'p_curriculum_version' in params
            ? { error: { code: 'PGRST202', message: 'Could not find the function public.path_is_complete(p_curriculum_version, p_modules, p_path_id, p_user_id) in the schema cache' } }
            : { data: true };
        },
      }));
      if (res.statusCode !== 200 || (res.body as { eligible?: boolean }).eligible !== true || tried.length !== 2 || tried[0].p_curriculum_version !== path.version) {
        fail(`a reward read before migration 054 answers ${res.statusCode} ${JSON.stringify(res.body)} after ${tried.length} calls`);
      }
      // A field the table's CHECK refuses is the learner's address, not a 500.
      res = response();
      await pathRewardOn(request('POST', `reward-${stamp}`, claim), res as never, fakeSupabase({
        rpc: () => ({ error: { code: '23514', message: 'new row for relation "merch_orders" violates check constraint "merch_orders_ship_postal_check"' } }),
      }));
      if (res.statusCode !== 400 || code(res) !== 'invalid_address') {
        fail(`a reward address the table refuses answers ${res.statusCode} ${code(res)}, not 400 invalid_address`);
      }
    }

    /* ── rate limits are the learner's own ────────────────────────────── */
    // A class works through one address. Each learner's budget is their own,
    // one learner is still bounded, and the address backstop holds the class.
    // A submit's budget is per activity (owner decision 9), so its calls
    // carry a session for the activity.
    const activities = path.modules.flatMap((module) => module.activities);
    const sessionFor = (user: string, activity: (typeof activities)[number]) => encodeLearningPathSession({
      attemptId: `RATE${stamp}`.padEnd(20, 'a'), enrollmentId, userId: user, pathId: 'fde',
      activityId: activity.id, activityKind: activity.kind, purpose: activity.purpose,
      curriculumVersion: path.version, rubricVersion: path.rubric.version,
    }).token;
    const submitOn = async (user: string, address: string, activity = codeActivity) => {
      const res = response();
      await handleActivitySubmit(request('POST', address, { user_id: user, session: sessionFor(user, activity) }), res as never, null);
      return res.statusCode;
    };
    type Call = (user: string, address: string) => Promise<number>;
    const cases: { name: string; per: { capacity: number }; call: Call }[] = [
      {
        name: 'start',
        per: RATE_LIMITS.learningPathStart,
        call: async (user, address) => { const res = response(); await handleActivityStart(request('POST', address, { user_id: user }), res as never, null); return res.statusCode; },
      },
      {
        name: 'submit',
        per: RATE_LIMITS.learningPathSubmit,
        call: (user, address) => submitOn(user, address),
      },
      {
        name: 'draft',
        per: RATE_LIMITS.learningPathDraft,
        call: async (user, address) => { const res = response(); await handlePathDraft(request('PUT', address, { user_id: user }), res as never, fakeSupabase({})); return res.statusCode; },
      },
      {
        name: 'enrollment',
        per: RATE_LIMITS.learningPathEnroll,
        call: async (user, address) => { const res = response(); await handleEnrollment(request('POST', address, { user_id: user }), res as never, fakeSupabase({})); return res.statusCode; },
      },
    ];
    for (const one of cases) {
      // Every seat of a class spends its whole budget from one address.
      const classroom = `classroom-${one.name}-${stamp}`;
      let refused = 0;
      for (let n = 0; n < SHARED_NETWORK_SEATS; n += 1) {
        for (let call = 0; call < one.per.capacity; call += 1) {
          if ((await one.call(`user-seat-${one.name}-${stamp}-${n}`, classroom)) === 429) refused += 1;
        }
      }
      if (refused > 0) fail(`${one.name}: ${refused} calls of a class of ${SHARED_NETWORK_SEATS} behind one address met a 429`);
      // One learner past their own budget is refused; the next one on the same
      // address is not.
      const desk = `desk-${one.name}-${stamp}`;
      for (let call = 0; call < one.per.capacity; call += 1) await one.call(`user-first-${one.name}-${stamp}`, desk);
      if ((await one.call(`user-first-${one.name}-${stamp}`, desk)) !== 429) fail(`${one.name}: one learner is not bounded by their own budget`);
      if ((await one.call(`user-second-${one.name}-${stamp}`, desk)) === 429) fail(`${one.name}: one learner's spent budget refused another learner on the same address`);
    }

    // Per activity, beneath a ceiling: a learner who spent one activity's
    // submits still submits another, and no learner submits past the ceiling
    // across all of them.
    {
      const desk = `desk-per-activity-${stamp}`;
      const user = `user-per-activity-${stamp}`;
      for (let call = 0; call < RATE_LIMITS.learningPathSubmit.capacity; call += 1) await submitOn(user, desk);
      if ((await submitOn(user, desk)) !== 429) fail('one activity\'s submits are not bounded');
      if ((await submitOn(user, desk, activities.find((activity) => activity.id !== codeActivity.id)!)) === 429) fail('one activity\'s spent submits refused another activity');
      const { capacity: ceiling, refillPerSecond } = RATE_LIMITS.learningPathSubmitCeiling;
      if (activities.length * RATE_LIMITS.learningPathSubmit.capacity <= ceiling) fail('the path has too few activities to reach the ceiling');
      const started = Date.now();
      let through = 0;
      while (through <= ceiling + 20 && (await submitOn(`user-ceiling-${stamp}`, `desk-ceiling-${stamp}`, activities[through % activities.length])) !== 429) through += 1;
      // A slow run may refill a token or two.
      const slack = Math.ceil(((Date.now() - started) / 1000) * refillPerSecond) + 1;
      if (through < ceiling || through > ceiling + slack) fail(`submits spread across activities stop at the ceiling of ${ceiling}, not after ${through}`);
    }
  });
}
