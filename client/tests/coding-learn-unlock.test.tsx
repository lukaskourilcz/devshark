// Ten cleared JavaScript Learn levels open tier 3 (Combine) of JavaScript
// only (owner decision 7, 9 October 2026). The track page asks the shared
// rule (`tierUnlocked`, `tierLockReason` in shared/coding-catalog.ts) that
// the task page, practice runs and skip suggestions ask on the server, so a
// TypeScript or React learner with the levels cleared still sees tier 3
// locked, with the reason that names the track's own sweep.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { preloadPath } from '../src/lib/routePreload';
import { CodingTrackScreen } from '../src/components/coding/CodingSection';

vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, signInWithGoogle: vi.fn() }) }));
vi.mock('../src/lib/entitlement', () => ({ useEntitlement: () => ({ tier: 'premium', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }) }));
vi.mock('../src/coding/practice', () => ({
  useBookmarks: () => ({ data: { saved: [] }, isPending: false, isError: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePracticeSession: () => ({ data: { session: null } }),
  useAdvanceSession: () => ({ mutate: vi.fn() }),
}));
vi.mock('../src/coding/api', () => ({
  codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
  saveCodingDraft: vi.fn(),
  // The ten JavaScript Learn levels cleared, and no challenge passed yet.
  useCodingProgress: () => ({ data: { tasks: {}, due: [], javascriptLevelsCleared: 10, passedByTrack: {} }, isLoading: false, isError: false }),
  useCodingTask: () => ({ data: undefined }),
}));
vi.mock('../src/coding/CodingWorkbench', () => ({ CodingWorkbench: () => null }));

beforeAll(() => preloadPath('/coding/javascript'));

function combineTier(track: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[`/coding/${track}?tier=3`]}>
        <LanguageProvider>
          <Routes><Route path="/coding/:track" element={<CodingTrackScreen />} /></Routes>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('region', { name: 'Coding challenges' });
}

const SWEEP = 'Opens after every task of the first two tiers in this track.';
const FOUNDATIONS = 'Opens after Learn JavaScript levels 1–10, or after every task of the first two tiers in this track.';

describe('the Learn unlock of tier 3', () => {
  it('opens JavaScript tier 3', () => {
    const tier = combineTier('javascript');
    expect(within(tier).queryByText(SWEEP)).toBeNull();
    expect(within(tier).queryByText(FOUNDATIONS)).toBeNull();
  });

  for (const track of ['typescript', 'react']) {
    it(`leaves ${track} tier 3 locked behind its own sweep`, () => {
      const tier = combineTier(track);
      expect(within(tier).getAllByText(SWEEP)[0]).toBeInTheDocument();
      expect(within(tier).queryByText(FOUNDATIONS)).toBeNull();
    });
  }
});
