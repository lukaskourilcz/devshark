import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ApiError } from '../src/lib/api';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import type { Match, ScoreboardEntry } from '../src/lib/play';
import { readFileSync } from 'node:fs';
import { addSheet } from './css';

// A live room as one player sees it, with the play API and the Realtime
// channel replaced by stand-ins the test drives.

const api = vi.hoisted(() => ({
  joinMatch: vi.fn(),
  fetchMatchState: vi.fn(),
  submitMatchAnswer: vi.fn(),
  sendHeartbeat: vi.fn(async () => ({ ok: true })),
  createMatch: vi.fn(),
  fetchDistribution: vi.fn(),
  controlMatch: vi.fn(),
}));
vi.mock('../src/lib/play', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/play')>(),
  ...api,
}));
const USER = { id: 'player-1', user_metadata: {} };
// A session refresh hands the screen a new object for the same account.
let currentUser = USER;
vi.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: currentUser, isAuthenticated: true, isLoading: false, signInWithGoogle: vi.fn() }),
  getUserProfile: () => ({}),
  displayNameFromProfile: (_profile: unknown, fallback: string) => fallback,
}));
const live = vi.hoisted(() => ({
  listeners: new Map<string, (payload?: unknown) => void>(),
  sent: [] as Array<{ event: string; payload: unknown }>,
}));
vi.mock('../src/lib/realtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/realtime')>(),
  joinMatchChannel: () => ({
    send: async (event: string, payload: unknown) => { live.sent.push({ event, payload }); },
    subscribe: (event: string, fn: (payload?: unknown) => void) => {
      live.listeners.set(event, fn);
      return () => undefined;
    },
    // Realtime is connected for the whole test.
    onStatus: (fn: (status: string) => void) => {
      fn('SUBSCRIBED');
      return () => undefined;
    },
    unsubscribe: () => undefined,
  }),
}));

const { PlayMatch, PlayLanding } = await import('../src/components/Play');

const QUESTIONS = [
  { id: 'q0', question: 'Pick one?', options: ['alpha', 'beta'], category: 'javascript', difficulty: 1 },
  { id: 'q1', question: 'Next one?', options: ['gamma', 'delta'], category: 'javascript', difficulty: 1 },
];
const running = (over: Partial<Match> = {}): Match => ({
  id: 'm1', code: 'ABC123', mode: 'multiplayer', host_id: 'host-1', host_name: 'Hana', status: 'running',
  current_index: 0, questions: QUESTIONS, question_started_at: new Date().toISOString(), question_duration_s: 0,
  started_at: new Date().toISOString(), ...over,
});
const stateOf = (match: Match, scoreboard: ScoreboardEntry[] = []) => ({ match, participants: [], scoreboard });

async function mount(path = '/play/ABC123', multiplayerOn = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, multiplayer: multiplayerOn } });
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <LanguageProvider>
            <Routes>
              <Route path="/play" element={<PlayLanding />} />
              <Route path="/play/:code" element={<PlayMatch />} />
            </Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

/** mount(), with a way to draw the tree again after the account changed. */
async function mountWithRerender() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  client.setQueryData(GAME_CONFIG_KEY, DEFAULT_CONFIG);
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/play/ABC123']}>
        <LanguageProvider>
          <Routes><Route path="/play/:code" element={<PlayMatch />} /></Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(tree()); });
  return { rerender: () => view.rerender(tree()) };
}

/** Play's own stylesheet in the test document (Vitest drops CSS imports). */
function playSheet(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/components/Play.css', import.meta.url), 'utf8');
  document.head.append(style);
  return style;
}

const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });

