// The Profile's layout after the UX audit of 23 October 2026 (U6, #578):
// the identity banner carries no appearance or sound switches (the footer
// has them on every route) and puts the plan on one row.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Profile from '../src/components/Profile';
import { server } from './mocks/server';
import { emailUser } from './mocks/gotrue';
import { settingsHandler, visibilityHandler } from './mocks/handlers';

const USER = emailUser({ email: 'ada.lovelace@example.com' });
const auth = vi.hoisted(() => ({ value: { user: null as unknown, isAuthenticated: false, isLoading: false } }));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  useAuth: () => ({ ...auth.value, signOut: async () => undefined, signInResumeFailed: false, passwordRecovery: false }),
}));
afterEach(() => { auth.value = { user: null, isAuthenticated: false, isLoading: false }; });

const STATS = {
  id: 'stats-1', user_id: USER.id, email: USER.email, name: null, picture: null,
  total_quizzes: 3, total_correct: 21, total_questions: 30, current_streak: 2, longest_streak: 4,
  last_quiz_date: '2026-09-30', created_at: '2026-09-28T10:00:00Z', updated_at: '2026-09-30T10:00:00Z',
};
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const NOT_CONNECTED = { available: true, status: 'not_connected', accountLogin: null, repoFullName: null, defaultBranch: null, lastCommitAt: null, queued: 0, lastError: null };

function serveAccount() {
  server.use(
    settingsHandler,
    http.get('*/api/user/leaderboard-name', () => HttpResponse.json({ mode: 'nickname', nickname: 'elTiburonLoco1', accountName: 'ada.lovelace', showPhoto: false, photo: null })),
    visibilityHandler(false),
    http.get('*/api/user/stats', () => HttpResponse.json({ data: STATS })),
    http.get('*/api/user/xp', () => HttpResponse.json({ data: { quest_xp: 0, by_subject: {} } })),
    http.get('*/api/user/freezes', () => HttpResponse.json({
      remaining: 2, period: '2026-10', used: [], shieldUntil: null, shieldDays: [], shieldSupported: true,
    })),
    http.get('*/api/user/advisor', () => HttpResponse.json({ weakAreas: [], suggestedWeek: [], generatedAt: '2026-10-01T09:00:00Z' })),
    http.get('*/api/user/friends-handle', () => HttpResponse.json({ handle: 'el-tiburon-loco', discoverable: true, country: null, canChangeAt: null })),
    http.get('*/api/user/identity', () => HttpResponse.json({ showRealName: false, showPhoto: false, realName: null, photo: null })),
    http.get('*/api/user/friends-list', () => HttpResponse.json({ friends: [], requests: [] })),
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'progress') return HttpResponse.json({ data: {}, extra: { unlocked: [] } });
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      return undefined;
    }),
    http.get('*/api/user/*', ({ request }) => {
      const op = new URL(request.url).searchParams.get('op');
      if (op === 'entitlement') return HttpResponse.json(FREE);
      if (op === 'github-connection') return HttpResponse.json(NOT_CONNECTED);
      if (op === 'learning-path-enrollment') return HttpResponse.json({ enrollments: [] });
      return undefined;
    }),
  );
}

let visits = 0;
async function mountProfile() {
  serveAccount();
  auth.value = { user: USER, isAuthenticated: true, isLoading: false };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: '/profile', key: `visit-${++visits}` }]}>
        <LanguageProvider><Profile /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('heading', { level: 1 });
  return view;
}

