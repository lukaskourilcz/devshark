import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Editor } from '@tiptap/core';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import AdminUsers from '../src/components/admin/AdminUsers';
import AdminEmails from '../src/components/admin/AdminEmails';
import DevVouchers from '../src/components/dev/DevVouchers';
import { server } from './mocks/server';
import { clearAccountData } from '../src/lib/accountData';
import { adminEmailsKey } from '../src/lib/adminDirectory';
import type { AdminDirectory } from '../../shared/admin-directory';
import { EMAIL_TEMPLATE_IDS, fallbackEmailTemplate } from '../../shared/email-templates';

const DATA: AdminDirectory = { page: 1, pageSize: 25, total: 26, hasNextPage: true, voucherHistoryPartial: false, users: [{
  id: 'learner-1', email: 'learner@example.invalid', name: 'Test Learner', createdAt: '2026-11-01T12:00:00Z', lastSignInAt: '2026-11-11T12:00:00Z', emailConfirmed: true, providers: ['google'],
  plan: { tier: 'premium', source: 'promo', validUntil: '2027-02-09T12:00:00Z', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false },
  vouchers: [{ voucherId: 'voucher-1', hint: 'AROL', note: 'Community access', redeemedAt: '2026-11-11T12:00:00Z', validUntil: '2027-02-09T12:00:00Z', status: 'active' }],
}] };
function view(child: React.ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
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
it('edits an email template, previews it and saves it without sending any email', async () => {
  const posts: Array<Record<string, unknown>> = [];
  const templates = Object.fromEntries(EMAIL_TEMPLATE_IDS.map(id => [id, { ...fallbackEmailTemplate(id), custom: false, updatedAt: null }]));
  server.use(
    http.get('*/api/admin/emails', () => HttpResponse.json({ deliveryConfigured: false, billingEnabled: false, sender: 'devShark <noreply@devshark.app>', replyTo: 'support@devshark.app', authTemplatesUrl: 'https://supabase.com/dashboard/project/example/auth/templates', authSync: { configured: false }, templates })),
    http.post('*/api/admin/emails', async ({ request }) => { const body = await request.json() as Record<string, unknown>; posts.push(body); return HttpResponse.json({ template: { subject: body.subject, document: body.document, custom: true, updatedAt: '2026-11-12T12:00:00Z' }, authSync: null }); }),
  );
  view(<AdminEmails />);
  expect(await screen.findByText('support@devshark.app')).toBeInTheDocument();
  expect(screen.getByText('Not configured: RESEND_API_KEY is missing, so nothing is sent')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Cancellation receipt' }));
  const subject = screen.getByLabelText('Subject');
  await waitFor(() => expect(subject).toHaveValue('Your devShark Premium cancellation'));
  expect(screen.getByTitle('Preview').getAttribute('srcdoc')).toContain('Premium stays open until 12 November 2026.');
  expect(screen.getByRole('button', { name: 'Send test email' })).toBeDisabled();
  fireEvent.change(subject, { target: { value: 'Premium cancelled' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
  expect(await screen.findByText('Template saved. The next email of this kind uses the new text.')).toBeInTheDocument();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'save', id: 'cancelled', subject: 'Premium cancelled' });
});
describe('editing multiple email templates', () => {
  const templates = Object.fromEntries(EMAIL_TEMPLATE_IDS.map(id => [id, { ...fallbackEmailTemplate(id), custom: false, updatedAt: null }]));
  function openEditor(client?: QueryClient) {
    server.use(http.get('*/api/admin/emails', () => HttpResponse.json({ deliveryConfigured: false, billingEnabled: false, authSync: { configured: false }, templates })));
    return view(<AdminEmails />, client);
  }

  it('retains unsaved text when visiting another template and discards only the selected draft', async () => {
    openEditor();
    const subject = await screen.findByLabelText('Subject');
    const firstTab = screen.getByRole('tab', { selected: true });
    const otherTab = screen.getByRole('tab', { name: 'Cancellation receipt' });
    fireEvent.change(subject, { target: { value: 'Edited confirmation' } });
    const body = await screen.findByRole('textbox', { name: 'Email text' }) as HTMLElement & { editor: Editor };
    act(() => { body.editor.commands.insertContent('Unsaved body text '); });
    fireEvent.click(otherTab);
    fireEvent.change(subject, { target: { value: 'Edited cancellation' } });
    fireEvent.click(firstTab);
    expect(subject).toHaveValue('Edited confirmation');
    expect(await screen.findByRole('textbox', { name: 'Email text' })).toHaveTextContent('Unsaved body text');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(subject).toHaveValue(templates.signup_confirmation.subject);
    fireEvent.click(otherTab);
    expect(subject).toHaveValue('Edited cancellation');
  });

  it('keeps an earlier account’s delayed save out of a newly opened editor', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    let finish: (() => void) | undefined;
    server.use(http.post('*/api/admin/emails', async () => new Promise<Response>(resolve => {
      finish = () => resolve(HttpResponse.json({ template: { ...templates.signup_confirmation, subject: 'Former admin edit', custom: true }, authSync: null }));
    })));
    const first = openEditor(client);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Former admin edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(finish).toBeDefined());
    first.unmount();
    clearAccountData();
    client.removeQueries({ queryKey: adminEmailsKey });
    openEditor(client);
    await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveValue(templates.signup_confirmation.subject));
    await act(async () => { finish!(); });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByLabelText('Subject')).toHaveValue(templates.signup_confirmation.subject);
  });

  it('applies a delayed save to its own template and preserves newer typing', async () => {
    let finish: (() => void) | undefined;
    let writes = 0;
    server.use(http.post('*/api/admin/emails', async ({ request }) => {
      const submitted = await request.json() as { id: string; subject: string };
      writes++;
      return new Promise<Response>(resolve => { finish = () => resolve(HttpResponse.json({
        template: { ...templates[submitted.id], subject: submitted.subject, custom: true }, authSync: null,
      })); });
    }));
    openEditor();
    const subject = await screen.findByLabelText('Subject');
    const firstTab = screen.getByRole('tab', { selected: true });
    const otherTab = screen.getByRole('tab', { name: 'Cancellation receipt' });
    fireEvent.click(otherTab);
    fireEvent.change(subject, { target: { value: 'Sent cancellation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.change(subject, { target: { value: 'Newer cancellation' } });
    fireEvent.click(firstTab);
    fireEvent.change(subject, { target: { value: 'Newer confirmation' } });
    await act(async () => { finish!(); });
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
    expect(subject).toHaveValue('Newer confirmation');
    expect(screen.queryByText('Template saved. The next email of this kind uses the new text.')).toBeNull();
    fireEvent.click(otherTab);
    expect(subject).toHaveValue('Newer cancellation');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(subject).toHaveValue('Sent cancellation');
    expect(writes).toBe(1);
  });
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