beforeEach(() => {
  currentUser = USER;
  for (const fn of Object.values(api)) fn.mockReset();
  api.sendHeartbeat.mockResolvedValue({ ok: true });
  live.listeners.clear();
  live.sent.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('the Play page (social-account-12)', () => {
  it('has one filled primary, Create, and Join turns primary only once the field holds a whole code', async () => {
    await mount('/play');
    const create = await screen.findByRole('button', { name: 'Create multiplayer match' });
    expect(create).toHaveClass('ss-swim-cta', 'ss-swim-cta--md');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);

    const join = () => screen.getByRole('button', { name: /^Join/ });
    const secondary = join().className;
    fireEvent.change(screen.getByLabelText('Match code'), { target: { value: 'abc12' } });
    expect(join().className).toBe(secondary);
    fireEvent.change(screen.getByLabelText('Match code'), { target: { value: 'abc123' } });
    expect(join().className).not.toBe(secondary);
  });

  it('says the scoring rule once and frames the join code once, spacing only its value (social-account-20)', async () => {
    const sheet = playSheet();
    await mount('/play');
    await screen.findByRole('button', { name: 'Create multiplayer match' });
    expect(screen.getByText('Everyone races to answer.')).toBeInTheDocument();
    expect(document.body.textContent?.match(/speed bonus/g)).toHaveLength(1);
    expect(screen.getByText('Anyone with the code can join; you play too.')).toBeInTheDocument();

    const field = screen.getByLabelText('Match code');
    expect(field.closest('.play-code')).not.toBeNull();
    // No dashed, tinted box between the card and the field.
    for (let node = field.parentElement; node && !node.classList.contains('ss-raised'); node = node.parentElement) {
      expect(node.getAttribute('style') ?? '').not.toMatch(/dashed/);
    }
    expect(getComputedStyle(field).letterSpacing).not.toMatch(/^(normal|0px)?$/);
    expect(getComputedStyle(screen.getByText('Match code')).letterSpacing).toMatch(/^(normal|0px)?$/);
    sheet.remove();
  });

  it('opens on the shared operational header: a Play live kicker over an ink h1 and one lead (social-account-11)', async () => {
    await mount('/play');
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Race or teach live');
    const header = h1.closest('header.ss-page-header')!;
    expect(header).not.toBeNull();
    // The kicker is context, not the heading.
    const kicker = header.querySelector('.ss-kicker')!;
    expect(kicker.tagName).toBe('SPAN');
    expect(kicker).toHaveTextContent('Play live');
    expect(header.querySelector('.ss-page-header__lead')).toHaveTextContent('Everyone in the room sees the same question at the same time.');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('labels the question count above its toggles, like the time limit', async () => {
    await mount('/play');
    await screen.findByRole('button', { name: 'Create multiplayer match' });
    // The visible label is the line right above each control.
    expect(screen.getByRole('group', { name: 'Questions' }).previousElementSibling).toHaveTextContent('Questions');
    expect(screen.getByLabelText('Time limit').previousElementSibling).toHaveTextContent('Time limit');
  });

  it('keeps the topic pills open on a wide screen, and folds them behind one 44px "Topics: all" row on a phone (social-account-13)', async () => {
    await mount('/play');
    await screen.findByRole('button', { name: 'Create multiplayer match' });
    expect(document.querySelector('details.play-topics')).toBeNull();
    expect(screen.getByRole('group', { name: 'Topics' })).toBeVisible();
    cleanup();

    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query.includes('max-width: 599'), media: query, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    }));
    const sheet = playSheet();
    await mount('/play');
    await screen.findByRole('button', { name: 'Create multiplayer match' });
    const fold = document.querySelector('details.play-topics') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    const summary = fold.querySelector('summary')!;
    expect(summary).toHaveTextContent('Topics: all');
    expect(getComputedStyle(summary).minHeight).toBe('var(--ss-control-height)');
    // The fold holds the same pills, and names the choice once one is made.
    fold.open = true;
    fireEvent.click(within(fold).getByRole('button', { name: 'JavaScript' }));
    expect(summary).toHaveTextContent('Topics: 1 selected');
    expect(within(fold).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    // The row shows it opens: the select's chevron, drawn on its own element
    // (a shorthand naming the missing --color-background dropped it).
    const css = sheet.textContent ?? '';
    expect(css).toMatch(/\.play-topics__summary::after \{[^}]*background: var\(--ss-select-arrow\)/);
    expect(css).not.toContain('var(--color-background)');
    sheet.remove();
  });
});

describe('joining a live room', () => {
  it('opens on the state read after joining when the host has already started', async () => {
    api.joinMatch.mockResolvedValue(running({ status: 'lobby', questions: [], question_started_at: null }));
    api.fetchMatchState.mockResolvedValue(stateOf(running()));
    await mount();
    expect(screen.getByText('Pick one?')).toBeVisible();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(1);
  });
});

describe('a timed question', () => {
  it('closes its options at 0 s and reads the room once just after the clock runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // A 30 s question with 2 s left when the page opens.
    const match = running({ question_started_at: new Date(Date.now() - 28_000).toISOString(), question_duration_s: 30 });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    const readsAtMount = api.fetchMatchState.mock.calls.length;
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

    await tick(2_500);
    expect(screen.getByRole('radio', { name: 'beta' })).toBeDisabled();
    expect(screen.getByText('Time is up for this question.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    expect(api.submitMatchAnswer).not.toHaveBeenCalled();

    await tick(2_500);
    expect(api.fetchMatchState.mock.calls.length).toBe(readsAtMount + 1);
    await tick(15_000);
    expect(api.fetchMatchState.mock.calls.length).toBe(readsAtMount + 1);
  });

  it('sends a browsed answer once at 0 s, even when that send fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const match = running({ question_started_at: new Date(Date.now() - 28_000).toISOString(), question_duration_s: 30 });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.submitMatchAnswer.mockRejectedValue(new Error('Failed to fetch'));
    await mount();
    await screen.findByText('Pick one?');
    // Arrow keys browse to an option without locking it in.
    fireEvent.keyDown(screen.getByRole('radio', { name: 'alpha' }), { key: 'ArrowDown' });
    expect(api.submitMatchAnswer).not.toHaveBeenCalled();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    await tick(2_500);
    await settle();
    await tick(3_000);
    await settle();
    // The failed send unlocks the answer, but the clock is out: the auto-lock
    // must not send it again on every render that follows.
    expect(api.submitMatchAnswer).toHaveBeenCalledTimes(1);
  });

  it('says a refused late answer did not count and reads the room again', async () => {
    const match = running({ question_duration_s: 30 });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.submitMatchAnswer.mockRejectedValue(new ApiError('Time ran out for this question', 409, 'time_up'));
    await mount();
    await screen.findByText('Pick one?');
    const reads = api.fetchMatchState.mock.calls.length;
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    expect(await screen.findByText('Time ran out before your answer landed — it didn’t count.')).toBeInTheDocument();
    await waitFor(() => expect(api.fetchMatchState.mock.calls.length).toBe(reads + 1));
  });
});

describe('recovery', () => {
  it('runs the join again on Try again after a failed join', async () => {
    const match = running();
    api.joinMatch.mockRejectedValueOnce(new ApiError('Failed to fetch', 0, 'network')).mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.submitMatchAnswer.mockResolvedValue({ ok: true, is_correct: true, advanced: false });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await screen.findByText('Pick one?');
    expect(api.joinMatch).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await waitFor(() => expect(api.submitMatchAnswer).toHaveBeenCalledTimes(1));
  });

  it('does not join again when a session refresh hands over a new user object', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    currentUser = { ...USER };
    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await fire('match_updated', { status: 'running', current_index: 1 });
    await screen.findByText('Next one?');
    await settle();
    expect(api.joinMatch).toHaveBeenCalledTimes(1);
  });

  it('leaves the previous room behind when the address moves straight to another room', async () => {
    const match = running();
    api.joinMatch.mockResolvedValueOnce(match).mockReturnValue(new Promise(() => undefined));
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    let go: (path: string) => void = () => undefined;
    function Navigator() {
      const navigate = useNavigate();
      go = navigate;
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    client.setQueryData(GAME_CONFIG_KEY, DEFAULT_CONFIG);
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/play/ABC123']}>
            <LanguageProvider>
              <Navigator />
              <Routes><Route path="/play/:code" element={<PlayMatch />} /></Routes>
            </LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await screen.findByText('Pick one?');
    await act(async () => { go('/play/XYZ789'); });
    await settle();
    expect(api.joinMatch).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'XYZ789' }));
    // The new room is still joining: nothing of ABC123 is left to answer.
    expect(screen.queryByText('Pick one?')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'beta' })).toBeNull();
  });

  it('drops the previous account\'s pick and room when another account signs in mid-room', async () => {
    const match = running();
    api.joinMatch.mockResolvedValueOnce(match).mockReturnValue(new Promise(() => undefined));
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.submitMatchAnswer.mockResolvedValue({ ok: true, is_correct: true, advanced: false });
    const { rerender } = await mountWithRerender();
    fireEvent.click(await screen.findByRole('radio', { name: 'beta' }));
    await waitFor(() => expect(api.submitMatchAnswer).toHaveBeenCalledTimes(1));
    currentUser = { id: 'player-2', user_metadata: {} };
    await act(async () => { rerender(); });
    await settle();
    expect(api.joinMatch).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 'player-2' }));
    expect(screen.queryByText('Pick one?')).toBeNull();
  });

  it('shows the results of a room that finished instead of an error', async () => {
    const finished = running({ status: 'finished' });
    api.joinMatch.mockRejectedValue(new ApiError('Match is over', 410, 'finished'));
    api.fetchMatchState.mockResolvedValue(stateOf(finished, [{ user_id: 'player-1', display_name: 'Petr', correct: 1, score: 140, total_ms: 3000 }]));
    await mount();
    expect(await screen.findByRole('heading', { name: 'Match complete' })).toBeInTheDocument();
    expect(screen.getByText('Winner: Petr — 1/2')).toBeInTheDocument();
    expect(screen.queryByText('This match is already over.')).toBeNull();
  });

  it('clears the first room read’s error after a later state read succeeds', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState
      .mockRejectedValueOnce(new ApiError('First room read failed', 500, 'db_error'))
      .mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Server error. Try again in a moment.');
    await act(async () => { live.listeners.get('match_updated')!(); });
    await settle();
    expect(api.fetchMatchState).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Pick one?')).toBeInTheDocument();
    expect(screen.queryByText('Server error. Try again in a moment.')).toBeNull();
  });

  it('clears the could-not-refresh warning once a read works again', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    api.fetchMatchState
      .mockRejectedValueOnce(new ApiError('Too many requests', 429, 'rate_limited'))
      .mockRejectedValueOnce(new ApiError('Too many requests', 429, 'rate_limited'))
      .mockRejectedValueOnce(new ApiError('Too many requests', 429, 'rate_limited'))
      .mockResolvedValue(stateOf(match));
    const broadcast = async () => {
      await act(async () => { live.listeners.get('match_updated')!(); });
      await settle();
    };
    for (let i = 0; i < 3; i += 1) await broadcast();
    expect(screen.getByText(/could not refresh/)).toBeInTheDocument();
    await broadcast();
    expect(screen.queryByText(/could not refresh/)).toBeNull();
  });
});

