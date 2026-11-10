// Marketing readiness (lib/marketing.ts) and the error monitor's place under
// "necessary" (lib/sentry.ts).
import { beforeEach, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  browserTracingIntegration: vi.fn((options?: unknown) => ({ name: 'BrowserTracing', options })),
  replayIntegration: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@sentry/react', () => sentry);

async function load() {
  vi.resetModules();
  const consent = await import('../src/lib/consent');
  const marketing = await import('../src/lib/marketing');
  return { consent, marketing };
}

/** The dataLayer entries as plain arrays (gtag pushes `arguments`). */
const layer = () => (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
const lastEntry = () => layer()[layer().length - 1];

beforeEach(() => {
  delete window.dataLayer;
  localStorage.clear();
  document.cookie = 'devshark_consent=; Path=/; Max-Age=0';
});

it('does nothing while no marketing tag is connected', async () => {
  const { consent, marketing } = await load();
  marketing.installMarketing();
  consent.acceptAllConsent();
  expect(window.dataLayer).toBeUndefined();
});

it('starts a connected tag only after a yes to marketing, with Consent Mode denied until then', async () => {
  const { consent, marketing } = await load();
  const tag = { id: 'ga4' as const, load: vi.fn(), unload: vi.fn() };
  const stop = marketing.installMarketing([tag]);
  // The first command any Google tag would read: everything denied.
  expect(layer()).toEqual([[
    'consent', 'default',
    { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 },
  ]]);
  expect(tag.load).not.toHaveBeenCalled();

  // Analytics alone is not marketing.
  consent.saveConsent({ analytics: true, marketing: false });
  expect(tag.load).not.toHaveBeenCalled();
  expect(lastEntry()).toEqual(['consent', 'update', marketing.CONSENT_MODE_DEFAULTS]);

  consent.saveConsent({ analytics: false, marketing: true });
  expect(tag.load).toHaveBeenCalledTimes(1);
  expect(lastEntry()).toEqual(['consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }]);

  consent.rejectAllConsent();
  expect(tag.unload).toHaveBeenCalledTimes(1);
  expect(lastEntry()).toEqual(['consent', 'update', marketing.CONSENT_MODE_DEFAULTS]);
  stop();
});

it('starts a connected tag at once for a visitor who said yes on an earlier visit', async () => {
  const first = await load();
  first.consent.acceptAllConsent();
  const { marketing } = await load();
  const tag = { id: 'meta-pixel' as const, load: vi.fn(), unload: vi.fn() };
  marketing.installMarketing([tag]);
  expect(tag.load).toHaveBeenCalledTimes(1);
  expect(layer()[0][1]).toBe('default');
  expect(lastEntry()?.[1]).toBe('update');
});

it('runs error monitoring without cookies, storage, replay or personal data', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o1.ingest.de.sentry.io/1');
  vi.resetModules();
  const { initSentry } = await import('../src/lib/sentry');
  initSentry();
  await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
  const options = sentry.init.mock.calls[0][0] as Record<string, unknown>;
  expect(options.sendDefaultPii).toBe(false);
  expect(sentry.replayIntegration).not.toHaveBeenCalled();
  // The previous trace stays in memory, not in sessionStorage.
  expect(sentry.browserTracingIntegration).toHaveBeenCalledWith({ linkPreviousTrace: 'in-memory' });
  expect(options).not.toHaveProperty('initialScope');
  vi.unstubAllEnvs();
});

it('sends no code, token, e-mail address or query string with an error, a breadcrumb or a trace', async () => {
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o1.ingest.de.sentry.io/1');
  vi.resetModules();
  sentry.init.mockClear();
  const { initSentry } = await import('../src/lib/sentry');
  initSentry();
  await vi.waitFor(() => expect(sentry.init).toHaveBeenCalledTimes(1));
  const options = sentry.init.mock.calls[0][0] as {
    beforeSend?: (event: Record<string, unknown>) => Record<string, unknown>;
    beforeSendTransaction?: (event: Record<string, unknown>) => Record<string, unknown>;
    beforeBreadcrumb?: (crumb: Record<string, unknown>) => Record<string, unknown>;
  };
  expect(options.beforeSend).toBeTypeOf('function');
  expect(options.beforeSendTransaction).toBeTypeOf('function');
  expect(options.beforeBreadcrumb).toBeTypeOf('function');

  const sent = options.beforeSend!({
    message: 'Sign-in failed for ada@example.com at https://devshark.app/auth/callback?code=oauth-code-123',
    request: {
      url: 'https://devshark.app/premium/success?session_id=cs_live_1#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl',
      query_string: 'session_id=cs_live_1',
      cookies: { sb: 'session' },
      data: { email: 'ada@example.com' },
      headers: { Referer: 'https://devshark.app/settings/github?code=gh-code&state=sealed', 'User-Agent': 'Test browser' },
    },
    user: { id: 'user-1', email: 'ada@example.com' },
    exception: { values: [{ type: 'Error', value: 'Request with Bearer abcdefghijklmnop failed for ada@example.com' }] },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/settings/github?installation_id=1&code=gh-code&state=sealed', to: '/profile#github-garden' } },
      { category: 'fetch', data: { url: 'https://x.supabase.co/rest/v1/profiles?user_id=eq.user-1', method: 'GET', status_code: 200 } },
    ],
    extra: { componentStack: 'at Quiz' },
  });
  const text = JSON.stringify(sent);
  for (const secret of ['ada@example.com', 'oauth-code-123', 'cs_live_1', 'eyJhbGciOiJIUzI1NiJ9', 'gh-code', 'sealed', 'user-1', 'abcdefghijklmnop', 'Referer', 'cookies']) {
    expect(text).not.toContain(secret);
  }
  expect(sent.request).toEqual({ url: 'https://devshark.app/premium/success', headers: { 'User-Agent': 'Test browser' } });
  expect(sent.message).toBe('Sign-in failed for [email] at https://devshark.app/auth/callback');
  expect((sent.breadcrumbs as { data: Record<string, unknown> }[])[0].data).toEqual({ from: '/settings/github', to: '/profile' });
  expect((sent.breadcrumbs as { data: Record<string, unknown> }[])[1].data).toMatchObject({ url: 'https://x.supabase.co/rest/v1/profiles', method: 'GET' });
  expect(sent.extra).toEqual({ componentStack: 'at Quiz' });

  const crumb = options.beforeBreadcrumb!({ category: 'xhr', message: 'GET /api/user?op=stats&email=ada%40example.com', data: { url: '/api/user?op=stats' } });
  expect(crumb).toEqual({ category: 'xhr', message: 'GET /api/user', data: { url: '/api/user' } });

  // A console line and a wrapped handler's error keep the raw values they
  // were given beside the scrubbed text: those go too.
  const logged = options.beforeBreadcrumb!({
    category: 'console',
    message: 'signed in ada@example.com',
    data: { arguments: ['signed in', { email: 'ada@example.com', next: '/auth/callback?code=oauth-code-123' }], logger: 'console' },
  });
  expect(logged).toEqual({ category: 'console', message: 'signed in [email]', data: { logger: 'console' } });
  const thrown = options.beforeSend!({
    exception: { values: [{ type: 'Error', value: 'boom' }] },
    breadcrumbs: [{ category: 'console', message: 'x', data: { arguments: [{ email: 'ada@example.com' }], logger: 'console' } }],
    extra: {
      arguments: [{ href: 'https://devshark.app/auth/callback?code=oauth-code-123' }],
      __serialized__: { email: 'ada@example.com', url: '/auth/confirmed?token_hash=synthetic-otp' },
      details: { email: 'ada@example.com' },
      componentStack: 'at Quiz',
    },
  });
  expect(thrown.extra).toEqual({ componentStack: 'at Quiz' });
  expect(JSON.stringify(thrown)).not.toContain('ada@example.com');
  expect(JSON.stringify(thrown)).not.toContain('oauth-code-123');
  expect(JSON.stringify(thrown)).not.toContain('synthetic-otp');

  const trace = options.beforeSendTransaction!({
    transaction: '/settings/github',
    request: { url: 'https://devshark.app/settings/github?code=gh-code' },
    contexts: { trace: { data: { 'url.full': 'https://devshark.app/settings/github?code=gh-code' } } },
    spans: [{ data: { 'http.url': 'https://devshark.app/api/user?op=github-connect-finish', 'http.query': '?op=github-connect-finish', 'http.fragment': '#x', 'http.method': 'POST' } }],
  });
  expect(JSON.stringify(trace)).not.toContain('gh-code');
  expect((trace.spans as { data: Record<string, unknown> }[])[0].data).toEqual({ 'http.url': 'https://devshark.app/api/user', 'http.method': 'POST' });
  vi.unstubAllEnvs();
});
