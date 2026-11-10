import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Leaderboard from '../src/components/Leaderboard';
import { server } from './mocks/server';
import { boardFor, leaderboardData, leaderboardHandlers, monthData, noActivityData, pinnedData, visibilityHandler } from './mocks/handlers';
import { firstDraw, stretchFirstDataWait } from './firstDraw';

type TestUser = { id: string; user_metadata?: Record<string, unknown> };
const auth = vi.hoisted(() => ({
  value: { user: null as TestUser | null, isAuthenticated: false, isLoading: false },
  replacement: null as TestUser | null,
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));
vi.mock('../src/lib/supabaseClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/supabaseClient')>()),
  mayHaveSession: () => !!auth.value.user,
  getSupabaseSession: async () => {
    const user = auth.replacement ?? auth.value.user;
    return user && { access_token: `board-token-${user.id}`, user };
  },
}));
afterEach(() => {
  auth.value = { user: null, isAuthenticated: false, isLoading: false };
  auth.replacement = null;
});

// The screen holds its first render for the default board (lib/routeData.ts);
// a render that suspends has to start inside an awaited act. Each mount is a
// visit of its own, with a key that stays put while the held render is
// retried, so each holds as a first visit does.
//
// The hold fetches the board into the cache before the screen observes it.
// With gcTime 0 the cache could drop that unobserved board on a timer that
// raced React's retried render; on a loaded machine the timer won, the screen
// drew without its board and asked for it again. The app keeps unobserved
// data for five minutes (lib/queryClient.ts), so here it is never dropped:
// each test has a client of its own.
let visits = 0;
async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = `visit-${++visits}`;
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/leaderboard', key }]}>
        <LanguageProvider><Leaderboard /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = await act(async () => render(tree()));
  return {
    ...view,
    replaceAccount: () => act(async () => {
      client.clear();
      view.rerender(tree());
    }),
  };
}

const last = <T,>(items: T[]): T => items[items.length - 1];

/** Records every leaderboard request's query string, answering with the
 * populated fixtures and an empty daily board. */
function recordRequests(): URLSearchParams[] {
  const seen: URLSearchParams[] = [];
  server.use(http.get('*/api/leaderboard', ({ request }) => {
    const params = new URL(request.url).searchParams;
    seen.push(params);
    const board = boardFor(request);
    return HttpResponse.json(params.get('period') === 'daily' ? { ...board, entries: [] } : board);
  }));
  return seen;
}

it('opens on the 30-day board and says what it counts', async () => {
  const seen = recordRequests(); await mount();
  expect(await screen.findByText('Workshop learner')).toBeVisible();
  expect(seen[0].get('period')).toBe('30d');
  expect(seen[0].get('category')).toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'Leaderboard' })).toBeVisible();
  expect(screen.getByText(/Learn answers from the last 30 days. Five answers put you on the board./)).toBeVisible();
  // The multi-subject pill is gone.
  expect(screen.queryByText('Web Dev')).toBeNull();
  // A visitor has no name to show or hide, and nothing asks for one.
  expect(screen.queryByRole('switch')).toBeNull();
});

it('says what the board ranks under the h1 and puts the controls right on the table (social-account-09)', async () => {
  recordRequests(); await mount();
  await screen.findByText('Workshop learner');
  const head = screen.getByRole('heading', { level: 1, name: 'Leaderboard' }).closest('header')!;
  expect(within(head).getByText(/Five answers put you on the board./)).toBeVisible();
  // One control row: the period control and nothing in between it and the board.
  const controls = document.querySelector('.lb-controls')!;
  expect(controls.querySelector('.ss-page-header__lead')).toBeNull();
  expect(controls.nextElementSibling).toHaveClass('lb-board');
});

