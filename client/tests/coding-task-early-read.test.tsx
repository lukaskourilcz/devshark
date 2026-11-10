// Perf baseline #587 C16: the task request started only after the task
// screen rendered. On the first page of a visit the section's chunk now asks
// for the task, and fetches the workbench, as it evaluates; the screen takes
// that answer instead of asking again. A hidden track asks for nothing.
// A free task asks for its brief and the caller's part apart (#587 C23),
// both as the chunk evaluates; a Premium task asks for the combined answer.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: false, isLoading: false }), signedInAccount: () => null }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: 'free', signedIn: false, loading: false, failed: false, data: null, refetch: () => {} }),
  entitlementQuery: () => ({ queryKey: ['entitlement'], queryFn: async () => null }),
}));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] }, isPending: false, isError: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
  bookmarksQuery: { queryKey: ['bookmarks'] },
  practiceSessionQuery: { queryKey: ['session'] },
}));
vi.mock('../src/components/coding/ChallengeRunPlanner', () => ({ ChallengeRunPlanner: () => null, taskHref: (id: string) => `/coding/javascript/${id}` }));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: ({ task }: { task: { title: string } }) => <p>workbench for {task.title}</p> }));
vi.mock('../src/coding/Editor', () => ({ Editor: () => null }));

const asked: string[] = [];
beforeEach(() => {
  vi.resetModules();
  asked.length = 0;
  server.use(http.get('*/api/quiz/roadmap', ({ request }) => {
    const url = new URL(request.url);
    const resource = url.searchParams.get('resource');
    const id = url.searchParams.get('id');
    asked.push(`${resource} ${id}`);
    const task = { id, track: 'javascript', level: 1, tier: 1, difficulty: 'easy', focus: [], title: 'Double numbers', prompt: 'p', starter: '', hints: [], verify: 'tests', estimatedMinutes: 5, tests: [] };
    const state = { session: 'sealed', locked: null, signedIn: false, draft: null, draftUpdatedAt: null, progress: null };
    if (resource === 'coding-brief') return HttpResponse.json({ task, version: 'v1' });
    if (resource === 'coding-state') return HttpResponse.json({ ...state, dealt: {}, briefVersion: 'v1' });
    return HttpResponse.json({ task, ...state });
  }));
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

async function firstPage(path: string) {
  window.history.replaceState(null, '', path);
  const section = await import('../src/components/coding/CodingSection');
  const { queryClient } = await import('../src/lib/queryClient');
  const { LanguageProvider } = await import('../src/i18n/LanguageContext');
  return { section, queryClient, LanguageProvider };
}

for (const [id, reads] of [
  ['js-double-numbers', ['coding-brief js-double-numbers', 'coding-state js-double-numbers']],
  ['js-palindrome', ['coding-task js-palindrome']],
] as const) {
  it(`asks for ${id} as the section loads, before the screen renders, and asks once`, async () => {
    const { section, queryClient, LanguageProvider } = await firstPage(`/coding/javascript/${id}`);
    // Nothing has rendered yet, and the requests are already out.
    await vi.waitFor(() => expect([...asked].sort()).toEqual(reads));
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/coding/javascript/${id}`]}>
            <LanguageProvider>
              <Routes><Route path="/coding/:track/:taskId" element={<section.CodingTaskScreen />} /></Routes>
            </LanguageProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(await screen.findByText('workbench for Double numbers')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect([...asked].sort()).toEqual(reads);
    queryClient.clear();
  });
}

it('asks for nothing on a hidden track or a list', async () => {
  await firstPage('/coding/system-design/sd-url-shortener');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(asked).toEqual([]);
  vi.resetModules();
  await firstPage('/coding/javascript');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  expect(asked).toEqual([]);
});


it('uses the second task’s saved Learn session when navigating between task routes', async () => {
  const nextId = 'js-double-numbers';
  const sealed = 'lesson-session-for-second-task';
  sessionStorage.setItem(`devshark:learn-coding:${nextId}`, sealed);
  const linkedReads: unknown[] = [];
  server.use(http.post('*/api/quiz/roadmap', async ({ request }) => {
    const url = new URL(request.url);
    linkedReads.push({ resource: url.searchParams.get('resource'), taskId: url.searchParams.get('id'), body: await request.json() });
    return HttpResponse.json({
      task: { id: nextId, track: 'javascript', level: 1, tier: 1, difficulty: 'easy', focus: [], title: 'Learn double numbers', prompt: 'p', starter: '', hints: [], verify: 'tests', estimatedMinutes: 5, tests: [] },
      session: sealed, locked: null, signedIn: false, draft: null, draftUpdatedAt: null, progress: null,
    });
  }));
  const first = '/coding/javascript/js-palindrome';
  const { section, queryClient, LanguageProvider } = await firstPage(first);
  try {
    await act(async () => {
      render(<QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[first]}>
          <LanguageProvider>
            <Link to={`/coding/javascript/${nextId}`}>Open linked task</Link>
            <Routes><Route path="/coding/:track/:taskId" element={<section.CodingTaskScreen />} /></Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>);
    });
    await screen.findByText('workbench for Double numbers');
    fireEvent.click(screen.getByRole('link', { name: 'Open linked task' }));
    await screen.findByText('workbench for Learn double numbers');
    expect(linkedReads).toEqual([{ resource: 'coding-task', taskId: nextId, body: { session: sealed } }]);
    expect(asked.some((read) => read.endsWith(nextId))).toBe(false);
  } finally {
    queryClient.clear();
    sessionStorage.removeItem(`devshark:learn-coding:${nextId}`);
  }
});
