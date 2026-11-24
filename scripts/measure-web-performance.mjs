// Bounded read-only browser lab. Never submits forms, logs in, or writes APIs.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROFILES = ['mobile', 'desktop'];
// The local-only shell button each profile presses, by its accessible name in
// client/src/i18n/translations.ts. app-shell.css hides the menu button from
// 1024px, so the 1440px desktop profile presses the footer theme toggle,
// which names the mode it switches to. Ready Daily uses its local radio
// selection instead: question focus mode hides both shell controls.
export const INTERACTION_CONTROLS = { mobile: ['Open navigation menu'], desktop: ['Dark mode', 'Light mode'] };
const FLAGS = { url: 'value', routes: 'value', samples: 'value', profiles: 'value', output: 'value', access: 'value', consent: 'value', 'consent-version': 'value', 'api-origin': 'value', 'api-delay-ms': 'value', fixture: 'switch', 'reduced-motion': 'switch' };
// The cookie choice of the repeat-browser row. No mode accepts: a yes would
// load PostHog and send the lab's page views to it.
export const CONSENT_MODES = ['rejected', 'undecided'];
// No default origin: a bare run would send 64 page loads to production.
const DEFAULTS = {
 routes: '/,/learn,/coding,/quiz,/daily,/premium,/topics/javascript-closures,/leaderboard',
 samples: 3,
 output: 'artifacts/performance/web-lab.json',
 consent: 'rejected',
 consentVersion: 2,
 // The API delay of the #587 walk (docs/perf/2026-10-17).
 apiDelayMs: 120,
};

export const USAGE = `Usage: node scripts/measure-web-performance.mjs --url=<origin> [flags]
  --url=<origin>        origin to load, required (http://127.0.0.1:<port> for a local preview)
  --routes=<paths>      comma-separated paths, each starting with / (default ${DEFAULTS.routes})
  --samples=<n>         loads per route and profile, a whole number from 1 to 10 (default ${DEFAULTS.samples})
  --profiles=<names>    comma-separated, any of ${PROFILES.join(',')} (default ${PROFILES.join(',')})
  --output=<file>       lab JSON to write (default ${DEFAULTS.output})
  --consent=<choice>    the repeat row's cookie choice: rejected, a returning visitor who
                        pressed Reject all (default), or undecided, the banner still open
                        as in runs before 18 November 2026; the cold row is always undecided
  --consent-version=<n> version accepted by the measured build's rejected-consent record
                        (default ${DEFAULTS.consentVersion}); applies only to a rejected repeat visit
  --fixture             answer the origin's API GETs from tests/fixtures/api-settings.json
  --api-origin=<origin> answer the page's anonymous API reads from this https or loopback
                        origin: one GET from Node per distinct read per run, no cookie,
                        then a copy; other API GETs get the --fixture 503, writes stay blocked
  --api-delay-ms=<n>    hold each replayed answer this long, 0 to 10000 (default ${DEFAULTS.apiDelayMs})
  --reduced-motion      load pages as a visitor who asked for reduced motion (default: no preference)
  --access=<file>       JSON whose url authorizes a preview before each load`;

export class UsageError extends Error {}

// Splits --name=value at the first '=', reads a bare --name as true and
// refuses flags the tool does not know, so a typo cannot fall back to a
// default. flags maps each name to 'value' or 'switch'; audit:performance
// passes its own.
export function parseArgs(argv, flags = FLAGS) {
 const args = {};
 for (const arg of argv) {
  if (!arg.startsWith('--') || arg === '--') throw new UsageError(`unexpected argument "${arg}"`);
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
  const value = equals === -1 ? true : arg.slice(equals + 1);
  if (!Object.hasOwn(flags, name)) throw new UsageError(`unknown flag --${name}`);
  if (Object.hasOwn(args, name)) throw new UsageError(`--${name} appears twice`);
  if (flags[name] === 'switch' && value !== true) throw new UsageError(`--${name} takes no value`);
  if (flags[name] === 'value' && (value === true || value === '')) throw new UsageError(`--${name} needs a value: --${name}=<value>`);
  args[name] = value;
 }
 return args;
}

// A comma-separated flag value as a list without empty or repeated entries.
export function list(value, flag) {
 const entries = value.split(',');
 if (entries.includes('')) throw new UsageError(`--${flag} has an empty entry: "${value}"`);
 if (new Set(entries).size !== entries.length) throw new UsageError(`--${flag} names an entry twice: "${value}"`);
 return entries;
}

