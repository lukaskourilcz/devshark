import { build } from 'esbuild';

/** Matches the deployed Node/CommonJS boundary; TypeScript stays external. */
export async function buildReactCompileWorker() {
  await build({
    entryPoints: ['scripts/react-compile-worker-entry.ts'],
    outfile: 'lib/coding/generated/react-compile-worker.cjs',
    bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning', packages: 'external',
  });
}
