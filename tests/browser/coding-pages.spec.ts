import { test, expect, type Page, type Route } from './console-clean';
import AxeBuilder from '@axe-core/playwright';
import { CODING_TASKS, playable } from '../../lib/coding/catalog';
import { localAuth, storeFakeSession } from './fake-session';
import { fulfilTaskRead, isTaskRead } from './coding-task-read';
import { EVOLVING_CHALLENGES, evolvingTaskTrack, listedChallenges } from '../../shared/evolving';
import { isFreeCodingTask } from '../../shared/tiers';
import { CODING_SECTION_TRACKS, hasLearnLevel } from '../../shared/coding-catalog';

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
  entitlement?: (route: Route) => Promise<void>;
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
    if (op === 'entitlement') return api.entitlement ? api.entitlement(route) : route.fulfill({ json: PREMIUM });
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

test('highlighted technique rows leave room on both sides', async ({ page }) => {
  await answer(page);
  await page.goto('/coding');
  await page.getByText('Techniques', { exact: true }).click();
  const row = page.getByRole('link', { name: /^Array methods/ });
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await row.hover();
    const inset = await row.evaluate((el) => {
      const style = getComputedStyle(el);
      const row = el.getBoundingClientRect();
      const heading = el.querySelector('.cd-technique__head')!.getBoundingClientRect();
      return { left: heading.left - row.left, right: row.right - heading.right, background: style.backgroundColor };
    });
    expect(inset.left).toBeGreaterThanOrEqual(8);
    expect(inset.right).toBeGreaterThanOrEqual(8);
    expect(inset.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
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
        localStorage.setItem('devshark:consent', JSON.stringify({ version: 2, analytics: false, marketing: false, decidedAt: Date.now() }));
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
      const locked = nav.getByRole('button', { name: /Level 4 of 10\. Complete stage 2 to unlock stage 4\./ });
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

  for (const theme of ['light', 'dark'] as const) for (const width of [360, 1280]) {
    test(`Coding automatically resumes the last unfinished challenge at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      const projects = EVOLVING_CHALLENGES.filter(project => !project.short && !project.category).slice(0, 2);
      await answer(page, {
        progress: route => route.fulfill({ json: { ...PROGRESS, tasks: Object.fromEntries(projects.map((project, i) => [project.stages[0], { ...PROGRESS.tasks[TASK], updatedAt: `2026-11-0${i + 1}T12:00:00Z` }])) } }),
        task: route => {
          const task = CODING_TASKS.find(task => task.id === new URL(route.request().url()).searchParams.get('id'))!;
          return fulfilTaskRead(route, { task: playable(task), session: 'resume-task', locked: null, progress: null, draft: null, signedIn: true });
        },
      });
      await page.goto('/coding');
      const card = page.getByRole('region', { name: 'Your next challenge' });
      await expect(card.getByRole('combobox')).toHaveCount(0);
      await expect(card).toContainText(projects[1].title);
      await card.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${projects[1].stages[1]}$`));
      await expect(page.getByRole('tab', { name: 'Description', exact: true })).toBeVisible();
      // Visiting a different unfinished project now takes over automatically.
      await page.goto(`/coding/javascript/${projects[0].stages[1]}`);
      await expect(page.getByRole('tab', { name: 'Description', exact: true })).toBeVisible();
      await page.goto('/coding');
      await expect(card).toContainText(projects[0].title);
      await expect(card.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 1280 && theme === 'dark') await card.screenshot({ path: info.outputPath('automatic-resume.png') });
      await card.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${projects[0].stages[1]}$`));
    });
  }

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

test.describe('phone Coding routes', () => {
  test.use({ hasTouch: true });
  test('direct links show the owner notice in both orientations without starting the workbench', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('devshark:coding:narrow-editor:v1', '1'));
    const heavy: string[] = [];
    page.on('request', req => {
      const url = new URL(req.url());
      if (/CodingSection|CodingWorkbench|codemirror|\/sandbox\/|typescript-worker/i.test(url.pathname)
        || ['coding-task', 'coding-brief', 'coding-state'].includes(url.searchParams.get('resource') ?? '')) heavy.push(req.url());
    });
    await answer(page);
    for (const viewport of [{width: 390, height: 844}, {width: 844, height: 390}]) {
      await page.setViewportSize(viewport);
      for (const path of ['/coding', '/coding/javascript', '/coding/fullstack', '/coding/javascript/js-digit-sum']) {
        await page.goto(path);
        await expect(page.getByText('This section only works in desktop apps. Apologies, but coding on phone is painful and we dont want to cause no harm.', {exact: true})).toBeVisible();
        await expect(page.locator('.cd-workbench, .cd-catalogue, .cm-editor')).toHaveCount(0);
        await expect(page.locator('.ss-header')).toBeVisible();
        await expect(page.getByRole('button', { name: /Use the editor here|Run|Submit/, exact: true })).toHaveCount(0);
      }
    }
    expect(heavy).toEqual([]);
  });
  test('resizing back to desktop restores the edited task without submitting it', async ({ page }) => {
    const posts: string[] = [];
    const task = CODING_TASKS.find(one => one.id === TASK)!;
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).searchParams.get('resource') === 'coding-submit') posts.push(request.url());
    });
    await answer(page, { task: route => fulfilTaskRead(route, {
      task: playable(task), session: 'resize-session', locked: null, progress: null, draft: null, signedIn: false,
    }) });
    await page.goto(`/coding/javascript/${TASK}`);
    const editor = page.locator('.cm-content');
    await editor.fill('const digitSum = n => n;');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('This section only works', { exact: false })).toBeVisible();
    await expect(editor).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(editor).toContainText('const digitSum = n => n;');
    expect(posts).toEqual([]);
  });

});

test('a guest project with a free opening stage shows its access rule once and a free start', async ({page}) => {
  await answer(page);
  await page.goto('/coding/fullstack');
  const project = page.locator('.cd-project').filter({has: page.getByRole('button', {name: 'Start Link shortener', exact:true})});
  await expect(project).toBeVisible();
  await expect(project.getByText('Premium', {exact:true})).toHaveCount(0);
});

for (const category of [undefined, 'debugging'] as const) {
  test(`a new ${category ?? 'evolving'} project targets its free first stage without a Premium badge`, async ({ page }) => {
    const project = listedChallenges({ category })[0];
    await answer(page);
    await page.goto(category ? '/coding?projects=debugging' : '/coding');
    const row = page.getByRole('article', { name: project.title, exact: true });
    const action = row.getByRole('button', { name: 'Start ' + project.title, exact: true });
    await expect(action).toBeVisible();
    await expect(row.getByText('Premium', { exact: true })).toHaveCount(0);
    await action.press('Enter');
    const stage = project.stages[0];
    await expect(page).toHaveURL(url => url.pathname === '/coding/' + evolvingTaskTrack(stage) + '/' + stage);
  });
}

for (const [tier, stage] of [
  ['free', 'first'], ['free', 'boundary'], ['premium', 'boundary'], ['unknown', 'boundary'], ['free', 'completed'],
] as const) {
  test(`project badge and keyboard action agree for a ${tier} account at ${stage}`, async ({ page }) => {
    const project = EVOLVING_CHALLENGES.find(one => one.id === 'fullstack-links')!;
    const paid = project.stages.findIndex(id => !isFreeCodingTask(id));
    const passes = stage === 'first' ? 0 : stage === 'completed' ? project.stages.length : paid;
    const target = project.stages[Math.min(passes, project.stages.length - 1)];
    await storeFakeSession(page);
    await localAuth(page);
    await answer(page, {
      entitlement: route => tier === 'unknown' ? notFound(route) : route.fulfill({ json: { ...PREMIUM, tier } }),
      progress: route => route.fulfill({ json: {
        ...PROGRESS, tasks: Object.fromEntries(project.stages.slice(0, passes).map(id => [id, PROGRESS.tasks[TASK]])),
      } }),
    });
    await page.goto('/coding/fullstack');
    const row = page.getByRole('article', { name: project.title, exact: true });
    const action = row.getByRole('button');
    await expect(action).toHaveAccessibleName(new RegExp(`${stage === 'completed' ? 'Review' : passes ? 'Continue' : 'Start'} ${project.title}`));
    const locked = tier === 'free' && stage === 'boundary';
    await expect(row.getByText('Premium', { exact: true })).toHaveCount(locked ? 1 : 0);
    await action.focus();
    await page.keyboard.press('Enter');
    if (locked) {
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page).toHaveURL(/\/coding\/fullstack$/);
    } else {
      await expect(page).toHaveURL(new RegExp(`/coding/${evolvingTaskTrack(target)}/${target}$`));
    }
  });
}

for (const track of CODING_SECTION_TRACKS) test(`track rows show the authored ${track} difficulty and estimated duration`, async ({page}) => {
  await answer(page);
  await page.goto('/coding/' + track);
  const row = page.locator('.cd-catalogue .cd-row').first();
  await expect(row).toBeVisible();
  const title = await row.locator('.cd-row__title').textContent();
  const task = CODING_TASKS.find(item => item.title === title && item.track === track)!;
  const summary = playable(task);
  await expect(row.getByText(`Est. ${summary.estimatedMinutes} min`, {exact:true})).toBeVisible();
  await expect(row.getByText(new RegExp('^' + summary.difficulty + '$', 'i'))).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`the task breadcrumb returns to the same filtered row and catalogue page in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript(mode => localStorage.setItem('devquiz:color-mode', mode), theme);
    await storeFakeSession(page);
    await localAuth(page);
    await answer(page, { task: route => {
      const id = new URL(route.request().url()).searchParams.get('id');
      const entry = CODING_TASKS.find(task => task.id === id)!;
      return fulfilTaskRead(route, { task: playable(entry), session: entry.id, locked: null, progress: null, draft: null, signedIn: true });
    } });
    const list = '/coding/javascript?q=a&difficulty=easy&page=2';
    await page.goto(list);
    const rows = page.locator('.cd-catalogue .cd-row');
    await expect(rows).toHaveCount(20);
    await expect(page.locator('.cd-catalogue > ul')).toHaveCount(2);
    await expect(page.locator('.cd-pagination').getByRole('status').filter({ hasText: /Page \d+ of/ })).toContainText('Page 2 of');
    const titles = await rows.locator('.cd-row__title').allTextContents();
    const links = await page.locator('.cd-catalogue a.cd-row').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')!));
    const link = links.find(path => {
      const task = CODING_TASKS.find(one => one.id === path.split('/').pop());
      return task && hasLearnLevel(task);
    });
    expect(link, 'a real task linked to a Learn level on the second filtered page').toBeTruthy();
    const task = CODING_TASKS.find(one => one.id === link!.split('/').pop())!;
    const entry = page.locator('.cd-catalogue a').filter({ has: page.getByText(task.title, { exact: true }) });
    await entry.focus();
    await expect(entry).toBeFocused();
    expect((await entry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await entry.press('Enter');
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(page.locator('.cd-workbench')).toContainText('Level ' + task.level);
    const back = page.locator('.cd-editor-bar__path a').filter({ hasText: /^javascript$/i });
    await expect(back).toHaveAttribute('href', list);
    await back.click();
    await expect(page).toHaveURL(url => url.pathname + url.search === list);
    await expect(page.getByRole('searchbox')).toHaveValue('a');
    await expect(page.locator('#javascript-difficulty')).toHaveValue('easy');
    await expect(rows.locator('.cd-row__title')).toHaveText(titles);
  });
}