// Checks the parsed flags and fills the defaults. Throws UsageError before
// anything launches or writes.
export function resolveOptions(args) {
 if (args.url === undefined) throw new UsageError('--url is required; name the origin to measure');
 let url;
 try { url = new URL(args.url); } catch { throw new UsageError(`--url is not a URL: "${args.url}"`); }
 if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UsageError(`--url must use http or https: "${args.url}"`);
 const samples = args.samples ?? String(DEFAULTS.samples);
 if (!/^\d+$/.test(samples) || Number(samples) < 1 || Number(samples) > 10) throw new UsageError(`--samples must be a whole number from 1 to 10, got "${samples}"`);
 const profiles = list(args.profiles ?? PROFILES.join(','), 'profiles');
 for (const profile of profiles) if (!PROFILES.includes(profile)) throw new UsageError(`--profiles accepts ${PROFILES.join(' and ')}, got "${profile}"`);
 const routes = list(args.routes ?? DEFAULTS.routes, 'routes');
 for (const route of routes) if (!route.startsWith('/') || route.startsWith('//')) throw new UsageError(`--routes entries must start with one /, got "${route}"`);
 const consent = args.consent ?? DEFAULTS.consent;
 if (!CONSENT_MODES.includes(consent)) throw new UsageError(`--consent accepts ${CONSENT_MODES.join(' or ')}, got "${consent}"`);
 const consentVersion = Number(args['consent-version'] ?? DEFAULTS.consentVersion);
 if ((args['consent-version'] !== undefined && !/^[1-9]\d*$/.test(args['consent-version'])) || !Number.isSafeInteger(consentVersion))
  throw new UsageError('--consent-version must be a positive whole number');
 const apiOrigin = args['api-origin'] === undefined ? null : replayOrigin(args['api-origin']);
 if (args['api-delay-ms'] !== undefined && !apiOrigin) throw new UsageError('--api-delay-ms needs --api-origin');
 const apiDelayMs = args['api-delay-ms'] ?? String(DEFAULTS.apiDelayMs);
 if (!/^\d+$/.test(apiDelayMs) || Number(apiDelayMs) > 10000) throw new UsageError(`--api-delay-ms must be a whole number from 0 to 10000, got "${apiDelayMs}"`);
 return { origin: url.origin, routes, samples: Number(samples), profiles, output: args.output ?? DEFAULTS.output, access: args.access ?? null, fixture: args.fixture === true, reducedMotion: args['reduced-motion'] === true, consent, consentVersion, apiOrigin, apiDelayMs: Number(apiDelayMs) };
}

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];

// --api-origin is a bare origin: https, or http on this machine.
function replayOrigin(value) {
 let api;
 try { api = new URL(value); } catch { throw new UsageError(`--api-origin is not a URL: "${value}"`); }
 if (api.protocol !== 'https:' && !(api.protocol === 'http:' && LOOPBACK.includes(api.hostname))) throw new UsageError(`--api-origin must use https, or http on a loopback address: "${value}"`);
 if (api.username || api.password || api.pathname !== '/' || api.search || api.hash) throw new UsageError(`--api-origin takes an origin alone, such as https://devshark.app: "${value}"`);
 return api.origin;
}

// The API reads --api-origin answers: GETs whose handler gives every guest
// the same body without a token. client/src/lib/api.ts lists the settings,
// map, catalog and lesson reads as PUBLIC_READ; the boards, the question of
// the day and the curation coverage answer a guest too. A board read with
// me=1 asks for the caller's own row and stays off the list.
export function replayableRead(url) {
 const { pathname, searchParams } = url;
 const resource = searchParams.get('resource');
 switch (pathname) {
  case '/api/settings': return searchParams.size === 0;
  case '/api/leaderboard': return !searchParams.has('me');
  case '/api/quiz/roadmap': return searchParams.size === 0 || (resource === 'learning-path-catalog' && searchParams.size === 1) || (resource === 'lesson' && searchParams.has('id') && searchParams.size === 2);
  case '/api/quiz/daily': return searchParams.has('qotd') && searchParams.size === 1;
  case '/api/quiz/questions': return resource === 'curation';
  case '/api/quiz/challenge': return resource === 'leaderboard';
  default: return false;
 }
}

// The browser context of one sample. Reduced motion stays off unless
// --reduced-motion asks for it: under 'reduce', client/src/lib/motion.tsx
// skips the motion-features chunk and every fade, a lighter page than a
// default visitor or Lighthouse loads.
export function contextOptions(profile, { reducedMotion = false } = {}) {
 const mobile = profile === 'mobile';
 return { viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: 'light', reducedMotion: reducedMotion ? 'reduce' : 'no-preference', serviceWorkers: 'block' };
}

// client/src/lib/consent.ts keeps the visitor's cookie choice under this key.
export const CONSENT_STORAGE_KEY = 'devshark:consent';

// The record "Reject all" stores, in the fields persist() writes. The press
// also writes a devshark_consent cookie copy that nothing reads today, so the
// lab stores the localStorage record only.
export function rejectedConsent(now, version = DEFAULTS.consentVersion) {
 return { version, analytics: false, marketing: false, decidedAt: now };
}

// Pages that never show this app's banner can still be measured. A rejected
// repeat visit that still contains the banner used the wrong consent state.
export function consentStateError(row, version) {
 return row.cache === 'repeat-browser' && row.consent === 'rejected' && row.consentBanner
  ? `Rejected consent version ${version} left the banner present; check --consent-version for this build`
  : null;
}

