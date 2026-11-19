import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from './console-clean';
import { codingTaskRead, pathCatalog, roadmapStructure } from '../../scripts/responsive-fixtures';
import { localAuth, storeFakeSession } from './fake-session';

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

async function prepareLearner(page: Page) {
  await prepare(page);
  // Reuse the responsive runner's invented learner and wire bodies. A
  // variable import keeps the native .mjs helper outside TS's module graph.
  const fixturePath = resolve('scripts/check-responsive.mjs');
  const { apiFixture, fixtureSession } = await import(fixturePath);
  const user = fixtureSession().user;
  await storeFakeSession(page, user);
  await localAuth(page, { user: () => user });
  const misses: string[] = [];
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/quiz/roadmap' && url.searchParams.get('resource') === 'learning-path-catalog') {
      return route.fulfill({ json: pathCatalog() });
    }
    if (url.pathname === '/api/quiz/roadmap' && !url.searchParams.has('resource')) {
      return route.fulfill({ json: roadmapStructure() });
    }
    const fixture = apiFixture(request.method(), url);
    if (fixture) return route.fulfill({ status: fixture.status, json: fixture.body });
    misses.push(`${request.method()} ${url.pathname}${url.search}`);
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'Local browser fixture missing' } } });
  });
  return misses;
}

