// The solo quiz (Quiz.tsx) and the results that wait to be saved
// (PendingQuizResults). Invented question fixtures; the wire shapes are the
// real ones from api/quiz/questions, daily, submit and api/user/stats.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { queryClient } from '../src/lib/queryClient';
import { DEFAULT_CONFIG } from '../src/lib/gameConfig';
import { server } from './mocks/server';
import { localDayChangeTime } from '../src/lib/utcDay';

// Each test renders the whole quiz and walks through it.
vi.setConfig({ testTimeout: 30_000 });

const auth = vi.hoisted(() => ({
  value: { user: null as null | { id: string; email: string; user_metadata: object }, isAuthenticated: false, isLoading: false },
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAuth: () => ({ ...auth.value, signInWithGoogle: async () => {}, signOut: async () => {}, signInResumeFailed: false }),
}));
// The loading screen holds for over a second so it never flickers; nothing
// here is about that.
vi.mock('../src/components/LoadingScreen', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  holdLoadingScreen: () => Promise.resolve(),
}));

import Quiz from '../src/components/Quiz';
import PendingQuizResults from '../src/components/PendingQuizResults';
import Leaderboard from '../src/components/Leaderboard';
import { onXpToast } from '../src/lib/xp';
import { clearAccountData } from '../src/lib/accountData';

// jsdom has no modal dialogs; leaving a quiz confirms in one.
const dialogProto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogProto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
dialogProto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };

const LEARNER = { id: 'user-quiz-test-0001', email: 'learner@example.test', user_metadata: {} };
const PROGRESS_KEY = 'devquiz:in-progress';
const PENDING_KEY = 'devshark:pending-quiz-receipts:v2';
const LEGACY_PENDING_KEY = 'studyshark:pending-quiz-receipt:v1';

const Q = (id: string, extra: object = {}) => ({
  id, introduction: '', question: `Question ${id}?`, options: [`alpha ${id}`, `beta ${id}`, `gamma ${id}`, `delta ${id}`],
  category: 'javascript', difficulty: 2, ...extra,
});
/** A sealed-looking session id; the last 22 characters tell attempts apart. */
const sessionFor = (tag: string) => `v2.aaaaaaaaaaaaaaaa.bbbbbbbbbbbb.${tag.padEnd(22, '0')}`;
const graded = (questions: { id: string }[], extra: object = {}) => ({
  totalQuestions: questions.length, correctAnswers: questions.length, percentage: 100, questXp: 6 * questions.length,
  results: questions.map((q) => ({ questionId: q.id, selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: `Why ${q.id}` })),
  ...extra,
});

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function quizTree(path = '/quiz') {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <Routes>
            <Route path="/quiz" element={<><Quiz /><PendingQuizResults /></>} />
            <Route path="/leaderboard" element={<LocationProbe />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function renderQuiz(path = '/quiz') {
  return render(quizTree(path));
}

/** The counter is the run's h1, "Quiz · Question 2 of 5"; this reads its count. */
const counter = () => screen.getByRole('heading', { level: 1 }).textContent!.replace(/^Quiz · /, '');
/** The answer cards of the question on screen (the setup screen has radios too). */
const answerCards = () => screen.getAllByRole('radio').filter((radio) => radio.closest('.ss-answer-list'));
const checked = () => answerCards().map((radio) => radio.getAttribute('aria-checked') === 'true');
/** Waits for a question, then lets its effects run: the shortcuts listen
 * from an effect, and a key pressed before it runs is lost. */
const questionOnScreen = async () => {
  await screen.findAllByText(/^Question \d+ of \d+$/);
  await act(async () => {});
};

async function startQuiz(questions = [Q('a'), Q('b')], extra: object = {}) {
  server.use(http.get('*/api/quiz/questions', () => HttpResponse.json({ sessionId: sessionFor('standard'), expiresAt: Date.now() + 3_600_000, questions, ...extra })));
  renderQuiz();
  fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
  await questionOnScreen();
}

function answerAll(count: number) {
  for (let i = 0; i < count; i++) {
    fireEvent.keyDown(document.body, { key: '1' });
    if (i < count - 1) fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
  }
}

function signIn() {
  auth.value = { user: LEARNER, isAuthenticated: true, isLoading: false };
  server.use(http.get('*/api/user/xp', () => HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } })));
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  queryClient.clear();
  localStorage.setItem('devquiz:quiz-setup:v1', JSON.stringify({ count: 10, difficulty: 'mixed', categories: ['javascript'] }));
  auth.value = { user: null, isAuthenticated: false, isLoading: false };
  server.use(http.get('*/api/settings', () => HttpResponse.json(DEFAULT_CONFIG)));
});

describe('keyboard shortcuts', () => {
  it('keep working after a click leaves focus on an answer or a button, and leave Enter on a button to the browser', async () => {
    let submits = 0;
    server.use(http.post('*/api/quiz/submit', () => { submits++; return HttpResponse.json(graded([Q('a'), Q('b')])); }));
    await startQuiz();

    const first = answerCards()[0];
    first.focus();
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: '3' });
    expect(checked()).toEqual([false, false, true, false]);
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(counter()).toBe('Question 2 of 2');

    const previous = screen.getByRole('button', { name: /^previous$/i });
    previous.focus();
    fireEvent.keyDown(previous, { key: '4' });
    expect(checked()).toEqual([false, false, false, true]);
    // Every question is answered, so Enter would submit; on a focused button
    // it is the button's own, and the quiz does not act as well.
    fireEvent.keyDown(previous, { key: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submits).toBe(0);
    expect(counter()).toBe('Question 2 of 2');
  });
});

