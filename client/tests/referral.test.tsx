import { trackAnnouncement } from './announcement';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ReferralInvite } from '../src/components/ReferralInvite';
import { ReferralBinder } from '../src/components/ReferralBinder';
import { captureReferralFromUrl, claimStoredReferral, storedReferral, type ReferralSummary } from '../src/lib/referral';
import { DEFAULT_COIN_SETTINGS } from '../../shared/rewards';
import { clearAccountData } from '../src/lib/accountData';
import { server } from './mocks/server';

// Invitations (#228). Invented fixtures only; the shapes are the real
// op=referral ones.
const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
const signIn = (id = 'user-1') => { auth.value = { user: { id }, isAuthenticated: true, isLoading: false }; };
const signOut = () => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; };
afterEach(() => { signOut(); vi.restoreAllMocks(); });

const SUMMARY: ReferralSummary = { enabled: true, code: 'abcd2345', coins: 100, cap: 20, credited: 3, pending: 2, invited: null };

function routes(opts: { summary?: unknown; status?: number; claim?: (body: unknown) => Response | undefined } = {}) {
  server.use(
    http.get('*/api/settings', () => HttpResponse.json({ coins: DEFAULT_COIN_SETTINGS })),
    http.get('*/api/user/referral', () => HttpResponse.json((opts.summary ?? SUMMARY) as never, { status: opts.status ?? 200 })),
    http.post('*/api/user/referral', async ({ request }) => {
      const body = await request.json();
      return opts.claim?.(body) ?? HttpResponse.json({ status: 'recorded', coins: 100 });
    }),
  );
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider>{children}</LanguageProvider></MemoryRouter></QueryClientProvider>;
}

const keep = (code: string, savedAt = Date.now()) => localStorage.setItem('devshark:referral', JSON.stringify({ code, savedAt }));

