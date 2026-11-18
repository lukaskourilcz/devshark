// Lighthouse lab runs on the mobile and desktop profiles, of one page or of
// a list of routes. CI runs it without flags against the local preview
// (quality.yml) and uploads the reports and summary.json from
// artifacts/performance: mobile.report.* and desktop.report.*. With
// --routes each route gets <profile>-<slug>.report.*, such as
// mobile-home.report.json for / and desktop-learn.report.html for /learn.
// --runs=3 audits each three times, keeps <prefix>-run1.report.* to
// -run3.report.*, and summary.json gives the median, min and max.
//
//   npm run audit:performance -- --url=https://devshark.app
//   npm run audit:performance -- --url=http://127.0.0.1:4173 --routes=/,/learn --runs=3
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { list, median, parseArgs, UsageError } from './measure-web-performance.mjs';

export const PROFILES = ['mobile', 'desktop'];
const FLAGS = { url: 'value', output: 'value', routes: 'value', runs: 'value' };
const DEFAULTS = { url: 'http://localhost:4173', output: 'artifacts/performance', runs: 1 };

export const USAGE = `Usage: node scripts/audit-performance.mjs [flags]
  --url=<url>      page to audit, http or https (default ${DEFAULTS.url}, the CI preview)
  --routes=<paths> comma-separated paths, each starting with one /, resolved against --url;
                   each writes <profile>-<slug>.report.* (slug home for /, learn for /learn)
  --runs=<n>       audits per profile and page, a whole number from 1 to 10 (default ${DEFAULTS.runs});
                   above 1 each report gets -run<k> and summary.json the median, min and max
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
 const runs = args.runs ?? String(DEFAULTS.runs);
 if (!/^\d+$/.test(runs) || Number(runs) < 1 || Number(runs) > 10) throw new UsageError(`--runs must be a whole number from 1 to 10, got "${runs}"`);
 return { url, output: args.output ?? DEFAULTS.output, pages, runs: Number(runs) };
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

const firstLine = error => String(error?.message ?? error).split('\n')[0];

// One audit and its summary row, or an error row when Lighthouse exits
// non-zero, writes no report, or reports a runtime error. The old reports
// of this prefix go first, so a failed run never reads an earlier one.
function audit(lighthouse, { profile, route, url, prefix, run }) {
 for (const extension of ['json', 'html']) rmSync(`${prefix}.report.${extension}`, { force: true });
 const base = { profile, route, requestedUrl: url, run };
 try {
  const status = lighthouse(url, profile, prefix);
  const report = `${prefix}.report.json`;
  const lhr = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  if (lhr?.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
  if (status !== 0) throw new Error(`Lighthouse exited with ${status === null ? 'a signal' : `code ${status}`}`);
  if (!lhr) throw new Error('Lighthouse wrote no report');
  return { ...base, ...reportRow(lhr) };
 } catch (error) {
  return { ...base, error: firstLine(error) };
 }
}

// The values summary.json takes the median, min and max of when --runs is
// above 1.
const STATS = { performance: row => row.scores.performance, lcpMs: row => row.lcpMs, cls: row => row.cls, tbtMs: row => row.tbtMs };

// summary.json: with one run per profile and page, one row per audit, as
// CI has always read it. With more, one row per profile and page with the
// median (the lower middle one for an even count, as perf:measure takes
// it), min and max over the finished runs, and every run under results.
export function summarize(results, runs) {
 if (runs === 1) return results;
 const groups = new Map();
 for (const row of results) {
  const key = JSON.stringify([row.profile, row.route]);
  if (!groups.has(key)) groups.set(key, { profile: row.profile, route: row.route, requestedUrl: row.requestedUrl, rows: [] });
  groups.get(key).rows.push(row);
 }
 return [...groups.values()].map(({ rows, ...page }) => {
  const done = rows.filter(row => !row.error);
  const stat = pick => Object.fromEntries(Object.entries(STATS).map(([name, value]) => [name, pick(done.map(value).filter(Number.isFinite))]));
  return { ...page, runs: rows.length, failed: rows.length - done.length,
   median: stat(median), min: stat(values => (values.length ? Math.min(...values) : null)), max: stat(values => (values.length ? Math.max(...values) : null)),
   results: rows };
 });
}

// Audits every page on both profiles, runs times each. A failed audit
// becomes an error row and the rest still run; summary.json is rewritten
// after each audit, so it holds the finished rows even when the process
// stops early. Returns every audit's row; the caller exits 1 when any
// carries an error. lighthouse runs one audit; the tests pass a stand-in
// that writes canned reports.
export function main({ output, pages, runs = 1 }, { lighthouse = runLighthouse } = {}) {
 mkdirSync(output, { recursive: true });
 const results = [];
 const write = () => writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summarize(results, runs), null, 2) + '\n');
 for (const { route, url, slug } of pages) for (const profile of PROFILES) for (let run = 1; run <= runs; run++) {
  const name = slug ? `${profile}-${slug}` : profile;
  const prefix = path.join(output, runs > 1 ? `${name}-run${run}` : name);
  results.push(audit(lighthouse, { profile, route, url, prefix, run }));
  write();
 }
 if (runs === 1) console.table(results.map(({ profile, route, scores, lcpMs, cls, tbtMs, error }) => (error ? { profile, route, error } : { profile, route, ...scores, lcpMs, cls, tbtMs })));
 else {
  const ms = value => (value === null ? '-' : Math.round(value));
  console.table(summarize(results, runs).map(({ profile, route, runs: count, failed, median: mid, min, max }) => ({ profile, route, runs: count, failed, performance: mid.performance, lcpMs: ms(mid.lcpMs), cls: mid.cls, tbtMs: ms(mid.tbtMs), lcpRange: `${ms(min.lcpMs)}..${ms(max.lcpMs)}`, performanceRange: `${min.performance ?? '-'}..${max.performance ?? '-'}` })));
 }
 console.log('Lab results, not field Core Web Vitals; compare the same URL, build settings and test machine.');
 const failed = results.filter(row => row.error);
 if (failed.length) {
  console.error(`audit:performance: ${failed.length} of ${results.length} audits failed and carry an error instead of a result:`);
  for (const row of failed) console.error(`  ${row.profile} ${row.route} run ${row.run}: ${row.error}`);
 }
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
 if (main(options).some(row => row.error)) process.exitCode = 1;
}
