import './launch-test-env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { taskHash } from '../lib/curation';
import { complexityGuidance } from '../shared/coding-complexity';
import { solutionFor } from '../lib/coding/solutions';
import { nativeContentHash, nativeGradingHash } from '../lib/learning-paths/audit';
import { handleCodingSubmit, handleCodingTask } from '../lib/coding/handlers';
import { codingTaskById } from '../lib/coding/active';
import { codingAttemptVersion, createCodingSession } from '../lib/coding/session';
import { decodeCodingSession, decodeLearningPathSession, encodeCodingSession, encodeLearningPathSession } from '../lib/quiz-tokens';
import { handleActivityStart, handleActivitySubmit } from '../lib/learning-paths/handlers';
import { pathById } from '../lib/learning-paths/catalog';
import { createLearningPathSession, pathCodeAttemptVersion } from '../lib/learning-paths/session';
import { requestHash } from '../lib/learning-paths/grade';
import { requestMemo, withRequestContext } from '../lib/http';

const res = () => ({ statusCode: 200, body: null as unknown, setHeader() {}, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } });
const errorCode = (out: ReturnType<typeof res>) => (out.body as { error?: { code?: string } })?.error?.code;
const account = 'version-learner-0001';
const parent = 'version-parent-0123456789';
const task = codingTaskById('js-double-numbers')!;
const sessionInput = { taskId: task.id, track: task.track, userId: account };
// Immutable legacy tags with material-derived hashes, independent of today's issuers.
const legacyCodingVersion = createHash('sha256').update(JSON.stringify([
  'coding-attempt:v2', taskHash(task, solutionFor(task.id)), complexityGuidance(task),
])).digest('hex');
const savedCodingDraft = 'const double = ns => ns;';
let staleGradingMessages = 0;
const originalPostMessage = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (...args: Parameters<Worker['postMessage']>) {
  const message = args[0] as { type?: string; input?: { code?: string } };
  if (message?.type === 'run' && message.input?.code?.includes('while (true) {}')) staleGradingMessages++;
  return Reflect.apply(originalPostMessage, this, args);
};
const opened = createCodingSession(sessionInput);
const decoded = decodeCodingSession(opened)!;
assert.equal(decoded.version, codingAttemptVersion(task));
assert.ok(!opened.includes(decoded.version!), 'the grader fingerprint stays encrypted');
assert.equal(decodeCodingSession(encodeCodingSession({ ...sessionInput, version: 'not-a-version' })), null);

let writes = 0;
let completed = false;
const database = {
  from(table: string) {
    const chain = {
      select: () => chain, eq: () => chain,
      maybeSingle: async () => ({ data: table === 'roadmap_attempts' ? {
        user_id: account, completed_at: completed ? new Date().toISOString() : null,
        expires_at: new Date(Date.now() + 600_000).toISOString(), coding_task_ids: [task.id],
      } : table === 'coding_drafts' ? { code: savedCodingDraft, updated_at: '2026-11-19T10:00:00.000Z' } : null, error: null }),
      then: <T>(resolve: (value: unknown) => T) => resolve({ data: [], error: null }),
    };
    return chain;
  },
  rpc() { writes++; throw new Error('A stale attempt must not write'); },
};
const request = (session: string, user: string | null = account) => ({ method: 'POST', headers: user ? { authorization: 'Bearer local-version-test' } : {}, query: {}, body: { session, code: 'while (true) {}', ...(user ? { user_id: user } : {}) } });
if (process.argv[2] !== '--native-only') {
for (const token of [
  encodeCodingSession(sessionInput),
  encodeCodingSession({ ...sessionInput, version: '0'.repeat(64) }),
  encodeCodingSession({ ...sessionInput, version: legacyCodingVersion }),
]) {
  const out = res();
  await handleCodingSubmit(request(token) as never, out as never, database as never);
  assert.equal(out.statusCode, 409, JSON.stringify({ actual: out.body, writes, staleGradingMessages }));
  assert.equal(staleGradingMessages, 0, 'legacy sessions stop before the actual grading worker');
  assert.equal(errorCode(out), 'task_changed');
  assert.equal(writes, 0);
}
const beforePrompt = task.prompt;
try {
  task.prompt += '\nChanged authored requirement.';
  assert.notEqual(codingAttemptVersion(task), decoded.version);
  const out = res();
  await handleCodingSubmit(request(opened) as never, out as never, database as never);
  assert.equal(errorCode(out), 'task_changed');
  assert.equal(writes, 0);
} finally { task.prompt = beforePrompt; }
assert.equal(codingAttemptVersion(task), decoded.version);
const guest = res();
await handleCodingSubmit(request(encodeCodingSession({ ...sessionInput, userId: null }), null) as never, guest as never, database as never);
assert.equal(errorCode(guest), 'task_changed');
const foreign = res();
await handleCodingSubmit(request(opened, 'another-version-learner') as never, foreign as never, database as never);
assert.equal(errorCode(foreign), 'invalid_session', 'ownership is checked before version disclosure');

const linked = encodeCodingSession({ ...sessionInput, version: legacyCodingVersion, roadmapAttemptId: parent, attemptId: decoded.attemptId });
const rejected = res();
await handleCodingSubmit(request(linked) as never, rejected as never, database as never);
assert.equal(errorCode(rejected), 'task_changed');
assert.equal(writes, 0, 'the linked parent remains pending');
const refresh = res();
await handleCodingTask({ ...request(linked), query: { id: task.id } } as never, refresh as never, database as never);
assert.equal(refresh.statusCode, 200);
const renewed = decodeCodingSession((refresh.body as { session: string }).session)!;
assert.equal(renewed.version, codingAttemptVersion(task));
assert.equal(renewed.attemptId, decoded.attemptId);
assert.equal(renewed.roadmapAttemptId, parent);
assert.equal(renewed.userId, account);
assert.equal((refresh.body as { draft: string }).draft, savedCodingDraft);
assert.equal((refresh.body as { draftUpdatedAt: string }).draftUpdatedAt, '2026-11-19T10:00:00.000Z');
assert.equal(writes, 0);
completed = true;
const closed = res();
await handleCodingTask({ ...request(linked), query: { id: task.id } } as never, closed as never, database as never);
assert.equal(errorCode(closed), 'invalid_session', 'refresh cannot reopen an accepted parent');
console.log('PASS attempt versions: coding ownership, legacy/stale refusal before grading/writes, encrypted version and linked-parent refresh');
}
if (process.argv[2] === '--coding-only') process.exit(0);

