declare global {
  interface Window { dailyLayoutShifts: number[] }
}

import { test, expect, type Page } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { addDays, qotdTrack } from '../../shared/daily-question';

// The marketing launch pages (#239): the public question of the day and the
// per-page share heads. The preview server has no API, so
// the question and its check are answered here with invented fixtures in the
// real wire shape.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const today = new Date().toISOString().slice(0, 10);

async function settled(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity), undefined, { timeout: 15_000 });
}

async function mockQuestion(page: Page) {
  await page.route('**/api/quiz/daily?qotd=*', (route) => route.fulfill({
    json: {
      date: today,
      track: 'javascript',
      sessionId: 'sealed-session',
      question: { id: 'q-1', question: 'What does `typeof null` return?', options: ['"null"', '"object"', '"undefined"', '"number"'], category: 'javascript', difficulty: 2 },
    },
  }));
  await page.route('**/api/quiz/submit', (route) => route.fulfill({
    json: {
      totalQuestions: 1, correctAnswers: 1, percentage: 100, questXp: 2,
      results: [{ questionId: 'q-1', selectedIndex: 1, correctAnswer: 1, isCorrect: true, explanation: 'typeof null is "object", a quirk kept for compatibility.' }],
    },
  }));
}

test('opening Daily keeps its mobile header in place when the question arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockQuestion(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/quiz/daily?*', async route => { await gate; await route.fallback(); });
  await page.goto('/daily');
  const heading = page.getByRole('heading', { name: 'Question of the day', exact: true });
  try {
    await expect(page.getByRole('status').filter({ hasText: 'Loading the question' })).toBeAttached();
    await expect(page.locator('.ss-header')).toBeHidden();
    const top = await heading.evaluate(element => element.getBoundingClientRect().top);
    release();
    await expect(page.getByRole('radio').first()).toBeVisible();
    expect(Math.abs(await heading.evaluate(element => element.getBoundingClientRect().top) - top)).toBeLessThan(2);
  } finally {
    release();
  }
});

for (const width of [390, 1280]) for (const dated of [false, true]) {
  test(`a ${dated ? 'dated' : 'current-day'} Daily link keeps its layout and starts exactly its own read at ${width}px`, async ({ page }) => {
    const date = dated ? addDays(today, -1) : today;
    const track = qotdTrack(date);
    const reads: string[] = [];
    let release!: () => void;
    const heldRoute = new Promise<void>(resolve => { release = resolve; });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      const entries: number[] = [];
      Object.assign(window, { dailyLayoutShifts: entries });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) entries.push(entry.value);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.route(/\/assets\/DailyQuestionPage-[^/]+\.js$/, async route => { await heldRoute; await route.continue(); });
    await page.route('**/api/quiz/daily?*', route => {
      reads.push(new URL(route.request().url()).searchParams.get('qotd') ?? '');
      return route.fulfill({ json: { date, track, sessionId: 'dated-session', question: {
        id: 'dated', question: 'Pick the first option.', options: ['One', 'Two'], category: track, difficulty: 1,
      } } });
    });
    try {
      await page.goto(dated ? `/daily/${date}` : '/daily', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => reads).toEqual([date]);
      await expect(page.locator('#main-content [data-activity="active"]')).toBeAttached();
      await expect(page.locator('.ss-header')).toBeHidden();
      release();
      await expect(page.getByRole('radio', { name: 'One', exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const shifts = await page.evaluate(() => window.dailyLayoutShifts);
      expect(shifts.reduce((sum, shift) => sum + shift, 0)).toBeLessThan(0.01);
      expect(reads).toEqual([date]);
    } finally {
      release();
    }
  });
}

for (const theme of ['light', 'dark'] as const) for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`${theme} ${viewport.width}px: /daily checks an answer and passes WCAG 2.2 AA`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addInitScript((theme) => { try { localStorage.setItem('devquiz:color-mode', theme); } catch {} }, theme);
    await mockQuestion(page);
    await page.goto('/daily');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Question of the day');
    await page.getByRole('radio', { name: '"object"' }).click();
    await page.getByRole('button', { name: 'Check answer' }).click();
    await expect(page.getByText('Right answer')).toBeVisible();
    await settled(page);
    const findings = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(findings.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`daily-${theme}-${viewport.width}.png`), fullPage: true });
  });
}

test('each day and each coding task has its own share head, with no question or answer in it', async ({ request }) => {
  const day = await (await request.get(`/daily/${today}`)).text();
  expect(day).toContain(`<meta property="og:image" content="https://devshark.app/og/daily/${today}.png" />`);
  expect(day).not.toMatch(/ss-radio-card|correctAnswer|explanation/);
  const image = await request.get(`/og/daily/${today}.png`);
  expect(image.headers()['content-type']).toBe('image/png');
  const task = await (await request.get('/coding/javascript/js-digit-sum')).text();
  expect(task).toContain('<title>Digit sum · JavaScript coding challenge · devShark</title>');
  expect(task).toContain('<meta property="og:image" content="https://devshark.app/og/coding/js-digit-sum.png" />');
  expect(task).toMatch(/\d+ of \d+ coding tasks are free/);
  expect((await request.get('/og/coding/js-digit-sum.png')).headers()['content-type']).toBe('image/png');
});

test('/daily names the day without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${process.env.TEST_BASE_URL || 'http://localhost:4173'}/daily/${today}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('question of the day');
  await expect(page.getByText('Turn on JavaScript to see the question and check your answer.')).toBeVisible();
  await context.close();
});
