// Bounded shared F1/F7 collector: local import proxies and anonymous entry/read/refusal observations.
import http from 'node:http';
import { loadPreviewAccess, PreviewAccessError, validatePreviewOrigin } from './cold-start-preview-access.mjs';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export const PROBES = Object.freeze([
  { id: 'health', file: 'api/health.ts', path: '/api/health', purpose: 'public dependency readiness read', kind: 'read', outcomes: [[200], [503]] },
  { id: 'settings', file: 'api/settings.ts', path: '/api/settings', purpose: 'public settings read', kind: 'read', nonce: true, outcomes: [[200]] },
  { id: 'leaderboard', file: 'api/leaderboard.ts', path: '/api/leaderboard?period=global&limit=10', purpose: 'public board, no personal row', kind: 'read', nonce: true, outcomes: [[200], [503, 'not_configured'], [503, 'rpc_missing'], [503, 'upstream_timeout']] },
  { id: 'questions', file: 'api/quiz/questions.ts', path: '/api/quiz/questions?resource=curation', purpose: 'coverage only, no question session', kind: 'read', nonce: true, outcomes: [[200]] },
  { id: 'roadmap', file: 'api/quiz/roadmap.ts', path: '/api/quiz/roadmap', purpose: 'public structure only, no attempt', kind: 'read', nonce: true, outcomes: [[200]] },
  { id: 'challenge', file: 'api/quiz/challenge.ts', path: '/api/quiz/challenge?resource=__perf_probe__', purpose: 'unknown-resource refusal before question batch', kind: 'refusal', outcomes: [[404, 'unknown_resource']] },
  { id: 'daily', file: 'api/quiz/daily.ts', path: '/api/quiz/daily?qotd=__perf_probe__', purpose: 'invalid-date refusal before question/session selection', kind: 'refusal', outcomes: [[400, 'bad_request']] },
  { id: 'submit', file: 'api/quiz/submit.ts', path: '/api/quiz/submit', purpose: 'GET method refusal, never grading/reporting', kind: 'refusal', allow: 'POST', outcomes: [[405, 'method_not_allowed']] },
  { id: 'flashcards', file: 'api/flashcards.ts', path: '/api/flashcards?subject=webdev', purpose: 'anonymous auth/configuration refusal', kind: 'refusal', outcomes: [[401, 'missing_token'], [503, 'not_configured'], [503, 'auth_not_configured']] },
  { id: 'user', file: 'api/user/[op].ts', path: '/api/user/__perf_probe__', purpose: 'unknown-op/configuration refusal, never wallet/rewards', kind: 'refusal', outcomes: [[404, 'unknown_op'], [503, 'not_configured']] },
  { id: 'play', file: 'api/play/[action].ts', path: '/api/play/__perf_probe__', purpose: 'unknown-action/configuration/feature refusal, no room', kind: 'refusal', outcomes: [[404, 'unknown_action'], [503, 'not_configured'], [503, 'feature_disabled']] },
  { id: 'admin', file: 'api/admin/[op].ts', path: '/api/admin/__perf_probe__', purpose: 'anonymous admin refusal', kind: 'refusal', outcomes: [[403, 'forbidden']] },
]);
export const USAGE = 'node scripts/perf-cold-start.mjs (--url=<bare HTTPS or HTTP loopback origin> | --local) [--handlers=<ids>] [--samples=1..10] [--interval-ms=1100..60000] [--bypass-cache] [--markers] [--output=<file>] [--preview-state=<approved-one-cookie-state-file>]';
const FLAGS = { url: 'value', local: 'switch', handlers: 'value', samples: 'value', 'interval-ms': 'value', 'bypass-cache': 'switch', markers: 'switch', output: 'value', 'preview-state': 'value', help: 'switch' };
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
export class UsageError extends Error {}
export function options(argv) {
  const args = {};
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match || !Object.hasOwn(FLAGS, match[1]) || Object.hasOwn(args, match[1])) throw new UsageError('unknown, repeated or malformed flag');
    const [, name, value] = match;
    if (FLAGS[name] === 'switch' ? value !== undefined : value === undefined || value === '') throw new UsageError(`invalid --${name}`);
    args[name] = value ?? true;
  }
  if (args.help) { if (Object.keys(args).length !== 1) throw new UsageError('--help must stand alone'); return { help: true }; }
  if (Boolean(args.local) === Boolean(args.url)) throw new UsageError('choose exactly one of --local and --url');
  const samples = args.samples ?? '3';
  if (!/^\d+$/.test(samples) || Number(samples) < 1 || Number(samples) > 10) throw new UsageError('--samples must be1..10');
  const ids = args.handlers ? args.handlers.split(',') : PROBES.map(probe => probe.id);
  if (new Set(ids).size !== ids.length || ids.some(id => !PROBES.some(probe => probe.id === id))) throw new UsageError('unknown/duplicate handler');
  if (args.local && (args['interval-ms'] || args['bypass-cache'])) throw new UsageError('remote flags cannot be used with --local');
  if (!args.local && args.markers) throw new UsageError('--markers is local-only');
  if (args.local && args['preview-state']) throw new UsageError('--preview-state is remote-only');
  let origin = null;
  if (args.url) {
    let url;
    try { url = new URL(args.url); } catch { throw new UsageError('invalid origin'); }
    if (url.username || url.password || /\/\/[^/]*@/.test(args.url) || args.url.includes('?') || args.url.includes('#') || url.pathname !== '/' || (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))) throw new UsageError('use a credential-free bare HTTPS origin, or HTTP loopback');
    origin = url.origin;
  }
  if (args['preview-state']) validatePreviewOrigin(origin);
  const interval = args['interval-ms'] ?? '1100';
  const minimum = origin && LOOPBACK.has(new URL(origin).hostname) ? 0 : 1100;
  if (!/^\d+$/.test(interval) || Number(interval) < minimum || Number(interval) > 60000) throw new UsageError('invalid interval');
  return { local: Boolean(args.local), origin, samples: Number(samples), ids, intervalMs: Number(interval), bypassCache: Boolean(args['bypass-cache']), markers: Boolean(args.markers), previewState: args['preview-state'] ?? null, output: args.output ?? 'artifacts/performance/cold-start.json' };
}