// The cookie choice each row of a sample loads under. A first visit sees the
// banner, and its paragraph is the LCP element of a cold row; a returning
// visitor who answered it never sees it again.
export function consentByCache(consent) {
 return { 'cold-browser': 'undecided', 'repeat-browser': consent };
}

// Timings of one navigation entry. ttfb follows web-vitals: navigation start
// to the first response byte, so redirect, DNS, TCP and TLS count. serverWait
// keeps the request-to-first-byte gap, which the ttfb field held before
// 18 November 2026.
export function navigationTimings(n) {
 return { ttfb: n.responseStart, serverWait: n.responseStart - n.requestStart, redirect: n.redirectEnd - n.redirectStart, dns: n.domainLookupEnd - n.domainLookupStart, connect: n.connectEnd - n.connectStart, tls: n.secureConnectionStart ? n.connectEnd - n.secureConnectionStart : 0, download: n.responseEnd - n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd };
}

// INP of one sample from raw EventTiming entries. The entries of one press
// (pointerdown, pointerup, click) share an interactionId, and an interaction
// lasts as long as its longest entry. As in web-vitals, INP is the longest
// interaction after skipping one per 50, and its parts come from the first
// longest entry and the entries painted in the same frame (ends within 8 ms),
// so a click handler that ran beside the pointerdown counts as processing. A
// press faster than the observer's 16 ms threshold leaves no entry: it reads
// '<16' when the browser registered it (pressed), and null otherwise.
export function summarizeInteractions(entries, { pressed }) {
 const byInteraction = new Map();
 for (const entry of entries) {
  if (!entry.interactionId) continue;
  if (!byInteraction.has(entry.interactionId)) byInteraction.set(entry.interactionId, []);
  byInteraction.get(entry.interactionId).push(entry);
 }
 const interactions = [...byInteraction.values()]
  .map(group => ({ group, longest: group.reduce((a, b) => (b.duration > a.duration ? b : a)) }))
  .sort((a, b) => b.longest.duration - a.longest.duration);
 if (!interactions.length) return { inpMs: pressed ? '<16' : null, interactionCount: 0, inpParts: null };
 const { group, longest } = interactions[Math.min(interactions.length - 1, Math.floor(interactions.length / 50))];
 const paint = longest.startTime + longest.duration;
 const frame = group.filter(entry => Math.abs(entry.startTime + entry.duration - paint) <= 8);
 const processingEnd = Math.max(...frame.map(entry => entry.processingEnd));
 return {
  inpMs: longest.duration,
  interactionCount: interactions.length,
  inpParts: { event: frame.map(entry => entry.name).join(','), inputDelay: longest.processingStart - longest.startTime, processing: processingEnd - longest.processingStart, presentation: Math.max(0, paint - processingEnd) },
 };
}

// CLS of one sample from raw layout-shift entries, as web-vitals computes it:
// a shift less than 1 s after the window's last shift and less than 5 s after
// its first joins that window, any other opens a new one, and CLS is the
// largest window. Shifts flagged hadRecentInput stay out of the windows.
// clsSum keeps the plain sum the cls field held before 18 November 2026.
// The lab reads shifts before its own press, so clsInputFlagged holds only
// shifts Chromium flagged without a press: phone emulation has flagged a
// first-load shift on this app that way (docs/release-acceptance.md).
export function summarizeLayoutShifts(shifts) {
 let cls = 0, clsSum = 0, clsInputFlagged = 0, session = null;
 for (const shift of [...shifts].sort((a, b) => a.startTime - b.startTime)) {
  if (shift.hadRecentInput) { clsInputFlagged += shift.value; continue; }
  clsSum += shift.value;
  if (session && shift.startTime - session.last < 1000 && shift.startTime - session.first < 5000) {
   session.value += shift.value;
   session.last = shift.startTime;
  } else session = { first: shift.startTime, last: shift.startTime, value: shift.value };
  cls = Math.max(cls, session.value);
 }
 return { cls, clsSum, clsInputFlagged };
}

// Long tasks and total blocking time of one sample, from the 'longtask'
// entries the page observed under the lab's CPU throttle. longTasks covers
// every task of 50 ms or more from navigation start to the measurement point.
// tbtMs follows Lighthouse's sum: each long task clipped to the span from
// first contentful paint to the measurement point, less 50 ms. Lighthouse
// simulates its TBT; this one is observed. null when nothing painted.
export function summarizeLongTasks(tasks, { fcp, end }) {
 const long = tasks.filter(task => task.duration >= 50 && task.startTime < end);
 let tbtMs = null;
 if (fcp !== null) {
  tbtMs = 0;
  for (const task of long) {
   const blocked = Math.min(task.startTime + task.duration, end) - Math.max(task.startTime, fcp);
   if (blocked > 50) tbtMs += blocked - 50;
  }
 }
 return { longTasks: { count: long.length, longest: long.reduce((longest, task) => Math.max(longest, task.duration), 0) }, tbtMs };
}