// The FDE path, the only one published since E5 (#496): an authored
// JavaScript exercise binds its exact code version into the attempt.
process.env.LEARNING_PATH_FDE_ENABLED = 'true';
const path = pathById('fde')!;
const activity = path.modules.flatMap(module => module.activities).find(one => one.kind === 'code' && !one.reuseTaskId && one.code?.language === 'javascript')!;
assert.ok(activity, 'the FDE path publishes an authored JavaScript exercise');
const nativeInput = { attemptId: 'native-version-0123456789', enrollmentId: 'native-enroll-0123456789', userId: account, pathId: path.id, activityId: activity.id, activityKind: activity.kind, purpose: activity.purpose, curriculumVersion: path.version, rubricVersion: path.rubric.version };
assert.equal(decodeLearningPathSession(createLearningPathSession(nativeInput).token)?.version, pathCodeAttemptVersion(activity, path.rubric.version));
const legacyNativeVersion = createHash('sha256').update(JSON.stringify([
  'path-code-attempt:v2', path.rubric.version, nativeContentHash(activity), nativeGradingHash(activity),
])).digest('hex');
const savedNativeDraft = { code: 'const draftKept = true;' };
let accepted: Record<string, unknown> | null = { state: 'open', attempt_id: nativeInput.attemptId,
  user_id: account, enrollment_id: nativeInput.enrollmentId, activity_id: activity.id };
let openedAttempts = 0;
const nativeDb = {
  from(table: string) {
    const chain = { select: () => chain, eq: () => chain, then: <T>(resolve: (value: unknown) => T) => resolve({ data: [], error: null }), maybeSingle: async () => ({ data: table === 'learning_path_attempts' ? accepted : table === 'learning_path_enrollments' ? { enrollment_id: nativeInput.enrollmentId, user_id: account, path_id: path.id, curriculum_version: path.version, status: 'active' } : table === 'learning_path_drafts' ? { activity_id: activity.id, revision: 3, content: savedNativeDraft, updated_at: '2026-11-19T10:00:00.000Z' } : null, error: null }) };
    return chain;
  },
  rpc(name: string) { if (name === 'open_learning_path_attempt') { openedAttempts++; return { data: { ok: true }, error: null }; } writes++; throw new Error('A stale native attempt must not write'); },
};
for (const version of [undefined, '0'.repeat(64), legacyNativeVersion]) {
  const out = res();
  const req = { ...request(''), body: { user_id: account, session: encodeLearningPathSession({ ...nativeInput, version }).token, idempotencyKey: 'version-key-0123456789', code: 'while (true) {}' } };
  await withRequestContext(req as never, out as never, async () => {
    await requestMemo(`tier:${account}`, async () => 'premium');
    await handleActivitySubmit(req as never, out as never, nativeDb as never);
  });
  assert.equal(out.statusCode, 409, JSON.stringify({ actual: out.body, writes, staleGradingMessages }));
  assert.equal(errorCode(out), 'task_changed');
  assert.equal(staleGradingMessages, 0, 'native OPEN legacy sessions stop before the actual grading worker');
  assert.equal(writes, 0);
}
const beforeExpected = activity.code!.tests[0].expected;
const beforeVersion = pathCodeAttemptVersion(activity, path.rubric.version);
try {
  activity.code!.tests[0].expected = 'changed grading expectation';
  assert.notEqual(pathCodeAttemptVersion(activity, path.rubric.version), beforeVersion);
} finally { activity.code!.tests[0].expected = beforeExpected; }
console.log('PASS attempt versions: native exact code bindings and legacy/stale refusal before grading/evidence/XP');

