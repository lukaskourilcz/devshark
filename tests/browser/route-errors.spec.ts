import { test, expect, allowConsoleErrors, type Page } from './console-clean';
import { CODING_TASKS, playable } from '../../lib/coding/catalog';
import { localAuth, storeFakeSession } from './fake-session';
import { fulfilTaskRead, isTaskRead } from './coding-task-read';

// A page whose code does not load used to replace the whole app with the root
// error screen: on devshark.app a dropped request for one chunk took the
// header, the nav and the footer with it. The route error boundary keeps the
// shell, and Try again gets the page back. Chromium before 156 remembers a
// failed module fetch for the life of the document, so there the retry
// reloads the address; a browser that forgets it draws the page in place.
// Each test says which of the two happened.

const CODING_PAGE = /\/assets\/CodingSection-[\w-]+\.js$/;
// A chunk the Coding page imports and the landing page does not load.
const CODING_DEPENDENCY = /\/assets\/coding-catalog-[\w-]+\.js$/;
const CODING_LINK = 'nav.ss-nav-center a[href="/coding"]';

// What the console shows when a test drops a chunk on purpose. The route and
// part boundaries catch the failed import, and React logs each error a
// boundary caught (React 19's default onCaughtError). A chunk the Coding page
// imports fails the page's own import, so that message names CodingSection.
// Offline, the page's stylesheet fails first in Vite's preload helper.
// Chromium logs a module answered with index.html itself. Each test allows
// only the lines of the chunk it drops (console-clean.ts).
const importFailed = (chunk: string) => new RegExp(`^TypeError: Failed to fetch dynamically imported module: \\S+/assets/${chunk}-[\\w-]+\\.js`);
const CSS_PRELOAD_FAILED = /^Error: Unable to preload CSS for \/assets\/[\w-]+\.css/;
const HTML_FOR_MODULE = /^Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text\/html"/;

async function prepare(page: Page, reducedMotion: 'reduce' | 'no-preference' = 'reduce') {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion, colorScheme: 'light' });
  await page.addInitScript(() => {
    try { localStorage.setItem('devquiz:color-mode', 'light'); } catch { /* private mode */ }
  });
  // The API answers at once and says little, as in navigation.spec.ts.
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/quiz/roadmap' && !url.search) return route.fulfill({ json: { topics: [], structure: {} } });
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
  });
  // Every document the tab loads: a second one is a reload.
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return { documents };
}

/** Drop every request for the matching chunk while `failing` is set. */
async function dropChunk(page: Page, pattern: RegExp) {
  const chunk = { failing: true, dropped: 0, served: 0 };
  await page.route(pattern, (route) => {
    if (chunk.failing) {
      chunk.dropped += 1;
      return route.abort('failed');
    }
    chunk.served += 1;
    return route.continue();
  });
  return chunk;
}

// Pages have alert regions of their own (the quiz's form message), so the
// panel is the alert that says what happened.
const panelOf = (page: Page) => page.locator('#main-content').getByRole('alert').filter({ hasText: 'Something went wrong' });
const codingHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Coding challenges' });

async function expectShell(page: Page) {
  await expect(page.locator('header.ss-header')).toBeVisible();
  await expect(page.locator('nav.ss-nav-center')).toBeVisible();
  await expect(page.locator('footer.ss-brand-footer')).toBeVisible();
}

for (const { name, pattern } of [
  { name: 'the Coding page chunk', pattern: CODING_PAGE },
  { name: 'a chunk the Coding page imports', pattern: CODING_DEPENDENCY },
]) {
  test(`${name} fails to load: the shell stays, the nav still works, Try again brings the page back`, async ({ page }) => {
    const { documents } = await prepare(page);
    const chunk = await dropChunk(page, pattern);
    allowConsoleErrors(page, importFailed('CodingSection'));

    await page.locator(CODING_LINK).click();
    const panel = panelOf(page);
    await expect(panel).toContainText('Something went wrong');
    await expect(panel).toContainText('Network error. Check your connection and try again.');
    expect(chunk.dropped).toBeGreaterThan(0);
    await expectShell(page);
    await expect(page).toHaveURL(/\/coding$/);
    await expect(page.locator(CODING_LINK)).toHaveAttribute('aria-current', 'page');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(documents).toHaveLength(1);

    // Another page opens without a retry: each path gets a fresh boundary.
    await page.locator('nav.ss-nav-center a[href="/quiz"]').click();
    await expect(page).toHaveURL(/\/quiz$/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Back on Coding with the chunk still failing, then the connection returns.
    await page.locator(CODING_LINK).click();
    await expect(panel).toContainText('Something went wrong');
    chunk.failing = false;
    await panel.getByRole('button', { name: 'Try again' }).click();
    await expect(codingHeading(page)).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expectShell(page);
    // The retry asked the network again for the chunk.
    expect(chunk.served).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'recovery', description: documents.length > 1 ? 'reloaded the address' : 'drew the page in place' });
  });
}

