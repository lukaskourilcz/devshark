// Page code that starts loading before the click lands.
//
// Every page is a lazy chunk. A navigation keeps the current page on screen
// until the next page's code is ready (the route Suspense boundary in App.tsx
// sits outside the keyed route box, and the router renders in a transition),
// so a cold chunk costs a wait but never a blank beat. This module shortens the
// wait: App builds each lazy route from a loader registered here, and a pointer
// resting on a link, a keyboard focus or the first touch starts the same import
// the route will run. The browser fetches and evaluates a module once, so a
// preload never downloads anything twice.

import { startTransition, useEffect, useState } from 'react';

type Loader = () => Promise<unknown>;

/**
 * False for the app's first commit, then true, set in a transition (perf
 * baseline #587 C04). The route box (App.tsx) draws its loader as content
 * while this is false, so its Suspense boundary is revealed from the first
 * frame, and renders the first page once it is true: in a transition, which
 * keeps the loader up until the page can draw whole and commits it the moment
 * it can. Shown through the fallback instead, the page waited for React's
 * reveal throttle: a boundary leaving its fallback on a retry commits no
 * sooner than 300 ms after the last fallback any boundary showed or hid.
 */
export function useFirstPageTransition(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startTransition(() => setReady(true));
  }, []);
  return ready;
}

const loaders: { matches: (pathname: string) => boolean; load: Loader }[] = [];

/** How long a mouse rests on a link before its page starts loading. Short
 * enough to finish before most clicks, long enough that sweeping across the
 * nav does not fetch every section. Touch, focus and press start at once. */
const HOVER_INTENT_MS = 65;

/** Register the module behind the paths `matches` accepts. The returned
 * loader is what `lazy()` calls: one import, shared with every preload, and a
 * failed fetch is forgotten so the next attempt asks the network again. */
export function routeChunk<T>(matches: (pathname: string) => boolean, load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  const once = () => {
    if (!pending) {
      pending = load();
      pending.catch(() => {
        pending = null;
      });
    }
    return pending;
  };
  loaders.push({ matches, load: once });
  return once;
}

/** Start loading everything registered for a same-origin path (a page, and a
 * page's own parts once its section has registered them). Unknown paths do
 * nothing, and a failure stays quiet: the navigation itself reports it. The
 * promise settles when every matching load has. */
export function preloadPath(pathname: string): Promise<void> {
  const loads = loaders.filter((entry) => entry.matches(pathname)).map((entry) => entry.load().catch(() => undefined));
  return Promise.all(loads).then(() => undefined);
}

/** The route box key (App.tsx). The Learn sections share one box, so moving
 * between /learn and /learn/<section> keeps the page mounted, its route focus
 * and its error boundary where they are. /learn/big-o keeps its own box. */
export const routeBoxKey = (pathname: string): string =>
  /^\/learn(?:\/(?!big-o\/?$)[^/]+)?\/?$/.test(pathname) ? '/learn' : pathname;

/** The in-app path a link (or a chrome button carrying `data-route`) leads to. */
function pathOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('a[href], [data-route]');
  if (!element) return null;
  if (element instanceof HTMLAnchorElement) {
    if ((element.target && element.target !== '_self') || element.hasAttribute('download')) return null;
    const url = new URL(element.href, window.location.href);
    return url.origin === window.location.origin ? url.pathname : null;
  }
  return element.dataset.route ?? null;
}

/** A left-button mouse press, which a click on the same link follows. */
const isPrimaryMousePress = (event: Event): boolean =>
  event.type === 'pointerdown' && (event as PointerEvent).pointerType === 'mouse' && (event as PointerEvent).button === 0;

/** Whether the visitor asked the browser to save data. Read per event: the
 * setting can change while the page is open. */
const savesData = (): boolean =>
  (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;

/** Preload on intent anywhere in the document. Returns the uninstaller. A
 * visitor who asked the browser to save data gets a page's code when they open
 * it, not for every link they rest on, tab through or touch while scrolling
 * (as useWarmWorkbench in coding/loadWorkbench.ts skips its idle warm-up). A
 * primary mouse press still starts at once: the click that follows loads the
 * same code, so starting it on the press costs no extra data. */
export function installIntentPreloading(): () => void {
  let hover: number | undefined;
  const cancelHover = () => {
    window.clearTimeout(hover);
    hover = undefined;
  };
  const now = (event: Event) => {
    if (savesData() && !isPrimaryMousePress(event)) return;
    const path = pathOf(event.target);
    if (path && path !== window.location.pathname) void preloadPath(path);
  };
  const rest = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || savesData()) return;
    const path = pathOf(event.target);
    if (path && path === pathOf(event.relatedTarget)) return;
    cancelHover();
    if (path && path !== window.location.pathname) {
      hover = window.setTimeout(() => {
        hover = undefined;
        if (!savesData() && path !== window.location.pathname) void preloadPath(path);
      }, HOVER_INTENT_MS);
    }
  };
  const leave = (event: PointerEvent) => {
    if (hover !== undefined && event.pointerType === 'mouse' && pathOf(event.target) !== pathOf(event.relatedTarget)) {
      cancelHover();
    }
  };
  const options = { capture: true, passive: true } as const;
  document.addEventListener('pointerover', rest, options);
  document.addEventListener('pointerout', leave, options);
  document.addEventListener('pointerdown', now, options);
  document.addEventListener('touchstart', now, options);
  document.addEventListener('focusin', now, options);
  return () => {
    cancelHover();
    document.removeEventListener('pointerover', rest, options);
    document.removeEventListener('pointerout', leave, options);
    document.removeEventListener('pointerdown', now, options);
    document.removeEventListener('touchstart', now, options);
    document.removeEventListener('focusin', now, options);
  };
}
