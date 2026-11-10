// The plan read (lib/entitlement.ts): when it is asked, and how often it is
// asked again. Perf baseline #587 C14 and C29.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';

const PROJECT_URL = 'https://testprojectref.supabase.co';
const KEY = 'sb-testprojectref-auth-token';
const session = (expiresInS: number) => ({
  access_token: 'stored-access-token',
  refresh_token: 'stored-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + expiresInS,
  user: { id: 'user-stored', user_metadata: {} },
});

/** Every plan read, with its bearer token. */
function recordPlanReads(tier: 'free' | 'premium' = 'free') {
  const reads: (string | null)[] = [];
  server.use(http.get('*/api/user/*', ({ request }) => {
    if (new URL(request.url).searchParams.get('op') !== 'entitlement') return undefined;
    reads.push(request.headers.get('authorization'));
    return HttpResponse.json({ tier, source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null });
  }));
  return reads;
}

/** A page load: fresh modules, and a supabase-js that never finishes loading
 * its session, so nothing here can come from it. */
async function pageLoad() {
  vi.resetModules();
  vi.doMock('@supabase/supabase-js', () => ({
    createClient: () => ({
      auth: {
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getSession: () => new Promise(() => undefined),
      },
    }),
  }));
  const entitlement = await import('../src/lib/entitlement');
  const { queryClient } = await import('../src/lib/queryClient');
  return { ...entitlement, queryClient };
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', PROJECT_URL);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock('@supabase/supabase-js');
  window.history.replaceState(null, '', '/');
});

describe('the plan read at start-up (C14)', () => {
  it('asks for the stored account’s plan at once, under the key its own query uses', async () => {
    localStorage.setItem(KEY, JSON.stringify(session(3600)));
    const reads = recordPlanReads('premium');
    const { prefetchStoredAccountPlan, entitlementKeys, queryClient } = await pageLoad();
    prefetchStoredAccountPlan();
    await vi.waitFor(() => expect(queryClient.getQueryData(entitlementKeys.user('user-stored'))).toMatchObject({ tier: 'premium' }));
    expect(reads).toEqual(['Bearer stored-access-token']);
  });

  it('asks nothing for a guest, a token supabase-js must refresh first, or an OAuth return', async () => {
    const reads = recordPlanReads();
    let loaded = await pageLoad();
    loaded.prefetchStoredAccountPlan();

    localStorage.setItem(KEY, JSON.stringify(session(30)));
    loaded = await pageLoad();
    loaded.prefetchStoredAccountPlan();

    localStorage.setItem(KEY, JSON.stringify(session(3600)));
    localStorage.setItem(`${KEY}-code-verifier`, '"verifier"');
    window.history.replaceState(null, '', '/?code=new-code');
    loaded = await pageLoad();
    loaded.prefetchStoredAccountPlan();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reads).toEqual([]);
    expect(loaded.queryClient.getQueryCache().getAll()).toEqual([]);
  });
});

describe('reading the plan again (C29)', () => {
  /** The hook mounted for a signed-in account, with the app's query client. */
  async function mountPlan() {
    vi.resetModules();
    vi.doMock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-a' }, isAuthenticated: true, isLoading: false }) }));
    const entitlement = await import('../src/lib/entitlement');
    const { queryClient } = await import('../src/lib/queryClient');
    const { QueryClientProvider, focusManager } = await import('@tanstack/react-query');
    const { renderHook } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const hook = renderHook(() => entitlement.useEntitlement(), {
      wrapper: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
    });
    return { ...entitlement, queryClient, focusManager, hook };
  }
  afterEach(() => {
    vi.doUnmock('../src/lib/auth');
    vi.useRealTimers();
  });

  it('re-reads on a tab return only once the plan is five minutes old, not after every minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const reads = recordPlanReads();
    const { hook, focusManager, PLAN_FOCUS_REFRESH_MS } = await mountPlan();
    await vi.waitFor(() => expect(hook.result.current.tier).toBe('free'));
    expect(reads).toHaveLength(1);
    const returnToTab = async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 30));
    };
    vi.setSystemTime(Date.now() + 65_000);
    await returnToTab();
    expect(reads).toHaveLength(1);
    vi.setSystemTime(Date.now() + PLAN_FOCUS_REFRESH_MS);
    await returnToTab();
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    focusManager.setFocused(undefined);
    hook.unmount();
  });

  it('tells the other tabs a plan that changed, and re-reads one another tab saw change', async () => {
    const reads = recordPlanReads();
    const { hook, PLAN_SEEN_KEY } = await mountPlan();
    await vi.waitFor(() => expect(hook.result.current.tier).toBe('free'));
    expect(localStorage.getItem(PLAN_SEEN_KEY)).toBe('user-a:free');
    // Another tab read the same plan: nothing to do here.
    window.dispatchEvent(new window.StorageEvent('storage', { key: PLAN_SEEN_KEY, newValue: 'user-a:free' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(reads).toHaveLength(1);
    // Another tab finished a purchase.
    recordPlanReads('premium');
    window.dispatchEvent(new window.StorageEvent('storage', { key: PLAN_SEEN_KEY, newValue: 'user-a:premium' }));
    await vi.waitFor(() => expect(hook.result.current.tier).toBe('premium'));
    hook.unmount();
  });
});
