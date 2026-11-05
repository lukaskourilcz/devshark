import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { preloadPath } from '../src/lib/routePreload';
import { CodingTaskScreen, CodingTrackScreen, FullStackScreen } from '../src/components/coding/CodingSection';
import { CODING_INDEX } from '../../shared/coding-index';
import { EVOLVING_CHALLENGES } from '../../shared/evolving';

// Where the Premium locks (#220) meet the difficulty labels (#224): a
// signed-in account on the free plan, with no progress yet.
const sheet = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../src/lib/upgradeSheet', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/upgradeSheet')>(),
  openUpgradeSheet: sheet.open,
}));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, signInWithGoogle: vi.fn() }) }));
const FREE_PLAN = { tier: 'free', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} };
const plan = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
// The account's passes, by task id; none unless a test sets them.
const progress = vi.hoisted(() => ({ tasks: {} as Record<string, { status: 'passed' }> }));
vi.mock('../src/lib/entitlement', () => ({ useEntitlement: () => plan.value }));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] }, isPending: false, isError: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => ({ data: { tasks: progress.tasks, due: [], javascriptLevelsCleared: 0 }, isLoading: false, isError: false }),
  useCodingTask: (id: string) => ({ data: {
    task: { id, track: 'javascript', tier: 2, starter: '// starter' },
    draft: null, signedIn: true, locked: null, session: null,
  } }),
}));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

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

// The task screen loads its editor beside the task; load it once up front
// so each screen draws the (mocked) workbench on its first render.
beforeAll(() => preloadPath('/coding/javascript/js-digit-sum'));
beforeEach(() => {
  sheet.open.mockReset();
  plan.value = { ...FREE_PLAN };
  progress.tasks = {};
});

describe('the stage list on the free plan', () => {
  const project = EVOLVING_CHALLENGES.find((one) => one.stages.length === 10 && !one.short && one.stages[0].startsWith('js-'))!;

  it('names the free stages, labels checkpoints by their size and draws the rest as Premium that opens the sheet', () => {
    mount(`/coding/javascript/${project.stages[0]}`, <CodingTaskScreen />, '/coding/:track/:taskId');
    // The owner's decisions of 9 Oct 2026: the checkpoint and the first
    // milestone (stages 1 and 2), and the checkpoint after them (stage 3).
    expect(screen.getByText('Stages 1, 2 and 3 come with the free plan. Premium opens the stages after them.')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Levels' });
    expect(within(nav).getByText('Level:')).toBeVisible();
    expect(within(nav).queryByRole('group')).toBeNull();

    // Stage one is where the learner is. Stages 2 and 3 are free and wait for
    // the stages before them; the seven after them are Premium.
    const current = within(nav).getByRole('link');
    expect(current).toHaveAttribute('aria-current', 'step');
    const buttons = within(nav).getAllByRole('button');
    expect(buttons).toHaveLength(9);
    const premium = buttons.filter((button) => /, Premium$/.test(button.getAttribute('aria-label') ?? ''));
    expect(premium.map((button) => button.textContent)).toEqual(['4', '5', '6', '7', '8', '9', '10']);
    for (const button of premium) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
    }
    const waiting = buttons.filter((button) => !premium.includes(button));
    expect(waiting.map((button) => button.textContent)).toEqual(['2', '3']);
    for (const button of waiting) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByText('Complete stage 1 to unlock stage 3.', { selector: 'p' })).toHaveAttribute('role', 'status');
    expect(waiting[0]).toHaveAccessibleName('Level 2 of 10. Complete stage 1 to unlock stage 2.');
    expect(nav).not.toHaveTextContent('Current');
    expect(sheet.open).not.toHaveBeenCalled();
    fireEvent.click(premium[0]);
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'evolving-stage', ref: `${project.id}:4` });
  });

  // Reachable on the free plan: each free stage opens from the list once the
  // free stages before it are passed, and the stage after them is Premium
  // even with all of them passed. The last checkpoint (stage 9) used to be
  // free and could never open: stages 4 to 8 before it are Premium.
  it('opens each free stage once the free stages before it are passed', () => {
    for (const reached of [2, 3]) {
      progress.tasks = Object.fromEntries(project.stages.slice(0, reached - 1).map((id) => [id, { status: 'passed' as const }]));
      mount(`/coding/javascript/${project.stages[0]}`, <CodingTaskScreen />, '/coding/:track/:taskId');
      const nav = screen.getByRole('navigation');
      expect(within(nav).getByRole('link', { name: `Level ${reached} of 10` })).toHaveAttribute('href', `/coding/javascript/${project.stages[reached - 1]}`);
      cleanup();
    }
    progress.tasks = Object.fromEntries(project.stages.slice(0, 3).map((id) => [id, { status: 'passed' as const }]));
    mount(`/coding/javascript/${project.stages[0]}`, <CodingTaskScreen />, '/coding/:track/:taskId');
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['1', '2', '3']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Level 4 of 10, Premium' }));
    expect(sheet.open).toHaveBeenCalledWith({ kind: 'evolving-stage', ref: `${project.id}:4` });
  });
});

