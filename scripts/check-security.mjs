import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, sep } from 'node:path';
import { headerNames, vercelAnswer } from './vercel-headers.mjs';
const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
// The header rules are `routes` that run before the filesystem check
// (scripts/vercel-routing-contract.ts says why they are not `headers`).
const headerRoutes = config.routes.slice(0, config.routes.findIndex(route => route.handle));
const header = (route, name) => Object.entries(route.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
// The app policy is the one that forbids framing the page. Picking the rule by
// its src shape picked whichever `^/(?!` rule came first, so a later document
// rule written the same way would have been checked in its place.
const appRules = headerRoutes.filter(route => /(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/i.test(header(route, 'Content-Security-Policy') ?? ''));
assert.equal(appRules.length, 1, `Exactly one header route may carry the app policy (frame-ancestors 'none'); found ${appRules.map(route => route.src).join(', ') || 'none'}`);
const [app] = appRules;
const csp = header(app, 'Content-Security-Policy');

// The type values a browser runs as script (the HTML standard's JavaScript MIME
// type essences, module, and the two JSON types it still checks against
// script-src). Any other type is a data block, such as application/ld+json.
const SCRIPT_TYPES = new Set([
  '', 'module', 'importmap', 'speculationrules',
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);

/** The inline <script> elements of an HTML page whose text the page's policy
 * must allow, and the number of data blocks skipped. A script with src is
 * external, an empty one never runs, and a script inside a comment is text. */
function inlineScripts(html) {
  const scripts = [];
  let dataBlocks = 0;
  for (const match of html.matchAll(/<!--[\s\S]*?(?:-->|$)|<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (match[0].startsWith('<!--')) continue;
    const attributes = new Map([...match[1].matchAll(/([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)]
      .map(([, name, double, single, bare]) => [name.toLowerCase(), double ?? single ?? bare ?? '']));
    if (attributes.has('src')) continue;
    const language = attributes.get('language');
    const type = attributes.has('type') ? attributes.get('type') : language ? `text/${language}` : '';
    if (!SCRIPT_TYPES.has(type.trim().toLowerCase())) dataBlocks += 1;
    else if (match[2] !== '') scripts.push(match[2]);
  }
  return { scripts, dataBlocks };
}

const sourceHash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** Whether `policy` (from parsePolicy) lets an inline script with `text` run:
 * one of its hashes matches, or it allows 'unsafe-inline' and names no hash or
 * nonce (either of which turns 'unsafe-inline' off). */
function inlineScriptAllowed(policy, text) {
  const sources = policy.get('script-src-elem') ?? policy.get('script-src') ?? policy.get('default-src');
  if (!sources) return true;
  const hashes = sources.map(source => /^'sha(256|384|512)-([^']+)'$/i.exec(source)).filter(Boolean);
  if (hashes.some(([, bits, digest]) => createHash(`sha${bits}`).update(text).digest('base64') === digest)) return true;
  return sources.includes("'unsafe-inline'") && hashes.length === 0
    && !sources.some(source => /^'nonce-/i.test(source) || source === "'strict-dynamic'");
}

// Every script client/index.html runs inline, today the theme bootstrap.
const bootstrapHashes = inlineScripts(readFileSync('client/index.html', 'utf8')).scripts.map(sourceHash);

/** A policy as a Map from directive name to its sources, as written. */
function parsePolicy(policy) {
  const directives = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    // A browser obeys the first copy of a directive and ignores the rest.
    assert(!directives.has(name.toLowerCase()), `${name} appears twice in one policy`);
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

// The app document's policy, directive by directive. vercel.json must list
// exactly these sources (in any order) and no other directive, so a host added
// to img-src, script-src or connect-src fails here: change vercel.json and
// this table in the same commit.
const STRIPE_FRAMES = ["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com', 'https://checkout.stripe.com', 'https://link.com', 'https://*.link.com'];
const APP_POLICY = {
  'default-src': ["'self'"],
  // Stripe.js for checkout (client/src/lib/stripeCheckoutForm.ts), and each
  // inline script of client/index.html by its hash.
  'script-src': ["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://checkout.stripe.com', ...bootstrapHashes],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
  'img-src': ["'self'", 'data:', 'https:'],
  // Stripe's API and Link; Supabase REST, Auth and the realtime socket; the
  // Sentry EU ingest host, which the DSN in client/src/lib/sentry.ts posts to
  // directly (no tunnel), so without it browser errors never arrive.
  'connect-src': ["'self'", 'https://api.stripe.com', 'https://checkout.stripe.com', 'https://link.com', 'https://*.link.com', 'https://*.supabase.co', 'wss://*.supabase.co', 'https://*.ingest.de.sentry.io'],
  // Stripe's checkout, Link and 3-D Secure frames.
  'frame-src': STRIPE_FRAMES,
  'child-src': STRIPE_FRAMES,
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
};
/** How policy `actual` differs from policy `expected` (both from
 * parsePolicy), directive by directive; sources may come in any order. The
 * names say where each policy comes from. */
function policyDifferences(actual, expected, actualName, expectedName) {
  const differences = [];
  for (const directive of new Set([...actual.keys(), ...expected.keys()])) {
    const listed = actual.get(directive) ?? [];
    const wanted = expected.get(directive) ?? [];
    const added = listed.filter(source => !wanted.includes(source));
    const missing = wanted.filter(source => !listed.includes(source));
    if (!actual.has(directive)) differences.push(`${directive}: in ${expectedName}, not in ${actualName}`);
    else if (!expected.has(directive)) differences.push(`${directive}: in ${actualName}, not in ${expectedName}`);
    else if (added.length || missing.length) differences.push(`${directive}: ${actualName} adds [${added.join(' ')}] and lacks [${missing.join(' ')}]`);
    else if (listed.length !== wanted.length) differences.push(`${directive}: ${actualName} repeats a source`);
  }
  return differences;
}

const appPolicy = parsePolicy(csp);
const policyDrift = policyDifferences(appPolicy, new Map(Object.entries(APP_POLICY)), 'vercel.json', 'APP_POLICY');
assert.deepEqual(policyDrift, [], `The app policy in vercel.json differs from APP_POLICY in scripts/check-security.mjs:\n  ${policyDrift.join('\n  ')}`);

// Rules that hold whatever the table says, so a commit cannot loosen the
// policy by editing vercel.json and APP_POLICY together.
// - A bare scheme (https:, http:, wss:), * or scheme://* lets every host of
//   that scheme in. data: and blob: name content the page made itself.
//   img-src https: is the one such source left: F10-13 replaces it with the
//   named image hosts and deletes its exception here.
// - No 'unsafe-eval' or other unsafe keyword; 'unsafe-inline' only in
//   style-src, never for scripts.
// - No PostHog host: analytics reach PostHog through the same-origin /ingest
//   proxy (vercel.json rewrites, client/src/lib/analytics.ts).
const OPEN_SOURCE_EXCEPTIONS = new Set(['img-src https:']);
const opensEveryHost = source => source === '*'
  || (/^[a-z][a-z0-9+.-]*:$/i.test(source) && !['data:', 'blob:'].includes(source.toLowerCase()))
  || /^[a-z][a-z0-9+.-]*:\/\/\*(?:[:/]|$)/i.test(source);
const ruleBreaks = [];
for (const [directive, sources] of appPolicy) {
  for (const source of sources) {
    if (opensEveryHost(source) && !OPEN_SOURCE_EXCEPTIONS.has(`${directive} ${source}`)) ruleBreaks.push(`${directive} holds ${source}, which lets every host in; name the hosts`);
    if (/unsafe/i.test(source) && !(directive === 'style-src' && source === "'unsafe-inline'")) ruleBreaks.push(`${directive} holds ${source}; only style-src may hold an unsafe keyword, and only 'unsafe-inline'`);
  }
}
for (const route of headerRoutes) {
  for (const [directive, sources] of parsePolicy(header(route, 'Content-Security-Policy') ?? '')) {
    for (const source of sources.filter(one => /posthog/i.test(one))) ruleBreaks.push(`${route.src}: ${directive} names ${source}; PostHog goes through the same-origin /ingest proxy`);
  }
}
assert.deepEqual(ruleBreaks, [], `A policy in vercel.json breaks a rule in scripts/check-security.mjs:\n  ${ruleBreaks.join('\n  ')}`);
assert.equal(header(app, 'X-Content-Type-Options'), 'nosniff');
assert.equal(header(app, 'X-Frame-Options'), 'DENY');
assert.match(header(app, 'Strict-Transport-Security'), /max-age=63072000/);
const sandbox = headerRoutes.find(route => route.src === '^/sandbox/.*$');
assert(header(sandbox, 'Content-Security-Policy').includes("frame-ancestors 'self'"), 'The isolated exercise frame must still be embeddable by the app');
const sandboxCsp = header(sandbox, 'Content-Security-Policy');
const connectionPolicy = sandboxCsp.split(';').map(part => part.trim()).find(part => part.startsWith('connect-src '));
assert.equal(connectionPolicy || sandboxCsp.split(';').map(part => part.trim()).find(part => part.startsWith('default-src ')), connectionPolicy ? "connect-src 'none'" : "default-src 'none'", 'Exercise frames must not make network requests');
assert(sandboxCsp.includes("form-action 'none'"), 'Native form events must never enable form navigation');
assert(readFileSync('client/sandbox/index.html', 'utf8').includes("form-action 'none'"), 'Local preview must also block form navigation');
assert(!header(sandbox, 'X-Frame-Options'), 'Do not deny the exercise frame');
console.log('Security policy contracts passed: main app, theme bootstrap, isolated coding frame.');

// The built pages: the prerender and the build may change a bootstrap's bytes
// or add an inline script, which production would block while the checks on
// client/index.html pass. --dist scans client/dist, --dist=<dir> another
// build. Each page is checked against the policy vercel.json serves it with.
const distArgument = process.argv.find(arg => arg === '--dist' || arg.startsWith('--dist='));
if (distArgument) {
  const dist = distArgument === '--dist' ? 'client/dist' : distArgument.slice('--dist='.length);
  assert(existsSync(join(dist, 'index.html')), `--dist: ${dist} holds no index.html; run npm run build first`);
  const isFile = pathname => existsSync(join(dist, pathname)) && statSync(join(dist, pathname)).isFile();
  const pages = readdirSync(dist, { recursive: true }).filter(file => file.endsWith('.html')).sort();
  const blocked = [];
  const hashes = new Set();
  let checked = 0;
  let dataBlocks = 0;
  let unserved = 0;
  for (const page of pages) {
    const pathname = `/${page.split(sep).join('/')}`;
    const answer = vercelAnswer(config, pathname, isFile);
    // A page that a route answers before the filesystem (the retired
    // /cs/topics guides) never reaches a browser as itself.
    if (answer.ends !== 'file') { unserved += 1; continue; }
    const found = inlineScripts(readFileSync(join(dist, page), 'utf8'));
    dataBlocks += found.dataBlocks;
    const policy = answer.headers['content-security-policy'];
    if (policy === undefined) {
      if (found.scripts.length) blocked.push(`${pathname}: served with no Content-Security-Policy`);
      continue;
    }
    const parsed = parsePolicy(policy);
    for (const text of found.scripts) {
      checked += 1;
      hashes.add(sourceHash(text));
      if (!inlineScriptAllowed(parsed, text)) blocked.push(`${pathname}: its policy blocks the inline script ${sourceHash(text)}`);
    }
  }
  assert.equal(blocked.length, 0, `${blocked.length} inline script${blocked.length === 1 ? '' : 's'} of the built pages would not run:\n  ${blocked.slice(0, 20).join('\n  ')}${blocked.length > 20 ? `\n  and ${blocked.length - 20} more` : ''}`);
  console.log(`Built pages in ${dist}: ${pages.length} HTML files, ${checked} inline scripts checked (${hashes.size} distinct) and allowed by their policy, ${dataBlocks} data blocks skipped${unserved ? `, ${unserved} page${unserved === 1 ? '' : 's'} a route answers first` : ''}.`);
} else {
  console.log('Built pages not scanned: run npm run check:security -- --dist after npm run build to check their inline scripts.');
}
// --url=<deployment>: the deployment answers each probe path with the status
// and the headers that vercel.json gives that path on Vercel
// (scripts/vercel-headers.mjs models the routing). The probes cover each
// policy vercel.json sets: two app documents, the main chunk and its source
// map, the coding worker's directory, the sandbox page and its chunk, an API
// answer and a redirect. Every difference is reported, not only the first.
const url = process.argv.find(arg => arg.startsWith('--url='))?.slice('--url='.length);
if (url) {
  const origin = new URL(url);
  assert.equal(origin.protocol, 'https:', '--url must name an HTTPS deployment');
  const mismatches = [];
  const get = async pathname => {
    const response = await fetch(new URL(pathname, origin), { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    return { pathname, response, body: await response.text() };
  };
  const chunkOf = (page, prefix) => new RegExp(`<script\\b[^>]*\\bsrc="(${prefix}[^"]+\\.js)"`).exec(page.body)?.[1];
  const home = await get('/');
  const sandboxPage = await get('/sandbox/index.html');
  const mainChunk = chunkOf(home, '/assets/');
  const sandboxChunk = chunkOf(sandboxPage, '/sandbox/assets/');
  if (!mainChunk) mismatches.push('/: names no /assets/*.js module script');
  if (!sandboxChunk) mismatches.push('/sandbox/index.html: names no /sandbox/assets/*.js module script');
  // Files the deployment holds at these paths; every other probe path names none.
  const deployed = new Set(['/index.html', '/premium/index.html', '/sandbox/index.html', mainChunk, mainChunk && `${mainChunk}.map`, sandboxChunk].filter(Boolean));
  const probes = [home, sandboxPage];
  for (const pathname of ['/premium', mainChunk, mainChunk && `${mainChunk}.map`, sandboxChunk, '/assets/coding-worker/missing.js', '/api/settings', '/roadmap/specializations/fde']) {
    if (pathname) probes.push(await get(pathname));
  }
  // Headers Vercel sends on its own where vercel.json sets none: Cache-Control
  // (public, max-age=0, must-revalidate, or what a function sets),
  // Access-Control-Allow-Origin: * on static files, and HSTS max-age=63072000.
  const PLATFORM_HEADERS = new Set(['cache-control', 'access-control-allow-origin', 'strict-transport-security']);
  const namedHeaders = headerNames(config);
  for (const { pathname, response, body } of probes) {
    const expected = vercelAnswer(config, pathname, path => deployed.has(path));
    const before = mismatches.length;
    if (expected.status !== null && response.status !== expected.status) {
      mismatches.push(`${pathname}: status ${response.status}, vercel.json gives ${expected.status} (${expected.ends})`);
    }
    for (const [name, value] of Object.entries(expected.headers)) {
      const actual = response.headers.get(name);
      if (actual === value) continue;
      if (actual !== null && name === 'content-security-policy') {
        // The same directives and sources in another order are the same policy.
        const differences = policyDifferences(parsePolicy(actual), parsePolicy(value), 'the deployed policy', 'vercel.json');
        if (differences.length) mismatches.push(`${pathname}: ${differences.join('; ')}`);
      } else {
        mismatches.push(`${pathname}: ${name} is ${actual === null ? 'missing' : JSON.stringify(actual)}, vercel.json gives ${JSON.stringify(value)}`);
      }
    }
    // A header vercel.json withholds from this path, such as X-Frame-Options
    // on the sandbox frame, must not arrive from somewhere else.
    for (const name of namedHeaders) {
      if (expected.headers[name] === undefined && !PLATFORM_HEADERS.has(name) && response.headers.has(name)) {
        mismatches.push(`${pathname}: sends ${name}: ${JSON.stringify(response.headers.get(name))}, which vercel.json does not give this path`);
      }
    }
    // The page as deployed must run under the policy deployed with it: the
    // build may have changed the bytes client/index.html holds.
    let inline = '';
    if ((response.headers.get('content-type') ?? '').startsWith('text/html')) {
      const { scripts } = inlineScripts(body);
      const policy = parsePolicy(response.headers.get('content-security-policy') ?? '');
      for (const text of scripts) {
        if (!inlineScriptAllowed(policy, text)) mismatches.push(`${pathname}: the deployed policy blocks the page's inline script ${sourceHash(text)}`);
      }
      inline = `; ${scripts.length} inline script${scripts.length === 1 ? '' : 's'}`;
    }
    const matched = mismatches.length === before;
    console.log(`${origin.origin}${pathname}: ${response.status}, ${matched ? `the ${Object.keys(expected.headers).length} headers vercel.json gives it match` : 'differs from vercel.json'}${inline}`);
  }
  assert.equal(mismatches.length, 0, `${origin.origin} differs from vercel.json:\n  ${mismatches.join('\n  ')}`);
}
