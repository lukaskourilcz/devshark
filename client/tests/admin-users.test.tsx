import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import AdminUsers from '../src/components/admin/AdminUsers';
import AdminEmails from '../src/components/admin/AdminEmails';
import DevVouchers from '../src/components/dev/DevVouchers';
import { server } from './mocks/server';
import type { AdminDirectory } from '../../shared/admin-directory';

const DATA: AdminDirectory = { page: 1, pageSize: 25, total: 26, hasNextPage: true, voucherHistoryPartial: false, users: [{
  id: 'learner-1', email: 'learner@example.invalid', name: 'Test Learner', createdAt: '2026-11-01T12:00:00Z', lastSignInAt: '2026-11-11T12:00:00Z', emailConfirmed: true, providers: ['google'],
  plan: { tier: 'premium', source: 'promo', validUntil: '2027-02-09T12:00:00Z', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false },
  vouchers: [{ voucherId: 'voucher-1', hint: 'AROL', note: 'Community access', redeemedAt: '2026-11-11T12:00:00Z', validUntil: '2027-02-09T12:00:00Z', status: 'active' }],
}] };
function view(child: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{child}</LanguageProvider></MemoryRouter></QueryClientProvider>);
}
describe('the admin account directory', () => {
  it('shows email, sign-in dates, the actual Premium end and redeemed vouchers; filters the current page and pages all accounts', async () => {
    server.use(http.get('*/api/admin/users', ({ request }) => HttpResponse.json(new URL(request.url).searchParams.get('page') === '2'
      ? { ...DATA, page: 2, hasNextPage: false, users: [{ ...DATA.users[0], id: 'learner-2', name: 'Another Learner', vouchers: [] }] } : DATA)));
    view(<AdminUsers />);
    expect(await screen.findByText('Test Learner')).toBeInTheDocument();
    expect(screen.getByText('learner@example.invalid')).toBeInTheDocument();
    expect(screen.getByText('AROL…')).toBeInTheDocument();
    expect(screen.getAllByText(/9 Feb 2027/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Filter this page'), { target: { value: 'not-here' } });
    expect(screen.getByText('No users to show')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter this page'), { target: { value: 'arol' } });
    expect(screen.getByText('Test Learner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Another Learner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByText('No voucher redeemed')).toBeInTheDocument();
  });
  it('distinguishes failed history from no users and recovers on retry', async () => {
    let failed = true;
    server.use(http.get('*/api/admin/users', () => failed ? HttpResponse.json({ error: { code: 'voucher_history_unavailable', message: 'Voucher history could not be loaded.' } }, { status: 503 }) : HttpResponse.json({ ...DATA, total: 0, users: [], hasNextPage: false })));
    view(<AdminUsers />);
    expect(await screen.findByText('Could not load this section')).toBeInTheDocument();
    expect(screen.queryByText('No users to show')).toBeNull();
    failed = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No users to show')).toBeInTheDocument();
  });
});
it('shows actual email setup and opens a preview without sending any email', async () => {
  let sends = 0;
  server.use(http.get('*/api/admin/emails', () => HttpResponse.json({ billingEmailConfigured: false, billingEnabled: false, sender: null, authTemplatesUrl: 'https://supabase.com/dashboard/project/example/auth/templates', previews: [{ id: 'cancel', subject: 'Your cancellation', text: 'Actual sample message.' }] })), http.post('*/api/admin/emails', () => { sends++; return HttpResponse.json({}); }));
  view(<AdminEmails />);
  expect(await screen.findByText('Account emails')).toBeInTheDocument();
  expect(screen.getAllByText('Not configured')).toHaveLength(2);
  fireEvent.click(screen.getByText('Your cancellation'));
  expect(screen.getByText('Actual sample message.')).toBeInTheDocument();
  expect(sends).toBe(0);
});
it('updates a voucher cap without replacing its grants or resetting redemptions', async () => {
  let cap = 100; let body: unknown;
  const voucher = { id: '11111111-1111-4111-8111-111111111111', hint: 'AROL', note: 'Community', premiumDays: 90, maxRedemptions: 100, redeemedCount: 5, redeemableUntil: null, active: true, createdAt: '2026-11-11T12:00:00Z', revokedAt: null, state: 'open' };
  server.use(http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [{ ...voucher, maxRedemptions: cap }] })), http.post('*/api/admin/vouchers', async ({ request }) => { body = await request.json(); cap = (body as { maxRedemptions: number }).maxRedemptions; return HttpResponse.json({ ok: true }); }));
  view(<DevVouchers />);
  const input = await screen.findByLabelText('Maximum uses for AROL…');
  fireEvent.change(input, { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save limit' }));
  await waitFor(() => expect(body).toEqual({ action: 'limit', voucherId: voucher.id, maxRedemptions: 200 }));
  expect(await screen.findByText('5 of 200 used')).toBeInTheDocument();
  expect(screen.getByText('90 days of Premium')).toBeInTheDocument();
});
