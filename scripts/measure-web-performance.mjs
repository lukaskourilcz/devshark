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
const FLAGS = { url: 'value', routes: 'value', samples: 'value', profiles: 'value', output: 'value', access: 'value', fixture: 'switch' };
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
 return { origin: url.origin, routes, samples: Number(samples), profiles, output: args.output ?? DEFAULTS.output, access: args.access ?? null, fixture: args.fixture === true };
}

// A failure every later load would repeat; it ends the run instead of one row.
class FatalLabError extends Error {}

const firstLine = error => String(error?.message ?? error).split('\n')[0];

export async function main({ origin, routes, samples, profiles, output, access: accessFile, fixture: useFixture }) {
 mkdirSync(dirname(output), { recursive: true });
 const access = accessFile ? JSON.parse(readFileSync(accessFile, 'utf8')) : null;
 const fixture = useFixture ? JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8')) : null;
 if (fixture) fixture.billing = { ...fixture.billing, enabled: false, launchOffer: false };
 let browser, chrome;
 const results = [];
 const write = () => writeFileSync(output, JSON.stringify({ environment: { origin, time: new Date().toISOString(), platform: os.platform(), arch: os.arch(), chrome, network: 'mobile150ms/1.6Mbps/CPU4;desktop20ms/10Mbps/CPU1; simulated via CDP', samples, scope: 'anonymous,essential consent,read-only; cold browser is NOT proven cold server; EventTiming is lab interaction latency, NOT field INP' }, results }, null, 2) + '\n');
 try {
  for (const profile of profiles) for (const path of routes) for (let sample = 0; sample < samples; sample++) {
   // A browser that cannot start fails every sample the same way: let it end the run.
   browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, args: ['--disk-cache-size=8388608', '--media-cache-size=2097152', '--disable-gpu-shader-disk-cache'] });
   chrome ??= browser.version();
   let context, cache = null;
   // One failed navigation (a timeout, an empty 404, a reset) costs its own
   // sample only; the remaining routes, samples and profiles still run.
   try {
    context = await browser.newContext({ viewport: profile === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, deviceScaleFactor: 1, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' });
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
     window.__lab = { lcp: 0, cls: 0, interactions: [] };
     new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lab.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
     new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__lab.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
     new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId) window.__lab.interactions.push({ name: e.name, duration: e.duration, inputDelay: e.processingStart - e.startTime }); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    });
    for (cache of ['cold-browser', 'repeat-browser']) {
     let diskHits = 0;
     const listener = e => { if (e.response.fromDiskCache || e.response.fromPrefetchCache) diskHits++; };
     cdp.on('Network.responseReceived', listener);
     const started = Date.now();
     await page.goto(origin + path, { waitUntil: 'load', timeout: 60000 });
     await page.waitForTimeout(profile === 'mobile' ? 3000 : 1500);
     const measurement = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').map(r => ({ path: new URL(r.name).pathname, kind: r.initiatorType, start: r.startTime, duration: r.duration, ttfb: r.responseStart - r.requestStart, download: r.responseEnd - r.responseStart, transfer: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize, serverTiming: r.serverTiming.map(t => ({ name: t.name, duration: t.duration })) }));
      return { navigation: { ttfb: n.responseStart - n.requestStart, dns: n.domainLookupEnd - n.domainLookupStart, connect: n.connectEnd - n.connectStart, tls: n.secureConnectionStart ? n.connectEnd - n.secureConnectionStart : 0, download: n.responseEnd - n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd }, ...window.__lab, resources, heading: document.querySelector('h1')?.textContent?.trim(), buttons: [...document.querySelectorAll('button')].map(b => b.getAttribute('aria-label') || b.textContent?.trim()).slice(0, 20) };
     });
     // Local-only appearance/menu changes; no quiz/start/submit or sign-in action.
     let pressed = null;
     for (const name of INTERACTION_CONTROLS[profile]) {
      const button = page.getByRole('button', { name, exact: true }).first();
      if (await button.count()) { pressed = { name, button }; break; }
     }
     measurement.interaction = { control: pressed?.name ?? INTERACTION_CONTROLS[profile].join(' or '), matched: Boolean(pressed) };
     if (pressed) {
      try { await pressed.button.click({ timeout: 10000 }); } catch (error) { measurement.interaction.error = firstLine(error); }
      await page.waitForTimeout(250);
      measurement.interactions = await page.evaluate(() => window.__lab.interactions);
      await page.keyboard.press('Escape');
     } else console.warn(`perf:measure: no "${measurement.interaction.control}" button on ${profile} ${path}; this row measures no interaction`);
     cdp.off('Network.responseReceived', listener);
     const row = { profile, path, sample, cache, elapsed: Date.now() - started, diskHits, blockedWrites, ...measurement };
     results.push(row);
     write();
     console.log(profile, path, sample, cache, 'TTFB', Math.round(row.navigation.ttfb), 'LCP', Math.round(row.lcp), 'CLS', row.cls.toFixed(3), 'cacheHits', diskHits, 'pressed', row.interaction.matched ? row.interaction.control : 'nothing');
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