it('draws the default board in its first frame instead of a skeleton the board replaces', async () => {
  const restore = stretchFirstDataWait();
  const seen = recordRequests();
  const drawn = firstDraw('h1', () => ({
    skeleton: document.querySelector('.lb-skeleton') !== null,
    board: screen.queryByText('Workshop learner') !== null,
  }));
  await mount();
  expect(drawn()).toEqual({ skeleton: false, board: true });
  // The hold and the screen share one key, so the board is asked for once.
  expect(seen).toHaveLength(1);
  restore();
});

it('holds a signed-in learner for the board that carries their own line', async () => {
  const restore = stretchFirstDataWait();
  auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
  const seen: URLSearchParams[] = [];
  server.use(http.get('*/api/leaderboard', ({ request }) => {
    seen.push(new URL(request.url).searchParams);
    return HttpResponse.json(pinnedData);
  }), visibilityHandler());
  const drawn = firstDraw('h1', () => document.querySelector('tfoot tr[aria-current="true"]') !== null);
  await mount();
  expect(drawn()).toBe(true);
  expect(seen).toHaveLength(1);
  expect(seen[0].get('period')).toBe('30d');
  expect(seen[0].get('me')).toBe('1');
  restore();
});

it('draws every rank as a number, with a heavier disc for the top three', async () => {
  server.use(leaderboardHandlers.populated); await mount();
  const table = await screen.findByRole('table');
  const [first, second] = within(table).getAllByRole('row').slice(1);
  expect(within(first).getByText('1')).toHaveClass('lb-rank', 'lb-rank--top');
  expect(within(second).getByText('2')).toHaveClass('lb-rank--top');
  expect(within(first).getByText('80%')).toBeVisible();
});

it('asks for the new day\'s Today board once 00:00 UTC has passed, not the day the screen opened on', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-23T23:59:30Z'));
    const seen = recordRequests(); await mount();
    await screen.findByText('Workshop learner');
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await waitFor(() => expect(last(seen).get('period')).toBe('daily'));
    expect(last(seen).get('date')).toBe('2026-10-23');
    vi.setSystemTime(new Date('2026-10-24T00:00:30Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(last(seen).get('date')).toBe('2026-10-24'));
    expect(last(seen).get('period')).toBe('daily');
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the all-time board one click away, and filters it by topic', async () => {
  const seen = recordRequests(); await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
  expect(await screen.findByText('Long-time learner')).toBeVisible();
  expect(last(seen).get('period')).toBe('global');
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'css' } });
  await waitFor(() => expect(last(seen).get('period')).toBe('category'));
  expect(last(seen).get('category')).toBe('css');
});

it('filters the 30-day board by topic and hides the filter on Today', async () => {
  const seen = recordRequests(); await mount();
  await screen.findByText('Workshop learner');
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'html' } });
  await waitFor(() => expect(last(seen).get('category')).toBe('html'));
  expect(last(seen).get('period')).toBe('30d');
  fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
  expect(await screen.findByText(/finished today’s daily challenge/)).toBeVisible();
  expect(last(seen).get('period')).toBe('daily');
  expect(screen.queryByLabelText('Topic')).toBeNull();
});

it('pins the learner’s own line below the list when they are outside the top', async () => {
  server.use(leaderboardHandlers.pinned); await mount();
  const table = await screen.findByRole('table');
  const pinned = table.querySelector('tfoot tr');
  expect(pinned).not.toBeNull();
  expect(pinned).toHaveAttribute('aria-current', 'true');
  expect(within(pinned as HTMLElement).getByText('14')).toBeVisible();
  expect(within(pinned as HTMLElement).getAllByText('You').length).toBeGreaterThan(0);
});

it('tells a signed-in learner with no answers in the window how to appear', async () => {
  server.use(leaderboardHandlers.noActivity); await mount();
  expect(await screen.findByText('You need five answers to appear here.')).toBeVisible();
});

