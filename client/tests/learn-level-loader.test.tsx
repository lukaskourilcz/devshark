// Opening a Learn level no longer waits out a 1.2 s minimum loader (perf
// baseline #587 C05). A fast answer opens the level at once and never shows
// the loader; a slow one shows it after LOADER_DELAY_MS and keeps it at least
// LOADER_MIN_SHOWN_MS, so it never flickers.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import { DelayedQuoteLoader, LOADER_DELAY_MS, LOADER_MIN_SHOWN_MS, revealDelay } from '../src/components/learn/LevelLoader';
import { MIN_LOADING_MS } from '../src/components/LoadingScreen';
import type { RoadmapStructure } from '../src/types/quiz';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));

beforeAll(async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // The runner's chunk, as a learner who pointed at the level has it.
  await import('../src/components/learn/LessonRunner');
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 600, width: 720, height: 600, toJSON: () => ({}) } as DOMRect);
});

const QUOTE = 'Preparing your questions.';
const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const STRUCTURE = {
  topics: ['javascript'],
  structure: { javascript: { levels: Array.from({ length: 6 }, (_, i) => level(i + 1)), checkpoints: [] } },
} as unknown as RoadmapStructure;
const PLAYABLE = {
  kind: 'level', topic: 'javascript', ref: 1, title: 'Level 1 title', passPct: 75, sessionId: 'session-1',
  questions: [{ id: 'q-1', tags: [], introduction: '', question: 'Which option is first?', options: ['Option A', 'Option B'], category: 'javascript', difficulty: 1 }],
};

function answerLevelAfter(ms: number) {
  server.use(
    http.get('*/api/quiz/roadmap', async ({ request }) => {
      const params = new URL(request.url).searchParams;
      if (params.get('resource') === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      if (params.get('level')) {
        if (ms > 0) await delay(ms);
        return HttpResponse.json(PLAYABLE as never);
      }
      return HttpResponse.json(STRUCTURE as never);
    }),
  );
}

async function prepareLevelOne() {
  await act(async () => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <MemoryRouter initialEntries={['/learn']}>
        <LanguageProvider><Roadmap /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  const node = await screen.findByRole('button', { name: /^Level 1: Level 1 title/ });
  return () => {
    let seen = false;
    const observer = new MutationObserver(() => { if (document.body.textContent?.includes(QUOTE)) seen = true; });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const clickedAt = Date.now();
    fireEvent.click(node);
    return { clickedAt, quoteSeen: () => { observer.disconnect(); return seen; } };
  };
}

describe('the loader of a Learn level', () => {
  it('waits only for an answer slower than the delay, then holds it a short beat', () => {
    expect(LOADER_DELAY_MS + LOADER_MIN_SHOWN_MS).toBeLessThan(MIN_LOADING_MS);
    expect(revealDelay(1000, 1000 + 120)).toBe(0);
    expect(revealDelay(1000, 1000 + LOADER_DELAY_MS - 1)).toBe(0);
    expect(revealDelay(1000, 1000 + LOADER_DELAY_MS)).toBe(LOADER_MIN_SHOWN_MS);
    expect(revealDelay(1000, 1000 + 450)).toBe(LOADER_DELAY_MS + LOADER_MIN_SHOWN_MS - 450);
    expect(revealDelay(1000, 1000 + 2000)).toBe(0);
  });

  it('opens a fast level at once and never draws the loader', async () => {
    answerLevelAfter(0);
    const open = await prepareLevelOne();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const { quoteSeen } = open();
    try {
      // Let immediate network and rendering work finish before the loader delay.
      await act(async () => { await vi.advanceTimersByTimeAsync(LOADER_DELAY_MS - 1); });
      expect(screen.getByRole('button', { name: 'Start the level' })).toBeInTheDocument();
      expect(quoteSeen()).toBe(false);
    } finally {
      quoteSeen();
      vi.useRealTimers();
    }
  });

  it('shows the loader for a slow level and keeps it up for the beat', async () => {
    answerLevelAfter(LOADER_DELAY_MS + 50);
    const { clickedAt, quoteSeen } = (await prepareLevelOne())();
    expect(await screen.findByText(QUOTE)).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Start the level' });
    expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(LOADER_DELAY_MS + LOADER_MIN_SHOWN_MS - 5);
    expect(quoteSeen()).toBe(true);
  });

  it('keeps a loader already shown when a second one follows in the same wait', () => {
    render(<DelayedQuoteLoader since={Date.now() - LOADER_DELAY_MS - 1} quote={QUOTE} label="Loading…" />);
    expect(screen.getByText(QUOTE)).toBeInTheDocument();
  });

  it('holds the loader’s place, empty, before the delay', () => {
    const { container } = render(<DelayedQuoteLoader quote={QUOTE} label="Loading…" />);
    expect(screen.queryByText(QUOTE)).toBeNull();
    expect(container.querySelector('[data-loader="pending"]')).toHaveStyle({ flex: '1' });
  });
});
