import { test, expect, type Page, type Route } from '@playwright/test';
import { CODING_TASKS, playable } from '../../lib/coding/catalog';
import { fakeUser, sessionKey } from './fake-session';
import { fulfilTaskRead, isTaskRead } from './coding-task-read';

// A learner's code in the built app, through the real editor and the real
// supabase-js (owner decisions 4, 5 and 10, 9 Oct 2026; C5-1, C5-3, C5-4).
// Supabase Auth and the API are answered here; the API keeps each account's
// drafts the way save_coding_draft_v2 (migration 059) does. Nothing leaves
// the machine.
//
// The sign-out C5's j10d reproduced: the session can no longer refresh (the
// learner signed out everywhere from another device, or the password changed
// there), and the next request finds it expired. supabase-js removes it and
// says SIGNED_OUT; the app used to erase every draft on the device with it.

const TASK = 'js-count-multiples';
const OTHER_TASK = 'js-digit-sum';
const COPY = `devshark:coding:draft:${TASK}`;
const KEPT = 'devshark:coding:kept:v1';
const MINE = '// twenty minutes of work\nconst countMultiples = (n, from, to) => 0;\n';
const STARTER = playable(CODING_TASKS.find((task) => task.id === TASK)!).starter;

const OTHER_USER = { ...fakeUser, id: '00000000-0000-4000-8000-0000000b0b0b', email: 'someone-else@example.test', user_metadata: { full_name: 'Someone Else' } };
type User = typeof fakeUser;

/** A well-formed session that no server ever issued, for `user`. */
function sessionFor(user: User, expiresIn = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = [part({ alg: 'HS256', typ: 'JWT' }), part({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, iat: now, exp: now + expiresIn }), part({ sig: 'none' })].join('.');
  return { access_token: accessToken, refresh_token: `refresh-${user.id}`, token_type: 'bearer', expires_in: expiresIn, expires_at: now + expiresIn, user };
}
const accountOf = (route: Route): string | null => {
  const token = /^Bearer (.+)$/.exec(route.request().headers().authorization ?? '')?.[1];
  if (!token) return null;
  try { return (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { sub?: string }).sub ?? null; } catch { return null; }
};

interface Row { code: string; updatedAt: string }
interface Stand { drafts: Map<string, Row>; saves: { account: string | null; code: string; base: unknown }[]; tick: number; time: () => string }

/** The API and Supabase Auth, answered here. Each account's drafts are kept
 * in `drafts` under `account:task`, and a save refused unless it is built on
 * the stored time, as migration 059 does. Signing in with a password signs in
 * the account whose address is typed; refreshing a session is refused. */
async function standIn(page: Page): Promise<Stand> {
  // One clock for every save, as the database's updated_at moves forward.
  const stand: Stand = { drafts: new Map(), saves: [], tick: 0, time: () => `2026-10-09T12:00:${String(++stand.tick).padStart(2, '0')}.123456+00:00` };
  const time = stand.time;
  await page.route('**/auth/v1/**', (route) => {
    const url = new URL(route.request().url());
    const grant = url.searchParams.get('grant_type');
    if (url.pathname.endsWith('/auth/v1/token') && grant === 'password') {
      const { email } = route.request().postDataJSON() as { email?: string };
      const user = email === OTHER_USER.email ? OTHER_USER : fakeUser;
      return route.fulfill({ headers: { 'x-supabase-api-version': '2024-01-01' }, json: sessionFor(user) });
    }
    if (url.pathname.endsWith('/auth/v1/token') && grant === 'refresh_token') {
      return route.fulfill({ status: 400, headers: { 'x-supabase-api-version': '2024-01-01' }, json: { code: 'refresh_token_not_found', message: 'Invalid Refresh Token: Refresh Token Not Found' } });
    }
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: fakeUser });
    if (url.pathname.endsWith('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    return route.fulfill({ status: 401, json: { code: 'bad_jwt', message: 'local test' } });
  });
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const op = url.searchParams.get('op');
    const resource = url.searchParams.get('resource');
    const method = route.request().method();
    const account = accountOf(route);
    if (isTaskRead(resource)) {
      const task = CODING_TASKS.find((one) => one.id === url.searchParams.get('id'))!;
      const row = account ? stand.drafts.get(`${account}:${task.id}`) : undefined;
      return fulfilTaskRead(route, { task: playable(task), session: `${task.id}-${account ?? 'guest'}`, locked: null, progress: null, draft: row?.code ?? null, draftUpdatedAt: row?.updatedAt ?? null, signedIn: Boolean(account) });
    }
    if (resource === 'progress') return route.fulfill({ json: { data: {}, extra: { unlocked: [] } } });
    if (op === 'coding-draft' && !account) return route.fulfill({ status: 401, json: { error: { code: 'missing_token', message: 'Sign in' } } });
    if (op === 'coding-draft' && method === 'GET') {
      const row = stand.drafts.get(`${account}:${url.searchParams.get('id')}`);
      return route.fulfill({ json: { code: row?.code ?? null, updatedAt: row?.updatedAt ?? null } });
    }
    if (op === 'coding-draft' && method === 'POST') {
      const { id, code, base } = route.request().postDataJSON() as { id: string; code: string; base?: string | null };
      stand.saves.push({ account, code, base });
      const key = `${account}:${id}`;
      const row = stand.drafts.get(key);
      if (row && row.code !== code && base !== row.updatedAt) {
        return route.fulfill({ status: 409, json: { error: { code: 'draft_conflict', message: 'Saved since', updatedAt: row.updatedAt } } });
      }
      const updatedAt = row?.code === code ? row.updatedAt : time();
      stand.drafts.set(key, { code, updatedAt });
      return route.fulfill({ json: { ok: true, updatedAt } });
    }
    if (op === 'entitlement') return route.fulfill({ json: { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null } });
    if (op === 'coding-progress') return route.fulfill({ json: { tasks: {}, due: [], javascriptLevelsCleared: 0, passedByTrack: {} } });
    if (op === 'coding-bookmarks') return route.fulfill({ json: { saved: [], collections: [] } });
    if (op === 'practice-session') return route.fulfill({ json: { session: null } });
    if (url.pathname === '/api/user/authevent') return route.fulfill({ json: { ok: true, kind: 'login' } });
    return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'Not found' } } });
  });
  return stand;
}

