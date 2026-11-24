// Today's two closing panels: the target reached, and nothing queued. Both
// talk about the next day, so both say when it starts on the learner's clock
// (the server's day changes at 00:00 UTC). Reaching the target hands out
// nothing, so the panel promises nothing.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Today from '../src/components/Today';
import { localDayChangeTime, nextUtcDayStart } from '../src/lib/utcDay';
import { masteryDayKey } from '../../shared/mastery';
import { partRanges } from '../../shared/progression';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({
  value: { user: null as null | Record<string, unknown>, isAuthenticated: false, isLoading: false, signInWithGoogle: async () => {} },
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));
afterEach(() => { auth.value = { ...auth.value, user: null, isAuthenticated: false }; });
beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });

const TODAY = masteryDayKey();
const DAYS_AGO = (n: number) => masteryDayKey(new Date(Date.now() - n * 86_400_000));
const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1, questionCount: 8 });
const levels = (count: number) => Array.from({ length: count }, (_, i) => level(i + 1));
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const PASSED_TODAY = { passed: true, bestPct: 100, passDays: [TODAY], mastered: false, lastPassDay: TODAY };
const MASTERED = { passed: true, bestPct: 100, passDays: [DAYS_AGO(20), DAYS_AGO(15), DAYS_AGO(10)], mastered: true, masteredAt: DAYS_AGO(10), lastPassDay: DAYS_AGO(10) };
const dayChange = `Days change at ${localDayChangeTime()} your time.`;

function answer(structure: unknown, progress: unknown) {
  server.use(
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'progress') return HttpResponse.json({ data: progress, extra: { unlocked: [] } });
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      return HttpResponse.json(structure as never);
    }),
    http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
      ? HttpResponse.json(FREE)
      : HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
    // The signed-in extras under the plan (concepts due, runs, paths): not part of the test.
    http.all('*/api/*', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
  );
  localStorage.setItem('devquiz:roadmap:v2', JSON.stringify(progress));
}

async function mountToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/today']}>
        <LanguageProvider><Today /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}

describe('Today, target reached', () => {
  it('says the plan is complete and when the next day starts, and offers no card pack', async () => {
    answer(
      { topics: ['javascript', 'html', 'css'], structure: { javascript: { levels: levels(25), checkpoints: [] }, html: { levels: levels(6), checkpoints: [] }, css: { levels: levels(6), checkpoints: [] } } },
      { javascript: { levels: { 1: PASSED_TODAY, 2: PASSED_TODAY, 3: PASSED_TODAY }, checkpoints: {} } },
    );
    await mountToday();
    expect(await screen.findByText('Today’s plan is complete')).toBeInTheDocument();
    expect(screen.getByText('Target reached')).toBeInTheDocument();
    expect(screen.getByText(dayChange)).toBeInTheDocument();
    // The Shark Cards client is gone; nothing in the app opens a pack.
    expect(screen.queryByText('Card pack ready')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open your pack' })).toBeNull();
    expect(document.querySelector('a[href="/collection"]')).toBeNull();
  });
});

describe('Today left open past the day change', () => {
  afterEach(() => vi.useRealTimers());

  it('moves the plan on to the new day', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(
      { topics: ['javascript', 'html', 'css'], structure: { javascript: { levels: levels(25), checkpoints: [] }, html: { levels: levels(6), checkpoints: [] }, css: { levels: levels(6), checkpoints: [] } } },
      { javascript: { levels: { 1: PASSED_TODAY, 2: PASSED_TODAY, 3: PASSED_TODAY }, checkpoints: {} } },
    );
    await mountToday();
    expect(await screen.findByText('Today’s plan is complete')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(nextUtcDayStart() - Date.now() + 2_000); });
    expect(screen.queryByText('Today’s plan is complete')).toBeNull();
  });
});

describe('Today, nothing queued', () => {
  it('says a new plan comes tomorrow and when tomorrow starts', async () => {
    // A backend learner who passed the first part of JavaScript and not its
    // test: no review is due, the next level waits for the test, and no other
    // backend topic is open yet.
    auth.value = {
      ...auth.value,
      user: { id: 'user-1', user_metadata: { devquiz_learning_preference_v1: { schemaVersion: 1, baseTrack: 'backend', specialization: null } } },
      isAuthenticated: true,
    };
    const [part1] = partRanges(6);
    const passed = Object.fromEntries(Array.from({ length: part1.size }, (_, i) => [String(part1.startLevel + i), MASTERED]));
    answer({ topics: ['javascript'], structure: { javascript: { levels: levels(6), checkpoints: [] } } }, { javascript: { levels: passed, checkpoints: {} } });
    await mountToday();
    expect(await screen.findByText('Nothing is due today. A new plan is ready tomorrow.')).toBeInTheDocument();
    expect(screen.getByText(dayChange)).toBeInTheDocument();
  });
});