test('the Coding workbench that fails to load comes back through the task screen’s own Try again', async ({ page }) => {
  const { documents } = await prepare(page);
  // The task itself answers; its editor, the workbench chunk, is dropped.
  const TASK = 'js-double-numbers';
  await page.route((url) => url.pathname === '/api/quiz/roadmap' && isTaskRead(url.searchParams.get('resource')), (route) => {
    const task = CODING_TASKS.find((one) => one.id === TASK);
    if (!task) throw new Error(`no coding task ${TASK}`);
    return fulfilTaskRead(route, { task: playable(task), session: task.id, locked: null, progress: null, draft: null, signedIn: false });
  });
  const workbench = await dropChunk(page, /\/assets\/CodingWorkbench-[\w-]+\.js$/);

  await page.goto(`/coding/javascript/${TASK}`);
  const failure = page.getByText('Could not load this task.');
  await expect(failure).toBeVisible();
  expect(workbench.dropped).toBeGreaterThan(0);
  await expectShell(page);

  // The connection is back. Chromium before 156 answers the next import from
  // memory, so the press reloads the task's address; a browser that forgets
  // the failure draws the workbench in place.
  workbench.failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(workbench.served).toBeGreaterThan(0);
  await expect(page).toHaveURL(new RegExp(`/coding/javascript/${TASK}$`));
  test.info().annotations.push({ type: 'recovery', description: documents.length > 2 ? 'reloaded the address' : 'drew the workbench in place' });
});

