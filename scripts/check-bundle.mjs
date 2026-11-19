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
// The fonts index.html preloads download on the same visit; the check lists
// them beside the budget with their file size (WOFF2 is compressed already)
// and leaves them out of it.
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
import http from 'node:http';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';

const USAGE = 'Usage: node scripts/check-bundle.mjs [--largest=<n>] | --url=<bare HTTPS or HTTP loopback origin>\n  --url=<origin>  observe raw encoded response-body bytes; skip build/budget gate\n  --largest=<n>  how many of the largest chunks to list, a whole number from 1 to 100 (default 10)';

// Every same-origin request index.html starts on its own, as paths under
// assets/: files holds the module entry, modulepreload links and
// stylesheets the budget counts, fonts the <link rel="preload" as="font">
// files it does not.
export function initialRequests(html) {
  const files = [];
  const fonts = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const attr = (name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    const isEntry = tag.startsWith('<script') && attr('type') === 'module' && attr('src');
    const isLink = tag.startsWith('<link');
    const rel = attr('rel');
    const isPreload = isLink && (rel === 'modulepreload' || rel === 'stylesheet');
    const isFont = isLink && rel === 'preload' && attr('as') === 'font';
    const url = isEntry ? attr('src') : isPreload || isFont ? attr('href') : undefined;
    if (url && url.startsWith('/assets/')) (isFont ? fonts : files).push(url.slice(1));
  }
  return { files: [...new Set(files)], fonts: [...new Set(fonts)] };
}

const bytes = (count) => count.toLocaleString('en-US');

// --url observes encoded HTTP response bodies, not browser waterfall/transport overhead.
const LIVE_LIMITS = Object.freeze({ assets: 32, encoded: 8 * 1024 * 1024, decoded: 8 * 1024 * 1024, totalEncoded: 32 * 1024 * 1024, totalDecoded: 64 * 1024 * 1024, html: 1024 * 1024, requestMs: 15_000, totalMs: 30_000 });
const LIVE_HEADERS = ['content-type', 'content-encoding', 'content-length', 'cache-control', 'vary', 'etag', 'last-modified', 'x-vercel-cache', 'x-vercel-id', 'date'];
class BundleUsageError extends Error {}
class LiveTransferError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function bareBundleOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new BundleUsageError('--url must be a bare HTTPS or HTTP loopback origin'); }
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(value) || value.includes('@') || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new BundleUsageError('--url must be a credential-free bare HTTPS or HTTP loopback origin');
  }
  return url.origin;
}

export function bundleOptions(argv) {
  let largestCount = 10, origin = null;
  const seen = new Set();
  for (const arg of argv) {
    const match = /^--(largest|url)=(.*)$/.exec(arg);
    if (!match) throw new BundleUsageError(arg.startsWith('--largest') ? `--largest must be a whole number from 1 to 100, got "${arg}"` : 'unknown argument ' + JSON.stringify(arg));
    const [, name, value] = match;
    if (seen.has(name)) throw new BundleUsageError('repeated --' + name);
    seen.add(name);
    if (name === 'url') origin = bareBundleOrigin(value);
    else {
      if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new BundleUsageError(`--largest must be a whole number from 1 to 100, got "${arg}"`);
      largestCount = Number(value);
    }
  }
  if (origin && seen.has('largest')) throw new BundleUsageError('--largest is for the local build, not --url');
  return { origin, largestCount };
}

