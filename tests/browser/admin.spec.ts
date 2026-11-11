import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { localAuth, storeFakeSession } from './fake-session';
const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const USER = { id: 'admin-fixture-user', email: 'learner@example.invalid', name: 'Test Learner',
  createdAt: '2026-11-01T12:00:00Z', lastSignInAt: '2026-11-11T12:00:00Z', emailConfirmed: true, providers: ['google'],
  plan: { tier: 'premium', source: 'promo', validUntil: '2027-02-09T12:00:00Z', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false },
  vouchers: [{ voucherId: '11111111-1111-4111-8111-111111111111', hint: 'TEST', note: 'Fixture community voucher', redeemedAt: '2026-11-11T12:00:00Z', validUntil: '2027-02-09T12:00:00Z', status: 'active' }] };

for (const theme of ['light', 'dark']) test('Administration works at seven widths in ' + theme, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(theme => localStorage.setItem('devquiz:color-mode', theme), theme);
  await storeFakeSession(page); await localAuth(page);
  let maximum = 100; let writes = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (url.pathname === '/api/admin/settings') return route.fulfill({ json: { settings: {} } });
    if (url.pathname === '/api/admin/users') return route.fulfill({ json: { users: [USER], page: 1, pageSize: 25, total: 1, hasNextPage: false, voucherHistoryPartial: false } });
    if (url.pathname === '/api/admin/vouchers') {
      if (route.request().method() === 'POST') { maximum = route.request().postDataJSON().maxRedemptions; writes++; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { vouchers: [{ id: USER.vouchers[0].voucherId, hint: 'TEST', note: 'Fixture community voucher', premiumDays: 90, maxRedemptions: maximum, redeemedCount: 5, redeemableUntil: null, active: true, createdAt: '2026-11-11T12:00:00Z', revokedAt: null, state: 'open' }] } });
    }
    if (url.pathname === '/api/admin/emails') return route.fulfill({ json: { billingEmailConfigured: false, billingEnabled: false, sender: null, authTemplatesUrl: null, previews: [{ id: 'cancel', subject: 'Your devShark Premium cancellation', text: 'A preview of the current email. No message was sent.' }] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Users', exact: true })).toBeVisible();
  await expect(page.getByText('learner@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('TEST…', { exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  await expect(nav.getByRole('link')).toHaveText(['Users', 'Vouchers', 'Emails']);
  for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await new AxeBuilder({ page }).include('.admin-shell').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'artifacts/admin-users-' + theme + '.png', fullPage: true });
  await nav.getByRole('link', { name: 'Vouchers', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vouchers', exact: true })).toBeVisible();
  await expect(page.getByText('90 days of Premium', { exact: true })).toBeVisible();
  await page.getByLabel('Maximum uses for TEST…').fill('200');
  await page.getByRole('button', { name: 'Save limit' }).click();
  await expect(page.getByText('5 of 200 used', { exact: true })).toBeVisible();
  for (const width of [360, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await nav.getByRole('link', { name: 'Emails', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Emails', exact: true })).toBeVisible();
  await page.getByText('Your devShark Premium cancellation', { exact: true }).click();
  await expect(page.getByText('A preview of the current email. No message was sent.', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('.admin-shell').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  await page.screenshot({ path: 'artifacts/admin-emails-' + theme + '.png', fullPage: true });
  await nav.getByRole('link', { name: 'Users', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Users', exact: true })).toBeVisible();
  expect(writes).toBe(1); expect(errors).toEqual([]);
});

test('A regular account cannot load the private admin directory', async ({ page }) => {
  await storeFakeSession(page); await localAuth(page);
  const privateReads: string[] = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/settings') return route.fulfill({ json: settings });
    if (path === '/api/admin/settings') return route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: 'Administrative access required' } } });
    if (path.startsWith('/api/admin/')) privateReads.push(path);
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
  await expect(page.getByTestId('admin-users')).toHaveCount(0);
  expect(privateReads).toEqual([]);
});