it('shows an empty board with a real practice action', async () => {
  server.use(leaderboardHandlers.empty); await mount();
  expect(await screen.findByRole('button', { name: /quiz|practice/i })).toBeVisible();
  expect(screen.getByText('Nobody has answered a question in the last 30 days yet.')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('recovers the actual leaderboard from a server failure through Retry', async () => {
  server.use(leaderboardHandlers.error); await mount();
  expect(await screen.findByRole('alert')).toBeVisible();
  server.use(leaderboardHandlers.populated);
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(await screen.findByText('Workshop learner')).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('shows the last board it loaded, marked stale, when offline', async () => {
  server.use(leaderboardHandlers.populated);
  const first = await mount();
  await screen.findByText('Workshop learner');
  first.unmount();
  server.use(leaderboardHandlers.offline); await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/offline\. This is the board as it was at/);
  expect(screen.getByText('Workshop learner')).toBeVisible();
});

it('shows the cached board when the browser already reports no connection', async () => {
  server.use(leaderboardHandlers.populated);
  const first = await mount();
  await screen.findByText('Workshop learner');
  first.unmount();
  onlineManager.setOnline(false);
  try {
    await mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(/This is the board as it was at/);
    expect(screen.getByText('Workshop learner')).toBeVisible();
  } finally {
    onlineManager.setOnline(true);
  }
});

it('does not show the previous tab’s board under a tab picked while offline', async () => {
  server.use(leaderboardHandlers.populated); await mount();
  await screen.findByText('Workshop learner');
  onlineManager.setOnline(false);
  try {
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/You’re offline. Reconnect and try again./);
    expect(screen.queryByText('Workshop learner')).toBeNull();
  } finally {
    onlineManager.setOnline(true);
  }
});

it('does not show yesterday’s Daily scores as today’s when midnight passes offline', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-23T23:59:30Z'));
    server.use(leaderboardHandlers.populated);
    await mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
    await screen.findByText('Early riser');
    expect(localStorage.getItem('devshark:leaderboard:v1:daily:')).toContain('2026-10-23');
    onlineManager.setOnline(false);
    vi.setSystemTime(new Date('2026-10-24T00:00:30Z'));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByRole('alert')).toHaveTextContent(/You’re offline. Reconnect and try again./);
    expect(screen.queryByText('Early riser')).toBeNull();
  } finally {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  }
});

it('says so when offline with nothing cached', async () => {
  server.use(leaderboardHandlers.offline); await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/You’re offline. Reconnect and try again./);
});

it('falls back to the all-time board until the 30-day board exists', async () => {
  server.use(leaderboardHandlers.windowMissing); await mount();
  expect(await screen.findByText('Long-time learner')).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('The 30-day board isn’t switched on yet');
});

/** Answers the 30-day board with the usual fixture and every other board with `entries`. */
function otherBoard(period: string, entries: object[]) {
  server.use(http.get('*/api/leaderboard', ({ request }) =>
    new URL(request.url).searchParams.get('period') === '30d'
      ? HttpResponse.json(leaderboardData)
      : HttpResponse.json({ period, entries })));
}
const drawnRanks = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
  .map((row) => row.querySelector('.lb-rank')?.textContent);

it('gives equal results on the all-time board one shared rank', async () => {
  otherBoard('global', [
    { display_name: 'Tied first', picture: null, total_correct: 40, total_questions: 50, accuracy_pct: 80 },
    { display_name: 'Tied second', picture: null, total_correct: 40, total_questions: 50, accuracy_pct: 80 },
    { display_name: 'Fewer answers', picture: null, total_correct: 30, total_questions: 31, accuracy_pct: 97 },
    { display_name: 'More answers', picture: null, total_correct: 30, total_questions: 60, accuracy_pct: 50 },
  ]);
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
  await screen.findByText('Tied first');
  expect(drawnRanks()).toEqual(['1', '1', '3', '4']);
});

