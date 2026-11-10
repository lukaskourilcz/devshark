import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import SharknameCard from '../src/components/SharknameCard';
import LeaderboardVisibilitySwitch from '../src/components/LeaderboardVisibilitySwitch';
import { server } from './mocks/server';
import { clearAccountData } from '../src/lib/accountData';

// Profile owns the leaderboard name and photo controls, in the 'Your name'
// panel beside what friends see (SharknameCard, social-account-04). The board
// only reads the saved preference; tests/leaderboard.test.tsx verifies that
// boundary.
const auth = vi.hoisted(() => ({
  value: { user: { id: 'user-1' } as { id: string } | null, isAuthenticated: true, isLoading: false },
  session: { access_token: 'token-1', user: { id: 'user-1' } },
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));
vi.mock('../src/lib/supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabaseClient')>()),
  mayHaveSession: () => true,
  getSupabaseSession: async () => auth.session,
}));
afterEach(() => {
  auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
  auth.session = { access_token: 'token-1', user: { id: 'user-1' } };
});


function renderWith(node: ReactNode, client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LanguageProvider>{node}</LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SETTING = { mode: 'nickname', nickname: 'sleepySharkie1', accountName: 'Pat Example' };
function serveSetting(mode = 'nickname') {
  server.use(http.get('*/api/user/leaderboard-name', () => HttpResponse.json({ ...SETTING, mode })));
}
function recordPuts(fail = false) {
  const puts: unknown[] = [];
  server.use(http.put('*/api/user/leaderboard-name', async ({ request }) => {
    const body = await request.json() as { mode: string };
    puts.push(body);
    return fail ? HttpResponse.json({ error: { code: 'db_error', message: 'Unavailable' } }, { status: 503 }) : HttpResponse.json({ ...SETTING, ...body });
  }));
  return puts;
}
/** The friends half of the panel: a sharkname and no Google name. */
function serveFriends() {
  const identityPuts: unknown[] = [];
  server.use(
    http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'sleepySharkie1', discoverable: true, country: null, canChangeAt: null })),
    http.get('*/api/user/identity', () => HttpResponse.json({ showRealName: false, showPhoto: false, realName: 'Pat Example', photo: null })),
    http.put('*/api/user/identity', async ({ request }) => {
      identityPuts.push(await request.json());
      return HttpResponse.json({ showRealName: true, showPhoto: false, realName: 'Pat Example', photo: null });
    }),
  );
  return identityPuts;
}
const boardColumn = () => screen.findByRole('radiogroup', { name: /Leaderboards show/ });