describe('the Profile identity banner (social-account-08)', () => {
  it('leaves appearance and sound to the footer', async () => {
    const { container } = await mountProfile();
    const banner = container.querySelector('.de-profile-identity') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(within(banner).queryByRole('button', { name: /dark mode|light mode/i })).toBeNull();
    expect(within(banner).queryByRole('button', { name: /sound/i })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Preferences' })).toBeNull();
  });

  it('puts the plan and its action on one row', async () => {
    const { container } = await mountProfile();
    const line = await within(container.querySelector('.de-profile-identity') as HTMLElement).findByRole('group', { name: 'Plan' });
    const action = await within(line).findByRole('button', { name: 'See what Premium includes' });
    expect(action.closest('.de-plan-line__actions')).not.toBeNull();
    expect(line.querySelector('.de-plan-line__body')).toHaveTextContent(/^Free/);
    // The label, the summary and the action share one grid row on the Profile.
    const css = readFileSync(new URL('../src/components/DeepEndScreens.css', import.meta.url), 'utf8');
    expect(css).toContain('.de-profile-identity .de-plan-line{grid-template-columns:auto minmax(0,1fr) auto');
    expect(css).toContain('.de-profile-identity .de-plan-line__actions{grid-column:3');
  });
});

describe('the Profile columns (social-account-03)', () => {
  it('keeps Account directly after Track in a natural-height settings column', async () => {
    const { container } = await mountProfile();
    const learning = container.querySelector('[data-column="learning"]') as HTMLElement;
    const account = container.querySelector('[data-column="account"]') as HTMLElement;
    expect(learning.parentElement).toBe(account.parentElement);
    expect(await within(learning).findByRole('heading', { name: 'Account' })).toBeInTheDocument();
    const settings = [...learning.querySelectorAll('h2.ss-kicker')].map(h => h.textContent);
    expect(settings).toEqual(['Track and sections', 'Account', 'Study advisor']);
    expect(await within(account).findByRole('heading', { name: 'Career level' })).toBeInTheDocument();
    expect(await within(account).findByRole('heading', { name: 'Your name' })).toBeInTheDocument();
    expect(await within(account).findByRole('heading', { name: 'GitHub garden' })).toBeInTheDocument();
    expect(within(account).queryByRole('heading', { name: 'Account' })).toBeNull();
  });
});

describe('the Profile card stock (social-account-17)', () => {
  it('builds every overview card as a plain .ss-panel with 24px padding and a Kicker h2', async () => {
    const { container } = await mountProfile();
    await screen.findByRole('heading', { name: 'GitHub garden' });
    await screen.findByRole('heading', { name: 'Your name' });
    const panel = container.querySelector('#profile-panel-overview') as HTMLElement;
    // No card in the overview wraps an Astryx Card in .ss-raised any more.
    expect(panel.querySelector('.ss-raised')).toBeNull();
    const cards = Array.from(panel.querySelectorAll('.ss-panel')).filter(
      (card) => !card.parentElement!.closest('.ss-panel'),
    ) as HTMLElement[];
    const titles = cards.map((card) => card.querySelector('h2.ss-kicker')?.textContent);
    expect(titles).toEqual(['Streaks', 'Track and sections', 'Account', 'Study advisor', 'Career level', 'Your name', 'GitHub garden']);
    for (const card of cards) {
      // Plain surface: no card overrides the panel's background.
      expect(card.style.background).toBe('');
      expect(card.style.padding === '24px' || card.classList.contains('sn-card')).toBe(true);
    }
  });
});

describe('the Profile on a phone (social-account-18)', () => {
  const css = () => readFileSync(new URL('../src/components/DeepEndScreens.css', import.meta.url), 'utf8');

  it('keeps the XP figure on the career title row', async () => {
    const { container } = await mountProfile();
    const head = container.querySelector('.de-career-head') as HTMLElement;
    expect(within(head).getByRole('heading', { level: 3 })).toBeInTheDocument();
    expect(head.querySelector('.de-career-head__xp')).toHaveTextContent(/XP/);
    expect(css()).toContain('.de-career-head{display:flex;flex-wrap:nowrap;');
    expect(css()).toContain('.de-career-head__xp{display:inline-flex;align-items:baseline;gap:6px;flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}');
  });

  it('keeps the two streak tiles side by side on a phone', () => {
    const profile = readFileSync(new URL('../src/components/Profile.tsx', import.meta.url), 'utf8');
    expect(profile).toMatch(/<Grid columns=\{\{ minWidth: 120, max: 2 \}\} gap=\{2\}>\s*<div role="group" aria-labelledby=\{currentLabelId\}/);
  });

  it('runs the plan name and its summary on as one two-line text', () => {
    expect(css()).toContain('.de-profile-identity .de-plan-line__body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}.de-profile-identity .de-plan-line__body>:nth-child(n){display:inline;white-space:normal}');
  });

  it('stacks a role row status under the role name', () => {
    expect(css()).toContain('.de-role-text{display:flex;flex-direction:column;');
    const card = readFileSync(new URL('../src/components/paths/LearningPathsCard.tsx', import.meta.url), 'utf8');
    expect(card).toMatch(/<span className="de-role-text">\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<span className="lp-activity__title">[\s\S]*?<span className="lp-activity__minutes">/);
  });
});
