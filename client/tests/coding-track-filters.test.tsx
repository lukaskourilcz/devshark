import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingTrackScreen } from '../src/components/coding/CodingSection';
import { CODING_INDEX } from '../../shared/coding-index';
import { formatOf } from '../../shared/coding-catalog';
import { evolvingStage } from '../../shared/evolving';

// UX audit coding-16: a track's filters are one row, a search and one select
// per filter, and the list is counted only once a filter narrows it.
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: 'premium', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  useCodingProgress: () => ({ data: { tasks: {}, due: [], javascriptLevelsCleared: 0 }, isLoading: false, isError: false, refetch: () => {} }),
  useCodingTask: () => ({ data: undefined }),
}));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] }, isPending: false, isError: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

function Search() {
  return <span data-testid="search">{useLocation().search}</span>;
}

const mount = (path = '/coding/javascript') => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <Routes><Route path="/coding/:track" element={<><CodingTrackScreen /><Search /></>} /></Routes>
      </LanguageProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

it('keeps every filter in one row: the search and a select each, with no chip rows', () => {
  const { container } = mount();
  const row = container.querySelector('.cd-search')!;
  expect(row.querySelector('input[type="search"]')).not.toBeNull();
  expect([...row.querySelectorAll('select')].map((select) => select.id)).toEqual([
    'javascript-technique', 'javascript-difficulty', 'javascript-time', 'javascript-format', 'javascript-status',
  ]);
  expect(container.querySelector('.cd-chips')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Techniques' })).toBeNull();
});

it('counts the list only once a filter narrows it, from a live region that is always there', () => {
  const { container } = mount();
  const count = container.querySelector('.cd-filter-count')!;
  expect(count).toHaveAttribute('role', 'status');
  expect(count).toBeEmptyDOMElement();
  fireEvent.change(screen.getByRole('combobox', { name: 'Techniques' }), { target: { value: 'loops' } });
  expect(count.textContent).toMatch(/^Showing \d+ of \d+$/);
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(count).toBeEmptyDOMElement();
});

it('reads and writes status and Saved through one select', () => {
  mount('/coding/javascript?status=open');
  const status = screen.getByRole('combobox', { name: 'Status' });
  expect(status).toHaveValue('open');
  fireEvent.change(status, { target: { value: 'saved' } });
  expect(screen.getByTestId('search').textContent).toBe('?saved=1');
  expect(status).toHaveValue('saved');
  fireEvent.change(status, { target: { value: 'passed' } });
  expect(screen.getByTestId('search').textContent).toBe('?status=passed');
  fireEvent.change(status, { target: { value: 'all' } });
  expect(screen.getByTestId('search').textContent).toBe('');
});

it('filters by the learner’s task type even when debugging tasks are graded by tests too', () => {
  const debugging = CODING_INDEX.find(task => task.track === 'javascript' && !evolvingStage(task.id) && formatOf(task) === 'debug')!;
  expect(debugging.verify).toBe('tests');
  mount('/coding/javascript?format=tests');
  const select = screen.getByRole('combobox', { name: 'Any task type' });
  expect(select).toHaveValue('all');
  expect(screen.getByRole('link', { name: new RegExp(debugging.title) })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: 'write' } });
  expect(screen.getByTestId('search')).toHaveTextContent('?format=write');
  expect(screen.queryByRole('link', { name: new RegExp(debugging.title) })).toBeNull();
  fireEvent.change(select, { target: { value: 'debug' } });
  expect(screen.getByRole('link', { name: new RegExp(debugging.title) })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Digit sum/ })).toBeNull();
});
