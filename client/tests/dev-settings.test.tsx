// /dev → Settings without the retired voluntary-support fields: the form loads,
// shows none of them, and a save sends every section back without a `support`
// block, even when the stored settings still carried one.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import DevSettings from '../src/components/dev/DevSettings';
import { queryClient as appQueryClient } from '../src/lib/queryClient';
import { DEFAULT_COIN_SETTINGS, DEFAULT_MERCH_SETTINGS } from '../../shared/rewards';
import { server } from './mocks/server';

const SETTINGS = {
  quiz: { defaultCount: 10, countOptions: [10, 20, 30], maxCount: 50, defaultDifficulty: 'zero-to-hero', minImportance: 1, defaultCategoryIds: ['javascript'] },
  daily: { count: 5 },
  play: { defaultDurationS: 60, durationOptionsS: [30, 60, 0], countOptions: [5, 10], minQuestions: 3, maxQuestions: 20, maxSpeedBonus: 50 },
  features: { dailyChallenge: true, multiplayer: true, leaderboard: true, flashcards: true },
  leveling: { rankThresholds: [0, 2000, 6000, 14000, 26000, 44000, 68000, 100000, 144000, 200000] },
  shop: { prices: { 'double-xp': 75, 'flair-crown': 500 }, pathUnlockPrice: 200 },
  devTips: ['Remember to code.'],
  ownerEmail: 'owner@example.invalid',
  merch: { ...DEFAULT_MERCH_SETTINGS, pricing: {} },
  coins: DEFAULT_COIN_SETTINGS,
};

// What a row saved before 2026-09-26 still holds beside the live sections.
const LEGACY_SUPPORT = {
  enabled: true, kofiUrl: 'https://ko-fi.com/devshark', githubSponsorsUrl: 'https://github.com/sponsors/devshark',
  monthlyTarget: 40, amountCovered: 12, lastUpdatedAt: '2026-09-01', costBreakdown: [{ label: 'Hosting', amount: 20 }],
  publicThanksEnabled: true,
};

function renderSettings(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dev?section=settings']}>
        <LanguageProvider><DevSettings /></LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('/dev → Settings', () => {
  for (const [name, stored] of [['current settings', SETTINGS], ['settings that still carry the support block', { ...SETTINGS, support: LEGACY_SUPPORT }]] as const) {
    it(`loads ${name} without support fields and saves without a support block`, async () => {
      let posted: { settings: Record<string, unknown> } | null = null;
      server.use(
        http.get('*/api/admin/settings', () => HttpResponse.json({ settings: stored })),
        http.post('*/api/admin/settings', async ({ request }) => {
          posted = (await request.json()) as { settings: Record<string, unknown> };
          return HttpResponse.json({ settings: posted.settings });
        }),
      );
      renderSettings();
      const save = await screen.findByRole('button', { name: 'Save settings' });
      for (const label of [/Voluntary support/i, /support links/i, /thank-you/i, /Ko-fi/i, /GitHub Sponsors/i, /Monthly target/i, /amount covered/i, /Cost breakdown/i]) {
        expect(screen.queryByText(label)).toBeNull();
      }
      expect(screen.getByRole('heading', { name: 'Coins' })).toBeInTheDocument();

      fireEvent.click(save);
      await screen.findByText('Settings saved');
      await waitFor(() => expect(posted).not.toBeNull());
      const sent = posted!.settings;
      expect('support' in sent).toBe(false);
      expect(Object.keys(sent).sort()).toEqual(['coins', 'daily', 'devTips', 'features', 'leveling', 'merch', 'ownerEmail', 'play', 'quiz', 'shop']);
      expect(sent.merch).toEqual(SETTINGS.merch);
      expect(sent.coins).toEqual(SETTINGS.coins);
    });
  }

  it('keeps edits made while an earlier settings save is still in flight', async () => {
    let complete!: () => void;
    server.use(
      http.get('*/api/admin/settings', () => HttpResponse.json({ settings: SETTINGS })),
      http.post('*/api/admin/settings', async ({ request }) => {
        const body = await request.json();
        return new Promise<Response>((resolve) => { complete = () => resolve(HttpResponse.json(body)); });
      }),
    );
    appQueryClient.clear();
    renderSettings(appQueryClient);
    const tips = await screen.findByRole('textbox', { name: /Dev tips/ });
    fireEvent.change(tips, { target: { value: 'First edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(complete).toBeDefined());
    fireEvent.change(tips, { target: { value: 'Second edit, still unsaved' } });
    await act(async () => { complete(); });
    await screen.findByText('Settings saved');
    expect(screen.getByRole('textbox', { name: /Dev tips/ })).toHaveValue('Second edit, still unsaved');
  });

  it('keeps unsaved edits when the settings are read again', async () => {
    server.use(http.get('*/api/admin/settings', () => HttpResponse.json({ settings: SETTINGS })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderSettings(client);
    const tips = await screen.findByRole('textbox', { name: /Dev tips/ });
    fireEvent.change(tips, { target: { value: 'Remember to code.\nRead the docs.' } });
    // Another write lands (a reconnect re-read, the Merchandise tab saving).
    await act(async () => {
      client.setQueryData(['admin', 'settings'], { settings: { ...SETTINGS, ownerEmail: 'new@example.invalid' } });
      // React Query tells its observers on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByRole('textbox', { name: /Dev tips/ })).toHaveValue('Remember to code.\nRead the docs.');
  });
});
