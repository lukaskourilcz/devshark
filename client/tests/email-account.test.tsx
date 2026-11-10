// An account made with an email and password has no name and no picture from
// Google (owner decision 3). The Profile, Friends and the boards draw it
// without either: the Profile heading falls back to the address's first
// part, the boards say "Learner" even with the name switch on, and the
// address never reaches a board.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { getUserProfile } from '../src/lib/auth';
import Profile from '../src/components/Profile';
import Leaderboard from '../src/components/Leaderboard';
import { PlayLanding } from '../src/components/Play';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import { server } from './mocks/server';
import { emailUser } from './mocks/gotrue';
import { leaderboardHandlers, settingsHandler, visibilityHandler } from './mocks/handlers';

const USER = emailUser({ email: 'ada.lovelace@example.com' });
const auth = vi.hoisted(() => ({ value: { user: null as unknown, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ ...auth.value, signOut: async () => undefined, signInResumeFailed: false, passwordRecovery: false }),
}));
afterEach(() => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; });

// What the API answers this account, in the handlers' own shapes. The stats
// row has no name and no picture: `verifiedProfile` in api/user/[op].ts reads
// them from a Google identity, and this account has none.
const STATS = {
  id: 'stats-1', user_id: USER.id, email: USER.email, name: null, picture: null,
  total_quizzes: 3, total_correct: 21, total_questions: 30, current_streak: 2, longest_streak: 4,
  last_quiz_date: '2026-09-30', created_at: '2026-09-28T10:00:00Z', updated_at: '2026-09-30T10:00:00Z',
};
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const NOT_CONNECTED = { available: true, status: 'not_connected', accountLogin: null, repoFullName: null, defaultBranch: null, lastCommitAt: null, queued: 0, lastError: null };
// A friend as friend_list returns them since migration 055: by the name they
// chose for friends, their sharkname here.
const FRIENDS = {
  friends: [{ handle: 'gracias-sharkie', displayName: 'gracias-sharkie', picture: null, country: 'GB', crown: false, currentStreak: 5, longestStreak: 9, totalCorrect: 140, totalQuestions: 180, accuracyPct: 78, activeToday: true }],
  requests: [],
};

function serveAccount(visible: boolean) {
  server.use(
    settingsHandler,
    http.get('*/api/user/leaderboard-name', () => HttpResponse.json({mode:visible?'account':'nickname',nickname:'elTiburonLoco1',accountName:'ada.lovelace',showPhoto:false,photo:null})),
    visibilityHandler(visible),
    http.get('*/api/user/stats', () => HttpResponse.json({ data: STATS })),
    http.get('*/api/user/xp', () => HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } })),
    http.get('*/api/user/freezes', () => HttpResponse.json({
      remaining: 2, period: '2026-10', used: [], shieldUntil: null, shieldDays: [], shieldSupported: true,
    })),
    http.get('*/api/user/advisor', () => HttpResponse.json({ weakAreas: [], suggestedWeek: [], generatedAt: '2026-10-01T09:00:00Z' })),
    http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'el-tiburon-loco', discoverable: true, country: null, canChangeAt: null })),
    // op=identity: no Google name or photo to offer friends.
    http.get('*/api/user/identity', () => HttpResponse.json({ showRealName: false, showPhoto: false, realName: null, photo: null })),
    http.get('*/api/user/friends-list', () => HttpResponse.json(FRIENDS)),
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'progress') return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      return undefined;
    }),
    http.get('*/api/user/*', ({ request }) => {
      const op = new URL(request.url).searchParams.get('op');
      if (op === 'entitlement') return HttpResponse.json(FREE);
      if (op === 'github-connection') return HttpResponse.json(NOT_CONNECTED);
      if (op === 'learning-path-enrollment') return HttpResponse.json({ enrollments: [] });
      return undefined;
    }),
  );
}

let visits = 0;
function mount(path: string, node: ReactNode) {
  auth.value = { user: USER, isAuthenticated: true, isLoading: false };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: path, key: `visit-${++visits}` }]}>
        <LanguageProvider>{node}</LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}

