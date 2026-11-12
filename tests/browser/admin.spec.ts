import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { localAuth, storeFakeSession } from './fake-session';
import { EMAIL_TEMPLATE_IDS, fallbackEmailTemplate } from '../../shared/email-templates';

const EMAILS = {
  deliveryConfigured: true, billingEnabled: false, sender: 'devShark <noreply@devshark.app>', replyTo: 'support@devshark.app',
  authTemplatesUrl: null, authSync: { configured: false },
  templates: Object.fromEntries(EMAIL_TEMPLATE_IDS.map(id => [id, { ...fallbackEmailTemplate(id), custom: false, updatedAt: null }])),
};
const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const USER = { id: 'admin-fixture-user', email: 'learner@example.invalid', name: 'Test Learner',
  createdAt: '2026-11-01T12:00:00Z', lastSignInAt: '2026-11-11T12:00:00Z', emailConfirmed: true, providers: ['google'],
  plan: { tier: 'premium', source: 'promo', validUntil: '2027-02-09T12:00:00Z', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false },
  vouchers: [{ voucherId: '11111111-1111-4111-8111-111111111111', hint: 'TEST', note: 'Fixture community voucher', redeemedAt: '2026-11-11T12:00:00Z', validUntil: '2027-02-09T12:00:00Z', status: 'active' }] };

for (const theme of ['light', 'dark']) test('Administration works at seven widths in ' + theme, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(theme => { try { localStorage.setItem('devquiz:color-mode', theme); } catch { /* the sandboxed email preview frame */ } }, theme);
  await storeFakeSession(page); await localAuth(page);
  let maximum = 100; let writes = 0; const emailWrites: Array<Record<string, unknown>> = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (url.pathname === '/api/admin/settings') return route.fulfill({ json: { settings: {} } });
    if (url.pathname === '/api/admin/users') return route.fulfill({ json: { users: [USER], page: 1, pageSize: 25, total: 1, hasNextPage: false, voucherHistoryPartial: false } });
    if (url.pathname === '/api/admin/vouchers') {
      if (route.request().method() === 'POST') { maximum = route.request().postDataJSON().maxRedemptions; writes++; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { vouchers: [{ id: USER.vouchers[0].voucherId, hint: 'TEST', note: 'Fixture community voucher', premiumDays: 90, maxRedemptions: maximum, redeemedCount: 5, redeemableUntil: null, active: true, createdAt: '2026-11-11T12:00:00Z', revokedAt: null, state: 'open' }] } });
    }
    if (url.pathname === '/api/admin/emails') {
      if (route.request().method() === 'POST') { emailWrites.push(route.request().postDataJSON()); const body = route.request().postDataJSON(); return route.fulfill({ json: body.action === 'test' ? { sent: true } : { template: { subject: body.subject, document: body.document, custom: true, updatedAt: '2026-11-12T12:00:00Z' }, authSync: null } }); }
      return route.fulfill({ json: EMAILS });
    }
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
  await page.getByRole('tab', { name: 'Cancellation receipt' }).click();
  await expect(page.getByLabel('Subject')).toHaveValue('Your devShark Premium cancellation');
  await expect(page.frameLocator('.admin-email-frame').getByText('Premium stays open until 12 November 2026. You will not be charged again.')).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Email text' });
  await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' Thank you.');
  await expect(page.frameLocator('.admin-email-frame').getByText(/Thank you\./)).toBeVisible();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByText('Template saved. The next email of this kind uses the new text.')).toBeVisible();
  expect(emailWrites[0]).toMatchObject({ action: 'save', id: 'cancelled', subject: 'Your devShark Premium cancellation' });
  await page.getByLabel('Send a test to').fill('admin@example.com');
  await page.getByRole('button', { name: 'Send test email' }).click();
  await expect(page.getByText('Test email handed to Resend for delivery.')).toBeVisible();
  expect(emailWrites[1]).toEqual({ action: 'test', id: 'cancelled', to: 'admin@example.com' });
  for (const width of [360, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  // The preview is a sandboxed frame with no script, which axe cannot enter; the frame itself carries a title.
  expect((await new AxeBuilder({ page }).include('.admin-shell').exclude('.admin-email-frame').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
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
