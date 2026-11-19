import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, allowConsoleErrors, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { installRouteFocusControl, armRouteFocus, pendingRouteFocus, flushRouteFocus, routeFocusLog } from './route-focus-control';

// A navigation keeps the current page on screen until the next one can draw
// whole. Before, every first visit to a section blanked the content area,
// pulled the footer up into view, flashed the loader for at least React's
// 300ms reveal throttle and only then drew the page ("a glitch, and then it
// rerenders"). Here each section's code is held back on purpose, so anything
// that would flash has time to show, and every animation frame after the click
// is recorded.

// Deliberate local chunk failures must not emit telemetry or other requests
// outside the preview used by this fixture.
test.beforeEach(async ({ page }) => {
  const origin = new URL(process.env.TEST_BASE_URL || 'http://localhost:4173').origin;
  await page.route(url => /^https?:$/.test(url.protocol) && url.origin !== origin, route => route.abort('blockedbyclient'));
});

const HOLD_MS = 600;
// The signed-out centre row (design audit P0.6); Today, Collection and Career
// are not in it for a visitor without a session.
const SECTIONS = ['/coding', '/quiz', '/learn', '/challenge', '/play', '/premium'];

function mobileMenuStylePaths() {
  const manifest = JSON.parse(readFileSync(resolve('client/dist/.vite/manifest.json'), 'utf8')) as Record<string, { css?: string[] }>;
  const styles = manifest['src/components/MobileNavigation.tsx']?.css ?? [];
  const richStyles = styles.filter(path => readFileSync(resolve('client/dist', path), 'utf8').includes('.ss-drawer-link'));
  expect(richStyles.length, 'rich menu rules belong to the dynamic entry stylesheet').toBeGreaterThan(0);
  return new Set(richStyles.map(path => `/${path}`));
}

