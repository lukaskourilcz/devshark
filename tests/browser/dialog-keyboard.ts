import type { Locator, Page } from '@playwright/test';
import { expect } from './console-clean';

export async function checkDialogEscape(page: Page, opener: Locator, dialog: Locator) {
  await opener.focus();
  await opener.press('Enter');
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
}
