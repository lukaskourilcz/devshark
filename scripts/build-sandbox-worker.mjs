// Bundles the QuickJS grader's worker thread (scripts/sandbox-worker-entry.ts)
// into one self-contained CommonJS file. QuickJS and its WebAssembly are
// inside it, so the deployed function needs nothing from node_modules to
// start the thread. build-react-runner.mjs runs this on every build, and the
// suites that grade code run it first so they exercise the same thread.
//
// It also bundles the TypeScript checker's worker thread
// (scripts/ts-check-worker-entry.ts, lib/coding/ts-check-pool.ts). The
// compiler stays in node_modules, where the roadmap function already has it.
import { build } from 'esbuild';
import { pinnedQuickJSBundle } from './quickjs-bundle.mjs';

export async function buildSandboxWorker() {
  const quickjsBundle = await build({
    entryPoints: ['scripts/sandbox-worker-entry.ts'],
    outfile: 'lib/coding/generated/quickjs-sandbox.cjs',
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
    metafile: true, plugins: [pinnedQuickJSBundle()],
  });
  await build({
    entryPoints: ['scripts/ts-check-worker-entry.ts'],
    outfile: 'lib/coding/generated/ts-check-worker.cjs',
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', packages: 'external',
  });
  return quickjsBundle;
}
