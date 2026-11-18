// Bounded read-only browser lab. Never submits forms, logs in, or writes APIs.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROFILES = ['mobile', 'desktop'];
// The local-only button each profile presses, by its accessible name in
// client/src/i18n/translations.ts. app-shell.css hides the menu button from
// 1024px, so the 1440px desktop profile presses the footer theme toggle,
// which names the mode it switches to.
export const INTERACTION_CONTROLS = { mobile: ['Open navigation menu'], desktop: ['Dark mode', 'Light mode'] };
const FLAGS = { url: 'value', routes: 'value', samples: 'value', profiles: 'value', output: 'value', access: 'value', fixture: 'switch', 'reduced-motion': 'switch' };
// No default origin: a bare run would send 64 page loads to production.
const DEFAULTS = {
 routes: '/,/learn,/coding,/quiz,/daily,/premium,/topics/javascript-closures,/leaderboard',
 samples: 3,
 output: 'artifacts/performance/web-lab.json',
};

export const USAGE = `Usage: node scripts/measure-web-performance.mjs --url=<origin> [flags]
  --url=<origin>        origin to load, required (http://127.0.0.1:<port> for a local preview)
  --routes=<paths>      comma-separated paths, each starting with / (default ${DEFAULTS.routes})
  --samples=<n>         loads per route and profile, a whole number from 1 to 10 (default ${DEFAULTS.samples})
  --profiles=<names>    comma-separated, any of ${PROFILES.join(',')} (default ${PROFILES.join(',')})
  --output=<file>       lab JSON to write (default ${DEFAULTS.output})
  --fixture             answer the origin's API GETs from tests/fixtures/api-settings.json
  --reduced-motion      load pages as a visitor who asked for reduced motion (default: no preference)
  --access=<file>       JSON whose url authorizes a preview before each load`;

export class UsageError extends Error {}

// Splits --name=value at the first '=', reads a bare --name as true and
// refuses flags the lab does not know, so a typo cannot fall back to a default.
export function parseArgs(argv) {
 const args = {};
 for (const arg of argv) {
  if (!arg.startsWith('--') || arg === '--') throw new UsageError(`unexpected argument "${arg}"`);
  const equals = arg.indexOf('=');
  const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
  const value = equals === -1 ? true : arg.slice(equals + 1);
  if (!Object.hasOwn(FLAGS, name)) throw new UsageError(`unknown flag --${name}`);
  if (Object.hasOwn(args, name)) throw new UsageError(`--${name} appears twice`);
  if (FLAGS[name] === 'switch' && value !== true) throw new UsageError(`--${name} takes no value`);
  if (FLAGS[name] === 'value' && (value === true || value === '')) throw new UsageError(`--${name} needs a value: --${name}=<value>`);
  args[name] = value;
 }
 return args;
}

function list(value, flag) {
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
 return { origin: url.origin, routes, samples: Number(samples), profiles, output: args.output ?? DEFAULTS.output, access: args.access ?? null, fixture: args.fixture === true, reducedMotion: args['reduced-motion'] === true };
}

