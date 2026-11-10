// The Supabase client loads on demand (lib/supabaseClient.ts): a visitor who is
// not signed in never imports @supabase/supabase-js, while a stored session, an
// OAuth return, a sign-in and a sign-in in another tab do. Each test evaluates
// the modules afresh against the page state it arranges, as a page load would.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { RELOAD_GRACE_MS, type BuildCheck, type Recovery } from '../src/lib/routeRecovery';
import { RESUME_MAX_AGE_MS } from '../src/lib/authReturn';

const PROJECT_URL = 'https://testprojectref.supabase.co';
const ANON_KEY = 'test-anon-key';

// A stand-in for supabase-js 2.110, reduced to what the app calls. Like the
// real client it starts initializing inside createClient: it reads an OAuth
// return from the URL, saves it and announces SIGNED_IN in a later task, or it
// announces a stored session as SIGNED_IN a microtask later; every subscriber
// then gets INITIAL_SESSION.
const sb = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const KEY = 'sb-testprojectref-auth-token';
  const readStored = () => {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { access_token: string; user: { id: string } }) : null;
  };
  const sessionFor = (accessToken: string, userId: string) => ({
    access_token: accessToken,
    refresh_token: `${accessToken}-refresh`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: userId, email: `${userId}@example.test`, user_metadata: {} },
  });
  const makeClient = (url: string, key: string) => {
    const listeners = new Set<Listener>();
    const emit = (event: string, session: unknown) => [...listeners].forEach((listener) => listener(event, session));
    const client = {
      url,
      key,
      /** Subscribers that heard the SIGNED_IN announcing a restored session. */
      heardRestore: 0,
      /** An event supabase-js sends on its own (a failed return, an expired session). */
      emit,
      auth: {
        getSession: vi.fn(async () => {
          await initialized;
          return { data: { session: readStored() }, error: null };
        }),
        onAuthStateChange: vi.fn((listener: Listener) => {
          listeners.add(listener);
          void initialized.then(() => listener('INITIAL_SESSION', readStored()));
          return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
        }),
        signInWithOAuth: vi.fn(async () => ({ data: { provider: 'google', url: `${url}/auth/v1/authorize` }, error: null })),
        signOut: vi.fn(async () => {
          localStorage.removeItem(KEY);
          emit('SIGNED_OUT', null);
          return { error: null };
        }),
        refreshSession: vi.fn(async () => ({ data: { session: readStored() }, error: null })),
        updateUser: vi.fn(async () => ({ data: { user: readStored()?.user ?? null }, error: null })),
      },
    };
    const saveAndAnnounce = (session: ReturnType<typeof sessionFor>) => {
      localStorage.setItem(KEY, JSON.stringify(session));
      window.history.replaceState(null, '', window.location.pathname);
      setTimeout(() => emit('SIGNED_IN', session), 0);
    };
    const initialized = (async () => {
      await Promise.resolve();
      const code = new URLSearchParams(window.location.search).get('code');
      if (code && localStorage.getItem(`${KEY}-code-verifier`)) return saveAndAnnounce(sessionFor(`pkce-${code}`, 'user-pkce'));
      const stored = readStored();
      if (stored) {
        client.heardRestore = listeners.size;
        emit('SIGNED_IN', stored);
      }
    })();
    return client;
  };
  const state = {
    KEY,
    sessionFor,
    /** How many times this test's modules imported @supabase/supabase-js. */
    imports: 0,
    /** Holds a download until the test releases it. */
    held: null as null | { promise: Promise<void>; release: () => void },
    clients: [] as ReturnType<typeof makeClient>[],
    createClient: vi.fn((url: string, key: string, _options: { auth: { flowType: string } }) => {
      const created = makeClient(url, key);
      state.clients.push(created);
      return created;
    }),
  };
  return state;
});

const KEY = sb.KEY;
const STORED = sb.sessionFor('stored-access-token', 'user-stored');
// The same session within supabase-js's refresh margin (90 s): its token
// comes from supabase-js, which refreshes it first, so a request waits for
// the download. A token further from its expiry goes at once (C10).
const EXPIRING = { ...STORED, expires_at: Math.floor(Date.now() / 1000) + 60 };

/** The page load: fresh modules, and a supabase-js whose imports are counted.
 * `held` keeps the download pending until releaseDownload(), as a slow network
 * would; `fails` makes it fail, every time, with the error Chromium reports.
 * vitest wraps an error thrown by a mock factory in its own, so the failure is
 * thrown where the library is first used, inside the same import promise. */
function freshPageLoad(download: 'instant' | 'held' | 'fails' = 'instant') {
  vi.resetModules();
  let release = () => {};
  sb.held = download === 'held' ? { promise: new Promise<void>((resolve) => { release = resolve; }), release: () => release() } : null;
  vi.doMock('@supabase/supabase-js', async () => {
    sb.imports += 1;
    await sb.held?.promise;
    if (download === 'fails') {
      return {
        createClient: () => {
          throw new TypeError('Failed to fetch dynamically imported module: https://devshark.app/assets/supabase-B5YuwSPF.js');
        },
      };
    }
    return { createClient: sb.createClient };
  });
}
const releaseDownload = () => act(async () => sb.held?.release());

/** Let pending promises, timers and React updates run. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

/** What the auth context said on each render, and its latest value. */
async function mountAuth(recovery?: Recovery) {
  const auth = await import('../src/lib/auth');
  const renders: string[] = [];
  let latest: ReturnType<typeof auth.useAuth> | undefined;
  function Probe() {
    latest = auth.useAuth();
    const shown = latest.isLoading ? 'loading' : latest.user ? `user:${latest.user.id}` : 'signed-out';
    renders.push(shown);
    return <p data-testid="auth">{shown}</p>;
  }
  const view = render(<auth.AuthProvider recovery={recovery}><Probe /></auth.AuthProvider>);
  return { renders, current: () => latest!, unmount: view.unmount };
}

/** The build check and the reload, recorded. The server answers unless told otherwise. */
function fakeRecovery(check: BuildCheck = 'same') {
  return { checkServedBuild: vi.fn(async () => check), reload: vi.fn() } satisfies Recovery;
}

/** Records every sign-in report, with its bearer token. */
function recordSignInReports() {
  const reports: (string | null)[] = [];
  server.use(http.post('*/api/user/authevent', ({ request }) => {
    reports.push(request.headers.get('authorization'));
    return HttpResponse.json({ ok: true, kind: 'login' });
  }));
  return reports;
}

