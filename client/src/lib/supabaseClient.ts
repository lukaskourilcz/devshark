// The browser Supabase client, downloaded only when this visitor needs it.
//
// @supabase/supabase-js is about 55 kB gzipped, and a visitor who is not signed
// in never uses it, so it stays out of the first page load. This module imports
// the library once, the first time one of these holds:
//
//   * a session is stored. supabase-js keeps it in localStorage under its
//     default key, sb-<first label of the project host>-auth-token, which
//     sessionKeyFor() derives the way SupabaseClient does. Keep that default:
//     an explicit `storageKey` would sign every existing user out;
//   * the URL carries an OAuth return, which `detectSessionInUrl` must read;
//   * the visitor starts a sign-in (lib/auth.tsx);
//   * another tab signs in and writes that key (the `storage` event).
//
// The first two start the download while this module evaluates, before React
// renders. Without a session the callers behave as they did when the client
// was null: no token, no sync, and nothing to download.

import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** False in a build without Supabase credentials, where nobody can sign in. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn('Supabase credentials not configured. Authentication and stats are disabled.');
}

/**
 * supabase-js's default session key for a project URL. SupabaseClient (2.110)
 * trims the URL, requires http or https, and uses
 * `sb-${new URL(url).hostname.split('.')[0]}-auth-token`. Null where
 * createClient would throw.
 */
export function sessionKeyFor(url: string | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    return `sb-${new URL(trimmed).hostname.split('.')[0]}-auth-token`;
  } catch {
    return null;
  }
}

const sessionKey = isSupabaseConfigured ? sessionKeyFor(supabaseUrl) : null;

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Blocked storage: supabase-js keeps its session in memory, so none is stored.
    return null;
  }
}

/** The parameters auth-js reads from a redirect: the fragment, then the query
 * string on top of it (parseParametersFromURL). */
function redirectParams(href: string): Record<string, string> {
  const params: Record<string, string> = {};
  const url = new URL(href);
  if (url.hash.startsWith('#')) {
    new URLSearchParams(url.hash.slice(1)).forEach((value, key) => {
      params[key] = value;
    });
  }
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/** An OAuth error, or a PKCE code whose verifier this browser stored
 * when the sign-in started. Bearer tokens in the URL never open a session. */
function hasAuthRedirect(key: string): boolean {
  let params: Record<string, string>;
  try {
    params = redirectParams(window.location.href);
  } catch {
    return false;
  }
  if (params.error || params.error_description || params.error_code) return true;
  return Boolean(params.code && readStorage(`${key}-code-verifier`));
}

/** Whether this page load opened on an OAuth return (read once, as the module
 * evaluates, before supabase-js takes the parameters out of the address): the
 * session supabase-js announces first is then a new sign-in, not one this
 * browser had stored. */
export const openedOnAuthRedirect = typeof window !== 'undefined' && sessionKey !== null && hasAuthRedirect(sessionKey);

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;
interface Waiting {
  listener: AuthListener;
  stop?: () => void;
}

let client: SupabaseClient | null = null;
let loading: Promise<SupabaseClient | null> | null = null;
let downloadFailed = false;
// Subscribers that arrived before the client; attached when it is created.
const waiting = new Set<Waiting>();
let watchingOtherTabs = false;

/** Whether supabase-js has a session stored in this browser, current or expired. */
export function hasStoredSession(): boolean {
  return Boolean(sessionKey && readStorage(sessionKey));
}

/** How close to its expiry supabase-js still hands out a stored access token
 * unchanged: auth-js 2.110's EXPIRY_MARGIN_MS (three 30-second refresh ticks),
 * which `getSession()` and the refresh at start-up both use. */
export const TOKEN_EXPIRY_MARGIN_MS = 90_000;

/**
 * The stored session's access token, read straight from storage, when
 * supabase-js would hand out that same token: a well-formed session (its
 * `_isValidSession` test) that expires more than TOKEN_EXPIRY_MARGIN_MS from
 * now, on a page that did not open on an OAuth return (whose new session is
 * not stored yet). `getSession()` reads the same key and returns that token
 * without a request, so a request can carry it without waiting for the
 * supabase-js download (perf baseline #587 C10). Null in every other case;
 * the caller then asks supabase-js, which refreshes or removes the session.
 * The server verifies the token on every request either way.
 */
export function freshStoredAccessToken(now: number = Date.now()): string | null {
  if (!sessionKey || openedOnAuthRedirect) return null;
  try {
    const stored = JSON.parse(readStorage(sessionKey) || 'null') as { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown } | null;
    const token = stored?.access_token;
    return typeof token === 'string' && token && typeof stored!.refresh_token === 'string' && typeof stored!.expires_at === 'number'
      && stored!.expires_at * 1000 - now > TOKEN_EXPIRY_MARGIN_MS ? token : null;
  } catch {
    return null;
  }
}

/** The account of the session stored in this browser, current or expired,
 * read before supabase-js removes one it can no longer refresh. */
export function storedSessionUserId(): string | null {
  try {
    const id = (JSON.parse((sessionKey && readStorage(sessionKey)) || 'null') as { user?: { id?: unknown } } | null)?.user?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Forget the session stored in this browser, and a sign-in's code verifier,
 * without the server: what supabase-js's own local sign-out removes. For Log
 * out when supabase-js cannot reach the server, which leaves both in place.
 * supabase-js reads the session from storage every time, so it has none after
 * this either.
 */
export function forgetStoredSession(): void {
  if (!sessionKey) return;
  try {
    window.localStorage.removeItem(sessionKey);
    window.localStorage.removeItem(`${sessionKey}-code-verifier`);
  } catch {
    // Blocked storage: supabase-js kept the session in memory only.
  }
}

/**
 * Whether this page load may have a session: the client is loaded or loading,
 * a session is stored, or the URL carries an OAuth return. False means the
 * visitor is signed out and nothing needs downloading.
 */
export function mayHaveSession(): boolean {
  if (client || loading) return true;
  if (!sessionKey) return false;
  return Boolean(readStorage(sessionKey)) || hasAuthRedirect(sessionKey);
}

/**
 * The client, importing supabase-js on first use. Resolves null in a build
 * without credentials. Rejects when the download fails. The next call imports
 * again, but a browser that remembers failed module fetches (Chromium up to
 * 155, Safari) fails it at once without a request; lib/auth.tsx reloads on a
 * sign-in press then.
 */
export function loadSupabase(): Promise<SupabaseClient | null> {
  if (client) return Promise.resolve(client);
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!loading) {
    loading = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        // Require proof that this browser started the redirect. Keep the
        // default storage key so existing signed-in sessions still restore.
        const created = createClient(supabaseUrl, supabaseAnonKey, { auth: { flowType: 'pkce' } });
        client = created;
        // Attach waiting subscribers in this same tick: supabase-js starts
        // initializing inside createClient and announces a stored session a
        // few microtasks later.
        for (const entry of waiting) {
          const { data } = created.auth.onAuthStateChange(entry.listener);
          entry.stop = () => data.subscription.unsubscribe();
        }
        waiting.clear();
        stopWatchingOtherTabs();
        return created;
      })
      .catch((error: unknown) => {
        loading = null;
        downloadFailed = true;
        throw error;
      });
  }
  return loading;
}

