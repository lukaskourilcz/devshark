// The public question of the day (#239). Invented question
// fixtures; the wire shapes are the real ones.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import DailyQuestionPage from '../src/components/DailyQuestionPage';
import { en } from '../src/i18n/translations';
import { addDays, qotdTrack, utcToday } from '../../shared/daily-question';
import { server } from './mocks/server';

const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock('../src/lib/analytics', async (importOriginal) => ({ ...(await importOriginal<object>()), capture: analytics.capture }));
// Signed out unless a test signs in (Save as Shark Card needs an account).
const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ ...auth.value, signInWithGoogle: async () => {} }),
}));

const today = utcToday();
const trackName = (date: string) => en[`category.${qotdTrack(date)}` as keyof typeof en];
const QUESTION = {
  date: today,
  track: qotdTrack(today),
  sessionId: 'sealed-session',
  question: { id: 'q-1', question: 'Which value does `typeof null` return?', options: ['"null"', '"object"', '"undefined"', '"number"'], category: qotdTrack(today), difficulty: 2 },
};

function Where() {
  const at = useLocation();
  return <p>{`At ${at.pathname}${at.search}`}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <Routes>
            <Route path="/daily" element={<DailyQuestionPage />} />
            <Route path="/daily/:date" element={<DailyQuestionPage />} />
            <Route path="/quiz" element={<Where />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };
beforeEach(() => {
  auth.value = { user: null, isAuthenticated: false, isLoading: false };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  clipboard.writeText.mockClear();
  analytics.capture.mockClear();
});

describe('/daily', () => {
  it('shows the day’s question, checks one answer on the server and records nothing', async () => {
    const asked: string[] = [];
    const sent: unknown[] = [];
    server.use(
      http.get('*/api/quiz/daily', ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(QUESTION);
      }),
      http.post('*/api/quiz/submit', async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({
          totalQuestions: 1, correctAnswers: 1, percentage: 100, questXp: 2,
          results: [{ questionId: 'q-1', selectedIndex: 1, correctAnswer: 1, isCorrect: true, explanation: 'typeof null is "object", a historical quirk.' }],
        });
      }),
    );
    renderAt('/daily');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent(`${trackName(today)} question of the day`);
    // The day is the kicker over the h1; no separate date line (questions-11).
    const day = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));
    expect(h1.previousElementSibling).toHaveTextContent(day);
    expect(h1.previousElementSibling!.querySelector('time')).toHaveAttribute('datetime', today);
    expect(screen.getAllByText(day)).toHaveLength(1);
    const options = await screen.findAllByRole('radio');
    expect(options).toHaveLength(4);
    expect(asked).toEqual([`?qotd=${today}`]);
    const check = screen.getByRole('button', { name: 'Check answer' });
    expect(check).toBeDisabled();
    fireEvent.click(options[1]);
    fireEvent.click(check);
    expect(await screen.findByText('Right answer')).toBeInTheDocument();
    expect(screen.getByText('typeof null is "object", a historical quirk.')).toBeInTheDocument();
    expect(sent).toEqual([{ sessionId: 'sealed-session', answers: { 'q-1': 1 } }]);
    expect(screen.getByRole('radio', { name: '"object", Correct answer' })).toBeDisabled();
    // The one primary after the check, in the shared action row (UX audit U2).
    expect(screen.getByRole('button', { name: `Practice ${trackName(today)} questions` })).toHaveClass('ss-swim-cta');
    // Said once, in the lead (questions-11): no practice note repeats it.
    expect(screen.getByText(/nothing is recorded/)).toHaveTextContent('One question a day from a different track. No account needed; nothing is recorded.');
    // The share status takes no line until it has something to say.
    expect(document.querySelector('.ss-daily__status')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('button', { name: 'Share this question' }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/daily/${today}`));
    expect(analytics.capture).toHaveBeenCalledWith('share_initiated', { kind: 'daily_question', source: 'daily', method: 'copy' });
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Practice ${trackName(today)} questions` }));
    expect(await screen.findByText(`At /quiz?category=${qotdTrack(today)}`)).toBeInTheDocument();
  });

  it('opens the new UTC day’s question when an overnight tab becomes visible', async () => {
    const before = '2026-11-09';
    const after = '2026-11-10';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(`${before}T23:59:30Z`));
      server.use(http.get('*/api/quiz/daily', ({ request }) => {
        const requested = new URL(request.url).searchParams.get('qotd');
        const date = requested && requested !== 'today' ? requested : utcToday();
        const track = qotdTrack(date);
        return HttpResponse.json({
          ...QUESTION, date, track, sessionId: `session-${date}`,
          question: { ...QUESTION.question, question: `Question for ${date}`, category: track },
        });
      }));
      renderAt('/daily');
      expect(await screen.findByText(`Question for ${before}`)).toBeVisible();
      vi.setSystemTime(new Date(`${after}T00:00:30Z`));
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(await screen.findByText(`Question for ${after}`)).toBeVisible();
      expect(screen.queryByText(`Question for ${before}`)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks a wrong pick in words, not colour alone', async () => {
    server.use(
      http.get('*/api/quiz/daily', () => HttpResponse.json(QUESTION)),
      http.post('*/api/quiz/submit', () => HttpResponse.json({
        totalQuestions: 1, correctAnswers: 0, percentage: 0, questXp: 0,
        results: [{ questionId: 'q-1', selectedIndex: 0, correctAnswer: 1, isCorrect: false, explanation: 'It is "object".' }],
      })),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('Not this one')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '"null", Your pick' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '"object", Correct answer' })).toBeInTheDocument();
    // The verdict sits under the answers it grades, never over them (questions-01).
    const verdict = screen.getByText('Not this one').closest('.ss-question-feedback')!;
    expect(screen.getByRole('radiogroup').compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Signed out, there is no account to keep a Shark Card in.
    expect(screen.queryByRole('button', { name: /Shark Card/ })).toBeNull();
  });

  it('offers a signed-in learner Save as Shark Card under a wrong answer, with the answer and explanation checked here', async () => {
    auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
    const saved: Record<string, unknown>[] = [];
    server.use(
      http.get('*/api/quiz/daily', () => HttpResponse.json(QUESTION)),
      http.post('*/api/quiz/submit', () => HttpResponse.json({
        totalQuestions: 1, correctAnswers: 0, percentage: 0, questXp: 0,
        results: [{ questionId: 'q-1', selectedIndex: 0, correctAnswer: 1, isCorrect: false, explanation: 'It is "object".' }],
      })),
      http.get('*/api/flashcards', () => HttpResponse.json({ cards: saved })),
      http.post('*/api/flashcards', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        saved.push({ ...body, created_at: '2026-10-01T10:00:00Z' });
        return HttpResponse.json({ card: body });
      }),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    const saveButton = await screen.findByRole('button', { name: 'Save as a Shark Card' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await waitFor(() => expect(saved).toHaveLength(1));
    const savedButton = await screen.findByRole('button', { name: 'Saved as Shark Card' });
    await waitFor(() => expect(savedButton).toBeEnabled());
    expect(savedButton).toHaveAttribute('aria-pressed', 'true');
    expect(saved[0]).toMatchObject({ question_id: 'q-1', correct_answer: '"object"', explanation: 'It is "object".', category: QUESTION.question.category });
  });

  it('moves focus to the verdict, since Check answer leaves with the check', async () => {
    server.use(
      http.get('*/api/quiz/daily', () => HttpResponse.json(QUESTION)),
      http.post('*/api/quiz/submit', () => HttpResponse.json({
        totalQuestions: 1, correctAnswers: 0, percentage: 0, questXp: 0,
        results: [{ questionId: 'q-1', selectedIndex: 0, correctAnswer: 1, isCorrect: false, explanation: 'It is "object".' }],
      })),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    const check = screen.getByRole('button', { name: 'Check answer' });
    check.focus();
    fireEvent.click(check);
    await screen.findByText('Not this one');
    await waitFor(() => expect(document.activeElement).toHaveClass('ss-question-feedback'));
    expect(document.activeElement).toHaveTextContent('Not this one');
    expect(document.activeElement).toHaveTextContent('It is "object".');
  });

  it('does not ask the server for a day that has not come yet', () => {
    const tomorrow = addDays(today, 1);
    renderAt(`/daily/${tomorrow}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(`${trackName(tomorrow)} question of the day`);
    expect(screen.getByText(/is not out yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today’s question' })).toHaveAttribute('href', '/daily');
  });

  it('says there is no question for a date that is not one', () => {
    renderAt('/daily/not-a-date');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Question of the day');
    expect(screen.getByText('There is no question of the day for that date.')).toBeInTheDocument();
  });

  // The server seals a fresh session on every read and one check claims it.
  // The old mock answered every read with the same session, so the test
  // passed while a reload that got the claimed session back stayed stuck on
  // the expired banner.
  it.each([
    ['has expired', 'invalid_session', 400],
    ['was already checked', 'attempt_already_graded', 409],
  ])('loads the question again, with a fresh session, when its session %s', async (_, code, status) => {
    const reads: RequestCache[] = [];
    const checkedWith: string[] = [];
    server.use(
      http.get('*/api/quiz/daily', ({ request }) => {
        reads.push(request.cache);
        return HttpResponse.json({ ...QUESTION, sessionId: `sealed-session-${reads.length}` });
      }),
      http.post('*/api/quiz/submit', async ({ request }) => {
        const { sessionId } = await request.json() as { sessionId: string };
        checkedWith.push(sessionId);
        if (sessionId === 'sealed-session-1') return HttpResponse.json({ error: { code, message: 'That session cannot be checked' } }, { status });
        return HttpResponse.json({
          totalQuestions: 1, correctAnswers: 1, percentage: 100,
          results: [{ questionId: 'q-1', selectedIndex: 1, correctAnswer: 1, isCorrect: true, explanation: '`typeof null` is "object", a quirk kept for compatibility.' }],
        });
      }),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load it again' }));
    // The question is back, unanswered, and checks against the new session.
    fireEvent.click((await screen.findAllByRole('radio'))[1]);
    expect(screen.queryByRole('button', { name: 'Load it again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(await screen.findByText('Right answer')).toBeInTheDocument();
    expect(checkedWith).toEqual(['sealed-session-1', 'sealed-session-2']);
    // Each read goes to the server, never to a response the browser kept.
    expect(reads).toEqual(['no-store', 'no-store']);
  });

  it('keeps the focus through an expired check and the reload that follows', async () => {
    let reads = 0;
    server.use(
      http.get('*/api/quiz/daily', () => { reads++; return HttpResponse.json({ ...QUESTION, sessionId: `sealed-session-${reads}` }); }),
      http.post('*/api/quiz/submit', () => HttpResponse.json({ error: { code: 'invalid_session', message: 'expired' } }, { status: 400 })),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    const again = await screen.findByRole('button', { name: 'Load it again' });
    await waitFor(() => expect(document.activeElement).toContainElement(again));
    expect(document.activeElement).not.toBe(document.body);
    fireEvent.click(again);
    await screen.findByRole('button', { name: 'Check answer' });
    await waitFor(() => expect(document.activeElement).toHaveClass('ss-question__block'));
  });

  it('starts the question over even if a reload brings back the same session', async () => {
    // What a browser that still holds a cached response hands back.
    let reads = 0;
    server.use(
      http.get('*/api/quiz/daily', () => { reads++; return HttpResponse.json(QUESTION); }),
      http.post('*/api/quiz/submit', () => HttpResponse.json({ error: { code: 'attempt_already_graded', message: 'already graded' } }, { status: 409 })),
    );
    renderAt('/daily');
    fireEvent.click((await screen.findAllByRole('radio'))[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load it again' }));
    await waitFor(() => expect(reads).toBe(2));
    expect(await screen.findByRole('button', { name: 'Check answer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load it again' })).toBeNull();
  });

  it('shows an alert with Retry when the question cannot load', async () => {
    let reads = 0;
    server.use(http.get('*/api/quiz/daily', () => { reads++; return HttpResponse.json({ error: { code: 'db_error', message: 'x' } }, { status: 500 }); }));
    renderAt('/daily');
    // One quiet retry for a server error, then the alert.
    expect(await screen.findByText('The question could not load. Try again in a moment.', undefined, { timeout: 5000 })).toBeInTheDocument();
    const before = reads;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(reads).toBeGreaterThan(before));
  });
});
