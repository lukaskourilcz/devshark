import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { fakeSession, fakeUser, localAuth, projectUrl, sessionKey } from './fake-session';

// The sign-in dialog (Google, then an email and password) and the two pages an
// email link opens, in a real browser: WCAG 2.2 AA in both themes, keyboard
// and focus, no sideways scroll at 320px, 44px targets on a touch screen, and
// an email sign-in that lands signed in. Supabase Auth is answered locally
// (fake-session.ts); nothing leaves the machine.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The app's own API answers 503, as offline. */
async function offlineApi(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } }));
}

async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => document.getAnimations().every((animation) => {
    if (animation.playState !== 'running') return true;
    return animation.effect?.getTiming().iterations === Infinity;
  }), undefined, { timeout: 15_000 });
}

async function openDialog(page: Page) {
  await page.goto('/');
  const logIn = page.getByRole('button', { name: 'Sign in', exact: true }).first();
  await logIn.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  return { dialog, logIn };
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [320, 1280]) {
    test(`${theme}, ${width}px: the dialog and the email-link pages pass WCAG 2.2 AA and fit`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: 800 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.addInitScript((theme) => { try { localStorage.setItem('devquiz:color-mode', theme); } catch {} }, theme);
      await offlineApi(page);
      await localAuth(page);

      const { dialog } = await openDialog(page);
      for (const tab of ['Sign in', 'Create account']) {
        await dialog.getByRole('radio', { name: tab }).click();
        // Errors drawn too: they are the dialog's other colours.
        await dialog.getByRole('button', { name: tab === 'Sign in' ? 'Sign in' : 'Create account', exact: true }).click();
        await expect(dialog.getByText('Enter your email address.')).toBeVisible();
        await settled(page);
        const findings = await new AxeBuilder({ page }).include('dialog').withTags(TAGS).analyze();
        expect(findings.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), `${tab} dialog`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const box = await dialog.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
      }

      for (const path of ['/auth/confirmed', '/reset-password', '/auth/confirmed#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await settled(page);
        const findings = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(findings.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), path).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} has no sideways scroll`).toBe(true);
      }
    });
  }
}

test('Sign in and Create account are the same height, so the dialog does not move when the mode changes', async ({ page }) => {
  // UX audit shell-public-05: the dialog was 612px in Sign in and 583px in
  // Create account, and its centred top moved 14px under the pointer.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await offlineApi(page);
  await localAuth(page);
  const { dialog } = await openDialog(page);
  const google = dialog.getByRole('button', { name: 'Continue with Google' });
  // Measured once the dialog's opening has finished.
  await settled(page);
  const signIn = { dialog: await dialog.boundingBox(), google: await google.boundingBox() };
  await dialog.getByRole('radio', { name: 'Create account' }).click();
  await expect(dialog.getByText('At least 8 characters.')).toBeVisible();
  await settled(page);
  const signUp = { dialog: await dialog.boundingBox(), google: await google.boundingBox() };
  expect(signUp.dialog?.height).toBeCloseTo(signIn.dialog?.height ?? 0, 0);
  expect(signUp.dialog?.y).toBeCloseTo(signIn.dialog?.y ?? 0, 0);
  expect(signUp.google?.y).toBeCloseTo(signIn.google?.y ?? 0, 0);
  // One title for both modes; the segmented control carries the mode.
  await expect(dialog.getByRole('heading', { name: 'Your devShark account' })).toBeVisible();
});

test('the keyboard reaches everything in order, Escape closes, and focus goes back to Sign in', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await offlineApi(page);
  await localAuth(page);
  const { dialog, logIn } = await openDialog(page);
  // Focus starts inside the dialog.
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  // Close, Google, the Sign in / Create account control, Email, Password,
  // Show password, Forgot password?, Sign in, Terms, Privacy Policy.
  const order: string[] = [];
  for (let step = 0; step < 14 && !order.at(-1)?.includes('Privacy Policy'); step += 1) {
    await page.keyboard.press('Tab');
    order.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return active?.getAttribute('aria-label') || active?.closest('label')?.textContent?.trim() || (active as HTMLInputElement | null)?.labels?.[0]?.textContent?.trim() || active?.textContent?.trim() || active?.tagName || '';
    }));
    // The page under the modal is inert: focus stays in the dialog.
    expect(await dialog.evaluate((node) => node.contains(document.activeElement)), order.join(' → ')).toBe(true);
  }
  const first = (name: string) => order.findIndex((label) => label.includes(name));
  expect(first('Continue with Google')).toBeGreaterThanOrEqual(0);
  expect(first('Continue with Google')).toBeLessThan(first('Email'));
  expect(first('Email')).toBeLessThan(first('Password'));
  expect(first('Password')).toBeLessThan(first('Show password'));
  expect(first('Show password')).toBeLessThan(first('Forgot password?'));
  expect(first('Forgot password?'), order.join(' → ')).toBeLessThan(first('Privacy Policy'));

  // Enter in the form sends it, and the fields say what is missing.
  await dialog.getByLabel('Email', { exact: true }).fill('ada@example.com');
  await dialog.getByLabel('Password', { exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Enter a password.')).toBeVisible();
  await expect(dialog.getByLabel('Password', { exact: true })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(logIn).toBeFocused();
});

test.describe('on a touch screen at 320px', () => {
  test.use({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true });
  test('every control in the dialog is at least 44px', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await offlineApi(page);
    await localAuth(page);
    const { dialog } = await openDialog(page);
    // Measured once the dialog has finished arriving.
    await settled(page);
    const small = await dialog.evaluate((node) => [...node.querySelectorAll<HTMLElement>('button, input, a, [role="radio"]')]
      // A link inside a sentence is exempt (WCAG 2.5.8): the Terms and Privacy Policy.
      .filter((control) => !control.closest('.ss-auth__legal'))
      .map((control) => ({ control, box: control.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.height < 44 || box.width < 44))
      .map(({ control, box }) => `${control.getAttribute('aria-label') || control.textContent?.trim() || control.tagName} ${Math.round(box.width)}x${Math.round(box.height)}`));
    expect(small).toEqual([]);
  });
});

test('signs in with an email and password and lands signed in on the same page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await offlineApi(page);
  const session = { ...fakeSession(), user: { ...fakeUser, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {} } };
  const asked: string[] = [];
  await page.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    asked.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'password') {
      const body = route.request().postDataJSON() as { email?: string; password?: string };
      if (body.password !== 'correct horse battery') {
        return route.fulfill({ status: 400, headers: { 'x-supabase-api-version': '2024-01-01' }, json: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
      }
      return route.fulfill({ headers: { 'x-supabase-api-version': '2024-01-01' }, json: session });
    }
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: session.user });
    return route.fulfill({ status: 401, json: { code: 'bad_jwt', message: 'local test' } });
  });
  await page.goto('/leaderboard');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill('lazy-auth@example.test');
  await dialog.getByLabel('Password', { exact: true }).fill('wrong one');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('That email and password don’t match an account.');
  await dialog.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // No name from Google: the header says the address's first part.
  await expect(page.getByRole('button', { name: 'Account menu for lazy-auth' })).toBeVisible();
  await expect(page).toHaveURL(/\/leaderboard$/);
  expect(asked.filter((one) => one.startsWith('POST /auth/v1/token'))).toHaveLength(2);
  expect(await page.evaluate((key) => Boolean(localStorage.getItem(key)), sessionKey)).toBe(true);
  expect(projectUrl.hostname).toContain('supabase.co');
});
