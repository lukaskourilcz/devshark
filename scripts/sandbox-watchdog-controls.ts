// Strict host-watchdog coverage independent of QuickJS's polling frequency.
// Every file and child below is owned by this test; production source is read-only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

export async function runSandboxWatchdogControls(options: { longestRunMs: number; exitWaitMs: number }): Promise<void> {
  const root = process.cwd();
  const owned = mkdtempSync(join(tmpdir(), 'devshark-sandbox-watchdog-'));
  const sandboxPath = join(root, 'lib/coding/sandbox.ts');
  const realWorker = join(root, 'lib/coding/generated/quickjs-sandbox.cjs');
  const timer = '        timer = setTimeout(() => finish(stopped(TIMEOUT_MESSAGE, true)), (input.deadlineMs ?? SANDBOX_DEADLINE_MS) + SANDBOX_WORKER_GRACE_MS);';
  const source = readFileSync(sandboxPath, 'utf8');
  assert.equal(source.split(timer).length, 2, 'the negative must disable the actual parent grace timer');
  const spinner = `const { parentPort } = require('node:worker_threads');
parentPort.on('message', message => {
  if (message?.type !== 'run') return;
  parentPort.postMessage({ type: 'start' });
  while (true) {}
});
`;
  const child = `import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { runInSandbox, sandboxPool, sandboxThreads, SANDBOX_DEADLINE_MS, SANDBOX_WORKER_GRACE_MS } from ${JSON.stringify(sandboxPath)};
import { TIMEOUT_MESSAGE } from ${JSON.stringify(join(root, 'shared/coding-evaluate.ts'))};
const config = JSON.parse(process.argv[2]);
// Keep the fixture alive if its deliberately disabled timer never returns.
const keepAlive = setInterval(() => {}, 1000);
try {
  const began = Date.now(), mono = process.hrtime.bigint();
  const result = await runInSandbox({ code: '', calls: [], expectations: [] });
  const took = Date.now() - began, monoMs = Number(process.hrtime.bigint() - mono) / 1e6;
  assert.deepEqual(result, { results: [], logs: [], codeError: TIMEOUT_MESSAGE, timedOut: true });
  assert.ok(took >= SANDBOX_DEADLINE_MS + SANDBOX_WORKER_GRACE_MS - 20, 'the actual parent waited its deadline and grace');
  assert.ok(monoMs >= SANDBOX_DEADLINE_MS + SANDBOX_WORKER_GRACE_MS - 20, 'monotonic time confirms the parent grace');
  assert.ok(took <= config.longestRunMs && monoMs <= config.longestRunMs, 'the original upper margin is preserved');
  const exitBegan = Date.now();
  while (sandboxThreads() > 0 && Date.now() - exitBegan < config.exitWaitMs) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(sandboxThreads(), 0, 'the stopped fixture actually exited within one second');
  assert.equal(sandboxPool().idle, 0, 'the spinner was not kept idle');
  copyFileSync(config.realWorker, 'lib/coding/generated/quickjs-sandbox.cjs');
  const next = await runInSandbox({ code: 'const next = n => n + 1;', calls: ['next(1)'], expectations: [2] });
  assert.deepEqual(next.results, [{ pass: true, actual: '2', error: null }]);
  assert.equal(next.codeError, null); assert.equal(next.timedOut, false);
  assert.equal(sandboxThreads(), 1, 'recovery used an actual QuickJS worker');
  console.log(JSON.stringify({ kind: 'host-watchdog-passed', took, monoMs, stoppedThreads: 0, recovered: true }));
} finally { clearInterval(keepAlive); }
`;
  type ChildReceipt = { code: number | null; signal: NodeJS.Signals | null; guarded: boolean; stdout: string; stderr: string };
  const run = async (file: string, cwd: string): Promise<ChildReceipt> => await new Promise<ChildReceipt>((resolve, reject) => {
    const processChild = spawn(process.execPath, [file, JSON.stringify({ ...options, realWorker })], {
      cwd, env: { NODE_ENV: 'development', VERCEL: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let guarded = false, overflow = false, stdout = '', stderr = '';
    const guard = setTimeout(() => { guarded = true; processChild.kill('SIGKILL'); }, options.longestRunMs + options.exitWaitMs);
    processChild.stdout.on('data', (part: Buffer) => { stdout += part.toString(); if (Buffer.byteLength(stdout) > 65_536) { overflow = true; processChild.kill('SIGKILL'); } });
    processChild.stderr.on('data', (part: Buffer) => { stderr += part.toString(); if (Buffer.byteLength(stderr) > 262_144) { overflow = true; processChild.kill('SIGKILL'); } });
    processChild.on('error', (error) => { clearTimeout(guard); reject(error); });
    processChild.on('close', (code, signal) => {
      clearTimeout(guard);
      if (overflow) reject(new Error('watchdog fixture output exceeded its bound'));
      else resolve({ code, signal, guarded, stdout, stderr });
    });
  });
  try {
    symlinkSync(join(root, 'node_modules'), join(owned, 'node_modules'), 'dir');
    for (const disableWatchdog of [false, true]) {
      const mode = disableWatchdog ? 'disabled' : 'normal';
      const cwd = join(owned, mode);
      mkdirSync(join(cwd, 'lib/coding/generated'), { recursive: true });
      writeFileSync(join(cwd, 'lib/coding/generated/quickjs-sandbox.cjs'), spinner);
      const outfile = join(owned, mode + '.mjs');
      await build({ stdin: { contents: child, resolveDir: root, loader: 'js', sourcefile: 'sandbox-watchdog-control.mjs' },
        outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node22', logLevel: 'warning',
        plugins: disableWatchdog ? [{ name: 'disable-the-actual-parent-watchdog', setup(context) {
          context.onLoad({ filter: /sandbox\.ts$/ }, (args) => args.path === sandboxPath ? { contents: source.replace(timer, '        timer = undefined; // test-only negative: no parent grace timer'), loader: 'ts' } : undefined);
        } }] : [],
      });
      const observed = await run(outfile, cwd);
      if (disableWatchdog) {
        assert.equal(observed.guarded, true, 'disabling the actual parent watchdog must hit the bounded fixture guard');
        assert.equal(observed.signal, 'SIGKILL');
        assert.equal(observed.stdout, '', 'the disabled watchdog cannot report a successful timeout/recovery');
        assert.equal(observed.stderr, '', 'a startup/SDK error is not the intended negative');
        console.log('PASS sandbox watchdog: disabling the actual parent timer is caught by the bounded fixture');
      } else {
        assert.equal(observed.guarded, false, 'the real parent watchdog finishes inside the fixture bound');
        assert.equal(observed.code, 0, observed.stderr);
        const result = JSON.parse(observed.stdout);
        assert.equal(result.kind, 'host-watchdog-passed'); assert.equal(result.recovered, true);
        console.log(`PASS sandbox watchdog: strict actual parent grace, physical exit and real QuickJS recovery (${result.took} ms)`);
      }
    }
  } finally { rmSync(owned, { recursive: true, force: true }); }
}