/** Records the Authorization header of each GET /api/test. */
function recordAuthorization() {
  const seen: (string | null)[] = [];
  server.use(http.get('*/api/test', ({ request }) => {
    seen.push(request.headers.get('authorization'));
    return HttpResponse.json({ ok: true });
  }));
  return seen;
}

beforeEach(() => {
  sb.imports = 0;
  sb.clients.length = 0;
  sb.createClient.mockClear();
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', ANON_KEY);
  window.history.replaceState(null, '', '/');
  freshPageLoad();
});

afterEach(async () => {
  sb.held?.release();
  await settle();
  vi.unstubAllEnvs();
  vi.doUnmock('@supabase/supabase-js');
  window.history.replaceState(null, '', '/');
  sessionStorage.clear();
});

describe('a visitor who is not signed in', () => {
  it('is signed out from the first render and never imports supabase-js', async () => {
    const reports = recordSignInReports();
    const { renders } = await mountAuth();
    expect(renders[0]).toBe('signed-out');
    await settle();
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    expect(renders).not.toContain('loading');
    expect(sb.imports).toBe(0);
    expect(sb.createClient).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });

  it('sends API requests without a token and without importing supabase-js', async () => {
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual([null]);
    expect(sb.imports).toBe(0);
  });

  it('writes no account preference and opens no live channel without importing supabase-js', async () => {
    const { saveLearningPreference } = await import('../src/lib/trackPref');
    const { joinMatchChannel } = await import('../src/lib/realtime');
    await expect(saveLearningPreference(null, { schemaVersion: 1, baseTrack: 'frontend', specialization: null }))
      .resolves.toMatchObject({ ok: false, reason: 'not_signed_in' });
    await settle();
    expect(sb.imports).toBe(0);
    const statuses: string[] = [];
    joinMatchChannel('ABC123').onStatus((status) => statuses.push(status));
    expect(statuses).toEqual(['DISCONNECTED']);
    await settle();
    expect(sb.imports).toBe(0);
  });

  it('treats a ?code= without a stored code verifier as no sign-in', async () => {
    window.history.replaceState(null, '', '/settings/github?code=from-another-provider&state=x');
    const { renders } = await mountAuth();
    await settle();
    expect(renders[0]).toBe('signed-out');
    expect(sb.imports).toBe(0);
  });
});

