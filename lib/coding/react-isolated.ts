import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
// Vercel's CommonJS function runtime may disable require(ESM). Bundle the SDK
// and its ESM dependencies at build time instead of relying on that Node flag.
const { Sandbox } = createRequire(join(process.cwd(), 'package.json'))(
  './lib/coding/generated/vercel-sandbox.cjs',
) as typeof import('@vercel/sandbox');
import type { ReactSuiteOutcome } from './react-runner';
import { GUEST_ENV, GUEST_NODE_FLAGS, readGuestRun, type GuestInput } from './react-guest';
import { compileReactLearner } from './react-transpile';
import { compileReactOnWorker } from './react-compile-pool';
import { FETCH_STUB_SOURCE } from '../../shared/coding-react-support';
import { LOCAL_FETCH_SOURCE } from '../../shared/coding-fullstack-support';
import { afterResponse } from './after-response';

// Keep operational diagnostics useful without logging learner code, SDK request
// bodies, credentials, or arbitrary error messages.
function runnerFailure(phase: string, cause?: unknown): Error {
  const error = new Error('React grading infrastructure is unavailable', { cause });
  const code = (cause as { code?: unknown } | undefined)?.code;
  const status = (cause as { response?: { status?: unknown } } | undefined)?.response?.status;
  const detail = code === 'ENOENT' ? 'MissingFile' :
    typeof status === 'number' && status >= 400 && status <= 599 ? `Http${status}` : '';
  error.name = `ReactRunner${phase}${detail}`;
  return error;
}

/** What a learner hears for code the compiler cannot convert because it
 * nests too deeply. */
export const NESTED_TOO_DEEPLY =
  'The compiler could not turn this code into JavaScript: it nests too deeply. Flatten the most deeply nested functions, calls or blocks and submit again.';

const deadline = (): ReactSuiteOutcome => ({
  cases: [],
  passed: 0,
  failed: 1,
  total: 1,
  compileError: null,
  timedOut: true,
});

/** How long the guest command may run: the learner's whole budget, node
 * start-up and the page runtime included. */
const COMMAND_TIMEOUT_MS = 10_000;

/** The fixture modules every run gets. Their sources are constants, so they
 * are converted once per instance rather than twice on every Submit. */
let compiledFixtureModules: Record<'./fetchStub' | './localFetch', string> | null = null;
const fixtures = () => compiledFixtureModules ??= {
  './fetchStub': compileReactLearner(FETCH_STUB_SOURCE, false),
  './localFetch': compileReactLearner(LOCAL_FETCH_SOURCE, false),
};

/** The exact guest bytes and passive same-build SHA-256 record are read once
 * per instance. Check copy integrity before starting any VM, then reuse the
 * verified Buffer. A failed read or check is not cached, so a repair retries.
 * This detects a copy mismatch; it does not prove build freshness or
 * authenticate an attacker who could replace both files. */
let runnerBytes: Promise<Buffer> | null = null;
const runnerArtifact = (): Promise<Buffer> =>
  runnerBytes ??= (async () => {
    const [runner, record] = await Promise.all([
      readFile(join(process.cwd(), 'lib/coding/generated/react-sandbox.cjs')),
      readFile(join(process.cwd(), 'lib/coding/generated/react-sandbox.sha256.cjs'), 'utf8'),
    ]).catch((error) => { throw runnerFailure('Artifact', error); });
    let expected: unknown;
    try { expected = JSON.parse(record); } catch { throw runnerFailure('ArtifactIntegrity'); }
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) ||
        createHash('sha256').update(runner).digest('hex') !== expected) {
      throw runnerFailure('ArtifactIntegrity');
    }
    return runner;
  })().catch((error) => {
    runnerBytes = null;
    throw error;
  });

/** No code, environment secrets, or writable state are shared between runs.
 * Authentication stays in this API process; only source + fixtures enter the
 * VM. No in-process fallback is allowed when infrastructure is unavailable.
 * A fresh nonce per run goes in with the input; the guest deletes the input
 * before learner code runs and marks its result with the nonce.
 */
export async function runIsolatedReactSuite(input: {
  suite: string;
  appSource: string;
}): Promise<ReactSuiteOutcome> {
  // Learner syntax conversion has a worker deadline before any VM starts.
  // Constant fixtures below retain their once-per-instance conversion.
  const compiled = await compileReactOnWorker(input.appSource);
  if ('nested' in compiled) return { cases: [], passed: 0, failed: 1, total: 1, compileError: NESTED_TOO_DEEPLY, timedOut: false };
  const compiledApp = compiled.js;
  const snapshotId = process.env.REACT_RUNNER_SNAPSHOT_ID;
  if (!snapshotId) throw runnerFailure('Configuration');
  const runner = await runnerArtifact();
  const signal = AbortSignal.timeout(22_000);
  const nonce = randomBytes(24).toString('hex');
  const compiledFixtures = fixtures();
  const credentials =
    process.env.VERCEL_TOKEN &&
    process.env.VERCEL_TEAM_ID &&
    process.env.VERCEL_PROJECT_ID
      ? {
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          projectId: process.env.VERCEL_PROJECT_ID,
        }
      : {};
  const sandbox = await Sandbox.create({
    ...credentials,
    source: { type: 'snapshot', snapshotId },
    persistent: false,
    networkPolicy: 'deny-all',
    timeout: 25_000,
    resources: { vcpus: 1 },
    signal,
  }).catch((error) => { throw runnerFailure('Startup', error); });
  // When the command's budget would have run out. The run's signal stops
  // everything at 22 s; it is the learner's timeout only when it fires while
  // their command has had its whole budget and is still going. Fired while
  // the files were written, the verdict was read, or a slow start left the
  // command less than its budget, it is ours: a timeout recorded against the
  // learner for a slow VM is a failed attempt they did not make.
  let commandBudgetEnds: number | null = null;
  try {
    await sandbox.writeFiles(
      [
        { path: '/vercel/sandbox/runner.cjs', content: runner },
        {
          path: '/vercel/sandbox/input.json',
          content: Buffer.from(JSON.stringify({ ...input, nonce, compiledApp, compiledFixtures } satisfies GuestInput)),
        },
      ],
      { signal },
    );
    commandBudgetEnds = Date.now() + COMMAND_TIMEOUT_MS;
    const command = await sandbox.runCommand({
      cmd: 'node',
      args: [...GUEST_NODE_FLAGS, '/vercel/sandbox/runner.cjs', '/vercel/sandbox/input.json'],
      env: { ...GUEST_ENV },
      timeoutMs: COMMAND_TIMEOUT_MS,
      signal,
    });
    commandBudgetEnds = null;
    if (command.exitCode === 137 || command.exitCode === 124) return deadline();
    // The verdict is the stdout line marked with this run's nonce, and a
    // guest that crashed after it started the learner's code was crashed by
    // that code (react-guest.ts). Nothing is read from the VM's filesystem.
    return readGuestRun(command.exitCode, await command.stdout({ signal }), nonce, input.suite);
  } catch (error) {
    if (signal.aborted && commandBudgetEnds !== null && Date.now() >= commandBudgetEnds) return deadline();
    throw runnerFailure(signal.aborted ? 'Deadline' : 'Execution', error);
  } finally {
    // A bounded cleanup call plus the VM's expiry covers lost connections too.
    // The stop is sent now; the verdict does not wait for its answer where
    // the runtime keeps the function alive for it (after-response.ts), so a
    // Submit is answered a Vercel API round trip sooner (#587, server item
    // 14). Elsewhere it is awaited here, as before.
    await afterResponse(sandbox.stop({ signal: AbortSignal.timeout(2_000) }));
  }
}
