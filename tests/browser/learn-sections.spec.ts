import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { localAuth, storeFakeSession, userWith } from './fake-session';
import { pathCatalog, roadmapStructure } from '../../scripts/responsive-fixtures';

// The Learn page's three sections (#488), against the built client with local
// wire fixtures. They do not establish the server's plan check or its saves;
// the launch contracts and the SQL job cover those.

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const structure = roadmapStructure();
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
const passed = (count: number) => ({
  levels: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), { passed: true, bestPct: 100 }])),
  checkpoints: count >= 5 ? { 1: { passed: true, bestPct: 100 } } : {},
});
/** JavaScript through its first checkpoint, and one level of Git. */
const PROGRESS = { javascript: passed(5), git: passed(1) };

const profile = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 2, baseTrack: 'frontend', specialization: null,
  goals: ['level-up'], experience: 'some', studyTime: '15-30', updatedAt: null, ...extra,
});

type Account = 'guest' | 'frontend' | 'no-plan' | 'se-member';

interface Stand {
  puts: Record<string, unknown>[];
  enrollmentPosts: unknown[];
  failStructure: boolean;
}

async function prepare(page: Page, { theme = 'light', motion = 'reduce' }: { theme?: 'light' | 'dark'; motion?: 'reduce' | 'no-preference' } = {}) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: motion });
  await page.addInitScript((mode) => {
    localStorage.setItem('devquiz:color-mode', mode);
    localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
  }, theme);
}

/** Answers the page's API and Auth requests for one kind of account. */
async function stand(page: Page, account: Account, {
  progress = PROGRESS,
  failFirstPut = false,
  catalogEnabled = false,
  failStructure = false,
}: { progress?: Record<string, unknown>; failFirstPut?: boolean; catalogEnabled?: boolean; failStructure?: boolean } = {}): Promise<Stand> {
  const state: Stand = { puts: [], enrollmentPosts: [], failStructure };
  let metadata: Record<string, unknown> = account === 'frontend' ? { devquiz_learner_profile_v2: profile() }
    : account === 'se-member' ? { devquiz_learner_profile_v2: profile({ sections: ['software-engineer'] }) }
      : {};
  if (account === 'guest') {
    // A visitor's progress lives on the device.
    await page.addInitScript((value) => localStorage.setItem('devquiz:roadmap:v2', JSON.stringify(value)), progress);
  } else {
    await storeFakeSession(page, userWith(metadata));
    await localAuth(page, { user: () => userWith(metadata) });
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const resource = url.searchParams.get('resource');
    const op = url.searchParams.get('op');
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (url.pathname === '/api/quiz/roadmap') {
      if (resource === 'progress') return route.fulfill({ json: { data: account === 'guest' ? {} : progress, extra: { unlocked: [] } } });
      if (resource === 'learning-path-catalog') return route.fulfill({ json: pathCatalog({ enabled: catalogEnabled }) });
      if (!resource && request.method() === 'GET') {
        if (state.failStructure) return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Unavailable' } } });
        return route.fulfill({ json: structure });
      }
    }
    if (op === 'entitlement') return route.fulfill({ json: FREE });
    if (op === 'learning-path-enrollment') {
      if (request.method() === 'POST') state.enrollmentPosts.push(request.postDataJSON());
      return route.fulfill({ json: { enrollments: [] } });
    }
    if (op === 'learning-preference' && request.method() === 'PUT') {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.puts.push(body);
      if (failFirstPut && state.puts.length === 1) return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Unavailable' } } });
      const saved = profile({ ...(metadata.devquiz_learner_profile_v2 as object), ...body });
      metadata = { ...metadata, devquiz_learner_profile_v2: saved };
      return route.fulfill({ json: { preference: { schemaVersion: 1, baseTrack: saved.baseTrack, specialization: saved.specialization }, legacyTrack: saved.baseTrack, profile: saved, missingProfileFields: [] } });
    }
    return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Not part of this spec' } } });
  });
  return state;
}