it('ranks Today by score alone: equal scores share a rank whatever the time', async () => {
  // In the order daily_leaderboard_v2 sends them: score, then first recorded.
  otherBoard('daily', [
    { display_name: 'Slow and early', picture: null, correct: 5, total: 5, duration_ms: 300_000, attempted_at: '2026-09-29T07:00:00Z' },
    { display_name: 'Quick', picture: null, correct: 5, total: 5, duration_ms: 60_000, attempted_at: '2026-09-29T08:00:00Z' },
    { display_name: null, picture: null, correct: 5, total: 5, duration_ms: 30_000, attempted_at: '2026-09-29T09:00:00Z' },
    { display_name: 'Four right, fastest', picture: null, correct: 4, total: 5, duration_ms: 10_000, attempted_at: '2026-09-29T10:00:00Z' },
  ]);
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'Today' }));
  await screen.findByText('Slow and early');
  expect(drawnRanks()).toEqual(['1', '1', '1', '4']);
  // The time is still shown; the copy no longer says it decides.
  expect(screen.getByText('5m 0s')).toBeVisible();
  expect(screen.getByText('Today’s daily challenge, ranked by correct answers. Equal scores share a place, whatever the time.')).toBeVisible();
  expect(screen.queryByText(/faster/i)).toBeNull();
  // The unnamed learner is on the board as “Learner”.
  const third = within(screen.getByRole('table')).getAllByRole('row')[3];
  expect(within(third).getByText('Learner')).toBeVisible();
});

it('never shows the next visitor someone else’s row as theirs from the offline copy', async () => {
  auth.value = { user: { id: 'user-a' }, isAuthenticated: true, isLoading: false };
  const mine = { ...leaderboardData, entries: [{ ...leaderboardData.entries[0], is_viewer: true }, leaderboardData.entries[1]], me: null };
  server.use(http.get('*/api/leaderboard', () => HttpResponse.json(mine)), visibilityHandler());
  const first = await mount();
  expect(await screen.findByText('Workshop learner')).toBeVisible();
  expect(document.querySelector('tr[aria-current="true"]')).not.toBeNull();
  first.unmount();

  // Signed out, offline, on the same device.
  auth.value = { user: null, isAuthenticated: false, isLoading: false };
  server.use(leaderboardHandlers.offline); await mount();
  expect(await screen.findByRole('alert')).toHaveTextContent(/This is the board as it was at/);
  expect(screen.getByText('Workshop learner')).toBeVisible();
  expect(document.querySelector('[aria-current="true"]')).toBeNull();
  expect(screen.queryByText('You')).toBeNull();
});

it('does not fetch a private board with a replacement session before its Auth event', async () => {
  auth.value = { user: { id: 'user-a' }, isAuthenticated: true, isLoading: false };
  const seen = recordRequests();
  server.use(visibilityHandler());
  await mount();
  expect(await screen.findByText('Workshop learner')).toBeVisible();

  auth.replacement = { id: 'user-b' };
  fireEvent.change(screen.getByLabelText('Topic'), { target: { value: 'html' } });
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(seen).toHaveLength(1);
});

it('does not show the old personal board while the next account’s board is loading', async () => {
  auth.value = { user: { id: 'user-a' }, isAuthenticated: true, isLoading: false };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let reads = 0;
  server.use(http.get('*/api/leaderboard', async () => {
    reads += 1;
    if (reads === 1) return HttpResponse.json(pinnedData);
    await gate;
    return HttpResponse.json(noActivityData);
  }), visibilityHandler());
  const board = await mount();
  expect(await screen.findByText('14')).toBeVisible();

  try {
    auth.value = { user: { id: 'user-b' }, isAuthenticated: true, isLoading: false };
    await board.replaceAccount();
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.queryByText('14')).toBeNull();
    expect(document.querySelector('tfoot tr[aria-current="true"]')).toBeNull();
  } finally {
    await act(async () => { release(); });
  }
  expect(await screen.findByText('You need five answers to appear here.')).toBeVisible();
});

