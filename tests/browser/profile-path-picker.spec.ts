import { FDE_SECTION_VISIBLE } from '../../shared/learn-section-ids';
// The Profile path picker (#490): the Sections step in a real browser, light
// on a 360px touch screen and dark at desktop width with a mouse. Arrow keys
// browse without advancing, Continue advances, Back keeps the choices, the
// option cards and toggles clear 44px everywhere and the dialog's buttons do
// on touch (app-shell.css raises Astryx buttons for coarse pointers only),
// nothing scrolls sideways, and leaving Software Engineer saves an empty
// section list with the profile. Path enrollment is free; individual
// activities carry the Premium boundary beyond the taster.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fakeSession, fakeUser, localAuth, sessionKey } from './fake-session';
import { inventoryFor, pathById, publicManifest } from '../../lib/learning-paths/catalog';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const fdePath = pathById('fde')!;
const catalog = { versions: { fde: fdePath.version }, paths: [{ manifest: publicManifest(fdePath), availability: 'available', inventory: inventoryFor('fde') }] };
const savedProfile = {
  schemaVersion: 2, baseTrack: 'frontend', specialization: null, sections: ['software-engineer'],
  goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: '2026-10-01T00:00:00Z',
};
const metadataFor = (profile: Record<string, unknown>) => ({
  full_name: 'Test Learner',
  devquiz_track: profile.baseTrack,
  devquiz_learning_preference_v1: { schemaVersion: 1, baseTrack: profile.baseTrack, specialization: profile.specialization },
  devquiz_learner_profile_v2: profile,
});