describe('setup clarity and category selection', () => {
  it('keeps hidden topic choices when selecting or clearing only the visible topics', async () => {
    queryClient.setQueryData(['game-config'], {
      ...DEFAULT_CONFIG,
      quiz: { ...DEFAULT_CONFIG.quiz, defaultCategoryIds: ['javascript', 'react'] },
    });
    server.use(http.get('*/api/settings', () => HttpResponse.json({
      ...DEFAULT_CONFIG,
      quiz: { ...DEFAULT_CONFIG.quiz, defaultCategoryIds: ['javascript', 'react'] },
    })));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: 'Show all categories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Security' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getByText('1 more selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select visible topics' }));
    expect(JSON.parse(localStorage.getItem('devquiz:quiz-setup:v1')!).categories.sort()).toEqual(['javascript', 'react', 'security']);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect visible topics' }));
    expect(JSON.parse(localStorage.getItem('devquiz:quiz-setup:v1')!).categories).toEqual(['security']);
    fireEvent.click(screen.getByRole('button', { name: 'Show all categories' }));
    expect(screen.getByRole('button', { name: 'Security' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains the selected difficulty without a tooltip and tells guests before they start', async () => {
    renderQuiz();
    expect(await screen.findByText('Mixed: Difficulty 1 to 5, shuffled.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Difficulty: Progressive' }));
    expect(screen.getByText('Progressive: Difficulty 1 to 5, in order.')).toHaveAttribute('role', 'status');
    expect(screen.queryByText('Mixed: Difficulty 1 to 5, shuffled.')).not.toBeInTheDocument();
    expect(screen.getByText('You’re practising on this device. Sign in before starting to save results to your account.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveClass('ss-swim-cta');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
  });

  it('does not show the guest setup warning to an authenticated learner', async () => {
    signIn();
    renderQuiz();
    await screen.findByRole('button', { name: /start quiz/i });
    expect(screen.queryByText(/Sign in before starting/)).not.toBeInTheDocument();
  });
});

describe('starting', () => {
  it('keeps Start quiz focusable without a category, and pressing it says what is missing', async () => {
    localStorage.setItem('devquiz:quiz-setup:v1', JSON.stringify({ count: 10, difficulty: 'mixed', categories: [] }));
    let fetched = 0;
    server.use(http.get('*/api/quiz/questions', () => { fetched++; return HttpResponse.json({}); }));
    renderQuiz();
    const start = await screen.findByRole('button', { name: /start quiz/i });
    expect(start).not.toBeDisabled();
    expect(start).toHaveAttribute('aria-disabled', 'true');
    expect(start).toHaveAccessibleDescription('Choose at least one topic.');
    expect(screen.getByText('0 selected')).toBeVisible();
    expect(screen.getByText('10 questions · Mixed')).toBeVisible();
    start.focus();
    expect(document.activeElement).toBe(start);
    fireEvent.click(start);
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one category');
    expect(start).toHaveAccessibleDescription('Select at least one category');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetched).toBe(0);
  });

  it('moves focus to the first question, not to the page', async () => {
    server.use(http.get('*/api/quiz/questions', () => HttpResponse.json({ sessionId: sessionFor('standard'), expiresAt: Date.now() + 3_600_000, questions: [Q('a'), Q('b')] })));
    renderQuiz();
    const start = await screen.findByRole('button', { name: /start quiz/i });
    expect(start).not.toHaveAttribute('aria-disabled');
    start.focus();
    fireEvent.click(start);
    await questionOnScreen();
    expect(document.activeElement).toHaveTextContent('Question a?');
    expect(document.activeElement?.id).toBe('question-text-a');
  });
});

describe('focus', () => {
  it('moves to the question when Previous reaches the first one and disables itself', async () => {
    await startQuiz();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    const previous = screen.getByRole('button', { name: /^previous$/i });
    previous.focus();
    fireEvent.click(previous);
    expect(counter()).toBe('Question 1 of 2');
    expect(previous).toBeDisabled();
    expect(document.activeElement?.id).toBe('question-text-a');
  });
});

describe('touch targets', () => {
  it('gives the hint, report and exit buttons in the question header 44px', async () => {
    await startQuiz([Q('a', { introduction: 'Think about types.' })]);
    for (const name of ['Show hint', 'Report this question', 'Exit quiz']) {
      const button = screen.getByRole('button', { name });
      expect(button.style.width).toBe('44px');
      expect(button.style.height).toBe('44px');
      expect(button.closest('.ss-question-header__tools')).not.toBeNull();
    }
  });
});

describe('the setup screen (UX audit U2)', () => {
  it('opens on the shared PageHeader, stacks Questions over Difficulty, and starts with the one SwimCta md', async () => {
    renderQuiz();
    const start = await screen.findByRole('button', { name: /start quiz/i });
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Build your quiz.');
    expect(headings[0].closest('header.ss-page-header')).not.toBeNull();
    expect(document.querySelector('.ss-info-page__header')).toBeNull();
    // Each setting is a full-width group of its own, label above its pills.
    const groups = [...document.querySelectorAll('.quiz-setup__settings > .quiz-setup__group')];
    expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual(['Questions', 'Difficulty']);
    expect(groups.map((group) => group.querySelector('[role="radiogroup"]')?.getAttribute('aria-labelledby'))).toEqual(['quiz-count-label', 'quiz-difficulty-label']);
    expect(start).toHaveClass('ss-swim-cta--md');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    // The empty error line takes no space until it has something to say.
    const css = readFileSync(new URL('../src/components/Quiz.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.quiz-setup__error:empty \{ display: none; \}/);
    expect(css).toMatch(/\.quiz-setup \{[^}]*max-width: var\(--ss-width-task\)/);
  });
});

describe('the results screen (UX audit U2)', () => {
  it('keeps the summary and the review on one column, with h1 then h2, and the shared action row', async () => {
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json(graded([Q('a')]))));
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('1 / 1');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('1 / 1');
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Review your answers (1)');
    // No width of its own: the summary fills the column the review grid fills.
    const summary = document.querySelector('.quiz-results__summary') as HTMLElement;
    expect(summary.style.maxWidth).toBe('');
    expect(summary.parentElement!.style.maxWidth).toBe('');
    const newQuiz = screen.getByRole('button', { name: /^new quiz$/i });
    expect(newQuiz).toHaveClass('ss-swim-cta--md');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /review answers/i }).closest('.ss-question-actions__secondary')).not.toBeNull();
    // The explanation is text under a rule, not a box inside the card.
    const explanation = screen.getByText('Why a');
    expect(explanation).toHaveClass('quiz-review-explanation');
    expect(explanation.style.border).toBe('');
    const css = readFileSync(new URL('../src/components/Quiz.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.quiz-review-grid \{[^}]*align-items: stretch/);
    expect(css).toMatch(/\.quiz-review-explanation \{[^}]*border-top: 1px solid var\(--ss-card-line\)/);
  });

  it('stops on the message with back to settings on the left and one primary on the right', async () => {
    server.use(http.get('*/api/quiz/questions', () => HttpResponse.json({ error: { code: 'upstream', message: 'Busy' } }, { status: 503 })));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    const retry = await screen.findByRole('button', { name: /^retry$/i });
    expect(retry).toHaveClass('ss-swim-cta--md');
    expect(screen.getByRole('button', { name: /back to settings/i }).closest('.ss-question-actions__secondary')).not.toBeNull();
  });
});

