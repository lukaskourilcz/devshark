import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { CODING_TASKS, playable } from '../../lib/coding/catalog';
import { localAuth, storeFakeSession } from './fake-session';
import { fulfilTaskRead, isTaskRead } from './coding-task-read';
import { EVOLVING_CHALLENGES } from '../../shared/evolving';

// The Coding pages against the built app, with the API answered here in its
// real shapes: a missing track or task (C3-17, V3-2), a track whose progress
// does not load (C5-5), and a task whose account draft was saved elsewhere
// since the copy on this device (C5-4, V3-1). Nothing leaves the machine.

const TASK = 'js-digit-sum';
const COPY = `devshark:coding:draft:${TASK}`;
const TIME = `devshark:coding:draft-time:${TASK}`;
const PREMIUM = { tier: 'premium', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const PROGRESS = { tasks: { [TASK]: { status: 'passed', passes: 1, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null } }, due: [], javascriptLevelsCleared: 0, passedByTrack: {} };
const notFound = (route: Route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } });
// What the coding-task resource answers for an id the catalogue does not hold,
// whatever its shape (scripts/test-coding-authorization.ts pins it). It used to
// answer 400 for an id outside the task-id pattern, which this page offered to
// retry forever (V3-2).
const unknownTask = (route: Route) => route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Unknown task' } } });

interface Api {
  progress?: (route: Route) => Promise<void>;
  task?: (route: Route) => Promise<void>;
  session?: (route: Route) => Promise<void>;
  bookmarks?: (route: Route) => Promise<void>;
}
/** The API this page talks to; anything else answers 404. */
async function answer(page: Page, api: Api = {}) {
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    if (url.pathname === '/api/quiz/roadmap') {
      if (isTaskRead(url.searchParams.get('resource'))) return api.task ? api.task(route) : notFound(route);
      if (!url.search) return route.fulfill({ json: { topics: [], structure: {} } });
      return notFound(route);
    }
    if (op === 'entitlement') return route.fulfill({ json: PREMIUM });
    if (op === 'coding-progress') return api.progress ? api.progress(route) : route.fulfill({ json: PROGRESS });
    if (op === 'coding-bookmarks') return api.bookmarks ? api.bookmarks(route) : route.fulfill({ json: { saved: [], collections: [] } });
    if (op === 'practice-session') return api.session ? api.session(route) : route.fulfill({ json: { session: null } });
    return notFound(route);
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
});