describe('an account made with an email and password', () => {
  it('has no name or picture to show', () => {
    expect(getUserProfile(USER as never)).toEqual({ name: undefined, email: 'ada.lovelace@example.com', picture: undefined });
  });

  it('gets a Profile heading from the address, and its Friends tab draws', async () => {
    serveAccount(false);
    await mount('/profile', <Profile />);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('ada.lovelace');
    expect(screen.getByText('ada.lovelace@example.com')).toBeInTheDocument();
    // No picture: the avatar draws the initial instead of an image.
    expect(document.querySelector('img[src*="googleusercontent"]')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Friends' }));
    // A friend's row names them by the name they chose: a sharkname here.
    expect(await screen.findByText('gracias-sharkie')).toBeInTheDocument();
    // The learner's own sharkname, which friends see, is on the Overview.
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect((await screen.findAllByText('el-tiburon-loco')).length).toBeGreaterThan(0);
  });

  it('moves between the Profile tabs with the arrow keys, from one Tab stop', async () => {
    serveAccount(false);
    await mount('/profile', <Profile />);
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    const friends = screen.getByRole('tab', { name: 'Friends' });
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(friends).toHaveAttribute('tabindex', '-1');
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(friends).toHaveAttribute('aria-selected', 'true');
    expect(friends).toHaveFocus();
    expect(await screen.findByText('gracias-sharkie')).toBeInTheDocument();
    fireEvent.keyDown(friends, { key: 'Home' });
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveAttribute('tabindex', '0');
    expect(friends).toHaveAttribute('tabindex', '-1');
  });

  it('starts the cards’ reads with the stats read instead of after it', async () => {
    serveAccount(false);
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    const asked: string[] = [];
    server.use(
      http.get('*/api/user/stats', async () => { await gate; return HttpResponse.json({ data: STATS }); }),
      http.get('*/api/user/freezes', () => {
        asked.push('freezes');
        return HttpResponse.json({ remaining: 2, period: '2026-10', used: [], shieldUntil: null, shieldDays: [], shieldSupported: true });
      }),
      http.get('*/api/user/advisor', () => {
        asked.push('advisor');
        return HttpResponse.json({ weakAreas: [], suggestedWeek: [], generatedAt: '2026-10-01T09:00:00Z' });
      }),
    );
    await mount('/profile', <Profile />);
    await waitFor(() => expect([...asked].sort()).toEqual(['advisor', 'freezes']));
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('ada.lovelace');
    await new Promise((done) => setTimeout(done, 50));
    // The cards took the reads already made.
    expect([...asked].sort()).toEqual(['advisor', 'freezes']);
  });

  it.each([
    ['a service outage', () => HttpResponse.json({ error: { code: 'upstream_timeout' } }, { status: 503 }), /Server error/],
    ['an offline request', () => HttpResponse.error(), /Check your connection/],
  ] as const)('offers a study advisor retry after %s', async (_scenario, fail, message) => {
    serveAccount(false);
    let releaseStats!: () => void;
    const statsGate = new Promise<void>((done) => { releaseStats = done; });
    let reads = 0;
    server.use(
      http.get('*/api/user/stats', async () => { await statsGate; return HttpResponse.json({ data: STATS }); }),
      http.get('*/api/user/advisor', () => ++reads === 1
        ? fail()
        : HttpResponse.json({ weakAreas: [], suggestedWeek: [], generatedAt: '2026-10-01T09:00:00Z' })),
    );
    await mount('/profile', <Profile />);
    await waitFor(() => expect(reads).toBe(1));
    await act(async () => { releaseStats(); });

    const heading = await screen.findByRole('heading', { name: 'Study advisor' });
    const card = heading.closest<HTMLElement>('.ss-panel')!;
    expect(await within(card).findByRole('alert')).toHaveTextContent(message);
    expect(within(card).queryByText('Not enough data yet')).not.toBeInTheDocument();
    const retry = within(card).getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);

    expect(await within(card).findByText('Not enough data yet')).toBeVisible();
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(reads).toBe(2);
  });

  it('uses the server-confirmed account name on the boards without publishing the full email or photo', async () => {
    serveAccount(true);
    server.use(leaderboardHandlers.pinned);
    await mount('/leaderboard', <Leaderboard />);
    const pinned = (await screen.findByRole('table')).querySelector('tfoot tr') as HTMLElement;
    expect(within(pinned).getByText('ada.lovelace')).toBeVisible();
    expect(within(pinned).getByText('You')).toBeVisible();
    expect(pinned.querySelector('img')).toBeNull();
    expect(document.body).not.toHaveTextContent(/@example\.com/);
  });

  // A live room names its players on the server (lib/public-identity.ts):
  // this account's sharkname, or "Player" and a number. The client used to
  // send the part of the address before the @, and anyone with the code saw it.
  it('opens and joins a live room without sending any part of its address', async () => {
    serveAccount(false);
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    server.use(
      http.post('*/api/play/create', async ({ request }) => {
        sent.push({ path: 'create', body: await request.json() as Record<string, unknown> });
        return HttpResponse.json({ id: 'm1', code: 'ABC123', mode: 'multiplayer', host_id: USER.id, host_name: 'el-tiburon-loco', status: 'lobby' });
      }),
      http.post('*/api/play/join', async ({ request }) => {
        sent.push({ path: 'join', body: await request.json() as Record<string, unknown> });
        return HttpResponse.json({ id: 'm2', code: 'XYZ789', mode: 'multiplayer', host_id: 'host-1', host_name: 'Grace Hopper', status: 'lobby', current_index: 0, questions: [] });
      }),
    );
    auth.value = { user: USER, isAuthenticated: true, isLoading: false };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, multiplayer: true } });
    const view = () => render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/play']}>
          <LanguageProvider>
            <Routes>
              <Route path="/play" element={<PlayLanding />} />
              <Route path="*" element={<p>in the room</p>} />
            </Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const first = view();
    fireEvent.click(await screen.findByRole('button', { name: 'Create multiplayer match' }));
    expect(await screen.findByText('in the room')).toBeInTheDocument();
    first.unmount();
    view();
    fireEvent.change(await screen.findByLabelText('Match code'), { target: { value: 'xyz789' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join →' }));
    expect(await screen.findByText('in the room')).toBeInTheDocument();

    expect(sent.map((one) => one.path)).toEqual(['create', 'join']);
    expect(sent[0].body).not.toHaveProperty('host_name');
    expect(sent[1].body).toEqual({ code: 'XYZ789', user_id: USER.id });
    expect(JSON.stringify(sent)).not.toMatch(/ada\.lovelace|@example\.com/);
  });
});
