// The coding review queue is retired: a pass is permanent and the API always
// answers `due: []` (lib/coding/handlers.ts). What was left of it in the
// browser (C3-11) is gone: the "Due for review" filter, which could only ever
// list nothing, and the line that promised the queue would keep passed tasks
// fresh. Today's side is in page-holds.test.tsx.
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingHome, CodingTrackScreen } from '../src/components/coding/CodingSection';
import type { CodingProgressResponse, CodingTaskProgress } from '../../shared/coding-api';
import { CODING_INDEX } from '../../shared/coding-index';
import { evolvingStage } from '../../shared/evolving';

const passed: CodingTaskProgress = { status: 'passed', passes: 1, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null };
const state = vi.hoisted(() => ({ progress: undefined as CodingProgressResponse | undefined }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: 'premium', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => ({ data: state.progress, isLoading: false, isError: false, refetch: () => {} }),
  useCodingTask: () => ({ data: undefined }),
}));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] }, isPending: false, isError: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/components/coding/ChallengeRunPlanner', () => ({ ChallengeRunPlanner: () => null, taskHref: (id: string) => `/coding/javascript/${id}` }));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

function mount(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <Routes>
            <Route path="/coding" element={<CodingHome />} />
            <Route path="/coding/:track" element={<CodingTrackScreen />} />
          </Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // The server's answer, a stale review date on a passed task included: the
  // date is ignored and nothing is due.
  state.progress = { tasks: { 'js-double-numbers': { ...passed, nextReviewAt: '2026-01-01T00:00:00Z' } }, due: [], javascriptLevelsCleared: 0, passedByTrack: {} as CodingProgressResponse['passedByTrack'] };
});

// UX audit coding-16: status is one select in the single filter row.
it('filters a track by all, open, passed and saved, and offers no review filter', () => {
  mount('/coding/javascript');
  const status = screen.getByRole('combobox', { name: 'Status' });
  expect(within(status).getAllByRole('option').map((option) => option.textContent)).toEqual(['Any status', 'Open', 'Passed', 'Saved']);
  expect(screen.queryByText(/Due for review/)).toBeNull();
});

it('lists the whole track for an old review-queue link, rather than nothing', () => {
  mount('/coding/javascript?status=due');
  const whole = CODING_INDEX.filter((task) => task.track === 'javascript' && !evolvingStage(task.id)).length;
  expect(document.querySelectorAll('.cd-rows > li')).toHaveLength(20);
  expect(screen.getByText(`1–20 of ${whole} · Page 1 of ${Math.ceil(whole / 20)}`)).toBeInTheDocument();
  // Nothing narrows the list, so it does not count it: the header holds the total.
  expect(screen.queryByText(/^Showing \d+ of \d+$/)).toBeNull();
  expect(screen.queryByText('No challenge matches those filters. Clear them to see the rest.')).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
});

it('says every open task is passed without promising a review queue', () => {
  const sectionTasks = CODING_INDEX.filter((task) => task.track !== 'system-design');
  state.progress = { ...state.progress!, tasks: Object.fromEntries(sectionTasks.map((task) => [task.id, passed])) };
  mount('/coding');
  const card = screen.getByRole('region', { name: 'Your next challenge' });
  expect(card).toHaveTextContent('Every open task is passed.');
  expect(card).not.toHaveTextContent(/review/i);
});
