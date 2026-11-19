// Real Coding handler and path grading body; only the isolated
// runner is replaced by the test bundler with a trusted GraderBusyError.
import { handleCodingSubmit } from '../../lib/coding/handlers';
import { createCodingSession } from '../../lib/coding/session';
import { CODING_TASKS } from '../../lib/coding/catalog';
import { solutionFor } from '../../lib/coding/solutions';
import { isFreeCodingTask } from '../../shared/tiers';
import { evolvingStage } from '../../shared/evolving';
import { gradePathCodeWith } from '../../lib/learning-paths/grade';
import { GraderBusyError } from '../../lib/coding/grader-capacity';
import type { MergedCode } from '../../lib/learning-paths/types';

console.log = () => {}; console.warn = () => {}; console.error = () => {};
const transportBlocked = () => { throw Object.assign(new Error('test_network_forbidden'), { control: 'unexpected_network' }); };
globalThis.fetch = transportBlocked;
const check = (condition: unknown, control: string): void => {
  if (!condition) throw Object.assign(new Error('fixed_control_failure'), { control });
};
let writes = 0;
const result = (data: unknown) => Promise.resolve({ data, error: null });
const write = () => { writes++; return result(null); };
const database = {
  from() {
    const chain = { select: () => chain, eq: () => chain, in: () => chain,
      maybeSingle: () => result(null), then: (done: (one: unknown) => unknown) => done({ data: [], error: null }),
      insert: write, upsert: write, update: write, delete: write };
    return chain;
  },
  rpc: write,
};
async function main() {
  const learner = 'f11-35-local-only';
  const task = CODING_TASKS.find(one => one.track === 'react' && one.verify === 'tests' && one.suite && isFreeCodingTask(one.id) && !evolvingStage(one.id));
  check(task && solutionFor(task.id), 'missing_react_fixture');
  const headers = new Map<string, string>();
  const out = { statusCode: 200, body: null as null | { error?: { code?: string } }, setHeader(key: string, value: string) { headers.set(key.toLowerCase(), value); }, status(status: number) { this.statusCode = status; return this; }, json(body: never) { this.body = body; return this; } };
  await handleCodingSubmit({ method: 'POST', headers: { authorization: 'Bearer local-test', 'x-forwarded-for': '203.0.113.77' }, query: {},
    body: { user_id: learner, session: createCodingSession({ taskId: task!.id, track: 'react', userId: learner }), code: solutionFor(task!.id)!.solution },
  } as never, out as never, database as never);
  check(out.statusCode === 503, 'coding_status');
  check(out.body?.error?.code === 'grader_busy', 'coding_error_code');
  check(headers.get('retry-after') === '7', 'coding_retry_after');
  check(writes === 0, 'coding_recorded');
  const code: MergedCode = { language: 'react', prompt: '', starter: '', hints: [], tests: [], typeTests: [], criteria: [], suite: '' };
  const busy = new GraderBusyError('react_compile_queue_full', 7);
  let thrown: unknown;
  try { await gradePathCodeWith(code, undefined, 'unused trusted source', async () => { throw busy; }); }
  catch (error) { thrown = error; }
  check(thrown === busy, 'path_propagation');
  process.stdout.write(JSON.stringify({ status: 'passed', codingStatus: out.statusCode, retryAfter: headers.get('retry-after'), writes, pathPropagatedSameError: true }) + '\n');
}
main().catch(error => {
  const control = typeof error?.control === 'string' ? error.control : 'unexpected_fixture_failure';
  process.stdout.write(JSON.stringify({ status: 'failed', control, writes }) + '\n'); process.exitCode = 1;
});
