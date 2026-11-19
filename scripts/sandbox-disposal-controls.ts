// Exercise the real worker's disposal observer and done producer. Faults stay
// in an owned build; no learner binding or fabricated done reply is added.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Plugin } from 'esbuild';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';

export async function runSandboxDisposalControls(): Promise<void> {
  const root = realpathSync(process.cwd());
  await buildSandboxWorker();
  const { pinnedQuickJSBundle } = await import(pathToFileURL(join(root, 'scripts/quickjs-bundle.mjs')).href) as { pinnedQuickJSBundle(): Plugin };
  const sandboxPath = join(root, 'lib/coding/sandbox.ts');
  const entryPath = join(root, 'scripts/sandbox-worker-entry.ts');
  const normalWorker = join(root, 'lib/coding/generated/quickjs-sandbox.cjs');
  const source = readFileSync(sandboxPath, 'utf8');
  const entry = readFileSync(entryPath, 'utf8');
  const allocation = '  const runtime = QuickJS.newRuntime();';
  const observer = 'runInQuickJS(message.input, () => { healthy = false; })';
  const marker = 'F11 disposal control: real runtime disposed\n';
  assert.equal(source.split(allocation).length, 2, 'fault the actual SDK runtime boundary exactly once');
  assert.ok(!source.includes('__f11RealDispose'));
  const faulty = "import { writeSync as __f11WriteDisposalMarker } from 'node:fs';\n" + source.replace(allocation,
    allocation + '\n  const __f11RealDispose = runtime.dispose.bind(runtime);\n' +
    '  runtime.dispose = () => { __f11RealDispose(); __f11WriteDisposalMarker(2, ' + JSON.stringify(marker) + "); throw new Error('controlled disposal failure after the real disposer'); };" );
  type Observation = { mode: string; resultPassed: boolean; retired: boolean; live: number; idle: number; recoveryPassed: boolean; recoveredLive: number; recoveredIdle: number };
  const requireRetirement = (one: Observation) => {
    assert.equal(one.resultPassed, true);
    assert.equal(one.retired, true, 'the worker with a real disposal fault must physically retire');
    assert.deepEqual([one.live, one.idle], [0, 0]);
    assert.equal(one.recoveryPassed, true, 'the next real worker grades after retirement');
    assert.deepEqual([one.recoveredLive, one.recoveredIdle], [1, 1]);
  };
  const child = `import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { runInSandbox, sandboxPool, sandboxThreads } from ${JSON.stringify(sandboxPath)};
const config=JSON.parse(process.argv[2]);
const good={code:'const next=n=>n+1;',calls:['next(1)'],expectations:[2]};
const check=one=>{assert.equal(one.codeError,null);assert.equal(one.timedOut,false);assert.deepEqual(one.logs,[]);assert.deepEqual(one.results,[{pass:true,actual:'2',error:null}]);};
check(await runInSandbox(good));
assert.ok(sandboxThreads()>=1||config.mode==='fault','the actual worker path supplied the result');
let retired=false,recoveryPassed=false,recoveredLive=-1,recoveredIdle=-1;
if(config.mode!=='normal'){
  const began=Date.now();
  while(sandboxThreads()>0&&Date.now()-began<1000)await new Promise(resolve=>setTimeout(resolve,20));
  retired=sandboxThreads()===0&&sandboxPool().idle===0;
}
const live=sandboxThreads(),idle=sandboxPool().idle;
if(config.mode==='normal'||(config.mode==='fault'&&retired)){
  if(config.mode==='fault')copyFileSync(config.normalWorker,'lib/coding/generated/quickjs-sandbox.cjs');
  check(await runInSandbox(good));recoveryPassed=true;recoveredLive=sandboxThreads();recoveredIdle=sandboxPool().idle;
}
console.log(JSON.stringify({mode:config.mode,resultPassed:true,retired,live,idle,recoveryPassed,recoveredLive,recoveredIdle}));`;
  const run = (file: string, cwd: string, mode: string): Promise<{ observation: Observation; stderr: string }> => new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [file, JSON.stringify({ mode, normalWorker })], {
      cwd, env: { NODE_ENV: 'development', VERCEL: '1', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', guarded = false, overflow = false;
    const guard = setTimeout(() => { guarded = true; processChild.kill('SIGKILL'); }, 30_000);
    processChild.stdout.on('data', (part: Buffer) => { stdout += part.toString(); if (Buffer.byteLength(stdout) > 65_536) { overflow = true; processChild.kill('SIGKILL'); } });
    processChild.stderr.on('data', (part: Buffer) => { stderr += part.toString(); if (Buffer.byteLength(stderr) > 65_536) { overflow = true; processChild.kill('SIGKILL'); } });
    processChild.on('error', error => { clearTimeout(guard); reject(error); });
    processChild.on('close', (code, signal) => {
      clearTimeout(guard);
      try {
        assert.equal(guarded, false, 'the disposal child must settle before its external fixture guard');
        assert.equal(overflow, false); assert.equal(signal, null); assert.equal(code, 0, stderr);
        resolve({ observation: JSON.parse(stdout), stderr });
      } catch (error) { reject(error); }
    });
  });
  let owned: string | undefined;
  try {
    owned = mkdtempSync(join(tmpdir(), 'devshark-sandbox-disposal-'));
    symlinkSync(join(root, 'node_modules'), join(owned, 'node_modules'), 'dir');
    for (const mode of ['normal', 'fault', 'disabled-health'] as const) {
      const cwd = join(owned, mode), worker = join(cwd, 'lib/coding/generated/quickjs-sandbox.cjs');
      mkdirSync(join(cwd, 'lib/coding/generated'), { recursive: true });
      if (mode === 'normal') copyFileSync(normalWorker, worker);
      else {
        if (mode === 'disabled-health') assert.equal(entry.split(observer).length, 2, 'disable only the real worker disposal observer');
        const fault: Plugin = { name: 'controlled-real-runtime-disposal', setup(context) {
          context.onLoad({ filter: /\.ts$/ }, args => {
            if (args.path === sandboxPath) return { contents: faulty, loader: 'ts' };
            if (args.path === entryPath && mode === 'disabled-health') return { contents: entry.replace(observer, 'runInQuickJS(message.input)'), loader: 'ts' };
            return undefined;
          });
        } };
        await build({ entryPoints: [entryPath], outfile: worker, absWorkingDir: root,
          bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning',
          metafile: true, plugins: [fault, pinnedQuickJSBundle()],
        });
      }
      const outfile = join(owned, mode + '.mjs');
      await build({ stdin: { contents: child, resolveDir: root, loader: 'js' }, outfile,
        bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24', logLevel: 'warning' });
      const observed = await run(outfile, cwd, mode), one = observed.observation;
      assert.equal(one.mode, mode); assert.equal(one.resultPassed, true);
      assert.equal(observed.stderr, mode === 'normal' ? '' : marker, 'the real SDK disposer must return before the single controlled fault');
      if (mode === 'normal') {
        assert.deepEqual([one.live, one.idle, one.recoveredLive, one.recoveredIdle], [1, 1, 1, 1]);
        assert.equal(one.recoveryPassed, true);
        console.log('PASS sandbox disposal: ordinary real worker keeps its correct result and healthy reuse');
      } else if (mode === 'fault') {
        requireRetirement(one);
        console.log('PASS sandbox disposal: real worker disposal fault preserves verdict, physically retires and recovers');
      } else {
        assert.throws(() => requireRetirement(one), assert.AssertionError, 'the same retirement oracle catches a disabled actual observer');
        assert.deepEqual([one.live, one.idle, one.retired], [1, 1, false]);
        console.log('PASS sandbox disposal: disabling only the actual done-producer health callback fails retirement');
      }
    }
  } finally {
    if (owned) rmSync(owned, { recursive: true, force: true });
  }
}