/** Whether loading supabase-js failed earlier in this document, on a press or
 * in the background. */
export function supabaseLoadFailed(): boolean {
  return downloadFailed;
}

/** The session supabase-js holds, loading the client first. Null in a build
 * without credentials. */
export async function getSupabaseSession(): Promise<Session | null> {
  const loaded = await loadSupabase();
  if (!loaded) return null;
  const { data } = await loaded.auth.getSession();
  return data.session;
}

/**
 * The client for work that only means something with a session, such as a
 * metadata write. Resolves null, without downloading anything, when there is
 * no session (see mayHaveSession), and null when the download fails.
 */
export function supabaseForSession(): Promise<SupabaseClient | null> {
  return mayHaveSession() ? loadSupabase().catch(() => null) : Promise.resolve(null);
}

/** The client if it has loaded. A match channel reads it synchronously: only
 * a signed-in player opens one, and restoring or starting that session loaded
 * the client. */
export function loadedSupabase(): SupabaseClient | null {
  return client;
}

/**
 * Subscribe to supabase-js auth events, whether or not the client has loaded;
 * returns the unsubscribe. A subscriber that arrives before the client is
 * attached as the client is created, so it hears everything supabase-js
 * announces while initializing. Until then a sign-in in another tab loads the
 * client here as well.
 */
export function onSupabaseAuthStateChange(listener: AuthListener): () => void {
  if (client) {
    const { data } = client.auth.onAuthStateChange(listener);
    return () => data.subscription.unsubscribe();
  }
  const entry: Waiting = { listener };
  waiting.add(entry);
  watchOtherTabs();
  return () => {
    waiting.delete(entry);
    entry.stop?.();
    if (waiting.size === 0) stopWatchingOtherTabs();
  };
}

// Another tab signed in, so supabase-js there wrote the session under this
// key. A tab without the client missed that tab's broadcast; loading the
// client restores the session from storage.
function onStorage(event: StorageEvent): void {
  if (event.key === sessionKey && event.newValue) void loadSupabase().catch(() => undefined);
}

function watchOtherTabs(): void {
  if (watchingOtherTabs || !sessionKey || typeof window === 'undefined') return;
  window.addEventListener('storage', onStorage);
  watchingOtherTabs = true;
}
function stopWatchingOtherTabs(): void {
  if (!watchingOtherTabs) return;
  window.removeEventListener('storage', onStorage);
  watchingOtherTabs = false;
}

// A returning visitor's stored session, or an OAuth return: start the download
// now, while the rest of the app evaluates, so the session resolves about one
// chunk fetch later than it did when the library was part of the entry.
if (typeof window !== 'undefined' && mayHaveSession()) void loadSupabase().catch(() => undefined);