// The LCP element of a row as one short line for the log, such as
// 'section.ss-consent p#_r_4_.ss-consent__body'. tag is null when the browser
// had already dropped the element from the entry.
export function formatLcpElement(element) {
 if (!element) return 'none';
 const name = element.tag ? element.tag + (element.id ? '#' + element.id : '') + element.classes.map(className => '.' + className).join('') : '(detached)';
 return [element.container, name, element.url].filter(Boolean).join(' ');
}

// The kinds a row counts the requests of its page under, as the lab's
// interception sees them. blocked: the lab failed the request (a write, or
// an origin other than fonts.gstatic.com); api: a request to the origin's
// /api/, whoever answered it; the rest by the browser's resource type.
export const REQUEST_KINDS = ['document', 'script', 'stylesheet', 'font', 'image', 'api', 'other', 'blocked'];
const RESOURCE_KINDS = { Document: 'document', Script: 'script', Stylesheet: 'stylesheet', Font: 'font', Image: 'image' };

export function requestKind(resourceType, url, origin, { blocked = false } = {}) {
 if (blocked) return 'blocked';
 if (url.origin === origin && url.pathname.startsWith('/api/')) return 'api';
 return RESOURCE_KINDS[resourceType] ?? 'other';
}

// The request counters of one row. sent counts the responses the origin
// itself returned over the network (sentApi the /api/ ones among them): no
// browser cache hit, no answer the lab fulfilled from a fixture or a replay.
export function emptyRequestCounts() {
 return { ...Object.fromEntries(REQUEST_KINDS.map(kind => [kind, 0])), sent: 0, sentApi: 0 };
}

export const requestCount = requests => REQUEST_KINDS.reduce((sum, kind) => sum + requests[kind], 0);

// The middle value of a list in the order compare gives (numbers ascending
// by default). An even count takes the lower of the two middle values, so
// every summary value is one a sample measured. null and undefined stay out;
// an empty list gives null.
export function median(values, compare = (a, b) => a - b) {
 const sorted = values.filter(value => value !== null && value !== undefined).sort(compare);
 return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
}

// '<16' marks a press faster than the observer reports: it sorts below
// every measured INP.
const compareInp = (a, b) => (a === '<16' ? -1 : a) - (b === '<16' ? -1 : b);
const CACHE_STATES = ['cold-browser', 'repeat-browser'];

// One summary row per profile, path and cache state, in run order: the
// median of each metric over the measured samples, and the LCP element of
// the median-LCP sample. errors counts the samples a failure left without
// a measurement; a failed setup or cold row costs the repeat row as well,
// because the repeat row loads in the same page after it.
export function summarizeRows(results) {
 const groups = new Map();
 const group = (profile, path, cache) => {
  const key = JSON.stringify([profile, path, cache]);
  if (!groups.has(key)) groups.set(key, { profile, path, cache, rows: [], errors: 0 });
  return groups.get(key);
 };
 for (const row of results) {
  if (!row.error) group(row.profile, row.path, row.cache).rows.push(row);
  else for (const cache of row.cache === 'repeat-browser' ? [row.cache] : CACHE_STATES) group(row.profile, row.path, cache).errors++;
 }
 return [...groups.values()].map(({ profile, path, cache, rows, errors }) => {
  const lcpRow = median(rows, (a, b) => a.lcp - b.lcp);
  return {
   profile, path, cache, samples: rows.length, errors,
   ttfbMs: median(rows.map(row => row.navigation.ttfb)),
   fcpMs: median(rows.map(row => row.fcp)),
   lcpMs: lcpRow?.lcp ?? null,
   lcpElement: lcpRow ? formatLcpElement(lcpRow.lcpElement) : null,
   cls: median(rows.map(row => row.cls)),
   tbtMs: median(rows.map(row => row.tbtMs)),
   inpMs: median(rows.map(row => row.inpMs), compareInp),
   requests: median(rows.map(row => row.requests && requestCount(row.requests))),
  };
 });
}

// What the run's pages asked for and what reached the origin, failed rows
// included. forwarded counts the API reads Node sent to --api-origin.
export function requestTotals(results, { forwarded = 0 } = {}) {
 const totals = { requests: 0, api: 0, sent: 0, sentApi: 0, forwarded };
 for (const { requests } of results) if (requests) {
  totals.requests += requestCount(requests);
  totals.api += requests.api;
  totals.sent += requests.sent;
  totals.sentApi += requests.sentApi;
 }
 return totals;
}

// An incomplete interaction does not discard the row's valid paint metrics.
export function interactionFailures(results) {
 return results.flatMap(row => {
  if (row.error) return [];
  const interaction = row.interaction;
  const reason = !interaction?.matched ? 'control_missing'
   : interaction.error ? 'control_failed'
   : interaction.registered !== true ? 'input_unregistered'
   : !(row.inpMs === '<16' || (typeof row.inpMs === 'number' && Number.isFinite(row.inpMs) && row.inpMs >= 0)) ? 'input_missing' : null;
  return reason ? [{ profile: row.profile, path: row.path, sample: row.sample, cache: row.cache, reason }] : [];
 });
}