const replayedResult = { activityId: activity.id, state: 'verified_pass', xpAwarded: 25 };
accepted = {
  state: 'accepted', user_id: account, enrollment_id: nativeInput.enrollmentId, activity_id: activity.id,
  idempotency_key: 'version-key-0123456789', request_hash: requestHash({ answers: null, code: 'while (true) {}', artifact: null, acknowledged: null }),
  accepted_result: replayedResult,
};
for (const sameWork of [true, false]) {
  const out = res();
  const req = { ...request(''), body: { user_id: account, session: encodeLearningPathSession({ ...nativeInput, version: legacyNativeVersion }).token, idempotencyKey: 'version-key-0123456789', code: sameWork ? 'while (true) {}' : 'different code' } };
  await withRequestContext(req as never, out as never, async () => {
    await requestMemo(`tier:${account}`, async () => 'premium');
    await handleActivitySubmit(req as never, out as never, nativeDb as never);
  });
  if (sameWork) assert.deepEqual(out.body, { ...replayedResult, replayed: true });
  else assert.equal(errorCode(out), 'idempotency_conflict');
  assert.equal(writes, 0);
}
// A result accepted before #485 stored its copy as { en, cs } pairs; the
// replay hands the English strings back and leaves test outcomes alone.
const legacyResult = {
  ...replayedResult,
  criteria: [{ id: 'core', label: { en: 'Required behaviour', cs: 'x' }, critical: true, weight: 1, passed: true, detail: null }],
  questions: null,
  feedback: [{ en: 'Read the explanation.', cs: 'x' }],
  code: { outcome: 'passed', results: [{ pass: true, actual: '{"en":"a","cs":"b"}', error: null }], hidden: null, check: null, logs: [], codeError: null },
};
accepted = { ...accepted, accepted_result: legacyResult };
{
  const out = res();
  const req = { ...request(''), body: { user_id: account, session: encodeLearningPathSession({ ...nativeInput, version: legacyNativeVersion }).token, idempotencyKey: 'version-key-0123456789', code: 'while (true) {}' } };
  await withRequestContext(req as never, out as never, async () => {
    await requestMemo(`tier:${account}`, async () => 'premium');
    await handleActivitySubmit(req as never, out as never, nativeDb as never);
  });
  assert.deepEqual(out.body, {
    ...legacyResult,
    criteria: [{ ...legacyResult.criteria[0], label: 'Required behaviour' }],
    feedback: ['Read the explanation.'],
    replayed: true,
  });
  assert.equal(writes, 0);
}
console.log('PASS attempt versions: accepted native replay survives catalogue changes, different work is refused, no repeated XP');

const renew = async (previousSession?: string) => {
  const out = res();
  const req = { ...request(''), body: { user_id: account, enrollmentId: nativeInput.enrollmentId, activityId: activity.id, ...(previousSession ? { previousSession } : {}) } };
  await withRequestContext(req as never, out as never, async () => {
    await requestMemo(`tier:${account}`, async () => 'premium');
    await handleActivityStart(req as never, out as never, nativeDb as never);
  });
  assert.equal(out.statusCode, 200, JSON.stringify(out.body));
  return out.body as { needsBriefReview?: boolean; session: string; draft: { activityId: string; content: unknown; revision: number } };
};
const previousCurrent = createLearningPathSession(nativeInput).token;
assert.equal((await renew(previousCurrent)).needsBriefReview, undefined);
const legacyRenewed = await renew(encodeLearningPathSession({ ...nativeInput, version: legacyNativeVersion }).token);
assert.equal(legacyRenewed.needsBriefReview, true);
const nativeRenewedSession = decodeLearningPathSession(legacyRenewed.session)!;
assert.notEqual(nativeRenewedSession.attemptId, nativeInput.attemptId, 'native renewal retains its existing replacement-attempt contract');
assert.equal(nativeRenewedSession.enrollmentId, nativeInput.enrollmentId);
assert.equal(nativeRenewedSession.activityId, nativeInput.activityId);
assert.equal(nativeRenewedSession.userId, account);
assert.deepEqual(legacyRenewed.draft, { activityId: activity.id, revision: 3, content: savedNativeDraft, updatedAt: '2026-11-19T10:00:00.000Z' });
const savedPrompt = activity.code!.prompt;
try {
  activity.code!.prompt += ' Changed authored requirement.';
  const renewed = await renew(previousCurrent);
  assert.equal(renewed.needsBriefReview, true, 'an automatic renewal cannot silently grade a changed brief');
  assert.equal(decodeLearningPathSession(renewed.session)?.version, pathCodeAttemptVersion(activity, path.rubric.version));
} finally { activity.code!.prompt = savedPrompt; }
assert.equal(openedAttempts, 3);
assert.equal(writes, 0);
console.log('PASS attempt versions: unchanged native renewal, legacy renewal and changed authored renewal before another Submit');

Worker.prototype.postMessage = originalPostMessage;