describe('result review priorities and focus', () => {
  it('prioritizes mistakes, preserves the all-answers view and keeps retired questions separate', async () => {
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json({
      totalQuestions: 2, correctAnswers: 1, percentage: 50, questXp: 6, voided: ['c'],
      results: [
        { questionId: 'a', selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'Correct explanation' },
        { questionId: 'b', selectedIndex: 0, correctAnswer: 2, isCorrect: false, explanation: 'Mistake explanation' },
      ],
    })));
    await startQuiz([Q('a'), Q('b'), Q('c')]);
    answerAll(3);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    const review = await screen.findByRole('button', { name: 'Review incorrect answers (1)' });
    expect(review).toHaveClass('ss-swim-cta--md');
    expect(screen.getByRole('button', { name: 'New quiz' })).not.toHaveClass('ss-swim-cta');
    expect(screen.getByText('Mistake explanation')).toBeInTheDocument();
    expect(screen.queryByText('Correct explanation')).not.toBeInTheDocument();
    expect(document.querySelector('.quiz-retired')).toHaveTextContent('Question c?');
    expect(document.querySelector('.quiz-review-grid')).not.toHaveTextContent('Question c?');
    fireEvent.click(screen.getByRole('radio', { name: 'All answers (2)' }));
    expect(screen.getByText('Correct explanation')).toBeInTheDocument();
    review.focus();
    fireEvent.click(review);
    expect(screen.getByRole('heading', { level: 2, name: 'Review your answers (2)' })).toHaveFocus();
    expect(screen.queryByText('Correct explanation')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Incorrect (1)' })).toHaveAttribute('aria-checked', 'true');
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
  });

  it('moves focus to review while keeping New quiz primary after a perfect result', async () => {
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json(graded([Q('a')]))));
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    const review = await screen.findByRole('button', { name: 'Review answers ↓' });
    fireEvent.click(review);
    expect(screen.getByRole('heading', { level: 2 })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'New quiz' })).toHaveClass('ss-swim-cta--md');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('does not manufacture incorrect answers when every question was retired', async () => {
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json({ totalQuestions: 0, correctAnswers: 0, percentage: 0, questXp: 0, voided: ['a'], results: [] })));
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('No answers were graded. Retired questions do not affect your score.')).toBeInTheDocument();
    expect(screen.queryByText('Incorrect')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review incorrect/i })).not.toBeInTheDocument();
    expect(document.querySelector('.quiz-review-grid')?.children).toHaveLength(0);
    expect(document.querySelector('.quiz-retired')).toHaveTextContent('Question a?');
  });
});

describe('the question screen (UX audit U2)', () => {
  it('keeps the 16px phone gutter on /quiz like every other route (questions-18)', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const padding = app.match(/padding: isDev[\s\S]*?,\n\s*boxSizing/)?.[0] ?? '';
    expect(padding).toMatch(/: mobile\s*\?\s*'1rem'/);
    expect(padding).not.toMatch(/0\.75rem/);
  });

  it('names the run in one h1 that is also the counter, and shows the difficulty', async () => {
    await startQuiz([Q('a', { difficulty: 3 }), Q('b')]);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Quiz · Question 1 of 2');
    // Said once: no hidden legend repeats the counter.
    expect(screen.getAllByText(/Question 1 of 2/)).toHaveLength(1);
    expect(screen.getByText('Difficulty 3')).toBeInTheDocument();
  });

  it('draws the run in the shared shell: one panel, the shared answer list and one primary on the right', async () => {
    await startQuiz();
    const shell = document.querySelector('.ss-question')!;
    expect(shell.querySelectorAll('.ss-panel')).toHaveLength(1);
    expect(screen.getByRole('radiogroup')).toHaveAccessibleName('Question a?');
    expect(answerCards()).toHaveLength(4);
    expect(document.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^next$/i })).toHaveClass('ss-swim-cta--md');
    expect(screen.getByRole('button', { name: /^previous$/i }).closest('.ss-question-actions__secondary')).not.toBeNull();
    // The question block is the same element from question to question, so
    // the answers under it start at one y.
    const block = document.querySelector('.ss-question__block');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(document.querySelector('.ss-question__block')).toBe(block);
    expect(block).toHaveAttribute('data-stable', 'true');
  });

  it('says what the keys do, and that Enter submits on the last question once all are answered', async () => {
    await startQuiz();
    expect(screen.getByText('Press 1–4 to select · Enter to continue')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    expect(screen.getByText('Press 1–4 to select')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '2' });
    expect(screen.getByText('Press 1–4 to select · Enter to submit')).toBeInTheDocument();
  });

  it('names the last-step navigation Review unanswered, then focuses the first open question', async () => {
    await startQuiz([Q('a'), Q('b'), Q('c')]);
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.keyDown(document.body, { key: '1' });
    const submit = screen.getByRole('button', { name: 'Review unanswered (2)' });
    expect(submit).not.toBeDisabled();
    expect(submit).not.toHaveAttribute('aria-disabled');
    expect(submit).toHaveAccessibleDescription('Go to the first unanswered question. You can still change your answers.');
    // Said in sight too, under the action row, not only to a screen reader.
    const why = screen.getByText('Go to the first unanswered question. You can still change your answers.');
    expect(why).toHaveClass('quiz-submit-why');
    expect(why.style.position).toBe('');
    fireEvent.click(submit);
    expect(screen.getByText('Question a?').closest('.ss-question__block')).toHaveFocus();
    expect(screen.queryByRole('button', { name: /submit quiz/i })).not.toBeInTheDocument();
  });
});

