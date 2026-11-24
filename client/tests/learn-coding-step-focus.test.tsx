// The coding step of a Learn level takes focus when the questions turn into
// it, as the intro, every question and the result do (UX audit learn-02).
// Found by the paths walk (#587): the last question's Continue that held focus
// was removed and focus fell to the page, so a keyboard learner started again
// at the site header.
import { beforeAll, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { LessonRunner } from '../src/components/learn/LessonRunner';
import type { RoadmapPlayable } from '../src/types/quiz';
import { server } from './mocks/server';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ ariaLabel, value }: { ariaLabel: string; value?: string }) => <textarea aria-label={ariaLabel} value={value ?? ''} readOnly />,
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const QUESTION = { id: 'q-1', tags: [], introduction: '', question: 'Which option is first?', options: ['Option A', 'Option B'], category: 'javascript', difficulty: 1 };
const TASK = {
  id: 'js-digit-sum', track: 'javascript', level: 1, tier: 'foundations', difficulty: 1, focus: 'loops', title: 'Digit sum', verify: 'tests',
  estimatedMinutes: 5, free: true, prompt: 'Sum the digits.', starter: 'const digitSum = (n) => 0;', hints: ['Use % 10.'], approach: [],
  tests: [{ call: 'digitSum(12)', label: 'two digits' }],
};
const PLAYABLE = {
  kind: 'level', topic: 'javascript', ref: 1, title: 'Level 1 title', passPct: 75, sessionId: 'session-1',
  questions: [QUESTION], coding: [{ task: TASK, session: 'code-session-1' }],
} as unknown as RoadmapPlayable;

it('moves focus to the coding step when the last question gives way to it', async () => {
  server.use(
    http.post('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'coding-submit') return HttpResponse.json({ verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null, progress: null, firstPass: false, xpAwarded: 0 });
      return resource === 'answer'
        ? HttpResponse.json({ selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'Because it is first.' })
        : HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    }),
  );
  const t = ((key: string, values?: { n: number }) => key === 'coding.lesson.pending' ? `${values?.n} tasks left` : key) as never;
  await act(async () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter>
        <LanguageProvider>
          <LessonRunner playable={PLAYABLE} skipIntro topicColor="#0a7" hasNext={false} nextLabel="Next"
            onExit={() => {}} onFinished={() => {}} onNext={() => {}} onReplay={() => {}} t={t} />
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  fireEvent.click(await screen.findByRole('radio', { name: /Option A/ }));
  // The last question's action (Finish) holds focus as it is pressed.
  const go = await screen.findByRole('button', { name: 'roadmap.finish' });
  go.focus();
  fireEvent.click(go);
  const intro = await screen.findByText(/coding\.lesson\.intro/);
  await waitFor(() => expect(intro).toHaveFocus());
  expect(document.activeElement).not.toBe(document.body);
  const remaining = screen.getByText('1 tasks left: Digit sum');
  expect(remaining).toHaveAttribute('aria-live', 'polite');
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
  expect(await screen.findByText('0 tasks left: Digit sum')).toBe(remaining);
});
