// The Learn map's serpentine on a phone. Six columns at 390px left each
// level 65px, under its 72px label, so names overlapped and were cut off; a
// narrow map now lays its nodes out three to a row. Locked names read in
// the secondary text colour, with the lock glyph as the locked cue.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: null, isAuthenticated: false, isLoading: false }),
}));

// The map measures its container; jsdom lays nothing out, so the width is set here.
let mapWidth = 0;
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => vi.restoreAllMocks());

const level = (n: number) => ({ level: n, title: `Level ${n}`, difficulty: 1, questionCount: 10 });
let visits = 0;
async function renderMap(width: number) {
  mapWidth = width;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width: mapWidth, height: 0, top: 0, left: 0, right: mapWidth, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  server.use(http.get('*/api/quiz/roadmap', ({ request }) => new URL(request.url).searchParams.get('resource') === 'learning-path-catalog'
      ? HttpResponse.json({ versions: {}, paths: [] })
      : new URL(request.url).searchParams.get('resource') === 'progress'
    ? HttpResponse.json({ data: {}, extra: { unlocked: [] } })
    : HttpResponse.json({ topics: ['javascript'], structure: { javascript: { levels: Array.from({ length: 10 }, (_, i) => level(i + 1)), checkpoints: [] } } })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/learn', key: `map-${++visits}` }]}>
        <LanguageProvider><Roadmap /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByText('Level 10');
  // Each node's box: absolutely placed at its column and row.
  const boxes = [...document.querySelectorAll<HTMLElement>('.rm-node')].map((node) => node.parentElement!);
  return {
    rowTops: boxes.map((box) => parseFloat(box.style.top)),
    labelWidths: ['Level 1', 'Level 2', 'Level 5'].map((name) => parseFloat(screen.getByText(name).style.maxWidth)),
  };
}
// The current level sits 3px higher than its row (it is drawn larger).
const nodesInFirstRow = (tops: number[]) => tops.filter((top) => Math.abs(top - tops[0]) < 10).length;

describe('the Learn map at phone width', () => {
  it.each([320, 390])('lays the map out three to a row at %ipx, each label inside its column', async (width) => {
    const { rowTops, labelWidths } = await renderMap(width);
    expect(rowTops.length).toBeGreaterThan(10); // ten levels and their checkpoints
    expect(nodesInFirstRow(rowTops)).toBe(3);
    for (const labelWidth of labelWidths) expect(labelWidth).toBeLessThanOrEqual(width / 3);
  });

  it('keeps six to a row on a wider screen', async () => {
    const { rowTops, labelWidths } = await renderMap(800);
    expect(nodesInFirstRow(rowTops)).toBe(6);
    for (const labelWidth of labelWidths) expect(labelWidth).toBeLessThanOrEqual(800 / 6);
  });

  it('writes a locked level’s name in the secondary text colour', async () => {
    await renderMap(390);
    expect(screen.getByRole('button', { name: 'Level 2: Level 2, Locked' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Level 2').style.color).toBe('var(--color-text-secondary)');
    expect(screen.getByText('Level 1').style.color).toBe('var(--color-text-primary)');
  });

  // UX audit learn-18: a level was 40px on a mouse, under the 44px target.
  it('draws every level node at least 44px and every part test at 52px, on every pointer', async () => {
    await renderMap(800);
    const sizes = [...document.querySelectorAll<HTMLElement>('.rm-node button')]
      .map((button) => ({ test: button.style.borderRadius === '14px', width: parseFloat(button.style.width), height: parseFloat(button.style.height) }));
    // A part test is the rounded square; a level is the circle.
    const tests = sizes.filter(({ test }) => test);
    expect(tests.length).toBeGreaterThan(0);
    expect(sizes.length).toBeGreaterThan(tests.length);
    for (const { width, height } of sizes) {
      expect(width).toBeGreaterThanOrEqual(44);
      expect(height).toBe(width);
    }
    for (const { width } of tests) expect(width).toBe(52);
  });
});

// Closing a level removed the control that closed it, and focus fell to the
// top of the page: a keyboard learner tabbed back through the shell and the
// whole map to the step they had just played.
describe('back on the Learn map', () => {
  it('returns focus to the level that was open', async () => {
    const question = { id: 'q-1', tags: [], introduction: '', question: 'Which option is first?', options: ['Option A', 'Option B'], category: 'javascript', difficulty: 1 };
    await renderMap(800);
    server.use(http.get('*/api/quiz/roadmap', ({ request }) => (new URL(request.url).searchParams.get('level')
      ? HttpResponse.json({ kind: 'level', topic: 'javascript', ref: 1, title: 'Level 1', passPct: 75, sessionId: 'session-1', questions: [question] })
      : undefined)));
    fireEvent.click(screen.getByRole('button', { name: /^Level 1: Level 1/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Exit lesson' }, { timeout: 5000 }));
    const node = await screen.findByRole('button', { name: /^Level 1: Level 1/ });
    await waitFor(() => expect(node).toHaveFocus());
  });
});
