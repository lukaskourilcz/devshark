// F11-36: controlled termination faults in a fresh process.
// Native workers, actual pool and existing queue deadline, never app/VM calls.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { setTimeout as sleep } from 'node:timers/promises';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { runInSandbox, warmSandbox, sandboxPool, sandboxThreads, SANDBOX_MAX_THREADS, SANDBOX_SLOT_WAIT_MS } from '../lib/coding/sandbox';
import { GraderBusyError } from '../lib/coding/grader-capacity';

export async function runRetirementFault(mode = 'reject'): Promise<void> {
  await buildSandboxWorker();
  process.env.VERCEL = '1';
  assert.ok(mode === 'reject' || mode === 'throw');
  const realTerminate = Worker.prototype.terminate;
  const realPost = Worker.prototype.postMessage;
  const seen = new Set<Worker>(), quarantined = new Set<Worker>();
  const reported = {code:"const error=new Error('out of memory');error.name='InternalError';throw error;",calls:[],expectations:[]};
  const good = {code:'const answer=()=>42;',calls:['answer()'],expectations:[42]};
  Worker.prototype.terminate = function(this: Worker): Promise<number> {
    quarantined.add(this);
    if (mode === 'throw') throw new Error('controlled terminate throw');
    return Promise.reject(new Error('controlled terminate rejection'));
  };
  Worker.prototype.postMessage = function(this: Worker, ...args: Parameters<Worker['postMessage']>) {
    seen.add(this);
    const message = args[0] as {type?:string;input?:{code:string;calls:string[]}};
    // Deliberately fault the warm-up's result so its distinct reservation path
    // must use the same actual-exit ownership rule as ordinary submitted runs.
    if (message?.type === 'run' && message.input?.code === '' && message.input.calls.length === 0) args[0] = {...message,input:reported};
    return realPost.apply(this,args);
  };
  try {
    warmSandbox();
    while (sandboxPool().warming) await sleep(10);
    assert.equal(quarantined.size,1,'an unhealthy completed warm-up requests retirement');
    assert.equal(sandboxPool().idle,0,'a retired warm-up cannot return to idle');
    assert.equal(sandboxThreads(),1,'terminate failure does not fake an exit');
    for(let i=1;i<SANDBOX_MAX_THREADS;i++) {
      const result=await runInSandbox(reported);
      assert.equal(result.codeError,'Out of memory.');
      assert.equal(result.timedOut,false,'cleanup never rewrites the reported verdict');
    }
    assert.equal(quarantined.size,SANDBOX_MAX_THREADS);
    assert.equal(sandboxThreads(),SANDBOX_MAX_THREADS);
    assert.equal(sandboxPool().idle,0);
    const start=Date.now();
    await assert.rejects(runInSandbox(good),GraderBusyError,'no fifth live worker can enter while four retired reservations await exit');
    const took=Date.now()-start;
    assert.ok(took>=SANDBOX_SLOT_WAIT_MS-20,'the existing queue deadline remains');
    assert.ok(took<=SANDBOX_SLOT_WAIT_MS+1000,'the learner response does not hang on termination');
    assert.equal(sandboxThreads(),SANDBOX_MAX_THREADS);
  } finally {
    Worker.prototype.terminate=realTerminate;
    Worker.prototype.postMessage=realPost;
    await Promise.all([...seen].map((worker)=>realTerminate.call(worker)));
  }
  assert.equal(sandboxThreads(),0,'real exit drains quarantined workers');
  const recovered=await runInSandbox(good);
  assert.equal(recovered.results[0]?.pass,true,'actual exits released reservations for the next real run');
  assert.equal(sandboxThreads(),1);
  assert.equal(sandboxPool().idle,1);
  console.log(`PASS retirement lease: ${mode}, warm/normal quarantine, unchanged queue deadline, actual-exit recovery`);
}