const switcherItem = (page: Page, name: string) =>
  page.getByRole('radiogroup', { name: 'Learn sections' }).getByRole('radio', { name: new RegExp(`^${name}`) });
const topicCard = (page: Page, name: string) =>
  // The whole label: "DSA Foundations" must not also match "DSA Advanced".
  page.getByRole('radiogroup', { name: 'Choose a topic' }).getByRole('radio', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}(?:$|,| —)`) });

test.describe('Touch inspection of locked content', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('a tap explains the exact topic and level without opening either', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest', { progress: {} });
    await page.goto('/learn/web-developer?topic=html');
    const tap = async (item: ReturnType<typeof topicCard>) => {
      await item.scrollIntoViewIfNeeded();
      const box = await item.boundingBox();
      await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    };
    await tap(topicCard(page, 'TypeScript'));
    await expect(page.getByRole('status').filter({ hasText: 'Pass 5 levels in each prerequisite topic to open TypeScript: JavaScript.' })).toBeVisible();
    await expect(page).toHaveURL(/topic=html$/);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await tap(page.getByRole('button', { name: 'Level 2: Links, Buttons & Interaction, Locked', exact: true }));
    await expect(page.getByRole('status').filter({ hasText: 'Pass Level 1: Structure & Semantics to open this level.' })).toBeVisible();
    await expect(page.locator('.rm-overview-card')).toBeVisible();
    await expect(page).toHaveURL(/topic=html$/);
  });
});

test.describe('Learn section routes', () => {
  test('keyboard inspection explains an exact locked topic without opening it', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest', { progress: {} });
    const opened: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/quiz/roadmap' && (url.searchParams.has('level') || url.searchParams.has('test'))) opened.push(url.href);
    });
    await page.goto('/learn/web-developer?topic=html');
    const html = topicCard(page, 'HTML');
    const typescript = topicCard(page, 'TypeScript');
    await html.focus();
    await page.keyboard.press('ArrowRight'); // CSS
    await page.keyboard.press('ArrowRight'); // JavaScript
    await page.keyboard.press('ArrowRight'); // inspect locked TypeScript
    await expect(typescript).toBeFocused();
    await expect(typescript).toHaveAttribute('aria-disabled', 'true');
    await expect(typescript).toHaveAccessibleDescription(/Pass 5 levels in each prerequisite topic to open TypeScript: JavaScript/);
    const addressBeforeInspection = page.url();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(addressBeforeInspection);
    await expect(topicCard(page, 'JavaScript')).toHaveAttribute('aria-checked', 'true');
    expect(opened).toEqual([]);
  });

  test('keyboard inspection explains an exact locked level without opening it', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest', { progress: {} });
    const opened: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname === '/api/quiz/roadmap' && (url.searchParams.has('level') || url.searchParams.has('test'))) opened.push(url.href);
    });
    await page.goto('/learn/web-developer?topic=html');
    const level = page.getByRole('button', { name: 'Level 2: Links, Buttons & Interaction, Locked', exact: true });
    await level.focus();
    await expect(level).toHaveAccessibleDescription('Level 2: Links, Buttons & Interaction. Pass Level 1: Structure & Semantics to open this level.');
    await page.keyboard.press('Enter');
    await expect(page.locator('.rm-overview-card')).toBeVisible();
    expect(opened).toEqual([]);
  });

  for (const part of [1, 3]) {
    test(`the overview opens part test ${part} after its levels, including the final test`, async ({ page }) => {
      await prepare(page);
      const count = part === 1 ? 2 : 6;
      await stand(page, 'guest', { progress: {
        html: {
          levels: Object.fromEntries(Array.from({ length: count }, (_, index) => [index + 1, { passed: true, bestPct: 100 }])),
          checkpoints: part === 1 ? {} : { 1: { passed: true, bestPct: 100 }, 2: { passed: true, bestPct: 100 } },
        },
      } });
      const requests: string[] = [];
      await page.route('**/api/quiz/roadmap?topic=html&test=*', (route) => {
        requests.push(route.request().url());
        return route.fulfill({ json: {
          kind: 'checkpoint', topic: 'html', ref: part, title: `Part ${part} Test`, passPct: 85,
          sessionId: 'checkpoint-fixture', questions: [{ id: 'checkpoint-question', category: 'html', difficulty: 1,
            question: 'Which element is a button?', options: ['button', 'div'], introduction: '', tags: [] }],
        } });
      });
      await page.goto('/learn/web-developer?topic=html');
      const overview = page.locator('.rm-overview-card');
      await expect(overview).toContainText(`Part ${part} Test`);
      await overview.getByRole('button', { name: 'Take the part test' }).click();
      await expect(page.getByRole('heading', { name: `Part test · Part ${part}`, exact: true })).toBeVisible();
      await expect(page.getByText('Which element is a button?', { exact: true })).toBeVisible();
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]).searchParams.get('test')).toBe(String(part));
    });
  }

  test('resolve /learn, deep links, unknown sections and this device’s last section', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest');
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn\/web-developer$/);
    await expect(switcherItem(page, 'Web Developer')).toHaveAttribute('aria-checked', 'true');

    await page.goto('/learn?topic=dsa');
    await expect(page).toHaveURL(/\/learn\/software-engineer\?topic=dsa$/);
    await expect(topicCard(page, 'DSA Foundations')).toHaveAttribute('aria-checked', 'true');

    await page.goto('/learn?topic=react&part=1');
    await expect(page).toHaveURL(/\/learn\/web-developer\?topic=react&part=1$/);

    await page.goto('/learn/software-engineer?topic=react');
    await expect(page).toHaveURL(/\/learn\/web-developer\?topic=react$/);

    await page.goto('/learn/nope');
    await expect(page).toHaveURL(/\/learn\/web-developer$/);

    await page.goto('/learn/big-o');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Learn sections' })).toHaveCount(0);

    await page.goto('/learn/web-developer');
    await switcherItem(page, 'Software Engineer').click();
    await expect(page).toHaveURL(/\/learn\/software-engineer$/);
    await page.goto('/learn');
    await expect(page).toHaveURL(/\/learn\/software-engineer$/);
  });

  test('the Learn nav link on a section adds no history entry', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await prepare(page);
    await stand(page, 'guest');
    await page.goto('/learn/software-engineer');
    await expect(switcherItem(page, 'Software Engineer')).toHaveAttribute('aria-checked', 'true');
    const before = await page.evaluate(() => history.length);
    await page.locator('nav.ss-nav-center').getByRole('link', { name: 'Learn', exact: true }).click();
    await expect(page).toHaveURL(/\/learn\/software-engineer$/);
    await expect(switcherItem(page, 'Software Engineer')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => history.length)).toBe(before);
  });

  test('the switcher browses with arrows and opens with Enter or Space, keeping focus', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await prepare(page);
    await stand(page, 'guest');
    await page.goto('/learn/web-developer');
    await expect(topicCard(page, 'HTML')).toBeVisible();
    await switcherItem(page, 'Web Developer').focus();

    await page.keyboard.press('ArrowRight');
    await expect(switcherItem(page, 'Software Engineer')).toBeFocused();
    await expect(page).toHaveURL(/\/learn\/web-developer$/);
    await expect(topicCard(page, 'HTML')).toBeVisible();
    // Browsing moves focus only: the open section stays the checked one.
    await expect(switcherItem(page, 'Web Developer')).toHaveAttribute('aria-checked', 'true');
    await expect(switcherItem(page, 'Software Engineer')).toHaveAttribute('aria-checked', 'false');
    await expect(switcherItem(page, 'Software Engineer')).toHaveAccessibleDescription(/Enter or Space to open/);

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/learn\/software-engineer$/);
    await expect(topicCard(page, 'Algorithms')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(switcherItem(page, 'Software Engineer')).toBeFocused();
    const outline = await switcherItem(page, 'Software Engineer').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/\/learn\/forward-deployed-engineer$/);

    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/learn\/web-developer$/);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    await expect(switcherItem(page, 'Web Developer')).toHaveAttribute('aria-checked', 'true');
    await expect(switcherItem(page, 'Software Engineer')).toHaveAttribute('aria-checked', 'false');
    await expect(page).toHaveURL(/\/learn\/web-developer$/);
  });
});

test.describe('A Frontend learner and Software Engineer', () => {
  test('sees the section dimmed with one join action, and joins after a failed save', async ({ page }) => {
    await prepare(page);
    const state = await stand(page, 'frontend', { failFirstPut: true });
    await page.goto('/learn/software-engineer');
    for (const name of ['Algorithms', 'System Design', 'DevOps & Cloud', 'Security', 'Databases']) {
      await expect(topicCard(page, name)).toBeDisabled();
      await expect(topicCard(page, name)).toHaveAccessibleName(/not in your plan/);
    }
    for (const name of ['Git', 'General', 'DSA Foundations']) {
      await expect(topicCard(page, name)).not.toHaveAccessibleName(/not in your plan/);
    }
    const join = page.getByRole('button', { name: 'Add it to your plan' });
    await expect(join).toHaveCount(1);
    // A card shows the logo, the topic name and its levels; no "Also in" line.
    for (const name of ['Git', 'Databases', 'General']) {
      await expect(topicCard(page, name)).not.toContainText('Also in');
      await expect(topicCard(page, name)).not.toHaveAccessibleName(/also in/i);
    }

    await join.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Software Engineer was not added to your plan. Try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
    await expect(topicCard(page, 'Algorithms')).toHaveAccessibleName(/not in your plan/);

    await page.keyboard.press('Enter');
    await expect(page.getByText(/Software Engineer is in your plan\./)).toBeVisible();
    await expect(page.getByText(/Software Engineer is in your plan\./)).toBeFocused();
    expect(state.puts.at(-1)).toMatchObject({ baseTrack: 'frontend', specialization: null, sections: ['software-engineer'] });
    await expect(page.getByRole('button', { name: 'Add it to your plan' })).toHaveCount(0);
    for (const name of ['Algorithms', 'Security', 'DSA Foundations']) await expect(topicCard(page, name)).toBeEnabled();
    for (const name of ['System Design', 'DevOps & Cloud', 'Databases']) await expect(topicCard(page, name)).toHaveAccessibleName(/Locked/);

    await switcherItem(page, 'Web Developer').click();
    await expect(topicCard(page, 'Node.js')).toBeVisible();
  });

  test('a shared topic shows the same progress figure in both sections', async ({ page }) => {
    await prepare(page);
    await stand(page, 'frontend');
    await page.goto('/learn/web-developer');
    const onWeb = (await topicCard(page, 'Git').locator('.rm-topic-progress').textContent()) ?? '';
    await switcherItem(page, 'Software Engineer').click();
    await expect(page).toHaveURL(/\/learn\/software-engineer$/);
    await expect(topicCard(page, 'Git').locator('.rm-topic-progress')).toHaveText(onWeb);
    expect(onWeb).toMatch(/^Premium1 \/ \d+ levels$/);
  });
});

test.describe('Learn section states', () => {
  test('a visitor previews every topic and is asked to sign in', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest');
    await page.goto('/learn/software-engineer');
    await expect(topicCard(page, 'Algorithms')).toBeVisible();
    await expect(page.getByRole('radio', { name: /not in your plan/ })).toHaveCount(0);
    await expect(page.getByText(/this progress stays on this device only/)).toBeVisible();
    await page.getByRole('button', { name: 'Sign in to add it to your plan' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('a structure error keeps the switcher and retries', async ({ page }) => {
    await prepare(page);
    const state = await stand(page, 'guest', { failStructure: true });
    await page.goto('/learn/web-developer');
    await expect(page.getByRole('alert').filter({ hasText: 'Server error. Try again in a moment.' })).toBeVisible({ timeout: 15_000 });
    await expect(switcherItem(page, 'Software Engineer')).toBeVisible();
    // The level counts come with the structure: no "n / 0 levels" meanwhile.
    await expect(topicCard(page, 'HTML')).toBeVisible();
    await expect(page.getByText(/\/ 0 levels/)).toHaveCount(0);
    state.failStructure = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.rm-node').first()).toBeVisible();
  });

  test('offline disables the join and still switches sections', async ({ page, context }) => {
    await prepare(page);
    await stand(page, 'frontend');
    await page.goto('/learn/software-engineer');
    await expect(page.getByRole('button', { name: 'Add it to your plan' })).toBeEnabled();
    await context.setOffline(true);
    await expect(page.getByRole('button', { name: 'Add it to your plan' })).toBeDisabled();
    await expect(page.getByText('You’re offline. Add it when the connection returns.')).toBeVisible();
    await switcherItem(page, 'Software Engineer').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/learn\/web-developer$/);
    await context.setOffline(false);
  });

  test('a free account joins the FDE taster while other Premium topics stay gated', async ({ page }) => {
    await prepare(page);
    const state = await stand(page, 'frontend', { catalogEnabled: true });
    await page.goto('/learn/forward-deployed-engineer');
    const start = page.getByRole('button', { name: 'Start the FDE path' });
    await expect(start).toBeVisible();
    await expect(page.locator('.rm-section-action .ss-premium-label')).toHaveCount(0);
    await start.click();
    await expect.poll(() => state.puts.length).toBe(1);
    expect(state.enrollmentPosts).toHaveLength(1);
    expect(state.enrollmentPosts[0]).toMatchObject({ pathId: 'fde', action: 'enroll' });
    expect(state.puts[0]).toMatchObject({ specialization: 'fde' });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/learn/web-developer');
    await expect(topicCard(page, 'TypeScript').locator('.rm-topic-progress')).toContainText('Premium');
  });

  test('a joined section with nothing open names the prerequisite and keeps the skill check', async ({ page }) => {
    await prepare(page);
    await stand(page, 'se-member', { progress: {} });
    await page.goto('/learn/software-engineer');
    await expect(page.getByText(/^Pass 5 levels of JavaScript to open /)).toBeVisible();
    // The skill check sits in the empty state's one row of next steps (UX
    // audit learn-09), beside 'Go to', and the separate row is not drawn.
    const steps = page.locator('.rm-section-empty__actions');
    await expect(steps.getByRole('button', { name: 'Take the skill check' })).toBeVisible();
    await expect(steps.getByRole('button', { name: 'Go to JavaScript' })).toBeVisible();
    await expect(page.locator('.rm-skillcheck-row')).toHaveCount(0);
    await page.getByRole('button', { name: 'Go to JavaScript' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/learn\/web-developer\?topic=javascript$/);
    await expect(topicCard(page, 'JavaScript')).toHaveAttribute('aria-checked', 'true');
    await expect(topicCard(page, 'JavaScript')).toBeFocused();
  });

  test('a signed-in account with no plan is sent to choose one', async ({ page }) => {
    await prepare(page);
    await stand(page, 'no-plan');
    await page.goto('/learn/software-engineer');
    await expect(page.getByRole('link', { name: 'Choose your plan' })).toHaveAttribute('href', '/profile#learning-plan');
    await expect(page.getByRole('radio', { name: /not in your plan/ })).toHaveCount(0);

    // On a phone the plan card sits below the fold: the link scrolls it in,
    // clear of the fixed header, and focuses it.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/user/stats**', (route) => route.fulfill({ json: { data: { user_id: 'user-1', total_quizzes: 0, total_correct: 0, total_questions: 0, current_streak: 0, longest_streak: 0, created_at: '2026-10-01', updated_at: '2026-10-01' } } }));
    await page.getByRole('link', { name: 'Choose your plan' }).click();
    await expect(page).toHaveURL(/\/profile#learning-plan$/);
    await expect(page.locator('#learning-plan')).toBeFocused({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await expect(page.locator('#learning-plan')).toBeFocused();
    const headerBottom = await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().bottom);
    const cardTop = await page.locator('#learning-plan').evaluate((el) => el.getBoundingClientRect().top);
    expect(cardTop).toBeGreaterThanOrEqual(headerBottom);
    expect(cardTop).toBeLessThan(844);
  });
});

test.describe('Learn sections across widths and themes', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`software engineer, ${theme}: no overflow, the open section in view, and no axe violation`, async ({ page }) => {
      await prepare(page, { theme });
      await stand(page, 'frontend');
      for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/learn/software-engineer');
        await expect(topicCard(page, 'Algorithms')).toBeVisible();
        await expect(page.locator('.rm-node').first()).toBeVisible();
        // The route box fades in; axe reads colours mid-fade as lower contrast.
        await page.waitForFunction(() => document.getAnimations()
          .every((one) => one.playState !== 'running' || one.effect?.getComputedTiming().endTime === Infinity));
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(fits, `no horizontal page scroll at ${width}px`).toBe(true);
        const inView = await page.evaluate(() => {
          const scroller = document.querySelector('.rm-section-switcher__scroll')!.getBoundingClientRect();
          const item = document.querySelector('.rm-section-switcher [role="radio"][aria-checked="true"]')!.getBoundingClientRect();
          return item.left >= scroller.left - 1 && item.right <= scroller.right + 1;
        });
        expect(inView, `the open section is in view at ${width}px`).toBe(true);
        const results = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(results.violations.map((one) => `${one.id}: ${one.nodes.map((node) => node.target.join(' ')).join(', ')}`), `${theme} ${width}px`).toEqual([]);
      }
    });
  }

  test('reduced motion turns off the section transition', async ({ page }) => {
    await prepare(page, { motion: 'reduce' });
    await stand(page, 'guest');
    await page.goto('/learn/web-developer');
    await expect(page.locator('.rm-section-body')).toBeVisible();
    expect(await page.locator('.rm-section-body').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    const durations = await page.locator('.rm-section-switcher .astryx-segmented-control-item').evaluateAll((items) => items.map((el) => getComputedStyle(el).transitionDuration));
    expect(durations.length).toBe(3);
    for (const duration of durations) expect(duration).toBe('0s');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await page.locator('.rm-section-body').evaluate((el) => getComputedStyle(el).animationName)).toBe('rmTrackIn');
  });
});

test.describe('The switcher on a narrow screen', () => {
  // Under 640px the three sections are a vertical list (UX audit learn-20):
  // all three show without scrolling, and Up and Down browse as Left and
  // Right do, moving focus only.
  for (const width of [360, 390]) {
    test(`lists all three sections as full-width 44px rows at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await prepare(page);
      await stand(page, 'guest');
      await page.goto('/learn/web-developer');
      await expect(topicCard(page, 'HTML')).toBeVisible();
      const scroller = page.locator('.rm-section-switcher__scroll');
      expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const box = (await scroller.boundingBox())!;
      const rows = await page.locator('.rm-section-switcher [role="radio"]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map(({ left, right, top, height }) => ({ left, right, top, height })));
      expect(rows).toHaveLength(3);
      for (const [index, row] of rows.entries()) {
        expect(row.height, `row ${index} height`).toBeGreaterThanOrEqual(44);
        expect(row.left, `row ${index} left`).toBeGreaterThanOrEqual(box.x - 1);
        expect(row.right, `row ${index} right`).toBeLessThanOrEqual(box.x + box.width + 1);
        if (index > 0) expect(row.top, `row ${index} below row ${index - 1}`).toBeGreaterThan(rows[index - 1].top);
      }
      await expect(switcherItem(page, 'Forward Deployed Engineer')).toBeInViewport();

      await switcherItem(page, 'Web Developer').focus();
      await page.keyboard.press('ArrowDown');
      await expect(switcherItem(page, 'Software Engineer')).toBeFocused();
      await expect(switcherItem(page, 'Web Developer')).toHaveAttribute('aria-checked', 'true');
      await expect(page).toHaveURL(/\/learn\/web-developer$/);
      await page.keyboard.press('ArrowDown');
      await expect(switcherItem(page, 'Forward Deployed Engineer')).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/learn\/software-engineer$/);
      await page.keyboard.press('ArrowUp');
      await expect(switcherItem(page, 'Web Developer')).toBeFocused();
    });
  }
});

