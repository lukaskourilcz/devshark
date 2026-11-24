import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page, type Route } from './console-clean';
import { localAuth, storeFakeSession } from './fake-session';

// The first frame of a visit already has the shell's final geometry.
//
// Lighthouse scored the landing page's first load a CLS of 0.98 on a desktop
// and 0.96 on a phone (2026-09-26), all of it in one frame. The header stood
// 16px taller (12px on a phone) under the lazy account widget's placeholder
// and shrank when the "Log in" button replaced it, moving <main>; in the same
// frame the footer, drawn at the bottom of the empty first-load route box,
// jumped below the fold as the page arrived. A frame scores the area of
// everything that moved times the longest move, so <main>'s area times the
// footer's jump came close to 1. React reveals Suspense content in one commit
// when both chunks arrive within 300ms of the shell's first draw, so a fast
// load showed the whole shift and a slower one split it in two.
//
// Here every lazily loaded chunk is held back, so the shell stands alone for a
// fixed time before the page arrives. Each frame is recorded, and so is every
// layout-shift entry, flagged as input or not: the test sends no input, and a
// phone emulation flags shifts in its first half second as input.
//
// The same recording covers the pages that used to grow after their first
// draw (DRAW): /today and /leaderboard when their reads fail, a session's
// header when the account widget arrives, and a signed-in /collection with
// its saved cards.

// Deliberate local chunk failures must not emit telemetry or other requests
// outside the preview used by this fixture.
test.beforeEach(async ({ page }) => {
  const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:4173').origin;
  await page.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, route => route.abort('blockedbyclient'));
});

const HOLD_MS = 800;

type Frame = { t: number; mainTop: number; header: number | null; route: boolean; footer: number | null; page: number | null; nav: number | null; text: string };
type Shift = { t: number; value: number; input: boolean; sources: string[] };
type Recorder = { __firstLoad: { frames: Frame[]; shifts: Shift[] } };

const PROFILES = [
  // Lighthouse's desktop preset and its default phone profile.
  { name: 'desktop', use: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false } },
  { name: 'phone', use: { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true } },
] as const;

type Api = (route: Route, url: URL) => Promise<void> | void;
const unavailable: Api = (route) => route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });

test('the system-font first visit downloads no unused font resources', async ({ page }) => {
  const fonts: string[] = [];
  const googleFonts: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.resourceType() === 'font') fonts.push(url.pathname);
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') googleFonts.push(url.href);
  });
  await page.route('**/api/**', route => unavailable(route, new URL(route.request().url())));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect.soft(await page.locator('link[rel="preload"][as="font"]').count(), 'unused font preload links').toBe(0);
  expect.soft(fonts, 'font requests on the system-font design').toEqual([]);
  expect(googleFonts, 'external Google Fonts requests').toEqual([]);
});

test('an untouched Home visit leaves heavy optional packages outside requested chunks', async ({ page }) => {
  const scripts = new Set<string>();
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.resourceType() === 'script' && url.pathname.startsWith('/assets/') && url.pathname.endsWith('.js')) scripts.add(url.pathname);
  });
  await page.route('**/api/**', route => unavailable(route, new URL(route.request().url())));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(scripts.size, 'observed entry and route script requests').toBeGreaterThan(0);
  const forbidden = /(?:^|\/)node_modules\/(?:motion(?:-dom|-utils)?\/|framer-motion\/|@codemirror\/|@tiptap\/|react-syntax-highlighter\/|qrcode\/|posthog-js\/|web-vitals\/|@supabase\/supabase-js\/)/;
  const findings: { file: string; packages: string[] }[] = [];
  for (const file of scripts) {
    // Read build maps on the test runner. Production may refuse map URLs;
    // the guard must not depend on making client sources public.
    const map = JSON.parse(readFileSync(resolve('client/dist', `${file.slice(1)}.map`), 'utf8')) as { sources: string[] };
    const packages = [...new Set(map.sources.filter(source => forbidden.test(source)).map(source => source.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)![1]))].sort();
    if (packages.length) findings.push({ file, packages });
  }
  expect(findings, 'optional packages reached by a first visit without interaction or consent').toEqual([]);
});

test('initial styles leave lazy component content rules outside the untouched shell', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)]
    .map(([link]) => link.match(/href="([^"]+)"/)?.[1])
    .filter((href): href is string => Boolean(href));
  expect(styles.length, 'initial stylesheets named in index.html').toBeGreaterThan(0);
  const css = (await Promise.all(styles.map(async (href) => (await request.get(href)).text()))).join('\n');
  for (const selector of ['.ss-account-menu', '.ss-ledger', '.ss-orders', '.ss-term', '.ss-figure', '.ss-drawer-link', '.ss-drawer-group', '.ss-drawer-settings', '.ss-drawer-brand']) {
    expect.soft(css.includes(selector), `${selector} does not style the untouched shell or Home`).toBe(false);
  }
  // Cold navigation keeps its complete frame before rich content arrives.
  for (const selector of ['.ss-drawer-backdrop', '.ss-drawer-panel', '.ss-drawer-close']) expect(css).toContain(selector);
  // Public guides must remain styled in the static HTML when JavaScript is off.
  expect(css).toContain('.ss-topic-article');
});