test('the account widget’s code fails to load: the header keeps a retry in its place and its height, and the press brings it back', async ({ page }) => {
  // The header asks for the widget as the first page loads, for a session
  // only: a signed-out visitor gets SignInButton, which ships with the shell.
  await localAuth(page);
  await storeFakeSession(page);
  const account = await dropChunk(page, /\/assets\/AuthButton-[\w-]+\.js$/);
  allowConsoleErrors(page, importFailed('AuthButton'));
  const { documents } = await prepare(page);
  const retry = page.getByRole('button', { name: 'Account did not load. Try again' });
  await expect(retry).toBeVisible();
  await expect(retry).toHaveText('Try again');
  await expectShell(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong' })).toHaveCount(0);
  expect(account.dropped).toBeGreaterThan(0);
  const header = page.locator('header.ss-header');
  const failedHeight = await header.evaluate((node) => node.getBoundingClientRect().height);
  // Nothing reloads without a press.
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(1);

  account.failing = false;
  await retry.click();
  await expect(page.getByRole('button', { name: 'Account menu for Test' })).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(account.served).toBeGreaterThan(0);
  // The retry stood in the widget's 56px row, so the header kept its height.
  expect(await header.evaluate((node) => node.getBoundingClientRect().height)).toBe(failedHeight);
  test.info().annotations.push({ type: 'recovery', description: documents.length > 1 ? 'reloaded the address' : 'drew the widget in place' });
});

test('the upgrade sheet’s code fails to load: the sheet closes with a message, and the page stays', async ({ page }) => {
  const { documents } = await prepare(page);
  // The server refuses the task with 402, which opens the upgrade sheet.
  const TASK = 'js-double-numbers';
  await page.route((url) => url.pathname === '/api/quiz/roadmap' && isTaskRead(url.searchParams.get('resource')), (route) => route.fulfill({
    status: 402,
    json: { error: { code: 'premium_required', message: 'Premium opens this', kind: 'coding-task', ref: TASK } },
  }));
  const sheet = await dropChunk(page, /\/assets\/UpgradeSheet-[\w-]+\.js$/);
  allowConsoleErrors(page, importFailed('UpgradeSheet'));

  await page.goto(`/coding/javascript/${TASK}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Network error. Check your connection and try again.' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'This challenge is part of Premium' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectShell(page);
  expect(sheet.dropped).toBeGreaterThan(0);
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(2);
});

test('a second press for the upgrade sheet after its code failed asks the network again', async ({ page }) => {
  const { documents } = await prepare(page);
  const TASK = 'js-double-numbers';
  await page.route((url) => url.pathname === '/api/quiz/roadmap' && isTaskRead(url.searchParams.get('resource')), (route) => route.fulfill({
    status: 402,
    json: { error: { code: 'premium_required', message: 'Premium opens this', kind: 'coding-task', ref: TASK } },
  }));
  const sheet = await dropChunk(page, /\/assets\/UpgradeSheet-[\w-]+\.js$/);
  allowConsoleErrors(page, importFailed('UpgradeSheet'));

  // The 402 opens the sheet, its code fails, and the page says why.
  await page.goto(`/coding/javascript/${TASK}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Network error. Check your connection and try again.' })).toBeVisible();
  expect(sheet.dropped).toBeGreaterThan(0);
  const before = documents.length;

  // The connection is back and the learner presses. Chromium before 156
  // answers the import from memory, so the press reloads the address and the
  // next document opens the sheet; a browser that forgets the failure opens
  // it in place.
  sheet.failing = false;
  await page.getByRole('button', { name: 'See what Premium includes' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(sheet.served).toBeGreaterThan(0);
  await expect(page).toHaveURL(new RegExp(`/coding/javascript/${TASK}$`));
  await expectShell(page);
  test.info().annotations.push({ type: 'recovery', description: documents.length > before ? 'reloaded the address, and the next document opened the sheet' : 'opened the sheet in place' });
});

test('the friends tab’s code fails to load: the profile stays, and Retry brings the tab back', async ({ page }) => {
  await localAuth(page);
  await storeFakeSession(page);
  const { documents } = await prepare(page);
  // A learner with no stats yet; every other read answers 503.
  await page.route((url) => url.pathname === '/api/user/stats', (route) => route.fulfill({ json: { data: null } }));
  const friends = await dropChunk(page, /\/assets\/FriendsPanel-[\w-]+\.js$/);
  allowConsoleErrors(page, importFailed('FriendsPanel'));

  await page.goto('/profile');
  await page.getByRole('tab', { name: 'Friends' }).click();
  const failure = page.getByRole('alert').filter({ hasText: 'Your friends did not load.' });
  await expect(failure).toBeVisible();
  expect(friends.dropped).toBeGreaterThan(0);
  await expectShell(page);
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(panelOf(page)).toHaveCount(0);
  const before = documents.length;
  // Nothing reloads without a press.
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(before);

  friends.failing = false;
  await failure.getByRole('button', { name: 'Retry' }).click();
  // The API answers 503, so the panel says the tab is not available.
  const panel = page.getByText('Friends are not available yet on this deployment.');
  await expect.poll(async () => documents.length > before || await panel.isVisible()).toBe(true);
  // After a reload the profile opens on its first tab.
  if (documents.length > before) await page.getByRole('tab', { name: 'Friends' }).click();
  await expect(panel).toBeVisible();
  await expect(failure).toHaveCount(0);
  expect(friends.served).toBeGreaterThan(0);
  test.info().annotations.push({ type: 'recovery', description: documents.length > before ? 'reloaded the address' : 'drew the tab in place' });
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`Motion’s animation chunk fails to load (${reducedMotion} motion): the page still shows, before and after a navigation`, async ({ page }) => {
  const motion = await dropChunk(page, /\/assets\/motion-features-[\w-]+\.js$/);
  const { documents } = await prepare(page, reducedMotion);
  const routeBox = page.locator('.ss-route');
  const opacity = () => routeBox.evaluate((node) => getComputedStyle(node).opacity);

  // With reduced motion the page never asks for the chunk (perf baseline #587
  // C18, lib/motion.tsx motionFeaturesFor) and draws as a failed load does.
  if (reducedMotion === 'reduce') expect(motion.dropped).toBe(0);
  else expect(motion.dropped).toBeGreaterThan(0);
  await expect.poll(opacity).toBe('1');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'off');
  await expectShell(page);

  await page.locator('nav.ss-nav-center a[href="/quiz"]').click();
  await expect(page).toHaveURL(/\/quiz$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect.poll(opacity).toBe('1');
  // Poll like the opacity: right after the navigation the keyed route box is
  // being replaced, and a read in that tick found the outgoing node.
  await expect.poll(() => routeBox.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  // Nothing reloads for it.
  expect(documents).toHaveLength(1);
  // Nor does a navigation ask for it with reduced motion.
  if (reducedMotion === 'reduce') expect(motion.dropped + motion.served).toBe(0);
});

test('a preload that fails on hover neither reloads nor shows an error', async ({ page }) => {
  const { documents } = await prepare(page);
  const chunk = await dropChunk(page, CODING_PAGE);
  await page.evaluate(() => {
    const counter = window as unknown as { __preloadErrors: number };
    counter.__preloadErrors = 0;
    window.addEventListener('vite:preloadError', () => { counter.__preloadErrors += 1; });
  });

  // A resting pointer starts the page's import (lib/routePreload.ts).
  await page.locator(CODING_LINK).hover();
  await expect.poll(() => chunk.dropped).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __preloadErrors: number }).__preloadErrors)).toBeGreaterThan(0);
  // Vite announced the failure; nothing may act on it. Give a reload time to start.
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(1);
  await expect(page).toHaveURL(/\/$/);
  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('a supabase-js download that fails on a sign-in click neither reloads nor reaches the route boundary', async ({ page }) => {
  // supabase-js is its own chunk, loaded on the click (lib/supabaseClient.ts);
  // two chunks start with "supabase-", and the library carries GoTrueClient.
  // The build needs a Supabase project configured, as CI's has.
  const { documents } = await prepare(page);
  let dropped = 0;
  await page.route(/\/assets\/supabase-[\w-]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('GoTrueClient')) {
      dropped += 1;
      return route.abort('failed');
    }
    return route.fulfill({ response, body });
  });
  // Anything that would leave for the sign-in provider stays local.
  await page.route('**/auth/v1/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Authorize</title>' }));

  const logIn = page.getByRole('button', { name: 'Sign in', exact: true }).first();
  await logIn.click();
  // "Sign in" opens the sign-in dialog; its Google press downloads supabase-js.
  // The press reports the failure itself, and nothing else happens. A second
  // press is lazy-auth.spec.ts's: it reloads where the browser remembers the
  // failed download.
  await page.getByRole('dialog').getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('We couldn’t reach the sign-in service.');
  expect(dropped).toBe(1);
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(1);
  await expect(page).toHaveURL(/\/$/);
  await expect(panelOf(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('offline: no reload, and the page comes back with the connection, without a press', async ({ page, context }) => {
  const { documents } = await prepare(page);
  await context.setOffline(true);
  allowConsoleErrors(page, CSS_PRELOAD_FAILED, importFailed('CodingSection'));
  await page.locator(CODING_LINK).click();
  const panel = panelOf(page);
  await expect(panel).toContainText('Network error');
  await expectShell(page);
  // A reload offline would swap the app for the browser's offline page.
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(1);

  await context.setOffline(false);
  await expect(codingHeading(page)).toBeVisible();
  await expect(panel).toHaveCount(0);
  test.info().annotations.push({ type: 'recovery', description: documents.length > 1 ? 'reloaded the address' : 'drew the page in place' });
});

// How a server answers the address of a chunk a deploy removed: devshark.app
// with a 404 that no cache keeps (vercel.json), `vite preview` with index.html,
// as devshark.app did before HARDEN.
const GONE = [
  { answer: 'a 404 that no cache keeps', fulfill: () => ({ status: 404, contentType: 'text/plain; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: 'The page could not be found\n\nNOT_FOUND\n' }), logs: [importFailed('CodingSection')] },
  { answer: 'index.html', fulfill: (index: string) => ({ status: 200, contentType: 'text/html; charset=utf-8', body: index }), logs: [importFailed('CodingSection'), HTML_FOR_MODULE] },
];

for (const { answer, fulfill, logs } of GONE) test(`a newer build on the server reloads once when the old chunk answers ${answer}; the loop guard then keeps the panel until Try again`, async ({ page }) => {
  const { documents } = await prepare(page);
  allowConsoleErrors(page, ...logs);
  const index = await (await page.request.get('/')).text();
  const entry = index.match(/\/assets\/main-[\w-]+\.js/)?.[0];
  expect(entry, 'the entry script in index.html').toBeTruthy();

  // A deploy replaced the build. The old Coding chunk is gone, and a fresh
  // index.html names another entry script.
  let deployed = true;
  await page.route(CODING_PAGE, (route) => (deployed
    ? route.fulfill(fulfill(index))
    : route.continue()));
  await page.route((url) => url.pathname === '/', (route) => (deployed && route.request().resourceType() === 'fetch'
    ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: index.replace(entry!, '/assets/main-NEWBUILD.js') })
    : route.continue()));

  await page.locator(CODING_LINK).click();
  // The first failure reloads at once. The reloaded page finds the chunk
  // still missing, and a second automatic reload within the minute is refused.
  const panel = panelOf(page);
  await expect(panel).toContainText('Something went wrong');
  expect(documents).toHaveLength(2);
  await expect(page).toHaveURL(/\/coding$/);
  await expectShell(page);
  await page.waitForTimeout(600);
  expect(documents).toHaveLength(2);

  // The learner's press reloads whatever the guard says.
  deployed = false;
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(codingHeading(page)).toBeVisible();
  expect(documents.length).toBeGreaterThanOrEqual(2);
});
