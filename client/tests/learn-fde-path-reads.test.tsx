// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// While the settings say the FDE path is closed, a Learn section other than
// FDE reads neither the 30 KB path catalogue nor the account's enrollments
// (perf baseline #587 C06, C20). The FDE figure of the section switcher then
// counts the Learn topics only, as it did with the catalogue in hand.
import { useEffect, useState, type ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Roadmap from '../src/components/Roadmap';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY, useGameConfig } from '../src/lib/gameConfig';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'user-fde-off', user_metadata: {} }, isAuthenticated: true, isLoading: false, signInWithGoogle: async () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 600, width: 720, height: 600, toJSON: () => ({}) } as DOMRect);
});

const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const STRUCTURE = { topics: ['javascript'], structure: { javascript: { levels: Array.from({ length: 6 }, (_, i) => level(i + 1)), checkpoints: [] } } };
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const withPath = (enabled: boolean) => ({ ...DEFAULT_CONFIG, learningPaths: { paths: { fde: { enabled } } } });

function answer(settingsDelay = 0, enabled = false) {
  const asked: string[] = [];
  server.use(
    http.get('*/api/settings', async () => {
      asked.push('settings');
      await delay(settingsDelay);
      return HttpResponse.json(withPath(enabled));
    }),
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource') ?? 'structure';
      asked.push(resource);
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      if (resource === 'progress') return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
      return HttpResponse.json(STRUCTURE as never);
    }),
    http.get('*/api/user/*', ({ request }) => {
      const url = new URL(request.url);
      const op = url.searchParams.get('op') ?? url.pathname.split('/').pop()!;
      asked.push(op);
      if (op === 'entitlement') return HttpResponse.json(FREE);
      if (op === 'xp') return HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } });
      return HttpResponse.json({ enrollments: [] });
    }),
  );
  return asked;
}

/** The app asks for its settings as it starts (App.tsx reads them for the
 * nav), and draws the first page a commit later (useFirstPageTransition). */
function AppLike({ children }: { children: ReactNode }) {
  useGameConfig();
  const [booted, setBooted] = useState(false);
  useEffect(() => setBooted(true), []);
  return booted ? children : null;
}

async function renderSection(client: QueryClient, section = 'web-developer') {
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/learn/${section}`]}>
        <LanguageProvider><AppLike><Routes><Route path="/learn/:section?" element={<Roadmap />} /></Routes></AppLike></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('button', { name: /^Level 1: Level 1 title/ });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

describe('the FDE path reads on a Learn section', () => {
  it('asks for no catalogue and no enrollments while the settings say the path is closed', async () => {
    const asked = answer();
    const client = newClient();
    client.setQueryData(GAME_CONFIG_KEY, withPath(false));
    await renderSection(client);
    expect(asked).not.toContain('learning-path-catalog');
    expect(asked).not.toContain('learning-path-enrollment');
    expect(asked).toContain('progress');
  });

  it('waits for the settings the app is reading rather than asking the catalogue meanwhile', async () => {
    const asked = answer(80);
    await renderSection(newClient());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(asked).toContain('settings');
    expect(asked).not.toContain('learning-path-catalog');
    expect(asked).not.toContain('learning-path-enrollment');
  });

  it('reads the catalogue and the enrollments for the figure while the path is open', async () => {
    const asked = answer(0, true);
    const client = newClient();
    client.setQueryData(GAME_CONFIG_KEY, withPath(true));
    await renderSection(client);
    expect(asked).toContain('learning-path-catalog');
    expect(asked).toContain('learning-path-enrollment');
  });

  it('lets the catalogue decide, as before, when the settings read failed', async () => {
    const asked = answer();
    server.use(http.get('*/api/settings', () => {
      asked.push('settings');
      return HttpResponse.json({ error: { code: 'unavailable', message: 'Unavailable' } }, { status: 503 });
    }));
    await renderSection(newClient());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 120)); });
    expect(asked).toContain('settings');
    expect(asked).toContain('learning-path-catalog');
    expect(asked).toContain('learning-path-enrollment');
  });

  it('still reads the catalogue on the FDE section, whose path shelf shows it', async () => {
    const asked = answer();
    const client = newClient();
    client.setQueryData(GAME_CONFIG_KEY, withPath(false));
    await renderSection(client, 'forward-deployed-engineer').catch(() => undefined);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(asked).toContain('learning-path-catalog');
  });
});
