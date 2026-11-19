import type { Page } from './console-clean';

/** Control only the shell's 230ms focus delay; native timer IDs and cancellation
 * remain intact. Other timers and animation frames continue normally. */
export async function installRouteFocusControl(page: Page) {
  await page.addInitScript(() => {
    let held = false;
    const pending = new Map<number, () => unknown>();
    const log: unknown[] = [];
    const snapshot = () => {
      const active = document.activeElement;
      return { documentFocused: document.hasFocus(), tag: active?.tagName,
        id: active?.id, label: active?.getAttribute('aria-label') };
    };
    const record = (kind: string) => log.push({ kind, time: performance.now(), path: location.pathname, ...snapshot() });
    Object.assign(window, { __routeFocusControl: {
      log, arm: () => { held = true; }, count: () => pending.size,
      flush: () => {
        held = false;
        record('before-flush');
        for (const [id, run] of [...pending]) { pending.delete(id); run(); }
        record('after-flush');
      },
    } });
    // This callback executes in the browser, despite the harness's Node types.
    type BrowserTimer = (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;
    const set = window.setTimeout as BrowserTimer, clear = window.clearTimeout;
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay !== 230 || typeof handler !== 'function') return set.call(window, handler, delay, ...args);
      record('scheduled');
      const run = () => { record('callback'); return handler.apply(window, args); };
      const id = set.call(window, () => {
        if (held) { pending.set(id, run); record('held'); }
        else run();
      }, delay);
      return id;
    }) as unknown as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined && pending.delete(id)) record('cancelled');
      return clear.call(window, id);
    }) as typeof window.clearTimeout;
  });
}

type ControlledWindow = Window & { __routeFocusControl: { arm(): void; count(): number; flush(): void; log: unknown[] } };
export const armRouteFocus = (page: Page) => page.evaluate(() => (window as unknown as ControlledWindow).__routeFocusControl.arm());
export const pendingRouteFocus = (page: Page) => page.evaluate(() => (window as unknown as ControlledWindow).__routeFocusControl.count());
export const flushRouteFocus = (page: Page) => page.evaluate(() => (window as unknown as ControlledWindow).__routeFocusControl.flush());
export const routeFocusLog = (page: Page) => page.evaluate(() => (window as unknown as ControlledWindow).__routeFocusControl.log);