/** The laid-out height, which the dialog's opening scale does not shrink. */
async function expectTarget(target: Locator, label: string) {
  await expect(target, `${label} is drawn`).toBeVisible();
  const height = await target.evaluate((element) => (element as HTMLElement).offsetHeight);
  expect(height, `${label} is at least 44px tall`).toBeGreaterThanOrEqual(44);
}
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const [theme, width, touch] of [['light', 360, true], ['dark', 1280, false]] as const) {
  test.describe(`${theme} at ${width}px${touch ? ' on touch' : ''}`, () => {
  test.use({ hasTouch: touch, isMobile: touch });
  test('the Sections step browses, keeps choices on Back, and saves the section list', async ({ page }, testInfo) => {
    const buttons = async (dialog: Locator, names: string[]) => {
      if (touch) for (const name of names) await expectTarget(dialog.getByRole('button', { name }), name);
    };
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addInitScript((mode) => localStorage.setItem('devquiz:color-mode', mode), theme);

    // A signed-in learner who joined Software Engineer. The session and the
    // refreshed user carry the account metadata the server would hold.
    let profile: Record<string, unknown> = savedProfile;
    const user = () => ({ ...fakeUser, user_metadata: metadataFor(profile) });
    const session = () => ({ ...fakeSession(), user: user() });
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: sessionKey, value: session() });
    await localAuth(page);
    await page.route('**/auth/v1/user', (route) => route.fulfill({ json: user() }));
    await page.route('**/auth/v1/token**', (route) => route.fulfill({ json: session() }));

    const saves: Record<string, unknown>[] = [];
    await page.route('**/api/**', async (route) => {
      const request = route.request(), url = new URL(request.url());
      const op = url.searchParams.get('op') || url.pathname.split('/').pop();
      if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
      if (url.searchParams.get('resource') === 'learning-path-catalog') return route.fulfill({ json: catalog });
      if (op === 'learning-preference' && request.method() === 'PUT') {
        const body = request.postDataJSON() as Record<string, unknown>;
        saves.push(body);
        profile = { ...profile, ...body, schemaVersion: 2, updatedAt: '2026-10-21T00:00:00Z' };
        return route.fulfill({ json: { preference: { schemaVersion: 1, baseTrack: body.baseTrack, specialization: body.specialization }, legacyTrack: body.baseTrack, profile, missingProfileFields: [] } });
      }
      if (op === 'learning-path-enrollment') return route.fulfill({ json: { enrollments: [] } });
      if (op === 'entitlement') return route.fulfill({ json: { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
      if (op === 'stats') return route.fulfill({ json: { data: {
        id: 'test-stats', user_id: fakeUser.id, email: null, name: 'Test Learner', picture: null,
        total_quizzes: 0, total_correct: 0, total_questions: 0, current_streak: 0, longest_streak: 0,
        last_quiz_date: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      } } });
      return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
    });

    await page.goto('/profile');
    await expect(page.getByText('Sections: Web Developer · Software Engineer', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Choose your path' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Choose your learning path' })).toBeVisible();

    // Step 1: arrow keys move the choice and nothing else.
    const tracks = dialog.getByRole('radio');
    await expect(tracks).toHaveCount(3);
    const frontend = dialog.getByRole('radio', { name: 'Frontend' });
    const backend = dialog.getByRole('radio', { name: 'Backend' });
    await expect(frontend).toHaveAttribute('aria-checked', 'true');
    await frontend.focus();
    await page.keyboard.press('ArrowDown');
    await expect(backend).toHaveAttribute('aria-checked', 'true');
    await expect(backend).toBeFocused();
    await expect(dialog.getByRole('heading', { name: 'Choose your learning path' })).toBeVisible();
    for (const one of await tracks.all()) await expectTarget(one, `track ${await one.getAttribute('aria-label')}`);
    await buttons(dialog, ['Cancel', 'Continue']);
    expect(await noSidewaysScroll(page), `${theme}/${width} track step`).toBe(true);

    // Step 2: Sections.
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByRole('heading', { name: 'Add a section?' })).toBeVisible();
    const se = dialog.getByRole('checkbox', { name: 'Software Engineer' });
    await expect(se).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /DSA/ })).toHaveCount(0);
    const none = dialog.getByRole('radio', { name: 'Continue without a specialization' });
    const fde = dialog.getByRole('radio', { name: 'Forward Deployed Engineer' });
    await expect(se).toHaveAccessibleDescription(/Free to join\./);
    await expectTarget(se, 'the Software Engineer toggle');
    if (FDE_SECTION_VISIBLE) {
    // The entry requirement is the manifest's own text, the one the path page
    // shows, and a screen reader hears it with the flagship description.
    await expect(dialog.getByText(`Before you start: ${fdePath.entryRequirement}`, { exact: true })).toBeVisible();
    await expect(fde).toHaveAccessibleDescription(new RegExp(`^devShark’s flagship section.*Before you start: ${fdePath.entryRequirement.slice(0, 40)}`));
    await expectTarget(none, 'no specialization');
    await expectTarget(fde, 'Forward Deployed Engineer');
    } else {
      await expect(dialog.getByRole('radiogroup', { name: 'Specialization' })).toHaveCount(0);
      await expect(fde).toHaveCount(0);
    }
    await buttons(dialog, ['Back', 'Cancel', 'Continue']);
    expect(await noSidewaysScroll(page), `${theme}/${width} sections step`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sections-${theme}-${width}.png`), fullPage: false });

    await se.focus();
    await page.keyboard.press('Space');
    await expect(se).not.toBeChecked();
    if (FDE_SECTION_VISIBLE) {
    await none.focus();
    await page.keyboard.press('ArrowDown');
    await expect(fde).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('heading', { name: 'Add a section?' })).toBeVisible();

    }

    // Back keeps both steps' choices.
    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(backend).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(se).not.toBeChecked();
    if (FDE_SECTION_VISIBLE) {
    await expect(fde).toHaveAttribute('aria-checked', 'true');
    await fde.focus();
    await page.keyboard.press('ArrowUp');
    await expect(none).toHaveAttribute('aria-checked', 'true');

    }

    // Step 3 keeps the saved answers; Save sends the empty section list.
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByRole('heading', { name: 'A little about your learning' })).toBeVisible();
    for (const one of await dialog.getByRole('radio').all()) await expectTarget(one, `answer ${await one.getAttribute('aria-label')}`);
    for (const one of await dialog.locator('label.lp-toggle').all()) await expectTarget(one, 'goal');
    await buttons(dialog, ['Back', 'Cancel', 'Save']);
    await page.screenshot({ path: testInfo.outputPath(`profile-step-${theme}-${width}.png`), fullPage: false });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ baseTrack: 'backend', specialization: null, goals: ['level-up'], experience: 'some', studyTime: '30-60', sections: [] });
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Saved: Backend', { exact: true })).toBeVisible();
    await expect(page.getByText('Sections: Web Developer', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`card-${theme}-${width}.png`), fullPage: true });
    for (const each of [360, 390, 768, 1280]) {
      await page.setViewportSize({ width: each, height: 900 });
      expect(await noSidewaysScroll(page), `${theme}/${each} profile`).toBe(true);
    }
  });
  });
}