async function expectRichMenuContent(page: Page, theme: 'light' | 'dark', active = false) {
  await expect(page.locator('html')).toHaveAttribute('data-color-mode', theme);
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  const quiz = menu.getByRole('link', { name: 'Quiz', exact: true });
  await expect(quiz).toBeVisible();
  const style = await quiz.evaluate((element, active) => {
    const probe = document.createElement('span');
    probe.style.color = active ? 'var(--brand-accent)' : 'var(--color-text-primary)';
    probe.style.backgroundColor = 'var(--color-background-muted)';
    element.append(probe);
    const expected = getComputedStyle(probe);
    const actual = getComputedStyle(element);
    const result = { display: actual.display, paddingTop: actual.paddingTop, fontWeight: actual.fontWeight, colorMatches: actual.color === expected.color, activeBackgroundMatches: !active || actual.backgroundColor === expected.backgroundColor };
    probe.remove();
    return result;
  }, active);
  expect(style).toEqual({ display: 'block', paddingTop: '11px', fontWeight: '600', colorMatches: true, activeBackgroundMatches: true });
  expect((await quiz.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  for (const control of await menu.locator('.ss-drawer-settings button, .ss-drawer-brand').all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  // Keyboard modality plus explicit focus tests the painted rule without
  // assuming Safari includes anchors in its native sequential Tab order.
  await page.keyboard.press('Tab');
  await quiz.focus();
  await expect(quiz).toBeFocused();
  expect(await quiz.evaluate(element => ({ width: getComputedStyle(element).outlineWidth, offset: getComputedStyle(element).outlineOffset }))).toEqual({ width: '2px', offset: '-2px' });
}

for (const theme of ['light', 'dark'] as const) test(`the mobile menu waits for its content styles inside a styled cold frame in ${theme}`, async ({ page }) => {
  await prepare(page, 390, theme);
  const paths = mobileMenuStylePaths();
  let requested = 0;
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route(url => paths.has(url.pathname), async route => {
    requested += 1;
    await waiting;
    await route.continue();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(requested, 'menu content CSS is not requested by an untouched Home').toBe(0);
    const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    await opener.click();
    await expect.poll(() => requested).toBeGreaterThan(0);
    const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await expect(menu.getByRole('status')).toHaveText('Loading…');
    await expect(menu.getByRole('link', { name: 'Quiz', exact: true })).toHaveCount(0);
    expect(await menu.evaluate(element => ({ position: getComputedStyle(element).position, overflowY: getComputedStyle(element).overflowY }))).toEqual({ position: 'fixed', overflowY: 'auto' });
    const dismiss = menu.getByRole('button', { name: 'Dismiss', exact: true });
    await expect(dismiss).toBeFocused();
    const coldTarget = await dismiss.boundingBox();
    expect(coldTarget!.width).toBeGreaterThanOrEqual(44);
    expect(coldTarget!.height).toBeGreaterThanOrEqual(44);
    release();
    const quiz = menu.getByRole('link', { name: 'Quiz', exact: true });
    await expect(quiz).toBeVisible();
    await expectRichMenuContent(page, theme);
    await quiz.click();
    await expect(page).toHaveURL(/\/quiz$/);
    await opener.click();
    await expect(menu.getByRole('link', { name: 'Quiz', exact: true })).toHaveAttribute('aria-current', 'page');
    await expectRichMenuContent(page, theme, true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    release();
  }
});
for (const theme of ['light', 'dark'] as const) test(`a failed mobile-menu stylesheet keeps a styled retry and recovers styled links in ${theme}`, async ({ page }) => {
  await prepare(page, 390, theme);
  const paths = mobileMenuStylePaths();
  const escaped = [...paths].map(path => path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  allowConsoleErrors(page, new RegExp(`^Error: Unable to preload CSS for (?:${escaped.join('|')})(?:\\s|$)`));
  let failing = true;
  let dropped = 0;
  let served = 0;
  await page.route(url => paths.has(url.pathname), route => {
    if (failing) { dropped += 1; return route.abort('failed'); }
    served += 1;
    return route.continue();
  });
  const documents: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  await opener.click();
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  await expect(menu.getByRole('alert')).toHaveText('Navigation did not load.');
  expect(dropped).toBeGreaterThan(0);
  expect(documents).toHaveLength(1);
  expect(await menu.evaluate(element => ({ position: getComputedStyle(element).position, overflowY: getComputedStyle(element).overflowY }))).toEqual({ position: 'fixed', overflowY: 'auto' });
  for (const name of ['Dismiss', 'Try again']) {
    const box = await menu.getByRole('button', { name, exact: true }).boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(menu.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
  failing = false;
  await opener.click();
  await menu.getByRole('button', { name: 'Try again', exact: true }).click();
  // Vite retains failed CSS dependencies in this document. Recovery reuses
  // the existing pressed reload rather than resolving an unstyled module.
  await expect.poll(() => documents.length).toBe(2);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await opener.click();
  const quiz = menu.getByRole('link', { name: 'Quiz', exact: true });
  await expect(quiz).toBeVisible();
  expect(served).toBeGreaterThan(0);
  await expectRichMenuContent(page, theme);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(opener).toBeFocused();
});
test('a mobile menu stays usable while its animation features are delayed', async ({ page }) => {
  await prepare(page, 390);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/motion-features-[\w-]+\.js$/, async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  await opener.click();
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
  try {
    await expect(menu.getByRole('link', { name: 'Quiz', exact: true })).toBeVisible();
    // Playwright visibility alone accepts opacity:0 and offscreen transforms.
    await expect.poll(() => menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      let visible = rect.left >= -1 && rect.right > 0 && rect.right <= innerWidth + 1;
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        visible &&= Number(getComputedStyle(parent).opacity) > 0.9;
      }
      return visible;
    }), { timeout: 2000 }).toBe(true);
    await expect(menu.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  } finally {
    release();
  }
  await expect(menu).toHaveCount(0);
});

for (const closeWhileLoading of [false, true]) test(`a delayed mobile navigation chunk keeps keyboard control (${closeWhileLoading ? 'closed before load' : 'opened after load'})`, async ({ page }) => {
  await prepare(page, 390);
  let release = () => {};
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/MobileNavigation-[\w-]+\.js$/, async (route) => {
    await waiting;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Navigation', exact: true });
  try {
    await expect(dialog.getByRole('status')).toHaveText('Loading…', { timeout: 2000 });
    const dismiss = dialog.getByRole('button', { name: 'Dismiss', exact: true });
    await expect(dismiss).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dismiss).toBeFocused();
    if (closeWhileLoading) {
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    }
  } finally {
    release();
  }
  if (closeWhileLoading) {
    // An import completing after dismissal must not reopen or steal focus.
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
  }
  await expect(dialog.getByRole('link', { name: 'Quiz', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

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

async function prepare(page: Page, width: number, theme: 'light' | 'dark' = 'light') {
  await page.setViewportSize({ width, height: width < 760 ? 844 : 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.addInitScript((theme) => {
    try { localStorage.setItem('devquiz:color-mode', theme); } catch { /* private mode */ }
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
  }, theme);
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
    Reflect.set(window, 'setTimeout', (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      schedule(handler, delay === 230 ? 5_000 : delay, ...args));
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


async function desktopFocus(page: Page) {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) return null;
    return {
      tag: node.tagName, id: node.id, href: node.getAttribute('href'),
      label: node.getAttribute('aria-label'), role: node.getAttribute('role'), tabIndex: node.tabIndex,
      body: node === document.body, drawer: Boolean(node.closest('.ss-drawer-panel')),
      visible: node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden',
    };
  });
}

/** Preserve this engine's native traversal, including its link-tab preference. */
async function desktopTabCycle(page: Page) {
  await page.locator('header.ss-header a.ss-header-brand').focus();
  await page.evaluate(() => {
    const keys: { shift: boolean; prevented: boolean }[] = [];
    const observe = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keys.push({ shift: event.shiftKey, prevented: event.defaultPrevented });
    };
    window.addEventListener('keydown', observe);
    Object.assign(window, { __drawerNativeKeys: { keys, stop: () => window.removeEventListener('keydown', observe) } });
  });
  const focus = [];
  try {
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      focus.push(await desktopFocus(page));
    }
    const keys = await page.evaluate(() => (window as unknown as { __drawerNativeKeys: { keys: { shift: boolean; prevented: boolean }[] } }).__drawerNativeKeys.keys);
    return { focus, keys };
  } finally {
    await page.evaluate(() => {
      const probe = window as unknown as { __drawerNativeKeys?: { stop: () => void } };
      probe.__drawerNativeKeys?.stop();
      delete probe.__drawerNativeKeys;
    });
  }
}

test('the desktop native Tab oracle detects a stale hidden-panel interceptor', async ({ page }) => {
  await prepare(page, 1024);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const baseline = await desktopTabCycle(page);
  expect(baseline.keys).toEqual([{ shift: false, prevented: false }, { shift: true, prevented: false }]);
  expect(baseline.focus[0]).toMatchObject({ body: false, drawer: false, visible: true });
  await page.evaluate(() => {
    const hiddenPanel = document.createElement('div');
    hiddenPanel.className = 'ss-drawer-panel';
    hiddenPanel.style.display = 'none';
    const hiddenButton = document.createElement('button');
    hiddenPanel.append(hiddenButton);
    document.body.append(hiddenPanel);
    const intercept = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      hiddenButton.focus();
    };
    document.addEventListener('keydown', intercept);
    Object.assign(window, { __removeDrawerInterception: () => { document.removeEventListener('keydown', intercept); hiddenPanel.remove(); } });
  });
  try {
    const intercepted = await desktopTabCycle(page);
    expect(intercepted.keys).toEqual([{ shift: false, prevented: true }, { shift: true, prevented: true }]);
    expect(intercepted).not.toEqual(baseline);
  } finally {
    await page.evaluate(() => {
      const probe = window as unknown as { __removeDrawerInterception?: () => void };
      probe.__removeDrawerInterception?.();
      delete probe.__removeDrawerInterception;
    });
  }
  expect(await desktopTabCycle(page)).toEqual(baseline);
});

// F3 breakpoint contract: a CSS-hidden drawer must never keep its modal keys.
for (const menuState of ['loaded', 'held', 'failed'] as const) {
  test(`a ${menuState} mobile menu closes at the desktop breakpoint without trapping focus`, async ({ page, browserName }) => {
    await prepare(page, 390);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    let release = () => {};
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let requested = 0;
    let served = 0;
    if (menuState !== 'loaded') {
      await page.route(/\/assets\/MobileNavigation-[\w-]+\.js$/, async (route) => {
        requested += 1;
        if (menuState === 'failed') return route.abort('failed');
        await waiting;
        await route.continue();
        served += 1;
      });
    }
    if (menuState === 'failed') {
      // WebKit omits the URL. This exact message is expected only in the case
      // that aborts the named menu chunk and asserts its actual error state.
      allowConsoleErrors(page, browserName === 'webkit'
        ? /^TypeError: Importing a module script failed\.$/
        : /^TypeError: Failed to fetch dynamically imported module: \S+\/assets\/MobileNavigation-[\w-]+\.js/);
    }
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
      const brand = page.locator('header.ss-header a.ss-header-brand');
      // Record the real closed desktop order before any drawer owns keys.
      // Native WebKit can skip anchors and return to body on reverse Tab.
      await page.setViewportSize({ width: 1024, height: 844 });
      await expect(opener).toBeHidden();
      const nativeCycle = await desktopTabCycle(page);
      expect(nativeCycle.keys).toEqual([{ shift: false, prevented: false }, { shift: true, prevented: false }]);
      expect(nativeCycle.focus[0]).toMatchObject({ body: false, drawer: false, visible: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(opener).toBeVisible();
      await opener.click();
      const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
      if (menuState === 'loaded') await expect(menu.getByRole('link', { name: 'Quiz', exact: true })).toBeVisible();
      else {
        await expect.poll(() => requested).toBeGreaterThan(0);
        if (menuState === 'held') await expect(menu.getByRole('status')).toHaveText('Loading…');
        else await expect(menu.getByRole('alert')).toHaveText('Navigation did not load.');
      }
      await expect(menu.getByRole('button', { name: 'Dismiss', exact: true })).toBeFocused();
      await page.setViewportSize({ width: 1023, height: 844 });
      await expect(menu).toBeVisible();
      await expect(opener).toBeVisible();
      await page.setViewportSize({ width: 1024, height: 844 });
      await expect(opener).toBeHidden();
      await expect.soft(page.locator('.ss-drawer-panel')).toHaveCount(0);
      // Home has no current primary nav link, so the visible brand is next.
      await expect.soft(brand).toBeFocused();
      // Establish a known visible origin too, so a missing restoration does
      // not hide an independent document-level Tab interception failure.
      const afterResize = await desktopTabCycle(page);
      expect.soft(afterResize).toEqual(nativeCycle);
      const desktopDestination = afterResize.focus.at(-1);
      await page.setViewportSize({ width: 1280, height: 844 });
      await expect.soft(page.locator('.ss-drawer-panel')).toHaveCount(0);
      if (menuState === 'held') {
        release();
        await expect.poll(() => served).toBeGreaterThan(0);
        await page.waitForLoadState('networkidle');
        await expect.soft(page.locator('.ss-drawer-panel')).toHaveCount(0);
        expect.soft(await desktopFocus(page)).toEqual(desktopDestination);
      }
      // Shrinking back does not replay the old open request.
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.soft(page.locator('.ss-drawer-panel')).toHaveCount(0);
    } finally {
      release();
    }
  });
}

// A route focus delay must not mistake a control's round trip for inactivity.
for (const theme of ['light', 'dark'] as const) test(`pending route focus preserves a newer completed drawer interaction in ${theme}`, async ({ page }, testInfo) => {
  await prepare(page, 390, theme);
  await installRouteFocusControl(page);
  const manifest = JSON.parse(readFileSync(resolve('client/dist/.vite/manifest.json'), 'utf8'));
  const quizPath = `/${manifest['src/components/Quiz.tsx'].file}`;
  let release = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let requested = 0;
  await page.route(url => url.pathname === quizPath, async route => {
    requested += 1;
    await waiting;
    await route.continue();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const home = await page.locator('#main-content h1').first().innerText();
    const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    const menu = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await opener.click();
    await menu.getByRole('link', { name: 'Quiz', exact: true }).click();
    await expect(page).toHaveURL(/\/quiz$/);
    await expect.poll(() => requested).toBeGreaterThan(0);
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
    await armRouteFocus(page);
    release();
    await expect(page.locator('#main-content h1').first()).not.toHaveText(home);
    await expect.poll(() => pendingRouteFocus(page)).toBe(1);
    await opener.click();
    await expect(menu.getByRole('link', { name: 'Quiz', exact: true })).toHaveAttribute('aria-current', 'page');
    await expectRichMenuContent(page, theme, true);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(opener).toBeFocused();
    await flushRouteFocus(page);
    await expect(opener).toBeFocused();
  } finally {
    release();
    await testInfo.attach('route-focus-timeline', { body: JSON.stringify(await routeFocusLog(page), null, 2), contentType: 'application/json' });
  }
});

test('ordinary menu navigation still focuses main without a newer interaction', async ({ page }, testInfo) => {
  await prepare(page, 390);
  await installRouteFocusControl(page);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await armRouteFocus(page);
    await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
    await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Quiz', exact: true }).click();
    await expect(page).toHaveURL(/\/quiz$/);
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
    await expect.poll(() => pendingRouteFocus(page)).toBe(1);
    await flushRouteFocus(page);
    await expect(page.locator('#main-content')).toBeFocused();
  } finally {
    await testInfo.attach('route-focus-timeline', { body: JSON.stringify(await routeFocusLog(page), null, 2), contentType: 'application/json' });
  }
});

test('a later route cancels the pending focus callback of the previous route', async ({ page }, testInfo) => {
  await prepare(page, 390);
  await installRouteFocusControl(page);
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await armRouteFocus(page);
    const opener = page.getByRole('button', { name: 'Open navigation menu', exact: true });
    const menu = page.getByRole('dialog', { name: 'Navigation' });
    await opener.click();
    await menu.getByRole('link', { name: 'Quiz', exact: true }).click();
    await expect.poll(() => pendingRouteFocus(page)).toBe(1);
    await opener.click();
    await menu.getByRole('link', { name: 'Premium', exact: true }).click();
    await expect(page).toHaveURL(/\/premium$/);
    await expect.poll(async () => (await routeFocusLog(page)).some(entry => (entry as { kind: string }).kind === 'cancelled')).toBe(true);
    await expect.poll(() => pendingRouteFocus(page)).toBe(1);
    await flushRouteFocus(page);
    await expect(page.locator('#main-content')).toBeFocused();
    expect((await routeFocusLog(page)).filter(entry => {
      const item = entry as { kind: string; path: string };
      return item.kind === 'callback' && item.path === '/quiz';
    })).toHaveLength(0);
  } finally {
    await testInfo.attach('route-focus-timeline', { body: JSON.stringify(await routeFocusLog(page), null, 2), contentType: 'application/json' });
  }
});
