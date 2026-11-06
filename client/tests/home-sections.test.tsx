// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// The home page's sections after the UX audit of 23 October 2026 (U5, #577):
// one section-title size, the FDE section's two columns and stats, and the
// topic grid that turns to two tiles a row on a phone.
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Home from '../src/components/Home';
import { server } from './mocks/server';
import { settingsHandler } from './mocks/handlers';

// The section reads the path's size with the shared counter; a real manifest
// is long, so the count is pinned here.
vi.mock('../../shared/learning-paths', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pathInventory: () => ({ modules: 15, lessons: 28, moduleChecks: 100, finalChecks: 20, moduleCodeExercises: 12, finalCodeExercises: 3 }),
}));

const auth = vi.hoisted(() => ({ value: { user: null, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => auth.value }));
vi.mock('../src/lib/billing', () => ({ useBilling: () => ({ known: true, enabled: false, launchOffer: false }) }));

const freeEntitlement = http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
  ? HttpResponse.json({ tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null })
  : undefined);

beforeEach(() => {
  server.use(
    settingsHandler,
    freeEntitlement,
    http.get('*/api/quiz/roadmap', ({ request }) => new URL(request.url).searchParams.get('resource') === 'learning-path-catalog'
      ? HttpResponse.json({ versions: {}, paths: [] })
      : undefined),
  );
});

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Home /></LanguageProvider></MemoryRouter></QueryClientProvider>);
}

// shell-public-16: home's h2s were 24, 28 and 36px, each set somewhere else.
it('gives every home section title the one shared section-title class', () => {
  renderHome();
  const titles = screen.getAllByRole('heading', { level: 2 });
  expect(titles.map((title) => title.textContent)).toEqual(expect.arrayContaining([
    'Pick a topic.', 'Inside JavaScript', 'Forward Deployed Engineer', 'Free and Premium',
  ]));
  for (const title of titles) {
    expect(title, title.textContent ?? '').toHaveClass('ss-section-title');
    expect(title.getAttribute('style') ?? '').not.toMatch(/font-size/);
  }
  // The table's first column no longer repeats the plans title.
  expect(within(screen.getByRole('table')).getAllByRole('columnheader')[0]).toHaveTextContent('Feature');
});

const fdeCatalog = (availability: string) => http.get('*/api/quiz/roadmap', ({ request }) => new URL(request.url).searchParams.get('resource') === 'learning-path-catalog'
  ? HttpResponse.json({ versions: { fde: 1 }, paths: [{ manifest: { id: 'fde', modules: [] }, availability }] })
  : undefined);

// shell-public-08: one access line, and the path's size as four stats beside
// the pitch rather than a fifth paragraph under it.
it('shows the FDE path as a pitch with one access line and four stats', async () => {
  server.use(fdeCatalog('available'));
  renderHome();
  const section = screen.getByRole('region', { name: 'Forward Deployed Engineer' });
  expect(within(section).getByText('New path')).toBeInTheDocument();
  await waitFor(() => expect(section.querySelector('.ss-fde-feature__stats')).not.toBeNull());
  const stats = section.querySelector('.ss-fde-feature__stats')!;
  expect([...stats.children].map((stat) => stat.textContent)).toEqual(['15Modules', '28Lessons', '120Questions', '15Code exercises']);
  // The pitch and its action sit in the left column, the stats on the right.
  const copy = section.querySelector('.ss-fde-feature__copy')!;
  expect(copy).toContainElement(within(section).getByRole('button', { name: 'Explore the FDE path' }));
  expect(section.querySelector('.ss-fde-feature__aside')).toContainElement(stats as HTMLElement);
  expect(within(section).getByText('The diagnostic and first module are free; Premium opens the rest as it becomes available. Your work in its exercises is recorded.')).toBeInTheDocument();
});

it('says in the same line that work is not recorded yet while the path is a preview', async () => {
  server.use(fdeCatalog('preview'));
  renderHome();
  const section = screen.getByRole('region', { name: 'Forward Deployed Engineer' });
  expect(await within(section).findByText('The diagnostic and first module are free; Premium opens the rest as it becomes available. Work is not recorded yet.')).toBeInTheDocument();
  expect(section.querySelectorAll('p')).toHaveLength(2);
});

// shell-public-09: the grid is a class, so a phone gets two tiles a row
// (landingSections.css) instead of 820px of one-word cards.
it('lays the topic picker out with the shared grid class, not an inline grid', () => {
  renderHome();
  const picker = screen.getByRole('region', { name: 'Pick a topic.' });
  const grid = picker.querySelector('.ss-topic-grid') as HTMLElement;
  expect(grid).not.toBeNull();
  expect(grid.getAttribute('style')).toBeNull();
  const tiles = within(grid).getAllByRole('button');
  expect(tiles.length).toBeGreaterThanOrEqual(8);
  // The selected tile says so by aria-pressed (and its border and tint); the
  // tick is decoration and hides on a phone.
  const selected = tiles.find((tile) => tile.getAttribute('aria-pressed') === 'true')!;
  expect(selected.querySelector('.ss-topic-card__tick')).toHaveAttribute('aria-hidden', 'true');
});
