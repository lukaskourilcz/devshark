import { test, expect } from './console-clean';
import AxeBuilder from '@axe-core/playwright';

// Astryx gives an unselected segment its hover rule in place of its
// transparent base, so without the shared rule in astryx-theme.css the
// browser paints it ButtonFace, a mid grey in dark mode that the secondary
// label fails. /roadmap has no local override; /leaderboard used to. The
// Learn section switcher (#488) is the third.
for (const route of ['/roadmap', '/leaderboard', '/learn/web-developer']) for (const theme of ['light', 'dark']) {
  test(`${theme}: ${route} segmented control shows the track at rest`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ colorScheme: theme as 'light' | 'dark', reducedMotion: 'reduce' });
    await page.addInitScript((theme) => { try { localStorage.setItem('devquiz:color-mode', theme); } catch { /* private mode */ } }, theme);
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      // The roadmap renders its track chooser once the structure answers.
      if (url.pathname === '/api/quiz/roadmap' && !url.search) return route.fulfill({ json: { topics: [], structure: {} } });
      return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
    });
    await page.goto(route);
    const items = page.locator('.astryx-segmented-control-item');
    await expect(items.first()).toBeVisible();
    const rest = await items.evaluateAll((elements) => elements
      .filter((element) => element.getAttribute('aria-checked') !== 'true')
      .map((element) => getComputedStyle(element).backgroundColor));
    expect(rest.length).toBeGreaterThan(0);
    expect(rest).toEqual(rest.map(() => 'rgba(0, 0, 0, 0)'));
    // Astryx's hover wash still wins over the shared rule. The segment fades
    // its background over 175 ms (reduced motion does not turn that off), so a
    // read in the same instant as the hover can still see the resting
    // transparent value; poll until the wash has painted.
    const unselected = page.locator('.astryx-segmented-control-item[aria-checked="false"]').first();
    await unselected.hover();
    await expect.poll(() => unselected.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await page.mouse.move(0, 0);
    const contrast = await new AxeBuilder({ page }).include('.astryx-segmented-control-item').withRules(['color-contrast']).analyze();
    expect(contrast.violations).toEqual([]);
  });
}
