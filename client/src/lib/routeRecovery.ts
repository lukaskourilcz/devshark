// Getting a page back after its code failed to load.
//
// Every page is a lazy chunk (App.tsx). A chunk fails to load for two reasons:
// the network dropped the request, or a deploy replaced the hashed file this
// build still names. devshark.app answers a missing asset with a 404 that no
// cache keeps (vercel.json). `vite preview` answers it with index.html as
// `200 text/html`, as devshark.app did before HARDEN (docs/release-acceptance.md),
// and a module script refuses that too. Either way a stale deploy fails the
// same way a dropped request does. The route error boundary
// (components/RouteErrorBoundary.tsx) catches it inside the shell; this module
// decides how to get the page back.
//
// Asking for the same import again is not enough everywhere. Until July 2026
// the HTML standard kept a failed module fetch in the document's module map,
// so a second import() of that URL failed at once without a request
// (whatwg/html#6768, changed by whatwg/html#10327). Measured in Chromium 141
// it holds for a page chunk and for a chunk the page imports, after a network
// error, a 404 or an HTML answer. Firefox asks again from 155 (September
// 2026), Chrome from 156 (October 2026), and Safari Technology Preview 252
// does, but no Safari release yet. So a retry first asks again in place,
// which is enough where the browser forgets the failure, and reloads the
// current address when the same failure comes straight back.
// docs/release-acceptance.md has the measurements and the sources.

import { createElement, lazy, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react';

// ── Which errors are chunk failures ────────────────────────────────────────

const chunkErrors = new WeakSet<object>();

/** Vite announces every dynamic import that fails with `vite:preloadError`,
 * including the ones lib/routePreload.ts starts when a pointer rests on a
 * link. So the listener only remembers which errors were chunk failures: a
 * reload from here would fire on a hover during a network blip and throw away
 * whatever the learner has open. It never calls preventDefault() either, which
 * would make Vite swallow the error and resolve the import to undefined. */
export function installChunkErrorTracking(): () => void {
  const remember = (event: Event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    if (payload !== null && typeof payload === 'object') chunkErrors.add(payload);
  };
  window.addEventListener('vite:preloadError', remember);
  return () => window.removeEventListener('vite:preloadError', remember);
}

const messageOf = (error: unknown): string => {
  const message = error !== null && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : '';
};

// The wording of Chromium, Firefox, Safari and Vite's stylesheet preload, for
// a failure that did not pass through Vite's helper (the dev server, tests).
const CHUNK_MESSAGE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** Whether an error means a chunk of the app's code did not load. */
export function isChunkLoadError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  return chunkErrors.has(error) || CHUNK_MESSAGE.test(messageOf(error));
}

/** A page stylesheet that failed stays failed: Vite never adds its link a
 * second time, so rendering the page again would draw it unstyled. Only a
 * reload brings it back. */
export const isStylesheetLoadError = (error: unknown): boolean => /Unable to preload CSS/i.test(messageOf(error));

export const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine !== false;

// ── Which build the server has now ─────────────────────────────────────────

/** What the server answered: the build this page runs, a newer one, or
 * nothing usable. */
export type BuildCheck = 'same' | 'newer' | 'unreachable';

export const BUILD_CHECK_TIMEOUT_MS = 3000;

/** The entry script names the build: every chunk's hashed name feeds into it. */
function entryScript(doc: Document): string | null {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src');
  return src ? new URL(src, window.location.href).pathname : null;
}

/** Ask for the current index.html, past every cache, and compare its entry
 * script with this page's. */
export async function checkServedBuild(timeoutMs = BUILD_CHECK_TIMEOUT_MS): Promise<BuildCheck> {
  const running = entryScript(document);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
    if (!response.ok) return 'unreachable';
    const served = entryScript(new DOMParser().parseFromString(await response.text(), 'text/html'));
    if (!running || !served) return 'unreachable';
    return served !== running ? 'newer' : 'same';
  } catch {
    return 'unreachable';
  } finally {
    window.clearTimeout(timer);
  }
}

// ── Reloading, at most once a minute when nobody asked ─────────────────────

const RELOAD_STAMP = 'devshark:route-reload';
export const RELOAD_COOLDOWN_MS = 60_000;

/** How the page gets back: the build check and the reload, replaceable in tests. */
export interface Recovery {
  checkServedBuild: () => Promise<BuildCheck>;
  reload: () => void;
}

export const browserRecovery: Recovery = {
  checkServedBuild: () => checkServedBuild(),
  reload: () => window.location.reload(),
};

/**
 * Reload the current address; the router has already moved it to the page
 * that failed. Never offline, where the browser would replace the app with
 * its own offline page. An automatic reload (nobody pressed anything) happens
 * at most once a minute per tab, stamped in sessionStorage; without storage a
 * second reload cannot be told from a loop, so an automatic one does not
 * happen at all. A reload the learner asked for always happens, and stamps
 * too, so an automatic one never follows it straight away. Returns whether a
 * reload started.
 */
