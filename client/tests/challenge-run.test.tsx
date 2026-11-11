import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { getTotalXp, onXpToast, primeRankMarker, type XpToast } from '../src/lib/xp';
import { clearAccountData } from '../src/lib/accountData';
import { queryClient } from '../src/lib/queryClient';

// The Biggest Shark Challenge against a small stand-in for the three endpoints
// it calls: the batch (GET /api/quiz/challenge), grading (POST
// /api/quiz/submit, which refuses a question outside the given session, as
// api/quiz/submit.ts does) and the run completion.

type Body = { sessionId: string; answers: Record<string, number> };
type Grade = (body: Body, questionId: string, selected: number) => { status: number; code?: string; message?: string; json?: unknown } | null;

const api = vi.hoisted(() => ({
  batchSize: 6,
  batches: 0,
  runs: 0,
  sessions: new Map<string, Set<string>>(),
  batchRequests: [] as URLSearchParams[],
  batchSignals: [] as (AbortSignal | null)[],
  submits: [] as { sessionId: string; questionId: string; selected: number; status: number }[],
  /** Replaces the default grade for one submit when it returns a response. */
  grade: null as Grade | null,
  holdGrade: null as null | Promise<void>,
  gradeSignals: [] as (AbortSignal | null)[],
  completions: [] as { runToken: string; proofs: string[]; status: number }[],
  completeStatus: (_runToken: string): { status: number; code?: string } => ({ status: 200 }),
  alreadyAwarded: new Set<string>(),
  /** Run completions wait for this when it is set. */
  holdComplete: null as null | Promise<void>,
  auth: { user: null as null | { id: string; email?: string; user_metadata?: Record<string, unknown> }, isAuthenticated: false, isLoading: false },
  /** Refuses the nth batch request (1-based) when it returns a status. */
  batchRefusal: null as null | ((n: number) => { status: number; code: string } | null),
  /** The nth batch request waits for `release()`. */
  holdBatch: 0,
  release: null as null | (() => void),
  /** The account's XP after a credited run (GET /api/user/xp). */
  accountXp: 0,
  /** Right answers the question hour held back (migration 060), per run. */
  held: null as null | { questions: number; availableAt: string },
  /** "Show my name and photo on leaderboards". */
  visible: false,
  scores: [] as { name: string; runToken: string }[],
  /** The learner's Shark Cards (GET/POST /api/flashcards). */
  cards: [] as Record<string, unknown>[],
  /** Question reports (POST /api/quiz/submit?resource=report). */
  reports: [] as Record<string, unknown>[],
}));

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  const fail = (status: number, code: string, message = code) => Promise.reject(new actual.ApiError(message, status, code));
  const apiFetch = async (url: string, opts: RequestInit = {}) => {
    const parsed = new URL(url, 'http://localhost');
    if (parsed.pathname === '/api/quiz/challenge' && (opts.method ?? 'GET') === 'GET') {
      if (parsed.searchParams.get('resource') === 'leaderboard') return { top: [], champion: null };
      api.batchRequests.push(parsed.searchParams);
      api.batchSignals.push(opts.signal ?? null);
      const request = api.batchRequests.length;
      const refusal = api.batchRefusal?.(request) ?? null;
      if (refusal) return fail(refusal.status, refusal.code);
      if (request === api.holdBatch) await new Promise<void>((release) => { api.release = release; });
      api.batches += 1;
      const batch = api.batches;
      const sessionId = `S${batch}`;
      const runToken = parsed.searchParams.get('runToken') ?? `RUN-${++api.runs}`;
      const questions = Array.from({ length: api.batchSize }, (_, i) => ({
        id: `b${batch}-q${i + 1}`,
        question: `Batch ${batch} question ${i + 1}?`,
        options: ['right', 'wrong'],
        category: 'javascript',
        difficulty: 1,
      }));
      api.sessions.set(sessionId, new Set(questions.map((q) => q.id)));
      return { sessionId, runToken, questions };
    }
    if (parsed.pathname === '/api/quiz/submit' && parsed.searchParams.get('resource') === 'report') {
      api.reports.push(JSON.parse(String(opts.body)) as Record<string, unknown>);
      return { ok: true };
    }
    if (parsed.pathname === '/api/quiz/submit') {
      const body = JSON.parse(String(opts.body)) as Body;
      const [questionId, selected] = Object.entries(body.answers)[0];
      api.gradeSignals.push(opts.signal ?? null);
      if (api.holdGrade) await api.holdGrade;
      const override = api.grade?.(body, questionId, selected) ?? null;
      const record = (status: number) => api.submits.push({ sessionId: body.sessionId, questionId, selected, status });
      if (override) {
        record(override.status);
        if (override.status !== 200) return fail(override.status, override.code ?? 'error', override.message);
        return override.json;
      }
      if (!api.sessions.get(body.sessionId)?.has(questionId)) {
        record(400);
        return fail(400, 'bad_request', 'Answers contain a question outside this session');
      }
      record(200);
      const isCorrect = selected === 0;
      const run = body.sessionId.replace(/^S/, 'run');
      return {
        totalQuestions: 1, correctAnswers: isCorrect ? 1 : 0, percentage: 0, questXp: 0,
        results: [{ questionId, selectedIndex: selected, correctAnswer: 0, isCorrect, explanation: 'Because.', scoreProof: `${run}:${questionId}:${isCorrect}` }],
      };
    }
    if (parsed.pathname === '/api/quiz/challenge' && parsed.searchParams.get('resource') === 'complete') {
      const body = JSON.parse(String(opts.body)) as { runToken: string; proofs: string[] };
      if (api.holdComplete) await api.holdComplete;
      const outcome = api.completeStatus(body.runToken);
      api.completions.push({ runToken: body.runToken, proofs: body.proofs, status: outcome.status });
      if (outcome.status !== 200) return fail(outcome.status, outcome.code ?? 'error');
      const score = body.proofs.filter((proof) => proof.endsWith(':true')).length;
      const held = api.held ? Math.min(api.held.questions, score) : 0;
      return { ok: true, awarded: score - held > 0 && !api.alreadyAwarded.has(body.runToken), score, xp: (score - held) * 5, ...(api.held ? { xpHeld: api.held } : {}) };
    }
    if (parsed.pathname === '/api/quiz/challenge' && opts.method === 'POST' && !parsed.searchParams.has('resource')) {
      const body = JSON.parse(String(opts.body)) as { name: string; runToken: string };
      api.scores.push({ name: body.name, runToken: body.runToken });
      return { ok: true, record: null };
    }
    if (parsed.pathname === '/api/user/xp') {
      return { data: { quest_xp: api.accountXp, by_subject: api.accountXp ? { webdev: api.accountXp } : {} } };
    }
    if (parsed.pathname === '/api/user/leaderboard-visibility') return { visible: api.visible };
    if (parsed.pathname === '/api/flashcards') {
      if ((opts.method ?? 'GET') === 'GET') return { cards: api.cards };
      const card = JSON.parse(String(opts.body)) as Record<string, unknown>;
      api.cards.push(card);
      return { card };
    }
    return fail(404, 'not_found');
  };
  return { ...actual, apiFetch };
});
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/auth')>(),
  useAuth: () => api.auth,
}));
vi.mock('../src/components/LoadingScreen', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/components/LoadingScreen')>(),
  holdLoadingScreen: async () => undefined,
}));

