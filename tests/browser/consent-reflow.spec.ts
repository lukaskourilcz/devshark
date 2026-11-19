import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from './console-clean';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const clearanceModule = resolve('scripts/responsive-clearance.mjs');
const profiles = [
  { name: '400 percent reflow', viewport: { width: 320, height: 200 }, deviceScaleFactor: 4 },
  { name: '200 percent reflow', viewport: { width: 640, height: 400 }, deviceScaleFactor: 2 },
  { name: 'ordinary desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
];

async function firstVisit(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((theme) => localStorage.setItem('devquiz:color-mode', theme), theme);
  await page.route('**/api/**', (route) => {
    if (new URL(route.request().url()).pathname === '/api/settings') return route.fulfill({ json: settings });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'Local browser fixture' } } });
  });
  await page.goto('/');
  const banner = page.getByRole('region', { name: 'Cookies on devShark' });
  await expect(banner).toBeVisible();
  return banner;
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({
    viewport: profile.viewport, contextOptions: { screen: { width: 1280, height: 800 } },
    deviceScaleFactor: profile.deviceScaleFactor, isMobile: false, hasTouch: false,
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the first cookie choice remains reachable above the ocean in ${theme}`, async ({ page }, info) => {
      const banner = await firstVisit(page, theme);
      const geometry = await banner.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return {
          top: box.top, bottom: box.bottom, height: box.height,
          viewport: { width: innerWidth, height: innerHeight }, density: devicePixelRatio,
          screen: { width: screen.width, height: screen.height },
          shellHeight: document.querySelector('.ss-app-root')!.getBoundingClientRect().height,
        };
      });
      await info.attach('consent-reflow-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
      expect(geometry.viewport).toEqual(profile.viewport);
      expect(geometry.density).toBe(profile.deviceScaleFactor);
      expect(geometry.screen).toEqual({ width: 1280, height: 800 });
      expect(geometry.shellHeight).toBe(profile.viewport.height);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      // The existing shell reserves the final 30 CSS pixels for its ocean.
      expect(geometry.bottom, 'the banner fits above the decorative ocean').toBeLessThanOrEqual(profile.viewport.height - 30);

      const policy = banner.getByRole('link', { name: 'Read the privacy policy' });
      await expect(policy).toHaveAttribute('href', '/privacy#cookies');
      await policy.focus();
      await expect(policy).toBeFocused();
      for (const name of ['Reject all', 'Accept all', 'Choose']) {
        const action = banner.getByRole('button', { name, exact: true });
        await action.focus();
        await expect(action).toBeFocused();
        const hit = await action.evaluate((el) => {
          const box = el.getBoundingClientRect(), port = el.closest('.ss-consent')!.getBoundingClientRect();
          const center = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return {
            width: box.width, height: box.height,
            paintedHeight: Math.min(box.bottom, port.bottom, innerHeight) - Math.max(box.top, port.top, 0),
            receivesPointer: center?.closest('button') === el,
          };
        });
        expect(hit.width, `${name}: target width`).toBeGreaterThanOrEqual(44);
        expect(hit.height, `${name}: target height`).toBeGreaterThanOrEqual(44);
        expect(hit.paintedHeight, `${name}: the complete target can be scrolled into view`).toBeGreaterThanOrEqual(43.99);
        expect(hit.receivesPointer, `${name}: a pointer reaches the focused action`).toBe(true);
      }
      const { CLEARANCE } = await import(clearanceModule);
      const clearance = await page.evaluate(CLEARANCE) as { covered: unknown[] };
      expect(clearance.covered, 'cookie copy and actions clear the ocean').toEqual([]);

      await banner.getByRole('button', { name: 'Reject all', exact: true }).click();
      await expect(banner).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('devshark:consent')!)))
        .toMatchObject({ analytics: false, marketing: false });
    });
  }
});
