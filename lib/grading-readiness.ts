type GradingStatus = 'ok' | 'unavailable' | 'unconfigured';

const DEADLINE_MS = 1_500;
const CACHE_MS = 5 * 60_000;

/** Only the health function's fixed program uses this per-instance cache. */
export function createGradingReadiness(run: (deadline: number) => Promise<boolean>) {
  let cached: { result: Promise<GradingStatus>; expiresAt: number } | undefined;

  async function probe(): Promise<GradingStatus> {
    const deadline = performance.now() + DEADLINE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), DEADLINE_MS); });
    try {
      const passed = await Promise.race([run(deadline), timeout]);
      // A synchronous part of WASM initialization can delay the timer callback.
      return passed && performance.now() < deadline ? 'ok' : 'unavailable';
    } catch {
      return 'unavailable';
    } finally {
      clearTimeout(timer);
    }
  }

  return function check(configured: boolean): Promise<GradingStatus> {
    if (!configured) {
      cached = undefined;
      return Promise.resolve('unconfigured');
    }
    if (cached && Date.now() < cached.expiresAt) return cached.result;

    const entry = { result: probe(), expiresAt: Infinity };
    cached = entry;
    // Only update this entry. Dropping the snapshot while the probe is in
    // flight invalidates it even if a later request restores configuration.
    void entry.result.then(() => { entry.expiresAt = Date.now() + CACHE_MS; });
    return entry.result;
  };
}