describe('a question retired while the quiz was open', () => {
  // The bookmark icon became Save as Shark Card (owner decision 12), which
  // needs an account, so the learner signs in here.
  it('reads as not counted, with no answers and nothing to save', async () => {
    signIn();
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), voided: ['b'] })),
      http.post('*/api/user/stats', () => HttpResponse.json({ data: null, xp: { quest_xp: 6, quest_xp_by_subject: { webdev: 6 } }, applied: true, questXp: 6 })),
    );
    await startQuiz();
    answerAll(2);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('1 / 1');
    // The score is read once, from the focused heading, not again as a live region.
    const heading = screen.getByRole('heading', { level: 1, name: /1/ });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).not.toHaveAttribute('aria-live');

    expect(screen.getByText('Retired, not counted')).toBeInTheDocument();
    expect(screen.queryByText('alpha b')).not.toBeInTheDocument();
    expect(await screen.findAllByRole('button', { name: 'Save as a Shark Card' })).toHaveLength(1);
  });
});

describe('Shark Cards from the review (owner decision 12)', () => {
  it('saves a missed question with the answer and explanation the grading returned, and shows it saved', async () => {
    signIn();
    const saved: Record<string, unknown>[] = [];
    server.use(
      // Question a was missed: the learner picked alpha, the answer is gamma.
      http.post('*/api/quiz/submit', () => HttpResponse.json({
        totalQuestions: 1, correctAnswers: 0, percentage: 0, questXp: 0,
        results: [{ questionId: 'a', selectedIndex: 0, correctAnswer: 2, isCorrect: false, explanation: 'Gamma, because the grader says so.' }],
        resultReceipt: 'missed-receipt',
      })),
      http.post('*/api/user/stats', () => HttpResponse.json({ data: null, xp: { quest_xp: 0, quest_xp_by_subject: { webdev: 0 } }, applied: true, questXp: 0 })),
      http.post('*/api/flashcards', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        saved.push(body);
        return HttpResponse.json({ card: { ...body, created_at: '2026-10-01T10:00:00Z' } });
      }),
    );
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    const save = await screen.findByRole('button', { name: 'Save as a Shark Card' });
    expect(save).toHaveAttribute('aria-pressed', 'false');
    // Before anything is saved, the card asks the server for nothing but the deck.
    expect(saved).toEqual([]);
    fireEvent.click(save);
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      question_id: 'a', question: 'Question a?', category: 'javascript',
      correct_answer: 'gamma a', explanation: 'Gamma, because the grader says so.', subject: 'webdev',
    });
    const savedButton = await screen.findByRole('button', { name: 'Saved as Shark Card' });
    // Shown at once, and still saved once the save has settled.
    await waitFor(() => expect(savedButton).toBeEnabled());
    expect(savedButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Saved as Shark Card' })).toBe(savedButton);
    expect(screen.queryByRole('link', { name: 'Open Shark Cards' })).toBeNull();
  });

  it('offers nothing to a signed-out learner, whose cards would have no account to live in', async () => {
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json({
      totalQuestions: 1, correctAnswers: 0, percentage: 0, questXp: 0,
      results: [{ questionId: 'a', selectedIndex: 0, correctAnswer: 2, isCorrect: false, explanation: 'Why a' }],
    })));
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('Why a');
    expect(screen.queryByRole('button', { name: /Shark Card/ })).toBeNull();
  });
});

