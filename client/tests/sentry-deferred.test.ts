// The error monitor's SDK (48 KB) loads after the page, not beside the route
// chunk at boot (perf baseline #587 C09), and errors from before it arrive.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
  captureException: vi.fn(),
}));
vi.mock('@sentry/react', () => sentry);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshMonitor() {
  vi.resetModules();
  return import('../src/lib/sentry');
}

beforeEach(() => {
  sentry.init.mockClear();
  sentry.captureException.mockClear();
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o1.ingest.de.sentry.io/1');
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (document as { readyState?: unknown }).readyState;
});

describe('the error monitor', () => {
  it('starts the SDK only after the load event, at an idle moment', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const idle = vi.fn((run: () => void) => { idleRun = run; return 1; });
    let idleRun: (() => void) | null = null;
    vi.stubGlobal('requestIdleCallback', idle);
    try {
      const { initSentry } = await freshMonitor();
      initSentry();
      await flush();
      expect(sentry.init).not.toHaveBeenCalled();
      expect(idle).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('load'));
      expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 4_000 });
      await flush();
      expect(sentry.init).not.toHaveBeenCalled();
      idleRun!();
      await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a reported error from before the SDK, loads the SDK at once and sends it', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const { initSentry, reportError } = await freshMonitor();
    initSentry();
    const early = new Error('before the SDK');
    reportError(early, { componentStack: 'at Page' });
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    expect(sentry.captureException).toHaveBeenCalledWith(early, { extra: { componentStack: 'at Page' } });
    // After it, straight to the SDK.
    const later = new Error('after');
    reportError(later);
    expect(sentry.captureException).toHaveBeenLastCalledWith(later, undefined);
  });

  it('keeps an uncaught error and a rejection from before the SDK, as unhandled', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const { initSentry } = await freshMonitor();
    initSentry();
    const thrown = new Error('uncaught');
    window.dispatchEvent(new ErrorEvent('error', { error: thrown, message: 'uncaught' }));
    const reason = new Error('rejected');
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = reason;
    window.dispatchEvent(rejection);
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledTimes(2));
    expect(sentry.captureException).toHaveBeenCalledWith(thrown, { mechanism: { type: 'onerror', handled: false } });
    expect(sentry.captureException).toHaveBeenCalledWith(reason, { mechanism: { type: 'onunhandledrejection', handled: false } });
    // The SDK's own handlers take over: these listeners are gone.
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('later'), message: 'later' }));
    await flush();
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it('can start after a transient SDK startup error and retains the queued events', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    sentry.init.mockImplementationOnce(() => { throw new Error('SDK startup did not complete'); });
    const { initSentry, reportError } = await freshMonitor();
    initSentry();
    const first = new Error('before failed startup');
    const second = new Error('after failed startup');
    reportError(first);
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));

    const event = new ErrorEvent('error', { error: second });
    window.dispatchEvent(event);
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(2));
    expect(sentry.captureException.mock.calls.map(([error]) => error)).toEqual([first, second]);
  });

  it('keeps at most EARLY_ERROR_LIMIT errors from before the SDK, the first ones', async () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    const { initSentry, reportError, EARLY_ERROR_LIMIT } = await freshMonitor();
    initSentry();
    const errors = Array.from({ length: EARLY_ERROR_LIMIT + 5 }, (_, index) => new Error(`loop ${index}`));
    for (const error of errors) reportError(error);
    await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
    expect(EARLY_ERROR_LIMIT).toBe(20);
    expect(sentry.captureException.mock.calls.map(([error]) => error)).toEqual(errors.slice(0, EARLY_ERROR_LIMIT));
  });

  it('does nothing, and keeps nothing, without a DSN', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry, reportError } = await freshMonitor();
    initSentry();
    reportError(new Error('nobody listens'));
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x'), message: 'x' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