describe('a returning visitor with a stored session', () => {
  it('starts importing supabase-js while the modules evaluate, before anything renders', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    await import('../src/lib/auth');
    await waitFor(() => expect(sb.createClient).toHaveBeenCalledTimes(1));
    expect(sb.imports).toBe(1);
    // The default storage key: an explicit storageKey would sign users out.
    expect(sb.createClient).toHaveBeenCalledWith(PROJECT_URL, ANON_KEY, { auth: { flowType: 'pkce' } });
  });

  it('restores the user while the download is slow, without reporting a sign-in', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const reports = recordSignInReports();
    const { renders } = await mountAuth();
    await settle();
    expect(renders).toEqual(['loading']);
    expect(sb.createClient).not.toHaveBeenCalled();
    await releaseDownload();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await settle();
    // The provider subscribed before the client existed and was attached as it
    // was created, so it heard the SIGNED_IN that announces the restore...
    expect(sb.clients[0].heardRestore).toBe(1);
    // ...and a restore is not a sign-in.
    expect(reports).toEqual([]);
    expect(sb.imports).toBe(1);
  });

  it('keeps the account supabase-js announced when the session read misses its deadline', async () => {
    // supabase-js says the session is here, but getSession waits on its lock
    // (another tab holding it): the boot deadline must not sign the page out.
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const original = sb.createClient.getMockImplementation()!;
    sb.createClient.mockImplementationOnce((url, key, options) => {
      const client = original(url, key, options);
      client.auth.getSession.mockImplementation(() => new Promise(() => {}));
      return client;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await mountAuth();
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored');
      await act(async () => { await vi.advanceTimersByTimeAsync(8_001); });
      expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not restore a stale boot snapshot after a newer account event', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const original = sb.createClient.getMockImplementation()!;
    let finishBoot!: () => void;
    sb.createClient.mockImplementationOnce((url, key, options) => {
      const client = original(url, key, options);
      client.auth.getSession.mockImplementationOnce(() => new Promise((resolve) => {
        finishBoot = () => resolve({ data: { session: STORED }, error: null });
      }));
      return client;
    });
    recordSignInReports();
    await mountAuth();
    await waitFor(() => expect(finishBoot).toBeTypeOf('function'));
    const next = sb.sessionFor('next-access-token', 'user-next');
    await act(async () => {
      localStorage.setItem(KEY, JSON.stringify(next));
      sb.clients[0].emit('SIGNED_IN', next);
    });
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-next');
    await act(async () => { finishBoot(); });
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-next');
  });

  it('forgets a deleted account without signing out a replacement session', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    const replacement = sb.sessionFor('next-access-token', 'user-next');
    localStorage.setItem(KEY, JSON.stringify(replacement));
    expect(current().forgetDeletedAccount('user-stored')).toBe(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(replacement);
    expect(sb.clients[0].auth.signOut).not.toHaveBeenCalled();

    localStorage.setItem(KEY, JSON.stringify(STORED));
    act(() => expect(current().forgetDeletedAccount('user-stored')).toBe(true));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    expect(sb.clients[0].auth.signOut).not.toHaveBeenCalled();
  });

  it('forgets the deleted session in a second tab without clearing its replacement', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    const replacement = sb.sessionFor('next-access-token', 'user-next');
    const removed = (oldValue: string) => window.dispatchEvent(new window.StorageEvent('storage', {
      storageArea: localStorage,
      key: KEY,
      oldValue,
      newValue: null,
    }));

    // A delayed deletion event cannot discard a newer persisted session.
    localStorage.setItem(KEY, JSON.stringify(replacement));
    act(() => { removed(JSON.stringify(STORED)); });
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(replacement));
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored');
    recordSignInReports();
    await act(async () => { sb.clients[0].emit('SIGNED_IN', replacement); });
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-next');

    // With storage now empty, a stale event for the old account still cannot
    // wipe this tab. Only the event for the active account can finish it.
    localStorage.removeItem(KEY);
    localStorage.setItem('devshark:coding:draft:html-1', '// current account draft');
    act(() => { removed(JSON.stringify(STORED)); });
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-next');
    expect(localStorage.getItem('devshark:coding:draft:html-1')).not.toBeNull();
    localStorage.setItem('devshark:signed-out-by-choice', String(Date.now()));
    act(() => { removed(JSON.stringify(replacement)); });
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    expect(localStorage.getItem('devshark:coding:draft:html-1')).toBeNull();
    expect(localStorage.getItem('devshark:coding:kept:v1')).toBeNull();
  });

  it('restores the user when the client loaded before the provider mounted', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const reports = recordSignInReports();
    await import('../src/lib/supabaseClient');
    await waitFor(() => expect(sb.createClient).toHaveBeenCalledTimes(1));
    await settle();
    const { renders } = await mountAuth();
    expect(renders[0]).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await settle();
    expect(reports).toEqual([]);
    expect(sb.imports).toBe(1);
  });

  it('sends the stored access token with API requests', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual(['Bearer stored-access-token']);
    expect(sb.imports).toBe(1);
  });

  it('waits for a download still in flight, within the four-second limit, and sends the token', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(EXPIRING));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    const request = apiFetch('/api/test');
    await settle();
    expect(authorization).toEqual([]);
    await releaseDownload();
    await expect(request).resolves.toEqual({ ok: true });
    expect(authorization).toEqual(['Bearer stored-access-token']);
  });

  // Perf baseline #587 C10: supabase-js's getSession() hands out a stored token
  // unchanged until 90 s before it expires, so a request can carry that token
  // without waiting for the 54 KB download.
  it('sends a stored token far from its expiry at once, without waiting for the download', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual(['Bearer stored-access-token']);
    expect(sb.createClient).not.toHaveBeenCalled();
  });

  it('sends account-bound requests only with the named account’s token', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await expect(apiFetch('/api/test', { expectedUserId: 'user-stored' })).resolves.toEqual({ ok: true });
    await expect(apiFetch('/api/test', { expectedUserId: 'user-other' })).rejects.toMatchObject({ code: 'cancelled' });
    localStorage.removeItem(KEY);
    await expect(apiFetch('/api/test', { expectedUserId: 'user-stored' })).rejects.toMatchObject({ code: 'cancelled' });
    expect(authorization).toEqual(['Bearer stored-access-token']);
  });

  it('reads the stored token only while supabase-js would hand it out unchanged', async () => {
    const { freshStoredAccessToken, TOKEN_EXPIRY_MARGIN_MS } = await import('../src/lib/supabaseClient');
    const now = Date.now();
    const store = (session: unknown) => localStorage.setItem(KEY, JSON.stringify(session));
    store({ ...STORED, expires_at: Math.floor((now + TOKEN_EXPIRY_MARGIN_MS) / 1000) + 5 });
    expect(freshStoredAccessToken(now)).toBe('stored-access-token');
    store({ ...STORED, expires_at: Math.floor((now + TOKEN_EXPIRY_MARGIN_MS) / 1000) - 1 });
    expect(freshStoredAccessToken(now)).toBeNull();
    store({ ...STORED, refresh_token: undefined });
    expect(freshStoredAccessToken(now)).toBeNull();
    store({ ...STORED, expires_at: undefined });
    expect(freshStoredAccessToken(now)).toBeNull();
    localStorage.setItem(KEY, '{not json');
    expect(freshStoredAccessToken(now)).toBeNull();
    localStorage.removeItem(KEY);
    expect(freshStoredAccessToken(now)).toBeNull();
  });

  it('waits for supabase-js on an OAuth return, though another account’s fresh session is stored', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    localStorage.setItem(`${KEY}-code-verifier`, '"verifier"');
    window.history.replaceState(null, '', '/?code=oauth-access-token');
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    const request = apiFetch('/api/test');
    await settle();
    expect(authorization).toEqual([]);
    await releaseDownload();
    await expect(request).resolves.toEqual({ ok: true });
    expect(authorization).toEqual(['Bearer pkce-oauth-access-token']);
  });

  // Perf baseline #587 C10: the settings, the Learn map, the path catalog and
  // a lesson are the same for every caller, so they do not wait for the
  // supabase-js download or the session read, and carry no token.
  it('sends the public reads at once and without a token, while an account read still waits for it', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(EXPIRING));
    const seen: { path: string; authorization: string | null }[] = [];
    const record = ({ request }: { request: Request }) => {
      const url = new URL(request.url);
      seen.push({ path: `${url.pathname}${url.search}`, authorization: request.headers.get('authorization') });
      return HttpResponse.json({ ok: true });
    };
    server.use(http.get('*/api/settings', record), http.get('*/api/quiz/roadmap', record), http.get('*/api/test', record));
    const { apiFetch } = await import('../src/lib/api');
    const publicReads = [
      '/api/settings',
      '/api/quiz/roadmap',
      '/api/quiz/roadmap?resource=learning-path-catalog',
      '/api/quiz/roadmap?resource=lesson&id=html-1',
    ];
    const account = apiFetch('/api/test');
    const progress = apiFetch('/api/quiz/roadmap?resource=progress');
    const level = apiFetch('/api/quiz/roadmap?topic=html&level=1');
    await Promise.all(publicReads.map((url) => apiFetch(url)));
    expect(seen).toEqual(publicReads.map((path) => ({ path, authorization: null })));
    expect(sb.createClient).not.toHaveBeenCalled();
    await releaseDownload();
    await Promise.all([account, progress, level]);
    expect(seen.slice(publicReads.length).map((one) => one.authorization)).toEqual(['Bearer stored-access-token', 'Bearer stored-access-token', 'Bearer stored-access-token']);
  });

  it('counts only GETs of the documented shapes as public reads', async () => {
    const { isPublicRead } = await import('../src/lib/api');
    expect(isPublicRead('/api/settings', undefined)).toBe(true);
    expect(isPublicRead('/api/quiz/roadmap', 'GET')).toBe(true);
    expect(isPublicRead('/api/quiz/roadmap?resource=learning-path-catalog', 'get')).toBe(true);
    expect(isPublicRead('/api/quiz/roadmap?resource=lesson&id=html-1', undefined)).toBe(true);
    // A coding task's brief reads nobody (#587 C23); the caller's part does.
    expect(isPublicRead('/api/quiz/roadmap?resource=coding-brief&id=js-double-numbers', 'GET')).toBe(true);
    for (const url of [
      '/api/quiz/roadmap?id=x&resource=lesson',
      '/api/quiz/roadmap?resource=lesson&id=',
      '/api/settings/',
      '/api/quiz/roadmap?resource=progress',
      '/api/quiz/roadmap?topic=html&level=1',
      '/api/quiz/roadmap?topic=html',
      '/api/quiz/roadmap?resource=lesson&id=x&level=1',
      '/api/quiz/roadmap?resource=lesson&resource=lesson&id=x',
      '/api/quiz/roadmap?resource=learning-path-start',
      '/api/quiz/roadmap?resource=coding-task&id=x',
      '/api/quiz/roadmap?resource=coding-state&id=x',
      '/api/quiz/roadmap?resource=coding-brief&id=',
      '/api/quiz/roadmap?resource=coding-brief&id=x&user_id=y',
      '/api/settings?admin=1',
      '/api/leaderboard',
      '/api/user/[op]?op=entitlement',
      'https://elsewhere.example/api/settings',
    ]) expect(isPublicRead(url, 'GET')).toBe(false);
    expect(isPublicRead('/api/quiz/roadmap', 'POST')).toBe(false);
    expect(isPublicRead('/api/settings', 'PUT')).toBe(false);
  });

  it('sends nothing when the stored session is not read within the four-second limit, and says why', async () => {
    // A signed-in learner whose token refresh is slow: sent without the token,
    // a quiz submit would be graded as a guest's and its one-time claim spent.
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(EXPIRING));
    const authorization = recordAuthorization();
    const { apiFetch, friendlyError } = await import('../src/lib/api');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const request = apiFetch('/api/test').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(4_001);
    vi.useRealTimers();
    const error = await request;
    expect(error).toMatchObject({ status: 0, code: 'auth_unavailable' });
    expect(friendlyError(error)).toBe('We couldn’t confirm your sign-in, so nothing was saved. Check your connection and try again.');
    expect(authorization).toEqual([]);
    // The retry, once the session can be read, goes out signed in.
    await releaseDownload();
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual(['Bearer stored-access-token']);
  });

  it('sends nothing while supabase-js keeps a session it could not refresh', async () => {
    // An expired token whose refresh met a network error: supabase-js answers
    // no session and keeps the stored one for the next try.
    localStorage.setItem(KEY, JSON.stringify(EXPIRING));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await waitFor(() => expect(sb.createClient).toHaveBeenCalledTimes(1));
    const offline = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 });
    sb.clients[0].auth.getSession.mockImplementationOnce(async () => ({ data: { session: null }, error: offline }) as never);
    await expect(apiFetch('/api/test')).rejects.toMatchObject({ status: 0, code: 'auth_unavailable' });
    expect(authorization).toEqual([]);
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('sends a request without a token once supabase-js has removed a session it cannot refresh', async () => {
    // A revoked refresh token: supabase-js removes the session and signs out,
    // so this browser is a guest's again.
    localStorage.setItem(KEY, JSON.stringify(EXPIRING));
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await waitFor(() => expect(sb.createClient).toHaveBeenCalledTimes(1));
    sb.clients[0].auth.getSession.mockImplementationOnce(async () => {
      localStorage.removeItem(KEY);
      return { data: { session: null }, error: null } as never;
    });
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual([null]);
  });

  it('signs out through the loaded client', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await act(() => current().signOut());
    expect(sb.clients[0].auth.signOut).toHaveBeenCalledTimes(1);
    // Log out ends this browser's session only; supabase-js would otherwise
    // sign the account out on every device.
    expect(sb.clients[0].auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    expect(sb.imports).toBe(1);
  });

  it('signs out on every device only when asked to', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await act(() => current().signOut('global'));
    expect(sb.clients[0].auth.signOut).toHaveBeenCalledTimes(1);
    expect(sb.clients[0].auth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
  });

  it('saves a preference with the token, then refreshes the session through the loaded client', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const writes: (string | null)[] = [];
    server.use(http.put(/\/api\/user\/\[op\]/, ({ request }) => {
      writes.push(request.headers.get('authorization'));
      return HttpResponse.json({ ok: true });
    }));
    const { saveLearningPreference } = await import('../src/lib/trackPref');
    await expect(saveLearningPreference('user-stored', { schemaVersion: 1, baseTrack: 'backend', specialization: null }))
      .resolves.toMatchObject({ ok: true });
    expect(writes).toEqual(['Bearer stored-access-token']);
    expect(sb.clients[0].auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(sb.imports).toBe(1);
  });

  it('opens a live match channel on the loaded client', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    const channel = { subscribe: vi.fn(), send: vi.fn(), on: vi.fn() };
    const client = sb.clients[0] as unknown as { channel: (name: string) => typeof channel };
    client.channel = vi.fn(() => channel);
    const { joinMatchChannel } = await import('../src/lib/realtime');
    joinMatchChannel('ABC123');
    expect(client.channel).toHaveBeenCalledWith('match:ABC123', { config: { broadcast: { self: true } } });
    expect(channel.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('an OAuth return', () => {
  it('imports supabase-js at once, and the sign-in is reported with its token', async () => {
    freshPageLoad('held');
    localStorage.setItem(`${KEY}-code-verifier`, '"verifier"');
    window.history.replaceState(null, '', '/?code=oauth-access-token');
    const reports = recordSignInReports();
    const { renders } = await mountAuth();
    expect(renders[0]).toBe('loading');
    await settle();
    expect(sb.imports).toBe(1);
    await releaseDownload();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-pkce'));
    await waitFor(() => expect(reports).toEqual(['Bearer pkce-oauth-access-token']));
    expect(window.location.search).toBe('');
  });

  it('sends a sign-in report the server never answered again on the next sign-in, and a delivered one only once', async () => {
    localStorage.setItem(`${KEY}-code-verifier`, '"verifier"');
    window.history.replaceState(null, '', '/?code=oauth-access-token');
    const statuses = [503, 200];
    const reports: number[] = [];
    server.use(http.post('*/api/user/authevent', () => {
      const status = statuses.shift() ?? 200;
      reports.push(status);
      return status === 200
        ? HttpResponse.json({ ok: true, kind: 'register' })
        : HttpResponse.json({ error: { code: 'upstream_timeout', message: 'Try again' } }, { status });
    }));
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-pkce'));
    await waitFor(() => expect(reports).toEqual([503]));
    await settle();
    // supabase-js announces the session again (the tab is shown again).
    const session = sb.sessionFor('pkce-oauth-access-token', 'user-pkce');
    await act(async () => sb.clients[0].emit('SIGNED_IN', session));
    await waitFor(() => expect(reports).toEqual([503, 200]));
    await settle();
    await act(async () => sb.clients[0].emit('SIGNED_IN', session));
    await settle();
    expect(reports).toEqual([503, 200]);
  });

  it('imports supabase-js for an error return too, which supabase-js reads', async () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_description=The+user+denied+the+request');
    const { renders } = await mountAuth();
    expect(renders[0]).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signed-out'));
    expect(sb.imports).toBe(1);
  });

  it('imports supabase-js for a PKCE ?code= whose verifier this browser stored, and reports the sign-in', async () => {
    localStorage.setItem(`${KEY}-code-verifier`, '"verifier"');
    window.history.replaceState(null, '', '/?code=pkce-code');
    const reports = recordSignInReports();
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-pkce'));
    expect(sb.imports).toBe(1);
    await waitFor(() => expect(reports).toEqual(['Bearer pkce-pkce-code']));
  });
});

describe('signing in', () => {
  it('imports supabase-js on the click and starts the Google redirect', async () => {
    const { current } = await mountAuth();
    await settle();
    expect(sb.imports).toBe(0);
    await act(() => current().signInWithGoogle('/premium'));
    expect(sb.imports).toBe(1);
    expect(sb.clients[0].auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    expect(sessionStorage.getItem('devshark:auth-return')).toContain('"/premium"');
  });

  it('comes back to the page it was pressed on when no return path is given', async () => {
    // A student opens a classroom invite signed out and presses Log in.
    window.history.replaceState(null, '', '/play/K7Q2AB?from=invite#join');
    const { current } = await mountAuth();
    await act(() => current().signInWithGoogle());
    expect(sb.clients[0].auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    const { takeAuthReturn } = await import('../src/lib/authReturn');
    // Taken once the account arrives, within fifteen minutes...
    const saved = sessionStorage.getItem('devshark:auth-return');
    expect(takeAuthReturn()).toBe('/play/K7Q2AB?from=invite#join');
    // ...and never after that.
    sessionStorage.setItem('devshark:auth-return', saved!);
    expect(takeAuthReturn(Date.now() + 16 * 60_000)).toBeNull();
  });

  it('records no return from the home page, and a named return path wins', async () => {
    const { current } = await mountAuth();
    await act(() => current().signInWithGoogle());
    expect(sessionStorage.getItem('devshark:auth-return')).toBeNull();
    window.history.replaceState(null, '', '/premium/success?session_id=cs_1');
    await act(() => current().signInWithGoogle('/premium'));
    expect(JSON.parse(sessionStorage.getItem('devshark:auth-return')!).path).toBe('/premium');
  });

  it('fails the sign-in and forgets the return when the download fails', async () => {
    freshPageLoad('fails');
    const { current } = await mountAuth();
    await expect(current().signInWithGoogle('/premium')).rejects.toThrow();
    expect(sessionStorage.getItem('devshark:auth-return')).toBeNull();
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
  });

  // Perf baseline #587 C30: supabase-js says SIGNED_IN for the stored session
  // each time the tab is shown again, and every new tab sent a sign-in report
  // (an Auth call and a log row) on its first return.
  it('reports no sign-in when supabase-js announces the restored session again as the tab is shown', async () => {
    const jwt = (sessionId: string) => `e30.${btoa(JSON.stringify({ sub: 'user-stored', session_id: sessionId })).replace(/=+$/, '')}.sig`;
    const restoredSession = { ...STORED, access_token: jwt('session-a') };
    localStorage.setItem(KEY, JSON.stringify(restoredSession));
    const reports = recordSignInReports();
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await settle();
    // The tab is shown again: the same sign-in, its token refreshed meanwhile.
    await act(async () => sb.clients[0].emit('SIGNED_IN', restoredSession));
    await act(async () => sb.clients[0].emit('SIGNED_IN', { ...restoredSession, access_token: jwt('session-a').replace('.sig', '.refreshed') }));
    await settle();
    expect(reports).toEqual([]);
    // A sign-in in this tab is a new Auth session, and is reported once.
    const signedInAgain = { ...restoredSession, access_token: jwt('session-b') };
    localStorage.setItem(KEY, JSON.stringify(signedInAgain));
    await act(async () => sb.clients[0].emit('SIGNED_IN', signedInAgain));
    await waitFor(() => expect(reports).toEqual([`Bearer ${jwt('session-b')}`]));
    await act(async () => sb.clients[0].emit('SIGNED_IN', signedInAgain));
    await settle();
    expect(reports).toHaveLength(1);
  });

  it('still reports a sign-in after a sign-out in a tab that restored a session', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const reports = recordSignInReports();
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await settle();
    await act(async () => sb.clients[0].emit('SIGNED_IN', STORED));
    await settle();
    expect(reports).toEqual([]);
    localStorage.removeItem(KEY);
    await act(async () => sb.clients[0].emit('SIGNED_OUT', null));
    // The same account signs in again: a sign-in, though nothing in its
    // non-JWT token tells the two sessions apart.
    localStorage.setItem(KEY, JSON.stringify(STORED));
    await act(async () => sb.clients[0].emit('SIGNED_IN', STORED));
    await waitFor(() => expect(reports).toEqual(['Bearer stored-access-token']));
  });

  it('in another tab loads supabase-js here and restores the user', async () => {
    const reports = recordSignInReports();
    const { renders } = await mountAuth();
    await settle();
    expect(sb.imports).toBe(0);
    // The other tab's supabase-js writes the session; this tab hears the storage event.
    localStorage.setItem(KEY, JSON.stringify(STORED));
    act(() => {
      window.dispatchEvent(new window.StorageEvent('storage', { key: KEY, newValue: JSON.stringify(STORED) }));
    });
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    expect(sb.imports).toBe(1);
    expect(renders).not.toContain('loading');
    // The tab that signed in reports the sign-in; this one restored it.
    expect(reports).toEqual([]);
  });
});

describe('signing out', () => {
  // What an account leaves on the device, and the device's own settings.
  const ACCOUNT_LOCAL = {
    'devquiz:roadmap:v2': JSON.stringify({ html: { levels: { 1: { passed: true, bestPct: 100 } }, checkpoints: {} } }),
    'devquiz:roadmap:unlocks:v1': '["react"]',
    'devquiz:roadmap:track': '"backend"',
    'devquiz:xp:quest:v2': '{"webdev":340}',
    'devquiz:xp:rank-seen:v2': '{"webdev":3}',
    'devquiz:tokens:balance:v2': '{"webdev":500}',
    'devquiz:shop:inventory:v2': '{"webdev":{"owned":["ring-gold"],"ring":"ring-gold","flair":null,"doubleXp":0}}',
    'devquiz:perfect-quiz-count': '2',
    'devquiz:bookmarks': '["q1"]',
    'devquiz:bookmarked-questions': '[{"id":"q1"}]',
    'devquiz:devshark:learning-preference:user-stored': '{"schemaVersion":1,"baseTrack":"backend","specialization":null}',
    'devshark:coding:draft:html-forms-1': 'const mine = true;',
    'devshark:typing:v1': '{"bestWpm":61}',
    'devshark:leaderboard:v1:30d:': '{"savedAt":1,"data":{}}',
    'devshark:referral': JSON.stringify({ code: 'ABCD2345', savedAt: Date.now() }),
    'studyshark:pending-quiz-receipt:v1': '{"userId":"user-stored","profile":{"email":"user-stored@example.test"}}',
    'studyshark:pending-challenge-reward:v1': '{"userId":"user-stored"}',
  };
  const ACCOUNT_SESSION = {
    'devquiz:in-progress': '{"sessionId":"s1"}',
    'devquiz:dev-password': 'admin-secret',
    'devshark:voucher-prefill': 'LAUNCH55',
  };
  const DEVICE_LOCAL = {
    'devquiz:color-mode': 'dark',
    'devquiz:settings': '{"soundEffects":true}',
    'devquiz.lang': 'en',
    'devquiz:quiz-setup:v1': '{"count":10}',
    'devshark:coding:layout:v1': '{"split":60}',
    'devshark:campaign': '{"campaign":{"utm_source":"threads"},"savedAt":1}',
    'devquiz:devshark:learning-preference:guest': '{"schemaVersion":1,"baseTrack":"frontend","specialization":null}',
  };
  const DEVICE_SESSION = {
    'devshark:auth-return': JSON.stringify({ path: '/learn', at: Date.now() }),
    'devquiz:register-prompt:dismissed:v1': '1',
  };
  const seed = (storage: Storage, entries: Record<string, string>) => Object.entries(entries).forEach(([key, value]) => storage.setItem(key, value));
  const kept = (storage: Storage, entries: Record<string, string>) => Object.keys(entries).filter((key) => storage.getItem(key) !== null);

  afterEach(() => localStorage.clear());

  it('forgets the account’s data on this device, keeps the device’s settings, and shows the empty state at once', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, { ...ACCOUNT_LOCAL, ...DEVICE_LOCAL });
    seed(sessionStorage, { ...ACCOUNT_SESSION, ...DEVICE_SESSION });
    const { current } = await mountAuth();
    const { useRoadmapProgress } = await import('../src/lib/roadmap');
    function Passed() {
      return <p data-testid="passed">{Object.keys(useRoadmapProgress()).join(',') || 'none'}</p>;
    }
    render(<Passed />);
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    expect(screen.getByTestId('passed')).toHaveTextContent('html');

    await act(() => current().signOut());
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    expect(kept(sessionStorage, ACCOUNT_SESSION)).toEqual([]);
    expect(kept(localStorage, DEVICE_LOCAL)).toEqual(Object.keys(DEVICE_LOCAL));
    expect(kept(sessionStorage, DEVICE_SESSION)).toEqual(Object.keys(DEVICE_SESSION));
    // The page that was open when the account left no longer shows its progress.
    expect(screen.getByTestId('passed')).toHaveTextContent('none');
  });

  it('forgets the account’s data on this device when it signs out on every device too', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, { ...ACCOUNT_LOCAL, ...DEVICE_LOCAL });
    seed(sessionStorage, { ...ACCOUNT_SESSION, ...DEVICE_SESSION });
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await act(() => current().signOut('global'));
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    expect(kept(sessionStorage, ACCOUNT_SESSION)).toEqual([]);
    expect(kept(localStorage, DEVICE_LOCAL)).toEqual(Object.keys(DEVICE_LOCAL));
  });

  it('keeps a guest’s progress through a sign-in, and forgets it with the account', async () => {
    seed(localStorage, ACCOUNT_LOCAL);
    const { current } = await mountAuth();
    await settle();
    // Signed in from another tab: signing in clears nothing.
    localStorage.setItem(KEY, JSON.stringify(STORED));
    act(() => {
      window.dispatchEvent(new window.StorageEvent('storage', { key: KEY, newValue: JSON.stringify(STORED) }));
    });
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual(Object.keys(ACCOUNT_LOCAL));
    await act(() => current().signOut());
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
  });

  it('leaves a guest’s progress alone when supabase-js signs out a failed OAuth return', async () => {
    seed(localStorage, ACCOUNT_LOCAL);
    window.history.replaceState(null, '', '/#error=access_denied&error_description=The+user+denied+the+request');
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signed-out'));
    act(() => sb.clients[0].emit('SIGNED_OUT', null));
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual(Object.keys(ACCOUNT_LOCAL));
  });

  it.each([
    ['offline', { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }],
    ['while the sign-in service answers 500', { name: 'AuthApiError', status: 500, message: 'Internal server error' }],
  ])('logs out of this browser %s: the session, its code verifier and the account’s data go', async (_when, failure) => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    localStorage.setItem(`${KEY}-code-verifier`, 'verifier');
    seed(localStorage, { ...ACCOUNT_LOCAL, ...DEVICE_LOCAL });
    seed(sessionStorage, { ...ACCOUNT_SESSION, ...DEVICE_SESSION });
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    // supabase-js 2.110 refuses the local sign-out and keeps the session.
    sb.clients[0].auth.signOut.mockImplementationOnce(async () => ({ error: Object.assign(new Error(failure.message), failure) }) as never);

    await act(() => current().signOut());
    expect(sb.clients[0].auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(`${KEY}-code-verifier`)).toBeNull();
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    expect(kept(sessionStorage, ACCOUNT_SESSION)).toEqual([]);
    expect(kept(localStorage, DEVICE_LOCAL)).toEqual(Object.keys(DEVICE_LOCAL));
    // The next request is a guest's.
    const authorization = recordAuthorization();
    const { apiFetch } = await import('../src/lib/api');
    await expect(apiFetch('/api/test')).resolves.toEqual({ ok: true });
    expect(authorization).toEqual([null]);
  });

  it('still says so when signing out everywhere fails offline, and keeps the session', async () => {
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    sb.clients[0].auth.signOut.mockImplementationOnce(async () => ({ error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) }) as never);
    await act(() => expect(current().signOut('global')).rejects.toThrow('Failed to fetch'));
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored');
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('logs out of this browser when supabase-js could not be downloaded', async () => {
    freshPageLoad('fails');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, ACCOUNT_LOCAL);
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).not.toHaveTextContent('loading'));
    await act(() => current().signOut());
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
  });

  it('forgets the data of an account whose stored session supabase-js finds expired, and keeps its coding drafts for it', async () => {
    freshPageLoad('held');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, ACCOUNT_LOCAL);
    const { current } = await mountAuth();
    // supabase-js cannot refresh the stored session: it removes it and signs out.
    localStorage.removeItem(KEY);
    await releaseDownload();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signed-out'));
    act(() => sb.clients[0].emit('SIGNED_OUT', null));
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    // Read from the stored session before supabase-js removed it.
    expect(keptDrafts()).toEqual({ userId: 'user-stored', drafts: { 'devshark:coding:draft:html-forms-1': 'const mine = true;' } });
    expect(current().draftsKept).toBe(true);
  });

  // Owner decision 4 (C5-1): a session that ended on its own (a refresh
  // refused because it expired, was revoked, or the password changed on
  // another device) erased every coding draft here without a word, as a
  // chosen Log out does.
  const DRAFTS = {
    'devshark:coding:draft:js-digit-sum': '// twenty minutes of work',
    'devshark:coding:draft-time:js-digit-sum': '{"base":"2026-10-09T10:00:00.000Z"}',
  };
  const keptDrafts = () => JSON.parse(localStorage.getItem('devshark:coding:kept:v1') ?? 'null') as unknown;
  /** Signed in as the stored account, with its drafts on the device; then
   * supabase-js signs out on its own, as when a refresh is refused. */
  async function sessionEnds() {
    recordSignInReports();
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, { ...ACCOUNT_LOCAL, ...DRAFTS, ...DEVICE_LOCAL });
    const auth = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    localStorage.removeItem(KEY);
    act(() => sb.clients[0].emit('SIGNED_OUT', null));
    return auth;
  }
  const signIn = (userId: string) => act(() => {
    const session = sb.sessionFor(`${userId}-token`, userId);
    localStorage.setItem(KEY, JSON.stringify(session));
    sb.clients[0].emit('SIGNED_IN', session);
  });

  it('keeps the coding drafts for the account when its session ends on its own, out of sight, and says so', async () => {
    const { current } = await sessionEnds();
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
    // Nothing of the account is left in sight, drafts included.
    expect(kept(localStorage, { ...ACCOUNT_LOCAL, ...DRAFTS })).toEqual([]);
    expect(kept(localStorage, DEVICE_LOCAL)).toEqual(Object.keys(DEVICE_LOCAL));
    expect(keptDrafts()).toEqual({ userId: 'user-stored', drafts: { 'devshark:coding:draft:html-forms-1': 'const mine = true;', ...DRAFTS } });
    expect(current().draftsKept).toBe(true);
  });

  /** A coding task opens, which takes back what was kept for the account
   * signed in (coding/drafts.ts). */
  const openTask = async () => (await import('../src/coding/drafts')).openingDraft('js-digit-sum', null, null);

  it('gives the drafts back when the same account signs in again and opens a coding task', async () => {
    const { current } = await sessionEnds();
    await signIn('user-stored');
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored');
    expect(current().draftsKept).toBe(false);
    expect((await openTask()).code).toBe('// twenty minutes of work');
    expect(Object.fromEntries(Object.keys(DRAFTS).map((key) => [key, localStorage.getItem(key)]))).toEqual(DRAFTS);
    expect(keptDrafts()).toBeNull();
  });

  it('deletes them unread when another account signs in on this device', async () => {
    await sessionEnds();
    await signIn('user-other');
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-other');
    expect(keptDrafts()).toBeNull();
    expect((await openTask()).code).toBeNull();
    expect(kept(localStorage, DRAFTS)).toEqual([]);
  });

  it('forgets the account’s data when another account’s session replaces it without a sign-out', async () => {
    // An email link of another account opened in this browser: supabase-js
    // saves its session over the stored one and announces only SIGNED_IN.
    const reports = recordSignInReports();
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, { ...ACCOUNT_LOCAL, ...DEVICE_LOCAL });
    seed(sessionStorage, ACCOUNT_SESSION);
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    const { accountEpoch } = await import('../src/lib/accountData');
    const before = accountEpoch();
    // This tab reported a sign-in of the account here earlier.
    sessionStorage.setItem('devquiz:auth-reported', '1');
    await signIn('user-other');
    expect(screen.getByTestId('auth')).toHaveTextContent('user:user-other');
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual([]);
    expect(kept(sessionStorage, ACCOUNT_SESSION)).toEqual([]);
    expect(kept(localStorage, DEVICE_LOCAL)).toEqual(Object.keys(DEVICE_LOCAL));
    // Work still out for the account that left writes nothing.
    expect(accountEpoch()).toBeGreaterThan(before);
    // The arriving account's sign-in is reported, even after one earlier in this tab.
    await waitFor(() => expect(reports).toEqual(['Bearer user-other-token']));
    // The same account again (a token refresh) forgets nothing.
    seed(localStorage, ACCOUNT_LOCAL);
    await signIn('user-other');
    expect(kept(localStorage, ACCOUNT_LOCAL)).toEqual(Object.keys(ACCOUNT_LOCAL));
  });

  it('opens nothing kept for the account to a guest', async () => {
    await sessionEnds();
    expect((await openTask()).code).toBeNull();
    expect(keptDrafts()).not.toBeNull();
  });

  it('sets a guest’s copy written since aside, beside the account’s, when the account comes back', async () => {
    await sessionEnds();
    localStorage.setItem('devshark:coding:draft:js-digit-sum', '// typed as a guest since');
    localStorage.setItem('devshark:coding:draft-time:js-digit-sum', '{"base":null}');
    await signIn('user-stored');
    expect(await openTask()).toMatchObject({ code: '// twenty minutes of work', setAside: '// typed as a guest since' });
    expect(localStorage.getItem('devshark:coding:draft-time:js-digit-sum')).toBe('{"base":"2026-10-09T10:00:00.000Z"}');
    expect(localStorage.getItem('devshark:coding:draft-aside:js-digit-sum')).toBe('// typed as a guest since');
  });

  it('erases the drafts on a Log out the learner pressed, in this tab or another', async () => {
    recordSignInReports();
    localStorage.setItem(KEY, JSON.stringify(STORED));
    seed(localStorage, DRAFTS);
    const { current } = await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await act(() => current().signOut());
    expect(kept(localStorage, DRAFTS)).toEqual([]);
    expect(keptDrafts()).toBeNull();
    expect(current().draftsKept).toBe(false);

    // Another tab's Log out reaches this one as supabase-js's own SIGNED_OUT,
    // with the mark that tab left.
    await signIn('user-stored');
    seed(localStorage, DRAFTS);
    localStorage.setItem('devshark:signed-out-by-choice', String(Date.now()));
    localStorage.removeItem(KEY);
    act(() => sb.clients[0].emit('SIGNED_OUT', null));
    expect(kept(localStorage, DRAFTS)).toEqual([]);
    expect(keptDrafts()).toBeNull();
    expect(current().draftsKept).toBe(false);
  });

  it('keeps a guest’s drafts through a failed OAuth return, as before', async () => {
    seed(localStorage, DRAFTS);
    window.history.replaceState(null, '', '/#error=access_denied&error_description=The+user+denied+the+request');
    await mountAuth();
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signed-out'));
    act(() => sb.clients[0].emit('SIGNED_OUT', null));
    expect(kept(localStorage, DRAFTS)).toEqual(Object.keys(DRAFTS));
    expect(keptDrafts()).toBeNull();
  });
});

