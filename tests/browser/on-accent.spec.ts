import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';

// P1.3 (docs/design/product-ux-audit.md): text painted on a coloured fill used
// a fixed white. On the dark theme's bright accent #4caf50 that measures
// 2.78:1, and on a light topic hue (JavaScript yellow, HTML orange) far less.
// Each surface below now reads its text colour from the fill: the accent's
// --brand-on-accent, the XP toast's --ss-on-success-strong, or, for a topic
// hue, textOnColor() in client/src/lib/categories.ts. The checks run axe's
// color-contrast rule on the rendered elements and also measure the computed
// colours, because axe skips text inside aria-hidden elements such as the
// roadmap's stage dots.

type Theme = 'light' | 'dark';

const level = (n: number, title: string) => ({ level: n, title, difficulty: 1, questionCount: 1 });
// The public roadmap's shape, cut down to one level of each free topic.
const STRUCTURE = {
  topics: ['javascript', 'html', 'css'],
  structure: {
    html: { levels: [level(1, 'Structure & Semantics')], checkpoints: [] },
    css: { levels: [level(1, 'Cascade, Inheritance & Selectors')], checkpoints: [] },
    javascript: { levels: [level(1, 'Values & Math')], checkpoints: [] },
  },
};
const levelPayload = (topic: string, ref: number) => ({
  kind: 'level', topic, ref, title: 'Level', difficulty: 1, passPct: 75, sessionId: 'on-accent-spec',
  questions: [{
    id: `rm-${topic}-spec`, tags: ['Roadmap'], introduction: 'A placeholder question for the contrast check.',
    question: 'Which option is first?', options: ['First', 'Second', 'Third', 'Fourth'], category: topic, difficulty: 1,
  }],
});

async function open(page: Page, theme: Theme, route: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.addInitScript((theme) => { try { localStorage.setItem('devquiz:color-mode', theme); } catch { /* private mode */ } }, theme);
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/roadmap' && !url.search) return route.fulfill({ json: STRUCTURE });
    const topic = url.searchParams.get('topic');
    if (url.pathname === '/api/quiz/roadmap' && topic) return route.fulfill({ json: levelPayload(topic, Number(url.searchParams.get('level'))) });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
  });
  await page.goto(route);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

// WCAG contrast of an element's own text colour against its own solid fill.
const measuredContrast = (page: Page, selector: string) => page.locator(selector).first().evaluate((element) => {
  const channels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (value: string) => {
    const [r, g, b] = channels(value).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const style = getComputedStyle(element);
  const [a, b] = [luminance(style.color), luminance(style.backgroundColor)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});

async function expectReadable(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toBeVisible();
  // Let any finite fade or transition on the element or its ancestors finish,
  // so neither check reads colours blended mid-animation.
  await page.locator(selector).first().evaluate(async (element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      await Promise.all(node.getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)));
    }
  });
  expect(await measuredContrast(page, selector)).toBeGreaterThanOrEqual(4.5);
  const contrast = await new AxeBuilder({ page }).include(selector).withRules(['color-contrast']).analyze();
  expect(contrast.violations).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: /today's "start here" chip reads on the accent`, async ({ page }) => {
    await open(page, theme, '/today');
    await expectReadable(page, '.today-card__chip');
  });

  test(`${theme}: /roadmap's stage dots read on the accent`, async ({ page }) => {
    await open(page, theme, '/roadmap');
    await expectReadable(page, '[data-stage-dot]');
  });

  for (const [topic, name] of [['HTML', /^Level 1: Structure/], ['CSS', /^Level 1: Cascade/], ['JavaScript', /^Level 1: Values/]] as const) {
    // A level's Start is the screen's one SwimCta md on the brand accent (UX
    // audit learn-04), no longer a block filled with the topic colour.
    test(`${theme}: a ${topic} level's start button reads on the accent`, async ({ page }) => {
      await open(page, theme, '/learn');
      await page.getByRole('radio', { name: topic, exact: true }).click();
      await page.getByRole('button', { name }).click();
      await expectReadable(page, '.ss-question-actions .ss-swim-cta');
    });
  }

  // P1.8: the progress line under each topic on /learn's rail sat at opacity
  // 0.72, which read 3.3:1 on the light theme's white. It now takes
  // --color-text-secondary, so check it idle and selected. It has no fill of
  // its own, so axe, which composites the pill behind it, does the measuring.
  test(`${theme}: /learn's topic progress lines read idle and selected`, async ({ page }) => {
    await open(page, theme, '/learn');
    await expect(page.getByRole('radio').filter({ hasText: /\d+ \/ \d+ levels/ })).toHaveCount(3);
    for (const topic of ['HTML', 'CSS']) {
      await page.getByRole('radio', { name: topic, exact: true }).click();
      await expect(page.getByRole('radio', { name: topic, exact: true })).toBeChecked();
      const contrast = await new AxeBuilder({ page }).include('.rm-topic-rail').withRules(['color-contrast']).analyze();
      expect(contrast.violations).toEqual([]);
    }
  });

  test(`${theme}: the XP toast's text token reads on its fill`, async ({ page }) => {
    await open(page, theme, '/');
    // The toast only appears after a verified award; the token pair is what it paints.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.id = 'xp-toast-colours';
      probe.textContent = '+25 XP';
      probe.style.cssText = 'position:fixed;top:0;left:0;padding:10px 18px;font-weight:700;background:var(--ss-success-strong);color:var(--ss-on-success-strong)';
      document.body.append(probe);
    });
    await expectReadable(page, '#xp-toast-colours');
  });
}
