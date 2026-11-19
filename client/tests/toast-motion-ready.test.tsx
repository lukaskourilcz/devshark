import { expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { AppToast } from '../src/components/ui/AppToast';

const engine = vi.hoisted(() => ({ animate: vi.fn(() => ({ stop: vi.fn() })) }));
vi.mock('motion', () => engine);

it('keeps the cold card and dismiss focus when animation code becomes ready', async () => {
  vi.useFakeTimers();
  try {
    const toast = (open: boolean) => <LanguageProvider><AppToast open={open} onClose={() => {}} message="Saved." autoHideDuration={null} /></LanguageProvider>;
    const view = render(toast(true));
    const button = screen.getByRole('button', { name: 'Dismiss' });
    button.focus();
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBe(button);
    expect(button).toHaveFocus();
    expect(screen.getByText('Saved.')).toBeVisible();
    expect(engine.animate, 'late loading must not hide and re-enter this card').not.toHaveBeenCalled();
    view.rerender(toast(false));
    expect(engine.animate, 'the ready adapter supplies the exit').toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(220); });
    expect(screen.queryByText('Saved.')).toBeNull();
    view.rerender(toast(true));
    expect(engine.animate, 'a subsequent card uses the warmed adapter').toHaveBeenCalledTimes(2);
    expect(screen.getByText('Saved.')).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
