import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { REACT_COMPILE_WORKER_FILE, REACT_COMPILE_DEADLINE_MS, REACT_COMPILE_BOOT_MS, REACT_COMPILE_MAX_WAITING, REACT_COMPILE_SLOT_WAIT_MS, compileReactOnWorker, reactCompilePool } from '../lib/coding/react-compile-pool';
import { compileReactLearner } from '../lib/coding/react-transpile';
import { CODING_TASKS } from '../lib/coding/catalog';
import { solutionFor } from '../lib/coding/solutions';

/** Deterministic lifecycle controls complement the real Submit heartbeat.
 * Every child starts a fresh pool, fake clock and fake Worker. */
export async function checkReactCompilePoolContracts(): Promise<void> {
  assert.deepEqual(reactCompilePool(), { idle: 0, live: 0, retiring: 0 }, 'importing the compiler pool creates no thread');
  assert.deepEqual([REACT_COMPILE_DEADLINE_MS, REACT_COMPILE_BOOT_MS, REACT_COMPILE_MAX_WAITING, REACT_COMPILE_SLOT_WAIT_MS], [4000, 6000, 32, 4000]);
  const root = process.cwd(), temporary = mkdtempSync(join(tmpdir(), 'devshark-react-compile-controls-'));
  const bundle = join(temporary, 'pool.cjs');
  try {
    await build({ stdin: { contents: "export * from './lib/coding/react-compile-pool'; export { GraderBusyError } from './lib/coding/grader-capacity';", resolveDir: root, loader: 'ts' },
      outfile: bundle, bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node22', logLevel: 'silent' });
    const scenarios = ['reuse', 'deadline', 'duplicate-start', 'boot', 'constructor', 'nested', 'oom', 'compiler-fail', 'ordinary-error', 'premature-done', 'malformed-done', 'send-fail', 'exit', 'queue', 'reject-termination', 'resolve-without-exit', 'idle-error', 'fallback'];
    for (const scenario of scenarios) {
      const directory = join(temporary, scenario);
      mkdirSync(join(directory, 'lib/coding/generated'), { recursive: true });
      writeFileSync(join(directory, REACT_COMPILE_WORKER_FILE), '// placeholder, never executed by FakeWorker\n');
      const result = execFileSync(process.execPath, [join(root, 'scripts/fixtures/react-compile-pool-control.cjs'), scenario, bundle, directory], {
        cwd: directory, env: { PATH: process.env.PATH ?? '', NODE_PATH: join(root, 'node_modules'), NODE_ENV: 'test', VERCEL: '1' },
        timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 32_768, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      const report = JSON.parse(result.trim()); assert.equal(report.status, 'passed'); assert.equal(report.scenario, scenario);
    }
    // Product packaging already includes all .cjs files. Do not broaden it.
    const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
    assert.match(config.functions['api/quiz/roadmap.ts'].includeFiles, /lib\/coding\/generated\/\*\.cjs/);
    assert.match(readFileSync(join(root, 'scripts/build-react-runner.mjs'), 'utf8'), /await buildReactCompileWorker\(\)/);
    console.log(`PASS integrity: React compile pool deadline, boot, queue, fallback, recovery and actual-exit lease (${scenarios.length} isolated controls)`);
    // Exercise the actual normal-built worker and its external TypeScript
    // resolution, in addition to simulated lifecycle faults. Compare complete
    // emitted JavaScript with the unchanged converter; no source is evaluated.
    let checked = 0;
    for (const task of CODING_TASKS.filter(one => one.track === 'react' && one.verify === 'tests')) {
      const solution = solutionFor(task.id);
      assert.ok(solution, `${task.id}: authored solution required`);
      for (const [kind, source] of Object.entries({ starter: task.starter, reference: solution.solution, junior: solution.junior, senior: solution.senior })) {
        if (!source) continue;
        const expected = compileReactLearner(source);
        const actual = await compileReactOnWorker(source);
        assert.ok('js' in actual, `${task.id}/${kind}: normal conversion must finish`);
        assert.equal(actual.js, expected, `${task.id}/${kind}: complete compiler output stays identical`);
        checked++;
      }
    }
    assert.ok(checked > 0);
    const noExecution = await compileReactOnWorker('throw new Error("compiler must not evaluate source"); export default function App(){return null;}');
    assert.ok('js' in noExecution && noExecution.js.includes('compiler must not evaluate source'));
    assert.deepEqual(reactCompilePool(), { idle: 1, live: 1, retiring: 0 });
    console.log(`PASS integrity: actual normal-built compiler preserves all ${checked} authored React source outputs and converts without evaluating source`);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