const { default: Challenge } = await import('../src/components/Challenge');

const PENDING = 'studyshark:pending-challenge-reward:v1';

// The page holds its first draw for the board read, so it renders inside act.
async function mount(onActiveChange?: (active: boolean) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[{ pathname: '/challenge', key: `v${Math.random()}` }]}>
          <LanguageProvider><Challenge onActiveChange={onActiveChange} /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return view;
}

const settle = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });

async function start() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
  await screen.findByText(/^Batch \d+ question \d+\?$/);
}

/** Answer the question on screen and wait for its grade. */
async function answer(option: 'right' | 'wrong') {
  fireEvent.click(screen.getByRole('radio', { name: option }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: /Next question|See result/ });
}

async function next() {
  fireEvent.click(screen.getByRole('button', { name: /Next question|See result/ }));
  await settle();
}

const shownQuestion = () => screen.getByText(/^Batch \d+ question \d+\?$/).textContent;

beforeEach(() => {
  api.batchSize = 6;
  api.batches = 0;
  api.runs = 0;
  api.sessions.clear();
  api.batchRequests.length = 0;
  api.batchSignals.length = 0;
  api.submits.length = 0;
  api.grade = null;
  api.holdGrade = null;
  api.gradeSignals.length = 0;
  api.completions.length = 0;
  api.completeStatus = () => ({ status: 200 });
  api.alreadyAwarded.clear();
  api.holdComplete = null;
  api.auth = { user: null, isAuthenticated: false, isLoading: false };
  api.batchRefusal = null;
  api.holdBatch = 0;
  api.release = null;
  api.accountXp = 0;
  api.held = null;
  api.visible = false;
  api.scores.length = 0;
  api.cards.length = 0;
  api.reports.length = 0;
});
afterEach(() => vi.useRealTimers());

// Each test plays several questions through the real page.
vi.setConfig({ testTimeout: 20_000 });