/** Signed in as `user` when the page first opens; a reload keeps whatever the
 * app did to the session since. */
async function signedInOnce(page: Page, user: User = fakeUser) {
  await page.addInitScript(({ key, session }) => {
    if (sessionStorage.getItem('own-drafts:seeded')) return;
    sessionStorage.setItem('own-drafts:seeded', '1');
    localStorage.setItem(key, JSON.stringify(session));
  }, { key: sessionKey, session: sessionFor(user) });
}

const editor = (page: Page) => page.locator('.cm-content');
async function openTask(page: Page, id = TASK) {
  await page.goto(`/coding/javascript/${id}`);
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#main-content')).toBeFocused();
}
async function type(page: Page, source: string) {
  await editor(page).focus();
  await expect(page.locator('.cm-editor')).toHaveClass(/\bcm-focused\b/);
  await editor(page).fill(source);
}
const shown = (page: Page) => editor(page).innerText();
const stored = (page: Page, key: string) => page.evaluate((one) => localStorage.getItem(one), key);

/** The session can no longer refresh: its access token is past its expiry,
 * and the refresh token is refused. The next request finds out. */
async function sessionEnds(page: Page) {
  await page.evaluate((key) => {
    const session = JSON.parse(localStorage.getItem(key)!) as { expires_at: number };
    session.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(session));
  }, sessionKey);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
}

async function signInWithPassword(page: Page, email: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => console.error(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    try {
      localStorage.setItem('devquiz:color-mode', 'light');
      localStorage.setItem('devshark:consent', JSON.stringify({ version: 1, analytics: false, marketing: false, decidedAt: Date.now() }));
    } catch { /* private mode */ }
  });
});

