import { test, expect, type Page } from './console-clean';

async function pausedGuide(page: Page, theme: 'light' | 'dark') {
  let resume!: () => void;
  const entry = new Promise<void>(resolve => { resume = resolve; });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.addInitScript(theme => localStorage.setItem('devquiz:color-mode', theme), theme);
  await page.route('**/assets/main-*.js', async route => { await entry; await route.continue(); });
  await page.goto('/topics/javascript-closures', { waitUntil: 'commit' });
  await expect(page.locator('.ss-public-fallback summary').first()).toBeVisible();
  return resume;
}

for (const theme of ['light', 'dark'] as const) for (const input of ['keyboard', 'pointer'] as const) {
  test(`${theme} ${input}: startup preserves native guide disclosures and summary focus`, async ({ page }) => {
    await page.setViewportSize({ width: input === 'keyboard' ? 360 : 1440, height: 900 });
    const resume = await pausedGuide(page, theme);
    try {
      const fallback = page.locator('.ss-public-fallback details');
      const toggle = async (index: number) => {
        const summary = fallback.nth(index).locator('summary');
        if (input === 'keyboard') { await summary.focus(); await summary.press('Enter'); }
        else await summary.click();
      };
      await toggle(0);
      await toggle(1);
      await toggle(0);
      await fallback.nth(1).locator('summary').focus();
      await expect(fallback.nth(0)).not.toHaveAttribute('open', '');
      await expect(fallback.nth(1)).toHaveAttribute('open', '');
      resume();
      await expect(page.locator('.ss-public-fallback')).toHaveCount(0);
      const live = page.locator('article.ss-topic-article details');
      await expect(live.nth(0)).not.toHaveAttribute('open', '');
      await expect(live.nth(1)).toHaveAttribute('open', '');
      await expect(live.nth(1).locator('summary')).toBeFocused();
      await live.nth(1).locator('summary').press('Space');
      await expect(live.nth(1)).not.toHaveAttribute('open', '');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (theme === 'light' && input === 'keyboard') {
        await live.nth(0).locator('summary').click();
        await expect(live.nth(0)).toHaveAttribute('open', '');
        await page.getByRole('link', { name: 'Practice in a quiz', exact: true }).click();
        await expect(page).toHaveURL(/\/quiz\?category=/);
        await expect(page.locator('article.ss-topic-article')).toHaveCount(0);
        await page.goBack();
        await expect(live.nth(0)).not.toHaveAttribute('open', '');
        await expect(page.locator('#main-content')).toBeFocused();
      }
    } finally { resume(); }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: startup does not take focus back after the visitor moves elsewhere`, async ({ page }) => {
    let showArticle!: () => void;
    const article = new Promise<void>(resolve => { showArticle = resolve; });
    await page.route('**/assets/TopicLandingPage-*.js', async route => { await article; await route.continue(); });
    const resume = await pausedGuide(page, theme);
    try {
      const summary = page.locator('.ss-public-fallback summary').first();
      await summary.focus(); await summary.press('Enter');
      resume();
      await expect(page.locator('.ss-public-fallback')).toHaveCount(0);
      const elsewhere = page.getByRole('link', { name: 'Skip to content', exact: true });
      await elsewhere.focus(); await expect(elsewhere).toBeFocused();
      showArticle();
      await expect(page.locator('article.ss-topic-article details').first()).toHaveAttribute('open', '');
      await expect(elsewhere).toBeFocused();
    } finally { resume(); showArticle(); }
  });
}

test('the guide remains interactive if optional scroll feedback cannot load', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/scrollbarActivity-*.js', route => route.abort());
  await page.goto('/topics/javascript-closures');
  await expect(page.locator('.ss-public-fallback')).toHaveCount(0);
  const summary = page.locator('article.ss-topic-article summary').first();
  await summary.focus(); await summary.press('Enter');
  await expect(page.locator('article.ss-topic-article details').first()).toHaveAttribute('open', '');
  expect(errors).toEqual([]);
});
