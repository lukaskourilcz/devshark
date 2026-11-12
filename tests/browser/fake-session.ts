import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A signed-in visitor without a server. The preview under test is built with
// the placeholder Supabase project the bundle budget measures with, as CI
// builds it; nothing here ever reaches that project.
const budget = JSON.parse(readFileSync('docs/quality/bundle-budget.json', 'utf8'));
export const projectUrl = new URL(budget.measuredBuild.env.VITE_SUPABASE_URL);
// supabase-js's default session key (sessionKeyFor in lib/supabaseClient.ts).
export const sessionKey = `sb-${projectUrl.hostname.split('.')[0]}-auth-token`;

export const fakeUser = {
  id: '00000000-0000-4000-8000-00000000c0de',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'lazy-auth@example.test',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: { full_name: 'Test Learner' },
  created_at: '2026-09-01T00:00:00Z',
};

/** The fake user with extra `user_metadata`, such as a saved learner profile. */
export function userWith(metadata: Record<string, unknown>) {
  return { ...fakeUser, user_metadata: { ...fakeUser.user_metadata, ...metadata } };
}

/** A well-formed session that no server ever issued. */
export function fakeSession(user: typeof fakeUser = fakeUser) {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = [
    part({ alg: 'HS256', typ: 'JWT' }),
    part({ sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, iat: now, exp: now + 3600 }),
    Buffer.from('not-a-real-signature').toString('base64url'),
  ].join('.');
  return { access_token: accessToken, refresh_token: 'fake-refresh-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}

/** Puts the fake session where supabase-js looks, before the page's scripts run. */
export async function storeFakeSession(page: Page, user: typeof fakeUser = fakeUser) {
  // A sandboxed frame (the admin email preview) has no storage; the session belongs to the page only.
  await page.addInitScript(({ key, session }) => { try { localStorage.setItem(key, JSON.stringify(session)); } catch { /* sandboxed frame */ } }, { key: sessionKey, session: fakeSession(user) });
}

/** Supabase Auth, answered locally: nothing leaves the machine. With `user`,
 * the user endpoint and a session refresh answer with what it returns at that
 * moment, so a spec can change the account's metadata after a save. */
export async function localAuth(page: Page, { user }: { user?: () => typeof fakeUser } = {}) {
  await page.route('**/auth/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/v1/user')) return route.fulfill({ json: user ? user() : fakeUser });
    if (url.pathname.endsWith('/auth/v1/authorize')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Authorize</title><p>Google sign-in would start here.</p>' });
    if (user && url.pathname.endsWith('/auth/v1/token') && url.searchParams.get('grant_type') === 'refresh_token') {
      return route.fulfill({ json: fakeSession(user()) });
    }
    return route.fulfill({ status: 401, json: { error: 'invalid_grant', error_description: 'local test' } });
  });
}
