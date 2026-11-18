import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';

// Whole-page axe over the signed-out app routes. The other browser specs scope
// axe to one container (`article.ss-topic-article`, `.cd-workbench`), so a
// defect in the app shell or on a landing surface cannot fail them. This spec
// scopes nothing and uses the full WCAG 2.2 AA tag set, so an accent chip
// below 4.5:1 or a sideways scroller a keyboard cannot reach fails a gate
// instead of waiting for a manual audit.
//
// The app ships English only (#485), so there is one locale to scan.

// A signed-out /profile sends the visitor home, so the home page is scanned
// under its own name rather than as "/profile".
const ROUTES = ['/', '/today', '/leaderboard', '/challenge'];
const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
];
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// Dark mode also covers the surfaces the pre-launch design audit reworked
// (P1.9): the homepage, Coins, Coding and the quiz setup.
const DARK_ROUTES = ['/', '/today', '/leaderboard', '/shop', '/coding', '/quiz', '/challenge'];

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

for (const theme of ['light', 'dark']) {
  const routes = theme === 'dark' ? DARK_ROUTES : ROUTES;
  test(`${theme}: signed-out routes pass WCAG 2.2 AA`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme as 'light' | 'dark' });
    await page.addInitScript((theme) => {
      try { localStorage.setItem('devquiz:color-mode', theme); } catch {}
    }, theme);

    for (const route of routes) for (const viewport of WIDTHS) {
      await page.setViewportSize(viewport);
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await settled(page);
      const findings = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(
        findings.violations.map((v) => `${v.id} [${v.impact}] ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
        `${route} at ${viewport.width}px, ${theme}`,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
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