export function reloadPage(automatic: boolean, reload: () => void = browserRecovery.reload, now = Date.now()): boolean {
  if (!isOnline()) return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_STAMP));
    // A stamp from the future means the clock moved; treat it as recent.
    if (automatic && last > 0 && now - last < RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(RELOAD_STAMP, String(now));
  } catch {
    if (automatic) return false;
  }
  reload();
  return true;
}

/**
 * The learner pressed something that needs code this document already failed
 * to load: a second sign-in (lib/auth.tsx), the workbench's Try again, the
 * shell's retry. Where the browser remembers the failed fetch, asking again in
 * place fails at once, so the press reloads the current address, as the route
 * boundary's Try again does: never offline, and only while the server answers,
 * since a reload it cannot answer swaps the app for the browser's error page.
 * Resolves whether a reload started. A started reload can still be refused
 * (the leave-page prompt): the caller stays busy for RELOAD_GRACE_MS, then
 * gives its control back.
 */
export async function reloadOnPress(recovery: Recovery = browserRecovery): Promise<boolean> {
  if (!isOnline()) return false;
  if ((await recovery.checkServedBuild()) === 'unreachable') return false;
  return reloadPage(false, recovery.reload);
}

// ── Pages that can be asked for again ──────────────────────────────────────

const failedPages = new Set<() => void>();
const buildChecks = new WeakMap<object, BuildCheck>();

/** How long a page waits for a reload it started to replace the document. A
 * reload can be refused (the quiz asks before the learner leaves one); then
 * the page shows its error after all. */
export const RELOAD_GRACE_MS = 4000;

/** A chunk failed while the server has a newer build: nothing in place can
 * bring back a file the deploy removed, so reload, on the automatic budget.
 * The answer is kept for the boundary, which would otherwise ask again. */
async function reloadForNewerBuild(error: unknown, recovery: Recovery): Promise<boolean> {
  if (!isChunkLoadError(error) || !isOnline()) return false;
  const check = await recovery.checkServedBuild();
  if (error !== null && typeof error === 'object') buildChecks.set(error, check);
  return check === 'newer' && reloadPage(true, recovery.reload);
}

/** The build check a failed page already made for this error, once. */
export function takeBuildCheck(error: unknown): BuildCheck | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const check = buildChecks.get(error);
  buildChecks.delete(error);
  return check;
}

/**
 * A lazy component that can be asked for again. React.lazy keeps a rejection
 * for good: render the same lazy component after a failure and it throws the
 * same error without calling its loader. So this renders whichever lazy
 * component is current, and a failed one is swapped for a fresh one when
 * `renewFailedPages()` says so (a boundary does, once the error is on screen).
 * The fresh component calls the loader again. `beforeFailing` runs before
 * React learns of a failure.
 *
 * `ComponentType<any>` is React.lazy's own bound; the props come back through
 * ComponentProps.
 */
function renewableLazy<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  beforeFailing?: (error: unknown) => Promise<void>,
): ComponentType<ComponentProps<T>> {
  type P = ComponentProps<T>;
  let View: LazyExoticComponent<T>;
  const renew = () => {
    View = lazy(() => load().catch(async (error: unknown) => {
      await beforeFailing?.(error);
      // React learns of the failure now; from here on the part may be renewed.
      failedPages.add(renew);
      throw error;
    }));
  };
  renew();
  return function LazyPage(props: P) {
    return createElement(View as ComponentType<P>, props);
  };
}

/**
 * `lazy()` for a routed page, able to try again (renewableLazy). The loader is
 * a `routeChunk` loader, which forgets a failed import, so the fresh component
 * asks the network again.
 *
 * Before a failure reaches the boundary the page checks the served build: a
 * navigation renders in a transition, so the current page stays on screen
 * while it asks, and a newer build reloads from there without an error screen
 * in between.
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>, recovery: Recovery = browserRecovery): ComponentType<ComponentProps<T>> {
  return renewableLazy(load, async (error) => {
    if (await reloadForNewerBuild(error, recovery)) {
      await new Promise((resolve) => window.setTimeout(resolve, RELOAD_GRACE_MS));
    }
  });
}

/**
 * `lazy()` for a part with a boundary of its own (ShellPartBoundary), able to
 * try again like a page: the shell's account widget and upgrade sheet, and a
 * part inside a page that should fail alone and leave the page standing (the
 * Learn workbench, the friends tab, a path's reward, the code highlighter). A
 * failure checks nothing and never reloads by itself: these parts load without
 * a press, and a reload nobody asked for would throw away whatever the learner
 * has open. ShellPartBoundary renews it when the learner retries. A section
 * that a page's hold loads with its reads is `lazyPart` in lib/routeData.ts,
 * which fails with its page.
 */
export function lazyShellPart<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): ComponentType<ComponentProps<T>> {
  return renewableLazy(load);
}

/** Swap every page or shell part whose load failed for a fresh lazy component.
 * Call it only while no failed one is on screen, or React would retry it
 * straight away. */
export function renewFailedPages(): void {
  for (const renew of failedPages) renew();
  failedPages.clear();
}
