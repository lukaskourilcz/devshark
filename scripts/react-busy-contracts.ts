import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

/** The red stage needs neither the future pool nor its worker artifact. */
export async function checkReactBusyContracts(): Promise<void> {
  const root = process.cwd(), temporary = mkdtempSync(join(tmpdir(), 'devshark-react-busy-'));
  const coding = join(root, 'lib/coding/handlers.ts'), pathGrade = join(root, 'lib/learning-paths/grade.ts');
  const isolated = join(root, 'lib/coding/react-isolated.ts');
  const codingGuard = "    if (error instanceof GraderBusyError) throw error;\n    // The runtime itself could not start; that is ours, not the learner's.";
  const pathGuard = '    if (error instanceof GraderBusyError) throw error;\n    // The runtime itself could not start. That is infrastructure, not the';
  try {
    for (const mutation of ['none', 'coding-catch', 'path-catch']) {
      const output = join(temporary, mutation + '.cjs');
      await build({ entryPoints: [join(root, 'scripts/fixtures/react-busy-control.ts')], outfile: output,
        bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', logLevel: 'silent',
        plugins: [{ name: 'trusted-react-busy-control', setup(builder) {
          builder.onLoad({ filter: /\.(?:ts|tsx)$/ }, args => {
            if (args.path === isolated) return { loader: 'ts', resolveDir: join(root, 'lib/coding'),
              contents: "import { GraderBusyError } from './grader-capacity'; export async function runIsolatedReactSuite(){ throw new GraderBusyError('react_compile_queue_full',7); }" };
            if ((mutation === 'coding-catch' && args.path === coding) || (mutation === 'path-catch' && args.path === pathGrade)) {
              const text = readFileSync(args.path, 'utf8'), guard = mutation === 'coding-catch' ? codingGuard : pathGuard;
              assert.equal(text.split(guard).length, 2, 'the one newly added React rethrow is the only mutation target');
              return { loader: 'ts', resolveDir: mutation === 'coding-catch' ? join(root, 'lib/coding') : join(root, 'lib/learning-paths'),
                contents: text.replace(guard, guard.replace('    if (error instanceof GraderBusyError) throw error;\n', '')) };
            }
            return undefined;
          });
        } }],
      });
      const child = spawnSync(process.execPath, [output], { cwd: root,
        env: { PATH: process.env.PATH ?? '', NODE_PATH: join(root, 'node_modules'), NODE_ENV: 'test', SESSION_SECRET: 'f11-35-static-local-test-secret-0000000000000' },
        timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 32_768, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(child.error, undefined, 'control child must start and finish before its watchdog');
      assert.equal(child.signal, null);
      const report = JSON.parse(child.stdout.trim());
      if (mutation === 'none') {
        assert.equal(child.status, 0, JSON.stringify(report)); assert.equal(report.status, 'passed'); assert.equal(report.writes, 0);
      } else {
        assert.equal(child.status, 1); assert.equal(report.status, 'failed');
        assert.equal(report.control, mutation === 'coding-catch' ? 'coding_status' : 'path_propagation');
        assert.equal(report.writes, 0);
      }
    }
    console.log('PASS integrity: React busy propagates to 503/Retry-After without Coding writes; either swallowed catch is rejected');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
