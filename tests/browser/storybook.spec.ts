import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
test.skip(!process.env.STORYBOOK_URL, 'Run with STORYBOOK_URL after starting the workshop');
// Storybook's a11y addon runs axe in the same frame after each render, and a
// second run started meanwhile throws "Axe is already running". Wait it out.
async function analyze(page: Page) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new AxeBuilder({ page }).include('#storybook-root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    } catch (error) {
      if (attempt >= 8 || !String(error).includes('Axe is already running')) throw error;
      await page.waitForTimeout(250);
    }
  }
}
for (const story of ['populated', 'pinned', 'empty', 'server-error', 'offline']) {
  test(`workshop leaderboard ${story}`, async ({ page }) => {
    await page.goto(`${process.env.STORYBOOK_URL}/iframe.html?id=screens-leaderboard--${story}&viewMode=story`);
    // The kicker says "Leaderboard"; the page heading says what the board ranks.
    await expect(page.getByRole('heading', { level: 1, name: 'Leaderboard', exact: true })).toBeVisible();
    if (story === 'populated' || story === 'pinned') await expect(page.getByText('Workshop learner', { exact: true })).toBeVisible();
    if (story === 'pinned') await expect(page.getByText('14', { exact: true }).first()).toBeVisible();
    if (story === 'server-error' || story === 'offline') await expect(page.getByRole('alert')).toBeVisible();
    const result = await analyze(page);
    expect(result.violations).toEqual([]);
  });
}
test('confirmation restores focus after Escape', async ({ page }) => {
  await page.goto(`${process.env.STORYBOOK_URL}/iframe.html?id=astryx-feedback--confirmation&viewMode=story`);
  const trigger = page.getByRole('button', { name: 'Delete account', exact: true });
  await trigger.click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
