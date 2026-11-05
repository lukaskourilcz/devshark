import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider, useT } from '../src/i18n/LanguageContext';
import Shop, { earnRows, ledgerLabel } from '../src/components/Shop';
import BrandFooter from '../src/components/BrandFooter';
import { closeUpgradeSheet, useUpgradeRequest } from '../src/lib/upgradeSheet';
import type { EarnSummary, WalletResponse } from '../src/lib/rewards';
import { DEFAULT_COIN_SETTINGS } from '../../shared/rewards';
import { clearAccountData } from '../src/lib/accountData';
import { server } from './mocks/server';

// Invented fixtures only; the shapes are the real op=wallet and op=shop ones.
const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
const signIn = () => { auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }; };
const signOut = () => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; };
afterEach(() => { signOut(); closeUpgradeSheet(); merch.on = false; });
// Merchandise is paused until next quarter (owner decision 10). These tests
// drive the merchandise screens as they come back with the switch on;
// merch-paused.test.tsx proves that nothing of them renders while it is off.
const merch = vi.hoisted(() => ({ on: false }));
vi.mock('../../shared/rewards', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../shared/rewards')>(),
  get MERCH_ENABLED() { return merch.on; },
}));

const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const PREMIUM = { ...FREE, tier: 'premium', source: 'manual' };

const progress = (over: Partial<NonNullable<EarnSummary['progress']>> = {}): NonNullable<EarnSummary['progress']> => ({
  premium: false, todayXpCoins: 40, streak: 4,
  topics: [{ id: 'javascript', passed: 21, total: 25 }, { id: 'html', passed: 30, total: 30 }],
  projects: [{ id: 'js-evolving-calculator', passed: 4, total: 10 }],
  earned: [], ...over,
});

const wallet = (over: Partial<WalletResponse> = {}): WalletResponse => ({
  subject: 'webdev',
  balance: 1240,
  entries: [
    { eventId: 'signup:user-1', amount: 200, reason: 'signup', reference: null, createdAt: '2026-09-20T10:00:00Z' },
    { eventId: 'xp:quiz:a1', amount: 12, reason: 'verified-xp', reference: 'quiz:a1', createdAt: '2026-09-21T10:00:00Z' },
  ],
  cosmetics: [],
  welcome: { granted: false, coins: 200 },
  earn: { rules: DEFAULT_COIN_SETTINGS, progress: progress() },
  ...over,
});

const shop = {
  enabled: false, cashCheckoutEnabled: false, testMode: true, policyUrl: '',
  items: [
    { sku: 'mug', variants: [], availability: 'unconfigured', price: null, variantStock: [{ variant: '', free: 0 }] },
    { sku: 't-shirt', variants: ['S', 'M'], availability: 'unconfigured', price: null, variantStock: [] },
  ],
  crown: { available: true, tokenPrice: 1200 },
  protection: { available: true, tokenPrice: 250, cap: 2 },
};

const pricedShop = {
  ...shop,
  enabled: true,
  items: [{
    sku: 'mug', variants: [], availability: 'available', variantStock: [{ variant: '', free: 5 }],
    price: { minor: 1799, currency: 'EUR', taxIncluded: true, tokenPrice: 6000, regions: ['CZ'] },
  }],
};

// The invite section (#228) reads op=referral; its own tests are in referral.test.tsx.
const REFERRAL = { enabled: true, code: 'abcd2345', coins: 100, cap: 20, credited: 0, pending: 0, invited: null };