const formatInp = inpMs => typeof inpMs === 'number' ? Math.round(inpMs) : inpMs ?? 'none';

// A failure every later load would repeat; it ends the run instead of one row.
class FatalLabError extends Error {}

const firstLine = error => String(error?.message ?? error).split('\n')[0];

export async function main({ origin, routes, samples, profiles, output, access: accessFile, fixture: useFixture, reducedMotion = false, consent = DEFAULTS.consent, consentVersion = DEFAULTS.consentVersion, apiOrigin = null, apiDelayMs = DEFAULTS.apiDelayMs }) {
 mkdirSync(dirname(output), { recursive: true });
 const access = accessFile ? JSON.parse(readFileSync(accessFile, 'utf8')) : null;
 const fixture = useFixture ? JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8')) : null;
 if (fixture) fixture.billing = { ...fixture.billing, enabled: false, launchOffer: false };
 // One anonymous GET per distinct read per run: every later sample gets the
 // same copy, so a run sends single-digit requests to --api-origin.
 const replay = apiOrigin ? { reads: new Map(), unlisted: new Map() } : null;
 const replayRead = key => {
  let read = replay.reads.get(key);
  if (!read) {
   const record = { path: key, status: null, bytes: 0, fetchMs: null, served: 0 };
   const started = performance.now();
   // Node's fetch keeps no cookies; the request carries no Authorization and
   // follows no redirect, so it reads what a signed-out visitor reads.
   const copy = fetch(apiOrigin + key, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30000) })
    .then(async response => {
     const body = Buffer.from(await response.arrayBuffer());
     Object.assign(record, { status: response.status, bytes: body.length, fetchMs: Math.round(performance.now() - started) });
     return { status: response.status, contentType: response.headers.get('content-type') ?? 'application/json', cacheControl: response.headers.get('cache-control') ?? 'no-store', body };
    })
    .catch(error => {
     record.error = firstLine(error);
     return { status: 503, contentType: 'application/json', cacheControl: 'no-store', body: Buffer.from(JSON.stringify({ error: { code: 'replay_failed', message: 'perf:measure could not read this from --api-origin' } })) };
    });
   read = { record, copy };
   replay.reads.set(key, read);
  }
  read.record.served++;
  return read.copy;
 };
 const replaySummary = () => replay && { origin: apiOrigin, delayMs: apiDelayMs, forwarded: replay.reads.size, reads: [...replay.reads.values()].map(read => read.record), unlisted: [...replay.unlisted].map(([path, count]) => ({ path, count })) };
 let browser, chrome;
 const results = [];
 const write = () => writeFileSync(output, JSON.stringify({ environment: { origin, apiOrigin, apiDelayMs: apiOrigin ? apiDelayMs : null, time: new Date().toISOString(), platform: os.platform(), arch: os.arch(), chrome, network: 'mobile150ms/1.6Mbps/CPU4;desktop20ms/10Mbps/CPU1; simulated via CDP', samples, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', consent: consentByCache(consent), consentVersion, consentBannerDefinition: 'DOM presence only; question focus mode can hide the existing banner. This is not a visibility measurement.', ttfbDefinition: 'responseStart (web-vitals)', clsDefinition: 'largest session window (shifts under 1 s apart, window under 5 s) without recent input, read before the lab press; clsSum is the plain sum the cls field held before 18 November 2026; clsInputFlagged sums the shifts flagged hadRecentInput before the press', tbtDefinition: 'long tasks observed under the CPU throttle, each clipped to fcp..measuredAt, less 50 ms, summed (Lighthouse sums the same way over a simulated trace)', summaryDefinition: 'one row per profile, path and cache state: the median of each metric over the measured samples (the lower middle one for an even count, so each value is one a sample measured), the LCP element of the median-LCP sample, errors = samples a failure left without a measurement', requestsDefinition: 'requests the page made per kind at the lab interception; sent = responses the origin returned over the network, without cache hits or answers the lab fulfilled', serverWaitDefinition: 'responseStart - requestStart (navigation.ttfb before 18 November 2026; resources[].ttfb still uses it)', scope: 'anonymous,essential consent,read-only; cold browser is NOT proven cold server; inpMs is one scripted press per load, NOT field INP' }, apiReplay: replaySummary(), requestTotals: requestTotals(results, { forwarded: replay?.reads.size ?? 0 }), summary: summarizeRows(results), interactionFailures: interactionFailures(results), results }, null, 2) + '\n');
 try {
  for (const profile of profiles) for (const path of routes) for (let sample = 0; sample < samples; sample++) {
   // A browser that cannot start fails every sample the same way: let it end the run.
   browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--disk-cache-size=8388608', '--media-cache-size=2097152', '--disable-gpu-shader-disk-cache'] });
   chrome ??= browser.version();
   let context, cache = null, requests = null;
   // One failed navigation (a timeout, an empty 404, a reset) costs its own
   // sample only; the remaining routes, samples and profiles still run.
   try {
    context = await browser.newContext(contextOptions(profile, { reducedMotion }));
    if (access) {
     try {
      if (new URL(access.url).origin !== origin) throw new Error('origin mismatch');
      const response = await context.request.get(access.url);
      if (response.status() !== 200 || new URL(response.url()).origin !== origin) throw new Error('access refused');
     } catch { throw new FatalLabError('Preview authorization failed'); }
    }
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    // Writes the lab refused and requests by kind during the current row's
    // navigation; each row starts again from zero. fulfilled holds the
    // Network ids of the answers the lab made up, which never reach the origin.
    let blockedWrites = 0;
    const fulfilled = new Set(), memoryHits = new Set();
    await cdp.send('Network.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    cdp.on('Network.requestServedFromCache', e => memoryHits.add(e.requestId));
    cdp.on('Fetch.requestPaused', async e => {
     const url = new URL(e.request.url);
     const apiRead = url.origin === origin && url.pathname.startsWith('/api/') && e.request.method === 'GET';
     const replayed = apiRead && replay && !(fixture && url.pathname === '/api/settings') && replayableRead(url);
     const answered = !replayed && apiRead && (fixture || replay);
     const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(e.request.method);
     const blocked = !replayed && !answered && (mutating || (url.origin !== origin && !url.hostname.endsWith('fonts.gstatic.com')));
     // Counted before the first await, so a request lands in the row whose
     // navigation started it.
     if (requests) requests[requestKind(e.resourceType, url, origin, { blocked })]++;
     if (replayed || answered) fulfilled.add(e.networkId);
     if (blocked && mutating) blockedWrites++;
     if (replayed) {
      const [copy] = await Promise.all([replayRead(url.pathname + url.search), new Promise(resolve => setTimeout(resolve, apiDelayMs))]);
      await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: copy.status, responseHeaders: [{ name: 'Content-Type', value: copy.contentType }, { name: 'Cache-Control', value: copy.cacheControl }], body: copy.body.toString('base64') }).catch(() => {});
     } else if (answered) {
      if (replay && !(fixture && url.pathname === '/api/settings')) replay.unlisted.set(url.pathname + url.search, (replay.unlisted.get(url.pathname + url.search) ?? 0) + 1);
      const body = fixture && url.pathname === '/api/settings' ? fixture : { error: { code: 'fixture_only', message: 'Isolated measurement' } };
      await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: fixture && url.pathname === '/api/settings' ? 200 : 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
     } else if (blocked) {
      await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
     } else await cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {});
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile === 'mobile' ? 150 : 20, downloadThroughput: (profile === 'mobile' ? 1.6 : 10) * 1e6 / 8, uploadThroughput: 750000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile === 'mobile' ? 4 : 1 });
    await page.addInitScript(() => {
     localStorage.setItem('devquiz:color-mode', 'light');
     window.__lab = { lcp: 0, lcpElement: null, shifts: [], longTasks: [], events: [], firstInput: null };
     // The element is read when the entry arrives: entry.element turns null
     // once the node leaves the page. container is the closest section or
     // main around it, by its first class.
     const describe = (entry, el = entry.element) => {
      const box = el?.parentElement?.closest('section, main');
      return { tag: el ? el.tagName.toLowerCase() : null, id: el?.id || null, classes: el ? [...el.classList].slice(0, 2) : [], container: box ? box.tagName.toLowerCase() + [...box.classList].slice(0, 1).map(name => '.' + name).join('') : null, size: entry.size, url: entry.url || null };
     };
     new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__lab.lcp = e.startTime; window.__lab.lcpElement = describe(e); } }).observe({ type: 'largest-contentful-paint', buffered: true });
     // Raw shifts; summarizeLayoutShifts() turns them into CLS in Node.
     // takeShifts() adds the entries the observer has not delivered yet.
     const keepShifts = list => { for (const e of list) window.__lab.shifts.push({ startTime: e.startTime, value: e.value, hadRecentInput: e.hadRecentInput }); };
     const shifts = new PerformanceObserver(l => keepShifts(l.getEntries()));
     shifts.observe({ type: 'layout-shift', buffered: true });
     window.__lab.takeShifts = () => { keepShifts(shifts.takeRecords()); return window.__lab.shifts; };
     // Raw long tasks; summarizeLongTasks() turns them into TBT in Node.
     const keepTasks = list => { for (const e of list) window.__lab.longTasks.push({ startTime: e.startTime, duration: e.duration }); };
     const tasks = new PerformanceObserver(l => keepTasks(l.getEntries()));
     tasks.observe({ type: 'longtask', buffered: true });
     window.__lab.takeLongTasks = () => { keepTasks(tasks.takeRecords()); return window.__lab.longTasks; };
     // Raw entries; summarizeInteractions() turns them into INP in Node.
     const record = list => { for (const e of list) if (e.interactionId) window.__lab.events.push({ name: e.name, interactionId: e.interactionId, startTime: e.startTime, processingStart: e.processingStart, processingEnd: e.processingEnd, duration: e.duration }); };
     const events = new PerformanceObserver(l => record(l.getEntries()));
     events.observe({ type: 'event', durationThreshold: 16, buffered: true });
     // The browser reports the first input of a page at any duration, so it
     // tells a press under 16 ms apart from a press that never registered.
     const recordFirst = list => { for (const e of list) window.__lab.firstInput ??= { name: e.name, duration: e.duration }; };
     const first = new PerformanceObserver(l => recordFirst(l.getEntries()));
     first.observe({ type: 'first-input', buffered: true });
     // An entry exists once the frame after the press is presented: wait two
     // frames, then take the entries the observer has not delivered yet.
     window.__lab.flushEvents = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { record(events.takeRecords()); recordFirst(first.takeRecords()); resolve({ events: window.__lab.events, firstInput: window.__lab.firstInput }); }, 0))));
    });
    for (cache of ['cold-browser', 'repeat-browser']) {
     let diskHits = 0;
     blockedWrites = 0;
     requests = emptyRequestCounts();
     const listener = e => {
      const { response } = e;
      if (response.fromDiskCache || response.fromPrefetchCache) diskHits++;
      else if (!response.fromServiceWorker && !fulfilled.has(e.requestId) && !memoryHits.has(e.requestId) && URL.canParse(response.url) && new URL(response.url).origin === origin) {
       requests.sent++;
       if (new URL(response.url).pathname.startsWith('/api/')) requests.sentApi++;
      }
     };
     cdp.on('Network.responseReceived', listener);
     // The repeat row stores the choice on the cold row's page, same origin,
     // before it navigates: no banner press, nothing sent.
     if (consentByCache(consent)[cache] === 'rejected') await page.evaluate(([key, record]) => localStorage.setItem(key, JSON.stringify(record)), [CONSENT_STORAGE_KEY, rejectedConsent(Date.now(), consentVersion)]);
     const started = Date.now();
     await page.goto(origin + path, { waitUntil: 'load', timeout: 60000 });
     await page.waitForTimeout(profile === 'mobile' ? 3000 : 1500);
     const { shifts, longTasks, ...measurement } = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0].toJSON();
      const resources = performance.getEntriesByType('resource').map(r => ({ path: new URL(r.name).pathname, kind: r.initiatorType, start: r.startTime, duration: r.duration, ttfb: r.responseStart - r.requestStart, download: r.responseEnd - r.responseStart, transfer: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize, serverTiming: r.serverTiming.map(t => ({ name: t.name, duration: t.duration })) }));
      // The paint timeline keeps first-contentful-paint, no observer needed.
      const fcp = performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null;
      return { navigation: n, fcp, lcp: window.__lab.lcp, lcpElement: window.__lab.lcpElement, shifts: window.__lab.takeShifts(), longTasks: window.__lab.takeLongTasks(), measuredAt: performance.now(), consentBanner: Boolean(document.querySelector('.ss-consent')), resources, heading: document.querySelector('h1')?.textContent?.trim(), buttons: [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent?.trim()).slice(0, 20) };
     });
     measurement.navigation = navigationTimings(measurement.navigation);
     Object.assign(measurement, summarizeLayoutShifts(shifts), summarizeLongTasks(longTasks, { fcp: measurement.fcp, end: measurement.measuredAt }));
     // Local-only menu/theme or Daily selection; never Check answer/start/submit.
     // Daily's onChange only sets its selected index, with no onActivate.
     const daily = /^\/daily(?:\/\d{4}-\d{2}-\d{2})?\/?$/.test(new URL(path, origin).pathname);
     const control = daily ? 'Select first Daily option' : INTERACTION_CONTROLS[profile].join(' or ');
     let pressed = null;
     if (daily) {
      const button = page.locator('.ss-daily .ss-answer-list').getByRole('radio').first();
      if (await button.count()) pressed = { name: control, button };
     } else for (const name of INTERACTION_CONTROLS[profile]) {
      const button = page.getByRole('button', { name, exact: true }).first();
      if (await button.count()) { pressed = { name, button }; break; }
     }
     measurement.interaction = { control: pressed?.name ?? control, matched: Boolean(pressed) };
     let clicked = false;
     if (pressed) {
      try { await pressed.button.click({ timeout: 10000 }); clicked = true; } catch (error) { measurement.interaction.error = firstLine(error); }
      await page.waitForTimeout(250);
     } else console.warn(`perf:measure: no "${measurement.interaction.control}" control on ${profile} ${path}; this row measures no interaction`);
     const { events, firstInput } = await page.evaluate(() => window.__lab.flushEvents());
     if (clicked) {
      measurement.interaction.registered = Boolean(firstInput);
      if (firstInput) measurement.interaction.firstInput = { event: firstInput.name, ms: firstInput.duration };
      if (!firstInput) console.warn(`perf:measure: the browser registered no input for the "${pressed.name}" press on ${profile} ${path}; this row has no INP`);
     }
     Object.assign(measurement, summarizeInteractions(events, { pressed: clicked && Boolean(firstInput) }));
     if (pressed) await page.keyboard.press('Escape');
     cdp.off('Network.responseReceived', listener);
     const row = { profile, path, sample, cache, consent: consentByCache(consent)[cache], elapsed: Date.now() - started, diskHits, blockedWrites, requests: { ...requests }, ...measurement };
     const consentError = consentStateError(row, consentVersion);
     if (consentError) row.error = consentError;
     results.push(row);
     write();
     console.log(profile, path, sample, cache, 'TTFB', Math.round(row.navigation.ttfb), 'serverWait', Math.round(row.navigation.serverWait), 'FCP', row.fcp === null ? 'none' : Math.round(row.fcp), 'LCP', Math.round(row.lcp), 'lcpElement', formatLcpElement(row.lcpElement), 'CLS', row.cls.toFixed(3), 'TBT', row.tbtMs === null ? 'none' : Math.round(row.tbtMs), 'longTasks', row.longTasks.count, 'INP', formatInp(row.inpMs), 'cacheHits', diskHits, 'requests', requestCount(requests), 'sent', requests.sent, 'consent', row.consent, 'bannerDOM', row.consentBanner ? 'present' : 'absent', 'pressed', row.interaction.matched ? row.interaction.control : 'nothing');
    }
   } catch (error) {
    if (error instanceof FatalLabError) throw error;
    const row = { profile, path, sample, cache, error: firstLine(error), ...(requests && { requests: { ...requests } }) };
    results.push(row);
    write();
    console.log(profile, path, sample, cache ?? 'setup', 'FAILED', row.error);
   } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
    browser = undefined;
   }
  }
 } finally { await browser?.close(); }
 if (replay) {
  const { reads, unlisted } = replaySummary();
  console.log(`perf:measure: forwarded ${reads.length} anonymous API reads to ${apiOrigin}, answered ${reads.reduce((sum, read) => sum + read.served, 0)} page requests from the copies after ${apiDelayMs} ms each:`);
  for (const read of reads) console.log(`  ${read.status ?? 'failed'} ${read.bytes} B ${read.fetchMs ?? '-'} ms served ${read.served}x ${read.path}${read.error ? ' ' + read.error : ''}`);
  if (unlisted.length) {
   console.warn(`perf:measure: ${unlisted.length} API reads are not on the replay list and got the fixture 503:`);
   for (const { path, count } of unlisted) console.warn(`  ${count}x ${path}`);
  }
 }
 const round = value => typeof value === 'number' ? Math.round(value) : value ?? '-';
 console.table(summarizeRows(results).map(row => ({ profile: row.profile, path: row.path, cache: row.cache, samples: row.samples, errors: row.errors, ttfb: round(row.ttfbMs), fcp: round(row.fcpMs), lcp: round(row.lcpMs), cls: row.cls === null ? '-' : row.cls.toFixed(3), tbt: round(row.tbtMs), inp: round(row.inpMs), requests: round(row.requests), lcpElement: row.lcpElement ?? '-' })));
 const totals = requestTotals(results, { forwarded: replay?.reads.size ?? 0 });
 console.log(`perf:measure: the pages made ${totals.requests} requests, ${totals.api} of them to /api/; ${origin} answered ${totals.sent} over the network, ${totals.sentApi} of them API calls${replay ? `, and Node forwarded ${totals.forwarded} API reads to ${apiOrigin}` : ''}.`);
 const incomplete = interactionFailures(results);
 if (incomplete.length) {
  console.error(`perf:measure: ${incomplete.length} of ${results.length} rows have incomplete interaction evidence; valid paint metrics remain stored:`);
  for (const row of incomplete) console.error(`  ${row.profile} ${row.path} sample ${row.sample} ${row.cache}: ${row.reason}`);
  process.exitCode = 1;
 }
 const failed = results.filter(row => row.error);
 if (failed.length) {
  console.error(`perf:measure: ${failed.length} of ${results.length} rows failed and were excluded from the metric summaries:`);
  for (const row of failed) console.error(`  ${row.profile} ${row.path} sample ${row.sample} ${row.cache ?? 'setup'}: ${row.error}`);
  process.exitCode = 1;
 }
 return results;
}

function invokedDirectly() {
 try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (invokedDirectly()) {
 let options;
 try { options = resolveOptions(parseArgs(process.argv.slice(2))); } catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`perf:measure: ${error.message}\n\n${USAGE}`);
  process.exit(2);
 }
 await main(options);
}
