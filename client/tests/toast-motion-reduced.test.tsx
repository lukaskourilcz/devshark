import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { AppToast } from '../src/components/ui/AppToast';
import XpToaster from '../src/components/XpToaster';
import { announceVerifiedQuestXp } from '../src/lib/xp';

const animation = vi.hoisted(() => ({ calls: 0 }));
vi.mock('motion', () => {
  animation.calls += 1;
  throw new Error('A reduced-motion toast must not load animation code');
});

let preference: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  const template = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ ...template, media: query, matches: query === '(prefers-reduced-motion: reduce)' }));
});
afterEach(() => {
  preference.mockRestore();
  vi.useRealTimers();
});

it('removes an AppToast immediately under reduced motion without loading animation code', () => {
  const toast = (open: boolean) => <LanguageProvider><AppToast open={open} onClose={() => {}} message="Saved." autoHideDuration={null} /></LanguageProvider>;
  const view = render(toast(true));
  expect(screen.getByText('Saved.')).toBeVisible();
  view.rerender(toast(false));
  expect(screen.queryByText('Saved.')).toBeNull();
  expect(animation.calls).toBe(0);
});

it('advances the XP queue immediately at the reading duration under reduced motion', async () => {
  vi.useFakeTimers();
  render(<LanguageProvider><XpToaster /></LanguageProvider>);
  act(() => {
    announceVerifiedQuestXp(25);
    announceVerifiedQuestXp(50);
  });
  expect(screen.getByText('+25 XP earned')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(2199); });
  expect(screen.queryByText('+50 XP earned')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByText('+25 XP earned')).toBeNull();
  expect(screen.getByText('+50 XP earned')).toBeVisible();
  expect(animation.calls).toBe(0);
});
