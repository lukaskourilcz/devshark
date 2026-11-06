import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { storeFakeSession, localAuth } from './fake-session';
import { pathById, publicManifest } from '../../lib/learning-paths/catalog';
import { pathInventory } from '../../shared/learning-paths';

const manifest = publicManifest(pathById('fde')!);
const inventory = pathInventory(manifest);
const enrollment = { enrollmentId: 'LOCALPORTFOLIO000000', pathId: 'fde', curriculumVersion: 1, status: 'active', baseTrackAtEnrollment: 'fullstack', startedAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
const newIds = ['fde-v1-c01-executive-update', 'fde-v1-c01-walkthrough-script'];
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: owned saved writing exports both capstone additions without starting an attempt`, async ({ page }, info) => {
    await storeFakeSession(page); await localAuth(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(mode => {
      localStorage.setItem('devquiz:color-mode', mode);
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    const writes: string[] = [];const errors: string[] = [];const reads: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname);
      const op = url.searchParams.get('op') ?? url.pathname.split('/').pop();
      if (url.searchParams.get('resource') === 'learning-path-catalog') return route.fulfill({ json: { paths: [{ manifest, availability: 'available', inventory }] } });
      if (op === 'entitlement') return route.fulfill({ json: { tier: 'premium', source: 'manual', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
      if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [enrollment] } });
      if (op === 'learning-path-progress') return route.fulfill({ json: {
        enrollment, modules: manifest.modules.map(module => ({ moduleId: module.id, completed: false, completedAt: null,
          activities: module.activities.filter(activity => activity.kind === 'artifact').map(activity => ({ activityId: activity.id, state: 'self_reviewed', verification: 'self_reviewed', score: null, attempts: 1, updatedAt: '2026-10-22T00:00:00Z' })),
        })), competencies: [], recommendedBridges: [], nextActivityId: null, guidedComplete: false,
        artifacts: { submitted: inventory.artifacts, total: inventory.artifacts }, dueActivityIds: [],
      } });
      if (op === 'learning-path-draft') {
        expect(url.searchParams.get('enrollmentId')).toBe(enrollment.enrollmentId);
        const id = url.searchParams.get('activityId')!;reads.push(id);
        return route.fulfill({ json: { draft: { activityId: id, revision: 2, updatedAt: '2026-10-22T00:00:00Z', content: { artifact: { note: `Saved fixture writing for ${id}` } } } } });
      }
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local test fixture' } } });
    });
    await page.goto('/learn/forward-deployed-engineer/path');
    const section = page.locator('.lp-portfolio-export');await expect(section).toBeVisible();
    await expect(section).toContainText('drafts included');
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `reflow ${width}`).toBe(true);
      for (const button of await section.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).include('.lp-portfolio-export').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    for (const [label, extension] of [['JSON', 'json'], ['Markdown', 'md']]) {
      const file = page.waitForEvent('download');
      await section.getByRole('button', { name: `Export writing as ${label}` }).click();
      const download = await file;expect(download.suggestedFilename()).toBe(`devshark-fde-saved-writing.${extension}`);
      const target = info.outputPath(`portfolio.${extension}`);await download.saveAs(target);
      const text = readFileSync(target, 'utf8');for (const id of newIds) expect(text).toContain(`Saved fixture writing for ${id}`);
      if (extension === 'json') expect(JSON.parse(text).entries.map((entry: { activityId: string }) => entry.activityId)).toEqual(expect.arrayContaining(newIds));
    }
    for (const id of newIds) expect(reads).toContain(id);
    expect(writes).toEqual([]);expect(errors).toEqual([]);
  });
}

// Owner hold: keep these end-to-end checks for the future FDE release.
test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
