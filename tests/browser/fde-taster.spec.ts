import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { storeFakeSession, localAuth } from './fake-session';
import { pathById, publicManifest, activitySummary } from '../../lib/learning-paths/catalog';
import { lessonProjection } from '../../lib/learn-lessons';
import { pathInventory } from '../../shared/learning-paths';

const path = pathById('fde')!;
const manifest = publicManifest(path);
const loop = path.modules.filter(module => !module.optional && !module.shelf);
const first = loop[0].activities[0];
const second = loop[1].activities[0];
const enrollment = { enrollmentId: 'LOCALTASTER000000000', pathId: 'fde', curriculumVersion: path.version, baseTrackAtEnrollment: 'fullstack', status: 'active', startedAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: a free first activity opens, a later one asks for Premium, and a stored pass reopens`, async ({ page }) => {
    await storeFakeSession(page); await localAuth(page);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(mode => {
      localStorage.setItem('devquiz:color-mode', mode);
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    let passed = false; const starts: string[] = [];
    await page.route('**/api/**', route => {
      const url = new URL(route.request().url()); const resource = url.searchParams.get('resource'); const op = url.searchParams.get('op') ?? url.pathname.split('/').pop();
      if (resource === 'learning-path-catalog') return route.fulfill({ json: { versions: { fde: path.version }, paths: [{ manifest, availability: 'available', inventory: pathInventory(manifest) }] } });
      if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [enrollment] } });
      if (op === 'entitlement') return route.fulfill({ json: { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
      if (op === 'learning-path-progress') return route.fulfill({ json: { enrollment, modules: passed ? [{ moduleId: loop[1].id, completed: false, activities: [{ activityId: second.id, state: 'verified_pass', attempts: 1 }] }] : [], competencies: [], recommendedBridges: [], nextActivityId: first.id, guidedComplete: false, artifacts: { submitted: 0, total: pathInventory(manifest).artifacts }, dueActivityIds: [] } });
      if (resource === 'learning-path-start') {
        const id = route.request().postDataJSON().activityId as string; starts.push(id);
        const module = loop.find(module => module.activities.some(activity => activity.id === id))!;
        const activity = module.activities.find(activity => activity.id === id)!;
        return route.fulfill({ json: { attemptId: 'LOCALATTEMPT00000000', session: 'local-session', expiresAt: new Date(Date.now() + 60_000).toISOString(), activity: activitySummary(activity), purpose: activity.purpose, lesson: lessonProjection(module.lessons[0]), draft: null, previous: null } });
      }
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local test fixture' } } });
    });
    await page.goto(`/learn/forward-deployed-engineer/path/${loop[0].id}`);
    const free = page.locator(`a.lp-activity[href$="activity=${first.id}"]`);
    await expect(free).not.toContainText('Premium'); await free.click();
    await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    expect(starts).toEqual([first.id]);
    // On a phone the lesson's tables and code scroll sideways; each scrolling
    // region is a named tab stop with a visible ring (B14 visual QA, #510).
    await page.setViewportSize({ width: 390, height: 900 });
    const regions = page.locator('.lp-lesson .lp-scroll-region');
    expect(await regions.count()).toBeGreaterThan(0);
    for (const region of await regions.all()) {
      await expect(region).toHaveAttribute('tabindex', '0');
      await expect(region).toHaveAccessibleName(/\S/);
    }
    // Reach the first region by keyboard. The shell's delayed route focus can
    // land in between, so the step repeats until the region holds focus.
    await expect(async () => {
      await regions.first().focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
      await expect(regions.first()).toBeFocused({ timeout: 500 });
      expect(await regions.first().evaluate(el => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none')).toBe(true);
    }).toPass({ timeout: 10_000 });
    expect((await new AxeBuilder({ page }).include('.lp-lesson').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/learn/forward-deployed-engineer/path/${loop[1].id}`);
    const locked = page.locator(`a.lp-activity[href$="activity=${second.id}"]`);
    await expect(locked).toContainText('Premium'); await locked.click();
    await expect(page.getByRole('dialog')).toBeVisible(); expect(starts).toEqual([first.id]);
    passed = true; await page.reload();
    const reopened = page.locator(`a.lp-activity[href$="activity=${second.id}"]`);
    await expect(reopened).not.toContainText('Premium'); await reopened.click();
    await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible(); expect(starts).toEqual([first.id, second.id]);
    await page.setViewportSize({ width: 360, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

// Owner hold: keep these end-to-end checks for the future FDE release.
test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
