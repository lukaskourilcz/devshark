import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingHome, CodingTrackScreen } from '../src/components/coding/CodingSection';
import type { CodingProgressResponse, PracticeSessionResponse } from '../../shared/coding-api';
import { rememberCodingTask } from '../src/coding/recentTasks';
import { accountEpoch, clearAccountData } from '../src/lib/accountData';
import { CODING_INDEX } from '../../shared/coding-index';
import { evolvingStage, listedChallenges } from '../../shared/evolving';
import type { Tier } from '../../shared/tiers';

// The Coding home's next-challenge card, in each state a reload goes through.
// Auth, the plan and progress are what the card waits on, so they are the mocks here.
const state = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  plan: { tier: 'premium' as Tier | null, loading: false },
  progress: { data: undefined as CodingProgressResponse | undefined, isLoading: true, isError: false, refetch: () => {} },
  run: { data: { session: null } as PracticeSessionResponse | undefined, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('../src/lib/auth', () => ({ useAuth: () => state.auth }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({
    tier: state.auth.isLoading ? null : state.auth.isAuthenticated ? state.plan.tier : 'free',
    signedIn: state.auth.isAuthenticated,
    loading: state.auth.isLoading || (state.auth.isAuthenticated && state.plan.loading),
    failed: false,
    data: null,
    refetch: () => {},
  }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => state.progress,
  useCodingTask: () => ({ data: undefined }),
}));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] } }),
  useSaveChallenge: () => ({ mutate: vi.fn() }),
  usePracticeSession: () => state.run,
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/components/coding/ChallengeRunPlanner', () => ({ ChallengeRunPlanner: () => null, taskHref: (id: string) => `/coding/javascript/${id}` }));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

const client = new QueryClient();
function LocationProbe() { return <output data-testid="location">{useLocation().pathname}</output>; }
const tree = () => <QueryClientProvider client={client}><MemoryRouter><LanguageProvider><CodingHome /><LocationProbe /></LanguageProvider></MemoryRouter></QueryClientProvider>;
const mount = () => render(tree());
const card = () => screen.getByRole('region', { name: 'Your next challenge' });
const passedDigitSum = { tasks: { 'js-digit-sum': { status: 'passed' } }, due: [], javascriptLevelsCleared: 0 } as unknown as CodingProgressResponse;

beforeEach(() => {
  localStorage.clear();
  // jsdom has no ResizeObserver; the project lists further down the page size themselves with one.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  state.auth = { isAuthenticated: true, isLoading: false };
  state.plan = { tier: 'premium', loading: false };
  state.progress = { data: undefined, isLoading: true, isError: false, refetch: () => {} };
  state.run = { data: { session: null }, isPending: false, isError: false, refetch: vi.fn() };
});

const queuedRun = (status: 'active' | 'scheduled'): NonNullable<PracticeSessionResponse['session']> => ({
  sessionId: 'run-1', status, queue: ['js-digit-sum', 'js-count-multiples'], position: 1,
  minutes: 10, topic: 'javascript', estimatedMinutes: 10, order: 'sequential', count: 2, scheduledFor: status === 'scheduled' ? '2026-12-01T10:00:00Z' : null,
});

