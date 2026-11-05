import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { preloadPath } from '../src/lib/routePreload';
import { CodingHome, CodingTaskScreen, CodingTrackScreen } from '../src/components/coding/CodingSection';
import Collection from '../src/components/Collection';
import { CODING_INDEX } from '../../shared/coding-index';
import { EVOLVING_CHALLENGES, listedChallenges } from '../../shared/evolving';

// The debugging trio (#225): three short paths on the Coding home in place of
// the café-orders project, whose ten stages still open, count and resolve.
const state = vi.hoisted(() => ({ signedIn: false, saved: [] as string[], passed: [] as string[], savedStages: [] as string[] }));
// The task screen loads its editor beside the task; load it once up front
// so each screen draws the (mocked) workbench on its first render.
beforeAll(() => preloadPath('/coding/javascript/js-digit-sum'));
beforeEach(() => { state.signedIn = false; state.saved = []; state.passed = []; state.savedStages = []; });
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: state.signedIn, signInWithGoogle: vi.fn() }) }));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => (state.signedIn ? { data: { saved: state.saved }, isPending: false, isError: false } : { data: undefined }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
  useStartSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => ({
    data: state.passed.length
      ? { tasks: Object.fromEntries(state.passed.map((id) => [id, { status: 'passed' }])), due: [], javascriptLevelsCleared: 0, stagesWithSavedCode: state.savedStages }
      : undefined,
  }),
  useCodingTask: (id: string) => ({ data: {
    task: { id, track: 'javascript', tier: 2, starter: '// starter' },
    draft: null, signedIn: state.signedIn, locked: null, session: null,
  } }),
}));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));
// jsdom has no ResizeObserver; the Coding home's longer list sizes itself with one.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

function mount(path: string, element: ReactNode, route: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <Routes><Route path={route} element={element} /></Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TRIO = ['Log it right', 'Trace the state', 'Edges and inputs'];

describe('the debugging paths on the Coding home', () => {
  it('lists the three paths under their own heading, in levels, and not the old project', () => {
    mount('/coding', <CodingHome />, '/coding');
    const section = screen.getByRole('region', { name: 'Debugging paths' });
    expect(within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(TRIO);
    expect(within(section).getAllByText('0 of 5 levels completed')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'Debugging path' })).toBeNull();
  });

  it('counts a signed-in learner\'s passed levels', () => {
    state.signedIn = true;
    state.passed = ['js-path-tracing-1', 'js-path-tracing-2'];
    mount('/coding', <CodingHome />, '/coding');
    const section = screen.getByRole('region', { name: 'Debugging paths' });
    expect(within(section).getByText('2 of 5 levels completed')).toBeInTheDocument();
  });

  it('keeps the paths off the JavaScript page, which lists its own', () => {
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    for (const title of TRIO) expect(screen.queryByRole('heading', { name: title })).toBeNull();
  });

  it('lists the old project nowhere', () => {
    const old = EVOLVING_CHALLENGES.find((project) => project.id === 'js-evolving-debug')!;
    for (const list of [listedChallenges({}), listedChallenges({ category: 'debugging' }), listedChallenges({ category: 'fullstack' }), listedChallenges({ track: 'javascript' })]) {
      expect(list).not.toContain(old);
    }
  });
});

describe('a debugging level', () => {
  it.each(['js-path-logging-1', 'js-path-tracing-3', 'js-path-edges-2'])('%s keeps all five levels below the work', id => {
    mount(`/coding/javascript/${id}`, <CodingTaskScreen />, '/coding/:track/:taskId');
    const nav = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(nav).getByText('Level:')).toBeVisible();
    expect(within(nav).queryByRole('group')).toBeNull();
    expect(within(nav).getAllByRole('link').length + within(nav).getAllByRole('button').length).toBe(5);
  });
});

it('checks only passed levels whose code is saved, including on another visit', () => {
  state.signedIn = true;
  state.passed = ['js-path-logging-1', 'js-path-logging-2'];
  state.savedStages = ['js-path-logging-1'];
  mount('/coding/javascript/js-path-logging-3', <CodingTaskScreen />, '/coding/:track/:taskId');
  const nav = screen.getByRole('navigation', { name: 'Levels' });
  const first = within(nav).getByRole('link', { name: 'Level 1 of 5 · Passed' });
  const second = within(nav).getByRole('link', { name: 'Level 2 of 5 · Passed' });
  expect(first).toHaveTextContent('1 ✓');
  expect(second).toHaveTextContent('2');
  expect(second).not.toHaveTextContent('✓');
  expect(first).toHaveClass('cd-stage--complete');
  expect(second).toHaveClass('cd-stage--complete');
});

describe('the retired café-orders project', () => {
  it('keeps all ten stages in the browser index', () => {
    const old = EVOLVING_CHALLENGES.find((project) => project.id === 'js-evolving-debug')!;
    const indexed = new Set(CODING_INDEX.map((task) => task.id));
    expect(old.stages).toHaveLength(10);
    expect(old.stages.filter((id) => indexed.has(id))).toEqual(old.stages);
  });

  it('still opens a stage from an old link, with its stage list', () => {
    state.signedIn = true;
    state.passed = ['js-evolving-debug-1-start', 'js-evolving-debug-1'];
    mount('/coding/javascript/js-evolving-debug-2-start', <CodingTaskScreen />, '/coding/:track/:taskId');
    const nav = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(nav).getByRole('link', { name: 'Level 3 of 10' })).toHaveAttribute('aria-current', 'step');
    expect(within(nav).getByRole('link', { name: 'Level 2 of 10 · Passed' }).textContent).toBe('2');
  });

  it('shows a saved stage in Collection', () => {
    state.signedIn = true;
    state.saved = ['js-evolving-debug-2'];
    mount('/collection?tab=challenges', <Collection />, '/collection');
    expect(screen.getByRole('link', { name: /Debugging path · 4/ })).toHaveAttribute('href', '/coding/javascript/js-evolving-debug-2');
    expect(screen.queryByText(/unavailable/i)).toBeNull();
  });
});