// The browser context of one sample. Reduced motion stays off unless
// --reduced-motion asks for it: under 'reduce', client/src/lib/motion.tsx
// skips the motion-features chunk and every fade, a lighter page than a
// default visitor or Lighthouse loads.
export function contextOptions(profile, { reducedMotion = false } = {}) {
 const mobile = profile === 'mobile';
 return { viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, colorScheme: 'light', reducedMotion: reducedMotion ? 'reduce' : 'no-preference', serviceWorkers: 'block' };
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

const formatInp = inpMs => typeof inpMs === 'number' ? Math.round(inpMs) : inpMs ?? 'none';

// A failure every later load would repeat; it ends the run instead of one row.
class FatalLabError extends Error {}

const firstLine = error => String(error?.message ?? error).split('\n')[0];

export async function main({ origin, routes, samples, profiles, output, access: accessFile, fixture: useFixture, reducedMotion = false }) {
 mkdirSync(dirname(output), { recursive: true });
 const access = accessFile ? JSON.parse(readFileSync(accessFile, 'utf8')) : null;
 const fixture = useFixture ? JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8')) : null;
 if (fixture) fixture.billing = { ...fixture.billing, enabled: false, launchOffer: false };
 let browser, chrome;
 const results = [];
 const write = () => writeFileSync(output, JSON.stringify({ environment: { origin, time: new Date().toISOString(), platform: os.platform(), arch: os.arch(), chrome, network: 'mobile150ms/1.6Mbps/CPU4;desktop20ms/10Mbps/CPU1; simulated via CDP', samples, reducedMotion: reducedMotion ? 'reduce' : 'no-preference', ttfbDefinition: 'responseStart (web-vitals)', clsDefinition: 'largest session window (shifts under 1 s apart, window under 5 s) without recent input, read before the lab press; clsSum is the plain sum the cls field held before 18 November 2026; clsInputFlagged sums the shifts flagged hadRecentInput before the press', tbtDefinition: 'long tasks observed under the CPU throttle, each clipped to fcp..measuredAt, less 50 ms, summed (Lighthouse sums the same way over a simulated trace)', serverWaitDefinition: 'responseStart - requestStart (navigation.ttfb before 18 November 2026; resources[].ttfb still uses it)', scope: 'anonymous,essential consent,read-only; cold browser is NOT proven cold server; inpMs is one scripted press per load, NOT field INP' }, results }, null, 2) + '\n');
 try {
  for (const profile of profiles) for (const path of routes) for (let sample = 0; sample < samples; sample++) {
   // A browser that cannot start fails every sample the same way: let it end the run.
   browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--disk-cache-size=8388608', '--media-cache-size=2097152', '--disable-gpu-shader-disk-cache'] });
   chrome ??= browser.version();
   let context, cache = null;
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
    let blockedWrites = 0;
    await cdp.send('Network.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    cdp.on('Fetch.requestPaused', async e => {
     const url = new URL(e.request.url);
     if (fixture && url.origin === origin && url.pathname.startsWith('/api/') && e.request.method === 'GET') {
      const body = url.pathname === '/api/settings' ? fixture : { error: { code: 'fixture_only', message: 'Isolated measurement' } };
      await cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: url.pathname === '/api/settings' ? 200 : 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {});
     } else if (!['GET', 'HEAD', 'OPTIONS'].includes(e.request.method) || (url.origin !== origin && !url.hostname.endsWith('fonts.gstatic.com'))) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(e.request.method)) blockedWrites++;
      await cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
     } else await cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {});
    });
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: profile === 'mobile' ? 150 : 20, downloadThroughput: (profile === 'mobile' ? 1.6 : 10) * 1e6 / 8, uploadThroughput: 750000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile === 'mobile' ? 4 : 1 });
    await page.addInitScript(() => {
     localStorage.setItem('devquiz:color-mode', 'light');
     window.__lab = { lcp: 0, shifts: [], longTasks: [], events: [], firstInput: null };
     new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lab.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
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
     const listener = e => { if (e.response.fromDiskCache || e.response.fromPrefetchCache) diskHits++; };
     cdp.on('Network.responseReceived', listener);
     const started = Date.now();
     await page.goto(origin + path, { waitUntil: 'load', timeout: 60000 });
     await page.waitForTimeout(profile === 'mobile' ? 3000 : 1500);
     const { shifts, longTasks, ...measurement } = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0].toJSON();
      const resources = performance.getEntriesByType('resource').map(r => ({ path: new URL(r.name).pathname, kind: r.initiatorType, start: r.startTime, duration: r.duration, ttfb: r.responseStart - r.requestStart, download: r.responseEnd - r.responseStart, transfer: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize, serverTiming: r.serverTiming.map(t => ({ name: t.name, duration: t.duration })) }));
      // The paint timeline keeps first-contentful-paint, no observer needed.
      const fcp = performance.getEntriesByName('first-contentful-paint', 'paint')[0]?.startTime ?? null;
      return { navigation: n, fcp, lcp: window.__lab.lcp, shifts: window.__lab.takeShifts(), longTasks: window.__lab.takeLongTasks(), measuredAt: performance.now(), resources, heading: document.querySelector('h1')?.textContent?.trim(), buttons: [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent?.trim()).slice(0, 20) };
     });
     measurement.navigation = navigationTimings(measurement.navigation);
     Object.assign(measurement, summarizeLayoutShifts(shifts), summarizeLongTasks(longTasks, { fcp: measurement.fcp, end: measurement.measuredAt }));
     // Local-only appearance/menu changes; no quiz/start/submit or sign-in action.
     let pressed = null;
     for (const name of INTERACTION_CONTROLS[profile]) {
      const button = page.getByRole('button', { name, exact: true }).first();
      if (await button.count()) { pressed = { name, button }; break; }
     }
     measurement.interaction = { control: pressed?.name ?? INTERACTION_CONTROLS[profile].join(' or '), matched: Boolean(pressed) };
     let clicked = false;
     if (pressed) {
      try { await pressed.button.click({ timeout: 10000 }); clicked = true; } catch (error) { measurement.interaction.error = firstLine(error); }
      await page.waitForTimeout(250);
     } else console.warn(`perf:measure: no "${measurement.interaction.control}" button on ${profile} ${path}; this row measures no interaction`);
     const { events, firstInput } = await page.evaluate(() => window.__lab.flushEvents());
     if (clicked) {
      measurement.interaction.registered = Boolean(firstInput);
      if (firstInput) measurement.interaction.firstInput = { event: firstInput.name, ms: firstInput.duration };
      if (!firstInput) console.warn(`perf:measure: the browser registered no input for the "${pressed.name}" press on ${profile} ${path}; this row has no INP`);
     }
     Object.assign(measurement, summarizeInteractions(events, { pressed: clicked && Boolean(firstInput) }));
     if (pressed) await page.keyboard.press('Escape');
     cdp.off('Network.responseReceived', listener);
     const row = { profile, path, sample, cache, elapsed: Date.now() - started, diskHits, blockedWrites, ...measurement };
     results.push(row);
     write();
     console.log(profile, path, sample, cache, 'TTFB', Math.round(row.navigation.ttfb), 'serverWait', Math.round(row.navigation.serverWait), 'FCP', row.fcp === null ? 'none' : Math.round(row.fcp), 'LCP', Math.round(row.lcp), 'CLS', row.cls.toFixed(3), 'TBT', row.tbtMs === null ? 'none' : Math.round(row.tbtMs), 'longTasks', row.longTasks.count, 'INP', formatInp(row.inpMs), 'cacheHits', diskHits, 'pressed', row.interaction.matched ? row.interaction.control : 'nothing');
    }
   } catch (error) {
    if (error instanceof FatalLabError) throw error;
    const row = { profile, path, sample, cache, error: firstLine(error) };
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
 const unpressed = results.filter(row => !row.error && !row.interaction.matched);
 if (unpressed.length) console.warn(`perf:measure: ${unpressed.length} of ${results.length} rows found no button to press and measure no interaction`);
 const failed = results.filter(row => row.error);
 if (failed.length) {
  console.error(`perf:measure: ${failed.length} of ${results.length} rows failed and carry an error instead of a measurement:`);
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
