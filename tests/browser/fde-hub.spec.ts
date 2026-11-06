import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { storeFakeSession, localAuth } from './fake-session';
import { pathById, publicManifest } from '../../lib/learning-paths/catalog';
import { pathInventory } from '../../shared/learning-paths';

const manifest = publicManifest(pathById('fde')!);
const first = manifest.modules.find(module => !module.optional && !module.shelf)!;
// The board lists only the competencies some loop activity supplies (UX audit learn-11).
const areas = manifest.competencies.filter(competency => manifest.modules.some(module => !module.optional && !module.shelf && module.activities.some(activity => activity.competencies.includes(competency.id))));
const enrollment = { enrollmentId: 'LOCALFDEHUB000000000', pathId: 'fde', curriculumVersion: 1, status: 'active', baseTrackAtEnrollment: 'fullstack', startedAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: recorded FDE board, keyboard, reflow and completion artwork`, async ({ page }, info) => {
    await storeFakeSession(page); await localAuth(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(mode => {
      localStorage.setItem('devquiz:color-mode', mode);
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    let complete = false;
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url());
      const resource = url.searchParams.get('resource');
      const op = url.searchParams.get('op') ?? url.pathname.split('/').pop();
      if (resource === 'learning-path-catalog') return route.fulfill({ json: { versions: { fde: 1 }, paths: [{ manifest, availability: 'available', inventory: pathInventory(manifest) }] } });
      if (op === 'entitlement') return route.fulfill({ json: { tier: 'premium', source: 'manual', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
      if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [enrollment] } });
      if (op === 'learning-path-progress') return route.fulfill({ json: {
        enrollment, modules: manifest.modules.filter(module => !module.optional && !module.shelf).map(module => ({
          moduleId: module.id, completed: complete, completedAt: complete ? '2026-10-22T00:00:00Z' : null,
          activities: complete ? module.activities.map(activity => ({ activityId: activity.id, state: activity.kind === 'artifact' || activity.kind === 'lesson' ? 'self_reviewed' : 'verified_pass', verification: activity.verification, score: null, attempts: 1, updatedAt: '2026-10-22T00:00:00Z' })) : [],
        })), competencies: [], recommendedBridges: [], nextActivityId: complete ? null : first.activities[0].id, guidedComplete: complete, artifacts: { submitted: complete ? pathInventory(manifest).artifacts : 0, total: pathInventory(manifest).artifacts }, dueActivityIds: [],
      } });
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local test fixture' } } });
    });
    await page.goto('/learn/forward-deployed-engineer/path');
    const board = page.getByRole('region', { name: 'Competency evidence' });
    await expect(board).toBeVisible();
    // One closed disclosure below the modules, one row per area inside it.
    await expect(board.locator(':scope > details')).not.toHaveAttribute('open', '');
    await expect(board.locator(':scope > details > summary')).toContainText(`${areas.length} areas`);
    await expect(board.locator('h3')).toHaveCount(areas.length);
    await expect(board).not.toContainText('Verified pass');
    const modules = page.locator('section.lp-section').filter({ has: page.getByRole('heading', { level: 2, name: 'Modules' }) });
    expect((await board.boundingBox())!.y).toBeGreaterThan((await modules.boundingBox())!.y);
    await expect(page.locator('[aria-current="step"]')).toContainText('Discover and scope');
    await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(1);
    // The shell's delayed route focus finishes before keyboard interaction.
    await expect(page.locator('#main-content')).toBeFocused();
    const summary = board.locator('summary').first();
    await summary.focus(); await page.keyboard.press('Enter');
    await expect(summary.locator('..')).toHaveAttribute('open', '');
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await page.keyboard.press('Tab');
    const row = board.locator('.lp-evidence__row').first();
    await expect(row).toBeFocused();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    await page.keyboard.press('Enter');
    await expect(row.locator('..')).toHaveAttribute('open', '');
    await page.keyboard.press('Tab');
    await expect(board.locator('a').first()).toBeFocused();
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `reflow ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 360, height: 900 });
    // On a phone every activity row has one shape: kind, minutes and state on
    // the first line, the title under them (learn-12 review).
    expect(await page.locator('.lp-activity--row').evaluateAll(rows => rows.filter(row => {
      const box = (selector: string) => row.querySelector(selector)!.getBoundingClientRect();
      return !(box('.lp-activity__title').top >= box('.lp-activity__kind').bottom - 1 && Math.abs(box('.lp-activity__minutes').top - box('.lp-activity__kind').top) < 4);
    }).length)).toBe(0);
    // 200% text in a wide font (Verdana here, DejaVu Sans on the Linux runner):
    // no button label, status pill or long word may run past the column (B14, #510).
    const wide = await page.addStyleTag({ content: 'body, body * { font-family: Verdana, "DejaVu Sans", sans-serif !important; }' });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => {
      const edge = document.querySelector('#main-content')!.getBoundingClientRect().right + 1;
      return [...document.querySelectorAll('#main-content :is(h1, h2, h3, p, li, a, button, span, summary)')]
        .filter(el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.right > edge; })
        .map(el => (el.textContent ?? '').trim().slice(0, 40));
    })).toEqual([]);
    await wide.evaluate(el => (el as Element).remove());
    await page.addStyleTag({ content: 'html { font-size: 100% !important; }' });
    expect((await new AxeBuilder({ page }).include('[aria-labelledby="fde-evidence-title"]').include('[aria-labelledby="fde-loop-title"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
    complete = true; await page.reload();
    await expect(page.getByRole('heading', { name: 'FDE guided path completed', exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download card' }).click();
    const file = await download; expect(file.suggestedFilename()).toBe('devshark-fde-guided-path.png');
    await file.saveAs(info.outputPath(`fde-card-${theme}.png`));
    await page.screenshot({ path: info.outputPath(`fde-hub-${theme}.png`), fullPage: false });
  });
}

// Owner hold: keep these end-to-end checks for the future FDE release.
test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