async function coldLoad(page: Page, path = '/', api: Api = unavailable, ready?: () => Promise<void>) {
  // The entry script and its preloads load at once; everything imported later
  // (the landing page, motion's features, before the fix the account widget)
  // waits HOLD_MS.
  const html = await (await page.request.get('/')).text();
  const initial = new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((match) => match[1]));
  expect(initial.size, 'entry scripts named in index.html').toBeGreaterThan(0);
  let held = 0;
  await page.route('**/assets/**/*.js', async (route) => {
    if (!initial.has(new URL(route.request().url()).pathname)) {
      held += 1;
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    }
    await route.continue();
  });
  const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:4173').origin;
  await page.route(url => url.origin === origin && url.pathname.startsWith('/api/'),
    route => api(route, new URL(route.request().url())));
  await page.addInitScript(() => {
    type LayoutShiftEntry = PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources: { node: Node | null }[];
    };
    const state = { frames: [] as Frame[], shifts: [] as Shift[] };
    Object.assign(window, { __firstLoad: state });
    const describe = (node: Node | null) =>
      node instanceof Element ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${node.classList.length ? `.${[...node.classList].join('.')}` : ''}` : String(node?.nodeName);
    if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShiftEntry[]) {
          state.shifts.push({
            t: Math.round(entry.startTime),
            value: entry.value,
            input: entry.hadRecentInput,
            sources: entry.sources.map((source) => describe(source.node)),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    }
    const sample = () => {
      const main = document.getElementById('main-content');
      if (main) {
        const footer = document.querySelector('.ss-brand-footer');
        const box = document.querySelector('.ss-route');
        state.frames.push({
          t: Math.round(performance.now()),
          mainTop: main.getBoundingClientRect().top,
          header: document.querySelector('.ss-header')?.getBoundingClientRect().height ?? null,
          route: Boolean(document.querySelector('.ss-route')),
          footer: footer ? footer.getBoundingClientRect().top : null,
          page: box ? box.getBoundingClientRect().height : null,
          nav: document.querySelector('nav.ss-nav-center a')?.getBoundingClientRect().left ?? null,
          text: box?.textContent ?? '',
        });
      }
      if (performance.now() < 8000) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await ready?.();
  // Late work (fonts, the sign-in nudge, idle preloads) has time to land.
  await page.waitForTimeout(1500);
  const recorded = await page.evaluate(() => (window as unknown as Recorder).__firstLoad);
  return { ...recorded, held };
}

for (const profile of PROFILES) {
  test.describe(profile.name, () => {
    test.use(profile.use);

    test('the first load of / keeps <main> and the footer where they land', async ({ page }) => {
      const { frames, shifts, held } = await coldLoad(page);
      expect(held, 'lazy chunks held back').toBeGreaterThan(0);
      // The shell drew on its own before the page: the hold is in effect.
      expect(frames.some((f) => !f.route), 'frames of the shell before the page').toBe(true);
      expect(frames.some((f) => f.route), 'frames with the page').toBe(true);

      // Soft, so one run names every mechanism that came back.
      // The header draws at its final height, so <main> never moves.
      expect.soft([...new Set(frames.map((f) => f.header))], 'header height in each frame').toHaveLength(1);
      expect.soft([...new Set(frames.map((f) => f.mainTop))], 'top edge of <main> in each frame').toHaveLength(1);
      // The footer arrives with the page, never under the first-load loader.
      expect.soft(frames.filter((f) => !f.route && f.footer !== null).length, 'frames with a footer and no page').toBe(0);

      // Nothing on the page moved. Entries flagged as input count too.
      const moved = shifts.flatMap((shift) => shift.sources);
      expect.soft(moved.filter((node) => node === 'main#main-content' || node.startsWith('header') || node.startsWith('footer')), 'shell nodes that moved').toEqual([]);
      await expectLayoutStability(page, { shifts, frames }, '/');
      if (shifts.length > 0) {
        const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
        expect.soft(total, `layout shift score, all entries: ${JSON.stringify(shifts)}`).toBeLessThan(0.01);
      }
    });
  });
}

// Use the same session-window score as perf:measure, with no lab interaction.
async function expectLayoutStability(page: Page, { frames, shifts }: Recorder['__firstLoad'], path: string) {
  const { summarizeLayoutShifts } = await import(resolve('scripts/measure-web-performance.mjs'));
  const { cls } = summarizeLayoutShifts(shifts.map(shift => ({
    startTime: shift.t, hadRecentInput: shift.input, value: shift.value,
  })));
  const observerSupported = await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes('layout-shift'));
  const mainTops = frames.map(frame => frame.mainTop);
  const mainTopRangePx = mainTops.length ? Math.max(...mainTops) - Math.min(...mainTops) : null;
  const receipt = {
    path, viewport: page.viewportSize(), observerSupported,
    cls: observerSupported ? cls : null, entries: observerSupported ? shifts.length : null,
    sampledFrames: frames.length, mainTopRangePx,
  };
  await test.info().attach('lab-cls', { body: JSON.stringify(receipt), contentType: 'application/json' });
  console.log('LAB_CLS_RECEIPT ' + JSON.stringify(receipt));
  if (page.context().browser()?.browserType().name() === 'chromium') {
    expect(observerSupported, 'Chromium must expose the Layout Instability API').toBe(true);
  }
  if (observerSupported) {
    expect(cls, path + ' lab CLS: ' + JSON.stringify(shifts)).toBeLessThan(0.05);
  } else {
    expect(frames.length, path + ' rendered animation frames').toBeGreaterThan(1);
    expect(frames.some(frame => frame.route), path + ' rendered route').toBe(true);
    expect(mainTopRangePx, path + ' movement of the top of main in CSS pixels').toBeLessThanOrEqual(1);
  }
}

for (const profile of PROFILES) {
  test.describe(profile.name + ', successful cold loads', () => {
    test.use(profile.use);
    for (const path of ['/learn', '/coding', '/daily']) {
      test(path + ' shows its real content with lab CLS under 0.05', async ({ page }) => {
        const { apiFixture, prepareResponsiveFixtures } = await import(resolve('scripts/check-responsive.mjs'));
        await prepareResponsiveFixtures();
        const unhandled: string[] = [];
        const api: Api = async (route, url) => {
          const response = apiFixture(route.request().method(), url, 'guest');
          if (!response) unhandled.push(url.pathname + url.search);
          return response ? route.fulfill({ status: response.status, json: response.body }) : unavailable(route, url);
        };
        const ready = async () => {
          if (path === '/daily') await expect(page.getByRole('button', { name: 'Check answer' })).toBeVisible();
          if (path === '/learn') {
            await expect(page).toHaveURL(/\/learn\/web-developer$/);
            await expect(page.getByRole('radiogroup', { name: 'Choose a topic' })).toBeVisible();
          }
          if (path === '/coding') {
            if (profile.name === 'phone') await expect(page.getByText(/This section only works in desktop apps/)).toBeVisible();
            else await expect(page.locator('.cd-track-directory a[href="/coding/javascript"]')).toBeVisible();
          }
        };
        const recorded = await coldLoad(page, path, api, ready);
        expect(unhandled, 'requests without a local fixture').toEqual([]);
        await expectLayoutStability(page, recorded, path);
      });
    }
  });
}

// A page drew once: from its first frame on, the route box kept its height,
// and no layout-shift entry was recorded at all, input-flagged ones included.
function expectOneDraw({ frames, shifts }: { frames: Frame[]; shifts: Shift[] }, label: string) {
  const drawn = frames.filter((f) => f.route && f.page !== null && f.page > 0);
  expect(drawn.length, `${label}: frames with the page`).toBeGreaterThan(0);
  expect.soft([...new Set(drawn.map((f) => Math.round(f.page!)))], `${label}: page height in each frame`).toHaveLength(1);
  expect.soft(shifts, `${label}: layout-shift entries`).toEqual([]);
}

for (const profile of PROFILES) {
  test.describe(`${profile.name}, reads that fail`, () => {
    test.use(profile.use);

    // Before, the page's own query asked again after its hold's read failed:
    // the skeleton drew first and the error replaced it after the retry,
    // moving the footer (0.0004 and 0.038 on /today, 0.004 and 0.050 on
    // /leaderboard, desktop and phone).
    for (const path of ['/today', '/leaderboard']) {
      test(`${path} draws its error once`, async ({ page }) => {
        expectOneDraw(await coldLoad(page, path), path);
      });
    }
  });

  test.describe(`${profile.name}, signed in`, () => {
    test.use(profile.use);

    // Before, a session's desktop header moved every nav link when the account
    // widget replaced its 56px placeholder (0.004), and /collection drew a
    // loader in its body and the saved cards a beat later.
    test('/collection draws with its saved cards, under a header that stands still', async ({ page }) => {
      const card = 'What does a closure capture?';
      await storeFakeSession(page);
      await localAuth(page);
      // The cards answer 400ms after they are asked for, after the page's code
      // has arrived, so a page that does not wait for them draws without them.
      const recorded = await coldLoad(page, '/collection', async (route, url) => url.pathname === '/api/flashcards'
        ? (await new Promise((resolve) => setTimeout(resolve, 400)), route.fulfill({ json: { cards: [{ question_id: 'q1', question: card, category: 'javascript', correct_answer: 'Its scope', explanation: null, created_at: '2026-09-01T00:00:00Z' }] } }))
        : unavailable(route, url));
      await expect(page.getByText(card)).toBeVisible();
      expectOneDraw(recorded, '/collection');
      const drawn = recorded.frames.filter((f) => f.route && f.page);
      expect.soft(drawn.filter((f) => !f.text.includes(card)).length, 'frames of the page without the cards').toBe(0);
      if (profile.name === 'desktop') {
        expect.soft([...new Set(recorded.frames.map((f) => f.nav))], 'left edge of the first nav link in each frame').toHaveLength(1);
      }
    });
  });
}