describe('the end of a room', () => {
  it('names no winner when nobody scored', async () => {
    const finished = running({ status: 'finished', mode: 'classroom' });
    api.joinMatch.mockRejectedValue(new ApiError('Match is over', 410, 'finished'));
    api.fetchMatchState.mockResolvedValue(stateOf(finished, [{ user_id: 'player-1', display_name: 'Petr', correct: 0, score: 0, total_ms: 4000 }]));
    await mount();
    expect(await screen.findByRole('heading', { name: 'Match complete' })).toBeInTheDocument();
    expect(screen.queryByText(/^Winner:/)).toBeNull();
    expect(screen.getByText('Petr')).toBeInTheDocument();
  });

  it('says the host left when a lobby closed before it started', async () => {
    const lobby = running({ status: 'lobby', started_at: null });
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(lobby));
    await mount();
    await screen.findByRole('heading', { name: 'Lobby' });
    api.fetchMatchState.mockResolvedValue(stateOf({ ...lobby, status: 'finished', ended_at: new Date().toISOString() }));
    await act(async () => { live.listeners.get('match_updated')!(); });
    expect(await screen.findByRole('heading', { name: 'The host left' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Match complete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});

describe('the classroom presenter screen', () => {
  // The teacher's screen is often projected while the class answers, so the
  // answer key stays off it until the question closes. "Reveal answer" closes
  // it on the server first (migration 056): no answer to it lands any more.
  const KEYED = [
    { ...QUESTIONS[0], correct_index: 1 },
    { ...QUESTIONS[1], correct_index: 0 },
  ];
  const presenting = (over: Partial<Match> = {}) => {
    const match = running({ mode: 'classroom', host_id: USER.id, questions: KEYED, ...over });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.fetchDistribution.mockResolvedValue({ buckets: [{ selected_idx: 0, count: 3 }, { selected_idx: 1, count: 5 }] });
    // The server closes the question and the room reads as closed after it.
    api.controlMatch.mockImplementation(async ({ action }: { action: string }) => {
      if (action !== 'reveal') throw new Error(`unexpected control ${action}`);
      api.fetchMatchState.mockResolvedValue(stateOf({ ...match, revealed_idx: match.current_index }));
      return { ok: true, status: 'running', current_index: match.current_index, revealed_idx: match.current_index };
    });
    return match;
  };
  const tone = (name: string) => screen.getByRole('radio', { name }).getAttribute('data-tone');
  const histogramKey = () => document.querySelectorAll('[data-correct]');

  it('presents answer choices without allowing the teacher to select or submit them', async () => {
    presenting({ question_duration_s: 0 });
    await mount();
    const option = await screen.findByRole('radio', { name: 'alpha' });

    expect(option).toBeDisabled();
    expect(option).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-checked', 'false');
    expect(api.submitMatchAnswer).not.toHaveBeenCalled();
  });

  it('keeps an untimed question’s answer hidden until the teacher reveals it, and the reveal closes the question', async () => {
    presenting({ question_duration_s: 0 });
    await mount();
    await screen.findByText('Pick one?');
    await waitFor(() => expect(api.fetchDistribution).toHaveBeenCalled());
    // The counts per option are there, with nothing marked correct.
    expect(await screen.findByText('Live answers received: 8/0')).toBeInTheDocument();
    expect(tone('beta')).toBe('default');
    expect(tone('alpha')).toBe('default');
    expect(histogramKey()).toHaveLength(0);
    expect(screen.queryByText(/^Correct answer:/)).toBeNull();
    expect(screen.getByText('The correct answer stays hidden until you reveal it. Revealing it closes the question.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await waitFor(() => expect(tone('beta')).toBe('success'));
    expect(api.controlMatch).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC123', action: 'reveal' }));
    // Every screen in the room hears that the question closed.
    expect(live.sent.filter((one) => one.event === 'match_updated'))
      .toEqual([{ event: 'match_updated', payload: { status: 'running', current_index: 0, revealed_idx: 0 } }]);
    expect(tone('alpha')).toBe('default');
    expect(histogramKey()).toHaveLength(1);
    expect(histogramKey()[0]).toHaveTextContent('B');
    expect(screen.getByText('Correct answer: B. beta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
  });

  it('keeps the key hidden when the server could not close the question', async () => {
    presenting({ question_duration_s: 0 });
    api.controlMatch.mockRejectedValue(new ApiError('Match state changed; refresh and try again', 409, 'stale_state'));
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    expect(await screen.findByText('Match state changed; refresh and try again')).toBeInTheDocument();
    expect(tone('beta')).toBe('default');
    expect(histogramKey()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeEnabled();
  });

  it('shows a question the teacher closed from another screen as closed', async () => {
    presenting({ question_duration_s: 0, revealed_idx: 0 });
    await mount();
    await screen.findByText('Pick one?');
    expect(tone('beta')).toBe('success');
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
    expect(screen.getByRole('timer')).toHaveTextContent('Closed');
  });

  it('shows a timed question’s answer once the server stops taking answers, without the button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    presenting({ question_started_at: new Date(Date.now() - 28_000).toISOString(), question_duration_s: 30 });
    await mount();
    await screen.findByText('Pick one?');
    expect(tone('beta')).toBe('default');
    expect(histogramKey()).toHaveLength(0);
    expect(screen.getByText('The correct answer stays hidden until time is up or you reveal it. Revealing it closes the question.')).toBeInTheDocument();

    // The clock is out, but an answer sent on the buzzer still counts for
    // two more seconds: the key stays off the projector until then.
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(screen.getByRole('timer')).toHaveTextContent('0s');
    expect(tone('beta')).toBe('default');
    expect(histogramKey()).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(tone('beta')).toBe('success');
    expect(histogramKey()).toHaveLength(1);
    expect(screen.getByText('Correct answer: B. beta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
  });

  it('hides the key again when the next question opens', async () => {
    const match = presenting({ question_duration_s: 0 });
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await waitFor(() => expect(tone('beta')).toBe('success'));

    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, current_index: 1, revealed_idx: 0, question_started_at: new Date().toISOString() }));
    await act(async () => { live.listeners.get('match_updated')!(); });
    await screen.findByText('Next one?');
    expect(tone('gamma')).toBe('default');
    expect(histogramKey()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Reveal answer' })).toBeInTheDocument();
  });

  it('takes one final count after Reveal and stops polling that closed question', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    presenting({ question_duration_s: 0 });
    await mount();
    await screen.findByText('Live answers received: 8/0');
    const before = api.fetchDistribution.mock.calls.length;
    api.fetchDistribution.mockResolvedValue({ buckets: [{ selected_idx: 1, count: 9 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }));
    await settle();
    expect(screen.getByText('Live answers received: 9/0')).toBeInTheDocument();
    expect(api.fetchDistribution).toHaveBeenCalledTimes(before + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(api.fetchDistribution).toHaveBeenCalledTimes(before + 1);
  });

  it('keeps one answer count read in flight on a slow connection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    presenting({ question_duration_s: 0 });
    let release!: () => void;
    api.fetchDistribution.mockImplementation(() => new Promise((done) => { release = () => done({ buckets: [] }); }));
    await mount();
    await screen.findByText('Pick one?');
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(api.fetchDistribution).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(api.fetchDistribution).toHaveBeenCalledTimes(2);
  });

  it('never gives a player the key or the button', async () => {
    const match = running({ mode: 'classroom', questions: QUESTIONS });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    expect(screen.queryByRole('button', { name: 'Reveal answer' })).toBeNull();
    expect(api.fetchDistribution).not.toHaveBeenCalled();
  });
});

describe('a classroom pupil', () => {
  // The question closes when the teacher reveals the answer (056), and the
  // scoreboard counts only closed questions, so a pupil's screen says when a
  // question is closed and nothing in it moves while one is open.
  const pupilIn = (over: Partial<Match> = {}) => {
    const match = running({ mode: 'classroom', questions: [QUESTIONS[0]], question_count: 2, ...over });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match, [{ user_id: 'player-1', display_name: 'Petr', correct: 0, score: 0, total_ms: 0 }]));
    return match;
  };

  it('closes the options and says so when the teacher reveals the answer', async () => {
    const match = pupilIn({ question_duration_s: 30 });
    await mount();
    await screen.findByText('Pick one?');
    expect(screen.getByRole('radio', { name: 'beta' })).not.toBeDisabled();
    expect(screen.getByText('Updates when a question closes: when time runs out or the teacher reveals the answer.')).toBeInTheDocument();

    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, revealed_idx: 0 }));
    await fire('match_updated', { status: 'running', current_index: 0, revealed_idx: 0 });
    expect(await screen.findByText('The teacher closed this question. Wait for the next one.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'beta' })).toBeDisabled();
    expect(screen.getByRole('timer')).toHaveTextContent('Closed');
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await settle();
    expect(api.submitMatchAnswer).not.toHaveBeenCalled();
  });

  it('says an answer that reached a closed question did not count, and reads the room again', async () => {
    pupilIn();
    api.submitMatchAnswer.mockRejectedValue(new ApiError('The teacher closed this question', 409, 'question_closed'));
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    expect(await screen.findByText('The teacher closed this question before your answer landed — it didn’t count.')).toBeInTheDocument();
    await waitFor(() => expect(reads()).toBe(before + 1));
  });

  it('tells nobody about a single answer, and the teacher reads nothing for one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pupilIn();
    // A classroom answer is acknowledged, never graded back (056).
    api.submitMatchAnswer.mockResolvedValue({ ok: true, accepted: true, advanced: false });
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await waitFor(() => expect(api.submitMatchAnswer).toHaveBeenCalledTimes(1));
    // The pupil is told the answer is locked, and no option is marked right.
    expect(await screen.findByText('Answer locked. Waiting for the instructor to advance…')).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('data-tone'))).not.toContain('success');
    await settle();
    expect(roomEvents()).toEqual([]);
  });

  it('reads the room once when a timed question’s clock runs out, for the scoreboard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    pupilIn({ question_started_at: new Date(Date.now() - 28_000).toISOString(), question_duration_s: 30 });
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    await tick(2_000);
    expect(reads()).toBe(before);
    await tick(3_000);
    expect(reads()).toBe(before + 1);
  });
});

describe('a classroom presenter and the answers', () => {
  it('reads nothing for the class’s answers: the scoreboard waits for the question to close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const match = running({ mode: 'classroom', host_id: USER.id, questions: KEYED_QUESTIONS });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.fetchDistribution.mockResolvedValue({ buckets: [] });
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    for (let i = 0; i < 12; i += 1) await fire('answered', { question_idx: 0 });
    await tick(5_000);
    expect(reads()).toBe(before);
  });
});

