import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import App from '../src/App';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import settings from '../../tests/fixtures/api-settings.json';
import { server } from './mocks/server';

const viewport = vi.hoisted(() => ({ wide: false }));
const drawer = vi.hoisted(() => ({
  mode: 'held' as 'held' | 'failed',
  attempts: 0,
  waiting: new Promise<void>(() => {}),
}));
vi.mock('../src/lib/useMediaQuery', async (original) => ({
  ...await original<typeof import('../src/lib/useMediaQuery')>(),
  useMediaQuery: (query: string) => query === '(min-width: 1024px)' && viewport.wide,
}));
vi.mock('../src/lib/auth', async (original) => ({
  ...await original<typeof import('../src/lib/auth')>(),
  useAuth: () => ({ user: null, isLoading: false }),
}));
vi.mock('../src/lib/gameConfig', async (original) => {
  const module = await original<typeof import('../src/lib/gameConfig')>();
  return { ...module, useGameConfig: () => module.DEFAULT_CONFIG };
});
vi.mock('../src/lib/entitlement', async (original) => ({
  ...await original<typeof import('../src/lib/entitlement')>(),
  useEntitlement: () => ({ tier: 'free' }),
}));
vi.mock('../src/lib/rewards', async (original) => ({
  ...await original<typeof import('../src/lib/rewards')>(),
  useWallet: () => ({ data: undefined }),
}));
vi.mock('../src/lib/sentry', () => ({ reportError: vi.fn(), initSentry: vi.fn() }));
vi.mock('../src/components/Home', () => ({ default: () => <h1>Home</h1> }));
vi.mock('../src/components/ReferralBinder', () => ({ default: () => null }));
vi.mock('../src/components/PendingQuizResults', () => ({ default: () => null }));
vi.mock('../src/components/RegisterPromptSnackbar', () => ({ default: () => null }));
vi.mock('../src/components/UpgradeSheetHost', () => ({ default: () => null }));
vi.mock('../src/components/auth/SignInDialogHost', () => ({ default: () => null }));
vi.mock('../src/components/MobileNavigation', () => ({
  default: () => {
    drawer.attempts += 1;
    if (drawer.mode === 'failed') throw new TypeError('Failed to fetch dynamically imported module: http://localhost/assets/MobileNavigation-test.js');
    throw drawer.waiting;
  },
}));

beforeEach(() => {
  viewport.wide = false;
  drawer.attempts = 0;
  server.use(http.get('*/api/settings', () => HttpResponse.json(settings)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

it.each(['held', 'failed'] as const)('does not remount a %s drawer after crossing wide and returning narrow without a new press', async (mode) => {
  drawer.mode = mode;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Frame() {
    return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider><App /></LanguageProvider></MemoryRouter></QueryClientProvider>;
  }
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Frame />); });
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
  await screen.findByRole('dialog', { name: 'Navigation' });
  await vi.waitFor(() => expect(drawer.attempts).toBeGreaterThan(0));

  viewport.wide = true;
  await act(async () => view.rerender(<Frame />));
  expect.soft(document.querySelector('.ss-drawer-panel')).toBeNull();
  const attempts = drawer.attempts;
  viewport.wide = false;
  await act(async () => view.rerender(<Frame />));
  expect(document.querySelector('.ss-drawer-panel')).toBeNull();
  expect(drawer.attempts, 'returning narrow must wait for a new menu press, even for an already cached renderer').toBe(attempts);
});