it('drops the “You” mark from an offline copy an older version saved', async () => {
  const saved = { ...leaderboardData, entries: [{ ...leaderboardData.entries[0], is_viewer: true }] };
  localStorage.setItem('devshark:leaderboard:v1:30d:', JSON.stringify({ savedAt: Date.now(), data: saved }));
  server.use(leaderboardHandlers.offline); await mount();
  expect(await screen.findByText('Workshop learner')).toBeVisible();
  expect(document.querySelector('[aria-current="true"]')).toBeNull();
});

// ── Names selected in Profile, displayed on the public boards ───────────────

const PAT = { id: 'user-1', user_metadata: { full_name: 'Pat Example' } };

it('shows a learner who has not switched their name on as “Learner”, with the default avatar', async () => {
  server.use(http.get('*/api/leaderboard', () => HttpResponse.json({
    ...leaderboardData,
    entries: [{ ...leaderboardData.entries[0], display_name: null, picture: null }, leaderboardData.entries[1]],
  })));
  await mount();
  const table = await screen.findByRole('table');
  await within(table).findByText('Harbour reader');
  const [unnamed, named] = within(table).getAllByRole('row').slice(1);
  expect(within(unnamed).getByText('Learner')).toBeVisible();
  // The default avatar, not initials: no "L" for "Learner", no named image.
  expect(within(unnamed).queryByRole('img')).toBeNull();
  expect(within(unnamed).queryByText('L')).toBeNull();
  expect(within(named).getByRole('img', { name: 'Harbour reader' })).toBeInTheDocument();
});

