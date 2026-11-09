import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { fakeSession, localAuth, projectUrl, sessionKey, storeFakeSession } from './fake-session';

// devShark downloads @supabase/supabase-js only for a visitor who is signed in
// or signing in (client/src/lib/supabaseClient.ts). The preview under test must
// be built with a Supabase project configured, as production is; CI builds with
// the placeholder project the bundle budget measures with, and nothing here
// ever reaches it (fake-session.ts).

// Two chunks start with "supabase-": the library, named by manualChunks in
// client/vite.config.ts, and the app's own lib/supabase.ts API helpers, which
// some routes load. The library is the one that carries the auth client.
const SUPABASE_CHUNK = /^\/assets\/supabase-[\w-]+\.js$/;
const LIBRARY_MARKER = 'GoTrueClient';

interface Watch {
  chunks: string[];
  project: string[];
}

function watch(page: Page): Watch {
  const seen: Watch = { chunks: [], project: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (SUPABASE_CHUNK.test(url.pathname)) seen.chunks.push(url.href);
    if (url.hostname === projectUrl.hostname) seen.project.push(`${request.method()} ${url.pathname}`);
  });
  return seen;
}

async function libraryRequests(page: Page, chunks: string[]): Promise<string[]> {
  const library: string[] = [];
  for (const url of new Set(chunks)) {
    const body = await (await page.request.get(url)).text();
    if (body.includes(LIBRARY_MARKER)) library.push(url);
  }
  return library;
}

/** The app's own API answers 503, as offline; auth reads recorded. */
async function offlineApi(page: Page) {
  const signInReports: (string | null)[] = [];
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/user/authevent') signInReports.push(route.request().headers().authorization ?? null);
    return route.fulfill({ status: 503, json: { error: { code: 'offline', message: 'offline' } } });
  });
  return signInReports;
}

// Stub only the Supabase exchange. The actual SDK must send the verifier
// behind the S256 challenge from the authorization request.
const challengeFor = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const CALLBACK_CODE = 'provider-callback-code';

async function localExchange(page: Page, challenge: string, session = fakeSession()) {
  await page.route('**/auth/v1/token?grant_type=pkce', (route) => {
    const { auth_code, code_verifier } = route.request().postDataJSON();
    if (auth_code !== CALLBACK_CODE || typeof code_verifier !== 'string' || challengeFor(code_verifier) !== challenge) {
      return route.fulfill({ status: 400, json: { error: 'bad_code_verifier' } });
    }
    return route.fulfill({ json: session });
  });
}

async function desktop(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

for (const route of ['/', '/learn']) {
  test(`a signed-out first visit to ${route} never downloads supabase-js`, async ({ page }) => {
    await desktop(page);
    await offlineApi(page);
    await localAuth(page);
    // The account button must never pass through its loading skeleton.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Loading account"]')) (window as unknown as { sawAuthLoading: boolean }).sawAuthLoading = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const seen = watch(page);
    await page.goto(route);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await libraryRequests(page, seen.chunks)).toEqual([]);
    expect(seen.project).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { sawAuthLoading?: boolean }).sawAuthLoading ?? false)).toBe(false);
  });
}

test('a stored session downloads supabase-js and restores the account', async ({ page }) => {
  await desktop(page);
  const signInReports = await offlineApi(page);
  await localAuth(page);
  await storeFakeSession(page);
  const seen = watch(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Account menu for Test' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await libraryRequests(page, seen.chunks)).toHaveLength(1);
  // A valid stored session needs no call to Supabase, and restoring it is not a sign-in.
  expect(seen.project).toEqual([]);
  expect(signInReports).toEqual([]);
});

test('signing in downloads supabase-js on the Google press, then leaves for the provider', async ({ page }) => {
  await desktop(page);
  await offlineApi(page);
  await localAuth(page);
  const seen = watch(page);
  await page.goto('/');
  const logIn = page.getByRole('button', { name: 'Sign in', exact: true }).first();
  await expect(logIn).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await libraryRequests(page, seen.chunks)).toEqual([]);
  // "Sign in" opens the sign-in dialog: Google first, then an email and
  // password. Opening it downloads nothing of supabase-js.
  await logIn.click();
  const google = page.getByRole('dialog').getByRole('button', { name: 'Continue with Google' });
  await expect(google).toBeVisible();
  expect(await libraryRequests(page, seen.chunks)).toEqual([]);
  await google.click();
  await page.waitForURL((url) => url.hostname === projectUrl.hostname);
  const authorize = new URL(page.url());
  expect(authorize.pathname).toBe('/auth/v1/authorize');
  expect(authorize.searchParams.get('provider')).toBe('google');
  expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
  expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await libraryRequests(page, seen.chunks)).toHaveLength(1);
});

