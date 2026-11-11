// Sentry wiring — error + performance monitoring for the deployed app.
//
// The SDK is loaded via a dynamic `import()` inside initSentry(), guarded by
// the DSN check, so Sentry never lands in the shell chunk: without a DSN the
// import is never evaluated, and with one the SDK arrives as its own lazy
// chunk. initSentry() stays a sync fire-and-forget call for main.tsx.
//
// The 48 KB chunk used to load at boot, beside the route chunk, on every page
// view (perf baseline #587 C09). It now loads once the page has loaded and the
// browser is idle, or at once when an error comes first. An error before that
// is not lost: reportError() and the window's `error` and
// `unhandledrejection` events queue it in memory (nothing is stored, so
// monitoring stays consent-free), and the SDK reports the queue as it starts,
// through the same scrubbing as every event (lib/sentry-sdk.ts).
//
// The SDK posts straight to the DSN's ingest host. The CSP `connect-src` in
// vercel.json allows only the EU one (`https://*.ingest.de.sentry.io`), and
// `npm run check:security` asserts it; a DSN in another region needs its host
// added there, or every event is refused by the browser.
//
// Source maps are already emitted as 'hidden' in vite.config.ts; upload them
// with @sentry/vite-plugin + SENTRY_AUTH_TOKEN in CI for readable stack traces
// (optional, not required at runtime). To shrink the prod bundle further, drop
// browserTracingIntegration in lib/sentry-sdk.ts for errors-only reporting.

type SentryModule = typeof import('./sentry-sdk');
/** An error from before the SDK: the error, a reportError context, or the
 * global handler that saw it uncaught. */
export type EarlyError = [error: unknown, context?: Record<string, unknown>, uncaughtBy?: 'onerror' | 'onunhandledrejection'];

/** The longest the SDK waits for an idle moment once the page has loaded. */
export const SENTRY_IDLE_TIMEOUT_MS = 4_000;
/** Errors kept before the SDK starts; a page that throws in a loop sends the first ones. */
export const EARLY_ERROR_LIMIT = 20;

let sentry: SentryModule | null = null;
let dsnInUse: string | undefined;
let loading = false;
const early: EarlyError[] = [];

function keep(entry: EarlyError): void {
  if (early.length < EARLY_ERROR_LIMIT) early.push(entry);
  load();
}
// The SDK installs its own global handlers when it starts; until then this
// keeps what the window reports.
const uncaught = (event: Event): void => keep('reason' in event
  ? [(event as PromiseRejectionEvent).reason, undefined, 'onunhandledrejection']
  : [(event as ErrorEvent).error ?? (event as ErrorEvent).message, undefined, 'onerror']);
const listen = (on: boolean): void => {
  for (const type of ['error', 'unhandledrejection']) window[on ? 'addEventListener' : 'removeEventListener'](type, uncaught);
};

function load(): void {
  const dsn = dsnInUse;
  if (sentry || loading || !dsn) return;
  loading = true;
  void import('./sentry-sdk')
    .then((Sentry) => {
      // The options, consent-free monitoring's privacy rules among them, are
      // in lib/sentry-sdk.ts with the SDK, which also sends the early errors.
      Sentry.start(dsn, import.meta.env.MODE, early);
      early.length = 0;
      listen(false);
      sentry = Sentry;
    })
    .catch(() => {
      // Keep the bounded queue and window listeners for the next attempt.
      loading = false;
    });
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn || dsnInUse) return;
  dsnInUse = dsn;
  listen(true);
  // After the load event, at the browser's next idle moment (or a beat later
  // where there is no requestIdleCallback, as in Safari).
  const later = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(load, { timeout: SENTRY_IDLE_TIMEOUT_MS }) : setTimeout(load, 200));
  if (document.readyState === 'complete') later();
  else window.addEventListener('load', later, { once: true });
}

/** Report a caught error. Before the SDK has loaded it is kept, and the SDK
 * starts loading at once; without a DSN it does nothing. */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
  else if (dsnInUse) keep([error, context]);
}
