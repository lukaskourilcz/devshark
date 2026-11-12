// /dev → Vouchers (migration 045): create a code, see it once, list and revoke.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import DevVouchers, { voucherInput } from '../src/components/dev/DevVouchers';
import { server } from './mocks/server';

const OPEN = {
  id: '5d6a8a4e-1f59-4d6a-9f56-0f7b6c1e2a3b', hint: 'K7Q2', note: 'For Pavel, who reviewed the React levels', premiumDays: 30,
  maxRedemptions: 1, redeemedCount: 0, redeemableUntil: null, active: true, createdAt: '2026-09-26T12:00:00.000Z', revokedAt: null, state: 'open',
};
const REVOKED = {
  ...OPEN, id: '6e7b9b5f-2a60-4e7b-8a67-1a8c7d2f3b4c', hint: 'CAMP', note: 'Shark camp', premiumDays: null, maxRedemptions: 40,
  redeemedCount: 12, redeemableUntil: '2026-10-31T22:59:59.000Z', active: false, revokedAt: '2026-09-27T09:00:00.000Z', state: 'revoked',
};

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/vouchers']}>
        <LanguageProvider><DevVouchers /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // The list comes first; "New voucher" opens the form (admin UX review, 12 November 2026).
  fireEvent.click(screen.getByRole('button', { name: 'New voucher' }));
  return view;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the voucher form', () => {
  const today = new Date(2026, 8, 26, 10, 0, 0);
  const form = { note: 'For Pavel', days: '30' as const, uses: '1', until: '', code: '' };

  it('turns the form into what the server takes', () => {
    expect(voucherInput(form, today)).toEqual({ input: { note: 'For Pavel', premiumDays: 30, maxRedemptions: 1, redeemableUntil: null, code: null } });
    const camp = voucherInput({ ...form, days: 'none', uses: '40', until: '2026-10-31', code: 'shark-camp-2026' }, today);
    expect(camp).toEqual({
      input: { note: 'For Pavel', premiumDays: null, maxRedemptions: 40, redeemableUntil: new Date('2026-10-31T23:59:59').toISOString(), code: 'SHARKCAMP2026' },
    });
    expect(voucherInput({ ...form, until: '2026-09-26' }, today)).toMatchObject({ input: { redeemableUntil: new Date('2026-09-26T23:59:59').toISOString() } });
  });

  it('names every field that stops it', () => {
    expect(voucherInput({ ...form, note: '  ', uses: '0', until: '2026-09-25', code: 'abc' }, today)).toEqual({
      errors: { note: 'dev.vouchers.noteRequired', uses: 'dev.vouchers.usesInvalid', until: 'dev.vouchers.untilInvalid', code: 'dev.vouchers.customInvalid' },
    });
    expect(voucherInput({ ...form, uses: '10001' }, today)).toEqual({ errors: { uses: 'dev.vouchers.usesInvalid' } });
    expect(voucherInput({ ...form, until: '2031-09-27' }, today)).toEqual({ errors: { until: 'dev.vouchers.untilInvalid' } });
    expect(voucherInput({ ...form, note: 'x'.repeat(501) }, today)).toEqual({ errors: { note: 'dev.vouchers.noteRequired' } });
  });
});

