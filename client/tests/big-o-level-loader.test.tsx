// /learn/big-o's questions wait as a Learn map level does (perf baseline #587
// C05): a fast answer opens them without drawing the loader, and an answer
// that came after the loader showed keeps it up LOADER_MIN_SHOWN_MS, so it
// never flashes on screen for a few milliseconds.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { delay, http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { BigOIntroduction } from '../src/components/learn/BigOIntroduction';
import { LOADER_DELAY_MS, LOADER_MIN_SHOWN_MS } from '../src/components/learn/LevelLoader';
import { server } from './mocks/server';

beforeAll(async () => {
  // The reader's and the runner's code, as a learner who reached for the lesson has them.
  await import('../src/components/learn/LearnLesson');
  await import('../src/components/learn/LessonRunner');
});

const QUOTE = 'Preparing your questions.';
const QUESTION = 'Which count grows with the input?';
const lesson = { id: 'dsa-v1-d01-l1', title: 'Complexity Basics', sources: [], sections: [{ kind: 'prose', body: 'Count the operations as the input grows.' }] };
const attempt = { kind: 'level', topic: 'dsa', ref: 1, title: 'Complexity Basics', passPct: 75, sessionId: 'fixture-attempt', questions: [{ id: 'fixture-q', category: 'dsa', difficulty: 1, question: QUESTION, options: ['n', '1'], introduction: '', tags: [] }] };

async function prepareQuestions(attemptDelay: number) {
  server.use(http.get('*/api/quiz/roadmap', async ({ request }) => {
    const params = new URL(request.url).searchParams;
    if (params.get('resource') === 'lesson') return HttpResponse.json({ lesson, hash: 'fixture-hash' });
    if (params.get('level')) {
      if (attemptDelay > 0) await delay(attemptDelay);
      return HttpResponse.json(attempt as never);
    }
    return HttpResponse.json({ topics: [], structure: {} });
  }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/learn/big-o']}>
        <LanguageProvider><BigOIntroduction /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Complexity Basics' }));
  const start = await screen.findByRole('button', { name: 'Start the questions' });
  return () => {
    let seen = false;
    const observer = new MutationObserver(() => { if (document.body.textContent?.includes(QUOTE)) seen = true; });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const startedAt = Date.now();
    fireEvent.click(start);
    return { startedAt, quoteSeen: () => { observer.disconnect(); return seen; } };
  };
}

describe('the Big O introduction’s question loader', () => {
  it('opens a fast answer without drawing the loader', async () => {
    const start = await prepareQuestions(0);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { quoteSeen } = start();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(LOADER_DELAY_MS - 1); });
      expect(screen.getByText(QUESTION)).toBeInTheDocument();
      expect(quoteSeen()).toBe(false);
    } finally {
      quoteSeen();
      vi.useRealTimers();
    }
  });

  it('keeps a loader that showed up for the beat instead of flashing it', async () => {
    const { startedAt, quoteSeen } = (await prepareQuestions(LOADER_DELAY_MS + 20))();
    expect(await screen.findByText(QUOTE)).toBeInTheDocument();
    await screen.findByText(QUESTION, undefined, { timeout: 3000 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(LOADER_DELAY_MS + LOADER_MIN_SHOWN_MS - 5);
    expect(quoteSeen()).toBe(true);
  });
});
