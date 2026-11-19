import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { AppToast } from '../src/components/ui/AppToast';
import XpToaster from '../src/components/XpToaster';
import { announceVerifiedQuestXp } from '../src/lib/xp';

const loader = vi.hoisted(() => ({ calls: 0 }));
vi.mock('motion', () => {
  loader.calls += 1;
  throw new Error('Fixture: animation chunk unavailable');
});

it('keeps both toast hosts usable and drains XP after an animation chunk fails', async () => {
  vi.useFakeTimers();
  try {
    const close = vi.fn();
    render(<LanguageProvider><AppToast open onClose={close} message="Still saved." autoHideDuration={1000} /><XpToaster /></LanguageProvider>);
    act(() => {
      announceVerifiedQuestXp(25);
      announceVerifiedQuestXp(50);
    });
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(loader.calls, 'the fixture rejected the animation import').toBe(1);
    expect(screen.getByText('Still saved.')).toBeVisible();
    expect(screen.getByText('+25 XP earned')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(close).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('+50 XP earned')).toBeVisible();
    expect(screen.queryByText('+25 XP earned')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