describe('the daily challenge', () => {
  it('says today’s challenge is played when the server reports it, and links to today’s board', async () => {
    signIn();
    server.use(http.get('*/api/quiz/daily', () => HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')], completed: true })));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    expect(await screen.findByText('You’ve played today’s challenge')).toBeInTheDocument();
    expect(screen.queryByText('Question d1?')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /see today’s leaderboard/i }));
    expect(await screen.findByTestId('location')).toHaveTextContent('/leaderboard?tab=today');
  });

  it('says when the next one starts on the learner’s own clock', async () => {
    signIn();
    server.use(http.get('*/api/quiz/daily', () => HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')], completed: true })));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    expect(await screen.findByText(`Each day’s challenge counts once. The next one starts at ${localDayChangeTime()} your time.`)).toBeInTheDocument();
  });

  it('says the same under a finished challenge', async () => {
    server.use(
      http.get('*/api/quiz/daily', () => HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')] })),
      http.post('*/api/quiz/submit', () => HttpResponse.json(graded([Q('d1')]))),
    );
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText(`Today’s challenge complete. The next one starts at ${localDayChangeTime()} your time.`)).toBeInTheDocument();
  });

  it('links to a leaderboard that opens on today’s board', async () => {
    const periods: (string | null)[] = [];
    server.use(http.get('*/api/leaderboard', ({ request }) => {
      const period = new URL(request.url).searchParams.get('period');
      periods.push(period);
      return HttpResponse.json(period === 'daily'
        ? { period: 'daily', subject: 'webdev', entries: [{ display_name: 'Early riser', picture: null, correct: 5, total: 5, duration_ms: 84_000, attempted_at: '2026-09-29T07:12:00Z' }] }
        : { period, entries: [] });
    }));
    await act(async () => render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/leaderboard?tab=today']}>
          <LanguageProvider><Leaderboard /></LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
    expect(await screen.findByText('Early riser')).toBeInTheDocument();
    expect(periods).toContain('daily');
  });

  it('turns a second submit of the day into that message, not the raw 409', async () => {
    server.use(
      http.get('*/api/quiz/daily', () => HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')] })),
      http.post('*/api/quiz/submit', () => HttpResponse.json({ error: { code: 'attempt_already_graded', message: 'This answer has already been graded and cannot be changed' } }, { status: 409 })),
    );
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));

    expect(await screen.findByText('You’ve played today’s challenge')).toBeInTheDocument();
    expect(screen.queryByText(/already been graded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit quiz/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('Retry after a failed daily fetch asks for the daily again', async () => {
    const hits: string[] = [];
    server.use(
      http.get('*/api/quiz/daily', () => { hits.push('daily'); return HttpResponse.json({ error: { code: 'x', message: 'Daily unavailable' } }, { status: 500 }); }),
      http.get('*/api/quiz/questions', () => { hits.push('questions'); return HttpResponse.json({ sessionId: sessionFor('q'), questions: [Q('z')] }); }),
    );
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    fireEvent.click(await screen.findByRole('button', { name: /^retry$/i }));
    await waitFor(() => expect(hits).toHaveLength(2));
    expect(hits).toEqual(['daily', 'daily']);
  });

  // The Home "Daily challenge" tile opened the survival Challenge, and the
  // leaderboard's empty Today board opened a plain quiz. Both link here now.
  it('starts from the leaderboard’s empty Today board, once, and drops the parameter', async () => {
    const hits: string[] = [];
    server.use(
      http.get('*/api/leaderboard', ({ request }) => HttpResponse.json({ period: new URL(request.url).searchParams.get('period'), subject: 'webdev', entries: [] })),
      http.get('*/api/quiz/daily', () => { hits.push('daily'); return HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')] }); }),
    );
    await act(async () => render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/leaderboard?tab=today']}>
          <LanguageProvider>
            <Routes>
              <Route path="/leaderboard" element={<Leaderboard />} />
              <Route path="/quiz" element={<><Quiz /><LocationProbe /></>} />
            </Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
    expect(await screen.findByText('Nobody has finished today’s daily challenge yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Today’s challenge' }));
    expect(await screen.findByText('Question d1?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Today’s challenge · Question');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/quiz$/);
    await act(async () => {});
    expect(hits).toEqual(['daily']);
  });

  it('waits for the sign-in before starting a linked daily, so it is not fetched as practice', async () => {
    const hits: string[] = [];
    server.use(http.get('*/api/quiz/daily', () => { hits.push('daily'); return HttpResponse.json({ date: '2026-09-29', sessionId: sessionFor('daily'), questions: [Q('d1')] }); }));
    auth.value = { user: null, isAuthenticated: false, isLoading: true };
    const view = renderQuiz('/quiz?mode=daily');
    await screen.findByRole('button', { name: /start quiz/i });
    await act(async () => {});
    expect(hits).toEqual([]);
    signIn();
    view.rerender(quizTree('/quiz?mode=daily'));
    expect(await screen.findByText('Question d1?')).toBeInTheDocument();
    expect(hits).toEqual(['daily']);
  });

  it('drops the daily set’s request when the learner leaves while it loads', async () => {
    let signal: AbortSignal | null = null;
    server.use(http.get('*/api/quiz/daily', ({ request }) => {
      signal = request.signal;
      return new Promise<Response>(() => {});
    }));
    const view = renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
    await waitFor(() => expect(signal).not.toBeNull());
    view.unmount();
    await waitFor(() => expect(signal!.aborted).toBe(true));
  });

  it('is hidden when the /dev switch turns it off', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.json({ ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, dailyChallenge: false } })));
    renderQuiz();
    await screen.findByRole('button', { name: /start quiz/i });
    await waitFor(() => expect(screen.queryByRole('button', { name: /today’s challenge/i })).not.toBeInTheDocument());
  });
});

describe('the review linked from Today', () => {
  it('starts once and drops the parameter', async () => {
    signIn();
    const asked: string[] = [];
    server.use(http.get('*/api/quiz/questions', ({ request }) => {
      asked.push(new URL(request.url).searchParams.get('resource') ?? '');
      return HttpResponse.json({ sessionId: sessionFor('review'), expiresAt: Date.now() + 3_600_000, questions: [Q('r1')] });
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/quiz?mode=review']}>
          <LanguageProvider>
            <Routes>
              <Route path="/quiz" element={<><Quiz /><LocationProbe /></>} />
            </Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Question r1?')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(asked).toEqual(['review']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review · Question');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/quiz$/);
  });
});

describe('submitting', () => {
  it('locks the answers once a submit was sent, and a retry sends the same ones', async () => {
    const bodies: { answers: Record<string, number> }[] = [];
    let fail = true;
    server.use(http.post('*/api/quiz/submit', async ({ request }) => {
      bodies.push(await request.json() as { answers: Record<string, number> });
      if (fail) { fail = false; return HttpResponse.json({ error: { code: 'upstream', message: 'Grading is busy' } }, { status: 503 }); }
      return HttpResponse.json(graded([Q('a')]));
    }));
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '2' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));

    expect(await screen.findByText(/can’t be changed now/)).toBeInTheDocument();
    expect(answerCards().every((radio) => radio.hasAttribute('disabled'))).toBe(true);
    fireEvent.keyDown(document.body, { key: '4' });
    expect(checked()).toEqual([false, true, false, false]);

    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('1 / 1');
    expect(bodies.map((body) => body.answers)).toEqual([{ a: 1 }, { a: 1 }]);
  });

  it('sends one submit for a double press before the button turns busy', async () => {
    let submits = 0;
    server.use(http.post('*/api/quiz/submit', () => { submits++; return HttpResponse.json(graded([Q('a')])); }));
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    const submit = screen.getByRole('button', { name: /submit quiz/i });
    // Both presses land before React renders the busy button.
    act(() => {
      fireEvent.click(submit);
      fireEvent.keyDown(document.body, { key: 'Enter' });
    });
    await screen.findByText('1 / 1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(submits).toBe(1);
  });

  it('keeps a quiz started after Exit when the left quiz’s submit answers late', async () => {
    let answer: (() => void) | undefined;
    server.use(http.post('*/api/quiz/submit', () => new Promise<Response>((resolve) => {
      answer = () => resolve(HttpResponse.json(graded([Q('a')])));
    })));
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await waitFor(() => expect(answer).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /exit quiz/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave quiz' }));
    server.use(http.get('*/api/quiz/questions', () => HttpResponse.json({ sessionId: sessionFor('second'), expiresAt: Date.now() + 3_600_000, questions: [Q('n')] })));
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    expect(await screen.findByText('Question n?')).toBeInTheDocument();
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '2' });

    await act(async () => { answer!(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText('Question n?')).toBeInTheDocument();
    expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(PROGRESS_KEY)!)).toMatchObject({ sessionId: sessionFor('second'), answers: { n: 1 } });
    expect(screen.getByRole('button', { name: /submit quiz/i })).toBeEnabled();
  });

  it('says when advanced was asked of topics that have none', async () => {
    await startQuiz([Q('a')], { hardestAvailable: true });
    expect(screen.getByText(/no advanced questions yet/)).toBeInTheDocument();
  });
});

describe('slow loading and recovery', () => {
  it('can cancel a delayed request and ignores its late response without losing setup preferences', async () => {
    let respond: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    server.use(http.get('*/api/quiz/questions', ({ request }) => {
      signal = request.signal;
      return new Promise<Response>((resolve) => {
        respond = () => resolve(HttpResponse.json({ sessionId: sessionFor('cancelled'), questions: [Q('late')] }));
      });
    }));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    await waitFor(() => expect(respond).toBeDefined());
    expect(screen.queryByRole('button', { name: 'Back to quiz settings' })).not.toBeInTheDocument();
    const cancel = await screen.findByRole('button', { name: 'Back to quiz settings' }, { timeout: 7_000 });
    cancel.focus();
    fireEvent.click(cancel);
    expect(screen.getByRole('heading', { level: 1, name: 'Build your quiz.' })).toHaveFocus();
    expect(signal!.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'JavaScript' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { respond!(); });
    expect(screen.queryByText('Question late?')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start quiz/i })).toBeInTheDocument();
  });

  it('focuses an error heading and returns to the setup heading after recovery', async () => {
    server.use(http.get('*/api/quiz/questions', () => HttpResponse.json({ error: { code: 'upstream', message: 'Busy' } }, { status: 503 })));
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }));
    expect(screen.getByRole('heading', { name: 'Build your quiz.' })).toHaveFocus();
  });
});

