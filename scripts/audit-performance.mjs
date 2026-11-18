// Lighthouse lab runs on the mobile and desktop profiles, of one page or of
// a list of routes. CI runs it without flags against the local preview
// (quality.yml) and uploads the reports and summary.json from
// artifacts/performance: mobile.report.* and desktop.report.*. With
// --routes each route gets <profile>-<slug>.report.*, such as
// mobile-home.report.json for / and desktop-learn.report.html for /learn.
//
//   npm run audit:performance -- --url=https://devshark.app
//   npm run audit:performance -- --url=http://127.0.0.1:4173 --routes=/,/learn
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { list, parseArgs, UsageError } from './measure-web-performance.mjs';

export const PROFILES = ['mobile', 'desktop'];
const FLAGS = { url: 'value', output: 'value', routes: 'value' };
const DEFAULTS = { url: 'http://localhost:4173', output: 'artifacts/performance' };

export const USAGE = `Usage: node scripts/audit-performance.mjs [flags]
  --url=<url>      page to audit, http or https (default ${DEFAULTS.url}, the CI preview)
  --routes=<paths> comma-separated paths, each starting with one /, resolved against --url;
                   each writes <profile>-<slug>.report.* (slug home for /, learn for /learn)
  --output=<dir>   folder for the reports and summary.json (default ${DEFAULTS.output})`;

// The report name of a route: home for /, the path segments joined by '-'
// otherwise, and a query after one more '-'. A character a file name should
// not carry becomes '_'.
export function routeSlug(route) {
 const { pathname, search } = new URL(route, 'http://route.invalid');
 const parts = pathname.split('/').filter(Boolean);
 if (search) parts.push(search.slice(1));
 return parts.length ? parts.join('-').replace(/[^A-Za-z0-9._-]/g, '_') : 'home';
}

// Checks the parsed flags and fills the defaults. Throws UsageError before
// anything launches or writes. pages lists what to audit: --url alone with
// no slug, so its reports keep the names CI uploads, or one page per route.
export function resolveOptions(args) {
 const url = args.url ?? DEFAULTS.url;
 let parsed;
 try { parsed = new URL(url); } catch { throw new UsageError(`--url is not a URL: "${url}"`); }
 if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UsageError(`--url must use http or https: "${url}"`);
 let pages = [{ route: parsed.pathname + parsed.search, url, slug: null }];
 if (args.routes !== undefined) {
  const slugs = new Map();
  pages = list(args.routes, 'routes').map(route => {
   if (!route.startsWith('/') || route.startsWith('//')) throw new UsageError(`--routes entries must start with one /, got "${route}"`);
   const slug = routeSlug(route);
   if (slugs.has(slug)) throw new UsageError(`--routes "${slugs.get(slug)}" and "${route}" would both write ${slug} reports`);
   slugs.set(slug, route);
   return { route, url: new URL(route, parsed).href, slug };
  });
 }
 return { url, output: args.output ?? DEFAULTS.output, pages };
}

// One Lighthouse run of url on a profile. Lighthouse writes
// <prefix>.report.json and <prefix>.report.html; the exit status comes back.
export function runLighthouse(url, profile, prefix) {
 // CI installs Chromium through Playwright; an explicit Chrome path still wins.
 const env = { ...process.env, CHROME_PATH: process.env.CHROME_PATH || chromium.executablePath() };
 const run = spawnSync(process.execPath, ['node_modules/lighthouse/cli/index.js', url,
  '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage', '--output=json', '--output=html', `--output-path=${prefix}`,
  '--only-categories=performance,accessibility,best-practices,seo', ...(profile === 'desktop' ? ['--preset=desktop'] : []), '--quiet'], { stdio: 'inherit', env });
 return run.status;
}

// The summary row of one finished report.
export function reportRow(lhr) {
 return { finalUrl: lhr.finalDisplayedUrl, fetchTime: lhr.fetchTime,
  lighthouseVersion: lhr.lighthouseVersion, scores: Object.fromEntries(Object.entries(lhr.categories).map(([key, value]) => [key, value.score])),
  lcpMs: lhr.audits['largest-contentful-paint'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue,
  tbtMs: lhr.audits['total-blocking-time'].numericValue, transferredBytes: lhr.audits['total-byte-weight'].numericValue,
  warnings: lhr.runWarnings,
 };
}

// Audits every page on both profiles and writes summary.json. lighthouse
// runs one audit; the tests pass a stand-in that writes canned reports.
export function main({ output, pages }, { lighthouse = runLighthouse } = {}) {
 mkdirSync(output, { recursive: true });
 const results = [];
 for (const { route, url, slug } of pages) for (const profile of PROFILES) {
  const prefix = path.join(output, slug ? `${profile}-${slug}` : profile);
  const status = lighthouse(url, profile, prefix);
  if (status !== 0) process.exit(status || 1);
  const lhr = JSON.parse(readFileSync(`${prefix}.report.json`, 'utf8'));
  if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
  results.push({ profile, route, requestedUrl: url, ...reportRow(lhr) });
 }
 writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
 console.table(results.map(({ profile, route, scores, lcpMs, cls, tbtMs }) => ({ profile, route, ...scores, lcpMs, cls, tbtMs })));
 console.log('Lab results, not field Core Web Vitals; compare the same URL, build settings and test machine.');
 return results;
}

function invokedDirectly() {
 try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (invokedDirectly()) {
 let options;
 try { options = resolveOptions(parseArgs(process.argv.slice(2), FLAGS)); } catch (error) {
  if (!(error instanceof UsageError)) throw error;
  console.error(`audit:performance: ${error.message}\n\n${USAGE}`);
  process.exit(2);
 }
 main(options);
}