test('a session that ends on its own keeps the code for the account, says so, and gives it back when the same account signs in (decision 4, C5-1)', async ({ page }) => {
  test.setTimeout(120_000);
  const stand = await standIn(page);
  await signedInOnce(page);
  await openTask(page);
  await type(page, MINE);
  // Kept on this device a second later, without Run (decision 5).
  await expect.poll(() => stored(page, COPY)).toBe(MINE);

  await sessionEnds(page);
  await expect(page.getByText('You were signed out — sign in to keep your code.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
  // The page is a guest's now, and shows none of the account's code.
  await expect.poll(() => shown(page)).not.toContain('twenty minutes');
  const note = page.locator('p.cd-note', { hasText: 'You were signed out, so the code for this task is kept for your account.' });
  await expect(note).toBeVisible();
  expect(await stored(page, COPY)).toBeNull();
  const kept = JSON.parse((await stored(page, KEPT)) ?? 'null') as { userId: string; drafts: Record<string, string> };
  expect(kept.userId).toBe(fakeUser.id);
  expect(kept.drafts[COPY]).toBe(MINE);
  // Nothing of it was sent as a guest's.
  expect(stand.saves.filter((save) => save.account === null)).toEqual([]);

  await note.getByRole('button', { name: 'Sign in' }).click();
  await signInWithPassword(page, fakeUser.email);
  await expect.poll(() => shown(page), { timeout: 30_000 }).toContain('twenty minutes of work');
  await expect(note).toHaveCount(0);
  await expect(page.getByText('You were signed out — sign in to keep your code.')).toHaveCount(0);
  expect(await stored(page, KEPT)).toBeNull();
});

test('another account signing in on that device never sees the kept code (decision 4)', async ({ page }) => {
  test.setTimeout(120_000);
  await standIn(page);
  await signedInOnce(page);
  await openTask(page);
  await type(page, MINE);
  await expect.poll(() => stored(page, COPY)).toBe(MINE);
  await sessionEnds(page);
  await expect(page.getByText('You were signed out — sign in to keep your code.')).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await signInWithPassword(page, OTHER_USER.email);
  await expect.poll(async () => JSON.parse(await stored(page, sessionKey) ?? 'null')?.user?.id).toBe(OTHER_USER.id);
  await expect(page.locator('.ss-header')).toBeHidden();
  expect(await stored(page, KEPT)).toBeNull();
  await expect.poll(() => shown(page), { timeout: 30_000 }).toContain(STARTER.split('\n')[0]);
  expect(await shown(page)).not.toContain('twenty minutes');
  const everything = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(everything).not.toContain('twenty minutes');
});

test('typed code survives a reload straight after typing, per task, without Run or any account save (decision 5, C5-3)', async ({ page }) => {
  test.setTimeout(120_000);
  const stand = await standIn(page);
  await signedInOnce(page);
  await openTask(page);
  await type(page, '// typed and never run\nconst countMultiples = () => 42;\n');
  // No wait for the second: leaving the page writes what is waiting.
  await page.reload();
  await expect(editor(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => shown(page)).toContain('typed and never run');

  // Another task keeps its own code.
  await openTask(page, OTHER_TASK);
  expect(await shown(page)).not.toContain('typed and never run');
  await type(page, '// digit sum, typed');
  await openTask(page, TASK);
  await expect.poll(() => shown(page)).toContain('typed and never run');
  await openTask(page, OTHER_TASK);
  await expect.poll(() => shown(page)).toContain('digit sum, typed');
  expect(stand.saves).toEqual([]);
});

test('a save refused because another device saved since asks which code to keep, and loses neither (decision 10, C5-4)', async ({ page }) => {
  test.setTimeout(120_000);
  const stand = await standIn(page);
  const loaded = stand.time();
  stand.drafts.set(`${fakeUser.id}:${TASK}`, { code: '// as this page loaded it', updatedAt: loaded });
  await signedInOnce(page);
  await openTask(page);
  await expect.poll(() => shown(page)).toContain('as this page loaded it');
  // Meanwhile, on the laptop.
  const laptop = stand.time();
  stand.drafts.set(`${fakeUser.id}:${TASK}`, { code: '// saved on the laptop', updatedAt: laptop });

  await type(page, '// mine, on this device');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  const conflict = page.locator('p.cd-note', { hasText: 'changed on another device since this page opened' });
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  expect(stand.saves.at(-1)).toEqual({ account: fakeUser.id, code: '// mine, on this device', base: loaded });
  expect(stand.drafts.get(`${fakeUser.id}:${TASK}`)?.code).toBe('// saved on the laptop');

  // Open the laptop's draft: this device's code stays, and comes back on request.
  await conflict.getByRole('button', { name: 'Open the other draft' }).click();
  await expect.poll(() => shown(page)).toContain('saved on the laptop');
  await page.getByRole('button', { name: 'Open the code from this device' }).click();
  await expect.poll(() => shown(page)).toContain('mine, on this device');

  // Run it now: built on the laptop's draft, it is written.
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect.poll(() => stand.drafts.get(`${fakeUser.id}:${TASK}`)?.code).toBe('// mine, on this device');
  expect(stand.saves.at(-1)?.base).toBe(laptop);

  // Once more from the laptop, and this time keep this code over it.
  const again = stand.time();
  stand.drafts.set(`${fakeUser.id}:${TASK}`, { code: '// the laptop again', updatedAt: again });
  await type(page, '// mine, again');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(conflict).toBeVisible({ timeout: 15_000 });
  await conflict.getByRole('button', { name: 'Save this code instead' }).click();
  await expect.poll(() => stand.drafts.get(`${fakeUser.id}:${TASK}`)?.code).toBe('// mine, again');
  expect(stand.saves.at(-1)?.base).toBe(again);
  await expect(conflict).toHaveCount(0);
});
