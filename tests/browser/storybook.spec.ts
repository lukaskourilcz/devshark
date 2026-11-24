import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
test.skip(!process.env.STORYBOOK_URL, 'Run with STORYBOOK_URL after starting the workshop');
// Storybook's a11y addon runs axe in the same frame after each render, and a
// second run started meanwhile throws "Axe is already running". Wait it out.
async function analyze(page: Page) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    } catch (error) {
      if (attempt >= 8 || !String(error).includes('Axe is already running')) throw error;
      await page.waitForTimeout(250);
    }
  }
}
const leaderboardStates = ['populated', 'pinned', 'empty', 'server-error', 'offline'];
for (const story of leaderboardStates) {
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
  expect((await analyze(page)).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});


test('every published component story passes the accessibility checks', async ({ page, request }) => {
  test.setTimeout(240_000);
  const address = process.env.STORYBOOK_URL!;
  const response = await request.get(address + '/index.json');
  expect(response.ok()).toBe(true);
  const index = await response.json() as { entries: Record<string, { type: string; id: string }> };
  const stories = Object.values(index.entries).filter(entry => entry.type === 'story');
  expect(stories.length).toBeGreaterThan(leaderboardStates.length);
  for (const { id } of stories) for (const theme of ['light', 'dark']) {
    if (theme === 'light' && leaderboardStates.some(state => id === 'screens-leaderboard--' + state)) continue;
    await test.step(id + ' ' + theme, async () => {
      const url = new URL('/iframe.html', address);
      url.searchParams.set('id', id);
      url.searchParams.set('viewMode', 'story');
      url.searchParams.set('globals', 'theme:' + theme);
      await page.goto(url.href);
      await expect(page.locator('#storybook-root > *').first()).toBeVisible();
      await expect(page.locator('body')).not.toHaveClass(/sb-show-(?:errordisplay|nopreview)/);
      if (id === 'astryx-practice-sample--unanswered') {
        const feedback = page.getByRole('status');
        await expect(feedback).toBeEmpty();
        await page.getByRole('button', { name: /^C\s*4$/ }).click();
        await expect(feedback).toBeFocused();
        await expect(feedback).toContainText('Incorrect.');
      }
      const checks = await analyze(page);
      expect.soft(checks.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), id + ' ' + theme).toEqual([]);
    });
  }
});
