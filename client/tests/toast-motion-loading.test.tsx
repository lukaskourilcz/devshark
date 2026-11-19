import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { AppToast } from '../src/components/ui/AppToast';
import XpToaster from '../src/components/XpToaster';
import type { XpToast } from '../src/lib/xp';

const imports = vi.hoisted(() => ({ react: 0, animation: 0 }));
vi.mock('motion/react', async (original) => {
  imports.react += 1;
  return original();
});
// A deliberately delayed animation dependency must never delay a message.
vi.mock('motion', () => {
  imports.animation += 1;
  return new Promise(() => {});
});
const bus = vi.hoisted(() => ({ listener: null as ((toast: XpToast) => void) | null }));
vi.mock('../src/lib/xp', async (original) => ({
  ...await original<object>(),
  onXpToast: (listener: (toast: XpToast) => void) => {
    bus.listener = listener;
    return () => { bus.listener = null; };
  },
}));

afterEach(() => vi.useRealTimers());
const emit = (toast: XpToast) => act(() => bus.listener!(toast));
const gain = (amount: number): XpToast => ({ kind: 'gain', amount, source: 'quiz' });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('toast hosts while animation code is unavailable', () => {
  it('mounts the closed hosts without importing Motion', () => {
    const view = render(<LanguageProvider><AppToast open={false} onClose={() => {}} message="Saved." /><XpToaster /></LanguageProvider>);
    expect(imports.react, 'closed hosts must have no static motion/react edge').toBe(0);
    expect(imports.animation, 'closed hosts must not request the animation adapter').toBe(0);
    expect(bus.listener, 'the XP subscription remains eager').toBeTypeOf('function');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    view.unmount();
    expect(bus.listener).toBeNull();
  });

  it('shows the first AppToast immediately and keeps its dismiss button usable', () => {
    const close = vi.fn();
    render(<LanguageProvider><AppToast open onClose={close} message="Saved." autoHideDuration={null} /></LanguageProvider>);
    expect(screen.getByText('Saved.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('starts AppToast auto-hide after its static message is visible', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    render(<LanguageProvider><AppToast open onClose={close} message="Saved." autoHideDuration={5000} /></LanguageProvider>);
    expect(screen.getByText('Saved.')).toBeVisible();
    await advance(4999);
    expect(close).not.toHaveBeenCalled();
    await advance(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('receives the first XP event immediately and preserves the gain exit gap', async () => {
    vi.useFakeTimers();
    render(<LanguageProvider><XpToaster /></LanguageProvider>);
    emit(gain(25));
    emit(gain(50));
    expect(screen.getByText('+25 XP earned')).toBeVisible();
    await advance(2199);
    expect(screen.getByRole('status')).toHaveTextContent('+25 XP');
    await advance(1);
    await advance(199);
    expect(screen.queryByText('+50 XP earned')).toBeNull();
    await advance(1);
    expect(screen.getByText('+50 XP earned')).toBeVisible();
    expect(screen.queryByText('+25 XP earned')).toBeNull();
  });

  it.each([
    ['rank-up', { kind: 'rankup', titleKey: 'xp.rankUpKicker', titleVars: {}, level: 2 }, 4800],
    ['held award', { kind: 'held', hold: { on: 'task', availableAt: null } }, 6000],
  ] as const)('retains the %s reading duration before the next queued event', async (_label, toast, duration) => {
    vi.useFakeTimers();
    render(<LanguageProvider><XpToaster /></LanguageProvider>);
    emit(toast);
    emit(gain(75));
    expect(screen.getByRole('status')).toBeVisible();
    await advance(duration - 1);
    expect(screen.queryByText('+75 XP earned')).toBeNull();
    await advance(1);
    await advance(199);
    expect(screen.queryByText('+75 XP earned')).toBeNull();
    await advance(1);
    expect(screen.getByText('+75 XP earned')).toBeVisible();
  });
});