it('uses the Profile preference for the pinned line without offering edits on the board', async () => {
  auth.value = { user: PAT, isAuthenticated: true, isLoading: false };
  const puts: unknown[] = [];
  server.use(leaderboardHandlers.pinned, visibilityHandler(false),
    http.put('*/api/user/leaderboard-name', async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json({ mode: 'account', nickname: 'sleepySharkie1', accountName: 'Pat Example' });
    }),
  );
  const nicknameBoard = await mount();
  const pinned = (await screen.findByRole('table')).querySelector('tfoot tr') as HTMLElement;
  expect(within(pinned).getByText('sleepySharkie1')).toBeVisible();
  expect(within(pinned).getByText('You')).toBeVisible();
  expect(screen.queryByRole('radio', { name: /Account name|Sharkname/ })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  nicknameBoard.unmount();

  // Returning from Profile reads the stored account-name preference.
  server.use(visibilityHandler(true));
  await mount();
  const account = (await screen.findByRole('table')).querySelector('tfoot tr') as HTMLElement;
  expect(within(account).getByText('Pat Example')).toBeVisible();
  expect(within(account).getByText('You')).toBeVisible();
  expect(screen.queryByRole('radio', { name: /Account name|Sharkname/ })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(puts).toEqual([]);
});

it('keeps the board available when the Profile name preference cannot load', async () => {
  auth.value = { user: PAT, isAuthenticated: true, isLoading: false };
  server.use(leaderboardHandlers.populated,
    http.get('*/api/user/leaderboard-name', () => HttpResponse.json({ error: { code: 'db_error', message: 'Unavailable' } }, { status: 503 })),
  );
  await mount();
  expect(await screen.findByText('Workshop learner')).toBeVisible();
  expect(screen.queryByRole('radio', { name: /Account name|Sharkname/ })).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
});

// ── This month (migration 056) ──────────────────────────────────────────────
//
// The XP earned in the current calendar month, the board the month's top
// three are paid from. The server ranks it and equal XP shares a rank.

/** Answers the 30-day board with the usual fixture and the month board with `month`. */
function monthBoard(month: object, seen: URLSearchParams[] = []) {
  server.use(http.get('*/api/leaderboard', ({ request }) => {
    const params = new URL(request.url).searchParams;
    seen.push(params);
    return HttpResponse.json(params.get('period') === 'month' ? month : boardFor(request));
  }));
  return seen;
}

it('ranks this month by XP, shows tied ranks as shared and says what it counts', async () => {
  const seen = monthBoard(monthData);
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
  await screen.findByText('Night owl');
  expect(last(seen).get('period')).toBe('month');
  expect(last(seen).get('categories')).toBeTruthy();
  expect(last(seen).get('me')).toBeNull();
  expect(drawnRanks()).toEqual(['1', '1', '3']);
  // One figure, the XP, under one header.
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Rank', 'Learner', 'XP']);
  expect(within(within(table).getAllByRole('row')[1]).getByText('1,240')).toBeVisible();
  // A learner who has not switched their name on is “Learner”.
  expect(within(within(table).getAllByRole('row')[3]).getByText('Learner')).toBeVisible();
  expect(screen.getByText(/Ranked by the XP earned this calendar month \(UTC\)/)).toBeVisible();
  expect(screen.getByText(/Equal XP shares a place\./)).toBeVisible();
  // XP is not counted per topic.
  expect(screen.queryByLabelText('Topic')).toBeNull();
});

it('opens on this month from ?tab=month', async () => {
  const seen = monthBoard(monthData);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/leaderboard', search: '?tab=month', key: `visit-${++visits}` }]}>
        <LanguageProvider><Leaderboard /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  expect(await screen.findByText('Night owl')).toBeVisible();
  expect(screen.getByRole('radio', { name: 'This month' })).toBeChecked();
  expect(last(seen).get('period')).toBe('month');
});

it('pins the learner’s own month line, with their XP, below the list', async () => {
  auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
  const seen = monthBoard({ ...monthData, me: { rank: 12, xp: 340 } });
  server.use(visibilityHandler(false));
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
  await screen.findByText('Night owl');
  expect(last(seen).get('me')).toBe('1');
  const pinned = screen.getByRole('table').querySelector('tfoot tr') as HTMLElement;
  expect(pinned).toHaveAttribute('aria-current', 'true');
  expect(within(pinned).getByText('12')).toBeVisible();
  expect(within(pinned).getByText('340')).toBeVisible();
  expect(within(pinned).getByText('You')).toBeVisible();
  expect(within(pinned).getByText('sleepySharkie1')).toBeVisible();
});

it('tells a signed-in learner with no XP this month how to appear', async () => {
  auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
  monthBoard({ ...monthData, me: { rank: null, xp: 0 } });
  server.use(visibilityHandler(false));
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
  expect(await screen.findByText('Earn XP this month to appear here.')).toBeVisible();
});

it('shows an empty month with a way to start earning', async () => {
  monthBoard({ ...monthData, entries: [] });
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
  expect(await screen.findByText('Nobody has earned XP this month yet.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Start a quiz' })).toBeVisible();
});

it('recovers this month’s board from a failure through Retry', async () => {
  let fail = true;
  server.use(http.get('*/api/leaderboard', ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (params.get('period') !== 'month') return HttpResponse.json(boardFor(request));
    return fail
      ? HttpResponse.json({ error: { code: 'db_error', message: 'Could not load leaderboard' } }, { status: 500 })
      : HttpResponse.json(monthData);
  }));
  await mount();
  await screen.findByText('Workshop learner');
  fireEvent.click(screen.getByRole('radio', { name: 'This month' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: /retry/i }));
  expect(await screen.findByText('Night owl')).toBeVisible();
});

it('fits four periods on a narrow phone: the small control with short labels', async () => {
  const wide = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: /max-width/.test(query), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  })) as typeof window.matchMedia;
  try {
    server.use(leaderboardHandlers.populated);
    await mount();
    await screen.findAllByText('Workshop learner');
    expect(screen.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['30 days', 'Month', 'All time', 'Today']);
    // The small control (smaller type and padding) so the four fit at 320px.
    expect(document.querySelector('.astryx-segmented-control[data-size="sm"]')).not.toBeNull();
  } finally {
    window.matchMedia = wide;
  }
});