test.describe('Learn section targets on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('every switcher item, action and topic card is at least 44px', async ({ page }) => {
    const measure = async (selector: string) => {
      const boxes = await page.locator(selector).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map(({ width, height }) => ({ width, height })));
      expect(boxes.length, selector).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.height, `${selector} height`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${selector} width`).toBeGreaterThanOrEqual(44);
      }
    };
    await prepare(page);
    await stand(page, 'frontend');
    await page.goto('/learn/software-engineer');
    await expect(page.getByRole('button', { name: 'Add it to your plan' })).toBeVisible();
    await measure('.rm-section-switcher .astryx-segmented-control-item');
    await measure('.rm-section-action button');
    await measure('.rm-topic-pill');

    await page.context().clearCookies();
    const empty = await page.context().newPage();
    await prepare(empty);
    await stand(empty, 'se-member', { progress: {} });
    await empty.goto('/learn/software-engineer');
    const go = empty.getByRole('button', { name: 'Go to JavaScript' });
    await expect(go).toBeVisible();
    const box = (await go.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await empty.close();
  });
});


test.describe('FDE routes and Career sections', () => {
  test('keeps the module, activity query and fragment on an old FDE link', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest');
    await page.goto('/roadmap/specializations/fde/fde-v1-m01?activity=fde-v1-m01-l1-read#lesson');
    await expect(page).toHaveURL(/\/learn\/forward-deployed-engineer\/path\/fde-v1-m01\?activity=fde-v1-m01-l1-read#lesson$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  // E5 (#496) retired the standalone DSA path. Its overview and module links
  // land on DSA Foundations in the Software Engineer section, where its
  // readings and Coding tasks live; vercel.json answers crawlers with a 308.
  test('lands an old DSA path link on DSA Foundations in Learn', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest');
    for (const old of ['/roadmap/paths/dsa-foundations', '/roadmap/paths/dsa-foundations/dsa-v1-d04?activity=dsa-v1-d04-l1-read']) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/learn\/software-engineer\?topic=dsa$/);
      await expect(topicCard(page, 'DSA Foundations')).toHaveAttribute('aria-checked', 'true');
    }
  });

  test('links each Career group into Learn and shows the FDE path on its section shelf', async ({ page }) => {
    await prepare(page);
    await stand(page, 'guest', { catalogEnabled: true });
    await page.goto('/roadmap');
    for (const [id, name] of [['web-developer', 'Web Developer'], ['software-engineer', 'Software Engineer'], ['forward-deployed-engineer', 'Forward Deployed Engineer']]) {
      const heading = page.getByRole('heading', { name, exact: true });
      await expect(heading.getByRole('link')).toHaveAttribute('href', `/learn/${id}`);
    }
    await expect(page.locator('.lp-module')).toHaveCount(0);
    await page.getByRole('heading', { name: 'Forward Deployed Engineer', exact: true }).getByRole('link').click();
    await expect(page).toHaveURL(/\/learn\/forward-deployed-engineer$/);
    const shelf = page.getByRole('region', { name: 'Learning paths' });
    await expect(shelf.getByRole('link', { name: 'Forward Deployed Engineer' })).toHaveAttribute('href', '/learn/forward-deployed-engineer/path');
  });
});
