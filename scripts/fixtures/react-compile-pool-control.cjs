// Isolated child only: deterministic host lifecycle controls,
// with no learner evaluation, VM, deployment credentials or provider calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const threads = require('node:worker_threads');
const scenario = process.argv[2], bundle = process.argv[3], directory = process.argv[4];
process.chdir(directory);
process.env.NODE_ENV = 'test'; process.env.VERCEL = '1';
let now = 0, serial = 0;
const timers = new Map();
Date.now = () => now;
global.setTimeout = (run, delay = 0, ...args) => {
  const id = ++serial; timers.set(id, { at: now + Number(delay), run: () => run(...args) }); return id;
};
global.clearTimeout = id => { timers.delete(id); };
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
async function advance(ms) {
  const target = now + ms;
  while (true) {
    const next = [...timers].filter(([, one]) => one.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
    if (!next) break;
    timers.delete(next[0]); now = next[1].at; next[1].run(); await flush();
  }
  now = target; await flush();
}
let made = 0, live = 0, peak = 0, constructionFails = false;
const workers = [], plans = [];
class FakeWorker extends EventEmitter {
  constructor(_file, options) {
    super();
    assert.equal(options.resourceLimits.maxOldGenerationSizeMb, 256);
    if (constructionFails) throw new Error('fixed constructor failure');
    made++; live++; peak = Math.max(peak, live); workers.push(this); this.exited = false;
  }
  unref() { this.unreferenced = true; }
  postMessage(message) {
    assert.equal(message.type, 'compile'); assert.equal(typeof message.source, 'string');
    const plan = plans.shift() ?? { mode: 'healthy' }; this.plan = plan;
    if (plan.mode === 'send-fail') throw new Error('fixed send failure');
    queueMicrotask(() => {
      if (plan.mode === 'boot') return;
      if (plan.mode === 'premature-done') { this.emit('message', { type: 'done', outcome: { js: 'unused' } }); return; }
      this.emit('message', { type: 'start' });
      if (plan.mode === 'healthy') this.emit('message', { type: 'done', outcome: { js: 'compiled fixture' } });
      if (plan.mode === 'nested') this.emit('message', { type: 'done', outcome: { nested: true } });
      if (plan.mode === 'compiler-fail') this.emit('message', { type: 'fail' });
      if (plan.mode === 'malformed-done') this.emit('message', { type: 'done', outcome: 'invalid fixture' });
      if (plan.mode === 'oom') this.emit('error', Object.assign(new Error('not inspected'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }));
      if (plan.mode === 'ordinary-error') this.emit('error', new Error('stack overflow text is not a stop signal'));
      if (plan.mode === 'exit') this.exit();
      if (plan.mode === 'duplicate-start') setTimeout(() => this.emit('message', { type: 'start' }), 1000);
    });
  }
  terminate() {
    this.terminationRequested = true;
    if (this.plan?.termination === 'reject') return Promise.reject(new Error('fixed terminate rejection'));
    if (this.plan?.termination === 'resolve-no-exit') return Promise.resolve(0);
    if (this.plan?.termination === 'delayed') return new Promise(resolve => { this.finishTermination = resolve; });
    queueMicrotask(() => this.exit()); return Promise.resolve(0);
  }
  exit() {
    if (this.exited) return;
    this.exited = true; live--; this.emit('exit', 0); this.finishTermination?.(0);
  }
}
threads.Worker = FakeWorker;
const pool = require(bundle);
const { compileReactOnWorker: compile, reactCompilePool: counts, GraderBusyError } = pool;
const observe = promise => {
  const state = { settled: false, value: undefined, error: undefined };
  promise.then(value => { state.settled = true; state.value = value; }, error => { state.settled = true; state.error = error; });
  return state;
};
const busy = (state, reason) => { assert.ok(state.error instanceof GraderBusyError); assert.equal(state.error.reason, reason); assert.ok(state.error.retryAfterSeconds > 0); };
async function main() {
  assert.equal(pool.REACT_COMPILE_DEADLINE_MS, 4000);
  assert.equal(pool.REACT_COMPILE_BOOT_MS, 6000);
  assert.equal(pool.REACT_COMPILE_SLOT_WAIT_MS, 4000);
  assert.equal(pool.REACT_COMPILE_MAX_WAITING, 32);
  if (scenario === 'reuse') {
    assert.deepEqual(await compile('first'), { js: 'compiled fixture' });
    assert.deepEqual(await compile('second'), { js: 'compiled fixture' });
    assert.equal(made, 1); assert.deepEqual(counts(), { idle: 1, live: 1, retiring: 0 });
    assert.ok(workers[0].unreferenced);
  } else if (scenario === 'deadline' || scenario === 'duplicate-start') {
    plans.push({ mode: scenario === 'deadline' ? 'hold' : scenario });
    const one = observe(compile('fixture')); await flush();
    await advance(3999); assert.equal(one.settled, false);
    await advance(1); assert.deepEqual(one.value, { nested: true });
    assert.equal(workers[0].terminationRequested, true);
    assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' }); assert.equal(made, 2);
  } else if (scenario === 'boot') {
    plans.push({ mode: 'boot' });
    const one = observe(compile('fixture')); await flush();
    await advance(5999); assert.equal(one.settled, false);
    await advance(1); busy(one, 'react_compile_worker_boot_timeout');
    const paused = observe(compile('fixture')); await flush(); busy(paused, 'react_compile_worker_backoff'); assert.equal(made, 1);
    await advance(1000); assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' });
    // A successful start resets the next failed boot's backoff to one second.
    plans.push({ mode: 'compiler-fail' }); const fail = observe(compile('fixture')); await flush(); busy(fail, 'react_compile_worker_failed');
    await advance(1000); assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' });
  } else if (scenario === 'constructor') {
    constructionFails = true;
    const one = observe(compile('fixture')); await flush(); busy(one, 'react_compile_worker_boot_failed');
    assert.equal(made, 0); constructionFails = false;
    await advance(1000); assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' });
  } else if (['nested', 'oom', 'compiler-fail', 'ordinary-error', 'premature-done', 'malformed-done', 'send-fail', 'exit'].includes(scenario)) {
    plans.push({ mode: scenario }); const one = observe(compile('fixture')); await flush();
    if (scenario === 'nested' || scenario === 'oom') assert.deepEqual(one.value, { nested: true });
    else busy(one, scenario === 'exit' ? 'react_compile_worker_exited' : scenario === 'send-fail' ? 'react_compile_worker_send_failed' : 'react_compile_worker_failed');
    assert.equal(made, 1); assert.equal(live, 0);
    await advance(1000); assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' });
  } else if (scenario === 'queue' || scenario === 'reject-termination' || scenario === 'resolve-without-exit') {
    plans.push({ mode: 'hold', termination: scenario === 'reject-termination' ? 'reject' : scenario === 'resolve-without-exit' ? 'resolve-no-exit' : 'delayed' });
    const active = observe(compile('fixture')); await flush();
    const waiting = Array.from({ length: 32 }, () => observe(compile('queued fixture'))); await flush();
    const overflow = observe(compile('overflow fixture')); await flush(); busy(overflow, 'react_compile_queue_full');
    await advance(4000); assert.deepEqual(active.value, { nested: true });
    for (const item of waiting) busy(item, 'react_compile_wait_expired');
    assert.equal(made, 1); assert.deepEqual(counts(), { idle: 0, live: 1, retiring: 1 });
    const again = observe(compile('must wait')); await flush(); await advance(4000); busy(again, 'react_compile_wait_expired');
    assert.equal(made, 1, 'neither resolved nor rejected terminate authorizes a replacement before exit');
    workers[0].exit(); await flush(); assert.equal(live, 0);
    assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' }); assert.equal(made, 2);
  } else if (scenario === 'idle-error') {
    await compile('healthy'); workers[0].plan.termination = 'delayed';
    workers[0].emit('error', new Error('idle infrastructure error'));
    const one = observe(compile('must not start a second live worker')); await flush(); busy(one, 'react_compile_worker_retiring');
    assert.equal(made, 1); workers[0].exit(); await flush(); await advance(1000);
    assert.deepEqual(await compile('recovery'), { js: 'compiled fixture' });
  } else if (scenario === 'fallback') {
    const artifact = path.join(directory, pool.REACT_COMPILE_WORKER_FILE);
    fs.unlinkSync(artifact);
    const deployment = observe(compile('export default function App(){return null}')); await flush(); busy(deployment, 'react_compile_worker_missing');
    assert.equal(deployment.error.retryAfterSeconds, 30); assert.equal(made, 0);
    delete process.env.VERCEL;
    assert.equal(typeof (await compile('export default function App(){return null}')).js, 'string');
    process.env.NODE_ENV = 'production';
    const production = observe(compile('fixture')); await flush(); busy(production, 'react_compile_worker_missing');
    process.env.NODE_ENV = 'test'; process.env.VERCEL = '1'; fs.writeFileSync(artifact, '// placeholder, never executed by FakeWorker\n');
    assert.deepEqual(await compile('repaired'), { js: 'compiled fixture' });
  } else throw new Error('unknown fixed scenario');
  assert.ok(peak <= 1, 'one actual live worker, including retirement');
  console.log(JSON.stringify({ status: 'passed', scenario, made, peakLive: peak }));
}
main().catch(() => { console.error('react_compile_pool_control_failed'); process.exitCode = 1; });
