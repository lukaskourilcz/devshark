import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// A navigation keeps the current page on screen until the next one can draw
// whole. Before, every first visit to a section blanked the content area,
// pulled the footer up into view, flashed the loader for at least React's
// 300ms reveal throttle and only then drew the page ("a glitch, and then it
// rerenders"). Here each section's code is held back on purpose, so anything
// that would flash has time to show, and every animation frame after the click
// is recorded.

const HOLD_MS = 600;
// The signed-out centre row (design audit P0.6); Today, Collection and Career
// are not in it for a visitor without a session.
const SECTIONS = ['/coding', '/quiz', '/learn', '/challenge', '/play', '/premium'];

for (const theme of ['light', 'dark'] as const) for (const width of [360, 1280]) {
  test(`Quiz task-first setup preserves topic logos and ocean at ${width}px in ${theme}`, async ({ page }, info) => {
    await prepare(page, width);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((theme) => {
      localStorage.setItem('devquiz:color-mode', theme);
      localStorage.setItem('devquiz:quiz-setup:v1', JSON.stringify({ count: 10, difficulty: 'zero-to-hero', categories: [] }));
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    let starts = 0;
    await page.route('**/api/quiz/questions*', (route) => {
      starts++;
      return route.fulfill({ json: { sessionId: 'quiz-setup-fixture', questions: [{ id: 'quiz-setup-1', question: 'Which declaration is block scoped?', options: ['let', 'var'], category: 'javascript', difficulty: 1, introduction: '' }] } });
    });
    await page.goto('/quiz');
    const start = page.getByRole('button', { name: 'Start quiz', exact: true });
    await expect(start).toHaveAccessibleDescription('Choose at least one topic.');
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
    const topics = page.getByRole('group', { name: 'Topics', exact: true });
    const pills = topics.locator('button.ss-topic-pill');
    expect(await pills.count()).toBeGreaterThan(0);
    for (const pill of await pills.all()) await expect(pill.locator(':scope > [aria-hidden]').first()).toBeVisible();
    const javascript = topics.getByRole('button', { name: 'JavaScript', exact: true });
    await javascript.focus();
    await javascript.press('Space');
    await expect(javascript).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
    await expect(start).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('radio', { name: '20 questions', exact: true }).click();
    await page.getByRole('radio', { name: 'Difficulty: Mixed', exact: true }).click();
    await expect(page.getByText('20 questions · Mixed', { exact: true })).toBeVisible();
    await expect(page.locator('.ss-header-brand svg use').last()).toHaveAttribute('href', /devshark-wordmark.*#shark/);
    await expect(page.locator('.ss-fin-drift').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const findings = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(findings.violations.map((item) => item.id)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`quiz-task-first-${theme}-${width}.png`), fullPage: true });
    await start.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('Quiz · Question 1 of 1');
    expect(starts).toBe(1);
    await expect(page.locator('.ss-fin-drift').first()).toBeVisible();
  });
}

test('standalone state cards stay vertically centred across viewports', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('devquiz:color-mode', 'dark');
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  });
  const panel = page.locator('.ss-route > .ss-state-panel');
  for (const path of ['/play', '/play/ABC123', '/cards', '/settings/github']) {
    await page.goto(path);
    await expect(panel.getByRole('heading', { level: 1 })).toBeVisible();
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const { top, bottom, fits } = await panel.evaluate((el) => {
        const route = el.parentElement!.getBoundingClientRect();
        const card = el.getBoundingClientRect();
        return { top: card.top - route.top, bottom: route.bottom - card.bottom, fits: card.left >= 0 && card.right <= innerWidth };
      });
      expect(Math.abs(top - bottom), `${path} at ${width}px`).toBeLessThanOrEqual(2);
      expect(fits, `${path} at ${width}px`).toBe(true);
    }
  }
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto('/play');
  const signIn = panel.getByRole('button', { name: 'Sign in', exact: true });
  await signIn.scrollIntoViewIfNeeded();
  await expect(signIn).toBeInViewport();
});

/** One animation frame of the content area. */
type Frame = { t: number; route: boolean; kids: number; busy: string | null; opacity: number; h1: string | null; root: number; active: string | null; scrollTop: number };
type Recorder = { __nav: { frames: Frame[]; done: boolean }; __navArm: (ms: number) => void };

async function prepare(page: Page, width: number) {
  await page.setViewportSize({ width, height: width < 760 ? 844 : 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  await page.addInitScript(() => {
    try { localStorage.setItem('devquiz:color-mode', 'light'); } catch { /* private mode */ }
    const ids = new WeakMap<Element, number>();
    let next = 1;
    const idOf = (element: Element | null) => {
      if (!element) return 0;
      if (!ids.has(element)) ids.set(element, next++);
      return ids.get(element)!;
    };
    const state = { frames: [] as Frame[], done: true };
    Object.assign(window, { __nav: state });
    Object.assign(window, {
      __navArm: (ms: number) => {
        state.frames = [];
        state.done = false;
        document.addEventListener('click', (event) => {
          const start = event.timeStamp;
          const sample = () => {
            const box = document.querySelector('#main-content > div > div:first-child');
            const main = document.getElementById('main-content');
            state.frames.push({
              t: performance.now() - start,
              route: Boolean(box?.classList.contains('ss-route')),
              kids: box?.childElementCount ?? 0,
              busy: box?.getAttribute('aria-busy') ?? null,
              opacity: box ? Number(getComputedStyle(box).opacity) : 0,
              h1: box?.querySelector('h1')?.textContent ?? null,
              root: idOf(box?.firstElementChild ?? null),
              active: document.querySelector('.ss-navlink[data-active="true"], .ss-drawer-link[data-active="true"]')?.getAttribute('href') ?? null,
              scrollTop: main?.scrollTop ?? 0,
            });
            if (performance.now() - start < ms) requestAnimationFrame(sample);
            else state.done = true;
          };
          sample();
        }, { capture: true, once: true });
      },
    });
  });
  // The API answers at once and says little: this checks the frame, not the pages.
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/roadmap' && !url.search) return route.fulfill({ json: { topics: [], structure: {} } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
  });
  let hold = false;
  await page.route('**/assets/**/*.js', async (route) => {
    if (hold) await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    await route.continue();
  });
  return { holdChunks: () => { hold = true; } };
}