const KEYED_QUESTIONS = [
  { ...QUESTIONS[0], correct_index: 1 },
  { ...QUESTIONS[1], correct_index: 0 },
];
const reads = () => api.fetchMatchState.mock.calls.length;
// What this client broadcast, apart from the hello every client sends when
// its channel connects.
const roomEvents = () => live.sent.filter((one) => one.event !== 'participant_joined');
const fire = (event: string, payload?: unknown) => act(async () => { live.listeners.get(event)!(payload); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('what a room broadcasts', () => {
  // A class of thirty used to send one broadcast per answer, and every
  // client read the room for each one: about 960 reads a question from one
  // school address. Only a change of question or phase is broadcast now,
  // with the state it changed to.

  it('tells only the host about an answer that leaves the room where it was', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.submitMatchAnswer.mockResolvedValue({ ok: true, is_correct: true, advanced: false });
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await waitFor(() => expect(roomEvents()).toEqual([{ event: 'answered', payload: { question_idx: 0 } }]));
    await settle();
    expect(reads()).toBe(before);
  });

  it('announces the next question when an answer moves the room on, and the end after the last one', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(match)).mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    api.submitMatchAnswer.mockResolvedValue({ ok: true, is_correct: true, advanced: true });
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await screen.findByText('Next one?');
    expect(roomEvents()).toEqual([{ event: 'match_updated', payload: { status: 'running', current_index: 1 } }]);

    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, status: 'finished', current_index: 1 }));
    fireEvent.click(screen.getByRole('radio', { name: 'delta' }));
    expect(await screen.findByRole('heading', { name: 'Match complete' })).toBeInTheDocument();
    expect(roomEvents()[1]).toEqual({ event: 'match_updated', payload: { status: 'finished', current_index: 1 } });
  });

  it('reads for a broadcast of a new question, and not for the one on screen or one already read', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    await fire('match_updated', { status: 'running', current_index: 0 });
    await settle();
    expect(reads()).toBe(before);

    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await fire('match_updated', { status: 'running', current_index: 1 });
    await screen.findByText('Next one?');
    expect(reads()).toBe(before + 1);
    // The same change from a second sender.
    await fire('match_updated', { status: 'running', current_index: 1 });
    await settle();
    expect(reads()).toBe(before + 1);
  });

  it('lets the host read the room once for a burst of answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const match = running({ host_id: USER.id });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    for (let i = 0; i < 12; i += 1) await fire('answered', { question_idx: 0 });
    expect(reads()).toBe(before);
    await tick(1_600);
    expect(reads()).toBe(before + 1);
    await tick(5_000);
    expect(reads()).toBe(before + 1);
  });

  it('leaves a player alone when someone else answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    for (let i = 0; i < 12; i += 1) await fire('answered', { question_idx: 0 });
    await tick(5_000);
    expect(reads()).toBe(before);
  });

  it('has the host announce a change of question that their own read found', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // An untimed multiplayer round whose last two answers raced: neither
    // answer moved the room on, and the host's read after them did.
    const match = running({ host_id: USER.id });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(match)).mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await mount();
    await screen.findByText('Pick one?');
    await fire('answered', { question_idx: 0 });
    await tick(1_600);
    await screen.findByText('Next one?');
    expect(roomEvents()).toEqual([{ event: 'match_updated', payload: { status: 'running', current_index: 1 } }]);
  });

  it('keeps a player quiet about a change their read found', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(match)).mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await mount();
    await screen.findByText('Pick one?');
    // A broadcast from a tab on the build before broadcasts carried the room.
    await fire('match_updated', { at: Date.now() });
    await screen.findByText('Next one?');
    expect(roomEvents()).toEqual([]);
  });

  it('announces the presenter’s next question and shows it', async () => {
    const match = running({ mode: 'classroom', host_id: USER.id, questions: KEYED_QUESTIONS });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValueOnce(stateOf(match)).mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    api.fetchDistribution.mockResolvedValue({ buckets: [] });
    api.controlMatch.mockResolvedValue({ ok: true, status: 'running', current_index: 1 });
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('button', { name: 'Next question →' }));
    await screen.findByText('Next one?');
    expect(api.controlMatch).toHaveBeenCalledWith(expect.objectContaining({ action: 'advance' }));
    expect(roomEvents()).toEqual([{ event: 'match_updated', payload: { status: 'running', current_index: 1 } }]);
  });
});

