// A signed-in deep link to a topic the account's progress opens
// (?topic=dsa-advanced) lands there even when that progress answers after
// the map's first draw. The map's public reads no longer wait for
// supabase-js and the session, and it draws without React's reveal throttle
// (perf baseline #587 C04, C10), so the account's record can arrive after
// the draw; before, it was in by then. A learner who picks a topic first
// keeps their choice.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { server } from './mocks/server';

vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ user: { id: 'user-late', user_metadata: {} }, isAuthenticated: true, isLoading: false, signInWithGoogle: async () => {} }),
}));

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 720, bottom: 600, width: 720, height: 600, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const TOPICS = ['javascript', 'dsa', 'dsa-advanced', 'git', 'general'];
const STRUCTURE = { topics: TOPICS, structure: Object.fromEntries(TOPICS.map((topic) => [topic, { levels: Array.from({ length: 6 }, (_, i) => level(i + 1)), checkpoints: [] }])) };
const PREMIUM = { tier: 'premium', source: 'stripe', currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const passed = { levels: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { passed: true, bestPct: 100 }])), checkpoints: {} };

/** Hold account progress until the test has observed the initial map. */
function answer() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  server.use(
    http.get('*/api/quiz/roadmap', async ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      if (resource === 'progress') {
        await ready;
        return HttpResponse.json({ data: { javascript: passed, dsa: passed }, extra: { unlocked: [] } });
      }
      return HttpResponse.json(STRUCTURE as never);
    }),
    http.get('*/api/user/*', ({ request }) => {
      const url = new URL(request.url);
      const op = url.searchParams.get('op') ?? url.pathname.split('/').pop()!;
      if (op === 'entitlement') return HttpResponse.json(PREMIUM);
      if (op === 'xp') return HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } });
      return HttpResponse.json({ enrollments: [] });
    }),
  );
  return release;
}

let visits = 0;
async function mount(path: string) {
  window.history.replaceState(null, '', path);
  // This device holds JavaScript, so DSA Foundations, Git and General are
  // open on the first draw; the account's DSA passes open DSA Advanced.
  localStorage.setItem('devquiz:roadmap:v2', JSON.stringify({ javascript: passed }));
  const [{ default: Roadmap }, { LanguageProvider }, { DEFAULT_CONFIG, GAME_CONFIG_KEY }] = await Promise.all([
    import('../src/components/Roadmap'), import('../src/i18n/LanguageContext'), import('../src/lib/gameConfig'),
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  client.setQueryData(GAME_CONFIG_KEY, { ...DEFAULT_CONFIG, learningPaths: { paths: { fde: { enabled: false } } } });
  const url = new URL(path, 'http://localhost');
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: url.pathname, search: url.search, key: `late-${++visits}` }]}>
        <LanguageProvider><Routes><Route path="/learn/:section?" element={<Roadmap />} /></Routes></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
}

const topics = () => within(screen.getByRole('radiogroup', { name: 'Choose a topic' })).getAllByRole('radio');
const topicRadio = (name: RegExp) => topics().find((radio) => name.test(radio.textContent ?? ''));
const checkedTopic = () => topics().find((radio) => radio.getAttribute('aria-checked') === 'true');

it('lands on the deep link’s topic once the account’s progress opens it', async () => {
  const releaseProgress = answer();
  await mount('/learn/software-engineer?topic=dsa-advanced');
  // The first draw, before the progress: the deep link's topic is not open.
  await screen.findByRole('radiogroup', { name: 'Choose a topic' }, { timeout: 3000 });
  expect(checkedTopic()?.textContent).toMatch(/^DSA Foundations/);
  releaseProgress();
  await waitFor(() => expect(checkedTopic()?.textContent).toMatch(/DSA Advanced/), { timeout: 4000 });
});

it('keeps a topic the learner picked before the progress answered', async () => {
  const releaseProgress = answer();
  await mount('/learn/software-engineer?topic=dsa-advanced');
  await screen.findByRole('radiogroup', { name: 'Choose a topic' }, { timeout: 3000 });
  const general = topicRadio(/^General/);
  expect(general).toBeTruthy();
  fireEvent.click(general!);
  await waitFor(() => expect(checkedTopic()?.textContent).toMatch(/^General/));
  // The progress lands and opens DSA Advanced; the learner's choice stands.
  releaseProgress();
  await waitFor(() => expect(topicRadio(/^DSA Advanced/)).not.toHaveAttribute('aria-disabled', 'true'));
  expect(checkedTopic()?.textContent).toMatch(/^General/);
});
