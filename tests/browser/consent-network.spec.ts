import { gunzipSync } from 'node:zlib';
import { allowConsoleErrors, expect, test, type Page, type Request } from './console-clean';
import budget from '../../docs/quality/bundle-budget.json';
import settings from '../fixtures/api-settings.json';

const fixture = budget.measuredBuild.env;
const sentryHost = new URL(fixture.VITE_SENTRY_DSN).hostname;
const campaign = { utm_source: 'threads', utm_medium: 'post', utm_campaign: 'browser-check' };
const privateValue = 'consent-fixture-private';
const syntheticError = 'consent transport fixture';
const syntheticEmail = 'fixture@example.test';

function decodedBody(request: Request): string {
  let data = request.postDataBuffer();
  if (!data) return '';
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
  const body = data.toString('utf8');
  const form = body.startsWith('data=') ? new URLSearchParams(body).get('data') : null;
  return form ? Buffer.from(form, 'base64').toString('utf8') : body;
}

function eventRecords(body: string): Array<{ event: string; properties: Record<string, string> }> {
  if (!body) return [];
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed];
}

async function analyticsKeys(page: Page) {
  return page.evaluate(() => [
    ...document.cookie.split(';').map(cookie => cookie.trim().split('=')[0]),
    ...Object.keys(localStorage), ...Object.keys(sessionStorage),
  ].filter(name => /^(?:__)?ph_|^devshark:campaign$/.test(name)));
}

test.use({
  serviceWorkers: 'block',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36',
});

test('the live SDKs redact errors and respect consent through navigation and withdrawal', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
  expect(sentryHost).toMatch(/\.localhost$/);
  const analytics: Array<{ path: string; body: string }> = [];
  const envelopes: string[] = [];
  const providers: string[] = [];
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    const response = { status: 200, contentType: 'application/json', body: '{}', headers: {
      'access-control-allow-origin': origin.origin, 'access-control-allow-methods': 'OPTIONS, POST',
      'access-control-allow-headers': 'content-type, sentry-trace, baggage',
    } };
    if (url.hostname === sentryHost) {
      if (request.method() === 'POST') envelopes.push(decodedBody(request));
      return route.fulfill(response);
    }
    if (url.origin !== origin.origin) {
      if (/(?:^|\.)(?:sentry\.io|posthog\.com)$/.test(url.hostname)) providers.push(url.hostname);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/ingest/') || url.pathname === '/flags') {
      analytics.push({ path: url.pathname, body: decodedBody(request) });
      return route.fulfill(response);
    }
    if (url.pathname === '/api/settings') return route.fulfill({ json: settings });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, json: { error: { code: 'fixture_only' } } });
    return route.continue();
  });
  // PostHog excludes automation and headless-client-hint brands before capture.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
  allowConsoleErrors(page, syntheticError);
  const query = new URLSearchParams({ ...campaign, ref: privateValue });
  await page.goto('/terms?' + query);
  await expect(page.getByRole('heading', { name: 'Terms of use', exact: true })).toBeVisible();
  const src = await page.locator('script[type=module][src]').first().getAttribute('src');
  const entry = new URL(src!, origin);
  expect(entry.origin).toBe(origin.origin);
  const built = await (await page.request.get(entry.href)).text();
  const hasSink = built.includes(sentryHost);
  const hasAnalytics = built.includes(fixture.VITE_PUBLIC_POSTHOG_KEY);
  if (process.env.CONSENT_EXPECT_TELEMETRY === '1') {
    expect(hasSink && hasAnalytics, 'build with the measured local Sentry and PostHog fixtures').toBe(true);
  }

  if (hasSink) {
    await page.evaluate(message => { setTimeout(() => { throw new Error(message); }, 0); },
      `${syntheticError} ${syntheticEmail} /play/K7Q2AB?token=${privateValue}`);
    await expect.poll(() => envelopes.some(body => body.includes(syntheticError))).toBe(true);
    for (const body of envelopes) {
      expect(body).not.toMatch(/"type"\s*:\s*"sessions?"/);
      expect(body).not.toContain(syntheticEmail);
      expect(body).not.toContain(privateValue);
      expect(body).not.toContain('K7Q2AB');
    }
  }
  expect(analytics).toHaveLength(0);
  expect(await analyticsKeys(page)).toEqual([]);
  test.skip(!hasAnalytics, 'This local build omitted the synthetic PostHog key; CI requires it.');

  const views = () => analytics.flatMap(row => eventRecords(row.body)).filter(row => row.event === '$pageview');
  await page.getByRole('button', { name: 'Accept all', exact: true }).click();
  await expect.poll(() => views().length).toBe(1);
  expect(views()[0].properties).toMatchObject(campaign);
  const arrival = new URL(views()[0].properties.$current_url);
  expect(arrival.pathname).toBe('/terms');
  expect(Object.fromEntries(arrival.searchParams)).toEqual(campaign);
  await page.locator('footer a[href="/privacy"]').click();
  await expect(page.getByRole('heading', { name: 'Privacy policy', exact: true })).toBeVisible();
  await expect.poll(() => views().length).toBe(2);
  expect(views()[1].properties.$current_url).toBe(origin.origin + '/privacy');
  for (const key of Object.keys(campaign)) expect(views()[1].properties).not.toHaveProperty(key);
  expect(analytics.some(row => row.body.includes(privateValue))).toBe(false);
  expect(analytics.filter(row => /\/(?:static|array|s|flags)(?:\/|$)/.test(row.path))).toEqual([]);
  expect(await analyticsKeys(page)).not.toEqual([]);

  await page.getByRole('button', { name: 'Cookie settings', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reject all', exact: true }).click();
  await expect.poll(() => analyticsKeys(page)).toEqual([]);
  const withdrawn = analytics.length;
  await page.locator('footer a[href="/terms"]').click();
  await expect(page.getByRole('heading', { name: 'Terms of use', exact: true })).toBeVisible();
  // request_batching is disabled in production; allow the queued navigation effect to finish.
  await page.waitForTimeout(500);
  expect(analytics).toHaveLength(withdrawn);
  expect(providers).toEqual([]);
});