describe('independent leaderboard names', () => {
  it('defaults to the sharkname and has no opt-out switch', async () => {
    serveSetting(); renderWith(<LeaderboardVisibilitySwitch />);
    expect(await screen.findByRole('radio', { name: /Sharkname/ })).toBeChecked();
    expect(screen.getByText('Next to your results on every board.')).toBeInTheDocument();
    // The sharkname option does not print the name the field already shows.
    expect(screen.queryByText('sleepySharkie1')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show my photo on leaderboards' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Show my name and photo on leaderboards' })).toBeNull();
  });
  it('saves either name from the Profile panel, beside what friends see and independent of it', async () => {
    serveSetting(); const puts = recordPuts(); const identityPuts = serveFriends();
    renderWith(<SharknameCard />);
    expect(await screen.findByRole('heading', { name: 'Your name' })).toBeInTheDocument();
    const board = await boardColumn();
    const friends = await screen.findByRole('radiogroup', { name: /Friends see/ });
    // Both columns sit in the one panel's column grid.
    expect(board.closest('.sn-columns')).toBe(friends.closest('.sn-columns'));
    const account = within(board).getByRole('radio', { name: /Account name/ });
    await waitFor(() => expect(account).toBeEnabled());
    fireEvent.click(account);
    await waitFor(() => expect(puts).toEqual([{ mode: 'account' }]));
    await waitFor(() => expect(account).toBeChecked());
    // What friends see did not move.
    expect(within(friends).getByRole('radio', { name: /Sharkname/ })).toBeChecked();
    expect(identityPuts).toEqual([]);
    fireEvent.click(within(board).getByRole('radio', { name: /Sharkname/ }));
    await waitFor(() => expect(puts).toEqual([{ mode: 'account' }, { mode: 'nickname' }]));
    await waitFor(() => expect(account).not.toBeChecked());

    // And the friends column saves only its own setting.
    fireEvent.click(within(friends).getByRole('radio', { name: /Account name/ }));
    await waitFor(() => expect(identityPuts).toEqual([{ showRealName: true }]));
    expect(puts).toEqual([{ mode: 'account' }, { mode: 'nickname' }]);
    expect(within(board).getByRole('radio', { name: /Sharkname/ })).toBeChecked();
  });
  it('keeps the stored choice and announces a failed save', async () => {
    serveSetting('account'); const puts = recordPuts(true); renderWith(<LeaderboardVisibilitySwitch />);
    const nickname = await screen.findByRole('radio', { name: /Sharkname/ });
    await waitFor(() => expect(nickname).toBeEnabled()); fireEvent.click(nickname);
    expect(await screen.findByRole('alert')).toHaveTextContent('Your leaderboard setting wasn’t saved. Try again.');
    expect(puts).toEqual([{ mode: 'nickname' }]);
    expect(screen.getByRole('radio', { name: /Account name/ })).toBeChecked();
  });
  it('offers a retry when loading fails and disables an unavailable account name', async () => {
    let fail = true;
    server.use(http.get('*/api/user/leaderboard-name', () => fail ? HttpResponse.json({ error: { code: 'db_error', message: 'Unavailable' } }, { status: 503 }) : HttpResponse.json({ ...SETTING, accountName: null })));
    renderWith(<LeaderboardVisibilitySwitch />);
    const alert = await screen.findByRole('alert'); fail = false;
    fireEvent.click(within(alert).getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('radio', { name: /Account name/ })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Sharkname/ })).toBeChecked();
  });

  it('never uses a replacement session for a queued setting change', async () => {
    serveSetting();
    const puts = recordPuts();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const cancel = vi.spyOn(client, 'cancelQueries').mockReturnValueOnce(gate);
    renderWith(<LeaderboardVisibilitySwitch />, client);
    const account = await screen.findByRole('radio', { name: /Account name/ });
    await waitFor(() => expect(account).toBeEnabled());
    fireEvent.click(account);
    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    // The stored session changed but the Auth event has not reached the UI.
    auth.session = { access_token: 'token-2', user: { id: 'user-2' } };
    await act(async () => { release(); });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(puts).toEqual([]);
  });

  it('does not restore the old private setting after an account change clears it', async () => {
    let gets = 0;
    server.use(http.get('*/api/user/leaderboard-name', () => {
      gets += 1;
      return HttpResponse.json(gets === 1 ? SETTING : { ...SETTING, nickname: 'otherShark2', accountName: 'Other Person' });
    }));
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const sent: Array<string | null> = [];
    server.use(http.put('*/api/user/leaderboard-name', async ({ request }) => {
      sent.push(request.headers.get('authorization'));
      await gate;
      return HttpResponse.json({ ...SETTING, mode: 'account' });
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
    const tree = () => (
      <QueryClientProvider client={client}><MemoryRouter><LanguageProvider><LeaderboardVisibilitySwitch /></LanguageProvider></MemoryRouter></QueryClientProvider>
    );
    const view = render(tree());
    const account = await screen.findByRole('radio', { name: /Account name/ });
    await waitFor(() => expect(account).toBeEnabled());
    fireEvent.click(account);
    await waitFor(() => expect(sent).toEqual(['Bearer token-1']));
    const save = client.getMutationCache().getAll()[0];
    clearAccountData();
    client.clear();
    auth.value = { user: { id: 'user-2' }, isAuthenticated: true, isLoading: false };
    auth.session = { access_token: 'token-2', user: { id: 'user-2' } };
    view.rerender(tree());
    expect(await screen.findByText('Other Person')).toBeInTheDocument();
    await act(async () => { release(); });
    await waitFor(() => expect(save.state.status).toBe('success'));
    expect(screen.getByText('Other Person')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Sharkname/ })).toBeChecked();
    expect(client.getQueryData(['leaderboard-name', 'user-1'])).toBeUndefined();
  });

});