function routes(opts: { plan?: unknown; wallet?: unknown; walletStatus?: number; social?: (body: unknown) => void; shop?: unknown; referral?: unknown } = {}) {
  server.use(
    http.get('*/api/settings', () => HttpResponse.json({ coins: DEFAULT_COIN_SETTINGS })),
    http.get('*/api/user/*', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/referral')) return HttpResponse.json((opts.referral ?? REFERRAL) as never);
      const op = new URL(request.url).searchParams.get('op');
      if (op === 'entitlement') return HttpResponse.json((opts.plan ?? FREE) as never);
      if (op === 'wallet') return HttpResponse.json((opts.wallet ?? wallet()) as never, { status: opts.walletStatus ?? 200 });
      if (op === 'shop') return HttpResponse.json((opts.shop ?? shop) as never);
      if (op === 'orders') return HttpResponse.json({ orders: [] });
      return undefined;
    }),
    http.post('*/api/user/*', async ({ request }) => {
      const body = await request.json();
      opts.social?.(body);
      return HttpResponse.json({ granted: true, coins: 5 });
    }),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{children}</LanguageProvider></MemoryRouter></QueryClientProvider>;
}
// The page holds its first render for its data (lib/routeData.ts); a render
// that suspends has to start inside an awaited act.
const mountShop = () => act(async () => render(<Shop />, { wrapper }));
const tHook = () => renderHook(() => useT(), { wrapper }).result.current;

describe('How to earn', () => {
  // Design audit P1.3: exactly five rows, no per-row Premium tag.
  it('lists learning, welcome, streaks, finishing and the month top three', () => {
    const t = tHook();
    const rows = earnRows({ rules: DEFAULT_COIN_SETTINGS, progress: progress() }, t, true);
    expect(rows.map((row) => row.key)).toEqual(['xp', 'welcome', 'streak', 'finish', 'month-top']);
    expect(rows.map((row) => row.label)).toEqual([
      'Learning', 'Welcome coins', 'Streak milestones', 'Finish a topic or project', 'Top three of the month',
    ]);
    expect(rows[0].detail).toBe('10% of the XP you earn, up to 400 coins a day. Premium: 20%.');
    expect(rows[0].figure).toBe('Today: 40 of 400');
    expect(rows[1].figure).toBe('Received');
    expect(rows[2].detail).toBe('A streak of 7, 30 and 100 days: 25, 100 and 300 coins.');
    expect(rows[2].figure).toBe('4 of 7 days');
    expect(rows[3].detail).toBe('Every level of a Learn topic: 100 coins. An evolving project: 150. A short path: 50.');
    // The month's top three by XP, ties sharing the place (migration 056).
    expect(rows[4].detail).toBe('Finish a calendar month with the most XP — top three earn 300, 200 and 100 coins; ties share the place.');
    expect(rows.some((row) => 'premium' in row)).toBe(false);
  });

  it('marks paid milestones and shows only the rules before progress loads', () => {
    const t = tHook();
    const earned = earnRows({ rules: DEFAULT_COIN_SETTINGS, progress: progress({ streak: 9, earned: ['streak:7', 'topic:html'] }) }, t, false);
    expect(earned.find((row) => row.key === 'streak')?.figure).toBe('9 of 30 days');
    expect(earned.find((row) => row.key === 'finish')?.figure).toBe('1 finished');
    expect(earned.find((row) => row.key === 'welcome')?.figure).toBe('+200');
    const all = earnRows({ rules: DEFAULT_COIN_SETTINGS, progress: progress({ earned: ['streak:7', 'streak:30', 'streak:100'] }) }, t, false);
    expect(all.find((row) => row.key === 'streak')).toMatchObject({ done: true, figure: 'Earned' });
    const rulesOnly = earnRows({ rules: DEFAULT_COIN_SETTINGS, progress: null }, t, false);
    expect(rulesOnly).toHaveLength(5);
    expect(rulesOnly.find((row) => row.key === 'streak')?.figure).toBeUndefined();
  });
});