// UX audit U2, questions-13: one visible h1 with the day's count on its row,
// no line repeated on every card, and Start here as a tag after the title.
describe('Today, a fresh plan', () => {
  it('opens on a visible h1 with the count beside it, and repeats nothing', async () => {
    answer(
      { topics: ['javascript', 'html', 'css'], structure: { javascript: { levels: levels(25), checkpoints: [] }, html: { levels: levels(6), checkpoints: [] }, css: { levels: levels(6), checkpoints: [] } } },
      {},
    );
    await mountToday();
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Today' });
    expect(h1).not.toHaveClass('ss-sr-only');
    expect(h1.parentElement).toHaveTextContent('0/3 done');
    expect(screen.getByRole('progressbar', { name: '0/3 done' })).toBeInTheDocument();
    expect(screen.getByText(dayChange)).toBeInTheDocument();
    expect(screen.queryByText('Today’s target')).toBeNull();

    const cards = await screen.findAllByRole('link', { name: /Level 1/ });
    expect(cards).toHaveLength(3);
    // The same reason on every card says nothing, so no card shows it.
    expect(screen.queryByText('Next up on your path.')).toBeNull();
    // Start here sits on the title's row, after the title.
    const chip = screen.getByText('Start here');
    expect(chip.parentElement).toHaveClass('today-card__title');
    expect(chip.previousElementSibling).toHaveClass('today-card__meta');
    // On a phone the tag wraps under its title; the cards of one list share
    // the tallest card's height, so the Start here card is not the odd one.
    const css = readFileSync(new URL('../src/components/Today.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(max-width: 560px\) \{\s*\.today-list \{ display: grid; grid-auto-rows: 1fr; \}/);
    expect(css).toMatch(/\.today-list > li > \.today-card \{ flex: 1 1 auto;/);
    // Three new levels and three cards: the backlog line would repeat them.
    expect(screen.queryByText(/to finish|to review|\d+ new/)).toBeNull();
  });

  it('says the backlog only when there is more than the cards show, without zero counts', async () => {
    const due = { passed: true, bestPct: 90, passDays: [DAYS_AGO(2)], mastered: false, lastPassDay: DAYS_AGO(2) };
    answer(
      { topics: ['javascript', 'html', 'css'], structure: { javascript: { levels: levels(25), checkpoints: [] }, html: { levels: levels(6), checkpoints: [] }, css: { levels: levels(6), checkpoints: [] } } },
      { javascript: { levels: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [String(n), due])), checkpoints: {} } },
    );
    await mountToday();
    await screen.findByRole('heading', { level: 1, name: 'Today' });
    const line = await screen.findByText(/to review/);
    expect(line).toHaveTextContent(/^5 to review · \d+ new$/);
    expect(screen.queryByText(/0 to finish/)).toBeNull();
  });
});

it('uses the authored level title and keeps the target topic and level in the card', async () => {
  answer({topics:['html'], structure:{html:{levels:[{...level(1),title:'Structure & Semantics'}],checkpoints:[]}}}, {});
  await mountToday();
  const primary = await screen.findByText('Structure & Semantics');
  const card = primary.closest('a')!;
  expect(card).toHaveAttribute('href','/learn?topic=html&level=1');
  expect(card).toHaveTextContent('HTML · Level 1');
});


it.each([
  ['new', {}],
  ['unfinished', { html: { levels: { '1': { passed: false, bestPct: 30 } }, checkpoints: {} } }],
  ['review', { html: { levels: { '1': { passed: true, bestPct: 90, passDays: [DAYS_AGO(2)], mastered: false, lastPassDay: DAYS_AGO(2) } }, checkpoints: {} } }],
])('uses the actual level link and its fallback for a %s recommendation without a title', async (_kind, progress) => {
  answer({ topics: ['html'], structure: { html: { levels: [{ ...level(1), title: '' }], checkpoints: [] } } }, progress);
  await mountToday();
  const label = await screen.findByText('HTML · Level 1');
  expect(label.closest('a')).toHaveAttribute('href', '/learn?topic=html&level=1');
  expect(label.closest('a')?.querySelector('.today-card__context')).toBeNull();
});