describe('signing in after a failed download', () => {
  // Chromium up to 155 and Safari remember a failed module fetch, so every
  // later import of supabase-js fails at once. The mocked download fails every
  // time, as such a browser would.
  const RETURN = 'devshark:auth-return';
  const RESUME = 'devshark:auth-resume';
  const returnTo = (path: string) => sessionStorage.setItem(RETURN, JSON.stringify({ path, at: Date.now() }));

  it('reloads on the second press, and the next document finishes the sign-in back to the page that asked', async () => {
    freshPageLoad('fails');
    const recovery = fakeRecovery();
    const first = await mountAuth(recovery);
    await expect(first.current().signInWithGoogle('/premium')).rejects.toThrow('Failed to fetch dynamically imported module');
    // One failure is a press that failed: the button says so, nothing reloads.
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN)).toBeNull();

    // The same failure straight back: this press reloads, once the server answers.
    void first.current().signInWithGoogle('/premium').catch(() => undefined);
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1);
    // Where the learner wanted to go survives the reload, with the sign-in.
    expect(sessionStorage.getItem(RETURN)).toContain('"/premium"');
    expect(sessionStorage.getItem(RESUME)).not.toBeNull();

    // The next document downloads the library and leaves for Google.
    first.unmount();
    freshPageLoad('instant');
    const next = await mountAuth(fakeRecovery());
    await vi.waitFor(() => expect(sb.clients[0]?.auth.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(sb.clients[0].auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: window.location.origin } });
    expect(sessionStorage.getItem(RETURN)).toContain('"/premium"');
    expect(sessionStorage.getItem(RESUME)).toBeNull();
    expect(next.current().signInResumeFailed).toBe(false);
  });

  it('reloads nothing offline or while the server does not answer, and the press forgets the return', async () => {
    freshPageLoad('fails');
    const recovery = fakeRecovery('unreachable');
    const { current } = await mountAuth(recovery);
    await expect(current().signInWithGoogle('/premium')).rejects.toThrow();
    await expect(current().signInWithGoogle('/premium')).rejects.toThrow();
    expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1);
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN)).toBeNull();
    expect(sessionStorage.getItem(RESUME)).toBeNull();

    // Offline nothing is asked at all: a reload would show the browser's offline page.
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      await expect(current().signInWithGoogle('/premium')).rejects.toThrow();
    } finally {
      delete (window.navigator as { onLine?: boolean }).onLine;
    }
    expect(recovery.checkServedBuild).toHaveBeenCalledTimes(1);
    expect(recovery.reload).not.toHaveBeenCalled();
  });

  it('gives the press back when the page refuses the reload, and forgets the return', async () => {
    freshPageLoad('fails');
    const recovery = fakeRecovery();
    const { current } = await mountAuth(recovery);
    await expect(current().signInWithGoogle('/premium')).rejects.toThrow();
    vi.useFakeTimers();
    try {
      const outcome = current().signInWithGoogle('/premium').then(() => 'signed in', () => 'failed');
      await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
      expect(sessionStorage.getItem(RESUME)).not.toBeNull();
      // The leave-page prompt kept this document: after the grace the press fails.
      await vi.advanceTimersByTimeAsync(RELOAD_GRACE_MS);
      expect(await outcome).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
    expect(sessionStorage.getItem(RESUME)).toBeNull();
    expect(sessionStorage.getItem(RETURN)).toBeNull();
  });

  it('never reloads for a download that failed in the background; the first press after it does', async () => {
    // A stored session starts the download while the modules evaluate.
    freshPageLoad('fails');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    const recovery = fakeRecovery();
    const { current } = await mountAuth(recovery);
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('signed-out'));
    // Another tab signing in asks for the library again, in the background too.
    act(() => {
      window.dispatchEvent(new window.StorageEvent('storage', { key: KEY, newValue: JSON.stringify(STORED) }));
    });
    await settle();
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();

    void current().signInWithGoogle().catch(() => undefined);
    await vi.waitFor(() => expect(recovery.reload).toHaveBeenCalledTimes(1));
    localStorage.removeItem(KEY);
  });

  it('lets a stale mark go, with the return path, and downloads nothing', async () => {
    sessionStorage.setItem(RESUME, String(Date.now() - RESUME_MAX_AGE_MS - 1_000));
    returnTo('/premium');
    const { renders } = await mountAuth(fakeRecovery());
    await settle();
    expect(sb.imports).toBe(0);
    expect(renders).not.toContain('loading');
    expect(sessionStorage.getItem(RESUME)).toBeNull();
    expect(sessionStorage.getItem(RETURN)).toBeNull();
  });

  it('takes an account already here as the sign-in: no second trip to Google, and the return path stays for it', async () => {
    sessionStorage.setItem(RESUME, String(Date.now()));
    returnTo('/premium');
    localStorage.setItem(KEY, JSON.stringify(STORED));
    await mountAuth(fakeRecovery());
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('user:user-stored'));
    await settle();
    expect(sb.clients[0].auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN)).toContain('"/premium"');
    localStorage.removeItem(KEY);
  });

  it('says when the sign-in it carried over fails again, reloads nothing and forgets the return', async () => {
    freshPageLoad('fails');
    sessionStorage.setItem(RESUME, String(Date.now()));
    returnTo('/premium');
    const recovery = fakeRecovery();
    const { current } = await mountAuth(recovery);
    await vi.waitFor(() => expect(current().signInResumeFailed).toBe(true));
    expect(recovery.checkServedBuild).not.toHaveBeenCalled();
    expect(recovery.reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN)).toBeNull();
    expect(screen.getByTestId('auth')).toHaveTextContent('signed-out');
  });
});

describe('the storage key', () => {
  it('is only derived from a URL supabase-js accepts', async () => {
    const { sessionKeyFor } = await import('../src/lib/supabaseClient');
    expect(sessionKeyFor(PROJECT_URL)).toBe(KEY);
    expect(sessionKeyFor(`  ${PROJECT_URL}/  `)).toBe(KEY);
    expect(sessionKeyFor('testprojectref.supabase.co')).toBeNull();
    expect(sessionKeyFor('')).toBeNull();
    expect(sessionKeyFor(undefined)).toBeNull();
  });
});
