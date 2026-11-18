import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from './console-clean';
import { codingTaskRead } from '../../scripts/responsive-fixtures';

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const codingCss = resolve('client/src/coding/Coding.css');

async function prepare(page: Page) {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('devquiz:color-mode', 'light');
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    const resource = url.searchParams.get('resource');
    if (resource && ['coding-task', 'coding-brief', 'coding-state'].includes(resource)) {
      const body = codingTaskRead(resource, url.searchParams.get('id') ?? '');
      if (body) return route.fulfill({ json: body });
    }
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'Local browser fixture' } } });
  });
}

async function openEditor(page: Page) {
  await prepare(page);
  await page.goto('/coding/javascript/js-digit-sum');
  await expect(page.locator('#main-content')).toBeFocused();
  const useEditor = page.getByRole('button', { name: 'Use the editor here', exact: true });
  if (await useEditor.isVisible()) await useEditor.click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

async function editorFonts(page: Page) {
  return page.locator('.cm-editor').evaluate((editor) => ({
    coarse: matchMedia('(pointer: coarse)').matches,
    width: innerWidth,
    editor: parseFloat(getComputedStyle(editor).fontSize),
    content: parseFloat(getComputedStyle(editor.querySelector('.cm-content')!).fontSize),
  }));
}

test.describe('touch editor typography', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a real task uses at least 16px editable text at 390px with a coarse pointer', async ({ page }) => {
    await openEditor(page);
    const font = await editorFonts(page);
    expect(font.coarse).toBe(true);
    expect(font.width).toBe(390);
    expect(font.editor).toBeGreaterThanOrEqual(16);
    expect(font.content).toBeGreaterThanOrEqual(16);
  });

  test('the retained landing workbench styles keep 16px touch text', async ({ page }) => {
    // No current route renders mode="landing". Keep its CSS behavior as a
    // separate control rather than claiming a synthetic sample is a page.
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>:root{font-size:16px;--ss-type-compact:.875rem}</style><div class="cd-workbench cd-workbench--landing"><section class="cd-pane cd-pane--editor"><div class="cd-editor"><div class="cm-editor"><div class="cm-content" contenteditable="true">const answer = 42;</div></div></div></section></div>');
    await page.addStyleTag({ path: codingCss });
    const font = await editorFonts(page);
    expect(font.coarse).toBe(true);
    expect(font.editor).toBe(16);
    expect(font.content).toBe(16);
  });
});

test.describe('desktop editor typography', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('a desktop task retains compact 14px editable text', async ({ page }) => {
    await openEditor(page);
    const font = await editorFonts(page);
    expect(font.coarse).toBe(false);
    expect(font.editor).toBe(14);
    expect(font.content).toBe(14);
  });
});
