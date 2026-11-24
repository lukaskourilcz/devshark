import { test, expect, type ConsoleMessage, type Page } from './console-clean';
import { readFileSync } from 'node:fs';
import { CODING_TASKS, playable } from '../../lib/coding/catalog';
import { solutionFor } from '../../lib/coding/solutions';
import { suiteCaseCount } from '../../lib/coding/react-hidden';
import { fulfilTaskRead, isTaskRead } from './coding-task-read';
import { localAuth, storeFakeSession, userWith } from './fake-session';

// The app under the Content-Security-Policy that vercel.json ships. vite
// preview sends none of vercel.json's headers, so run this spec against
// docker/server.mjs, which serves client/dist with them:
//
//   node docker/build-handlers.mjs
//   PORT=4220 CSP_CONNECT_EXTRA=https://exampleprojectref123.supabase.co node docker/server.mjs &
//   TEST_BASE_URL=http://127.0.0.1:4220 npm run test:browser -- tests/browser/csp.spec.ts
//
// CSP_CONNECT_EXTRA lets the placeholder Supabase project of the CI build
// (docs/quality/bundle-budget.json) through connect-src. Against a server
// that sends no policy, every test skips and says so.
//
// A test fails on any violation: a securitypolicyviolation event in any frame
// of the page (the sandbox frame and Stripe's included), or the console's
// report of one. The console is the only witness inside the Run worker, where
// a violation fires on the worker scope and no document listener sees it.
// Each Run must also show a result, because a blocked worker import fails
// without a violation reaching the page. Those checks are soft, so a failing
// test also lists the violations behind it.

const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
const NO_POLICY = 'The server sends no Content-Security-Policy on /. vite preview sends none of vercel.json\'s headers; run this spec against docker/server.mjs as the comment at the top of tests/browser/csp.spec.ts shows.';
let policy: string | undefined;

test.beforeAll(async ({ request }) => {
  policy = (await request.get('/')).headers()['content-security-policy'];
});

test.beforeEach(() => {
  test.skip(!policy, NO_POLICY);
});

/** Records every policy violation the page and its workers report. */
async function watchPolicy(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeBinding('__reportCspViolation', ({ frame }, line: string) => {
    seen.push(`${frame.url()}: ${line}`);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as { __reportCspViolation(line: string): void }).__reportCspViolation;
      report(`${event.disposition} ${event.effectiveDirective} blocked ${event.blockedURI || 'inline'} at ${event.sourceFile}:${event.lineNumber} ${event.sample}`);
    }, true);
  });
  const fromConsole = (message: ConsoleMessage) => {
    if (/Content.Security.Policy/i.test(message.text())) seen.push(`console ${message.location().url}: ${message.text()}`);
  };
  page.on('console', fromConsole);
  page.on('worker', (worker) => worker.on('console', fromConsole));
  return seen;
}

/** Light theme, analytics refused unless `consent` is false, the app's API
 * answered here, and every other host refused, so nothing leaves the
 * machine. A test routes a host it needs after this call; the later route
 * wins. */
async function prepare(page: Page, baseURL: string | undefined, { consent = true } = {}) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript((consent) => {
    try {
      localStorage.setItem('devquiz:color-mode', 'light');
      if (consent) localStorage.setItem('devshark:consent', JSON.stringify({ version: 2, analytics: false, marketing: false, decidedAt: Date.now() }));
    } catch { /* private mode */ }
  }, consent);
  const origin = new URL(baseURL!).origin;
  await page.route((url) => url.origin !== origin, (route) => route.abort());
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const resource = url.searchParams.get('resource');
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (isTaskRead(resource)) {
      const task = CODING_TASKS.find((one) => one.id === url.searchParams.get('id'))!;
      return fulfilTaskRead(route, { task: playable(task), session: task.id, locked: null, progress: null, draft: null, signedIn: false });
    }
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
  });
}

/** Loads a route, waits for its heading, and scrolls to the end so lazy
 * images and chunks load too. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForLoadState('networkidle');
}

test('public pages, the cookie settings and the sign-in dialog run without a violation', async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  const seen = await watchPolicy(page);
  await prepare(page, baseURL, { consent: false });
  await localAuth(page);
  await visit(page, '/');
  const banner = page.getByRole('region', { name: 'Cookies on devShark' });
  await banner.getByRole('button', { name: 'Choose', exact: true }).click();
  const settingsDialog = page.getByRole('dialog', { name: 'Cookie settings' });
  await expect(settingsDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await banner.getByRole('button', { name: 'Reject all', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  const signIn = page.getByRole('dialog');
  await expect(signIn.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (const path of ['/learn/web-developer', '/premium', '/topics/javascript-closures', '/daily']) await visit(page, path);
  expect(seen).toEqual([]);
});

const announced = (page: Page) => page.locator('.cd-workbench > [role="status"]');

async function openTask(page: Page, path: string, source: string) {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#main-content')).toBeFocused();
  const editor = page.locator('.cm-content');
  await editor.focus();
  await expect(page.locator('.cm-editor')).toHaveClass(/\bcm-focused\b/);
  await editor.fill(source);
}

test('Run reaches a result for JavaScript, TypeScript and React under the deployed policy', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  const seen = await watchPolicy(page);
  await prepare(page, baseURL);
  const run = page.getByRole('button', { name: 'Run', exact: true });

  for (const [track, id] of [['javascript', 'js-double-numbers'], ['typescript', 'ts-typed-slug']]) {
    await openTask(page, `/coding/${track}/${id}`, solutionFor(id)!.solution);
    await run.click();
    await expect.soft(announced(page)).toHaveText(/^([1-9]\d*) of \1 passing$/, { timeout: 30_000 });
  }

  const react = 'react-easy2-focus-the-search';
  const cases = suiteCaseCount(CODING_TASKS.find((task) => task.id === react)!.suite);
  await openTask(page, `/coding/react/${react}`, solutionFor(react)!.solution);
  await run.click();
  await expect.soft(announced(page)).toHaveText(`${cases} of ${cases} passing`, { timeout: 30_000 });
  expect(seen).toEqual([]);
});

test('a Google profile photo loads on the profile page without a violation', async ({ page, baseURL }) => {
  const seen = await watchPolicy(page);
  await prepare(page, baseURL);
  const user = userWith({ avatar_url: 'https://lh3.googleusercontent.com/a/csp-spec' });
  await storeFakeSession(page, user);
  await localAuth(page, { user: () => user });
  const photo = readFileSync('client/public/favicon-32.png');
  let photoRequests = 0;
  await page.route('https://lh3.googleusercontent.com/**', (route) => {
    photoRequests += 1;
    return route.fulfill({ contentType: 'image/png', body: photo });
  });
  await page.goto('/profile');
  const selector = 'img[src="https://lh3.googleusercontent.com/a/csp-spec"]';
  await expect.soft(page.locator(selector).first()).toBeVisible();
  await expect.soft.poll(() => page.evaluate((selector) => {
    const image = document.querySelector<HTMLImageElement>(selector);
    return Boolean(image?.complete && image.naturalWidth > 0);
  }, selector)).toBe(true);
  expect.soft(photoRequests).toBeGreaterThan(0);
  expect(seen).toEqual([]);
});