export function assertInventory(root) {
  const walk = directory => readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${directory}/${entry.name}`) : entry.isFile() && entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : []);
  const actual = walk('api').sort();
  const expected = PROBES.map(probe => probe.file).sort();
  if (actual.length !== 12 || JSON.stringify(actual) !== JSON.stringify(expected)) throw new UsageError('physical handler inventory differs from the twelve-entry safety manifest');
}
const splitQuoted = (value, separator) => {
  const result = []; let current = ''; let quoted = false; let escaped = false;
  for (const char of value) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quoted) { current += char; escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === separator && !quoted) { result.push(current.trim()); current = ''; } else current += char;
  }
  return quoted || escaped ? null : [...result, current.trim()];
};
export function timingSpans(value) {
  const result = { appMs: null, dbHttpMs: null, dbCalls: null, authHttpMs: null, authCalls: null, marker: null, valid: false };
  if (typeof value !== 'string' || value.length > 4096) return result;
  const entries = splitQuoted(value, ',');
  if (!entries) return result;
  const seen = new Set();
  for (const entry of entries) {
    const fields = splitQuoted(entry, ';');
    if (!fields) return { ...result, valid: false, marker: null };
    const name = fields.shift();
    if (!['app', 'db_http', 'auth_http', 'instance'].includes(name)) continue;
    if (seen.has(name)) return { appMs: null, dbHttpMs: null, dbCalls: null, authHttpMs: null, authCalls: null, marker: null, valid: false };
    seen.add(name);
    const parameters = {};
    for (const field of fields) {
      const equal = field.indexOf('=');
      if (equal < 1 || Object.hasOwn(parameters, field.slice(0, equal).trim())) return { ...result, valid: false, marker: null };
      parameters[field.slice(0, equal).trim()] = field.slice(equal + 1).trim();
    }
    if (name === 'instance') { if (/^"(?:first|repeat)"$/.test(parameters.desc ?? '') && parameters.dur === undefined) result.marker = parameters.desc.slice(1, -1); continue; }
    const duration = /^\d+\.\d$/.test(parameters.dur ?? '') ? Number(parameters.dur) : null;
    const calls = /^"(\d+) calls"$/.exec(parameters.desc ?? '');
    const count = calls && Number.isSafeInteger(Number(calls[1])) ? Number(calls[1]) : null;
    if (name === 'app') result.appMs = duration;
    else if (name === 'db_http') { result.dbHttpMs = duration; result.dbCalls = count; }
    else { result.authHttpMs = duration; result.authCalls = count; }
  }
  result.valid = [result.appMs, result.dbHttpMs, result.dbCalls, result.authHttpMs, result.authCalls].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return result;
}
export function cacheAllowsMarker(value) {
  if (Array.isArray(value)) value = value.join(',');
  if (typeof value !== 'string' || !value.trim()) return false;
  let noStore = false;
  for (const field of value.split(',')) {
    const match = /^\s*([a-z-]+)(?:\s*=\s*(\d+|"\d+"))?\s*$/i.exec(field);
    if (!match) return false;
    const name = match[1].toLowerCase();
    if (name === 'max-age') { if (match[2] === undefined || Number(match[2].replaceAll('"', '')) !== 0) return false; continue; }
    if (!['private', 'no-store', 'no-cache', 'must-revalidate', 'proxy-revalidate', 'no-transform'].includes(name) || match[2] !== undefined) return false;
    if (name === 'no-store') noStore = true;
  }
  return noStore;
}
export function originClassification(headers) {
  const cache = typeof headers['x-vercel-cache'] === 'string' ? headers['x-vercel-cache'].trim().toUpperCase() : '';
  const spans = timingSpans(headers['server-timing']);
  if (cache === 'HIT' || cache === 'STALE') return { cache, instance: 'replayed', timingStatus: 'replayed', spans: null };
  const knownMiss = cache === 'MISS';
  return { cache: knownMiss ? 'MISS' : 'unknown', instance: knownMiss && spans.valid && cacheAllowsMarker(headers['cache-control']) ? spans.marker ?? 'unknown' : 'unknown', timingStatus: !knownMiss ? 'cache-unknown' : spans.valid ? 'parsed' : 'malformed', spans: { appMs: spans.appMs, dbHttpMs: spans.dbHttpMs, dbCalls: spans.dbCalls, authHttpMs: spans.authHttpMs, authCalls: spans.authCalls } };
}

export function remoteSample(origin, probe, { bypassCache = false, timeoutMs = 15000, previewAccess = null } = {}) {
  const url = new URL(probe.path, origin);
  if (bypassCache && probe.nonce) url.searchParams.set('__perf_probe', randomUUID());
  const transport = url.protocol === 'https:' ? https : http;
  const agent = new transport.Agent({ keepAlive: false, proxyEnv: {} });
  const started = performance.now();
  const raw = { dnsLookupEndMs: null, tcpConnectEndMs: null, tlsHandshakeEndMs: null, firstByteMs: null, headersMs: null, bodyEndMs: null };
  const elapsed = () => performance.now() - started;
  return new Promise(resolve => {
    let settled = false; let sent = false; let timeout; let failure = 'transport_error'; let receivedStatus = null;
    const finish = result => {
      if (settled) return; settled = true; clearTimeout(timeout); agent.destroy();
      resolve({ handler: probe.id, kind: probe.kind, purpose: probe.purpose, requestSent: sent, ...result, raw });
    };
    const request = transport.request(url, { method: 'GET', agent, headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': 'devShark-EpicF-cold-start/1', ...(previewAccess ? previewAccess.headersFor(url) : {}) } }, response => {
      receivedStatus = response.statusCode;
      raw.headersMs = elapsed();
      let bytes = 0; const prefix = []; let prefixBytes = 0;
      // Public successful bodies can exceed the small error-envelope prefix.
      // Keep them only until validation, bounded by the same streamed limit.
      const retainedLimit = response.statusCode === 200 ? 1024 * 1024 : 8192;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          failure = 'response_too_large';
          finish({ ok: false, error: failure, status: receivedStatus, bytes });
          request.destroy();
          return;
        }
        if (prefixBytes < retainedLimit) { const part = chunk.subarray(0, retainedLimit - prefixBytes); prefix.push(part); prefixBytes += part.length; }
      });
      response.on('error', () => finish({ ok: false, error: failure, status: response.statusCode }));
      response.on('end', () => {
        raw.bodyEndMs = elapsed();
        let code = null; let objectBody = false; let hasError = false; let healthShape = probe.id !== 'health';
        try {
          const body = JSON.parse(Buffer.concat(prefix).toString('utf8'));
          objectBody = body !== null && typeof body === 'object' && !Array.isArray(body);
          hasError = objectBody && Object.hasOwn(body, 'error');
          if (typeof body?.error?.code === 'string') code = body.error.code;
          if (probe.id === 'health') healthShape = typeof body?.ok === 'boolean' && ['healthy', 'degraded'].includes(body?.status);
        } catch { /* invalid or oversized error prefix cannot match a probe */ }
        const json = typeof response.headers['content-type'] === 'string' && /^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(response.headers['content-type']);
        const matched = json && objectBody && healthShape && (!probe.allow || response.headers.allow === probe.allow) && probe.outcomes.some(([status, expectedCode]) => status === response.statusCode && (expectedCode === undefined ? !hasError : expectedCode === code));
        const region = typeof response.headers['x-vercel-id'] === 'string' ? response.headers['x-vercel-id'].split('::').filter(part => /^[a-z]{3}\d$/.test(part)).slice(0, 2) : [];
        const rateLimited = response.statusCode === 429;
        const safeCode = probe.outcomes.some(([, expectedCode]) => expectedCode === code) ? code : null;
        finish({ ok: matched && !rateLimited, status: response.statusCode, errorCode: safeCode, ...(rateLimited ? { error: 'rate_limited' } : matched ? {} : { error: response.statusCode >= 300 && response.statusCode < 400 ? 'redirect_refused' : 'unexpected_response' }), bytes, region, ...originClassification(response.headers) });
      });
    });
    request.once('socket', socket => {
      socket.once('lookup', () => { raw.dnsLookupEndMs = elapsed(); });
      socket.once('connect', () => { raw.tcpConnectEndMs = elapsed(); });
      socket.once('secureConnect', () => { raw.tlsHandshakeEndMs = elapsed(); });
      socket.prependOnceListener('data', () => { raw.firstByteMs = elapsed(); });
    });
    request.once('finish', () => { sent = true; });
    request.once('error', () => finish({ ok: false, error: failure, status: receivedStatus }));
    timeout = setTimeout(() => { failure = 'timeout'; request.destroy(); }, timeoutMs);
    request.end();
  });
}
const stats = values => {
  const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!numbers.length) return null;
  const middle = Math.floor(numbers.length / 2);
  const median = numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  return { samples: numbers.length, median, min: numbers[0], max: numbers.at(-1) };
};
export function summaries(rows) {
  return PROBES.filter(probe => rows.some(row => row.handler === probe.id)).map(probe => {
    const relevant = rows.filter(row => row.handler === probe.id);
    const good = relevant.filter(row => row.ok);
    const classes = [...new Set(good.filter(row => row.raw).map(row => `${row.cache}:${row.instance}:${row.status}`))].map(key => {
      const group = good.filter(row => `${row.cache}:${row.instance}:${row.status}` === key);
      return { cache: group[0].cache, instance: group[0].instance, status: group[0].status, firstByteMs: stats(group.map(row => row.raw?.firstByteMs)), originAppMs: stats(group.filter(row => row.timingStatus === 'parsed').map(row => row.spans?.appMs)) };
    });
    return { handler: probe.id, measured: relevant.filter(row => !row.skipped).length, errors: relevant.filter(row => !row.skipped && !row.ok).length, skipped: relevant.filter(row => row.skipped).length, clientFirstByteMs: stats(good.map(row => row.raw?.firstByteMs)), classes, importWallMs: stats(good.map(row => row.importWallMs)), cpuUserMicros: stats(good.map(row => row.cpu?.userMicros)), cpuSystemMicros: stats(good.map(row => row.cpu?.systemMicros)), heapDeltaBytes: stats(good.map(row => row.heapDeltaBytes)) };
  });
}
export async function main(config, root = process.cwd(), preparedPreviewAccess = null) {
  assertInventory(root); // before any connection or compilation
  if (config.local) return (await import('./perf-cold-import.mjs')).localImports(config, root, { probes: PROBES, summarize: summaries });
  const previewAccess = preparedPreviewAccess ?? (config.previewState ? loadPreviewAccess(config.origin, config.previewState) : null);
  try {
    previewAccess?.assertOutputAllowed(config.output);
    const rows = []; let stopped = false;
    for (const id of config.ids) for (let sample = 0; sample < config.samples; sample++) {
      const probe = PROBES.find(candidate => candidate.id === id);
      if (stopped) { rows.push({ handler: id, sample, skipped: true, reason: 'rate_limited' }); continue; }
      if (rows.length) await new Promise(resolve => setTimeout(resolve, config.intervalMs));
      const row = { sample, ...(await remoteSample(config.origin, probe, { ...config, previewAccess })) };
      rows.push(row);
      if (row.status === 429) stopped = true;
    }
    return { ...(previewAccess ? { frontdoorAccess: { kind: previewAccess.kind, exchangeRequests: 0 } } : {}), mode: 'anonymous-entry-read-refusal', origin: config.origin, samples: config.samples, intervalMs: config.intervalMs, bypassCache: config.bypassCache, rows, summary: summaries(rows), totals: { planned: config.ids.length * config.samples, attempted: rows.filter(row => !row.skipped).length, sent: rows.filter(row => row.requestSent).length, responses: rows.filter(row => Number.isInteger(row.status)).length, skipped: rows.filter(row => row.skipped).length }, notes: ['Any protection-state preflight belongs to a separate explicit ledger; this command makes no exchange or document request', 'first/repeat is an origin timing-module invocation marker, never platform cold-boot duration', 'CDN HIT/STALE is replayed; unknown cache status is unclassified', 'GET probes may affect logs, rate counters or readiness reads; no learner/session/wallet operation is selected', 'No automatic redirects or retries; sent counts Node request-finish events, not provider ingestion', 'Raw timing offsets include network/edge/queueing; no boot-duration residual is invented'] };
  } finally { previewAccess?.dispose(); }
}
function direct() { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } }
const range = (value, unit) => value ? `${value.median.toFixed(1)}${unit} (${value.min.toFixed(1)}..${value.max.toFixed(1)})` : 'unavailable';
function printHandlers(report) {
  for (const row of report.summary) {
    if (report.mode === 'fresh-process-cjs-import-proxy') {
      console.log(`${row.handler} import: observations=${row.measured} errors=${row.errors} skipped=${row.skipped} require=${range(row.importWallMs, 'ms')} cpu-user=${range(row.cpuUserMicros, 'us')} cpu-system=${range(row.cpuSystemMicros, 'us')} heap-delta=${range(row.heapDeltaBytes, 'B')}`);
    } else {
      const probe = PROBES.find(probe => probe.id === row.handler);
      const classes = row.classes.map(group => `${group.cache}/${group.instance}/${group.status}:${group.firstByteMs?.samples ?? 0}`).join(',');
      console.log(`${row.handler} ${probe.kind}: observations=${row.measured} errors=${row.errors} skipped=${row.skipped} client-first-byte=${range(row.clientFirstByteMs, 'ms')} classes=${classes || 'none'}`);
    }
  }
}
if (direct()) {
  try {
    const config = options(process.argv.slice(2));
    if (config.help) console.log(USAGE);
    else {
      let previewAccess = null;
      try {
        if (config.previewState) {
          assertInventory(process.cwd());
          previewAccess = loadPreviewAccess(config.origin, config.previewState);
        }
        const report = await main(config, process.cwd(), previewAccess);
        let revision = null;
        try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* source archive */ }
        mkdirSync(dirname(config.output), { recursive: true });
        const content = JSON.stringify({ ...report, localSourceRevision: revision, deploymentRevision: null, node: process.version, recorded: new Date().toISOString() }, null, 2) + '\n';
        if (previewAccess) previewAccess.writeReport(config.output, content);
        else writeFileSync(config.output, content);
        printHandlers(report);
        console.log(JSON.stringify({ mode: report.mode, totals: report.totals, output: config.output }));
        if (report.rows.some(row => !row.ok)) process.exitCode = 1;
      } finally { previewAccess?.dispose(); }
    }
  } catch (error) { console.error((error instanceof UsageError || error instanceof PreviewAccessError) ? `${error.message}\n${USAGE}` : 'cold-start collection failed; no raw provider/body/header error is printed'); process.exitCode = (error instanceof UsageError || error instanceof PreviewAccessError) ? 2 : 1; }
}