describe('the question buffer', () => {
  it('grades a question shown while the buffer refills against the batch that issued it', async () => {
    await mount();
    await start();
    for (let n = 0; n < 8; n += 1) {
      await answer('right');
      await next();
    }
    expect(api.batches).toBeGreaterThanOrEqual(2);
    expect(api.submits.filter((submit) => submit.status !== 200)).toEqual([]);
    for (const submit of api.submits) {
      expect(api.sessions.get(submit.sessionId)?.has(submit.questionId), `${submit.questionId} went to ${submit.sessionId}`).toBe(true);
    }
    // Batch one's questions were still answered after batch two arrived.
    expect(api.submits.map((submit) => submit.questionId)).toEqual(expect.arrayContaining(['b1-q6', 'b2-q1']));
    // The refill asked to skip what was seen and what was still queued.
    expect(api.batchRequests[1].get('exclude')?.split(',').sort()).toEqual(['b1-q1', 'b1-q2', 'b1-q3', 'b1-q4', 'b1-q5', 'b1-q6']);
    expect(screen.getByLabelText('3 shark fins left')).toBeInTheDocument();
  });

  it('cancels a held question refill when the run’s route unmounts', async () => {
    api.holdBatch = 2;
    const view = await mount();
    await start();
    for (let n = 0; n < 2; n += 1) {
      await answer('right');
      await next();
    }
    await waitFor(() => expect(api.release).not.toBeNull());
    view.unmount();
    try {
      expect(api.batchSignals[1]?.aborted).toBe(true);
    } finally {
      await act(async () => { api.release?.(); });
    }
  });

  it('lets a question whose batch session expired go without a strike, and moves on to a fresh batch', async () => {
    await mount();
    await start();
    api.grade = (body) => (body.sessionId === 'S1' ? { status: 400, code: 'invalid_session', message: 'Quiz session expired or invalid' } : null);
    await answer('wrong');
    expect(screen.getByText('This question expired before your answer was checked, so it does not count.')).toBeInTheDocument();
    expect(screen.getByLabelText('3 shark fins left')).toBeInTheDocument();
    await next();
    await screen.findByText('Batch 2 question 1?');
    expect(api.batchRequests[1].get('runToken')).toBe('RUN-1');
    await answer('right');
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(api.submits[api.submits.length - 1]).toMatchObject({ sessionId: 'S2', questionId: 'b2-q1', status: 200 });
  });

  it('lets a question retired mid-run go without a strike or a proof', async () => {
    api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
    await mount();
    await start();
    api.grade = (_body, questionId) => (questionId === 'b1-q1'
      ? { status: 200, json: { totalQuestions: 0, correctAnswers: 0, percentage: 0, questXp: 0, results: [], voided: [questionId] } }
      : null);
    await answer('wrong');
    expect(screen.getByText('This question was retired while you were answering, so it does not count.')).toBeInTheDocument();
    expect(screen.getByLabelText('3 shark fins left')).toBeInTheDocument();
    await next();
    for (let strike = 0; strike < 3; strike += 1) {
      await answer('wrong');
      await next();
    }
    await screen.findByText('Run ended');
    // Retired questions do not count, and the zero result is never saved.
    await settle();
    expect(api.completions).toEqual([]);
  });
});

describe('the timeout strike', () => {
  it('is sent once when the clock runs out, and again only after a growing pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let refuse = true;
    let timeouts = 0;
    api.grade = (body) => {
      if (Object.values(body.answers)[0] !== -1) return null;
      timeouts += 1;
      // A bound on the stand-in, so a client that loops ends the loop.
      return refuse && timeouts <= 50 ? { status: 429, code: 'rate_limited', message: 'Too many requests. Try again shortly.' } : null;
    };
    await mount();
    await start();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    // The clock counts wall time, which on a slow runner also moves while
    // the test works, so the strike can go out a tick or two before 90.
    let second = 0;
    while (timeouts === 0 && second < 90) {
      await tick(1000);
      second += 1;
    }
    await settle();
    expect(timeouts).toBe(1);
    expect(screen.getByText('Time ran out. The strike could not be saved yet and will be sent again in a moment.')).toBeInTheDocument();
    // Nothing can be picked or sent once the clock is out.
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'right' })).toBeDisabled();

    // Retries wait 2 s, then 4 s, then 8 s.
    await tick(1500);
    expect(timeouts).toBe(1);
    await tick(1000);
    expect(timeouts).toBe(2);
    await tick(2500);
    expect(timeouts).toBe(2);
    await tick(1500);
    expect(timeouts).toBe(3);

    refuse = false;
    await tick(9000);
    await settle();
    expect(timeouts).toBe(4);
    expect(screen.getByText('Time ran out. One strike.')).toBeInTheDocument();
    expect(screen.getByLabelText('2 shark fins left')).toBeInTheDocument();
    await tick(60_000);
    expect(timeouts).toBe(4);
  });
});

