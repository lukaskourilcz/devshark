import { enforceRateLimit, RATE_LIMITS } from './rate-limit';
import type { VercelRequest, VercelResponse } from './vercel-types';

const directives = new Set([
  'base-uri', 'child-src', 'connect-src', 'default-src', 'font-src', 'form-action', 'frame-ancestors',
  'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src', 'script-src', 'script-src-attr',
  'script-src-elem', 'style-src', 'style-src-attr', 'style-src-elem', 'worker-src',
]);

/** Discard visitor-supplied URLs, referrers, samples, and other free text. */
export function privateCspReport(input: unknown) {
  const data = input && typeof input === 'object' && 'csp-report' in input ? input['csp-report'] : null;
  if (!data || typeof data !== 'object') return null;
  const directive = 'effective-directive' in data ? data['effective-directive'] : null;
  if (typeof directive !== 'string' || !directives.has(directive)) return null;
  const blocked = 'blocked-uri' in data ? data['blocked-uri'] : null;
  return { 'csp-report': {
    'document-uri': 'https://devshark.app/',
    'effective-directive': directive,
    'violated-directive': directive,
    'blocked-uri': blocked === 'inline' || blocked === 'eval' ? blocked : 'redacted',
  } };
}

function sentryEndpoint() {
  try {
    const dsn = new URL(process.env.VITE_SENTRY_DSN ?? '');
    if (dsn.protocol !== 'https:' || dsn.host !== 'o4511808879001600.ingest.de.sentry.io'
      || !/^\/[0-9]+$/.test(dsn.pathname) || !/^[a-f0-9]{32}$/i.test(dsn.username)) return null;
    const endpoint = new URL(`/api${dsn.pathname}/security/`, dsn.origin);
    endpoint.searchParams.set('sentry_key', dsn.username);
    return endpoint;
  } catch {
    return null;
  }
}

export async function handleCspReport(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.cspReport))) return;
  const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/csp-report') return res.status(415).end();
  let body: unknown = req.body;
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > 8192) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  }
  const report = privateCspReport(body);
  const endpoint = sentryEndpoint();
  if (report && endpoint) {
    try {
      const result = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(1000),
        headers: { 'content-type': 'application/csp-report' }, body: JSON.stringify(report) });
      await result.body?.cancel();
      if (!result.ok) return res.status(503).end();
    } catch { return res.status(503).end(); }
  }
  return res.status(204).end();
}
