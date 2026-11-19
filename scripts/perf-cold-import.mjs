// Loaded dynamically only after --local has been selected.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { arch, cpus, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { bundleColdEntry } from './cold-start-bundle.mjs';

export const F7_MARKERS = ['lib/rewards/handlers.ts', 'lib/learning-paths/catalog.ts', 'lib/learning-paths/content/fde.ts', 'lib/learning-paths/validate.ts', 'lib/coding/active.ts', 'lib/coding/ts-check-pool.ts', 'lib/coding/solutions/index.ts', 'lib/learning-paths/handlers.ts', 'lib/learn-lessons/serve.ts', 'lib/learn-lessons/index.ts'];
const worker = join(dirname(fileURLToPath(import.meta.url)), 'perf-cold-import-worker.cjs');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export async function localImports(config, root, { probes, summarize }) {
  // Reuse the established CommonJS/packages-external compilation boundary.
  const { version: esbuildVersion } = await import('esbuild');
  const parent = join(root, 'node_modules/.cache/shark');
  mkdirSync(parent, { recursive: true });
  const owned = mkdtempSync(join(parent, 'cold-start-lab-'));
  const rows = []; const artifacts = [];
  const markers = config.markers ? F7_MARKERS : [];
  try {
    for (const id of config.ids) {
      const probe = probes.find(item => item.id === id);
      const artifact = join(owned, `${id}.cjs`);
      const compileStarted = performance.now();
      try { await bundleColdEntry(probe.file, artifact, markers, root, true); }
      catch {
        artifacts.push({ handler: id, sourceSha256: hash(join(root, probe.file)), error: 'compile_failed', compileWallMs: performance.now() - compileStarted });
        for (let sample = 0; sample < config.samples; sample++) rows.push({ handler: id, sample, ok: false, skipped: true, reason: 'compile_failed', error: 'compile_failed' });
        continue;
      }
      artifacts.push({ handler: id, sourceSha256: hash(join(root, probe.file)), artifactSha256: hash(artifact), artifactBytes: statSync(artifact).size, compileWallMs: performance.now() - compileStarted });
      for (let sample = 0; sample < config.samples; sample++) {
        const started = performance.now();
        // Explicit environment: no inherited NODE_OPTIONS, HOME, provider,
        // billing, Sentry, proxy, Sandbox, Auth or local .env configuration.
        const child = spawnSync(process.execPath, [worker, artifact, JSON.stringify(markers)], { cwd: root, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', NODE_ENV: 'development', NODE_PATH: join(root, 'node_modules'), TZ: 'UTC' }, encoding: 'utf8', timeout: 15000, maxBuffer: 1 << 20 });
        const childProcessWallMs = performance.now() - started;
        let value;
        try { value = JSON.parse(child.stdout.trim().split('\n').at(-1)); } catch { /* untrusted log text is not printed */ }
        const shape = value && ['importWallMs', 'heapBeforeBytes', 'heapAfterBytes', 'heapDeltaBytes'].every(name => Number.isFinite(value[name])) && Number.isFinite(value.cpu?.userMicros) && Number.isFinite(value.cpu?.systemMicros) && Array.isArray(value.packages) && Array.isArray(value.markers) && Number.isInteger(value.deniedAttempts);
        rows.push({ handler: id, sample, childProcessWallMs, ...(child.status === 0 && shape ? value : { ok: false, error: child.error?.code === 'ETIMEDOUT' ? 'child_timeout' : 'child_result_invalid' }) });
      }
    }
    return { mode: 'fresh-process-cjs-import-proxy', rows, artifacts, summary: summarize(rows), totals: { planned: config.ids.length * config.samples, attempted: rows.filter(row => row.error !== 'compile_failed').length, sent: 0, skipped: rows.filter(row => row.error === 'compile_failed').length }, compilation: { esbuildVersion, target: 'shared helper default; no override', bundle: true, platform: 'node', format: 'cjs', packages: 'external', markers }, environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? null, rootLockSha256: hash(join(root, 'package-lock.json')), clientLockSha256: hash(join(root, 'client/package-lock.json')), childEnvironmentKeys: ['PATH', 'NODE_ENV', 'NODE_PATH', 'TZ'] }, notes: ['Import wall/CPU/heap are sampled around require only, after network-denial setup; compilation and child-process wall are separate', 'No request handler or first business operation is invoked', 'Fresh process is a local synchronous CJS import proxy, never deployed platform boot; OS file caches are not controlled', 'Heap deltas are unforced-GC snapshots, not retained-memory or listener-leak evidence', 'Module markers change the measured artifact; compare only matching marker configurations', 'Denied transport/process attempts make the sample fail even if imported code catches the denial'] };
  } finally { rmSync(owned, { recursive: true, force: true }); }
}