describe('double presses', () => {
  // Two presses in one task land before React disables the button, so a
  // double click on Next asked the server to advance twice and skipped a
  // question for the whole room.
  it('sends one control for a double click on the presenter’s Next', async () => {
    const match = running({ mode: 'classroom', host_id: USER.id, questions: KEYED_QUESTIONS });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    api.fetchDistribution.mockResolvedValue({ buckets: [] });
    let release!: () => void;
    api.controlMatch.mockImplementation(() => new Promise((done) => { release = () => done({ ok: true, status: 'running', current_index: 1 }); }));
    await mount();
    const next = await screen.findByRole('button', { name: 'Next question →' });
    act(() => { next.click(); next.click(); });
    expect(api.controlMatch).toHaveBeenCalledTimes(1);
    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await act(async () => { release(); });
    await screen.findByText('Next one?');
    expect(api.controlMatch).toHaveBeenCalledTimes(1);
  });

  it('keeps the next question locked when the last one’s answer fails after the room moved on', async () => {
    const match = running();
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    let fail!: () => void;
    api.submitMatchAnswer
      .mockImplementationOnce(() => new Promise((_done, reject) => { fail = () => reject(new ApiError('Failed to fetch', 0, 'network')); }))
      .mockResolvedValue({ ok: true, is_correct: true, advanced: false });
    await mount();
    await screen.findByText('Pick one?');
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    api.fetchMatchState.mockResolvedValue(stateOf({ ...match, current_index: 1 }));
    await fire('match_updated', { status: 'running', current_index: 1 });
    await screen.findByText('Next one?');
    fireEvent.click(screen.getByRole('radio', { name: 'delta' }));
    await waitFor(() => expect(api.submitMatchAnswer).toHaveBeenCalledTimes(2));
    await act(async () => { fail(); });
    await settle();
    expect(screen.getByText('Answer locked. Waiting for the other players…')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'gamma' })).toBeDisabled();
    expect(screen.queryByText(/Network error\./)).not.toBeInTheDocument();
  });

  it('creates one room for a double click on Create', async () => {
    let release!: () => void;
    api.createMatch.mockImplementation(() => new Promise((done) => { release = () => done({ id: 'm1', code: 'ABC123', mode: 'multiplayer', status: 'lobby' }); }));
    await mount('/play');
    const create = await screen.findByRole('button', { name: /Create/ });
    act(() => { create.click(); create.click(); });
    expect(api.createMatch).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });
});

