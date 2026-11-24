import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, onTestFinished, vi } from 'vitest';

export function installNativeDialog() {
  // jsdom implements neither opening nor the browser's initial modal focus.
  const proto = HTMLDialogElement.prototype;
  proto.showModal ??= function () { this.setAttribute('open', ''); };
  proto.close ??= function () { this.removeAttribute('open'); };
  const show = proto.showModal;
  const modalFocus = vi.spyOn(proto, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    show.call(this);
    if (!this.contains(document.activeElement)) {
      this.querySelector<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[tabindex="0"]')?.focus();
    }
  });
  onTestFinished(() => modalFocus.mockRestore());
}

export async function checkEscapeReturn(opener: HTMLElement, role: 'dialog' | 'alertdialog', initial?: RegExp) {
  opener.focus();
  fireEvent.click(opener);
  const modal = await screen.findByRole(role);
  if (initial) await waitFor(() => expect(within(modal).getByRole('button', { name: initial })).toHaveFocus());
  else await waitFor(() => expect(modal.contains(document.activeElement), opener.getAttribute('aria-label') ?? opener.textContent ?? 'dialog opener').toBe(true));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(modal).not.toBeVisible());
  expect(opener).toHaveFocus();
}