async function openProfile(page: Page) {
  const misses = await prepareLearner(page);
  await page.goto('/profile');
  await expect(page.locator('.sn-card input.sn-input')).toBeVisible();
  await expect(page.locator('.sn-card input[type="radio"]')).toHaveCount(4);
  return misses;
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

  test('a real task uses at least 16px editable text at 390px with a coarse pointer', async ({ page }, info) => {
    await openEditor(page);
    const font = await editorFonts(page);
    await info.attach('editor-typography', { body: JSON.stringify(font), contentType: 'application/json' });
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

  test('the fixed shell follows a smaller available viewport without horizontal scrolling', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const height of [844, 480, 844]) {
      await page.setViewportSize({ width: 390, height });
      const geometry = await page.locator('.ss-app-root').evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const main = document.getElementById('main-content')!.getBoundingClientRect();
        return {
          rootHeight: bounds.height, viewportHeight: innerHeight,
          cssViewportHeight: visualViewport?.height ?? innerHeight,
          pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
          mainTop: main.top, mainBottom: main.bottom,
        };
      });
      expect(Math.abs(geometry.rootHeight - height)).toBeLessThanOrEqual(1);
      expect(geometry.viewportHeight).toBe(height);
      expect(geometry.cssViewportHeight).toBeGreaterThan(0);
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
      expect(geometry.mainTop).toBeGreaterThanOrEqual(0);
      expect(geometry.mainBottom).toBeLessThanOrEqual(height + 1);
    }
    // Headless WebKit reports no physical notch inset. This covers the
    // available layout viewport; an iPhone keyboard/notch needs device QA.
    expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('width=device-width');
  });

  test('the editor stays focusable and reachable after the viewport shrinks', async ({ page }) => {
    await openEditor(page);
    await page.setViewportSize({ width: 390, height: 460 });
    const editor = page.locator('.cm-content');
    await editor.fill('const answer = 42;');
    await editor.scrollIntoViewIfNeeded();
    await expect(editor).toBeFocused();
    await expect(editor).toBeInViewport({ ratio: 0.5 });
    await expect(editor).toHaveText('const answer = 42;');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scale = await page.evaluate(() => visualViewport?.scale ?? 1);
    expect(scale).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(editor).toBeFocused();
  });

  test('the sign-in dialog scrolls its form into view and restores focus when dismissed', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'Sign in', exact: true }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 460 });
    const email = dialog.getByLabel('Email', { exact: true });
    await email.fill('learner@example.test');
    await email.scrollIntoViewIfNeeded();
    await expect(email).toBeFocused();
    await expect(email).toBeInViewport();
    const field = await email.boundingBox();
    expect(field!.height).toBeGreaterThanOrEqual(44);
    const submit = dialog.getByRole('button', { name: 'Sign in', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    const geometry = await dialog.evaluate((element) => ({
      dialogWidth: element.getBoundingClientRect().width,
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.dialogWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(trigger).toBeFocused();
  });

  test('the Profile sharkname input provides a 44px actual field target', async ({ page }, info) => {
    const misses = await openProfile(page);
    const field = page.getByRole('textbox', { name: 'Sharkname', exact: true });
    await field.scrollIntoViewIfNeeded();
    const bounds = await field.boundingBox();
    await info.attach('sharkname-rectangle', { body: JSON.stringify(bounds), contentType: 'application/json' });
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await field.focus();
    await expect(field).toBeFocused();
    expect(misses).toEqual([]);
  });

  test('Profile radio labels provide 44px targets without enlarging the visual radio', async ({ page }, info) => {
    const misses = await openProfile(page);
    const radios = page.locator('.sn-card input[type="radio"]');
    const geometry = await radios.evaluateAll((elements) => elements.map((input) => {
      const radio = input as HTMLInputElement;
      const wrapper = radio.parentElement!.getBoundingClientRect();
      const mark = radio.parentElement!.querySelector('[aria-hidden="true"]')!.getBoundingClientRect();
      const targets = [radio, ...(radio.labels ?? [])].map((target) => {
        const bounds = target.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
      return { name: [...(radio.labels ?? [])].map((label) => label.textContent).join(' '), wrapper: { width: wrapper.width, height: wrapper.height }, mark: { width: mark.width, height: mark.height }, targets };
    }));
    await info.attach('radio-rectangles', { body: JSON.stringify(geometry), contentType: 'application/json' });
    for (const radio of geometry) {
      expect(radio.targets.some((target) => target.width >= 44 && target.height >= 44), JSON.stringify(radio)).toBe(true);
      expect(radio.wrapper).toEqual({ width: 24, height: 24 });
      expect(radio.mark).toEqual({ width: 22, height: 22 });
    }
    const checked = page.locator('.sn-see input[type="radio"]:checked');
    // Safari need not focus a native radio after a pointer click. Confirm
    // the enlarged label activates the real input, then test keyboard focus
    // separately so the hit-area guard does not depend on pointer policy.
    await checked.evaluate((input) => input.addEventListener('click', () => {
      (input as HTMLElement).dataset.labelActivated = 'true';
    }, { once: true }));
    const label = page.locator('.sn-see label').filter({ hasText: /^Sharkname$/ }).first();
    const labelBounds = await label.boundingBox();
    await label.click({ position: { x: labelBounds!.width / 2, y: labelBounds!.height - 2 } });
    await expect(checked).toHaveAttribute('data-label-activated', 'true');
    await expect(checked).toBeChecked();
    await checked.focus();
    await expect(checked).toBeFocused();
    expect(misses).toEqual([]);
  });

  for (const { path, selector, label } of [
    { path: '/topics/javascript-closures', selector: '.ss-topic-article section > a', label: 'Read the documentation' },
    { path: '/daily', selector: '.ss-breadcrumb a', label: 'Today' },
    { path: '/learn', selector: '.ss-breadcrumb a', label: 'Learn' },
    { path: '/learn/web-developer', selector: '.ss-breadcrumb a', label: 'Learn' },
    { path: '/coding/javascript', selector: '.ss-breadcrumb a', label: 'Coding' },
    { path: '/privacy', selector: '.ss-legal-index a', label: 'Email' },
    { path: '/terms', selector: '.ss-legal-trader a', label: 'support@devshark.app' },
  ]) {
    test(`${path}: the standalone ${label} link has a real 44px target`, async ({ page }, info) => {
      const misses = await prepareLearner(page);
      await page.goto(path);
      // A cold public guide intentionally preserves its native focus; the
      // other routes perform the shell's delayed focus handoff to main.
      if (path.startsWith('/topics/')) await expect(page.locator('.ss-route .ss-topic-article')).toBeVisible();
      else await expect(page.locator('#main-content')).toBeFocused();
      if (path === '/privacy') await page.locator('.ss-legal-index summary').click();
      const link = page.locator(selector).filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
      await expect(link).toHaveCount(1);
      await link.scrollIntoViewIfNeeded();
      const bounds = await link.boundingBox();
      await info.attach('target-rectangle', { body: JSON.stringify({ path, label, bounds }), contentType: 'application/json' });
      expect(bounds!.width).toBeGreaterThanOrEqual(44);
      expect(bounds!.height).toBeGreaterThanOrEqual(44);
      await link.focus();
      await expect(link).toBeFocused();
      expect(misses).toEqual([]);
    });
  }
});

test.describe('desktop editor typography', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('a desktop task retains compact 14px editable text', async ({ page }, info) => {
    await openEditor(page);
    const font = await editorFonts(page);
    await info.attach('editor-typography', { body: JSON.stringify(font), contentType: 'application/json' });
    expect(font.coarse).toBe(false);
    expect(font.editor).toBe(14);
    expect(font.content).toBe(14);
  });

  test('the workbench splitter keeps its drag surface and stops tracking a canceled drag', async ({ page }) => {
    await openEditor(page);
    const splitter = page.getByRole('separator', { name: 'Resize the editor and task information panes' });
    await expect(splitter).toBeVisible();
    expect(await splitter.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
    const before = await page.locator('.cd-pane--editor').boundingBox();
    const bounds = await splitter.boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 45, bounds!.y + bounds!.height / 2);
    await splitter.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
    const canceled = await page.locator('.cd-pane--editor').boundingBox();
    await page.mouse.move(bounds!.x + 90, bounds!.y + bounds!.height / 2);
    const afterCancel = await page.locator('.cd-pane--editor').boundingBox();
    expect(afterCancel!.width).toBe(canceled!.width);
    await page.mouse.up();
    const after = await page.locator('.cd-pane--editor').boundingBox();
    expect(after!.width).toBeGreaterThan(before!.width);
    await splitter.focus();
    await splitter.press('ArrowLeft');
    await expect(splitter).toBeFocused();
  });
});
