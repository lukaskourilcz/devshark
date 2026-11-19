import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '../src/App';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { getTrack, setTrackValue } from '../src/lib/tracks';
import { http, HttpResponse } from 'msw';
import settings from '../../tests/fixtures/api-settings.json';
import { server } from './mocks/server';

const account = vi.hoisted(() => ({ user: { id: 'account-a', user_metadata: { devquiz_track: 'frontend' } } }));
vi.mock('../src/lib/auth', async (original) => ({
  ...await original<typeof import('../src/lib/auth')>(),
  useAuth: () => ({ user: account.user, isLoading: false }),
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
vi.mock('../src/lib/roadmap', async (original) => ({
  ...await original<typeof import('../src/lib/roadmap')>(),
  syncProgressWithServer: async () => {},
}));
vi.mock('../src/components/Home', () => ({ default: () => <h1>Home</h1> }));
vi.mock('../src/components/AuthButton', () => ({ default: () => null }));
vi.mock('../src/components/ReferralBinder', () => ({ default: () => null }));
vi.mock('../src/components/PendingQuizResults', () => ({ default: () => null }));
vi.mock('../src/components/RegisterPromptSnackbar', () => ({ default: () => null }));
vi.mock('../src/components/UpgradeSheetHost', () => ({ default: () => null }));
vi.mock('../src/components/auth/SignInDialogHost', () => ({ default: () => null }));

beforeEach(() => server.use(http.get('*/api/settings', () => HttpResponse.json(settings))));

afterEach(() => {
  account.user = { id: 'account-a', user_metadata: { devquiz_track: 'frontend' } };
  setTrackValue('fullstack');
});

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Frame() {
    return <QueryClientProvider client={client}><MemoryRouter><LanguageProvider><App /></LanguageProvider></MemoryRouter></QueryClientProvider>;
  }
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<Frame />); });
  return async () => { await act(async () => { view.rerender(<Frame />); }); };
}

describe('the App account-track synchronization', () => {
  it('keeps a newer local choice when the same account metadata is refreshed', async () => {
    const refresh = await mount();
    expect(getTrack()).toBe('frontend');
    await act(async () => setTrackValue('backend'));
    account.user = { ...account.user, user_metadata: { ...account.user.user_metadata } };
    await refresh();
    expect(getTrack()).toBe('backend');
  });

  it('still follows a real remote preference change', async () => {
    const refresh = await mount();
    account.user = { ...account.user, user_metadata: { devquiz_track: 'fullstack' } };
    await refresh();
    expect(getTrack()).toBe('fullstack');
  });

  it('applies the saved preference for a different account with the same track', async () => {
    const refresh = await mount();
    await act(async () => setTrackValue('backend'));
    account.user = { id: 'account-b', user_metadata: { devquiz_track: 'frontend' } };
    await refresh();
    expect(getTrack()).toBe('frontend');
  });
});
