import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { buildReactCompileWorker } from './build-react-compile-worker.mjs';
import { pinnedQuickJSBundle } from './quickjs-bundle.mjs';

// The QuickJS grader's worker thread (lib/coding/sandbox.ts).
export const sandboxBundle = await buildSandboxWorker();
await buildReactCompileWorker();

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const snapshotPackages = ['react', 'react-dom', 'jsdom', '@testing-library/react', '@testing-library/dom', 'sucrase'];
const expectedVersions = Object.fromEntries(snapshotPackages.map(name => {
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (typeof version !== 'string') throw new Error(`Missing locked React grader dependency ${name}`);
  return [name, version];
}));

// The grader's own code runs in strict mode, as its ES module sources were
// written: a stack trace the component reads then hands out no grader
// function or receiver.
export const guestBundle = await build({
  entryPoints: ['scripts/react-sandbox-entry.ts'],
  outfile: 'lib/coding/generated/react-sandbox.cjs',
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', target: 'node24',
  banner: { js: '"use strict";' },
  define: { __SNAPSHOT_VERSIONS__: JSON.stringify(expectedVersions) },
  // Keep the reviewed loader/FFI/custom payload; drop unused defaults only.
  metafile: true,
  plugins: [pinnedQuickJSBundle()],
});

// The SDK's transitive dependencies include ESM-only packages. Vercel's
// CommonJS runtime must not depend on Node's experimental require(ESM) flag.
await build({
  entryPoints: ['@vercel/sandbox'],
  outfile: 'lib/coding/generated/vercel-sandbox.cjs',
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
});

// Reproduce the deployed CommonJS boundary, even on newer local Node versions
// where require(ESM) would otherwise hide this packaging regression.
execFileSync(process.execPath, [
  '--no-experimental-require-module', '-e',
  'if (!require("./lib/coding/generated/vercel-sandbox.cjs").Sandbox) process.exit(1)',
], { stdio: 'inherit' });

// Passive data with a .cjs suffix so the existing generated-file inclusion
// carries it. Read/parse this JSON string; never require or evaluate it.
const runnerDigest = createHash('sha256').update(readFileSync('lib/coding/generated/react-sandbox.cjs')).digest('hex');
writeFileSync('lib/coding/generated/react-sandbox.sha256.cjs', JSON.stringify(runnerDigest) + '\n');