describe('ledger lines', () => {
  it('say what each credit was for', () => {
    const t = tHook();
    expect(ledgerLabel({ reason: 'verified-xp', reference: 'learn:abc:html:L3' }, t)).toBe('Learn');
    expect(ledgerLabel({ reason: 'verified-xp', reference: 'coding:abc:js-digit-sum' }, t)).toBe('Coding challenge');
    expect(ledgerLabel({ reason: 'milestone', reference: 'streak:30' }, t)).toBe('30-day streak');
    expect(ledgerLabel({ reason: 'milestone', reference: 'month-top:2026-08' }, t)).toBe('Top three, August 2026');
    expect(ledgerLabel({ reason: 'purchase', reference: 'streak-protection' }, t)).toBe('Streak protection');
    expect(ledgerLabel({ reason: 'signup', reference: null }, t)).toBe('Welcome');
    expect(ledgerLabel({ reason: 'referral', reference: 'referral:friend' }, t)).toBe('Referral: a friend finished their first level');
    expect(ledgerLabel({ reason: 'referral', reference: 'referral:invited' }, t)).toBe('Referral: you finished your first level');
  });
});

describe('the Rewards screen', () => {
  it('shows a free account the merchandise with the upgrade sheet, never an address form', async () => {
    signIn();
    merch.on = true;
    routes({ plan: FREE, shop: pricedShop });
    await mountShop();
    expect(screen.getByRole('heading', { level: 1, name: 'Coins' })).toBeInTheDocument();
    await screen.findByText('1,240');
    expect(screen.getByRole('heading', { name: 'How to earn' })).toBeInTheDocument();
    await screen.findByText('Premium members redeem coins for merchandise.');
    const sheet = renderHook(() => useUpgradeRequest());
    const redeem = (await screen.findAllByRole('button', { name: 'Redeem' }))[0];
    expect(redeem).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(redeem);
    expect(sheet.result.current).toMatchObject({ kind: 'merch-redemption', ref: 'mug' });
    expect(screen.queryByLabelText('Postcode')).toBeNull();
  });

  // UX audit money-08 and money-12: the editorial header of the money pages,
  // and 'Coins' said by the h1 and the number's unit only.
  it('uses the operational PageHeader and names the wallet for screen readers only', async () => {
    signIn();
    routes();
    await mountShop();
    await screen.findByText('1,240');
    const header = document.querySelector('.ss-page-header')!;
    expect(header.querySelector('.ss-kicker')).toHaveTextContent('Rewards');
    expect(within(header as HTMLElement).getByRole('heading', { level: 1, name: 'Coins' })).toBeInTheDocument();
    expect(within(header as HTMLElement).getByText('Coins never buy XP or a place on a board.')).toBeInTheDocument();
    expect(screen.queryByText(/Learning earns coins/)).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Your coins' })).toHaveClass('ss-sr-only');
  });

  // UX audit money-02 and money-07: the two coin items are rows of one ruled
  // list with one structure, and a short balance says by how much.
  it('lists the crown and streak protection as two rows and says how many coins are missing', async () => {
    signIn();
    routes({ wallet: wallet({ balance: 640 }) });
    await mountShop();
    await screen.findByText('640');
    const section = screen.getByRole('region', { name: 'Crown and streak protection' });
    const rows = within(section).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toHaveClass('rw-spend__row');
      expect(row.querySelector('.rw-spend__icon svg')).toHaveAttribute('width', '44');
      expect(row.querySelector('.rw-spend__name')).not.toBeNull();
      expect(row.querySelector('.rw-spend__blurb')).not.toBeNull();
      expect(row.querySelector('.rw-spend__action')).not.toBeNull();
    }
    expect(section.querySelector('.astryx-card')).toBeNull();
    // 1,200 against 640: the crown says 560 more, and its Buy names that line.
    const crown = rows[0];
    const short = within(crown).getByText('560 more coins');
    const buy = within(crown).getByRole('button', { name: 'Buy' });
    expect(buy).toBeDisabled();
    expect(buy).toHaveAttribute('aria-describedby', short.id);
    // 250 is covered: no line, no description.
    expect(within(rows[1]).queryByText(/more coins/)).toBeNull();
    expect(within(rows[1]).getByRole('button', { name: 'Buy' })).not.toHaveAttribute('aria-describedby');
  });

  // UX audit money-14: no dashed box between the two ruled lists.
  it('says which rows pay Premium members in a plain line with a ghost link to the sheet', async () => {
    signIn();
    routes();
    await mountShop();
    const earn = await screen.findByRole('region', { name: 'How to earn' });
    expect(earn.querySelector('.rw-premium-note')).toBeNull();
    const note = within(earn).getByText(/Premium milestones pay Premium members/);
    expect(note).toHaveClass('rw-muted');
    const see = within(earn).getByRole('button', { name: 'See what Premium includes' });
    expect(see).toHaveClass('ghost', 'ss-action');
    const sheet = renderHook(() => useUpgradeRequest());
    fireEvent.click(see);
    expect(sheet.result.current).not.toBeNull();
  });

  it('keeps the sections in the order of the handoff', async () => {
    signIn();
    merch.on = true;
    routes({ plan: PREMIUM, shop: pricedShop, wallet: wallet({ earn: { rules: DEFAULT_COIN_SETTINGS, progress: progress({ premium: true }) } }) });
    await mountShop();
    await screen.findByText('1,240');
    await screen.findByRole('heading', { name: 'Crown and streak protection' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((one) => one.textContent);
    expect(headings.slice(0, 5)).toEqual(['Your coins', 'How to earn', 'Crown and streak protection', 'Invite a friend', 'Merchandise']);
    expect(screen.queryByText('Premium members redeem coins for merchandise.')).toBeNull();
  });

  it('leaves merchandise out while redemption is closed (design audit P0.1)', async () => {
    signIn();
    routes({ plan: PREMIUM, wallet: wallet({ earn: { rules: DEFAULT_COIN_SETTINGS, progress: progress({ premium: true }) } }) });
    await mountShop();
    await screen.findByRole('heading', { name: 'Crown and streak protection' });
    expect(screen.queryByRole('heading', { name: 'Merchandise' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redeem' })).toBeNull();
    expect(screen.queryByText('Not on sale yet')).toBeNull();
  });

  it('lets a Premium member redeem once the coins cover the price', async () => {
    signIn();
    merch.on = true;
    const premiumWallet = (balance: number) => wallet({ balance, earn: { rules: DEFAULT_COIN_SETTINGS, progress: progress({ premium: true }) } });
    routes({ plan: PREMIUM, shop: pricedShop, wallet: premiumWallet(264) });
    const first = await mountShop();
    const short = await screen.findByRole('button', { name: 'Redeem' });
    await screen.findByText('Not enough coins');
    expect(short).toBeDisabled();
    first.unmount();
    routes({ plan: PREMIUM, shop: pricedShop, wallet: premiumWallet(7000) });
    await mountShop();
    await screen.findByText('7,000');
    const redeem = await screen.findByRole('button', { name: 'Redeem' });
    await waitFor(() => expect(redeem).toBeEnabled());
    fireEvent.click(redeem);
    expect(await screen.findByRole('heading', { name: 'Redeem: Mug' })).toBeInTheDocument();
    expect(screen.getByLabelText('Postcode')).toBeInTheDocument();
  });

  it('shows the last lines of the ledger and the rest on request', async () => {
    signIn();
    const entries = Array.from({ length: 7 }, (_, i) => ({
      eventId: `xp:quiz:q${i}`, amount: 10 + i, reason: 'verified-xp', reference: `quiz:q${i}`, createdAt: '2026-09-21T10:00:00Z',
    }));
    routes({ wallet: wallet({ entries }) });
    await mountShop();
    const toggle = await screen.findByRole('button', { name: 'Show all 7' });
    const list = document.getElementById('rw-ledger')!;
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
  });

  it('asks a signed-out visitor to sign in and still explains how to earn', async () => {
    signOut();
    routes();
    await mountShop();
    expect(screen.getByText('Streak milestones')).toBeInTheDocument();
    // UX audit money-05: one signed-out block where the balance goes, with no
    // '—' standing in for a number; one primary Sign in on the screen; Buy
    // asks to sign in instead of sitting disabled.
    const walletSection = screen.getByRole('region', { name: 'Your coins' });
    expect(within(walletSection).getByText('Your coins and what earned them show here once you sign in.')).toBeInTheDocument();
    expect(within(walletSection).queryByText('—')).toBeNull();
    expect(within(walletSection).getByRole('button', { name: 'Sign in' })).toHaveClass('primary');
    const signIns = screen.getAllByRole('button', { name: 'Sign in' });
    expect(signIns.filter((one) => one.classList.contains('primary'))).toHaveLength(1);
    const buys = await screen.findAllByRole('button', { name: 'Sign in to buy' });
    expect(buys).toHaveLength(2);
    for (const buy of buys) {
      expect(buy).toBeEnabled();
      expect(buy).toHaveAttribute('aria-haspopup', 'dialog');
    }
    expect(screen.queryByRole('button', { name: 'Buy' })).toBeNull();
  });

  it('buys one streak protection for a double click on Buy', async () => {
    signIn();
    routes();
    const bought: string[] = [];
    server.use(http.post('*/api/user/protection', () => {
      bought.push('protection');
      return HttpResponse.json({ bought: true, remaining: 1, period: '2026-10' });
    }));
    await mountShop();
    await screen.findByText('1,240');
    const buy = (await screen.findAllByRole('button', { name: 'Buy' }))[1];
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    fireEvent.click(buy);
    expect(await screen.findByText('Bought. You have 1 this month.')).toBeInTheDocument();
    expect(bought).toEqual(['protection']);
  });

  it('keeps Buy busy until the wallet is read again after a purchase', async () => {
    signIn();
    routes();
    let bought = false;
    let rereads = 0;
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    server.use(
      http.get('*/api/user/*', async ({ request }) => {
        if (new URL(request.url).searchParams.get('op') !== 'wallet') return undefined;
        if (!bought) return HttpResponse.json(wallet());
        rereads += 1;
        await held;
        return HttpResponse.json(wallet({ balance: 990 }));
      }),
      http.post('*/api/user/protection', () => {
        bought = true;
        return HttpResponse.json({ bought: true, remaining: 1, period: '2026-10' });
      }),
    );
    await mountShop();
    await screen.findByText('1,240');
    const buy = (await screen.findAllByRole('button', { name: 'Buy' }))[1];
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    await waitFor(() => expect(rereads).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The purchase is through, but the balance on screen is still the old one.
    expect(screen.getByText('1,240')).toBeInTheDocument();
    expect(buy).toBeDisabled();
    act(() => release());
    expect(await screen.findByText('990')).toBeInTheDocument();
    await waitFor(() => expect(buy).toBeEnabled());
  });

  it('says so when wearing the crown fails', async () => {
    signIn();
    routes({ wallet: wallet({ cosmetics: [{ id: 'crown', equipped: false }] }) });
    server.use(http.post('*/api/user/*', () => HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 })));
    await mountShop();
    const wear = await screen.findByRole('button', { name: 'Wear it' });
    await waitFor(() => expect(wear).toBeEnabled());
    fireEvent.click(wear);
    expect(await screen.findByText('Server error. Try again in a moment.')).toBeInTheDocument();
  });

  it('reports a refused purchase as an error', async () => {
    signIn();
    routes();
    server.use(http.post('*/api/user/protection', () => HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 })));
    await mountShop();
    await screen.findByText('1,240');
    const buy = (await screen.findAllByRole('button', { name: 'Buy' }))[1];
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    const message = await screen.findByText('Server error. Try again in a moment.');
    expect(message.closest('[role]')).toHaveAttribute('role', 'alert');
  });

  it('says nothing about a purchase that answers after the account signed out', async () => {
    signIn();
    routes();
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let posted = false;
    server.use(http.post('*/api/user/protection', async () => {
      posted = true;
      await held;
      return HttpResponse.json({ bought: true, remaining: 1, period: '2026-10' });
    }));
    await mountShop();
    await screen.findByText('1,240');
    const buy = (await screen.findAllByRole('button', { name: 'Buy' }))[1];
    await waitFor(() => expect(buy).toBeEnabled());
    fireEvent.click(buy);
    await waitFor(() => expect(posted).toBe(true));
    act(() => { clearAccountData(); });
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Bought. You have 1 this month.')).toBeNull();
  });

  it('keeps the catalogue it has when a re-read of it fails, without saying it could not load', async () => {
    signIn();
    routes();
    server.use(http.get('*/api/user/*', ({ request }) => (new URL(request.url).searchParams.get('op') === 'shop'
      ? HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 })
      : undefined)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Read on an earlier visit, and stale now.
    client.setQueryData(['rewards', 'shop'], shop, { updatedAt: Date.now() - 60 * 60_000 });
    await act(async () => render(<Shop />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: '/shop', key: 'stale-catalogue' }]}>
            <LanguageProvider>{children}</LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>
      ),
    }));
    await waitFor(() => expect(client.getQueryState(['rewards', 'shop'])?.status).toBe('error'));
    expect(screen.getByRole('heading', { name: 'Crown and streak protection' })).toBeInTheDocument();
    expect(screen.queryByText('The shop could not load. Try again in a moment.')).toBeNull();
  });

  it('asks nobody to sign in for coins or an invite link while the session is still being restored', async () => {
    auth.value = { user: null, isAuthenticated: false, isLoading: true };
    routes();
    await mountShop();
    // The invite section draws from the public settings while signed out.
    expect(await screen.findByRole('heading', { name: 'Invite a friend' })).toBeInTheDocument();
    expect(screen.queryByText('Your coins and what earned them show here once you sign in.')).toBeNull();
    expect(screen.queryByText('Your invite link shows here once you sign in.')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Sign in/ })).toBeNull();
    expect(screen.getAllByRole('status').some((one) => one.textContent === 'Loading…')).toBe(true);
  });

  it('offers a retry when the coins cannot load', async () => {
    signIn();
    routes({ wallet: { error: { code: 'db_error' } }, walletStatus: 500 });
    await mountShop();
    expect(await screen.findByText('Your coins could not load.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('draws a read that failed in the first-data hold as its error at once, without asking again', async () => {
    signIn();
    routes();
    let reads = 0;
    server.use(http.get('*/api/user/*', ({ request }) => {
      if (new URL(request.url).searchParams.get('op') !== 'wallet') return undefined;
      reads += 1;
      return HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 });
    }));
    // The app's cache keeps a failed read for minutes (lib/queryClient.ts);
    // the shared wrapper's gcTime 0 would drop it before the page mounts. A
    // visit of its own, so the hold reads instead of finding an earlier
    // test's wait (lib/routeData.ts keys it by the visit).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => render(<Shop />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: '/shop', key: 'held-wallet-read' }]}>
            <LanguageProvider>{children}</LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>
      ),
    }));
    expect(screen.getByText('Your coins could not load.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toBe(1);
    expect(screen.getByText('Your coins could not load.')).toBeInTheDocument();
  });
});

describe('Find devShark elsewhere', () => {
  // Design audit P0.3: the profiles are linked once, as icons in the footer,
  // and opening one pays nothing.
  it('links the recorded profiles from the footer without a reward', async () => {
    signIn();
    const posted = vi.fn();
    routes({ social: posted });
    render(<BrandFooter />, { wrapper });
    const nav = screen.getByRole('navigation', { name: 'Find devShark elsewhere' });
    expect(within(nav).getByText('Follow us on Instagram.')).toBeInTheDocument();
    for (const name of [/Instagram/]) {
      const link = within(nav).getByRole('link', { name });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      link.addEventListener('click', (event) => event.preventDefault());
      fireEvent.click(link);
    }
    // Not created yet (#239): a null profile leaves no icon and no gap.
    expect(within(nav).queryByRole('link', { name: /LinkedIn/ })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /Threads/ })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).not.toHaveBeenCalled();
    expect(screen.queryByText(/Thanks for visiting|Thanks for following/i)).toBeNull();
  });
});
