// A topic outside a signed-in learner's plan: the server serves only the
// steps already passed there (a replay) and refuses the rest with 403
// not_in_plan. Learn offers "Next" only where the server will serve it, and a
// refusal says what it is instead of "You need to sign in to do that."
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import { masteryDayKey } from '../../shared/mastery';
import type { RoadmapStructure } from '../src/types/quiz';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({
  value: { user: null as null | Record<string, unknown>, isAuthenticated: false, isLoading: false, signInWithGoogle: async () => {} },
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));

/** The backend track, whose plan has no HTML. */
const BACKEND = { schemaVersion: 1, baseTrack: 'backend', specialization: null };
const signInOnBackend = () => {
  auth.value = { ...auth.value, user: { id: 'user-1', user_metadata: { devquiz_learning_preference_v1: BACKEND } }, isAuthenticated: true };
};
afterEach(() => { auth.value = { ...auth.value, user: null, isAuthenticated: false }; });
beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });

const DAYS_AGO = (n: number) => masteryDayKey(new Date(Date.now() - n * 86_400_000));
const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const levels = (count: number) => Array.from({ length: count }, (_, i) => level(i + 1));
const STRUCTURE = {
  topics: ['javascript', 'html'],
  structure: { javascript: { levels: levels(25), checkpoints: [] }, html: { levels: levels(15), checkpoints: [] } },
} as unknown as RoadmapStructure;
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const MASTERED = { passed: true, bestPct: 100, passDays: [DAYS_AGO(20), DAYS_AGO(15), DAYS_AGO(10)], mastered: true, masteredAt: DAYS_AGO(10), lastPassDay: DAYS_AGO(10) };
const QUESTION = { id: 'q-1', tags: [], introduction: '', question: 'Which option is first?', options: ['Option A', 'Option B'], category: 'html', difficulty: 1 };
const NOT_IN_PLAN = { error: { code: 'not_in_plan', message: 'This topic is not part of the learning plan you chose' } };

/** Answers every request the map makes, the way the server does for a
 * backend learner in HTML: a passed level is served, anything else is 403. */
function answer(htmlProgress: Record<string, unknown>, refused: string[] = []) {
  const fetched: string[] = [];
  server.use(
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const resource = params.get('resource');
      if (resource === 'progress') return HttpResponse.json({ data: { html: htmlProgress }, extra: { unlocked: [] } });
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      const lvl = params.get('level');
      const test = params.get('test');
      if (lvl || test) {
        fetched.push(lvl ? `level:${lvl}` : `test:${test}`);
        const passed = lvl && (htmlProgress.levels as Record<string, unknown>)[lvl] && !refused.includes(lvl);
        if (!passed) return HttpResponse.json(NOT_IN_PLAN, { status: 403 });
        return HttpResponse.json({ kind: 'level', topic: 'html', ref: Number(lvl), title: `Level ${lvl} title`, passPct: 75, sessionId: `session-${lvl}`, questions: [QUESTION] });
      }
      return HttpResponse.json(STRUCTURE as never);
    }),
    http.post('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'answer') return HttpResponse.json({ selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'Because it is first.' });
      if (resource === 'complete') return HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: true, applied: true, codingPending: [], progress: { html: htmlProgress } });
      return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    }),
    http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
      ? HttpResponse.json(FREE)
      : HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
    http.all('*/api/*', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
  );
  localStorage.setItem('devquiz:roadmap:v2', JSON.stringify({ html: htmlProgress }));
  return fetched;
}

let visits = 0;
async function mountAt(path: string, page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const url = new URL(path, 'http://localhost');
  // The map reads its deep link from the window, as the browser has it.
  window.history.replaceState({}, '', path);
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: url.pathname, search: url.search, key: `out-of-plan-${++visits}` }]}>
        <LanguageProvider>{page}</LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}
afterEach(() => { window.history.replaceState({}, '', '/'); });

async function replayHtmlLevelOne() {
  await mountAt('/learn?topic=html&level=1', <Roadmap />);
  const start = await screen.findByRole('button', { name: 'Start the level' }, { timeout: 5000 }).catch(() => null);
  if (start) fireEvent.click(start);
  fireEvent.click(await screen.findByRole('radio', { name: /Option A/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
  expect(await screen.findByRole('heading', { name: 'Level complete' })).toBeInTheDocument();
}

describe('replaying a passed level outside the plan', () => {
  it('does not offer a next level the server would refuse', async () => {
    signInOnBackend();
    const fetched = answer({ levels: { 1: MASTERED }, checkpoints: {} });
    await replayHtmlLevelOne();
    expect(fetched).toEqual(['level:1']);
    expect(screen.queryByRole('button', { name: 'Next level' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to path' })).toBeInTheDocument();
  });

  it('offers the next level when it was passed too, and opens it', async () => {
    signInOnBackend();
    const fetched = answer({ levels: { 1: MASTERED, 2: MASTERED }, checkpoints: {} });
    await replayHtmlLevelOne();
    fireEvent.click(screen.getByRole('button', { name: 'Next level' }));
    await waitFor(() => expect(fetched).toEqual(['level:1', 'level:2']));
    expect(screen.queryByText('You need to sign in to do that.')).toBeNull();
  });
});

describe('a refusal for a signed-in learner', () => {
  it('names the plan, not signing in', async () => {
    signInOnBackend();
    // However the map came to offer it, a step refused as outside the plan.
    const fetched = answer({ levels: { 1: MASTERED, 2: MASTERED }, checkpoints: {} }, ['2']);
    await mountAt('/learn?topic=html&level=2', <Roadmap />);
    await waitFor(() => expect(fetched).toEqual(['level:2']), { timeout: 5000 });
    expect(await screen.findByText('Not in your learning plan. Choose your plan in Profile to open this topic.', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByText('You need to sign in to do that.')).toBeNull();
  });
});
