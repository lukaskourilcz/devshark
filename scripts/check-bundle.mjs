// Initial-load budget: the JavaScript and CSS a first visit to devshark.app
// downloads before anything interactive happens.
//
// The number has to describe what production serves, so the check builds its
// own copy of the client with production's shape instead of reading whatever
// client/dist holds. Client code depends on build-time variables: while
// lib/supabaseClient.ts created the Supabase client eagerly, a build without
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY left out about 55 kB that every
// visitor loaded, and CI's main build set only VITE_PRODUCT and
// VITE_LOCK_SUBJECT. docs/quality/bundle-budget.json lists the variables
// production sets and gives each a placeholder of realistic length; this
// check applies them to its own build only, in its own output directory.
//
// The measurement follows index.html the way a browser does on a first visit:
// the entry script, its modulepreload links and its stylesheets, each gzipped.
// It also lists the largest JavaScript and CSS chunks of the whole build
// (ten unless --largest=N says otherwise), initial or lazy, under `largest`
// in artifacts/bundle.json.
//
// For the treemap of the same production-shaped build, run it with
// ANALYZE=true: client/vite.config.ts then writes client/dist/bundle-stats.html
// and bundle-stats.json, which stay after the check removes its own build.
//
//   npm run check:bundle
//   npm run check:bundle -- --largest=20
//   ANALYZE=true npm run check:bundle
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const USAGE = 'Usage: node scripts/check-bundle.mjs [--largest=<n>]\n  --largest=<n>  how many of the largest chunks to list, a whole number from 1 to 100 (default 10)';
let largestCount = 10;
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--largest=(\d+)$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 100) {
    console.error(`check:bundle: ${arg.startsWith('--largest') ? `--largest must be a whole number from 1 to 100, got "${arg}"` : `unknown argument "${arg}"`}\n\n${USAGE}`);
    process.exit(2);
  }
  largestCount = Number(match[1]);
}

const budget = JSON.parse(readFileSync('docs/quality/bundle-budget.json', 'utf8'));
const { outDir, env: shapedEnv } = budget.measuredBuild;
const outPath = `client/${outDir}`;

const shaped = Object.entries(shapedEnv);
rmSync(outPath, { recursive: true, force: true });
const build = spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
  cwd: 'client',
  env: { ...process.env, ...shapedEnv },
  stdio: 'inherit',
});
if (build.status !== 0) {
  console.error(`The measured build failed (exit ${build.status}).`);
  process.exit(build.status ?? 1);
}

// Every same-origin request index.html starts on its own: module entry,
// modulepreload links and stylesheets.
const html = readFileSync(`${outPath}/index.html`, 'utf8');
const requests = [];
for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
  const attr = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const isEntry = tag.startsWith('<script') && attr('type') === 'module' && attr('src');
  const rel = attr('rel');
  const isPreload = tag.startsWith('<link') && (rel === 'modulepreload' || rel === 'stylesheet');
  const url = isEntry ? attr('src') : isPreload ? attr('href') : undefined;
  if (url && url.startsWith('/assets/')) requests.push(url.slice(1));
}
const files = [...new Set(requests)];
if (files.length === 0) throw new Error(`No initial requests found in ${outPath}/index.html`);

const sizes = files.map((file) => ({ file, gzipBytes: gzipSync(readFileSync(`${outPath}/${file}`)).byteLength }));
const initialGzipBytes = sizes.reduce((sum, item) => sum + item.gzipBytes, 0);
// The SDK starts during bootstrap even though it is a dynamic chunk. Budget
// it separately so an open namespace cannot silently retain Replay/profiling.
const monitoringFiles = readdirSync(`${outPath}/assets`).filter(name => /^sentry-sdk-.*\.js$/.test(name));
if (monitoringFiles.length !== 1) throw new Error('Expected one closed Sentry SDK chunk in the shaped build');
const monitoringGzipBytes = gzipSync(readFileSync(`${outPath}/assets/${monitoringFiles[0]}`)).byteLength;

// Every JavaScript and CSS file the build emitted, gzipped, largest first.
// initial marks the ones a first visit requests.
const initial = new Set(files);
const largest = readdirSync(`${outPath}/assets`, { recursive: true })
  .filter((name) => /\.(?:js|css)$/.test(name))
  .map((name) => {
    const file = `assets/${name.split(path.sep).join('/')}`;
    return { file, gzipBytes: gzipSync(readFileSync(`${outPath}/${file}`)).byteLength, initial: initial.has(file) };
  })
  .sort((a, b) => b.gzipBytes - a.gzipBytes || a.file.localeCompare(b.file));
const chunkCount = largest.length;
largest.splice(largestCount);

const placeholders = shaped.filter(([key]) => !['VITE_PRODUCT', 'VITE_LOCK_SUBJECT'].includes(key)).map(([key]) => key);
const configuration = {
  build: `vite build --outDir ${outDir}`,
  product: `VITE_PRODUCT=${shapedEnv.VITE_PRODUCT}, VITE_LOCK_SUBJECT=${shapedEnv.VITE_LOCK_SUBJECT}`,
  placeholders,
};

mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/bundle.json', JSON.stringify({ configuration, initialGzipBytes, budget: budget.initialGzipBytes, monitoringGzipBytes, monitoringBudget: budget.monitoringGzipBytes, sizes, chunkCount, largest }, null, 2) + '\n');
rmSync(outPath, { recursive: true, force: true });

console.log(`Measured a production-shaped build: ${configuration.product}, with placeholder ${placeholders.join(', ')}.`);
for (const { file, gzipBytes } of [...sizes].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
  console.log(`  ${String(gzipBytes).padStart(7)}  ${file}`);
}
console.log(`Initial requests of index.html: ${files.length} files, ${initialGzipBytes} gzip bytes; budget ${budget.initialGzipBytes}. Lazy routes, the coding sandbox and fonts are measured separately by Lighthouse.`);
console.log(`The ${largest.length} largest of ${chunkCount} JavaScript and CSS chunks, gzipped:`);
for (const { file, gzipBytes, initial: first } of largest) {
  console.log(`  ${String(gzipBytes).padStart(7)}  ${file}${first ? '  (initial)' : ''}`);
}
if (initialGzipBytes > budget.initialGzipBytes) {
  console.error(`Over budget by ${initialGzipBytes - budget.initialGzipBytes} gzip bytes.`);
  process.exitCode = 1;
}

console.log(`Monitoring SDK: ${monitoringGzipBytes} gzip bytes; budget ${budget.monitoringGzipBytes}.`);
if (monitoringGzipBytes > budget.monitoringGzipBytes) {
  console.error(`Monitoring SDK over budget by ${monitoringGzipBytes - budget.monitoringGzipBytes} bytes.`);
  process.exitCode = 1;
}
