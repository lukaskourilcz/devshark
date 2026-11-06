// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// While the settings the app read as it started say no learning path is open,
// Today reads neither the 30 KB path catalogue nor the account's enrollments
// for its path rows (#587 paths walk): a closed path offers no row, so the
// reads answered nothing Today could show. The Learn map and Career already
// skip them (C06, C20). With a path open, both are read as before.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Today from '../src/components/Today';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'user-today-paths', user_metadata: {} }, isAuthenticated: true, isLoading: false, signInWithGoogle: async () => {} }),
}));
beforeAll(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });

const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1, questionCount: 8 });
const STRUCTURE = { topics: ['javascript'], structure: { javascript: { levels: Array.from({ length: 6 }, (_, i) => level(i + 1)), checkpoints: [] } } };
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };

function answer() {
  const asked: string[] = [];
  server.use(
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
      if (op === 'learning-path-enrollment') return HttpResponse.json({ enrollments: [] });
      return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    }),
    http.all('*/api/*', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
  );
  return asked;
}

async function mountToday(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The settings App.tsx read as the app started.
  client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, learningPaths: { paths: { fde: { enabled } } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/today']}>
        <LanguageProvider><Today /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('heading', { level: 1 });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
}

describe('Today’s path rows', () => {
  it('read no catalogue and no enrollments while the settings say no path is open', async () => {
    const asked = answer();
    await mountToday(false);
    expect(asked).toContain('entitlement');
    expect(asked).not.toContain('learning-path-catalog');
    expect(asked).not.toContain('learning-path-enrollment');
  });

  it('read both while a path is open', async () => {
    const asked = answer();
    await mountToday(true);
    expect(asked).toContain('learning-path-catalog');
    expect(asked).toContain('learning-path-enrollment');
  });
});
