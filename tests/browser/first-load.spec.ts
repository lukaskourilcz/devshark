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

async function coldLoad(page: Page, path = '/', api: Api = unavailable) {
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
  await page.route('**/api/**', (route) => api(route, new URL(route.request().url())));
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
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      expect.soft(total, `layout shift score, all entries: ${JSON.stringify(shifts)}`).toBeLessThan(0.01);
    });
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