describe('joining by code', () => {
  it('joins on Enter in the code field, once for a held key', async () => {
    api.joinMatch.mockImplementation(() => new Promise(() => undefined));
    await mount('/play');
    const field = await screen.findByLabelText('Match code');
    fireEvent.change(field, { target: { value: 'xyz789' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(api.joinMatch).toHaveBeenCalledTimes(1));
    expect(api.joinMatch).toHaveBeenCalledWith(expect.objectContaining({ code: 'XYZ789' }));
  });
});

describe('the room clock', () => {
  // A device clock 31 s ahead of the server's. The server says what its clock
  // reads in every join and state response.
  const SKEW = 31_000;
  const serverClock = () => new Date(Date.now() - SKEW).toISOString();
  function openedOnServer(over: Partial<Match>) {
    const serverNow = Date.now();
    vi.useFakeTimers({ shouldAdvanceTime: true, now: serverNow + SKEW });
    const match = running({ question_started_at: new Date(serverNow).toISOString(), question_duration_s: 30, ...over });
    api.joinMatch.mockImplementation(async () => ({ ...match, server_now: serverClock() }));
    api.fetchMatchState.mockImplementation(async () => ({ ...stateOf(match), server_now: serverClock() }));
    api.fetchDistribution.mockResolvedValue({ buckets: [] });
    return match;
  }
  const tone = (name: string) => screen.getByRole('radio', { name }).getAttribute('data-tone');

  it('keeps the key off a projector whose clock runs fast until the question closes', async () => {
    openedOnServer({ mode: 'classroom', host_id: USER.id, questions: KEYED_QUESTIONS });
    await mount();
    await screen.findByText('Pick one?');
    expect(screen.getByRole('timer')).toHaveTextContent('30s');
    expect(tone('beta')).toBe('default');
    await tick(31_000);
    expect(tone('beta')).toBe('default');
    await tick(2_000);
    expect(tone('beta')).toBe('success');
  });

  it('lets a player whose phone runs fast answer a question that just opened', async () => {
    openedOnServer({});
    api.submitMatchAnswer.mockResolvedValue({ ok: true, is_correct: true, advanced: false });
    await mount();
    await screen.findByText('Pick one?');
    expect(screen.getByRole('timer')).toHaveTextContent('30s');
    expect(screen.queryByText('Time is up for this question.')).toBeNull();
    expect(screen.getByRole('radio', { name: 'beta' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'beta' }));
    await waitFor(() => expect(api.submitMatchAnswer).toHaveBeenCalledTimes(1));
  });

  it('reads the room when the server’s clock runs out, not the phone’s', async () => {
    openedOnServer({});
    await mount();
    await screen.findByText('Pick one?');
    const before = reads();
    await tick(20_000);
    expect(reads()).toBe(before);
    await tick(13_000);
    expect(reads()).toBe(before + 2); // the 30 s healing poll and the expiry read
  });
});

describe('the questions a player holds', () => {
  // A player receives only the questions already shown; `question_count`
  // says how long the round is.
  it('counts the round from question_count', async () => {
    const match = running({ questions: [QUESTIONS[0]], question_count: 5 });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    expect(await screen.findByText('Question 1 of 5 · JavaScript · difficulty 1')).toBeInTheDocument();
  });

  it('offers a competing host a skip, not the results, on the first of five', async () => {
    const match = running({ host_id: USER.id, questions: [QUESTIONS[0]], question_count: 5 });
    api.joinMatch.mockResolvedValue(match);
    api.fetchMatchState.mockResolvedValue(stateOf(match));
    await mount();
    expect(await screen.findByRole('button', { name: 'Skip question →' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show results' })).toBeNull();
  });

  it('names the round’s length on the lobby’s start button', async () => {
    const lobby = running({ status: 'lobby', started_at: null, host_id: USER.id, questions: [], question_count: 10 });
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValue(stateOf(lobby));
    await mount();
    expect(await screen.findByRole('button', { name: 'Start (10 questions)' })).toBeInTheDocument();
  });
});

describe('the lobby (social-account-14, -15)', () => {
  const people = [
    { user_id: USER.id, display_name: 'Test Learner', joined_at: '2026-10-23T10:00:00Z' },
    { user_id: 'p2', display_name: 'Harbour reader', joined_at: '2026-10-23T10:00:01Z' },
  ];
  const lobbyOf = (over: Partial<Match> = {}) => running({ status: 'lobby', started_at: null, host_id: USER.id, questions: [], question_count: 10, ...over });

  it('is one panel with plain player rows, and says the code only in the header badge', async () => {
    const lobby = lobbyOf();
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValue({ match: lobby, participants: people, scoreboard: [] });
    await mount();
    const heading = await screen.findByRole('heading', { name: 'Lobby' });
    const panel = heading.closest('section')!;
    expect(panel).toHaveClass('ss-panel', 'play-invite');
    // canvas -> one panel -> rows: no raised card or Astryx card inside it.
    expect(panel.querySelector('.ss-raised, .ss-panel')).toBeNull();
    const rows = within(screen.getByRole('list', { name: 'Players' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['TLTest LearnerHost', 'HRHarbour reader']);
    expect(screen.getByText('Share the code, then press Start when everyone has joined.')).toBeInTheDocument();
    // The code is in the header's copy badge, not in the instruction.
    expect(screen.getByRole('button', { name: /^ABC123/ })).toBeInTheDocument();
    expect(panel.querySelector('.play-lobby__head')!.textContent).not.toContain('ABC123');
    // Copy link and Print invite sit with the share text, so the footer holds only Start.
    const share = panel.querySelector('.play-lobby__share')!;
    expect(within(share as HTMLElement).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(share as HTMLElement).getByRole('button', { name: 'Print invite' })).toBeInTheDocument();
    const footer = panel.querySelector('.play-lobby__start')!;
    expect(within(footer as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['Start (10 questions)']);
  });

  it('makes the host\'s Start the one 44px primary, on the right and full width on a phone, beside a 44px code badge', async () => {
    const lobby = lobbyOf();
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValue({ match: lobby, participants: people, scoreboard: [] });
    await mount();
    const start = await screen.findByRole('button', { name: 'Start (10 questions)' });
    expect(start).toHaveClass('ss-swim-cta', 'ss-swim-cta--md');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(start.parentElement).toHaveClass('play-lobby__start');
    const css = readFileSync(new URL('../src/components/Play.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.play-lobby__start \{ display: flex; justify-content: flex-end; \}/);
    // Full width on a phone: a grid whose one track is not shrunk by the
    // wide screen's flex-end (at 390 it stayed a 180px button on the right).
    const phone = css.slice(css.indexOf('@media (max-width: 599.95px)'));
    expect(phone).toMatch(/\.play-lobby__start \{ display: grid; justify-content: normal; \}/);
    // The badge takes the default size, so the shared floor makes it 44px.
    expect(screen.getByRole('button', { name: /^ABC123/ })).toBeInTheDocument();
    const source = readFileSync(new URL('../src/components/Play.tsx', import.meta.url), 'utf8');
    const codeBadge = source.slice(source.indexOf('const CodeBadge'), source.indexOf('function Lobby'));
    expect(codeBadge).toContain('<Button');
    expect(codeBadge).not.toContain('size="sm"');
    fireEvent.click(start);
    expect(api.controlMatch).toHaveBeenCalled();
  });

  it('heads the room with the shared header and the code badge beside it (social-account-11)', async () => {
    const lobby = lobbyOf();
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValue({ match: lobby, participants: people, scoreboard: [] });
    await mount();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Multiplayer' });
    const header = h1.closest('header.ss-page-header')!;
    expect(header.querySelector('.ss-kicker')).toHaveTextContent('Play live');
    expect(header.querySelector('.ss-page-header__lead')).toHaveTextContent('Hosted by Hana');
    expect(header.parentElement).toHaveClass('play-room__head');
    expect(within(header.parentElement as HTMLElement).getByRole('button', { name: /^ABC123/ })).toBeInTheDocument();
    // The badge stays beside the title on a phone: the row does not wrap and
    // the badge keeps its size, so the title column wraps instead.
    const css = readFileSync(new URL('../src/components/Play.css', import.meta.url), 'utf8');
    const head = css.match(/\.play-room__head \{[^}]*\}/)?.[0] ?? '';
    expect(head).toContain('display: flex');
    expect(head).not.toContain('flex-wrap: wrap');
    expect(css).toMatch(/\.play-room__head > :last-child \{ flex: none; \}/);
  });

  it('tells a guest to wait, with no Start', async () => {
    const lobby = lobbyOf({ host_id: 'host-1' });
    api.joinMatch.mockResolvedValue(lobby);
    api.fetchMatchState.mockResolvedValue({ match: lobby, participants: people, scoreboard: [] });
    await mount();
    expect(await screen.findByText('Share the code, then wait for the host to start.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start/ })).toBeNull();
  });
});

describe('the Play switch', () => {
  it('shows live games as switched off on every Play page', async () => {
    await mount('/play/ABC123', false);
    expect(screen.getByRole('heading', { name: 'Live games are switched off' })).toBeInTheDocument();
    expect(api.joinMatch).not.toHaveBeenCalled();
  });

  it('shows the landing page as switched off too', async () => {
    await mount('/play', false);
    expect(screen.getByRole('heading', { name: 'Live games are switched off' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull();
  });

  it('follows the server when it says Play is off', async () => {
    api.joinMatch.mockRejectedValue(new ApiError('Live games are switched off', 503, 'feature_disabled'));
    api.fetchMatchState.mockRejectedValue(new ApiError('Live games are switched off', 503, 'feature_disabled'));
    await mount();
    expect(await screen.findByRole('heading', { name: 'Live games are switched off' })).toBeInTheDocument();
  });
});

describe('narrow screens and headings', () => {
  it('names the page in an h1 when no match has that code', async () => {
    api.joinMatch.mockRejectedValue(new ApiError('No match with that code', 404, 'not_found'));
    await mount('/play/ZZZZZZ');
    expect(await screen.findByText('No match with that code')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Play live');
  });

  // At 320px the time limit's one row ran 53px past the "Host a game" card,
  // and at 390 it dropped "No limit" onto a row of its own: it is one 44px
  // select now (social-account-13).
  it('draws the time limit as one 44px select, and gives a category chip a 44px floor on touch', async () => {
    const sheet = addSheet('deepEnd');
    await mount('/play');
    await screen.findByRole('button', { name: 'Create multiplayer match' });
    const select = screen.getByLabelText('Time limit');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveClass('ss-select');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['30s', '1 min', '2 min', '5 min', 'No limit']);
    fireEvent.change(select, { target: { value: '0' } });
    expect(select).toHaveValue('0');
    const chip = screen.getByRole('button', { name: 'JavaScript' });
    expect(chip).toHaveClass('ss-topic-pill');
    expect(chip).toHaveAttribute('aria-pressed');
    addSheet('appShell');
    expect(getComputedStyle(chip).minHeight).toBe('44px');
    expect(getComputedStyle(select).minHeight).toBe('44px');
    sheet.ownerNode?.remove();
  });

  it('creates the room with the time limit the select holds', async () => {
    api.createMatch.mockResolvedValue({ id: 'm1', code: 'ABC123', mode: 'multiplayer', status: 'lobby' });
    await mount('/play');
    const create = await screen.findByRole('button', { name: 'Create multiplayer match' });
    const select = screen.getByLabelText('Time limit');
    expect(select).toHaveValue(String(DEFAULT_CONFIG.play.defaultDurationS));
    expect(document.querySelector(`label[for="${select.id}"]`)).toHaveClass('play-field-label');
    fireEvent.change(select, { target: { value: '300' } });
    await act(async () => { fireEvent.click(create); });
    expect(api.createMatch).toHaveBeenCalledWith(expect.objectContaining({ duration_s: 300 }));
  });
});
