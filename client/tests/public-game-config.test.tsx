// A trimmed public wire response keeps compatibility defaults; /dev still
// edits the complete private settings through its own authenticated endpoint.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { DEFAULT_CONFIG, useGameConfig } from '../src/lib/gameConfig';
import DevSettings from '../src/components/dev/DevSettings';
import { DEFAULT_MERCH_SETTINGS } from '../../shared/rewards';
import { server } from './mocks/server';

const publicConfig = { ...DEFAULT_CONFIG, quiz: { ...DEFAULT_CONFIG.quiz, maxCount: 31 },
  features: { ...DEFAULT_CONFIG.features, multiplayer: false },
  billing: { ...DEFAULT_CONFIG.billing, enabled: true, launchOffer: true } };
const { shop: _legacyShop, devTips: _tips, ...trimmed } = publicConfig;

function ConfigProbe() {
  const config = useGameConfig();
  return <output aria-label="Resolved public configuration">{JSON.stringify({
    maxCount: config.quiz.maxCount, multiplayer: config.features.multiplayer,
    billing: config.billing, shop: config.shop, devTips: config.devTips,
  })}</output>;
}
function renderWithConfig(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/dev?section=settings']}>
    <LanguageProvider>{children}</LanguageProvider>
  </MemoryRouter></QueryClientProvider>);
}

describe('public game configuration projection', () => {
  it('accepts omitted legacy sections while preserving defaults and active server settings', async () => {
    server.use(http.get('*/api/settings', () => HttpResponse.json(trimmed)));
    renderWithConfig(<ConfigProbe />);
    await waitFor(() => {
      const result = JSON.parse(screen.getByLabelText('Resolved public configuration').textContent!);
      expect(result.maxCount).toBe(31); expect(result.multiplayer).toBe(false);
      expect(result.billing.enabled).toBe(true); expect(result.billing.launchOffer).toBe(true);
      expect(result.shop).toEqual(DEFAULT_CONFIG.shop); expect(result.devTips).toEqual(DEFAULT_CONFIG.devTips);
    });
  });

  it('keeps private admin tips and prices through a save while public sections are absent', async () => {
    const stored = { ...DEFAULT_CONFIG, quiz: { ...DEFAULT_CONFIG.quiz, minImportance: 1 },
      play: { ...DEFAULT_CONFIG.play, minQuestions: 3, maxQuestions: 20, maxSpeedBonus: 50 },
      shop: { prices: { 'ring-emerald': 777 }, pathUnlockPrice: 333 },
      devTips: ['The authenticated editor retains this tip.'], ownerEmail: 'owner@example.invalid',
      merch: { ...DEFAULT_MERCH_SETTINGS, pricing: {} } };
    let posted: { settings: Record<string, unknown> } | undefined;
    server.use(
      http.get('*/api/settings', () => HttpResponse.json(trimmed)),
      http.get('*/api/admin/settings', () => HttpResponse.json({ settings: stored })),
      http.post('*/api/admin/settings', async ({ request }) => {
        posted = await request.json() as { settings: Record<string, unknown> };
        return HttpResponse.json({ settings: posted.settings });
      }),
    );
    renderWithConfig(<><ConfigProbe /><DevSettings /></>);
    const tips = await screen.findByRole('textbox', { name: /Dev tips/ });
    expect(tips).toHaveValue(stored.devTips[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Save settings' }));
    await screen.findByText('Settings saved');
    expect(posted?.settings.devTips).toEqual(stored.devTips);
    expect(posted?.settings.shop).toEqual(stored.shop);
    expect(posted?.settings.coins).toEqual(stored.coins);
    expect(posted?.settings.merch).toEqual(stored.merch);
    expect(posted?.settings.daily).toEqual(stored.daily);
  });
});