describe('the project cards on the free plan', () => {
  // UX audit coding-05: the rule is said once, in the list's intro, and every
  // row keeps only its "Premium" badge beside its progress line.
  it('name the stages the free plan opens once: 1 and 2 of a FullStack app, level 1 of a short path', () => {
    mount('/coding/fullstack', <FullStackScreen />, '/coding/fullstack');
    const list = screen.getByRole('region', { name: 'FullStack projects' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('FullStack projects');
    expect(screen.queryByRole('heading', { name: 'Evolving challenges' })).toBeNull();
    expect(within(list).getAllByText(/come with the free plan/)).toHaveLength(1);
    expect(within(list).getByText('Level 1 of every path, and stages 1 and 2 of every project, come with the free plan. Premium opens the rest.')).toBeInTheDocument();
    const rows = within(list).getAllByRole('article');
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(within(row).getByText('Premium')).toBeInTheDocument();
      expect(row).not.toHaveTextContent(/free plan/);
      expect(row.querySelector('.cd-project__track')).toBeNull();
      const title = within(row).getByRole('heading').textContent;
      expect(within(row).getByRole('button')).toHaveAccessibleName(`Start ${title}`);
    }
  });
});

describe('a track page on the free plan', () => {
  it('shows Premium accurately inside the paged catalogue', () => {
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    const easy = screen.getByRole('region', { name: 'Coding challenges' });
    const free = CODING_INDEX.find((task) => task.track === 'javascript' && task.difficulty === 'easy' && task.free && task.tier === 1)!;
    const premium = CODING_INDEX.find((task) => task.track === 'javascript' && task.difficulty === 'easy' && !task.free && task.tier === 1 && !task.id.includes('evolving') && !task.id.includes('-path-'))!;
    const rowOf = (title: string) => within(easy).getByText(title).closest('li')!;
    expect(within(rowOf(free.title)).queryByText('Premium')).toBeNull();
    expect(within(rowOf(premium.title)).getByText('Premium')).toBeInTheDocument();
  });
});

// Review finding product-13: a plan that has not loaded, or cannot load, is
// 'unknown', and no row may carry the Premium mark then; the page waits for
// the plan and says when it failed. A guest is barred like a free account
// (finding integrity-4).
describe('a track page before the plan is known', () => {
  const premiumTask = () => CODING_INDEX.find((task) => task.track === 'javascript' && task.difficulty === 'easy' && !task.free && task.tier === 1 && !task.id.includes('evolving') && !task.id.includes('-path-'))!;

  it('waits for the plan instead of drawing rows', () => {
    plan.value = { ...FREE_PLAN, tier: null, loading: true };
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    expect(screen.queryByRole('heading', { level: 2, name: 'Easy' })).toBeNull();
  });

  it('marks no row Premium when the plan cannot load, and offers to try again', () => {
    const refetch = vi.fn();
    plan.value = { ...FREE_PLAN, tier: null, failed: true, refetch };
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    const easy = screen.getByRole('region', { name: 'Coding challenges' });
    const row = within(easy).getByText(premiumTask().title).closest('li')!;
    expect(within(row).queryByText('Premium')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load your plan, so no challenge here carries the Premium mark.');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('draws a Premium row for a signed-out visitor as Premium', () => {
    plan.value = { ...FREE_PLAN, signedIn: false };
    mount('/coding/javascript', <CodingTrackScreen />, '/coding/:track');
    const easy = screen.getByRole('region', { name: 'Coding challenges' });
    const row = within(easy).getByText(premiumTask().title).closest('li')!;
    expect(within(row).getByText('Premium')).toBeInTheDocument();
    const premiumRow = row.querySelector<HTMLButtonElement>('button.cd-row--premium')!;
    expect(premiumRow).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(premiumRow);
    expect(sheet.open).toHaveBeenCalled();
  });
});