it('prioritizes the active run over unrelated recommended tasks', () => {
  state.progress = { data: { ...passedDigitSum, tasks: {} }, isLoading: false, isError: false, refetch: () => {} };
  state.run.data = { session: queuedRun('active') };
  mount();
  const resume = screen.getByRole('region', { name: 'Continue your run' });
  expect(resume).toHaveTextContent('Count multiples');
  expect(within(resume).queryByText('Digit sum')).toBeNull();
  fireEvent.click(within(resume).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/coding/javascript/js-count-multiples');
});

it('does not silently start a scheduled run', () => {
  state.progress = { data: { ...passedDigitSum, tasks: {} }, isLoading: false, isError: false, refetch: () => {} };
  state.run.data = { session: queuedRun('scheduled') };
  mount();
  expect(card()).toHaveTextContent('Digit sum');
  expect(screen.queryByRole('region', { name: 'Continue your run' })).toBeNull();
});

it('waits for the open run before guessing another challenge, and retries a failed run read', () => {
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  state.run = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
  const view = mount();
  expect(card()).toHaveAttribute('aria-busy', 'true');
  expect(card()).not.toHaveTextContent('Count multiples');
  state.run.isPending = false;
  state.run.isError = true;
  view.rerender(tree());
  expect(within(card()).getByRole('alert')).toHaveTextContent('Could not load your challenge run.');
  fireEvent.click(within(card()).getByRole('button', { name: 'Try again' }));
  expect(state.run.refetch).toHaveBeenCalledOnce();
});

it('resumes a single unfinished project at its first unmet stage', () => {
  const project = listedChallenges({})[0];
  state.progress = { data: { ...passedDigitSum, tasks: { [project.stages[0]]: { status: 'passed' } } } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  mount();
  expect(card()).toHaveTextContent(project.title);
  fireEvent.click(within(card()).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent(`/coding/${project.track}/${project.stages[1]}`);
});

it('prefers an explicitly in-progress classic task over an untouched recommendation', () => {
  state.progress = { data: { ...passedDigitSum, tasks: { 'js-count-multiples': { status: 'in_progress' } } } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  mount();
  expect(card()).toHaveTextContent('Count multiples');
  expect(card()).not.toHaveTextContent('Digit sum');
});

it('still recommends an open project after every standalone task is passed', () => {
  const tasks = Object.fromEntries(CODING_INDEX.filter(task => !evolvingStage(task.id)).map(task => [task.id, { status: 'passed' }]));
  state.progress = { data: { ...passedDigitSum, tasks } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  mount();
  expect(card()).not.toHaveTextContent('Every open task is passed.');
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeEnabled();
});

it('automatically continues the most recently active unfinished project without a selector', () => {
  const projects = listedChallenges({}).slice(0, 2);
  state.progress = { data: { ...passedDigitSum, tasks: Object.fromEntries(projects.map((project, i) => [project.stages[0], { status: 'passed', updatedAt: `2026-11-0${i + 1}T12:00:00Z` }])) } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  mount();
  expect(within(card()).queryByRole('combobox')).toBeNull();
  expect(card()).toHaveTextContent(projects[1].title);
  fireEvent.click(within(card()).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent(`/coding/${projects[1].track}/${projects[1].stages[1]}`);
});

it('keeps an unfinished task with a revealed solution eligible for automatic resume', () => {
  state.progress = { data: { ...passedDigitSum, tasks: {
    'js-count-multiples': { status: 'in_progress', updatedAt: '2026-11-01T12:00:00Z' },
    'js-sum-array': { status: 'revealed', updatedAt: '2026-11-02T12:00:00Z' },
  } } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  mount();
  fireEvent.click(within(card()).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/coding/javascript/js-sum-array');
});

it('continues the last visited unfinished work, including a task not submitted yet', () => {
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  rememberCodingTask('js-sum-array', accountEpoch());
  rememberCodingTask('js-count-multiples', accountEpoch());
  mount();
  expect(card()).toHaveTextContent('Count multiples');
  fireEvent.click(within(card()).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent('/coding/javascript/js-count-multiples');
});

it('skips completed work in recent history and resumes the next stage of an unfinished project', () => {
  const project = listedChallenges({})[0];
  state.progress = { data: { ...passedDigitSum, tasks: { ...passedDigitSum.tasks, [project.stages[0]]: { status: 'passed' } } } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  rememberCodingTask(project.stages[0], accountEpoch());
  rememberCodingTask('js-digit-sum', accountEpoch());
  mount();
  expect(card()).toHaveTextContent(project.title);
  fireEvent.click(within(card()).getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('location')).toHaveTextContent(`/coding/${project.track}/${project.stages[1]}`);
});

it('does not reuse another account’s visit or a late write after sign-out', () => {
  const previous = accountEpoch();
  rememberCodingTask('js-count-multiples', previous);
  clearAccountData();
  rememberCodingTask('js-count-multiples', previous);
  state.progress = { data: { ...passedDigitSum, tasks: {} }, isLoading: false, isError: false, refetch: () => {} };
  mount();
  expect(card()).toHaveTextContent('Digit sum');
  expect(card()).not.toHaveTextContent('Count multiples');
});

it('names no challenge while a signed-in learner’s progress loads, then names theirs', () => {
  const view = mount();
  expect(card()).toHaveAttribute('aria-busy', 'true');
  // The first challenge of the catalogue is not the learner's next one: it must never flash up.
  expect(within(card()).queryByText('Digit sum')).toBeNull();
  expect(screen.getByText('Loading progress…')).toHaveClass('cd-visually-hidden');
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(screen.queryByText(/Sign in to keep your progress/)).toBeNull();

  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  view.rerender(tree());
  expect(card()).not.toHaveAttribute('aria-busy');
  expect(within(card()).queryByText('Digit sum')).toBeNull();
  expect(within(card()).getByText('Count multiples')).toBeInTheDocument();
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeEnabled();
});

it('waits for the account before choosing, and offers the first challenge to a visitor', () => {
  state.auth = { isAuthenticated: false, isLoading: true };
  state.progress = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  const view = mount();
  expect(within(card()).queryByText('Digit sum')).toBeNull();
  expect(screen.queryByText(/Sign in to keep your progress/)).toBeNull();

  state.auth = { isAuthenticated: false, isLoading: false };
  view.rerender(tree());
  expect(within(card()).getByText('Digit sum')).toBeInTheDocument();
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeEnabled();
  // UX audit coding-10: once, as a line under the subtitle, not a tinted bar.
  const hints = screen.getAllByText(/Sign in/);
  expect(hints).toHaveLength(1);
  expect(hints[0]).toHaveClass('cd-signin-line');
  expect(hints[0].closest('header')).toContainElement(screen.getByRole('heading', { level: 1 }));
});

it('says when progress did not load and retries on request, instead of guessing', () => {
  const refetch = vi.fn();
  state.progress = { data: undefined, isLoading: false, isError: true, refetch };
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Could not load your progress.');
  expect(within(card()).queryByText('Digit sum')).toBeNull();
  expect(within(card()).queryByRole('button', { name: 'Continue' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('keeps the card to the next challenge and Continue, beside the heading', () => {
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  mount();
  const next = card();
  expect(next.closest('.cd-home-head')?.querySelector('h1')).toHaveTextContent('Coding challenges');
  expect(next.querySelectorAll('button')).toHaveLength(1);
  expect(next.querySelector('a')).toBeNull();
  // The track line and the review count are gone from the card.
  expect(next).not.toHaveTextContent('JavaScript');
});

it('waits for a free account’s plan, then names a challenge the free plan opens', () => {
  state.plan = { tier: null, loading: true };
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  const view = mount();
  // Until the plan is known the card cannot tell a Premium challenge from a free one.
  expect(card()).toHaveAttribute('aria-busy', 'true');
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeDisabled();

  state.plan = { tier: 'free', loading: false };
  view.rerender(tree());
  expect(card()).not.toHaveAttribute('aria-busy');
  const title = card().querySelector('.cd-next__title')?.textContent ?? '';
  const named = CODING_INDEX.find((task) => task.title === title);
  expect(named?.free).toBe(true);
  expect(within(card()).getByRole('button', { name: 'Continue' })).toBeEnabled();
});

// C3-10: a technique row counted the technique in every track and opened one
// track's list, so "Loops · 148 challenges" opened a list of 80. The count is
// now the list's own, and says which track it is.
it('counts each technique the way the list it opens does', () => {
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  const home = mount();
  const rows = within(screen.getByRole('region', { name: 'Techniques' })).getAllByRole('link').map((link) => ({
    href: link.getAttribute('href') ?? '',
    count: link.querySelector('.cd-technique__count')?.textContent ?? '',
  }));
  home.unmount();
  expect(rows.length).toBeGreaterThan(5);
  for (const { href, count } of rows) {
    const list = render(
      <QueryClientProvider client={client}><MemoryRouter initialEntries={[href]}><LanguageProvider>
        <Routes><Route path="/coding/:track" element={<CodingTrackScreen />} /></Routes>
      </LanguageProvider></MemoryRouter></QueryClientProvider>,
    );
    const shown = /^Showing (\d+) of \d+$/.exec(screen.getByText(/^Showing \d+ of \d+$/).textContent ?? '')?.[1];
    const heading = screen.getByRole('heading', { level: 1 }).textContent;
    expect(heading, href).toMatch(/^(JavaScript|TypeScript|React|Algorithms)$/);
    expect(count, href).toBe(`${shown} challenges in ${heading}`);
    list.unmount();
  }
});

// UX audit coding-05: one SwimCta on the page (the next challenge), and every
// project or path row says where the learner stands with the quieter fin.
it('keeps one SwimCta and labels each row Start, Continue or Review by its progress', () => {
  const [untouched, partial, complete] = listedChallenges({ category: 'debugging' });
  const tasks = Object.fromEntries([
    [partial.stages[0], { status: 'passed' }],
    ...complete.stages.map((id) => [id, { status: 'passed' }]),
  ]);
  state.progress = { data: { tasks, due: [], javascriptLevelsCleared: 0 } as unknown as CodingProgressResponse, isLoading: false, isError: false, refetch: () => {} };
  const { container } = mount();
  expect(container.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
  expect(card().querySelector('.ss-swim-cta')).not.toBeNull();
  const row = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest('article')!;
  expect(within(row(untouched.title)).getByRole('button', { name: `Start ${untouched.title}` })).not.toHaveClass('ss-swim-cta');
  expect(within(row(partial.title)).getByRole('button', { name: `Continue ${partial.title}` })).not.toHaveClass('ss-swim-cta');
  expect(within(row(complete.title)).getByRole('button', { name: `Review ${complete.title}` })).not.toHaveClass('ss-swim-cta');
  // A Premium account sees no Premium rule anywhere on the page.
  expect(screen.queryByText(/come with the free plan/)).toBeNull();
});

// UX audit coding-09: a long list is not a scroll box inside the page. It
// shows five rows and a button for the rest, which moves focus to row six.
it('folds a long project list to five rows and opens the rest in place', () => {
  state.progress = { data: passedDigitSum, isLoading: false, isError: false, refetch: () => {} };
  mount();
  const section = screen.getByRole('region', { name: 'Evolving challenges' });
  const projects = listedChallenges({});
  expect(projects.length).toBeGreaterThan(5);
  expect(within(section).getAllByRole('article')).toHaveLength(5);
  expect(section.querySelector('[tabindex="0"]')).toBeNull();
  const more = within(section).getByRole('button', { name: `Show all ${projects.length} challenges` });
  expect(more).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(more);
  const rows = within(section).getAllByRole('article');
  expect(rows).toHaveLength(projects.length);
  expect(rows[5]).toHaveFocus();
  expect(rows[5]).toHaveAccessibleName(projects[5].title);
  const fewer = within(section).getByRole('button', { name: 'Show fewer' });
  expect(fewer).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(fewer);
  expect(within(section).getAllByRole('article')).toHaveLength(5);
});
