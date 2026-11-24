import { test, expect, type Page } from './console-clean';
import settings from '../fixtures/api-settings.json';

interface TimerCounts {
  longTimeouts: number;
  totalTimeouts: number;
  intervals: number;
  stringTimers: number;
}
declare global {
  interface Window {
    routeLifetime: { documentKey: string; counts: () => TimerCounts };
    releaseLifetimeControl?: () => void;
  }
}

const guestSettings = { ...settings, billing: { ...settings.billing, enabled: false, launchOffer: false } };

const routes = [
  ['/learn/web-developer', /^Web Developer$/i], ['/quiz', /Build your quiz/i], ['/coding', /Coding challenges/i],
  ['/challenge', /Biggest Shark Challenge/i], ['/play', /Play live/i], ['/premium', /Premium|Everything in devShark/i],
  ['/leaderboard', /Leaderboard/i], ['/daily', /Question of the day/i], ['/shop', /^Coins$/i], ['/', /Lessons, quizzes|developer learning/i],
] as const;

function watchPageTimers() {
  const timeouts = new Map<number, number>();
  const intervals = new Set<number>();
  let stringTimers = 0;
  type Schedule = (handler: TimerHandler, delay?: number, ...args: unknown[]) => number;
  const timeout: Schedule = window.setTimeout.bind(window);
  const interval: Schedule = window.setInterval.bind(window);
  const cancelTimeout = window.clearTimeout.bind(window);
  const cancelInterval = window.clearInterval.bind(window);
  window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    // Preserve native handling of string callbacks. The probe marks that run
    // unsupported since its completion cannot be observed through a wrapper.
    if (typeof handler !== 'function') {
      stringTimers++;
      return timeout(handler, delay, ...args);
    }
    const id = timeout(function(this: unknown, ...delivered: unknown[]) {
      timeouts.delete(id);
      return Reflect.apply(handler, this, delivered);
    }, delay, ...args);
    timeouts.set(id, Number(delay) || 0);
    return id;
  }) as typeof window.setTimeout;
  window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
    const id = interval(handler, delay, ...args);
    intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  const forget = (id?: number) => { intervals.delete(Number(id)); timeouts.delete(Number(id)); };
  window.clearTimeout = ((id?: number) => { forget(id); cancelTimeout(id); }) as typeof window.clearTimeout;
  window.clearInterval = ((id?: number) => { forget(id); cancelInterval(id); }) as typeof window.clearInterval;
  window.routeLifetime = { documentKey: crypto.randomUUID(), counts: () => ({
    longTimeouts: [...timeouts.values()].filter(delay => delay >= 1000).length,
    totalTimeouts: timeouts.size, intervals: intervals.size, stringTimers,
  }) };
}

async function visit(page: Page, route: typeof routes[number], doc: string) {
  const [path, heading] = route;
  await page.evaluate(path => {
    const state = { idx: (history.state?.idx ?? 0) + 1, key: crypto.randomUUID(), usr: null };
    history.pushState(state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  }, path);
  await expect(page.locator('main').getByRole('heading', { name: heading }).first()).toBeVisible();
  expect(await page.evaluate(() => [location.pathname, window.routeLifetime.documentKey])).toEqual([path, doc]);
  await page.waitForTimeout(560);
}

test('listeners, intervals and pending long timeouts stay within ten percent over five ten-route laps', async ({ page, context, baseURL }, info) => {
  const fullExpiry = process.env.MEMORY_FULL_EXPIRY === '1';
  test.setTimeout(fullExpiry ? 445_000 : 165_000);
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (url.pathname.startsWith('/api/')) {
      // Match the production-build baseline fixture, including its API latency.
      await new Promise(resolve => setTimeout(resolve, 400));
      if (url.pathname === '/api/settings') return route.fulfill({ json: guestSettings });
      return route.fulfill({ status: 503, json: { error: { code: 'fixture_only', message: 'No external provider in this lab' } } });
    }
    return route.continue();
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(watchPageTimers);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('main h1').first()).toBeVisible();
  await page.waitForTimeout(600);
  const doc = await page.evaluate(() => window.routeLifetime.documentKey);
  const cdp = await context.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { jsEventListeners, documents, nodes } = await cdp.send('Memory.getDOMCounters');
    return { listeners: jsEventListeners, documents, nodes, ...await page.evaluate(() => window.routeLifetime.counts()) };
  };
  const laps = [];
  for (let lap = 0; lap < 5; lap++) {
    for (const route of routes) await visit(page, route, doc);
    await page.waitForTimeout(1450);
    laps.push(await sample());
  }
  const controlsBefore = await sample();
  await page.evaluate(() => {
    const listeners = Array.from({ length: 12 }, () => () => {});
    listeners.forEach(listener => document.addEventListener('memory-count-control', listener));
    const timeout = setTimeout(() => {}, 65_000);
    const interval = setInterval(() => {}, 65_000);
    window.releaseLifetimeControl = () => {
      listeners.forEach(listener => document.removeEventListener('memory-count-control', listener));
      clearTimeout(timeout);
      clearInterval(interval);
    };
  });
  const held = await sample();
  await page.evaluate(() => window.releaseLifetimeControl!());
  const released = await sample();
  await page.waitForTimeout(35_000);
  const idle35s = await sample();
  let idle305s;
  if (fullExpiry) {
    await page.waitForTimeout(270_000);
    idle305s = await sample();
  }
  const sentryBundleLoaded = await page.evaluate(() => performance.getEntriesByType('resource').some(entry => /sentry-sdk/i.test(entry.name)));
  await info.attach('route-memory.json', { contentType: 'application/json', body: JSON.stringify({
    routes: routes.map(([path]) => path), laps, controlsBefore, held, released, idle35s, idle305s, sentryBundleLoaded,
  }, null, 2) });
  if (process.env.MEMORY_EXPECT_TRACING === '1') expect(sentryBundleLoaded, 'production Sentry tracing SDK loaded').toBe(true);
  expect(held.listeners).toBeGreaterThanOrEqual(controlsBefore.listeners + 12);
  expect(held.listeners).toBeGreaterThanOrEqual(released.listeners + 12);
  expect(held.intervals).toBe(controlsBefore.intervals + 1);
  expect(released.intervals).toBe(controlsBefore.intervals);
  expect(held.longTimeouts).toBe(controlsBefore.longTimeouts + 1);
  expect(released.longTimeouts).toBe(controlsBefore.longTimeouts);
  expect(laps[4].stringTimers).toBe(0);
  for (const key of ['listeners', 'intervals', 'longTimeouts'] as const) {
    expect.soft(laps[4][key], `raw lap five ${key} (first lap ${laps[0][key]})`).toBeLessThanOrEqual(laps[0][key] * 1.1);
    if (idle305s) expect.soft(idle305s[key], `after 305 seconds idle, ${key}`).toBeLessThanOrEqual(laps[0][key] * 1.1);
    expect.soft(idle35s[key], `after 35 seconds idle, ${key}`).toBeLessThanOrEqual(laps[0][key] * 1.1);
  }
});