// The live graph is deliberately limited to HTML-linked public /assets files.
// External URLs are counted as excluded references, never requested or printed.
export function liveBundleRequests(html, origin) {
  const files = [], fonts = [], seen = new Map(), excluded = {};
  // Walk complete opening tags, skipping comments and raw-text contents.
  // Templates have browser-inert semantics this narrow collector does not model.
  const tags = /<!--[\s\S]*?(?:-->|$)|<([a-z][a-z0-9:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  const rawText = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript']);
  let tagMatch;
  while ((tagMatch = tags.exec(html))) {
    const tag = tagMatch[0], element = tagMatch[1]?.toLowerCase();
    if (!element) continue;
    if (['base', 'template', 'plaintext'].includes(element)) throw new LiveTransferError('unsupported_html_element');
    if (rawText.has(element)) {
      const closing = new RegExp('</' + element + '\\s*>', 'gi'); closing.lastIndex = tags.lastIndex;
      if (!closing.exec(html)) throw new LiveTransferError('unclosed_raw_text_element');
      tags.lastIndex = closing.lastIndex;
    }
    if (!['script', 'link'].includes(element)) continue;
    const attrs = {};
    const contents = tag.replace(/^<\w+\b/, '').replace(/>$/, '');
    for (const match of contents.matchAll(/(?:^|\s)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = match[1].toLowerCase();
      if (Object.hasOwn(attrs, name)) throw new LiveTransferError('duplicate_html_attribute');
      attrs[name] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    const script = /^<script\b/i.test(tag) && attrs.type?.toLowerCase() === 'module' && Object.hasOwn(attrs, 'src');
    const link = /^<link\b/i.test(tag), rel = attrs.rel?.toLowerCase();
    const font = link && rel === 'preload' && attrs.as?.toLowerCase() === 'font';
    if (!script && !(link && ['modulepreload', 'stylesheet'].includes(rel)) && !font) continue;
    const reference = script ? attrs.src : attrs.href;
    if (typeof reference !== 'string' || !reference || /[\s\\]/.test(reference)) throw new LiveTransferError('malformed_asset_reference');
    let url;
    try { url = new URL(reference, origin + '/'); } catch { throw new LiveTransferError('malformed_asset_reference'); }
    if (url.username || url.password || /\/\/[^/]*@/.test(reference)) throw new LiveTransferError('credentialed_asset_reference');
    if (url.origin !== origin) { excluded.externalOrigin = (excluded.externalOrigin ?? 0) + 1; continue; }
    if (url.search || url.hash || reference.includes('?') || reference.includes('#')) throw new LiveTransferError('asset_query_or_fragment');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new LiveTransferError('malformed_asset_reference'); }
    if (!pathname.startsWith('/assets/') || /[\\\u0000-\u0020\u007f]/.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..') || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(reference)) throw new LiveTransferError('asset_outside_public_graph');
    const kind = font ? 'font' : rel === 'stylesheet' ? 'style' : 'script';
    if (seen.has(url.pathname)) {
      if (seen.get(url.pathname) !== kind) throw new LiveTransferError('ambiguous_asset_role');
      continue;
    }
    seen.set(url.pathname, kind);
    if (seen.size > LIVE_LIMITS.assets) throw new LiveTransferError('too_many_initial_assets');
    (font ? fonts : files).push({ path: url.pathname, kind });
  }
  if (files.length === 0) throw new LiveTransferError('no_initial_files');
  return { files, fonts, excluded };
}

function outputTarget(directory) {
  const requested = path.resolve(directory);
  if (existsSync(requested) && lstatSync(requested).isSymbolicLink()) throw new BundleUsageError('live output directory must not be a symlink');
  let parent = requested; const missing = [];
  while (!existsSync(parent)) { missing.unshift(path.basename(parent)); parent = path.dirname(parent); }
  const resolved = path.join(realpathSync(parent), ...missing);
  mkdirSync(resolved, { recursive: true });
  const target = path.join(resolved, 'bundle-live.json');
  const check = () => {
    if (lstatSync(resolved).isSymbolicLink() || !lstatSync(resolved).isDirectory() || realpathSync(resolved) !== resolved) throw new BundleUsageError('live output directory changed');
    try {
      const info = lstatSync(target);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) throw new BundleUsageError('live output must be one regular report file');
      let previous;
      try { previous = JSON.parse(readFileSync(target, 'utf8')); } catch { throw new BundleUsageError('refusing to replace an unrelated live output'); }
      if (previous.mode !== 'live-transfer') throw new BundleUsageError('refusing to replace an unrelated live output');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  check();
  return { target, write(report) {
    check();
    const temporary = path.join(resolved, '.bundle-live-' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      check();
      renameSync(temporary, target);
    } finally { rmSync(temporary, { force: true }); }
  } };
}

function rawBundleResponse(origin, pathname, { timeoutMs, maxBytes }) {
  const url = new URL(pathname, origin), transport = url.protocol === 'https:' ? https : http;
  const agent = new transport.Agent({ keepAlive: false, proxyEnv: {} });
  const start = performance.now();
  return new Promise((resolve) => {
    let done = false, timer, request, response;
    const row = { path: pathname, requestSent: false, status: null, headers: {}, receivedBodyBytes: 0, elapsedMs: null };
    const chunks = [];
    const finish = (error = null) => {
      if (done) return; done = true; clearTimeout(timer);
      response?.destroy(); request?.destroy(); agent.destroy();
      row.elapsedMs = performance.now() - start;
      resolve({ ...row, error, body: error ? null : Buffer.concat(chunks) });
    };
    try {
      request = transport.request(url, { method: 'GET', agent, rejectUnauthorized: true, maxHeaderSize: 8192, headers: { Accept: pathname === '/' ? 'text/html' : '*/*', 'Accept-Encoding': 'br, gzip', 'User-Agent': 'devShark-EpicF-bundle-transfer/1' } }, incoming => {
        response = incoming; row.status = incoming.statusCode;
        for (const name of LIVE_HEADERS) if (typeof incoming.headers[name] === 'string') row.headers[name] = incoming.headers[name].slice(0, 512);
        if (incoming.statusCode !== 200) return finish(incoming.statusCode >= 300 && incoming.statusCode < 400 ? 'redirect_refused' : 'unexpected_status');
        const declared = incoming.headers['content-length'];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return finish('encoded_body_too_large');
        incoming.on('data', chunk => {
          row.receivedBodyBytes += chunk.length;
          if (row.receivedBodyBytes > maxBytes) finish('encoded_body_too_large'); else chunks.push(chunk);
        });
        incoming.once('error', () => finish('response_error'));
        incoming.once('aborted', () => finish('truncated_body'));
        incoming.once('end', () => finish(incoming.complete && (declared === undefined || Number(declared) === row.receivedBodyBytes) ? null : 'truncated_body'));
      });
      request.once('finish', () => { row.requestSent = true; });
      request.once('error', () => finish('request_error'));
      timer = setTimeout(() => finish('request_timeout'), timeoutMs);
      request.end();
    } catch { finish('request_error'); }
  });
}

function decodedBundleBody(raw, kind, remaining) {
  const type = raw.headers['content-type'] ?? '';
  const valid = kind === 'document' ? /^text\/html(?:;|$)/i.test(type) : kind === 'script' ? /^(?:text|application)\/(?:javascript|ecmascript)(?:;|$)/i.test(type) : kind === 'style' ? /^text\/css(?:;|$)/i.test(type) : /^(?:font\/|application\/(?:octet-stream|font-|vnd\.ms-fontobject))/i.test(type);
  if (!valid) throw new LiveTransferError('unexpected_content_type');
  const encoding = (raw.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  const maxOutputLength = Math.min(kind === 'document' ? LIVE_LIMITS.html : LIVE_LIMITS.decoded, remaining);
  let body;
  try {
    if (encoding === 'br') body = brotliDecompressSync(raw.body, { maxOutputLength });
    else if (encoding === 'gzip') body = gunzipSync(raw.body, { maxOutputLength });
    else if (encoding === 'identity') body = raw.body;
    else throw new LiveTransferError('unsupported_content_encoding');
  } catch (error) { if (error instanceof LiveTransferError) throw error; throw new LiveTransferError('invalid_or_oversize_compressed_body'); }
  if (body.length > maxOutputLength) throw new LiveTransferError('decoded_body_too_large');
  if ((kind === 'script' || kind === 'style') && /^\s*(?:<!doctype\s+html|<html\b)/i.test(body.toString('utf8', 0, 256))) throw new LiveTransferError('html_in_asset');
  return { encoding, body };
}

export async function measureLiveBundle({ origin, outputDirectory = 'artifacts', timeoutMs = LIVE_LIMITS.requestMs, totalTimeoutMs = LIVE_LIMITS.totalMs }) {
  origin = bareBundleOrigin(origin);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIVE_LIMITS.requestMs || !Number.isInteger(totalTimeoutMs) || totalTimeoutMs < timeoutMs || totalTimeoutMs > LIVE_LIMITS.totalMs) throw new BundleUsageError('invalid live transfer deadline');
  const output = outputTarget(outputDirectory), started = performance.now();
  const script = readFileSync(fileURLToPath(import.meta.url)), budgetFile = readFileSync(fileURLToPath(new URL('../docs/quality/bundle-budget.json', import.meta.url)));
  const digest = body => createHash('sha256').update(body).digest('hex');
  const report = { mode: 'live-transfer', complete: false, origin, observedAt: new Date().toISOString(), node: process.version, scope: 'Anonymous sequential GETs of document and HTML-linked public initial scripts/modulepreloads/styles/preloaded fonts only. Encoded HTTP body bytes exclude headers, chunk framing, TLS and browser-only dynamic/CSS discoveries. No redirects, retries, cookies or authorization.', scriptSha256: digest(script), budgetSha256: digest(budgetFile), localGzipBudgetReference: JSON.parse(budgetFile).initialGzipBytes, budgetApplied: false, limits: LIVE_LIMITS, deployment: { id: null, sha: null, source: 'Not established by this transfer observation; only returned response/cache/request headers are retained.' }, requestsPlanned: null, requestsAttempted: 0, requestsSent: 0, rows: [], excludedReferences: {}, error: null };
  let totalEncoded = 0, totalDecoded = 0;
  const read = async ({ path: pathname, kind }) => {
    const leftMs = totalTimeoutMs - (performance.now() - started), leftBytes = LIVE_LIMITS.totalEncoded - totalEncoded;
    if (leftMs <= 0) throw new LiveTransferError('total_deadline');
    if (leftBytes <= 0) throw new LiveTransferError('total_encoded_limit');
    const raw = await rawBundleResponse(origin, pathname, { timeoutMs: Math.min(timeoutMs, leftMs), maxBytes: Math.min(kind === 'document' ? LIVE_LIMITS.html : LIVE_LIMITS.encoded, leftBytes) });
    const { body: encoded, ...observation } = raw;
    const row = { ...observation, kind, transferredBytes: encoded?.length ?? null, decodedBytes: null, decodedGzip6Bytes: null, encodedSha256: encoded ? digest(encoded) : null, decodedSha256: null, encoding: null };
    report.rows.push(row); report.requestsAttempted += 1; report.requestsSent += Number(raw.requestSent); totalEncoded += raw.receivedBodyBytes;
    if (raw.error) throw new LiveTransferError(raw.error);
    try {
      const decoded = decodedBundleBody(raw, kind, LIVE_LIMITS.totalDecoded - totalDecoded);
      row.encoding = decoded.encoding; row.decodedBytes = decoded.body.length; row.decodedGzip6Bytes = gzipSync(decoded.body, { level: 6 }).length; row.decodedSha256 = digest(decoded.body); totalDecoded += decoded.body.length;
      if (performance.now() - started > totalTimeoutMs) throw new LiveTransferError('total_deadline');
      return decoded.body;
    } catch (error) { row.error = error.code ?? 'decode_failed'; throw error; }
  };
  try {
    const html = (await read({ path: '/', kind: 'document' })).toString('utf8');
    const graph = liveBundleRequests(html, origin); report.excludedReferences = graph.excluded; report.requestsPlanned = 1 + graph.files.length + graph.fonts.length;
    for (const item of [...graph.files, ...graph.fonts]) await read(item);
    report.complete = true;
  } catch (error) { report.error = { code: error instanceof LiveTransferError ? error.code : 'measurement_failed' }; }
  const sum = (kind, key) => report.rows.filter(row => kind === 'initial' ? ['script', 'style'].includes(row.kind) : row.kind === kind).reduce((value, row) => value + (row[key] ?? 0), 0);
  report.totals = { initialTransferredBytes: sum('initial', 'transferredBytes'), initialDecodedGzip6Bytes: sum('initial', 'decodedGzip6Bytes'), preloadedFontTransferredBytes: sum('font', 'transferredBytes'), documentTransferredBytes: sum('document', 'transferredBytes'), receivedBodyBytes: totalEncoded, decodedBytes: totalDecoded, completeBodiesOnly: true };
  report.completedAt = new Date().toISOString();
  report.elapsedMs = performance.now() - started;
  output.write(report);
  return report;
}

// Builds the production-shaped client, sizes it and removes it again.
function measureBuild(largestCount) {
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

  const html = readFileSync(`${outPath}/index.html`, 'utf8');
  const { files, fonts } = initialRequests(html);
  if (files.length === 0) throw new Error(`No initial requests found in ${outPath}/index.html`);

  const sizes = files.map((file) => ({ file, gzipBytes: gzipSync(readFileSync(`${outPath}/${file}`)).byteLength }));
  const initialGzipBytes = sizes.reduce((sum, item) => sum + item.gzipBytes, 0);
  const preloadedFonts = fonts.map((file) => ({ file, bytes: readFileSync(`${outPath}/${file}`).byteLength }));
  const preloadedFontBytes = preloadedFonts.reduce((sum, item) => sum + item.bytes, 0);
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
  writeFileSync('artifacts/bundle.json', JSON.stringify({ configuration, initialGzipBytes, budget: budget.initialGzipBytes, monitoringGzipBytes, monitoringBudget: budget.monitoringGzipBytes, sizes, preloadedFontBytes, preloadedFonts, chunkCount, largest }, null, 2) + '\n');
  rmSync(outPath, { recursive: true, force: true });

  console.log(`Measured a production-shaped build: ${configuration.product}, with placeholder ${placeholders.join(', ')}.`);
  for (const { file, gzipBytes } of [...sizes].sort((a, b) => b.gzipBytes - a.gzipBytes)) {
    console.log(`  ${String(gzipBytes).padStart(7)}  ${file}`);
  }
  console.log(`Initial requests of index.html: ${files.length} files, ${initialGzipBytes} gzip bytes; budget ${budget.initialGzipBytes}. Lazy routes and the coding sandbox are measured separately by Lighthouse.`);
  console.log(`Preloaded fonts: ${preloadedFonts.length} files, ${bytes(preloadedFontBytes)} bytes (not budgeted)`);
  for (const { file, bytes: size } of preloadedFonts) {
    console.log(`  ${String(size).padStart(7)}  ${file}`);
  }
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
}

function invokedDirectly() {
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (invokedDirectly()) {
  try {
    const options = bundleOptions(process.argv.slice(2));
    if (options.origin) {
      const report = await measureLiveBundle(options);
      for (const row of report.rows) console.log(`${row.kind} ${row.path}: HTTP ${row.status ?? 'unknown'}, ${row.encoding ?? 'unknown'}; ${row.transferredBytes ?? 'unknown'} encoded body bytes, ${row.decodedGzip6Bytes ?? 'unknown'} decoded gzip-6 bytes${row.error ? ' (' + row.error + ')' : ''}`);
      console.log(`Live transfer: ${report.requestsSent}/${report.requestsAttempted} requests sent; ${report.totals.initialTransferredBytes} initial encoded body bytes, ${report.totals.preloadedFontTransferredBytes} preloaded-font bytes. No local budget gate. artifacts/bundle-live.json`);
      if (!report.complete) { console.error('check:bundle live transfer failed: ' + report.error.code); process.exitCode = 1; }
    } else measureBuild(options.largestCount);
  } catch (error) {
    console.error(`check:bundle: ${error instanceof BundleUsageError ? error.message : 'live output or measurement failed'}\n\n${USAGE}`);
    process.exitCode = error instanceof BundleUsageError ? 2 : 1;
  }
}
