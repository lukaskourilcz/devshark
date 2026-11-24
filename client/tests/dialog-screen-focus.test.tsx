import { useState } from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ReportDialog } from '../src/components/ReportDialog';
import { RedFlagDialog } from '../src/components/RedFlagDialog';
import PathPickerDialog from '../src/components/PathPickerDialog';

const proto = HTMLDialogElement.prototype;
proto.showModal ??= function () { this.setAttribute('open', ''); };
proto.close ??= function () { this.removeAttribute('open'); };

function Screen({ kind, submit }: { kind: 'report' | 'lesson' | 'path'; submit: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return <LanguageProvider>
    <button onClick={() => setOpen(true)}>Open {kind}</button>
    {kind === 'report' && <ReportDialog open={open} onClose={close} onSubmit={submit} />}
    {kind === 'lesson' && <RedFlagDialog open={open} onClose={close} onSubmit={submit} />}
    {kind === 'path' && <PathPickerDialog open={open} onClose={close} current="frontend" onChoose={submit} />}
  </LanguageProvider>;
}

describe('learner dialog navigation', () => {
  it.each(['report', 'lesson', 'path'] as const)('focuses the %s dialog and returns to the same opener on Escape', async kind => {
    const submit = vi.fn();
    render(<Screen kind={kind} submit={submit} />);
    const opener = screen.getByRole('button', { name: 'Open ' + kind });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getAllByRole('heading')[0];
    await waitFor(() => expect(title).toHaveFocus());
    if (kind === 'path') {
      const next = within(dialog).getByRole('button', { name: 'Continue' });
      next.focus();
      fireEvent.click(next);
      const nextHeading = within(dialog).getAllByRole('heading')[0];
      expect(nextHeading.textContent).not.toBe('');
      await waitFor(() => expect(nextHeading).toHaveFocus());
      const back = within(dialog).getByRole('button', { name: 'Back' });
      back.focus();
      fireEvent.click(back);
      await waitFor(() => expect(within(dialog).getAllByRole('heading')[0]).toHaveFocus());
    }
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
});