describe('the invite link in the address bar', () => {
  it('keeps the code and takes it out of the URL, leaving the rest', () => {
    const history = { state: { key: 'k' }, replaceState: vi.fn() };
    expect(captureReferralFromUrl({ href: 'https://devshark.example/?utm=x&ref=ABCD2345#top' }, history)).toBe('abcd2345');
    expect(history.replaceState).toHaveBeenCalledWith({ key: 'k' }, '', '/?utm=x#top');
    expect(storedReferral()).toBe('abcd2345');
  });

  it('drops a malformed code but still cleans the URL', () => {
    const history = { state: null, replaceState: vi.fn() };
    expect(captureReferralFromUrl({ href: 'https://devshark.example/learn?ref=<script>' }, history)).toBeNull();
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/learn');
    expect(storedReferral()).toBeNull();
  });

  it('keeps the first invitation and replaces only a stale one', () => {
    const history = { state: null, replaceState: vi.fn() };
    keep('abcd2345');
    expect(captureReferralFromUrl({ href: 'https://devshark.example/?ref=zzzz9999' }, history)).toBe('abcd2345');
    keep('abcd2345', Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect(captureReferralFromUrl({ href: 'https://devshark.example/?ref=zzzz9999' }, history)).toBe('zzzz9999');
  });

  it('does nothing without a ref parameter', () => {
    const history = { state: null, replaceState: vi.fn() };
    expect(captureReferralFromUrl({ href: 'https://devshark.example/shop' }, history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});

describe('offering the kept code', () => {
  it('sends the code and nothing else, then forgets it', async () => {
    keep('abcd2345');
    const posted = vi.fn();
    routes({ claim: (body) => { posted(body); return undefined; } });
    await expect(claimStoredReferral()).resolves.toEqual({ status: 'recorded', coins: 100 });
    expect(posted).toHaveBeenCalledWith({ code: 'abcd2345' });
    expect(storedReferral()).toBeNull();
  });

  it('keeps the code when the server is down, and forgets it on a refusal', async () => {
    keep('abcd2345');
    routes({ claim: () => HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 }) });
    await expect(claimStoredReferral()).resolves.toBeNull();
    expect(storedReferral()).toBe('abcd2345');
    routes({ claim: () => HttpResponse.json({ error: { code: 'bad_request', message: 'x' } }, { status: 400 }) });
    await expect(claimStoredReferral()).resolves.toBeNull();
    expect(storedReferral()).toBeNull();
  });

  it('says so once the server accepts it after sign-in', async () => {
    keep('abcd2345');
    routes();
    signIn();
    render(<ReferralBinder />, { wrapper });
    expect(await screen.findByText('Invitation accepted. Finish your first Learn level and you and your friend each get 100 coins.')).toBeInTheDocument();
  });

  it('stays quiet when the server accepts it after the account signed out', async () => {
    keep('abcd2345');
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let posted = false;
    routes();
    server.use(http.post('*/api/user/referral', async () => {
      posted = true;
      await held;
      return HttpResponse.json({ status: 'recorded', coins: 100 });
    }));
    signIn();
    const view = render(<ReferralBinder />, { wrapper });
    await waitFor(() => expect(posted).toBe(true));
    act(() => { clearAccountData(); });
    signOut();
    view.rerender(<ReferralBinder />);
    act(() => release());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Invitation accepted/)).toBeNull();
  });

  it('stays quiet when the account is too old to be invited', async () => {
    keep('abcd2345');
    const posted = vi.fn();
    routes({ claim: (body) => { posted(body); return HttpResponse.json({ status: 'closed', coins: 100 }); } });
    signIn();
    render(<ReferralBinder />, { wrapper });
    await waitFor(() => expect(posted).toHaveBeenCalled());
    await waitFor(() => expect(storedReferral()).toBeNull());
    expect(screen.queryByText(/Invitation accepted/)).toBeNull();
  });

  it('asks nothing when no code was kept', async () => {
    const posted = vi.fn();
    routes({ claim: (body) => { posted(body); return undefined; } });
    signIn();
    render(<ReferralBinder />, { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).not.toHaveBeenCalled();
  });
});

describe('Invite a friend', () => {
  it('shows the link, copies it and counts friends without naming them', async () => {
    signIn();
    routes();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ReferralInvite signedIn />, { wrapper });
    expect(screen.getByRole('heading', { level: 2, name: 'Invite a friend' })).toBeInTheDocument();
    const field = await screen.findByLabelText('Your invite link');
    expect(field).toHaveValue(`${window.location.origin}/?ref=abcd2345`);
    expect(field).toHaveAttribute('readonly');
    expect(screen.getByText('3 of 20')).toBeInTheDocument();
    expect(screen.getByText('Signed up, first level still to finish')).toBeInTheDocument();
    expect(screen.getByText('You see how many friends joined, not who they are.')).toBeInTheDocument();
    // A utility beside its field: secondary, so Buy stays the page's filled action.
    expect(screen.getByRole('button', { name: 'Copy link' })).toHaveClass('secondary');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=abcd2345`));
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();
  });

  it('says Link copied again on a second Copy, by emptying the status line first', async () => {
    signIn();
    routes();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    render(<ReferralInvite signedIn />, { wrapper });
    await screen.findByLabelText('Your invite link');
    const verifyAnnouncement = trackAnnouncement('.rw-invite__status');
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const line = await screen.findByText('Link copied.');
    verifyAnnouncement('Link copied.');
    const heard: string[] = [];
    const watch = new MutationObserver(() => heard.push(line.textContent ?? ''));
    watch.observe(line, { childList: true, characterData: true, subtree: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(heard).toEqual(['', 'Link copied.']));
    watch.disconnect();
  });

  it('selects the link when the clipboard refuses', async () => {
    signIn();
    routes();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<ReferralInvite signedIn />, { wrapper });
    const field = (await screen.findByLabelText('Your invite link')) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copying did not work. The link is selected, so copy it from there.')).toBeInTheDocument();
    expect(document.activeElement).toBe(field);
  });

  it('tells an invited learner what finishes the invitation', async () => {
    signIn();
    routes({ summary: { ...SUMMARY, credited: 0, pending: 0, invited: 'pending' } });
    render(<ReferralInvite signedIn />, { wrapper });
    expect(await screen.findByText('A friend invited you. Finish your first Learn level and you both get 100 coins.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Learn' })).toHaveAttribute('href', '/learn');
    expect(screen.queryByText('Signed up, first level still to finish')).toBeNull();
  });

  it('says when the cap is reached and that friends are still paid', async () => {
    signIn();
    routes({ summary: { ...SUMMARY, credited: 20, pending: 0 } });
    render(<ReferralInvite signedIn />, { wrapper });
    expect(await screen.findByText('20 of 20')).toBeInTheDocument();
    expect(screen.getByText('You have reached 20 friends. Friends who join with your link still get their 100 coins.')).toBeInTheDocument();
  });

  it('renders nothing when invitations are off', async () => {
    signIn();
    routes({ summary: { enabled: false } });
    const { container } = render(<ReferralInvite signedIn />, { wrapper });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('asks a signed-out visitor to sign in', () => {
    signOut();
    routes();
    render(<ReferralInvite signedIn={false} />, { wrapper });
    // The money screens' one signed-out block, with a button (UX audit
    // money-05); secondary, as the wallet's Sign in is the page's primary.
    expect(screen.getByText('Your invite link shows here once you sign in.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Sign in' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveClass('secondary');
    expect(screen.queryByLabelText('Your invite link')).toBeNull();
  });

  it('offers a retry when the link cannot load', async () => {
    signIn();
    routes({ summary: { error: { code: 'db_error', message: 'x' } }, status: 500 });
    render(<ReferralInvite signedIn />, { wrapper });
    expect(await screen.findByText('Your invite link could not load.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