describe('focus at time up', () => {
  // The verdict takes the focus the clock took away (UX audit U2,
  // questions-01): Enter or the next Tab goes on from it to Next.
  it('goes to the verdict when the clock disabled the focused Submit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let timeouts = 0;
    api.grade = (body) => {
      if (Object.values(body.answers)[0] === -1) timeouts += 1;
      return null;
    };
    await mount();
    await start();
    fireEvent.click(screen.getByRole('radio', { name: 'right' }));
    const submit = screen.getByRole('button', { name: 'Submit' });
    submit.focus();
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    // A browser drops the focus of a control that disables itself; jsdom
    // keeps it, so the test drops it as the browser would.
    // (jsdom's blur() ignores a disabled element, so the focus is moved to a
    // stand-in that is then removed, which leaves it on the page.)
    const fixup = new MutationObserver(() => {
      if (!(document.activeElement instanceof HTMLButtonElement && document.activeElement.disabled)) return;
      const standIn = document.createElement('span');
      standIn.tabIndex = -1;
      document.body.append(standIn);
      standIn.focus();
      standIn.remove();
    });
    fixup.observe(document.body, { attributes: true, attributeFilter: ['disabled'], subtree: true });
    let second = 0;
    while (timeouts === 0 && second < 95) {
      await tick(1000);
      second += 1;
    }
    await screen.findByText('Time ran out. One strike.');
    await settle();
    fixup.disconnect();
    expect(document.activeElement).toHaveClass('ss-question-feedback');
    expect(document.activeElement).toHaveTextContent('Time ran out. One strike.');
    // Enter on the verdict goes on to the next question.
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    await settle();
    expect(shownQuestion()).toBe('Batch 1 question 2?');
  });
});

