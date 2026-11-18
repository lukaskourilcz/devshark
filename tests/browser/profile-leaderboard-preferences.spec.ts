import { test, expect } from './console-clean';
import { readFileSync } from 'node:fs';
import { fakeUser, localAuth, storeFakeSession } from './fake-session';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: leaderboard preferences persist from the Profile card and are absent from boards`, async ({ page }) => {
    await page.setViewportSize({ width: theme === 'light' ? 360 : 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addInitScript(theme => localStorage.setItem('devquiz:color-mode', theme), theme);
    await storeFakeSession(page); await localAuth(page);
    let preference = { mode: 'nickname', nickname: 'sleepySharkie1', accountName: 'Test Learner', showPhoto: false };
    let failedWrite = false, friendWrites = 0;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      const op = url.searchParams.get('op') || url.pathname.split('/').pop();
      if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
      if (op === 'leaderboard-name') {
        if (request.method() === 'PUT') {
          if (failedWrite) return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
          preference = { ...preference, ...request.postDataJSON() };
        }
        return route.fulfill({ json: preference });
      }
      if (op === 'stats') return route.fulfill({ json: { data: {
        id: 'test-stats', user_id: fakeUser.id, email: null, name: 'Test Learner', picture: null,
        total_quizzes: 0, total_correct: 0, total_questions: 0, current_streak: 0, longest_streak: 0,
        last_quiz_date: null, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      } } });
      if (op === 'friends-handle' || op === 'identity') {
        if (request.method() !== 'GET') friendWrites++;
        return route.fulfill({ json: op === 'identity'
          ? { showRealName: false, showPhoto: false, realName: 'Test Learner', photo: null }
          : { handle: 'sleepySharkie1', discoverable: true, country: null, canChangeAt: null } });
      }
      return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
    });
    await page.goto('/profile');
    // The 'Your name' panel has two Sharkname / Account name choices side by
    // side (social-account-04); these are the 'Leaderboards show' ones.
    const board = page.getByRole('radiogroup', { name: /Leaderboards show/ });
    const account = board.getByRole('radio', { name: 'Account name', exact: true });
    const nickname = board.getByRole('radio', { name: 'Sharkname', exact: true });
    const photo = page.getByRole('switch', { name: 'Show my photo on leaderboards', exact: true });
    await expect(nickname).toBeChecked();
    await account.focus(); await account.press('Space');
    await expect(account).toBeChecked();
    await photo.focus(); await photo.press('Space');
    await expect(photo).toBeChecked();
    await expect.poll(() => preference.mode).toBe('account');
    await expect.poll(() => preference.showPhoto).toBe(true);
    failedWrite = true;
    await nickname.click();
    await expect(page.getByText('Your leaderboard setting wasn’t saved. Try again.', { exact: true })).toBeVisible();
    await expect(account).toBeChecked();
    await page.goto('/leaderboard');
    await expect(page.getByRole('radio', { name: 'Account name', exact: true })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Show my photo on leaderboards', exact: true })).toHaveCount(0);
    await page.goto('/profile');
    await expect(account).toBeChecked(); await expect(photo).toBeChecked();
    expect(friendWrites).toBe(0);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(account).toBeVisible(); await expect(photo).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}/${width}`).toBe(true);
    }
  });
}