describe('quiz orientation and deadline', () => {
  it('offers one direct return to earlier unanswered questions before the last item', async () => {
    await startQuiz([Q('a'), Q('b'), Q('c')]);
    expect(screen.getByText('0 of 3 answered')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /review unanswered/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.keyDown(document.body, { key: '1' });
    expect(screen.getByText('1 of 3 answered')).toBeInTheDocument();
    const review = screen.getByRole('button', { name: 'Review unanswered (2)' });
    review.focus();
    fireEvent.click(review);
    expect(screen.getByText('Question a?').closest('.ss-question__block')).toHaveFocus();
    expect(checked()).toEqual([false, false, false, false]);
  });

  it('uses the actual deadline, warns on wake, and keeps answers available for a server-accepted submit', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const deadline = now + 4 * 60_000;
    server.use(http.post('*/api/quiz/submit', () => HttpResponse.json(graded([Q('a')]))));
    await startQuiz([Q('a')], { expiresAt: deadline });
    expect(document.querySelector('time')).toHaveAttribute('datetime', new Date(deadline).toISOString());
    expect(screen.getByText('Submit soon to finish before this quiz expires.')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: '2' });
    now += 5 * 60_000;
    fireEvent(window, new Event('focus'));
    expect(screen.getByText(/This quiz’s submit deadline has passed/)).toBeInTheDocument();
    expect(checked()).toEqual([false, true, false, false]);
    expect(JSON.parse(sessionStorage.getItem(PROGRESS_KEY)!).answers).toEqual({ a: 1 });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('1 / 1')).toBeInTheDocument();
  });

  it('does not invent a deadline for a session whose server response has none', async () => {
    await startQuiz([Q('a')], { expiresAt: undefined });
    expect(document.querySelector('time')).toBeNull();
    expect(screen.queryByText(/Submit before/)).not.toBeInTheDocument();
  });
});

describe('an expired quiz session', () => {
  it('is dropped on return instead of resumed', async () => {
    sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
      sessionId: sessionFor('old'), questions: [Q('a')], answers: {}, currentIndex: 0, mode: 'standard', expiresAt: Date.now() - 1000,
    }));
    renderQuiz();
    expect(await screen.findByRole('button', { name: /start quiz/i })).toBeInTheDocument();
    expect(screen.queryByText('Question a?')).not.toBeInTheDocument();
    expect(await screen.findByText(/more than an hour old/)).toBeInTheDocument();
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('resumes with the hints that were opened, so they are reported', async () => {
    const bodies: { hinted: string[] }[] = [];
    server.use(http.post('*/api/quiz/submit', async ({ request }) => {
      bodies.push(await request.json() as { hinted: string[] });
      return HttpResponse.json(graded([Q('a'), Q('b')]));
    }));
    sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
      sessionId: sessionFor('resume'), questions: [Q('a'), Q('b')], answers: { a: 0 }, currentIndex: 1, mode: 'standard',
      expiresAt: Date.now() + 600_000, hinted: ['a'],
    }));
    renderQuiz();
    await questionOnScreen();
    expect(JSON.parse(sessionStorage.getItem(PROGRESS_KEY)!).hinted).toEqual(['a']);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('2 / 2');
    expect(bodies[0].hinted).toEqual(['a']);
  });

  it('resumes a saved quiz whose position is not a number at its first question, with only real picks', async () => {
    sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
      sessionId: sessionFor('odd'), questions: [Q('a'), Q('b')], answers: { a: 'x', b: 1.5, constructor: 0 }, currentIndex: 'x', mode: 'standard',
      expiresAt: Date.now() + 600_000,
    }));
    renderQuiz();
    expect(await screen.findByText('Question a?')).toBeInTheDocument();
    expect(counter()).toBe('Question 1 of 2');
    expect(checked()).toEqual([false, false, false, false]);
  });

  it('drops a saved quiz whose questions this build cannot show, instead of failing', async () => {
    sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({
      sessionId: sessionFor('broken'), questions: [{ id: 'a', question: 'Question a?' }], answers: {}, currentIndex: 0, mode: 'standard',
      expiresAt: Date.now() + 600_000,
    }));
    renderQuiz();
    expect(await screen.findByRole('button', { name: /start quiz/i })).toBeInTheDocument();
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('refused at submit, clears the saved quiz and offers a new one with the same settings', async () => {
    const asked: string[] = [];
    server.use(
      http.get('*/api/quiz/questions', ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json({ sessionId: sessionFor(`s${asked.length}`), expiresAt: Date.now() + 3_600_000, questions: [Q('a')] });
      }),
      http.post('*/api/quiz/submit', () => HttpResponse.json({ error: { code: 'invalid_session', message: 'Quiz session expired or invalid' } }, { status: 400 })),
    );
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));

    expect(await screen.findByText('This quiz expired')).toBeInTheDocument();
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /new quiz, same settings/i }));
    await questionOnScreen();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toBe(asked[0]);
    expect(new URLSearchParams(asked[1]).get('difficulty')).toBe('mixed');
    expect(new URLSearchParams(asked[1]).get('categories')).toBe('javascript');
  });
});

