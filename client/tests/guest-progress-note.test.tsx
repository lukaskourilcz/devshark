import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import Quiz from '../src/components/Quiz';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({ value: { user: null as { id: string } | null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));
afterEach(() => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; });

const level = (n: number) => ({ level: n, title: `Level ${n}`, difficulty: 1, questionCount: 10 });
// The map holds its first render until the structure is here (lib/routeData.ts),
// so it mounts inside an awaited act, as page-holds.test.tsx does.
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
async function renderLearn() {
  server.use(
    http.get('*/api/quiz/roadmap', ({ request }) => new URL(request.url).searchParams.get('resource') === 'learning-path-catalog'
      ? HttpResponse.json({ versions: {}, paths: [] })
      : new URL(request.url).searchParams.get('resource') === 'progress'
      ? HttpResponse.json({ data: {}, extra: { unlocked: [] } })
      : HttpResponse.json({
        topics: ['html'],
        structure: { html: { levels: [level(1), level(2), level(3)], checkpoints: [] } },
      })),
    // A signed-in map reads the plan.
    http.get('*/api/user/*', ({ request }) => {
      const op = new URL(request.url).searchParams.get('op');
      if (op === 'entitlement') return HttpResponse.json(FREE);
      if (op === 'xp' || request.url.includes('/api/user/xp')) return HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } });
      return undefined;
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/learn', key: 'guest-learn' }]}>
        <LanguageProvider><Roadmap /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('heading', { level: 1 });
}

it('tells a guest on the Learn map that progress stays on this device', async () => {
  await renderLearn();
  expect(await screen.findByText('You’re not signed in, so this progress stays on this device only. Signing in starts from your account’s progress instead.')).toBeInTheDocument();
});

it('says nothing about this device while the session is restored, or to a signed-in learner', async () => {
  auth.value = { user: null, isAuthenticated: false, isLoading: true };
  await renderLearn();
  expect(screen.queryByText(/on this device only/)).toBeNull();
  cleanup();
  auth.value = { user: { id: 'user-1' }, isAuthenticated: true, isLoading: false };
  await renderLearn();
  expect(screen.queryByText(/on this device only/)).toBeNull();
});

it('tells a guest on the quiz result that the progress stays on this device', async () => {
  server.use(
    http.get('*/api/settings', () => HttpResponse.json({})),
    http.get('*/api/user/xp', () => HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } })),
    http.get('*/api/quiz/questions', () => HttpResponse.json({
      sessionId: 'session-1',
      questions: [{ id: 'q1', tags: [], introduction: '', question: 'Which element makes a link?', options: ['anchor', 'paragraph'], category: 'html', difficulty: 1 }],
    })),
    http.post('*/api/quiz/submit', () => HttpResponse.json({
      totalQuestions: 1, correctAnswers: 1, percentage: 100, questXp: 10,
      results: [{ questionId: 'q1', selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'An anchor.' }],
    })),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/quiz']}>
        <LanguageProvider><Quiz /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // This fixture is an HTML quiz; selecting its topic keeps the persistence
  // assertion independent of the setup's expanded/collapsed topic controls.
  fireEvent.click(await screen.findByRole('button', { name: 'HTML', pressed: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Start quiz' }));
  fireEvent.click(await screen.findByRole('radio', { name: /anchor/ }, { timeout: 4000 }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit quiz' }));
  expect(await screen.findByText('You’re not signed in, so this progress stays on this device only. Signing in starts from your account’s progress instead.')).toBeInTheDocument();
}, 15_000);
