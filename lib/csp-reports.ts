import { enforceRateLimit, RATE_LIMITS } from './rate-limit';
import type { VercelRequest, VercelResponse } from './vercel-types';

const directives = new Set([
  'base-uri', 'child-src', 'connect-src', 'default-src', 'font-src', 'form-action', 'frame-ancestors',
  'frame-src', 'img-src', 'manifest-src', 'media-src', 'object-src', 'script-src', 'script-src-attr',
  'script-src-elem', 'style-src', 'style-src-attr', 'style-src-elem', 'worker-src',
]);

const maxReportBytes = 8192;
const maxBatchReports = 8;

/** Send only the directive and a fixed classification of the blocked resource. */
function sanitizeReport(directive: unknown, blocked: unknown) {
  if (typeof directive !== 'string' || !directives.has(directive)) return null;
  return { 'csp-report': {
    'document-uri': 'https://devshark.app/',
    'effective-directive': directive,
    'violated-directive': directive,
    'blocked-uri': blocked === 'inline' || blocked === 'eval' ? blocked : 'redacted',
  } };
}

export function privateCspReport(input: unknown) {
  const body = input && typeof input === 'object' && 'csp-report' in input ? input['csp-report'] : null;
  if (!body || typeof body !== 'object' || !('effective-directive' in body)) return null;
  return sanitizeReport(body['effective-directive'], 'blocked-uri' in body ? body['blocked-uri'] : null);
}

function modernReport(input: unknown) {
  if (!input || typeof input !== 'object' || !('type' in input) || input.type !== 'csp-violation' || !('body' in input)) return null;
  const body = input.body;
  if (!body || typeof body !== 'object' || !('effectiveDirective' in body)) return null;
  return sanitizeReport(body.effectiveDirective, 'blockedURL' in body ? body.blockedURL : null);
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
  const modern = contentType === 'application/reports+json';
  if (!modern && contentType !== 'application/csp-report') return res.status(415).end();
  if (Number(req.headers['content-length']) > maxReportBytes) return res.status(413).end();
  let body: unknown = req.body;
  if (Buffer.isBuffer(body)) {
    if (body.length > maxReportBytes) return res.status(413).end();
    body = body.toString('utf8');
  }
  if (typeof body === 'string') {
    if (Buffer.byteLength(body) > maxReportBytes) return res.status(413).end();
    try { body = JSON.parse(body); } catch { return res.status(400).end(); }
  } else if (modern && Array.isArray(body)) {
    // Some adapters decode JSON before this handler, including chunked posts.
    if (body.length > maxBatchReports || Buffer.byteLength(JSON.stringify(body)) > maxReportBytes) return res.status(413).end();
  }
  const batch = modern ? body : [body];
  if (!Array.isArray(batch)) return res.status(400).end();
  if (batch.length > maxBatchReports) return res.status(413).end();
  const reports = batch.map(modern ? modernReport : privateCspReport).filter(report => report !== null);
  const endpoint = sentryEndpoint();
  if (!endpoint || reports.length === 0) return res.status(204).end();

  // The request already consumed one token. A batch uses the same allowance
  // per outgoing report as separate legacy posts. Reserve it before sending.
  for (let n = 1; n < reports.length; n++) {
    if (!(await enforceRateLimit(req, res, RATE_LIMITS.cspReport))) return;
  }
  try {
    const signal = AbortSignal.timeout(1000);
    const accepted = await Promise.all(reports.map(async report => {
      const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal,
        headers: { 'content-type': 'application/csp-report' }, body: JSON.stringify(report) });
      await response.body?.cancel();
      return response.ok;
    }));
    if (accepted.some(ok => !ok)) return res.status(503).end();
  } catch { return res.status(503).end(); }
  return res.status(204).end();
}