describe('the run reward', () => {
  async function strikeOut(correctFirst = 0) {
    for (let n = 0; n < correctFirst; n += 1) {
      await answer('right');
      await next();
    }
    for (let strike = 0; strike < 3; strike += 1) {
      await answer('wrong');
      await next();
    }
    await screen.findByText('Run ended');
    await settle();
  }

  it('keeps a run whose completion failed and sends it again at the next game over', async () => {
    api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
    api.completeStatus = (runToken) => (runToken === 'RUN-1' && api.completions.length === 0 ? { status: 429, code: 'rate_limited' } : { status: 200 });
    await mount();
    await start();
    await strikeOut(1);
    expect(JSON.parse(localStorage.getItem(PENDING) ?? '[]')).toEqual([expect.objectContaining({ runToken: 'RUN-1' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    await screen.findByText(/^Batch \d+ question \d+\?$/);
    await strikeOut(1);
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    expect(api.completions.map(({ runToken, status }) => [runToken, status])).toEqual([['RUN-1', 429], ['RUN-1', 200], ['RUN-2', 200]]);
  });

  it.each([
    ['right:true', true],
    ['wrong:false', false],
  ])('updates Profile after finishing a saved run with proof %s', async (proof, invalidated) => {
    api.auth = SIGNED_IN;
    const profile = ['profile-stats', SIGNED_IN.user.id] as const;
    queryClient.setQueryData(profile, { current_streak: 5 });
    localStorage.setItem(PENDING, JSON.stringify([{ userId: SIGNED_IN.user.id, runToken: 'PENDING', proofs: [proof] }]));
    try {
      await mount();
      await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
      await settle();
      expect(queryClient.getQueryState(profile)?.isInvalidated).toBe(invalidated);
    } finally {
      queryClient.removeQueries({ queryKey: profile, exact: true });
    }
  });

  it('refreshes XP and profile stats when a replay confirms a previously credited run', async () => {
    const gains: number[] = [];
    const stop = onXpToast((toast) => { if (toast.kind === 'gain') gains.push(toast.amount); });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    try {
      api.auth = SIGNED_IN;
      api.accountXp = 15;
      api.alreadyAwarded.add('CREDITED');
      localStorage.setItem(PENDING, JSON.stringify([{ userId: SIGNED_IN.user.id, runToken: 'CREDITED', proofs: ['right:true'] }]));
      await mount();
      await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
      await waitFor(() => expect(getTotalXp()).toBe(15));
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['profile-stats'] });
      expect(gains).toEqual([]);
      expect(api.completions.map(({ runToken }) => runToken)).toEqual(['CREDITED']);
    } finally {
      invalidate.mockRestore();
      stop();
    }
  });

  it('drops a saved run the server can never credit, and keeps one it only turned away for now', async () => {
    api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
    // The first version stored one run, not a list.
    localStorage.setItem(PENDING, JSON.stringify({ userId: 'learner-1', runToken: 'EXPIRED', proofs: [] }));
    api.completeStatus = (runToken) => (runToken === 'EXPIRED' ? { status: 400, code: 'invalid_run' } : { status: 200 });
    const first = await mount();
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
    expect(api.completions.map((one) => one.runToken)).toEqual(['EXPIRED']);
    first.unmount();

    localStorage.setItem(PENDING, JSON.stringify([{ userId: 'learner-1', runToken: 'OFFLINE', proofs: [] }]));
    api.completeStatus = () => ({ status: 503, code: 'backend_unavailable' });
    await mount();
    await waitFor(() => expect(api.completions.map((one) => one.runToken)).toEqual(['EXPIRED', 'OFFLINE']));
    await settle();
    expect(JSON.parse(localStorage.getItem(PENDING) ?? '[]')).toEqual([expect.objectContaining({ runToken: 'OFFLINE' })]);
  });

  it('drops a saved run the board already holds with another result, instead of sending it at every game over', async () => {
    api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
    localStorage.setItem(PENDING, JSON.stringify([{ userId: 'learner-1', runToken: 'SAVED-ELSEWHERE', proofs: [] }]));
    api.completeStatus = () => ({ status: 409, code: 'run_already_saved' });
    await mount();
    await waitFor(() => expect(api.completions.map((one) => one.runToken)).toEqual(['SAVED-ELSEWHERE']));
    await waitFor(() => expect(localStorage.getItem(PENDING)).toBeNull());
  });

  it('announces the XP the server credited to a signed-in learner, and counts the same amount signed out', async () => {
    const gains: number[] = [];
    const stop = onXpToast((toast: XpToast) => { if (toast.kind === 'gain') gains.push(toast.amount); });
    try {
      api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
      const first = await mount();
      await start();
      await strikeOut(2);
      await waitFor(() => expect(gains).toEqual([10]));
      expect(api.completions).toHaveLength(1);
      first.unmount();

      api.auth = { user: null, isAuthenticated: false, isLoading: false };
      await mount();
      await start();
      await strikeOut(2);
      expect(gains).toEqual([10, 10]);
      expect(api.completions).toHaveLength(2);
    } finally {
      stop();
    }
  });

  it('announces nothing when the account signs out while the run’s reward is on its way', async () => {
    const gains: number[] = [];
    const stop = onXpToast((toast: XpToast) => { if (toast.kind === 'gain') gains.push(toast.amount); });
    let release!: () => void;
    api.holdComplete = new Promise<void>((resolve) => { release = resolve; });
    try {
      api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
      await mount();
      await start();
      await strikeOut(2);
      clearAccountData();
      await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)); });
      await settle();
      expect(api.completions).toHaveLength(1);
      expect(gains).toEqual([]);
    } finally {
      stop();
    }
  });

  // Owner decision 12: the game-over screen reviews the run's misses, and each
  // can be kept as a Shark Card with the answer and explanation graded here.
  it('lists the questions the run missed at game over, each with Save as Shark Card', async () => {
    api.auth = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
    await mount();
    await start();
    await strikeOut(1);
    const review = await screen.findByRole('region', { name: 'Questions you missed' });
    const items = within(review).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText('Batch 1 question 2?')).toBeInTheDocument();
    expect(within(items[0]).getByText('right')).toBeInTheDocument();
    expect(within(items[0]).getByText('Because.')).toBeInTheDocument();
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Save as a Shark Card' }));
    await waitFor(() => expect(api.cards).toHaveLength(1));
    expect(api.cards[0]).toEqual({
      question_id: 'b1-q2', question: 'Batch 1 question 2?', category: 'javascript',
      correct_answer: 'right', explanation: 'Because.', subject: 'webdev',
    });
    const savedButton = await within(items[0]).findByRole('button', { name: 'Saved as Shark Card' });
    await waitFor(() => expect(savedButton).toBeEnabled());
    expect(savedButton).toHaveAttribute('aria-pressed', 'true');
    // A new run starts with nothing missed.
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    await screen.findByText(/^Batch \d+ question \d+\?$/);
    await strikeOut(1);
    expect(within(await screen.findByRole('region', { name: 'Questions you missed' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('calls the board what it is: all-time top scores', async () => {
    await mount();
    expect(await screen.findByRole('heading', { name: 'Top scores' })).toBeInTheDocument();
    expect(screen.queryByText(/today/i)).toBeNull();
  });
});

const SIGNED_IN = { user: { id: 'learner-1' }, isAuthenticated: true, isLoading: false };
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const clockSeconds = () => {
  const [minutes, seconds] = (screen.getByRole('timer').textContent ?? '').split(':').map(Number);
  return minutes * 60 + seconds;
};
async function strikeOutNow() {
  for (let strike = 0; strike < 3; strike += 1) {
    await answer('wrong');
    await next();
  }
  await screen.findByText('Run ended');
  await settle();
}

describe('a refill that fails when the queue runs dry', () => {
  it('keeps the run, and Retry asks for the batch again under the same run', async () => {
    api.auth = SIGNED_IN;
    let online = false;
    api.batchRefusal = (n) => (n > 1 && !online ? { status: 0, code: 'network' } : null);
    await mount();
    await start();
    for (let n = 0; n < 6; n += 1) {
      await answer('right');
      if (n < 5) await next();
    }
    // The sixth answer emptied the queue, and every refill so far failed.
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(await screen.findByText('Could not load the next question. Your run and score are kept.')).toBeInTheDocument();
    expect(screen.queryByText('No questions available right now.')).toBeNull();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(api.completions).toEqual([]);

    online = true;
    const sent = api.batchRequests.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Batch 2 question 1?');
    expect(api.batchRequests).toHaveLength(sent + 1);
    expect(api.batchRequests[sent].get('runToken')).toBe('RUN-1');

    // The run goes on to its end and is credited with every answer.
    await strikeOutNow();
    await waitFor(() => expect(api.completions).toHaveLength(1));
    expect(api.completions[0].runToken).toBe('RUN-1');
    expect(api.completions[0].proofs.filter((proof) => proof.endsWith(':true'))).toHaveLength(6);
  });
});

describe('Play again while the last run’s refill is in flight', () => {
  it('starts a new run, and the old refill joins nothing', async () => {
    api.auth = SIGNED_IN;
    api.holdBatch = 2;
    await mount();
    await start();
    // After the second answer four questions are queued: RUN-1's refill goes out and hangs.
    await answer('right'); await next();
    await strikeOutNow();
    await waitFor(() => expect(api.completions.map((one) => one.runToken)).toEqual(['RUN-1']));
    expect(api.batchRequests).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    await settle();
    await act(async () => { api.release!(); });
    await settle();
    await screen.findByText(/^Batch \d question 1\?$/);
    expect(api.batchRequests).toHaveLength(3);
    expect(api.batchRequests[2].get('runToken')).toBeNull();

    await answer('right'); await next();
    await strikeOutNow();
    await waitFor(() => expect(api.completions).toHaveLength(2));
    expect(api.completions[1].runToken).toBe('RUN-2');
    // None of the old run's late batch was played in the new one.
    expect(api.submits.filter((submit) => submit.sessionId === 'S3')).toEqual([]);
  });
});

describe('a grade whose response was lost', () => {
  it('is replayed when the learner picks again, and when the clock runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.auth = SIGNED_IN;
    // The server grades a question once: the same pick replays the grade, any
    // other is refused. The responses to the first grades of two questions
    // never arrive.
    const graded = new Map<string, number>();
    const lost = new Set(['b1-q1', 'b1-q2']);
    api.grade = (_body, questionId, selected) => {
      const first = graded.get(questionId);
      if (first !== undefined && first !== selected) {
        return { status: 409, code: 'attempt_already_graded', message: 'This answer has already been graded and cannot be changed' };
      }
      graded.set(questionId, selected);
      return lost.delete(questionId) ? { status: 0, code: 'network', message: 'Network error' } : null;
    };
    await mount();
    await start();

    // "right" is graded, its response is lost; the learner switches to "wrong".
    fireEvent.click(screen.getByRole('radio', { name: 'right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await settle();
    fireEvent.click(screen.getByRole('radio', { name: 'wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Correct')).toBeInTheDocument();
    expect(screen.getByLabelText('3 shark fins left')).toBeInTheDocument();
    await next();

    // "wrong" is graded, its response is lost, and the clock runs out.
    fireEvent.click(screen.getByRole('radio', { name: 'wrong' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await settle();
    for (let second = 0; second < 91; second += 1) await tick(1000);
    await settle();
    expect(screen.getByText('Wrong')).toBeInTheDocument();
    expect(screen.getByLabelText('2 shark fins left')).toBeInTheDocument();
    await next();

    for (let strike = 0; strike < 2; strike += 1) {
      await answer('wrong');
      await next();
    }
    await screen.findByText('Run ended');
    await waitFor(() => expect(api.completions).toHaveLength(1));
    // One correct answer and three strikes, each with its proof: the run completes.
    expect(api.completions[0].status).toBe(200);
    expect(api.completions[0].proofs.filter((proof) => proof.endsWith(':true'))).toHaveLength(1);
    expect(api.completions[0].proofs.filter((proof) => proof.endsWith(':false'))).toHaveLength(3);
  });
});

describe('focus', () => {
  it('goes to each new question, from Start and from Next', async () => {
    await mount();
    await start();
    // Focus moves in an effect after the question paints; wait for it.
    await waitFor(() => expect(document.activeElement?.id).toBe('challenge-question'));
    expect(document.activeElement).toHaveTextContent('Batch 1 question 1?');
    await answer('right');
    await next();
    await waitFor(() => expect(document.activeElement).toHaveTextContent('Batch 1 question 2?'));
    expect(document.activeElement?.id).toBe('challenge-question');
  });

  // Supabase hands a new user object on a token refresh or a return to the
  // tab. The game-over screen took the focus back from wherever it was then.
  it('stays where the learner put it on the game-over screen when the session refreshes', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const tree = () => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/challenge']}>
          <LanguageProvider><Challenge /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const frame = () => act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
    api.auth = { ...SIGNED_IN, user: { id: 'learner-1' } };
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(tree()); });
    await start();
    await strikeOutNow();
    await frame();
    const playAgain = screen.getByRole('button', { name: 'Play again' });
    act(() => playAgain.focus());
    api.auth = { ...SIGNED_IN, user: { id: 'learner-1' } };
    await act(async () => { view.rerender(tree()); });
    await frame();
    expect(document.activeElement).toBe(playAgain);
  });
});

describe('the verdict', () => {
  // UX audit U2, questions-01: the verdict sits in normal flow under the
  // answers and takes the focus, so a screen reader reads it; it used to
  // float over the answers it graded.
  it('takes the focus under the answers, with its explanation', async () => {
    await mount();
    await start();
    await answer('right');
    const verdict = document.activeElement as HTMLElement;
    expect(verdict).toHaveClass('ss-question-feedback');
    expect(verdict).toHaveTextContent('Correct');
    expect(verdict).toHaveTextContent('Because.');
    const list = screen.getByRole('radiogroup');
    expect(list.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(verdict.closest('.ss-question__panel')).not.toBeNull();
    expect(verdict.getAttribute('style') ?? '').not.toMatch(/absolute/);
  });

  it('marks the right answer and a wrong pick in words, not colour alone', async () => {
    await mount();
    await start();
    await answer('wrong');
    expect(screen.getByRole('radio', { name: 'right, Correct answer' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'wrong, Your pick' })).toBeDisabled();
    expect(screen.getByText('Your pick')).toBeInTheDocument();
  });

  it('shows the one keyboard hint, naming what Enter does now', async () => {
    await mount();
    await start();
    expect(screen.getByText('Press 1–2 to select')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'right' }));
    expect(screen.getByText('Press 1–2 to select · Enter to submit')).toBeInTheDocument();
    // Graded, no key picks an answer: the line keeps its place, hidden.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await screen.findByRole('button', { name: /Next question|See result/ });
    const hint = document.querySelector('.ss-question-hint')!;
    expect(hint).toHaveAttribute('data-hidden', 'true');
    expect(hint).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('the fins left', () => {
  it('are named as an image, so a screen reader reads them', async () => {
    await mount();
    await start();
    expect(screen.getByRole('img', { name: '3 shark fins left' })).toBeInTheDocument();
    await answer('wrong');
    expect(screen.getByRole('img', { name: '2 shark fins left' })).toBeInTheDocument();
  });
});

describe('a double press', () => {
  // Both presses land before React renders the busy button.
  it('grades the pick once, so its point counts once', async () => {
    await mount();
    await start();
    fireEvent.click(screen.getByRole('radio', { name: 'right' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      fireEvent.keyDown(document.body, { key: 'Enter' });
    });
    await screen.findByRole('button', { name: /Next question|See result/ });
    await settle();
    expect(api.submits).toHaveLength(1);
    expect(screen.getByText('Score').nextElementSibling).toHaveTextContent('1');
  });

  it('moves on one question, so none is skipped unseen', async () => {
    await mount();
    await start();
    expect(shownQuestion()).toBe('Batch 1 question 1?');
    await answer('right');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
      fireEvent.click(screen.getByRole('button', { name: /Next question|Submit/ }));
    });
    await settle();
    expect(shownQuestion()).toBe('Batch 1 question 2?');
  });
});

describe('the ranked clock', () => {
  it('counts the time the page spent in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    await start();
    // Each second is its own act, so the page renders between them.
    const seconds = async (n: number) => { for (let second = 0; second < n; second += 1) await tick(1000); };
    await seconds(5);
    const before = clockSeconds();
    expect(before).toBeLessThanOrEqual(85);
    // A phone switched to another app for 80 s: the wall clock moves, and no
    // timer runs until the page is back.
    vi.setSystemTime(Date.now() + 80_000);
    await tick(1_000);
    expect(before - clockSeconds()).toBeGreaterThanOrEqual(80);
    await seconds(clockSeconds() + 1);
    await settle();
    expect(api.submits.some((submit) => submit.selected === -1)).toBe(true);
    expect(screen.getByText('Time ran out. One strike.')).toBeInTheDocument();
  });
});

describe('automatic Challenge results', () => {
  it('saves a positive guest result automatically with no name form', async () => {
    await mount(); await start();
    await answer('right'); await next(); await strikeOutNow(); await settle();
    expect(api.completions).toHaveLength(1);
    expect(api.completions[0].proofs).toHaveLength(4);
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(screen.queryByText('Save your score')).toBeNull();
    expect(api.scores).toEqual([]);
  });
  it('does not submit an all-strike zero score', async () => {
    await mount(); await start(); await strikeOutNow(); await settle();
    expect(api.completions).toEqual([]);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });
});

// Migration 060: a right answer whose question paid XP less than an hour ago
// pays nothing (058). The completion names those answers and when the last
// of them pays again; the learner hears it after the gain, and also when no
// answer paid at all.
describe('answers the hour held back', () => {
  for (const [label, held, gains] of [
    ['one of two', { questions: 1, availableAt: '2026-10-09T14:32:00.000Z' }, [5]],
    ['every one', { questions: 2, availableAt: '2026-10-09T14:40:00.000Z' }, []],
  ] as const) {
    it(`are told in a toast when ${label} is held back`, async () => {
      const toasts: XpToast[] = [];
      const stop = onXpToast((toast: XpToast) => toasts.push(toast));
      try {
        api.auth = SIGNED_IN;
        api.held = held;
        await mount();
        await start();
        await answer('right');
        await next();
        await answer('right');
        await next();
        await strikeOutNow();
        const expected: XpToast[] = [
          ...gains.map((amount) => ({ kind: 'gain', amount, source: 'quiz' }) as XpToast),
          { kind: 'held', hold: { on: 'questions', count: held.questions, availableAt: held.availableAt } },
        ];
        await waitFor(() => expect(toasts.filter((toast) => toast.kind !== 'rankup')).toEqual(expected));
      } finally {
        stop();
      }
    });
  }
});

describe('a run’s rank-up', () => {
  it('is announced when the run’s XP crosses a rank', async () => {
    const toasts: XpToast[] = [];
    const stop = onXpToast((toast: XpToast) => toasts.push(toast));
    try {
      primeRankMarker();
      api.auth = SIGNED_IN;
      // The account's balance once the run is credited crosses 2000 XP.
      api.accountXp = 2020;
      await mount();
      await start();
      await answer('right');
      await next();
      await strikeOutNow();
      await waitFor(() => expect(toasts.map((toast) => toast.kind)).toEqual(['gain', 'rankup']));
    } finally {
      stop();
    }
  });
});

// UX audit U2, questions-07: a live run hides the site chrome as the Quiz
// does, so the run needs its own way out and its own report.
describe('focus mode', () => {
  const last = (list: boolean[]) => list[list.length - 1];
  // jsdom has no modal dialogs; Astryx opens its dialogs with showModal().
  const dialogProto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  dialogProto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  dialogProto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

  it('is on while a run is live and off on the intro, the game over and when the page goes', async () => {
    const active: boolean[] = [];
    const view = await mount((on) => active.push(on));
    expect(last(active)).toBe(false);
    await start();
    expect(last(active)).toBe(true);
    await strikeOutNow();
    expect(last(active)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }));
    await screen.findByText(/^Batch \d+ question \d+\?$/);
    expect(last(active)).toBe(true);
    view.unmount();
    expect(last(active)).toBe(false);
  });

  it('offers Exit, which asks first and then leaves the run without saving it', async () => {
    const active: boolean[] = [];
    await mount((on) => active.push(on));
    await start();
    await answer('right');
    await next();
    fireEvent.click(screen.getByRole('button', { name: 'Exit run' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('The run ends here, and its score is not saved.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep playing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(shownQuestion()).toBe('Batch 1 question 2?');

    fireEvent.click(screen.getByRole('button', { name: 'Exit run' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave run' }));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
    // The intro's h1 takes the focus the Leave button had.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Biggest Shark Challenge' })));
    expect(last(active)).toBe(false);
    await settle();
    expect(api.completions).toEqual([]);
    expect(localStorage.getItem(PENDING)).toBeNull();
  });

  it('keeps a late grade from an exited run out of the next run', async () => {
    let release!: () => void;
    api.holdGrade = new Promise<void>((resolve) => { release = resolve; });
    await mount();
    await start();
    fireEvent.click(screen.getByRole('radio', { name: 'right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(api.gradeSignals).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Exit run' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave run' }));
    await start();
    expect(shownQuestion()).toBe('Batch 2 question 1?');
    api.holdGrade = null;
    release();
    await settle();

    expect(screen.queryByText('Correct')).toBeNull();
    expect(api.gradeSignals[0]?.aborted).toBe(true);
    await answer('wrong');
    expect(screen.getByText('Wrong')).toBeInTheDocument();
    expect(api.submits[1]).toMatchObject({ sessionId: 'S2', questionId: 'b2-q1' });
  });

  it('ends on the run’s action row, with Play again as the one SwimCta', async () => {
    await mount();
    await start();
    await strikeOutNow();
    const again = screen.getByRole('button', { name: 'Play again' });
    expect(again).toHaveClass('ss-swim-cta');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(again.closest('.ss-question-actions')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Back' }).closest('.ss-question-actions__secondary')).not.toBeNull();
  });

  it('rests the run keys while a dialog is open, so a digit or Enter in it acts on nothing behind it', async () => {
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Exit run' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: '1' });
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getByRole('radio', { name: 'right' })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep playing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    // Closed, the keys work again while the question has focus.
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getByRole('radio', { name: 'right' })).toHaveAttribute('aria-checked', 'false');
    const question = document.querySelector<HTMLElement>('.ss-question__block')!;
    question.focus();
    fireEvent.keyDown(question, { key: '1' });
    expect(screen.getByRole('radio', { name: 'right' })).toHaveAttribute('aria-checked', 'true');
  });

  it('lets the learner report the question on screen', async () => {
    await mount();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Report this question' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(api.reports).toHaveLength(1));
    expect(api.reports[0]).toMatchObject({ question_id: 'b1-q1', reason: 'incorrect-answer' });
    expect(await screen.findByText('Thanks, report sent')).toBeInTheDocument();
  });
});
