import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { preloadPath } from '../src/lib/routePreload';
import { CodingTaskScreen, CodingTrackScreen } from '../src/components/coding/CodingSection';
import Collection from '../src/components/Collection';
import { DifficultyBadge } from '../src/coding/DifficultyBadge';
import { CODING_INDEX } from '../../shared/coding-index';
import { EVOLVING_CHALLENGES, evolvingStage } from '../../shared/evolving';

// Signed out unless a case says otherwise: no progress, no bookmarks, no run.
// The lists and labels come from the generated index alone, which is what
// the browser really reads.
const state = vi.hoisted(() => ({ signedIn: false, saved: [] as string[] }));
// The task screen loads its editor beside the task; load it once up front
// so each screen draws the (mocked) workbench on its first render.
beforeAll(() => preloadPath('/coding/javascript/js-digit-sum'));
beforeEach(() => { state.signedIn = false; state.saved = []; });
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: state.signedIn, signInWithGoogle: vi.fn() }) }));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => (state.signedIn ? { data: { saved: state.saved }, isPending: false, isError: false } : { data: undefined }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => ({ data: undefined }),
  useCodingTask: (id: string) => ({ data: {
    task: { id, track: 'javascript', tier: 2, starter: '// starter' },
    draft: null, signedIn: false, locked: null, session: null,
  } }),
}));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function mount(path: string, element: ReactNode, route: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LanguageProvider>
          <Routes><Route path={route} element={<>{element}<Search /></>} /></Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const bandHeadings = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
  .filter((text) => text === 'Easy' || text === 'Medium' || text === 'Hard');

describe('difficulty labels on a track page', () => {
  it('groups Easy, Medium and Hard in that order, with the tier as a sub-label', () => {
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    expect(bandHeadings()).toEqual(['Easy', 'Medium', 'Hard']);
    const easy = screen.getByRole('region', { name: 'Easy' });
    expect(within(easy).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Foundations', 'Fluency']);
    const hard = screen.getByRole('region', { name: 'Hard' });
    expect(within(hard).getByRole('heading', { level: 3, name: 'Interview' })).toBeInTheDocument();
    // Each challenge sits in the band its index row names, once.
    const standalone = CODING_INDEX.filter((task) => task.track === 'javascript' && !evolvingStage(task.id));
    expect(within(easy).getAllByRole('listitem')).toHaveLength(standalone.filter((task) => task.difficulty === 'easy').length);
  });

  it('offers the three labels in the difficulty filter and keeps the choice in the URL', () => {
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    const select = screen.getByLabelText('Any difficulty') as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Any difficulty', 'Easy', 'Medium', 'Hard']);
    fireEvent.change(select, { target: { value: 'medium' } });
    expect(screen.getByTestId('search').textContent).toBe('?difficulty=medium');
    expect(bandHeadings()).toEqual(['Medium']);
  });

  it('reads an older tier link as the label that tier projects to', () => {
    mount('/coding/javascript?tier=4', <CodingTrackScreen />, '/coding/:track');
    expect((screen.getByLabelText('Any difficulty') as HTMLSelectElement).value).toBe('hard');
    expect(bandHeadings()).toEqual(['Hard']);
    fireEvent.change(screen.getByLabelText('Any difficulty'), { target: { value: 'easy' } });
    expect(screen.getByTestId('search').textContent).toBe('?difficulty=easy');
  });
});

describe('searching a track', () => {
  // The search reads the title the row shows and the technique tags, nothing
  // a learner cannot see.
  const rows = () => screen.queryAllByRole('listitem').map((row) => row.textContent ?? '');
  it('finds a challenge by its title', () => {
    mount('/coding/javascript?q=zip%20two', <CodingTrackScreen />, '/coding/:track');
    expect(rows().some((row) => row.includes('Zip two lists'))).toBe(true);
  });

  // The box read its value from the URL, which the router updates in a
  // transition: until the list re-rendered, React put the old value back, so
  // a key typed in that time replaced the one before it.
  it('keeps each key typed in the search box before the list catches up', async () => {
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    const box = screen.getByRole('searchbox') as HTMLInputElement;
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const wasAct = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      // As a browser types: the value changes, then `input` fires.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'z');
      box.dispatchEvent(new Event('input', { bubbles: true }));
      expect(box.value).toBe('z');
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = wasAct;
    }
    await act(async () => {});
    expect(screen.getByTestId('search').textContent).toBe('?q=z');
    expect(box.value).toBe('z');
    // Reset clears the box with the filters it belongs to.
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByTestId('search').textContent).toBe('');
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  });
});

describe('the format filter', () => {
  it('offers only formats a challenge can have, and reads an old checklist link as no filter', () => {
    mount('/coding/react?format=checklist', <CodingTrackScreen />, '/coding/:track');
    const select = screen.getByLabelText('Any task type') as HTMLSelectElement;
    expect([...select.options].map((option) => option.value)).toEqual(['all', 'write', 'debug']);
    expect(select.value).toBe('all');
    // Every React challenge is graded by tests, so none disappears.
    const standalone = CODING_INDEX.filter((task) => task.track === 'react' && !evolvingStage(task.id));
    expect(standalone.every((task) => task.verify === 'tests')).toBe(true);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(standalone.length);
  });
});

describe('quiet numbered stage navigation', () => {
  const projects = [10, 12, 5].map(count => EVOLVING_CHALLENGES.find(one => one.stages.length === count)!);
  it.each(projects)('keeps every stage of $id available without difficulty headings', challenge => {
    mount(`/coding/javascript/${challenge.stages[0]}`, <CodingTaskScreen />, '/coding/:track/:taskId');
    const nav = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(nav).getByText('Level:')).toBeVisible();
    expect(within(nav).queryByRole('group')).toBeNull();
    expect(within(nav).queryByText(/^(Easy|Medium|Hard)$/)).toBeNull();
    expect(within(nav).getAllByRole('link').length + within(nav).getAllByRole('button').length).toBe(challenge.stages.length);
    expect(within(nav).getByRole('link')).toHaveAttribute('aria-current', 'step');
  });
});

describe('the badge', () => {
  it('is text, and names itself for a screen reader', () => {
    render(<LanguageProvider><DifficultyBadge difficulty="medium" /></LanguageProvider>);
    const badge = screen.getByText('Medium').closest('.cd-difficulty')!;
    expect(badge.textContent).toBe('Difficulty Medium');
    expect(badge.getAttribute('data-difficulty')).toBe('medium');
  });
});

describe('difficulty labels where a signed-in learner lists challenges', () => {
  it('shows the label on every saved challenge in Collection', () => {
    state.signedIn = true;
    state.saved = ['js-double-numbers', 'js-evolving-calculator-4'];
    mount('/collection?tab=challenges', <Collection />, '/collection');
    const rows = screen.getAllByRole('link', { name: /Difficulty/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      'Double numbersDifficulty EasyJavaScript',
      'Expression engine · 8Difficulty HardJavaScript',
    ]);
  });
});
