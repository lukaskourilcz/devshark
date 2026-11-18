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

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };
const portOf = url => url.port || DEFAULT_PORTS[url.protocol] || '';
// CSP Level 3 "scheme-part match": a source's scheme also covers its secure
// upgrade (http: covers https:, ws: covers wss:), and ws: and wss: cover the
// HTTP schemes. https: does not cover wss:, so a host the page opens a
// socket to needs its own wss:// source.
const SCHEME_COVERS = { 'http:': ['http:', 'https:'], 'https:': ['https:'], 'ws:': ['ws:', 'wss:', 'http:', 'https:'], 'wss:': ['wss:', 'https:'] };
const schemeCovers = (source, target) => (SCHEME_COVERS[source] ?? [source]).includes(target);

/** Whether a fetch or socket to `target` (a URL string) passes the directive
 * `sources` (one parsePolicy entry) on a page served from `self` (a URL).
 * It follows CSP Level 3's source matching for the source shapes a policy in
 * vercel.json may hold: 'self', 'none', a bare scheme, and a host source with
 * a scheme, a leading *. wildcard, a port and a path. */
function cspAllows(sources, target, self) {
  const url = new URL(target);
  return sources.some(raw => {
    const source = raw.toLowerCase();
    if (source === "'self'") {
      // 'self' also covers the secure upgrades of the page's own host.
      return url.hostname === self.hostname && portOf(url) === portOf(self)
        && (url.protocol === self.protocol || ['https:', 'wss:'].includes(url.protocol) || (self.protocol === 'http:' && url.protocol === 'ws:'));
    }
    if (source.startsWith("'")) return false;
    if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return schemeCovers(source, url.protocol);
    const host = /^(?:([a-z][a-z0-9+.-]*:)\/\/)?(\*|(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d+|\*))?(\/[^?#]*)?$/.exec(source);
    if (!host) return false;
    const [, scheme, hostname, port, path] = host;
    if (!schemeCovers(scheme ?? self.protocol, url.protocol)) return false;
    if (hostname.startsWith('*.') ? !url.hostname.endsWith(hostname.slice(1)) : hostname !== '*' && hostname !== url.hostname) return false;
    if (port !== '*' && (port ?? DEFAULT_PORTS[url.protocol]) !== portOf(url)) return false;
    if (!path || path === '/') return true;
    return path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path;
  });
}

// The matcher decides whether --url passes the deployed bundle's hosts, so its
// edges are pinned here.
{
  const self = new URL('https://devshark.app/');
  const cases = [
    [['https://*.supabase.co'], 'https://abc.supabase.co/rest/v1/', true],
    [['https://*.supabase.co'], 'wss://abc.supabase.co/realtime/v1/websocket', false],
    [['wss://*.supabase.co'], 'wss://abc.supabase.co/realtime/v1/websocket', true],
    [['https://*.supabase.co'], 'https://supabase.co/', false],
    [['https://*.supabase.co'], 'https://abc.supabase.co.evil.example/', false],
    [['https://abc.supabase.co'], 'https://abd.supabase.co/', false],
    [['https://abc.supabase.co'], 'https://abc.supabase.co:8443/', false],
    [['https:'], 'https://anything.example/', true],
    [['https:'], 'wss://anything.example/', false],
    [["'self'"], 'https://devshark.app/ingest/e/', true],
    [["'self'"], 'wss://devshark.app/socket', true],
    [["'self'"], 'https://eu.i.posthog.com/e/', false],
    [["'none'"], 'https://devshark.app/', false],
    [['https://*.ingest.de.sentry.io'], 'https://o1.ingest.de.sentry.io/api/2/envelope/', true],
    [['https://*.ingest.de.sentry.io'], 'https://o1.ingest.us.sentry.io/api/2/envelope/', false],
    [['https://example.com/api/'], 'https://example.com/api/x', true],
    [['https://example.com/api'], 'https://example.com/api/x', false],
  ];
  const wrong = cases.filter(([sources, target, allowed]) => cspAllows(sources, target, self) !== allowed);
  assert.deepEqual(wrong, [], 'cspAllows in scripts/check-security.mjs disagrees with CSP Level 3 source matching');
}

/** The hosts a built JavaScript chunk sends data to on its own: each Supabase
 * project URL (https://<ref>.supabase.co, from VITE_SUPABASE_URL), each
 * Sentry ingest host with its project (from the DSN in VITE_SENTRY_DSN), and
 * the api_host the analytics module hands startPostHog (VITE_PUBLIC_POSTHOG_HOST,
 * or the same-origin /ingest proxy). */
function bundleHosts(js) {
  const unique = values => [...new Set(values)].sort();
  return {
    supabase: unique([...js.matchAll(/https:\/\/([a-z0-9-]+)\.supabase\.co(?![a-z0-9.-])/gi)].map(([, ref]) => ref.toLowerCase())),
    sentry: unique([...js.matchAll(/https:\/\/[0-9a-f]+@([a-z0-9.-]+\.sentry\.io)\/(\d+)/gi)].map(([, host, project]) => `${host.toLowerCase()}/${project}`)),
    posthog: unique([...js.matchAll(/\.startPostHog\(\s*[\w$]+\s*,\s*(["'`])([^"'`]*)\1\s*\)/g)].map(match => match[2])),
  };
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
  // Google profile photos (the only avatar host lib/public-identity.ts and
  // client/src/lib/auth.tsx accept), and Stripe's and Link's images in
  // checkout, as Stripe's CSP guide lists them. data: carries the Play QR
  // code and the SVG backgrounds in the built CSS. When merchandise returns,
  // its image host joins this list.
  'img-src': ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://*.stripe.com', 'https://*.link.com'],
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
// - No 'unsafe-eval' or other unsafe keyword; 'unsafe-inline' only in
//   style-src, never for scripts.
// - No PostHog host: analytics reach PostHog through the same-origin /ingest
//   proxy (vercel.json rewrites, client/src/lib/analytics.ts).
const opensEveryHost = source => source === '*'
  || (/^[a-z][a-z0-9+.-]*:$/i.test(source) && !['data:', 'blob:'].includes(source.toLowerCase()))
  || /^[a-z][a-z0-9+.-]*:\/\/\*(?:[:/]|$)/i.test(source);
const ruleBreaks = [];
for (const [directive, sources] of appPolicy) {
  for (const source of sources) {
    if (opensEveryHost(source)) ruleBreaks.push(`${directive} holds ${source}, which lets every host in; name the hosts`);
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
  const requestHeaders = {};
  // In CI, Vercel's Protection Bypass for Automation secret opens a protected
  // deployment without a share link. The project protects only its
  // *.vercel.app hosts, so the secret goes to those alone and never to a host
  // outside Vercel that --url happens to name.
  const bypass = origin.hostname.endsWith('.vercel.app') ? process.env.VERCEL_AUTOMATION_BYPASS_SECRET : undefined;
  if (bypass) requestHeaders['x-vercel-protection-bypass'] = bypass;
  // A share link (https://<deployment>/?_vercel_share=<token>, as the Vercel
  // MCP get_access_to_vercel_url returns it) trades its token for a
  // _vercel_jwt cookie on the first request; every probe sends the cookie.
  if (origin.searchParams.has('_vercel_share')) {
    const response = await fetch(origin, { redirect: 'manual', headers: requestHeaders, signal: AbortSignal.timeout(30_000) });
    await response.arrayBuffer();
    const jwt = response.headers.getSetCookie().map(cookie => /^_vercel_jwt=([^;]+)/.exec(cookie)?.[1]).find(Boolean);
    assert(jwt, `${origin.host}: the share link answered ${response.status} without a _vercel_jwt cookie; it may have expired, so ask for a new one`);
    requestHeaders.cookie = `_vercel_jwt=${jwt}`;
  }
  const get = async pathname => {
    const response = await fetch(new URL(pathname, origin), { redirect: 'manual', headers: requestHeaders, signal: AbortSignal.timeout(30_000) });
    // A preview behind Vercel Authentication answers every path with a
    // redirect to vercel.com's sign-in, which would read as a missing header
    // on every probe.
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    const target = location ? new URL(location, origin).hostname : '';
    if (target === 'vercel.com' || target.endsWith('.vercel.com')) {
      assert.fail(`${origin.host}${pathname} answers ${response.status} to ${target}: the deployment sits behind Vercel Authentication. Pass a share link (--url='https://${origin.host}/?_vercel_share=<token>') or set VERCEL_AUTOMATION_BYPASS_SECRET${bypass ? ' to the project\'s current secret' : ' (sent to *.vercel.app hosts only)'}.`);
    }
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
  // Vercel also marks every *.vercel.app deployment URL noindex, so search
  // engines index only the production domain.
  const fromPlatform = (name, value) => PLATFORM_HEADERS.has(name)
    || (name === 'x-robots-tag' && value === 'noindex' && origin.hostname.endsWith('.vercel.app'));
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
      if (expected.headers[name] === undefined && response.headers.has(name) && !fromPlatform(name, response.headers.get(name))) {
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
  // The hosts the deployed main chunk talks to must pass the deployed app
  // policy's connect-src, so a build pointed at another Supabase project,
  // Sentry organisation or PostHog host fails here instead of in the
  // learner's browser. Each extraction that finds nothing fails as well: the
  // check would otherwise pass while proving nothing.
  const chunk = probes.find(probe => probe.pathname === mainChunk);
  const deployedPolicy = parsePolicy(home.response.headers.get('content-security-policy') ?? '');
  const connect = deployedPolicy.get('connect-src') ?? deployedPolicy.get('default-src');
  if (chunk && connect) {
    const found = bundleHosts(chunk.body);
    const targets = [];
    if (!found.supabase.length) mismatches.push(`${mainChunk}: names no https://<ref>.supabase.co project URL; if the Supabase client left the main chunk, point this check at its new chunk`);
    for (const ref of found.supabase) {
      targets.push({ url: `https://${ref}.supabase.co/rest/v1/`, use: 'Supabase REST and Auth' }, { url: `wss://${ref}.supabase.co/realtime/v1/websocket`, use: 'the Supabase realtime socket' });
    }
    for (const ingest of found.sentry) {
      const [host, project] = ingest.split('/');
      targets.push({ url: `https://${host}/api/${project}/envelope/`, use: 'Sentry error reports' });
    }
    if (!found.posthog.length) mismatches.push(`${mainChunk}: holds no startPostHog(key, host) call; if the analytics module moved or changed shape, update bundleHosts in this file`);
    for (const host of found.posthog) {
      // PostHog's capture endpoint under the api_host; the CSP rules above
      // keep every PostHog host out of the policy, so only the same-origin
      // proxy passes (VITE_PUBLIC_POSTHOG_HOST stays unset).
      targets.push({ url: new URL(`${host.replace(/\/$/, '')}/e/`, origin).href, use: 'PostHog analytics, which must go through the same-origin /ingest proxy' });
    }
    const blockedTargets = targets.filter(target => !cspAllows(connect, target.url, origin));
    for (const target of blockedTargets) mismatches.push(`${mainChunk}: the bundle connects to ${target.url} for ${target.use}, which the deployed connect-src blocks`);
    console.log(`${origin.origin}${mainChunk}: Supabase ${found.supabase.join(', ') || 'none'}; Sentry ${found.sentry.join(', ') || 'no DSN'}; PostHog ${found.posthog.join(', ') || 'none'}; ${targets.length - blockedTargets.length} of ${targets.length} connections allowed by connect-src`);
  }
  assert.equal(mismatches.length, 0, `${origin.origin} differs from vercel.json:\n  ${mismatches.join('\n  ')}`);
}
