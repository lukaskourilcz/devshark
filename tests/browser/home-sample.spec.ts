import { test, expect } from './console-clean';
import { SUBJECT_SCOPE_CATALOG } from '../../shared/subject-catalog';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: homepage has one working JavaScript question on desktop and mobile`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addInitScript((theme) => localStorage.setItem('devquiz:color-mode', theme), theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    const sample = page.getByRole('group', { name: 'What does this return?' });
    await expect(sample).toBeVisible();
    const reject = page.getByRole('button', { name: 'Reject all', exact: true });
    if (await reject.isVisible()) await reject.click();
    await expect(sample.getByRole('button')).toHaveCount(4);
    await expect(sample).toContainText('2 ** 3;');
    const stats = page.locator('.ss-hero-stats');
    await expect(stats.getByText('coding challenges', { exact: true })).toBeVisible();
    await expect(stats).toContainText(SUBJECT_SCOPE_CATALOG.webdev.codingChallengeCount.toLocaleString());
    await expect(page.locator('.ss-feature-gallery, .ss-home-video')).toHaveCount(0);
    // The page width sits on the route box (.ss-route); its wrapper is full width
    // so the footer keeps its own box (UX audit U1, #573).
    const content = page.locator('#main-content .ss-route');
    for (const width of [1440, 2560]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await content.boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(1000);
      expect(bounds!.width).toBeGreaterThan(990);
      expect(Math.abs(bounds!.x - (width - bounds!.x - bounds!.width))).toBeLessThan(20);
      const copy = await page.locator('.ss-hero-copy').boundingBox();
      expect(Math.abs(copy!.y + copy!.height / 2 - 500)).toBeLessThan(2);
    }
    for (const height of [729, 900, 1200]) {
      await page.setViewportSize({ width: 1440, height });
      const copy = await page.locator('.ss-hero-copy').boundingBox();
      expect(Math.abs(copy!.y + copy!.height / 2 - height / 2)).toBeLessThan(2);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: info.outputPath(`homepage-quiz-${theme}.png`) });
    const correct = sample.getByRole('button', { name: /^B 8/ });
    await correct.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ss-home-sample').getByRole('status')).toContainText('Correct.');
    await expect(correct).toBeDisabled();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(sample).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`homepage-quiz-mobile-${theme}.png`), fullPage: true });
  });
}
