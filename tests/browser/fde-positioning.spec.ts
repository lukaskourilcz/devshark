import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { pathCatalog, roadmapStructure } from '../../scripts/responsive-fixtures';
import { fakeUser, localAuth, storeFakeSession } from './fake-session';
import { pathInventory } from '../../shared/learning-paths';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const catalog = pathCatalog({ enabled: false });
const inventory = pathInventory(catalog.paths.find(entry => entry.manifest.id === 'fde')!.manifest);
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: FDE preview derives its inventory and opens the canonical outline`, async ({ page }, info) => {
    test.skip(!FDE_SECTION_VISIBLE, 'FDE is hidden until the owner reopens it');
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(theme => {
      localStorage.setItem('devquiz:color-mode', theme);
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    const errors: string[] = []; const writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname);
      if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
      if (url.searchParams.get('resource') === 'learning-path-catalog') return route.fulfill({ json: catalog });
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local test fixture' } } });
    });
    await page.goto('/');
    const feature = page.getByRole('region', { name: 'Forward Deployed Engineer', exact: true });
    // The inventory reads as four stats beside the pitch (UX audit shell-public-08).
    const stats = feature.locator('.ss-fde-feature__stats');
    await expect(stats).toContainText(new RegExp(`${inventory.modules}\\s*Modules`));
    await expect(stats).toContainText(new RegExp(`${inventory.lessons}\\s*Lessons`));
    await expect(stats).toContainText(new RegExp(`${inventory.moduleChecks + inventory.finalChecks}\\s*Questions`));
    await expect(stats).toContainText(new RegExp(`${inventory.moduleCodeExercises + inventory.finalCodeExercises}\\s*Code exercises`));
    await expect(feature).toContainText('Work is not recorded yet.');
    for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `reflow ${width}`).toBe(true);
      expect((await feature.getByRole('button').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).include('.ss-fde-feature').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 }); await feature.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`fde-feature-${theme}.png`) });
    await feature.getByRole('button', { name: 'Explore the FDE path' }).click();
    await expect(page).toHaveURL(/\/learn\/forward-deployed-engineer\/path$/);
    await expect(page.locator('.lp-page h1')).toHaveText('Forward Deployed Engineer');
    await page.goto('/premium');
    // /premium states what Premium opens once, in the plan table (UX audit
    // money-03). The table lists only what is open (review finding product-6), so
    // while this catalog keeps the path switched off it has no FDE row yet.
    await expect(page.locator('.ss-compare')).toContainText('Projects and short paths');
    await expect(page.locator('.ss-compare tr', { hasText: 'Forward Deployed Engineer path' })).toHaveCount(0);
    expect(errors).toEqual([]); expect(writes).toEqual([]);
  });
}

// Shipping-default acceptance stays active while the retained FDE scenarios
// above wait for the owner to reopen the feature.
for (const [theme, width] of [['light', 360], ['dark', 1280]] as const) {
  test(`${theme}/${width}: the FDE hold covers discovery, stale choices and direct links`, async ({ page }, info) => {
    test.skip(FDE_SECTION_VISIBLE, 'The owner has reopened FDE');
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(theme => {
      localStorage.setItem('devquiz:color-mode', theme);
      localStorage.setItem('devquiz:roadmap:section', 'forward-deployed-engineer');
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    }, theme);
    const errors: string[] = [], pathReads: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url());
      const resource = url.searchParams.get('resource'), op = url.searchParams.get('op');
      if (request.method() !== 'GET') writes.push(request.method() + ' ' + url.pathname);
      if (resource === 'learning-path-catalog' || op?.startsWith('learning-path-')) pathReads.push(resource ?? op!);
      // Even stale settings that advertise FDE cannot reopen its UI.
      if (url.pathname === '/api/settings') return route.fulfill({ json: { ...settings, learningPaths: { paths: { fde: { enabled: true, availability: 'available', version: 1 } } } } });
      if (resource === 'progress') return route.fulfill({ json: { data: {}, extra: { unlocked: [] } } });
      if (resource === 'learning-path-catalog') return route.fulfill({ json: catalog });
      if (url.pathname === '/api/quiz/roadmap' && !resource) return route.fulfill({ json: roadmapStructure() });
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local fixture' } } });
    });
    for (const route of ['/', '/learn/web-developer', '/learn/software-engineer', '/roadmap', '/premium']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/Forward Deployed Engineer/)).toHaveCount(0);
      await expect(page.locator('a[href*="forward-deployed-engineer"]')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), route).toBe(true);
    }
    for (const route of ['/learn', '/learn/forward-deployed-engineer', '/learn/forward-deployed-engineer/path', '/learn/forward-deployed-engineer/path/fde-v1-m01?activity=fde-v1-m01-l1-read', '/roadmap/specializations/fde/fde-v1-m01']) {
      await page.goto(route);
      await expect(page).toHaveURL(/\/learn\/web-developer$/);
      await expect(page.getByRole('radio', { name: /^Web Developer/ })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { name: /^Forward Deployed Engineer/ })).toHaveCount(0);
    }
    await page.screenshot({ path: info.outputPath(`fde-held-${theme}-${width}.png`) });
    expect(pathReads).toEqual([]);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`${theme}/${width}: editing an existing FDE learner preserves the hidden preference without path writes`, async ({ page }) => {
    test.skip(FDE_SECTION_VISIBLE, 'The owner has reopened FDE');
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    let profile = { schemaVersion: 2, baseTrack: 'frontend', specialization: 'fde', sections: [] as string[], goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: null as string | null };
    const user = () => ({ ...fakeUser, user_metadata: { full_name: 'Test Learner', devquiz_track: profile.baseTrack, devquiz_learning_preference_v1: { schemaVersion: 1, baseTrack: profile.baseTrack, specialization: profile.specialization }, devquiz_learner_profile_v2: profile } });
    await storeFakeSession(page, user());
    await localAuth(page, { user });
    const saves: Record<string, unknown>[] = [], pathWrites: string[] = [];
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url());
      const op = url.searchParams.get('op'), resource = url.searchParams.get('resource');
      if (op?.startsWith('learning-path-') && request.method() !== 'GET') pathWrites.push(op);
      if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
      if (op === 'learning-preference' && request.method() === 'PUT') {
        const body = request.postDataJSON() as Record<string, unknown>;
        saves.push(body); profile = { ...profile, ...body, updatedAt: '2026-11-06T00:00:00Z' };
        return route.fulfill({ json: { preference: { schemaVersion: 1, baseTrack: profile.baseTrack, specialization: profile.specialization }, legacyTrack: profile.baseTrack, profile, missingProfileFields: [] } });
      }
      if (op === 'entitlement') return route.fulfill({ json: { tier: 'premium', source: 'stripe', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
      if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [{ enrollmentId: 'LOCALHOLD00000000001', pathId: 'fde', status: 'active', curriculumVersion: 1 }] } });
      if (resource === 'learning-path-catalog') return route.fulfill({ json: pathCatalog({ enabled: true }) });
      if (resource === 'progress') return route.fulfill({ json: { data: {}, extra: { unlocked: [] } } });
      if (url.pathname === '/api/quiz/roadmap' && !resource) return route.fulfill({ json: roadmapStructure() });
      return route.fulfill({ status: 503, json: { error: { code: 'fixture', message: 'Local fixture' } } });
    });
    await page.goto('/profile');
    await page.getByRole('button', { name: 'Choose your path', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText('Forward Deployed Engineer')).toHaveCount(0);
    await dialog.getByRole('checkbox', { name: 'Software Engineer' }).click();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toMatchObject({ specialization: 'fde', sections: ['software-engineer'] });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/Forward Deployed Engineer/)).toHaveCount(0);
    expect(pathWrites).toEqual([]);
    await page.reload();
    await expect(page.getByText('Sections: Web Developer · Software Engineer', { exact: true })).toBeVisible();
    await expect(page.getByText(/Forward Deployed Engineer/)).toHaveCount(0);
  });
}
