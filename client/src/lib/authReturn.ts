// Where to go after a sign-in: the Google round trip, or an email sign-in in
// the dialog that a page asked for with a path of its own.
//
// Supabase sends every Google sign-in back to the site's origin. A sign-in
// records the page it was pressed on (a page may name another: the checkout
// success page names itself with its session id); the app shell reads it once
// the account arrives and goes back there. A confirmation email opens in
// another tab, often on another device, so its link carries the page itself
// (`/auth/confirmed?next=`, lib/emailAuth.ts) instead of this record.
//
// The record lives in sessionStorage (this tab only), accepts same-origin
// paths only, and goes stale after fifteen minutes, so an abandoned sign-in
// never hijacks a later one.

import { isSafeRedirectPath } from './safeRedirect';

const KEY = 'devshark:auth-return';

/** Where a confirmation email's link lands (lib/emailAuth.ts). */
export const CONFIRMED_PATH = '/auth/confirmed';
/** Where a password-reset email's link lands. */
export const RESET_PASSWORD_PATH = '/reset-password';
/** Pages an email link lands on. They say what happened themselves and offer
 * the way on, so the app shell sends nobody away from them after a sign-in. */
const AUTH_LANDING_PATHS: readonly string[] = [CONFIRMED_PATH, RESET_PASSWORD_PATH];
const MAX_AGE_MS = 15 * 60_000;

export const isSafeReturnPath = isSafeRedirectPath;

export function isAuthLandingPath(path: string): boolean {
  return AUTH_LANDING_PATHS.includes(path.split(/[?#]/u, 1)[0].replace(/\/+$/, '').toLowerCase());
}

/** The page the visitor is on (path, query and fragment), as a return path;
 * null on the home page, where the sign-in lands anyway. */
export function currentReturnPath(location: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location): string | null {
  const path = location.pathname + location.search + location.hash;
  return path === '/' ? null : path;
}

export function rememberAuthReturn(path: string, now = Date.now()): void {
  if (!isSafeReturnPath(path)) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    // Storage may be off; the visitor then lands on the home page as before.
  }
}

export function clearAuthReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

// ── A sign-in that continues after a reload ─────────────────────────────────
//
// A second sign-in press after supabase-js failed to download reloads the page
// (lib/auth.tsx), and this mark lets the next document finish that sign-in.
// The return path above stays for it; when the sign-in does not continue, the
// return path goes too, so it never steers a later, unrelated sign-in.

const RESUME_KEY = 'devshark:auth-resume';
/** Long enough for a slow reload, short enough that a tab reopened later never
 * leaves for Google by itself. */
export const RESUME_MAX_AGE_MS = 60_000;

export function markSignInResume(now = Date.now()): void {
  try {
    sessionStorage.setItem(RESUME_KEY, String(now));
  } catch {
    // Without storage the next document cannot continue; the learner presses again.
  }
}

export function clearSignInResume(): void {
  try {
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    // ignore
  }
}

/** Whether this document should finish a sign-in the one before it started.
 * The mark is removed as it is read; a stale one takes the return path with it. */
export function takeSignInResume(now = Date.now()): boolean {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  const at = Number(raw);
  if (!Number.isFinite(at) || now < at || now - at > RESUME_MAX_AGE_MS) {
    clearAuthReturn();
    return false;
  }
  return true;
}

/** The recorded path, removed as it is read; null when none is fresh. */
export function takeAuthReturn(now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof value.at !== 'number' || now - value.at > MAX_AGE_MS || now < value.at) return null;
    return isSafeReturnPath(value.path) ? value.path : null;
  } catch {
    return null;
  }
}
