import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { resolve } from 'node:path';
import { localAuth, storeFakeSession } from './fake-session';

// Use the same route list, local account and API response shapes as the F6
// responsive check. Optional integrations keep their configured disabled or
// redirected state. An unidentified route or unanswered API is a failed check.
const fixturePath = resolve('scripts/check-responsive.mjs');
const WIDTHS = [{ width: 390, height: 844 }, { width: 1280, height: 800 }];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * axe reads the colours a pixel has, so scanning during an entry fade measures
 * a half-transparent foreground and reports contrast failures that are gone a
 * frame later. Wait for every finite animation and transition to finish;
 * ambient loops never finish, so they are skipped.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().every((animation) => {
    if (animation.playState !== 'running') return true;
    return animation.effect?.getTiming().iterations === Infinity;
  }), undefined, { timeout: 15_000 });
}

for (const theme of ['light', 'dark'] as const) for (const viewport of WIDTHS) {
  test(`${theme}: every F6 route passes WCAG 2.2 AA at ${viewport.width}px`, async ({ page, baseURL }, info) => {
    test.setTimeout(360_000);
    const { DEFAULT_ROUTES, ROUTE_READY_MARKERS, apiFixture, fixtureSession, prepareResponsiveFixtures, readRenderedRoute, renderProblems } = await import(fixturePath);
    await prepareResponsiveFixtures();
    const user = fixtureSession().user;
    await storeFakeSession(page, user);
    await localAuth(page, { user: () => user });
    const origin = new URL(baseURL!).origin;
    const requests: { request: string; answered: boolean }[] = [];
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname.startsWith('/auth/v1/')) return route.fallback();
      if (url.origin !== origin) return route.abort('blockedbyclient');
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const response = apiFixture(request.method(), url, 'signed-in');
      requests.push({ request: request.method() + ' ' + url.pathname + url.search, answered: Boolean(response) });
      return response
        ? route.fulfill({ status: response.status, json: response.body })
        : route.fulfill({ status: 503, json: { error: { code: 'missing_fixture' } } });
    });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addInitScript(theme => {
      localStorage.setItem('devquiz:color-mode', theme);
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
      sessionStorage.setItem('devquiz:auth-reported', '1');
    }, theme);

    for (const path of DEFAULT_ROUTES as string[]) await test.step(path, async () => {
      requests.length = 0;
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await settled(page);
      const marker = ROUTE_READY_MARKERS[path]?.[1];
      if (marker) await expect(page.locator(marker).first()).toBeVisible();
      if (path === '/daily') await expect(page.getByRole('button', { name: 'Check answer' })).toBeVisible();
      if (path === '/leaderboard?tab=month') await expect(page.getByText('Night owl', { exact: true }).first()).toBeVisible();
      if (path === '/coding/javascript/js-double-numbers') await expect(page.locator('.cd-workbench')).toBeVisible();
      if (path === '/coding/system-design') await expect(page.getByRole('heading', { name: 'That track does not exist.' })).toBeVisible();
      const rendered = await page.evaluate(readRenderedRoute, ROUTE_READY_MARKERS);
      expect(renderProblems(path, rendered, requests, 'That page is out of the water.', 'signed-in'), path).toEqual([]);
      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect.soft(result.violations.map(v => `${v.id} [${v.impact}] ${v.nodes.map(n => n.target.join(' ')).join(' | ')}`), path).toEqual([]);
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    });
    await page.screenshot({ path: info.outputPath('last-route.png'), fullPage: true });
  });
}

// The two contracts asserted as behaviour as well, so a failure says which one
// broke rather than only that axe is unhappy. The contrast arithmetic lives in
// client/tests/contrast.test.ts; this proves the token reaches the DOM.
test('the accent chip takes its colour from the derived on-tint token', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('devquiz:color-mode', 'light'); } catch {}
  });
  await page.goto('/');
  await settled(page);
  const chip = page.locator('.ss-panel span').first();
  await expect(chip).toBeVisible();
  const painted = await chip.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      color: style.color,
      onSoft: style.getPropertyValue('--brand-accent-on-soft').trim(),
      accent: style.getPropertyValue('--brand-accent').trim(),
    };
  });
  const asRgb = (hex: string) =>
    `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  // ColorModeContext writes one hex; reset.css's first-paint default is a
  // light-dark() pair. Take whichever branches the token carries.
  const branches = (painted.onSoft.match(/#[0-9a-f]{6}/gi) ?? []).map(asRgb);
  expect(branches.length).toBeGreaterThan(0);
  expect(branches).toContain(painted.color);
  // A real override, not an alias of the brand accent: Web Dev green misses
  // 4.5:1 on its own light tint.
  expect(painted.color).not.toBe(asRgb(painted.accent));
});

test('the homepage path keeps every step in view and starts the selected topic by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  await settled(page);
  await page.getByRole('button', { name: 'Learn CSS', exact: true }).click();
  const path = page.getByRole('list', { name: 'Learn path for CSS' });
  await expect(path.getByText('Layout with Grid & Responsive Design')).toBeVisible();
  await expect(path.getByText('Checkpoint')).toBeVisible();

  // Long step names and the checkpoint need no sideways scrolling on a phone.
  expect(await path.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    return node.scrollWidth <= node.clientWidth && [...node.querySelectorAll('[role="listitem"]')].every((item) => {
      const rect = item.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
  })).toBe(true);

  const topic = page.getByRole('button', { name: 'Learn TypeScript', exact: true });
  await topic.focus();
  await page.keyboard.press('Enter');
  await expect(topic).toHaveAttribute('aria-pressed', 'true');
  const start = page.getByRole('button', { name: 'Start learning TypeScript', exact: true });
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  // Learn names the topic's section in the address (#488).
  await expect(page).toHaveURL(/\/learn\/web-developer\?topic=typescript$/);
});
