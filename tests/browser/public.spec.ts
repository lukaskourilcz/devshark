import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
const slug = 'javascript-closures';
for (const theme of ['light', 'dark']) {
  test(`${theme}: guide, keyboard practice and accessible content`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme as 'light' | 'dark' });
    await page.addInitScript((theme) => localStorage.setItem('devquiz:color-mode', theme), theme);
    await page.goto(`/topics/${slug}`);
    // The build-time fallback has the same article markup. Wait for the live
    // route before focusing: React replaces fallback nodes during startup.
    // The separate JavaScript-disabled test covers the static disclosure.
    await expect(page.locator('.ss-public-fallback')).toHaveCount(0);
    const article = page.locator('article.ss-topic-article');
    await expect(article).toHaveAttribute('lang', 'en');
    await expect(article.locator('h1')).toBeVisible();
    await article.locator('summary').first().focus();
    await page.keyboard.press('Enter');
    await expect(article.locator('details').first()).toHaveAttribute('open', '');
    // The route box fades in even under reduced motion; axe reads colours
    // blended with the page until that finite fade ends.
    await article.evaluate(async (element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        await Promise.all(node.getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)));
      }
    });
    const findings = await new AxeBuilder({ page }).include('article.ss-topic-article').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(findings.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('guide.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await article.locator('.ss-topic-cta').click();
    await expect(page).toHaveURL(/\/quiz\?category=/);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('#public-schema')).toHaveCount(0);
  });
}
test('the guide remains readable with JavaScript disabled', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${process.env.TEST_BASE_URL || 'http://localhost:4173'}/topics/${slug}`);
  await expect(page.locator('h1')).toBeVisible();
  await page.locator('summary').first().click();
  await expect(page.locator('details').first().locator('p')).toBeVisible();
  await context.close();
});
// C4-4: a crawler or a link preview that runs no JavaScript reads the Coding
// home and a track page under their own title and canonical URL, which used to
// be the home page's.
test('the Coding home and a track page serve their own head', async ({ request }) => {
  for (const [path, title] of [['/coding', 'Coding challenges · devShark'], ['/coding/javascript', 'JavaScript coding challenges · devShark']]) {
    const html = await (await request.get(path)).text();
    expect(html).toContain(`<title>${title}</title>`);
    expect(html).toContain(`<link rel="canonical" href="https://devshark.app${path}" />`);
    expect(html).not.toContain('<link rel="canonical" href="https://devshark.app/" />');
  }
});
// Owner decision of 9 Oct 2026: the Coding home and its five track pages are
// in the sitemap, the task pages are not, and system design is hidden: its
// track page and every old task address under it are one not-found page,
// noindex in the HTML itself, with no canonical.
test('the sitemap lists the Coding pages, and system design is a noindex page', async ({ request }) => {
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const coding = [...sitemap.matchAll(/<loc>https:\/\/devshark\.app(\/coding[^<]*)<\/loc>/g)].map((match) => match[1]);
  expect(coding).toEqual(['/coding', '/coding/javascript', '/coding/typescript', '/coding/react', '/coding/algorithms', '/coding/fullstack']);
  for (const path of ['/coding/system-design', '/coding/system-design/sd-url-shortener', '/coding/system-design/dd-requests-per-second']) {
    const html = await (await request.get(path)).text();
    expect(html).toContain('<meta name="robots" content="noindex" />');
    expect(html).not.toContain('rel="canonical"');
    expect(html).toContain('That track does not exist.');
  }
});


test('retired guide addresses show the app not-found page without an English redirect', async ({ page }) => {
  await page.goto('/cs/topics/javascript-closures');
  await expect(page).toHaveURL(/\/cs\/topics\/javascript-closures$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('That page is out of the water.');
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test('published Learn sections have public previews without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    for (const [id, name] of [['web-developer', 'Web Developer'], ['software-engineer', 'Software Engineer'], ...(FDE_SECTION_VISIBLE ? [['forward-deployed-engineer', 'Forward Deployed Engineer']] : [])]) {
      await page.goto(`${process.env.TEST_BASE_URL || 'http://localhost:4173'}/learn/${id}`);
      await expect(page).toHaveTitle(`${name} · devShark`);
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://devshark.app/learn/${id}`);
      expect(await page.locator('a[href*="?topic="]').count()).toBeGreaterThan(0);
      for (const link of await page.locator('a[href*="?topic="]').all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  } finally { await context.close(); }
});

test('the held FDE section has no public preview or sitemap listing', async ({ request }) => {
  test.skip(FDE_SECTION_VISIBLE, 'FDE is published only after the owner reopens it.');
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain('/learn/forward-deployed-engineer');
  const html = await (await request.get('/learn/forward-deployed-engineer')).text();
  expect(html).not.toContain('<title>Forward Deployed Engineer · devShark</title>');
  expect(html).not.toContain('href="https://devshark.app/learn/forward-deployed-engineer"');
});