describe('persistent result save status', () => {
  it('shows Saving until the server confirms a save, then keeps Saved in the summary', async () => {
    signIn();
    let save: (() => void) | undefined;
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'status-receipt' })),
      http.post('*/api/user/stats', () => new Promise<Response>((resolve) => {
        save = () => resolve(HttpResponse.json({ data: null, applied: false, questXp: 0 }));
      })),
    );
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('Saving to your account…')).toHaveClass('quiz-save-status');
    await waitFor(() => expect(save).toBeDefined());
    expect(screen.queryByText('Saved to your account')).not.toBeInTheDocument();
    await act(async () => { save!(); });
    expect(await screen.findByText('Saved to your account')).toHaveAttribute('role', 'status');
    expect(screen.getByText('Saved to your account').closest('.quiz-results__summary')).not.toBeNull();
    expect(screen.queryByText('Saving to your account…')).not.toBeInTheDocument();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('updates a waiting result after background replay without regrading the quiz', async () => {
    signIn();
    let grades = 0;
    const receipts: string[] = [];
    server.use(
      http.post('*/api/quiz/submit', () => { grades++; return HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'replay-status-receipt' }); }),
      http.post('*/api/user/stats', async ({ request }) => {
        receipts.push(((await request.json()) as { result_receipt: string }).result_receipt);
        return receipts.length === 1
          ? HttpResponse.json({ error: { code: 'offline', message: 'Try again' } }, { status: 503 })
          : HttpResponse.json({ data: null, applied: false, questXp: 0 });
      }),
    );
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('Waiting to sync. We’ll retry when you reconnect or reopen devShark.')).toHaveAttribute('role', 'status');
    fireEvent(window, new Event('online'));
    expect(await screen.findByText('Saved to your account')).toBeInTheDocument();
    expect(screen.queryByText(/Waiting to sync/)).not.toBeInTheDocument();
    expect(grades).toBe(1);
    expect(receipts).toEqual(['replay-status-receipt', 'replay-status-receipt']);
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('keeps a permanent refusal visible after replay and does not say Saved', async () => {
    signIn();
    let writes = 0;
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'refused-later-receipt' })),
      http.post('*/api/user/stats', () => ++writes === 1
        ? HttpResponse.json({ error: { code: 'offline', message: 'Try again' } }, { status: 503 })
        : HttpResponse.json({ error: { code: 'invalid_receipt', message: 'Expired' } }, { status: 400 })),
    );
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText(/Waiting to sync/);
    fireEvent(window, new Event('online'));
    expect(await screen.findByText('This result could not be saved to your account.')).toHaveClass('quiz-save-status');
    expect(screen.queryByText('Saved to your account')).not.toBeInTheDocument();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it('does not show the previous account’s save status when it signs out during the write', async () => {
    signIn();
    let save: (() => void) | undefined;
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'old-account-receipt' })),
      http.post('*/api/user/stats', () => new Promise<Response>((resolve) => {
        save = () => resolve(HttpResponse.json({ data: null, applied: true, questXp: 6 }));
      })),
    );
    await startQuiz([Q('a')]);
    answerAll(1);
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await screen.findByText('Saving to your account…');
    await waitFor(() => expect(save).toBeDefined());
    clearAccountData();
    auth.value = { user: null, isAuthenticated: false, isLoading: false };
    await act(async () => { save!(); });
    expect(screen.queryByText('Saved to your account')).not.toBeInTheDocument();
    expect(screen.queryByText('Saving to your account…')).not.toBeInTheDocument();
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe('saving a result to the account', () => {
  const pendingStore = () => JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, { receipt: string }>;

  it('keeps one waiting result per attempt when the write fails, and says it is not saved yet', async () => {
    signIn();
    let run = 0;
    server.use(
      http.get('*/api/quiz/questions', () => { run++; return HttpResponse.json({ sessionId: sessionFor(`attempt${run}`), questions: [Q('a')] }); }),
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), resultReceipt: `receipt-${run}` })),
      http.post('*/api/user/stats', () => HttpResponse.json({ error: { code: 'db_error', message: 'Could not record quiz result' } }, { status: 500 })),
    );
    renderQuiz();
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('Waiting to sync. We’ll retry when you reconnect or reopen devShark.')).toBeInTheDocument();
    await waitFor(() => expect(Object.values(pendingStore()).map((pending) => pending.receipt)).toEqual(['receipt-1']));

    fireEvent.click(screen.getByRole('button', { name: /^new quiz$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /start quiz/i }));
    await questionOnScreen();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    // The second failure is kept beside the first, not over it.
    await waitFor(() => expect(Object.values(pendingStore()).map((pending) => pending.receipt).sort()).toEqual(['receipt-1', 'receipt-2']));
  });

  it('does not write a quiz on screen back to the tab once the account signed out', async () => {
    signIn();
    await startQuiz([Q('a'), Q('b')]);
    await waitFor(() => expect(sessionStorage.getItem(PROGRESS_KEY)).not.toBeNull());
    act(() => { clearAccountData(); });
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await act(async () => {});
    expect(sessionStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('keeps nothing on the device when the account signed out while the grade was on its way', async () => {
    signIn();
    let answer: (() => void) | undefined;
    let recorded = 0;
    server.use(
      http.post('*/api/quiz/submit', () => new Promise<Response>((resolve) => {
        answer = () => resolve(HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'left-receipt' }));
      })),
      http.post('*/api/user/stats', () => { recorded++; return HttpResponse.json({ data: null, xp: null, applied: true }); }),
    );
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    await waitFor(() => expect(answer).toBeDefined());
    clearAccountData();
    await act(async () => { answer!(); });
    await screen.findByText('1 / 1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
    expect(recorded).toBe(0);
  });

  it('drops a result the server refuses and says it could not be saved', async () => {
    signIn();
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a')]), resultReceipt: 'refused-receipt' })),
      http.post('*/api/user/stats', () => HttpResponse.json({ error: { code: 'invalid_receipt', message: 'Quiz result receipt expired or invalid' } }, { status: 400 })),
    );
    await startQuiz([Q('a')]);
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
    expect(await screen.findByText('This result could not be saved to your account.')).toBeInTheDocument();
    expect(pendingStore()).toEqual({});
  });

  it('announces the XP the account recorded and never says repeats earn less', async () => {
    // From migration 056 every answer earns XP, a repeat included, so the
    // result screen no longer explains a smaller award. A server from before
    // 056 may still record less than the result (here 6 of 12): the screen
    // announces what was recorded and adds no note about repeats.
    signIn();
    const gains: number[] = [];
    const stop = onXpToast((toast) => { if (toast.kind === 'gain') gains.push(toast.amount); });
    let saved = 0;
    server.use(
      http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a'), Q('b')]), resultReceipt: 'repeat-receipt' })),
      http.post('*/api/user/stats', () => { saved++; return HttpResponse.json({ data: null, xp: { quest_xp: 6, quest_xp_by_subject: { webdev: 6 } }, applied: true, questXp: 6 }); }),
    );
    try {
      await startQuiz([Q('a'), Q('b')]);
      answerAll(2);
      fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
      await waitFor(() => expect(saved).toBe(1));
      await waitFor(() => expect(gains).toEqual([6]));
      await act(async () => {});
      expect(screen.queryByText(/earlier today|counts once a day/)).not.toBeInTheDocument();
    } finally {
      stop();
    }
  });

  // Migration 060: a correct answer whose question paid XP less than an hour
  // ago pays nothing (058), and the stats write names those answers and when
  // the last of them pays again. The learner hears it after the gain.
  for (const mode of ['quiz', 'daily'] as const) {
    it(`tells the learner in a toast which ${mode} answers the hour held back, and when they pay again`, async () => {
      signIn();
      const toasts: unknown[] = [];
      const stop = onXpToast((toast) => toasts.push(toast));
      const availableAt = '2026-10-09T14:32:00.000Z';
      server.use(
        http.get('*/api/quiz/daily', () => HttpResponse.json({ date: '2026-10-09', sessionId: sessionFor('daily'), questions: [Q('a'), Q('b')] })),
        http.post('*/api/quiz/submit', () => HttpResponse.json({ ...graded([Q('a'), Q('b')]), resultReceipt: `${mode}-held-receipt` })),
        http.post('*/api/user/stats', () => HttpResponse.json({
          data: null, xp: { quest_xp: 6, quest_xp_by_subject: { webdev: 6 } }, applied: true, questXp: 6,
          xpHeld: { questions: 1, availableAt },
        })),
      );
      try {
        if (mode === 'quiz') {
          await startQuiz([Q('a'), Q('b')]);
        } else {
          renderQuiz();
          fireEvent.click(await screen.findByRole('button', { name: /today’s challenge/i }));
          await questionOnScreen();
        }
        answerAll(2);
        fireEvent.click(screen.getByRole('button', { name: /submit quiz/i }));
        await waitFor(() => expect(toasts).toEqual([
          { kind: 'gain', amount: 6, source: 'quiz' },
          { kind: 'held', hold: { on: 'questions', count: 1, availableAt } },
        ]));
      } finally {
        stop();
      }
    });
  }

  it('sends a waiting result once when the browser comes back online while it is on its way', async () => {
    signIn();
    localStorage.setItem(PENDING_KEY, JSON.stringify({ one: { userId: LEARNER.id, receipt: 'waiting', profile: {} } }));
    const answers: (() => void)[] = [];
    server.use(http.post('*/api/user/stats', () => new Promise<Response>((resolve) => {
      answers.push(() => resolve(HttpResponse.json({ data: null, xp: null, applied: true })));
    })));
    render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider><PendingQuizResults /></LanguageProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(answers).toHaveLength(1));
    act(() => { window.dispatchEvent(new Event('online')); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(answers).toHaveLength(1);
    await act(async () => { answers[0](); });
    await waitFor(() => expect(pendingStore()).toEqual({}));
    expect(answers).toHaveLength(1);
  });

  it('stops sending waiting results when the account signs out, and says nothing to whoever is next', async () => {
    signIn();
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      one: { userId: LEARNER.id, receipt: 'first', profile: {} },
      two: { userId: LEARNER.id, receipt: 'second', profile: {} },
    }));
    const sent: string[] = [];
    const answers: (() => void)[] = [];
    server.use(http.post('*/api/user/stats', async ({ request }) => {
      sent.push(((await request.json()) as { result_receipt: string }).result_receipt);
      return new Promise<Response>((resolve) => {
        answers.push(() => resolve(HttpResponse.json({ error: { code: 'invalid_receipt', message: 'Quiz result receipt expired or invalid' } }, { status: 400 })));
      });
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider><PendingQuizResults /></LanguageProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(answers).toHaveLength(1));
    clearAccountData();
    await act(async () => { answers[0](); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(sent).toHaveLength(1);
    expect(screen.queryByText(/earlier quiz result could not be saved/)).not.toBeInTheDocument();
  });

  it('sends waiting results once signed in, and drops the ones too old to record', async () => {
    signIn();
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      one: { userId: LEARNER.id, receipt: 'fresh', profile: {} },
      two: { userId: LEARNER.id, receipt: 'expired', profile: {} },
      other: { userId: 'someone-else-0001', receipt: 'theirs', profile: {} },
    }));
    localStorage.setItem(LEGACY_PENDING_KEY, JSON.stringify({ userId: LEARNER.id, receipt: 'from-the-old-slot', profile: {} }));
    const sent: string[] = [];
    server.use(http.post('*/api/user/stats', async ({ request }) => {
      const { result_receipt: receipt } = await request.json() as { result_receipt: string };
      sent.push(receipt);
      return receipt === 'expired'
        ? HttpResponse.json({ error: { code: 'invalid_receipt', message: 'Quiz result receipt expired or invalid' } }, { status: 400 })
        : HttpResponse.json({ data: null, xp: null, applied: true });
    }));
    const view = render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider><PendingQuizResults /></LanguageProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/earlier quiz result could not be saved/)).toBeInTheDocument();
    expect(sent.sort()).toEqual(['expired', 'fresh', 'from-the-old-slot']);
    expect(Object.keys(pendingStore())).toEqual(['other']);
    expect(localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();

    view.unmount();
    render(
      <QueryClientProvider client={queryClient}>
        <LanguageProvider><PendingQuizResults /></LanguageProvider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent).toHaveLength(3);
  });
});
