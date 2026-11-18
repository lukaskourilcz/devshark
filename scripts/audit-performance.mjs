// Lighthouse lab runs of one page on the mobile and desktop profiles. CI
// runs it without flags against the local preview (quality.yml) and uploads
// the reports and summary.json from artifacts/performance.
//
//   npm run audit:performance -- --url=https://devshark.app
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { parseArgs, UsageError } from './measure-web-performance.mjs';

export const PROFILES = ['mobile', 'desktop'];
const FLAGS = { url: 'value', output: 'value' };
const DEFAULTS = { url: 'http://localhost:4173', output: 'artifacts/performance' };

export const USAGE = `Usage: node scripts/audit-performance.mjs [flags]
  --url=<url>      page to audit, http or https (default ${DEFAULTS.url}, the CI preview)
  --output=<dir>   folder for the reports and summary.json (default ${DEFAULTS.output})`;

// Checks the parsed flags and fills the defaults. Throws UsageError before
// anything launches or writes.
export function resolveOptions(args) {
 const url = args.url ?? DEFAULTS.url;
 let parsed;
 try { parsed = new URL(url); } catch { throw new UsageError(`--url is not a URL: "${url}"`); }
 if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UsageError(`--url must use http or https: "${url}"`);
 return { url, output: args.output ?? DEFAULTS.output };
}

export function main({ url, output }) {
 // CI installs Chromium through Playwright; an explicit Chrome path still wins.
 process.env.CHROME_PATH ||= chromium.executablePath();
 mkdirSync(output, { recursive: true });
 const results = [];
 for (const profile of PROFILES) {
  const prefix = path.join(output, profile);
  const run = spawnSync(process.execPath, ['node_modules/lighthouse/cli/index.js', url,
   '--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage', '--output=json', '--output=html', `--output-path=${prefix}`,
   '--only-categories=performance,accessibility,best-practices,seo', ...(profile === 'desktop' ? ['--preset=desktop'] : []), '--quiet'], { stdio: 'inherit', env: process.env });
  if (run.status !== 0) process.exit(run.status || 1);
  const lhr = JSON.parse(readFileSync(`${prefix}.report.json`, 'utf8'));
  if (lhr.runtimeError) throw new Error(lhr.runtimeError.message);
  results.push({ profile, requestedUrl: url, finalUrl: lhr.finalDisplayedUrl, fetchTime: lhr.fetchTime,
   lighthouseVersion: lhr.lighthouseVersion, scores: Object.fromEntries(Object.entries(lhr.categories).map(([key, value]) => [key, value.score])),
   lcpMs: lhr.audits['largest-contentful-paint'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue,
   tbtMs: lhr.audits['total-blocking-time'].numericValue, transferredBytes: lhr.audits['total-byte-weight'].numericValue,
   warnings: lhr.runWarnings,
  });
 }
 writeFileSync(path.join(output, 'summary.json'), JSON.stringify(results, null, 2) + '\n');
 console.table(results.map(({ profile, scores, lcpMs, cls, tbtMs }) => ({ profile, ...scores, lcpMs, cls, tbtMs })));
 console.log('Lab results, not field Core Web Vitals; compare the same URL, build settings and test machine.');
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
