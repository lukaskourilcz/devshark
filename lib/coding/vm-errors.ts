/** Reading what a program threw out of a QuickJS context. The QuickJS grader
 * (sandbox.ts) and the React learner engine (react-learner.ts) both use it;
 * it lives apart from sandbox.ts so the React guest bundle does not carry the
 * grader's preludes along with it. */
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';

/** What a program threw, read out of the VM, with its handle released.
 *
 * `dump` releases a promise handle itself, and learner code can throw a
 * promise. Releasing it a second time threw "Lifetime not alive", which
 * came back as the run's error in place of what the code threw. A promise
 * rejected with another promise trips the same double release inside
 * `dump` itself (it releases the inner promise, then frees it again), so
 * that error reads as an unreadable thrown value (undefined) instead. */
export const dumpThrown = (vm: QuickJSContext, handle: QuickJSHandle): unknown => {
  try { return vm.dump(handle); } catch (error) {
    if ((error as Error | undefined)?.name === 'QuickJSUseAfterFree') return undefined;
    throw error;
  } finally { if (handle.alive) handle.dispose(); }
};
