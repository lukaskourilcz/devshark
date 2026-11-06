// Exercise the retained FDE implementation as a future opt-in. Shipping
// defaults and the owner hold are covered in fde-visibility.test.tsx and
// the browser's fde-positioning.spec.ts.
vi.mock('../../shared/learn-section-ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/learn-section-ids')>();
  return { ...original, FDE_SECTION_VISIBLE: true,
    isLearnSectionVisible: original.isLearnSectionId,
    VISIBLE_LEARN_SECTION_IDS: original.LEARN_SECTION_IDS };
});

// The Career page draws once its structure is in (perf baseline #587 C25):
// the FDE group's figure fills in its own line when the path catalogue and
// the enrollments land, and while the settings say the path is closed
// neither is read (C06, C20).
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import CareerRoadmap from '../src/components/CareerRoadmap';
import { DEFAULT_CONFIG, GAME_CONFIG_KEY } from '../src/lib/gameConfig';
import { server } from './mocks/server';
import { firstDraw } from './firstDraw';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'user-career' }, isAuthenticated: true, isLoading: false }),
}));
beforeAll(() => import('../src/components/RoadmapTree'));

const STRUCTURE = { topics: ['javascript'], structure: { javascript: { levels: [{ level: 1, title: 'One', difficulty: 1, questionCount: 8 }], checkpoints: [] } } };
const MANIFEST = {
  id: 'fde', version: 1, kind: 'role-specialization', title: 'Forward Deployed Engineer', summary: 'Customer-facing engineering.',
  entryRequirement: 'You ship code in one track.', estimatedHours: { min: 20, max: 30 },
  modules: [{ id: 'fde-v1-entry', title: 'Entry', activities: [{ id: 'fde-v1-entry-check', title: 'Where you start' }] }],
};
const CATALOG = { versions: { fde: 1 }, paths: [{ manifest: MANIFEST, availability: 'available', inventory: { modules: 1, lessons: 0, moduleChecks: 1, moduleCodeExercises: 0, finalCodeExercises: 0 } }] };
const withPath = (enabled: boolean) => ({ ...DEFAULT_CONFIG, learningPaths: { paths: { fde: { enabled } } } });

function answer(catalogDelay: number) {
  const asked: string[] = [];
  const answered: string[] = [];
  server.use(
    http.get('*/api/quiz/roadmap', async ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource') ?? 'structure';
      asked.push(resource);
      if (resource === 'learning-path-catalog') {
        await delay(catalogDelay);
        answered.push(resource);
        return HttpResponse.json(CATALOG);
      }
      if (resource === 'progress') return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
      return HttpResponse.json(STRUCTURE);
    }),
    http.get('*/api/user/*', ({ request }) => {
      const op = new URL(request.url).searchParams.get('op') ?? '';
      asked.push(op);
      if (op === 'entitlement') return HttpResponse.json({ tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null });
      if (op === 'learning-path-enrollment') return HttpResponse.json({ enrollments: [] });
      return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    }),
  );
  return { asked, answered };
}

let visits = 0;
async function mount(pathOpen: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(GAME_CONFIG_KEY, withPath(pathOpen));
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/roadmap', key: `career-${++visits}` }]}>
        <LanguageProvider><CareerRoadmap /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('heading', { level: 1 });
}

describe('/roadmap', () => {
  it('draws before a slow path catalogue answers, the FDE figure saying it is loading', async () => {
    const { asked, answered } = answer(600);
    const drawn = firstDraw('h1', () => ({ catalogIn: answered.length > 0, fde: document.querySelector('section[aria-labelledby="career-forward-deployed-engineer"]')?.textContent ?? '' }));
    await mount(true);
    const first = drawn();
    expect(first?.catalogIn).toBe(false);
    expect(first?.fde).toContain('Loading…');
    // The reads for the figure left beside the structure, and fill it in.
    expect(asked).toContain('learning-path-catalog');
    await waitFor(() => expect(answered).toContain('learning-path-catalog'), { timeout: 3000 });
    await waitFor(() => expect(document.querySelector('section[aria-labelledby="career-forward-deployed-engineer"]')?.textContent).not.toContain('Loading…'));
  });

  it('reads no path catalogue and no enrollments while the settings say the path is closed', async () => {
    const { asked } = answer(0);
    await mount(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(asked).toContain('structure');
    expect(asked).not.toContain('learning-path-catalog');
    expect(asked).not.toContain('learning-path-enrollment');
  });
});
