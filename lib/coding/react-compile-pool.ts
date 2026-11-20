/** React syntax conversion only. Learner source is never evaluated here.
 * One compiler thread, one retained idle thread, and bounded callers. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { compileReactLearner } from './react-transpile';
import { bootBackoff, GraderBusyError, inThreadGradingAllowed, threadSlots } from './grader-capacity';

export const REACT_COMPILE_WORKER_FILE = 'lib/coding/generated/react-compile-worker.cjs';
export const REACT_COMPILE_DEADLINE_MS = 4_000;
export const REACT_COMPILE_BOOT_MS = 6_000;
export const REACT_COMPILE_MAX_WAITING = 32;
export const REACT_COMPILE_SLOT_WAIT_MS = 4_000;
const WORKER_HEAP_MB = 256;
const IDLE_WORKERS = 1;

type ReactCompileOutcome = { js: string } | { nested: true };
type WorkerReply = { type: 'start' } | { type: 'done'; outcome: ReactCompileOutcome } | { type: 'fail' };
class WorkerUnavailableError extends Error {}

const idleWorkers: Worker[] = [];
const liveWorkers = new Set<Worker>();
const retiringWorkers = new Set<Worker>();
const leases = new Map<Worker, () => void>();
const slots = threadSlots({ threads: 1, waiting: REACT_COMPILE_MAX_WAITING, waitMs: REACT_COMPILE_SLOT_WAIT_MS, name: 'react_compile' });
const boot = bootBackoff();
let missingLogged = false;

const forgetIdle = (worker: Worker): void => {
  const index = idleWorkers.indexOf(worker);
  if (index >= 0) idleWorkers.splice(index, 1);
};
const releaseLease = (worker: Worker): void => {
  const release = leases.get(worker);
  leases.delete(worker);
  release?.();
};
function newWorker(file: string): Worker {
  let worker: Worker;
  try { worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB } }); }
  catch { throw new WorkerUnavailableError('react_compile_worker_boot_failed'); }
  liveWorkers.add(worker);
  worker.unref();
  // Keep the listener even while idle, so an idle worker error is handled.
  worker.on('error', () => retire(worker));
  worker.on('exit', () => {
    forgetIdle(worker);
    liveWorkers.delete(worker);
    retiringWorkers.delete(worker);
    // A stopped caller can already have its result. Capacity is still held
    // until Node reports actual exit, even if terminate() rejected earlier.
    releaseLease(worker);
  });
  return worker;
}
function retire(worker: Worker): void {
  forgetIdle(worker);
  if (!liveWorkers.has(worker) || retiringWorkers.has(worker)) return;
  retiringWorkers.add(worker);
  try {
    void worker.terminate().catch(() => {
      console.warn(JSON.stringify({ level: 'warn', msg: 'react_compile_worker_termination_failed' }));
    });
  } catch {
    console.warn(JSON.stringify({ level: 'warn', msg: 'react_compile_worker_termination_failed' }));
  }
  // Never release here. An unconfirmed exit quarantines the one slot.
}

function onWorker(file: string, source: string, takeLease: (worker: Worker) => void): Promise<ReactCompileOutcome> {
  // An idle worker can report error before exit. Reuse that existing live
  // identity as an exit barrier, rather than creating a second live thread.
  const worker = idleWorkers.pop() ?? liveWorkers.values().next().value ?? newWorker(file);
  takeLease(worker);
  if (retiringWorkers.has(worker)) return Promise.reject(new WorkerUnavailableError('react_compile_worker_retiring'));
  return new Promise((resolve, reject) => {
    let settled = false, started = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (keep: boolean): boolean => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      if (keep && liveWorkers.has(worker) && !retiringWorkers.has(worker) && idleWorkers.length < IDLE_WORKERS) {
        idleWorkers.push(worker);
        releaseLease(worker);
      } else retire(worker);
      return true;
    };
    const stopped = (): void => { if (settle(false)) resolve({ nested: true }); };
    const unavailable = (reason: string): void => { if (settle(false)) reject(new WorkerUnavailableError(reason)); };
    const onMessage = (reply: WorkerReply): void => {
      if (settled) return;
      if (reply?.type === 'start') {
        if (started) return; // A duplicate cannot restart the deadline.
        started = true;
        boot.started();
        clearTimeout(timer);
        timer = setTimeout(stopped, REACT_COMPILE_DEADLINE_MS);
        return;
      }
      if (reply?.type === 'done' && started) {
        const outcome = reply.outcome;
        if (outcome && typeof outcome === 'object' && 'nested' in outcome && outcome.nested === true && !('js' in outcome)) {
          stopped(); return;
        }
        if (outcome && typeof outcome === 'object' && 'js' in outcome && typeof outcome.js === 'string' && !('nested' in outcome)) {
          if (settle(true)) resolve({ js: outcome.js });
          return;
        }
      }
      unavailable('react_compile_worker_failed');
    };
    const onError = (error: Error & { code?: unknown }): void => {
      // A trusted Node OOM event after start is a stopped compile. Compiler
      // exceptions use fail, never learner/error-message regex matching.
      if (started && error.code === 'ERR_WORKER_OUT_OF_MEMORY') stopped();
      else unavailable('react_compile_worker_failed');
    };
    const onExit = (): void => unavailable('react_compile_worker_exited');
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    timer = setTimeout(() => unavailable('react_compile_worker_boot_timeout'), REACT_COMPILE_BOOT_MS);
    try { worker.postMessage({ type: 'compile', source }); }
    catch { unavailable('react_compile_worker_send_failed'); }
  });
}

const inline = (source: string): ReactCompileOutcome => {
  try { return { js: compileReactLearner(source) }; }
  catch (error) {
    if (error instanceof RangeError) return { nested: true };
    throw new GraderBusyError('react_compile_failed');
  }
};

/** Only local/non-deployment runs may fall back to synchronous conversion. */
export async function compileReactOnWorker(source: string): Promise<ReactCompileOutcome> {
  const file = join(process.cwd(), REACT_COMPILE_WORKER_FILE);
  if (!existsSync(file)) {
    if (!missingLogged) console.warn(JSON.stringify({ level: 'warn', msg: 'react_compile_worker_missing', file: REACT_COMPILE_WORKER_FILE }));
    missingLogged = true;
    if (inThreadGradingAllowed()) return inline(source);
    throw new GraderBusyError('react_compile_worker_missing', 30);
  }
  missingLogged = false;
  await slots.acquire();
  let transferred = false;
  let released = false;
  const release = () => { if (!released) { released = true; slots.release(); } };
  try {
    const pause = idleWorkers.length === 0 ? boot.pause() : 0;
    if (pause > 0) {
      if (inThreadGradingAllowed()) return inline(source);
      throw new GraderBusyError('react_compile_worker_backoff', pause / 1000);
    }
    return await onWorker(file, source, worker => {
      transferred = true;
      leases.set(worker, release);
    });
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error;
    boot.failed();
    console.warn(JSON.stringify({ level: 'warn', msg: 'react_compile_worker_unavailable', reason: error.message }));
    if (inThreadGradingAllowed()) return inline(source);
    throw new GraderBusyError(error.message, boot.pause() / 1000);
  } finally {
    if (!transferred) release();
  }
}

/** Count-only test/operations seam; never part of an HTTP response. */
export function reactCompilePool(): { idle: number; live: number; retiring: number } {
  return { idle: idleWorkers.length, live: liveWorkers.size, retiring: retiringWorkers.size };
}
