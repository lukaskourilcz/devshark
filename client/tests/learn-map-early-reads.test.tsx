// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// The Learn map's own reads start beside its first-data hold, not after its
// first draw (perf baseline #587 C07): the account's progress and XP, and on
// the FDE section the path catalogue and the account's enrollments. The map
// still draws when the structure and the plan are in, and it syncs once per
// mount, not again on a section switch.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'user-early', user_metadata: {} }, isAuthenticated: true, isLoading: false, signInWithGoogle: async () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 600, width: 720, height: 600, toJSON: () => ({}) } as DOMRect);
});

const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const TOPICS = ['javascript', 'dsa', 'ai-llms'];
const STRUCTURE = { topics: TOPICS, structure: Object.fromEntries(TOPICS.map((topic) => [topic, { levels: Array.from({ length: 6 }, (_, i) => level(i + 1)), checkpoints: [] }])) };
const PREMIUM = { tier: 'premium', source: 'stripe', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };

function answer(structureDelay: number, progressDelay = 0) {
  const log: string[] = [];
  server.use(
    http.get('*/api/quiz/roadmap', async ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource') ?? 'structure';
      log.push(resource);
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      if (resource === 'progress') {
        await delay(progressDelay);
        log.push('progress answered');
        return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
      }
      await delay(structureDelay);
      log.push('structure answered');
      return HttpResponse.json(STRUCTURE as never);
    }),
    http.get('*/api/user/*', ({ request }) => {
      const url = new URL(request.url);
      const op = url.searchParams.get('op') ?? url.pathname.split('/').pop()!;
      log.push(op);
      if (op === 'entitlement') return HttpResponse.json(PREMIUM);
      if (op === 'xp') return HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } });
      return HttpResponse.json({ enrollments: [] });
    }),
  );
  return log;
}

// Each mount is a visit of its own: the hold keys its wait by the visit.
let visits = 0;
async function mount(section: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, learningPaths: { paths: { fde: { enabled: false } } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: `/learn/${section}`, key: `early-${++visits}` }]}>
        <LanguageProvider><Routes><Route path="/learn/:section?" element={<Roadmap />} /></Routes></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}

const before = (log: string[], read: string) => {
  expect(log).toContain(read);
  expect(log.indexOf(read)).toBeLessThan(log.indexOf('structure answered'));
};

describe('the Learn map’s reads', () => {
  it('asks for the account’s progress and XP while the structure is still on its way', async () => {
    const log = answer(250);
    await mount('web-developer');
    await waitFor(() => expect(log).toContain('structure answered'), { timeout: 3000 });
    before(log, 'progress');
    before(log, 'xp');
    expect(log.filter((one) => one === 'xp')).toHaveLength(1);
  });

  it('asks the FDE section’s catalogue and enrollments while the structure is still on its way', async () => {
    const log = answer(250);
    await mount('forward-deployed-engineer');
    await waitFor(() => expect(log).toContain('structure answered'), { timeout: 3000 });
    before(log, 'learning-path-catalog');
    before(log, 'learning-path-enrollment');
  });

  it('syncs once per mount: a section switch reads no XP again, a new mount does', async () => {
    const log = answer(0);
    await mount('web-developer');
    await waitFor(() => expect(log.filter((one) => one === 'xp')).toHaveLength(1));
    fireEvent.click(await screen.findByRole('radio', { name: /Software Engineer/ }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    expect(log.filter((one) => one === 'xp')).toHaveLength(1);
  });

  it('syncs again on the next visit to the map', async () => {
    const log = answer(0);
    await mount('web-developer');
    await waitFor(() => expect(log.filter((one) => one === 'xp')).toHaveLength(1));
  });

  // The map picks its topic on its first draw from the progress the device
  // holds, so a signed-in deep link to a topic progress opens needs the
  // account's record merged by then. The hold waits for the sync the map
  // started beside it, and does not read progress a second time.
  it('draws once the account’s progress sync has answered, and reads progress once', async () => {
    const log = answer(0, 400);
    await mount('web-developer');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(log).toContain('structure answered');
    expect(log).not.toContain('progress answered');
    expect(screen.queryByRole('radiogroup', { name: 'Choose a topic' })).toBeNull();
    await screen.findByRole('radiogroup', { name: 'Choose a topic' }, { timeout: 3000 });
    expect(log).toContain('progress answered');
    expect(log.filter((one) => one === 'progress')).toHaveLength(1);
  });
});