describe('/admin/vouchers', () => {
  it('lists each voucher by its hint, with uses, length, dates and state in words', async () => {
    server.use(http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [OPEN, REVOKED] })));
    renderConsole();
    const rows = await screen.findAllByRole('listitem', { name: undefined });
    const open = rows.find((row) => row.textContent?.includes('K7Q2…'))!;
    expect(open).toHaveTextContent('Open');
    expect(open).toHaveTextContent('For Pavel, who reviewed the React levels');
    expect(open).toHaveTextContent('0 of 1 used');
    expect(open).toHaveTextContent('30 days of Premium');
    expect(open).toHaveTextContent('No redeem-by date');
    expect(within(open).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
    const revoked = rows.find((row) => row.textContent?.includes('CAMP…'))!;
    expect(revoked).toHaveTextContent('Revoked');
    expect(revoked).toHaveTextContent('12 of 40 used');
    expect(revoked).toHaveTextContent('Premium with no end');
    expect(revoked).toHaveTextContent(/Redeem by 3?1 Oct 2026|Redeem by 1 Nov 2026/);
    expect(within(revoked).queryByRole('button', { name: 'Revoke' })).toBeNull();
    // No code and no hash ever reaches the list.
    expect(document.body.textContent).not.toMatch(/[0-9a-f]{64}/);
  });

  it('says when there are none, and when migration 045 is missing', async () => {
    server.use(http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [] })));
    const first = renderConsole();
    expect(await screen.findByText('No vouchers yet. The first one you create appears here.')).toBeInTheDocument();
    first.unmount();
    server.use(http.get('*/api/admin/vouchers', () => HttpResponse.json({ error: { code: 'migration_required', message: 'Voucher migration 045 is not installed' } }, { status: 503 })));
    renderConsole();
    expect(await screen.findByText(/Migration 045 is not installed yet/)).toBeInTheDocument();
  });

  it('creates a voucher and shows its code once, with a copy button', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const sent: unknown[] = [];
    let listed = [] as unknown[];
    server.use(
      http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: listed })),
      http.post('*/api/admin/vouchers', async ({ request }) => {
        sent.push(await request.json());
        const voucher = { ...OPEN, hint: 'ABCD', note: 'For the meetup', premiumDays: null, maxRedemptions: 5 };
        listed = [voucher];
        return HttpResponse.json({ voucher, code: 'ABCD-EFGH-JKMN' });
      }),
    );
    renderConsole();
    fireEvent.change(await screen.findByRole('textbox', { name: /^Note/ }), { target: { value: 'For the meetup' } });
    fireEvent.click(screen.getByRole('radio', { name: 'No end' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Uses/ }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create voucher' }));
    const heading = await screen.findByRole('heading', { level: 3, name: 'New code' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(sent).toEqual([{ action: 'create', note: 'For the meetup', premiumDays: null, maxRedemptions: 5, redeemableUntil: null, code: null }]);
    const code = screen.getByRole('textbox', { name: 'Voucher code' });
    expect(code).toHaveValue('ABCD-EFGH-JKMN');
    expect(code).toHaveAttribute('readonly');
    expect(screen.getByText(/This is the only time devShark shows this code/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(await screen.findByText('Copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH-JKMN');
    // The list refreshed with the new voucher, by its hint only.
    expect(await screen.findByText('ABCD…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue('ABCD-EFGH-JKMN')).toBeNull();
    // The form closed with the code shown; the next voucher starts from the button.
    expect(screen.queryByRole('textbox', { name: /^Note/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'New voucher' })).toBeInTheDocument();
  });

  it('creates one voucher however fast the form is sent twice', async () => {
    let created = 0;
    server.use(
      http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [] })),
      http.post('*/api/admin/vouchers', async () => {
        created += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json({ voucher: OPEN, code: `K7Q2-ABCD-000${created}` });
      }),
    );
    renderConsole();
    fireEvent.change(await screen.findByRole('textbox', { name: /^Note/ }), { target: { value: 'For Pavel' } });
    const form = screen.getByRole('button', { name: 'Create voucher' }).closest('form')!;
    // Two submits before React renders the busy state: a double click.
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(await screen.findByRole('textbox', { name: 'Voucher code' })).toHaveValue('K7Q2-ABCD-0001');
    expect(created).toBe(1);
  });

  it('selects the code for copying by hand when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    server.use(
      http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [] })),
      http.post('*/api/admin/vouchers', () => HttpResponse.json({ voucher: OPEN, code: 'K7Q2-ABCD-1234' })),
    );
    renderConsole();
    fireEvent.change(await screen.findByRole('textbox', { name: /^Note/ }), { target: { value: 'For Pavel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create voucher' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy code' }));
    expect(await screen.findByText('Copying did not work. The code is selected: copy it by hand.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Voucher code' })).toHaveFocus();
  });

  it('refuses a form with a missing note before it asks the server, and a custom code in use after', async () => {
    const sent: unknown[] = [];
    server.use(
      http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: [] })),
      http.post('*/api/admin/vouchers', async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ error: { code: 'voucher_exists', message: 'That code is in use already.' } }, { status: 409 });
      }),
    );
    renderConsole();
    fireEvent.click(await screen.findByRole('button', { name: 'Create voucher' }));
    expect(await screen.findByText('Write a note of up to 500 characters.')).toBeInTheDocument();
    expect(sent).toEqual([]);
    fireEvent.change(screen.getByRole('textbox', { name: /^Note/ }), { target: { value: 'Camp' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Custom code/ }), { target: { value: 'shark-camp-2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create voucher' }));
    expect(await screen.findByText('That code is in use already. Choose another one.')).toBeInTheDocument();
    expect(sent).toEqual([{ action: 'create', note: 'Camp', premiumDays: 30, maxRedemptions: 1, redeemableUntil: null, code: 'SHARKCAMP2026' }]);
  });

  it('revokes a voucher after a confirmation, and can be talked out of it', async () => {
    const sent: unknown[] = [];
    let listed = [OPEN] as unknown[];
    server.use(
      http.get('*/api/admin/vouchers', () => HttpResponse.json({ vouchers: listed })),
      http.post('*/api/admin/vouchers', async ({ request }) => {
        sent.push(await request.json());
        const voucher = { ...OPEN, active: false, revokedAt: '2026-09-27T09:00:00.000Z', state: 'revoked' };
        listed = [voucher];
        return HttpResponse.json({ voucher });
      }),
    );
    renderConsole();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    const confirm = screen.getByRole('group', { name: 'Revoke' });
    expect(confirm).toHaveTextContent('Revoke K7Q2…? It opens nothing from now on. Premium it already opened stays until its end.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('group', { name: 'Revoke' })).toBeNull();
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Revoke' })).getByRole('button', { name: 'Revoke voucher' }));
    expect(await screen.findByText('Voucher K7Q2… revoked.')).toBeInTheDocument();
    expect(sent).toEqual([{ action: 'revoke', voucherId: OPEN.id }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull());
    expect(screen.getByText('Revoked', { selector: '.dev-voucher-state' })).toBeInTheDocument();
  });
});