test('a second sign-in press after a failed download reloads, leaves for the provider, and comes back to the page that asked', async ({ page }) => {
  await desktop(page);
  await offlineApi(page);
  await localAuth(page);
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documents.push(new URL(request.url()).pathname);
  });
  // The library chunk is dropped until `failing` is cleared. The app's own
  // supabase-* chunk passes; only the library carries the auth client.
  let failing = true;
  const library: string[] = [];
  await page.route(/\/assets\/supabase-[\w-]+\.js$/, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (!body.includes(LIBRARY_MARKER)) return route.fulfill({ response, body });
    library.push(failing ? 'dropped' : 'served');
    return failing ? route.abort('failed') : route.fulfill({ response, body });
  });

  // The voucher's sign-in records where to come back to (/premium#voucher).
  await page.goto('/premium');
  await page.getByRole('button', { name: 'Sign in to redeem' }).click();
  const signIn = page.getByRole('dialog').getByRole('button', { name: 'Continue with Google' });
  await signIn.click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('We couldn’t reach the sign-in service. Check your connection and try again.');
  expect(library).toEqual(['dropped']);
  expect(documents).toEqual(['/premium']);

  // The network is back. A browser that remembers the failed module answers
  // the next import from memory, so this press reloads the page and the next
  // document finishes the sign-in; one that forgets signs in from here.
  failing = false;
  await signIn.click();
  await page.waitForURL((url) => url.hostname === projectUrl.hostname);
  expect(new URL(page.url()).pathname).toBe('/auth/v1/authorize');
  expect(library).toEqual(['dropped', 'served']);
  const reloaded = documents.filter((path) => path === '/premium').length === 2;
  test.info().annotations.push({ type: 'second press', description: reloaded ? 'reloaded, and the next document signed in' : 'signed in without a reload' });
  expect(documents).toEqual(reloaded ? ['/premium', '/premium', '/auth/v1/authorize'] : ['/premium', '/auth/v1/authorize']);

  // Back from the provider, the account arrives on the page that asked.
  const authorize = new URL(page.url());
  expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
  await localExchange(page, authorize.searchParams.get('code_challenge')!);
  await page.goto(`/?code=${CALLBACK_CODE}`);
  await expect(page.getByRole('button', { name: 'Account menu for Test' })).toBeVisible();
  await expect(page).toHaveURL(/\/premium#voucher$/);
});

test('an OAuth return with a local verifier is exchanged and reported as a sign-in', async ({ page }) => {
  await desktop(page);
  const signInReports = await offlineApi(page);
  await localAuth(page);
  const session = fakeSession();
  const verifier = 'this-browser-verifier';
  await page.addInitScript(({ key, verifier }) => localStorage.setItem(`${key}-code-verifier`, JSON.stringify(verifier)), { key: sessionKey, verifier });
  await localExchange(page, challengeFor(verifier), session);
  const seen = watch(page);
  await page.goto(`/?code=${CALLBACK_CODE}`);
  await expect(page.getByRole('button', { name: 'Account menu for Test' })).toBeVisible();
  expect(await libraryRequests(page, seen.chunks)).toHaveLength(1);
  // The exchange stored the session under its default key and removed the code.
  expect(seen.project).toContain('POST /auth/v1/token');
  expect(new URL(page.url()).search).toBe('');
  expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key) ?? 'null', sessionKey))).toMatchObject({ access_token: session.access_token });
  await expect.poll(() => signInReports).toEqual([`Bearer ${session.access_token}`]);
});

test('an unsolicited authorization code or bearer fragment cannot sign in', async ({ page }) => {
  await desktop(page);
  const signInReports = await offlineApi(page);
  await localAuth(page);
  const seen = watch(page);
  await page.goto(`/?code=${CALLBACK_CODE}`);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();

  const session = fakeSession();
  await page.goto(`/#access_token=${session.access_token}&expires_in=3600&expires_at=${session.expires_at}&refresh_token=fake-refresh-token&token_type=bearer&provider_token=fake`);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(seen.project).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), sessionKey)).toBeNull();
  expect(signInReports).toEqual([]);
});