/** Every frame from the click until the held code has long arrived. */
async function measure(page: Page, click: () => Promise<void>): Promise<Frame[]> {
  await page.evaluate((ms) => (window as unknown as Recorder).__navArm(ms), HOLD_MS + 1500);
  await click();
  await page.waitForFunction(() => (window as unknown as Recorder).__nav.done);
  return page.evaluate(() => (window as unknown as Recorder).__nav.frames);
}

test('desktop: every section opens without a blank, a loader or a footer jump', async ({ page }) => {
  test.setTimeout(120_000);
  const { holdChunks } = await prepare(page, 1280);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  holdChunks();
  for (const section of SECTIONS) {
    // Start scrolled down: the next page must still open at its top.
    await page.evaluate(() => { const main = document.getElementById('main-content'); if (main) main.scrollTop = 400; });
    const frames = await measure(page, () => page.locator(`nav.ss-nav-center a[href="${section}"]`).click());
    expect(frames.length, section).toBeGreaterThan(20);
    // Never an empty content area, never the route loader in its place.
    expect(frames.filter((f) => !f.route || f.kids === 0), section).toEqual([]);
    const previous = frames[0].root;
    const arrived = frames.findIndex((f) => f.root !== previous);
    expect(arrived, `${section} drew its page`).toBeGreaterThan(0);
    // Until then the previous page stayed, marked busy, faded back once the
    // wait outlasted the delay, while the nav already showed the destination.
    const waiting = frames.slice(0, arrived);
    expect(waiting.slice(1).every((f) => f.busy === 'true' && f.active === section), section).toBe(true);
    expect(waiting.filter((f) => f.t > 350).every((f) => f.opacity < 0.7), section).toBe(true);
    // The page arrives at its top and not busy; Coding, whose code was the
    // heaviest and whose page flashed longest, draws with one root element.
    const after = frames.slice(arrived);
    expect(after.every((f) => f.busy === null && f.scrollTop === 0), section).toBe(true);
    if (section === '/coding') expect(new Set(after.map((f) => f.root)).size, section).toBe(1);
  }
});

test('route focus preserves a keyboard control focused before the delayed handoff', async ({ page }) => {
  await prepare(page, 1280);
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    // Hold only the shell's 230 ms focus handoff so this case does not depend
    // on the time Chromium takes to load the destination.
    window.setTimeout = (handler, delay, ...args) => schedule(handler, delay === 230 ? 5_000 : delay, ...args);
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.locator('nav.ss-nav-center a[href="/quiz"]').press('Enter');
  const topic = page.getByRole('button', { name: 'JavaScript', exact: true });
  await topic.focus();
  await expect(topic).toBeFocused();
  // A page-side timer ensures the shell's earlier timer has fired.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 5_050)));
  await expect(topic).toBeFocused();
});

test('phone: the drawer opens Coding without a blank or a loader', async ({ page }) => {
  const { holdChunks } = await prepare(page, 390);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  holdChunks();
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const frames = await measure(page, () => page.locator('.ss-drawer-panel a[href="/coding"]').click());
  expect(frames.filter((f) => !f.route || f.kids === 0)).toEqual([]);
  const arrived = frames.findIndex((f) => f.h1 === 'Coding challenges');
  expect(arrived).toBeGreaterThan(0);
  expect(frames.slice(0, arrived).every((f) => f.root === frames[0].root && f.h1 === frames[0].h1)).toBe(true);
  expect(new Set(frames.slice(arrived).map((f) => f.root)).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

// UX audit shell-public-15: the drawer splits Practice from You, as the
// desktop header does, and holds the appearance and sound toggles at its
// bottom, where the footer's pair (hidden below 1024px) used to sit behind it.
test('phone: the drawer groups its links and keeps the toggles at its bottom', async ({ page }) => {
  await prepare(page, 390);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.ss-footer-settings')).toBeHidden();
  await page.getByRole('button', { name: 'Open navigation menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  const practice = drawer.getByRole('group', { name: 'Practice' });
  const you = drawer.getByRole('group', { name: 'You' });
  await expect(practice.getByRole('link', { name: 'Coding' })).toBeVisible();
  await expect(you.getByRole('link', { name: 'Premium' })).toBeVisible();
  await expect(practice.getByRole('link', { name: 'Premium' })).toHaveCount(0);
  const dark = drawer.getByRole('button', { name: 'Dark mode', exact: true });
  const box = await dark.boundingBox();
  const panel = await page.locator('.ss-drawer-panel').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Pinned to the bottom: the sound row ends within the panel's last 24px.
  const sound = await drawer.getByRole('button', { name: 'Turn sound on' }).boundingBox();
  expect(panel!.y + panel!.height - (sound!.y + sound!.height)).toBeLessThan(24);
  // A toggle keeps the drawer open.
  await dark.click();
  await expect(drawer.getByRole('button', { name: 'Light mode', exact: true })).toBeVisible();
});