test('a track that does not exist has a heading, a way back and no index', async ({ page }) => {
  await answer(page);
  await page.goto('/coding/nope');
  await expect(page.getByRole('heading', { level: 1, name: 'That track does not exist.' })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await page.getByRole('link', { name: 'Back to Coding' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Coding challenges' })).toBeVisible();
});

// System design is hidden (owner decision, 9 Oct 2026): its track and an old
// task address read as a track that does not exist, and the task is never
// asked for.
for (const path of ['/coding/system-design', '/coding/system-design/sd-url-shortener']) {
  test(`${path} is a track that does not exist, kept out of search`, async ({ page }) => {
    const asked: string[] = [];
    await answer(page, { task: (route) => { asked.push(new URL(route.request().url()).searchParams.get('id') ?? ''); return unknownTask(route); } });
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'That track does not exist.' })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.getByText(/system design/i)).toHaveCount(0);
    expect(asked).toEqual([]);
    await page.getByRole('link', { name: 'Back to Coding' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Coding challenges' })).toBeVisible();
  });
}

for (const id of ['no-such-task', 'js_digit_sum']) {
  test(`a task that does not exist (${id}), loaded directly, says so and leads back to its track`, async ({ page }) => {
    const asked: string[] = [];
    await answer(page, { task: (route) => { asked.push(new URL(route.request().url()).searchParams.get('id') ?? ''); return unknownTask(route); } });
    await page.goto(`/coding/javascript/${id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'That challenge does not exist.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    expect(asked).toEqual([id]);
    await page.getByRole('link', { name: 'Back to the list' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
  });
}

test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await localAuth(page);
    await storeFakeSession(page);
  });

  for (const theme of ['light', 'dark'] as const) for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
    test(`Coding audit: resume, FullStack and stage context at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const project = EVOLVING_CHALLENGES.find(item => item.id === 'js-evolving-calculator')!;
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(value => {
        localStorage.setItem('devquiz:color-mode', value);
        localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
      }, theme);
      await answer(page, {
        progress: route => route.fulfill({ json: { ...PROGRESS, tasks: { [project.stages[0]]: PROGRESS.tasks[TASK] } } }),
        session: route => route.fulfill({ json: { session: { sessionId: 'audit-run', status: 'active', queue: ['js-digit-sum', 'js-count-multiples'], position: 1, minutes: 10, estimatedMinutes: 10, count: 2, order: 'sequential', topic: 'javascript', scheduledFor: null } } }),
        task: route => {
          const authored = CODING_TASKS.find(task => task.id === new URL(route.request().url()).searchParams.get('id'));
          if (!authored) throw new Error('Missing audit fixture task');
          return fulfilTaskRead(route, { task: playable(authored), session: 'audit-task', locked: null, progress: null, draft: null, signedIn: true });
        },
      });
      const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto('/coding');
      const resume = page.getByRole('region', { name: 'Continue your run' });
      await expect(resume).toContainText('Count multiples');
      await expect(page.locator('.cd-run').getByRole('link', { name: 'Continue', exact: true })).toHaveCount(0);
      const ending = page.locator('.cd-run__ending');
      await expect(ending).toContainText('Completed challenges stay saved.');
      const text = await ending.locator(':scope > span').boundingBox();
      const button = await ending.getByRole('button', { name: 'End the run' }).boundingBox();
      expect(text && button && Math.abs(text.y + text.height / 2 - button.y - button.height / 2) < 2).toBe(true);
      await noOverflow();
      if (width === 1280 && theme === 'dark') {
        await page.screenshot({ path: testInfo.outputPath('coding-resume-after.png') });
        await page.locator('.cd-run').screenshot({ path: testInfo.outputPath('coding-run-actions-after.png') });
      }

      await page.goto('/coding/fullstack');
      await expect(page.getByRole('heading', { level: 1, name: 'FullStack projects' })).toBeVisible();
      await expect(page.locator('.cd-project__track')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Start Link shortener', exact: true })).toBeVisible();
      await noOverflow();
      if (width === 1280 && theme === 'dark') await page.screenshot({ path: testInfo.outputPath('coding-fullstack-after.png') });

      await page.goto(`/coding/javascript/${project.stages[2]}`);
      const nav = page.locator('.cd-stage-nav');
      const current = nav.locator('[aria-current="step"]');
      await expect(current).toHaveText('3');
      const accent = await current.evaluate(node => {
        const color = document.createElement('span');
        color.style.color = getComputedStyle(node).getPropertyValue('--brand-accent').trim();
        return color.style.color;
      });
      await expect(current).toHaveCSS('color', accent);
      await expect(nav).not.toContainText('Current');
      await expect(page.locator('.cd-brief__meta')).toHaveCount(0);
      const requirements = page.locator('.cd-previous > summary');
      await expect(requirements).toBeVisible();
      expect((await requirements.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const locked = nav.getByRole('button', { name: /Stage 4 of 10\. Complete stage 2 to unlock stage 4\./ });
      await locked.focus();
      await expect(locked).toBeFocused();
      await expect(locked).toHaveAttribute('aria-disabled', 'true');
      await locked.press('Enter');
      await expect(page.locator('p.cd-note[role="status"]')).toContainText('Complete stage 2 to unlock stage 4.');
      await noOverflow();
      if (width === 1280 && theme === 'dark') await page.screenshot({ path: testInfo.outputPath('coding-stage-after.png'), fullPage: true });
    });
  }

  test('Coding audit: Saved failures recover and bookmark writes stay serialized', async ({ page }) => {
    let failing = true;
    let writes = 0;
    let finish!: () => void;
    const writing = new Promise<void>(resolve => { finish = resolve; });
    await answer(page, { bookmarks: async route => {
      if (route.request().method() === 'PUT') {
        writes += 1;
        await writing;
        return route.fulfill({ json: { saved: ['js-digit-sum'], collections: [] } });
      }
      return failing
        ? route.fulfill({ status: 500, json: { error: { code: 'db_error', message: 'Could not load bookmarks' } } })
        : route.fulfill({ json: { saved: [], collections: [] } });
    } });
    await page.goto('/coding/javascript?saved=1');
    await expect(page.getByRole('alert')).toContainText('Could not load your saved challenges.');
    await expect(page.getByText('No challenge matches those filters. Clear them to see the rest.')).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('No challenge matches those filters. Clear them to see the rest.')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).click();
    const star = page.getByRole('link', { name: /Digit sum/ }).locator('..').getByRole('button');
    const other = page.getByRole('link', { name: /Count multiples/ }).locator('..').getByRole('button');
    await star.click();
    await expect(other).toHaveAttribute('aria-disabled', 'true');
    await expect(star).toBeFocused();
    await other.dispatchEvent('click');
    expect(writes).toBe(1);
    finish();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    await expect(star).toBeFocused();
  });

  test('Coding audit: a phone offers explicit unfinished-project choices', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 900 });
    const projects = EVOLVING_CHALLENGES.filter(project => !project.short && !project.category).slice(0, 2);
    await answer(page, {
      progress: route => route.fulfill({ json: { ...PROGRESS, tasks: Object.fromEntries(projects.map(project => [project.stages[0], PROGRESS.tasks[TASK]])) } }),
      task: route => {
        const task = CODING_TASKS.find(task => task.id === new URL(route.request().url()).searchParams.get('id'))!;
        return fulfilTaskRead(route, { task: playable(task), session: 'choice-task', locked: null, progress: null, draft: null, signedIn: true });
      },
    });
    await page.goto('/coding');
    const card = page.getByRole('region', { name: 'Your next challenge' });
    const resume = card.getByRole('button', { name: 'Continue', exact: true });
    await expect(resume).toBeDisabled();
    const choice = card.getByRole('combobox', { name: 'Choose what to continue' });
    await choice.selectOption(projects[1].stages[1]);
    await expect(resume).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await resume.click();
    await expect(page).toHaveURL(new RegExp(`/coding/javascript/${projects[1].stages[1]}$`));
    await expect(page.getByRole('tab', { name: 'Description', exact: true })).toBeVisible();
  });

  test('a track whose progress does not load says so, and draws the list on Try again', async ({ page }) => {
    let failing = true;
    await answer(page, {
      progress: (route) => failing
        ? route.fulfill({ status: 500, json: { error: { code: 'db_error', message: 'Could not load coding progress' } } })
        : route.fulfill({ json: PROGRESS }),
    });
    await page.goto('/coding/javascript');
    await expect(page.getByRole('alert')).toContainText('Could not load your progress.');
    await expect(page.getByText(/\d+ of \d+ passed/)).toHaveCount(0);
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('link', { name: /Digit sum/ })).toContainText('Passed');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('an account draft saved elsewhere opens, and the copy on this device is kept and opens on request', async ({ page }) => {
    const task = CODING_TASKS.find((one) => one.id === TASK);
    if (!task) throw new Error(`no coding task ${TASK}`);
    const saved = new Date(Date.now() - 60_000).toISOString();
    await page.addInitScript(({ copy, time }) => {
      if (localStorage.getItem(copy) !== null) return;
      localStorage.setItem(copy, '// the copy on this device\n');
      localStorage.setItem(time, JSON.stringify({ base: null }));
    }, { copy: COPY, time: TIME });
    await answer(page, {
      task: (route) => fulfilTaskRead(route, { task: playable(task), session: 'session-1', locked: null, progress: null, draft: '// the account draft\n', draftUpdatedAt: saved, signedIn: true }),
    });
    await page.goto(`/coding/javascript/${TASK}`);
    await expect(page.locator('.cm-content')).toContainText('// the account draft');
    await expect(page.locator('p.cd-note[role="status"]')).toContainText('saved from somewhere else after this device last saw it');
    expect(await page.evaluate((key) => localStorage.getItem(key), COPY)).toBe('// the copy on this device\n');
    const a11y = await new AxeBuilder({ page }).include('.cd-page').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(a11y.violations.map((violation) => violation.id)).toEqual([]);

    await page.getByRole('button', { name: 'Open the code from this device' }).click();
    await expect(page.locator('.cm-content')).toContainText('// the copy on this device');
    await expect(page.locator('p.cd-note[role="status"]')).toBeFocused();
    await expect(page.locator('p.cd-note[role="status"]')).toContainText('The code from this device is open.');
    await page.reload();
    await expect(page.locator('.cm-content')).toContainText('// the copy on this device');
  });
});
