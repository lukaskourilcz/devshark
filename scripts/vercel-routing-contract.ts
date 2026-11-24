// What vercel.json promises about the files the build emits.
//
// Vite names every chunk after its content, so a file under /assets/ can be
// cached for a year: a new build is a new URL. A URL with no file behind it is
// the opposite case. After a deploy, a tab still running the old build asks for
// chunks the new deployment does not have. Until HARDEN the SPA rewrite
// answered those with index.html and the assets rule marked that answer
// immutable for a year, so a browser could keep it even after a rollback
// brought the file back (docs/release-acceptance.md, HARDEN).
//
// Vercel applies a `headers` rule to every response whose path matches, the
// 404 for a missing file included: vercel.json turns each rule into a route
// that runs before the filesystem is checked. So the year-long Cache-Control
// lives in the `hit` phase, which runs only when a file matched, and a path
// under /assets/ or /sandbox/assets/ that matched no file answers 404 with
// Cache-Control: no-store before any rewrite is tried. Vercel appends a
// `headers` property after these routes, where it would land in the hit phase
// and reach existing files only, so the header rules live in `routes`, ahead
// of `{ "handle": "filesystem" }`.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FDE_SECTION_VISIBLE } from '../shared/learn-section-ids';
import { NOINDEX_PATHS } from '../client/src/lib/publicMetadata';

interface Route {
  src?: string;
  dest?: string;
  status?: number;
  continue?: boolean;
  check?: boolean;
  headers?: Record<string, string>;
  handle?: string;
}

interface VercelConfig {
  headers?: unknown;
  redirects?: unknown;
  routes?: Route[];
  rewrites?: { source: string; destination: string }[];
}

type Phase = 'main' | 'filesystem' | 'hit';

export function readVercelConfig(): VercelConfig {
  return JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as VercelConfig;
}

/** The routes of each phase, in order. `main` runs on every request; the
 * `filesystem` phase after the filesystem found nothing; `hit` after it
 * found a file. */
export function routePhases(config: VercelConfig = readVercelConfig()): Record<Phase, Route[]> {
  const phases: Record<Phase, Route[]> = { main: [], filesystem: [], hit: [] };
  let phase: Phase = 'main';
  for (const route of config.routes ?? []) {
    if (route.handle !== undefined) {
      assert.ok(route.handle === 'filesystem' || route.handle === 'hit', `vercel.json routes use handle "${route.handle}", which this contract does not know`);
      phase = route.handle;
      continue;
    }
    phases[phase].push(route);
  }
  return phases;
}

// Vercel matches a route's `src` and a rewrite's `source` case-sensitively.
// Measured on production (18 November 2026): /cs/topics answers 404 from the
// retired-guide route and /CS/TOPICS 200 with the app shell; /premium serves
// the Premium document (8,105 bytes) and /PREMIUM the home shell (5,549 bytes).
const routeMatches = (route: Route, path: string) => route.src !== undefined && new RegExp(route.src).test(path);

/** The headers the routes of one phase give a path, later routes winning, keys lower-cased. */
export function phaseHeaders(path: string, phase: Phase, phases = routePhases()): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const route of phases[phase]) {
    if (!routeMatches(route, path)) continue;
    for (const [key, value] of Object.entries(route.headers ?? {})) headers[key.toLowerCase()] = value;
  }
  return headers;
}

/** A rewrite `source` (path-to-regexp 6, as Vercel reads it) as a RegExp, for
 * the shapes vercel.json uses: literal text, `:name` segments and `(...)`
 * groups, which are regular expressions already. It matches case-sensitively,
 * as production does (see routeMatches). */
export function rewriteSourcePattern(source: string): RegExp {
  let pattern = '';
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (char === '(') {
      let depth = 0;
      let end = i;
      for (; end < source.length; end += 1) {
        if (source[end] === '\\') { end += 1; continue; }
        if (source[end] === '(') depth += 1;
        if (source[end] === ')' && --depth === 0) break;
      }
      assert.ok(end < source.length, `unbalanced group in rewrite source ${source}`);
      pattern += source.slice(i, end + 1);
      i = end + 1;
    } else if (char === ':') {
      const name = /^:\w+/.exec(source.slice(i));
      assert.ok(name, `unnamed parameter in rewrite source ${source}`);
      pattern += '([^/]+?)';
      i += name[0].length;
    } else {
      pattern += char.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

// Paths the contract asks about. The hashes are made up: what matters is the
// shape, and a missing file has the same shape as one that exists.
const APP_CHUNK = '/assets/CodingSection-DVDpGXcJ.js';
const APP_STYLES = '/assets/main-BmQx2Zrs.css';
const WORKER_CHUNK = '/assets/coding-worker/worker-duXtWM9V.js';
const SANDBOX_CHUNK = '/sandbox/assets/index-DKkK9iSG.js';
const ASSET_PATHS = [APP_CHUNK, APP_STYLES, WORKER_CHUNK, SANDBOX_CHUNK, '/assets/', '/sandbox/assets/'];
const STATIC_MEDIA_PATHS = ['/og/', '/og/coding/stale.png', '/brand/', '/brand/v9/recommended/stale.svg'];
const FILE_PATHS = [...ASSET_PATHS, ...STATIC_MEDIA_PATHS];
const DOCUMENTS = ['/', '/index.html', '/coding', '/coding/javascript/js-double-numbers', '/premium/index.html', '/topics/javascript-closures/index.html', '/sandbox/index.html'];
const WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'";

const RETIRED_TRIAGE_SOURCE = "^/(?:t|%74)(?:r|%72)(?:i|%69)(?:a|%61)(?:g|%67)(?:e|%65)(?:-|%2[dD])(?:v|%76)(?:e|%65)(?:r|%72)(?:d|%64)(?:i|%69)(?:c|%63)(?:t|%74)(?:s|%73)(?:\\.|%2[eE])(?:j|%6[aA])(?:s|%73)(?:o|%6[fF])(?:n|%6[eE])$";

export function vercelRoutingContracts(config: VercelConfig = readVercelConfig()): void {
  assert.equal(config.headers, undefined, 'vercel.json keeps its header rules in `routes`: a `headers` property would be appended after the hit phase and reach existing files only');
  const handles = (config.routes ?? []).filter((route) => route.handle !== undefined).map((route) => route.handle);
  assert.deepEqual(handles, ['filesystem', 'hit'], 'vercel.json routes: header rules, then the filesystem phase, then the hit phase, each once');
  const phases = routePhases(config);

  // The browser adds robots metadata on navigation, but an email or payment
  // return must also stay out of search when a crawler never executes JS.
  for (const pathname of [...NOINDEX_PATHS, '/play/ABCD', '/admin/new-section']) {
    for (const path of [pathname, `${pathname}/`]) {
      assert.equal(phaseHeaders(path, 'main', phases)['x-robots-tag'], 'noindex', `${path} is excluded before the app renders`);
    }
  }
  for (const path of ['/', '/premium', '/premium/cancel', '/daily', '/topics/javascript-closures']) {
    assert.equal(phaseHeaders(path, 'main', phases)['x-robots-tag'], undefined, `${path} remains indexable`);
  }

  // Main-phase rules normally add headers. Reviewed terminal exceptions
  // retire one private asset, serve the retired guide's 404 or redirect a
  // moved page. Their exact shapes remain explicit instead of allowing
  // arbitrary early responses before the filesystem/security rules.
  const retiredTriage = phases.main.filter(route => route.src === RETIRED_TRIAGE_SOURCE);
  assert.equal(retiredTriage.length, 1, 'one reviewed private triage retirement precedes the filesystem');
  const [privateAsset] = retiredTriage;
  assert.deepEqual(Object.keys(privateAsset).sort(), ['headers', 'src', 'status']);
  assert.equal(privateAsset.status, 404, 'the retired private asset never answers success');
  assert.deepEqual(privateAsset.headers, { 'Cache-Control': 'no-store' });
  const filename = 'triage-verdicts.json';
  const encoded = [...filename].map(char => `%${char.charCodeAt(0).toString(16)}`).join('');
  const privatePaths = ['/triage-verdicts.json', '/%74riage-verdicts.json', '/triage-verdicts%2ejson', '/triage-verdicts%2Ejson', `/${encoded}`, `/${encoded.toUpperCase()}`];
  for (const path of privatePaths) {
    assert.ok(routeMatches(privateAsset, path), `${path} is retired before a copied file or fallback`);
    const matchingHeaders = phases.main.filter(route => route.continue === true && routeMatches(route, path));
    assert.ok(matchingHeaders.every(route => phases.main.indexOf(route) < phases.main.indexOf(privateAsset)), `${path} retains all matching security headers before ending`);
    assert.ok(phaseHeaders(path, 'main', phases)['content-security-policy'], `${path} retains the app policy`);
  }
  for (const path of [...FILE_PATHS, ...DOCUMENTS, '/triage-verdicts.json.backup', '/triage-verdicts.json/extra', '/triage%252dverdicts.json', '/caf%C3%A9.json']) {
    assert.ok(!routeMatches(privateAsset, path), `${path} is outside the private retirement exception`);
  }
  const retiredGuides = phases.main.filter((route) => route.src === '^/cs/topics(?:/.*)?$');
  assert.equal(retiredGuides.length, 1, 'retired guide URLs answer the app shell with HTTP 404');
  const redirects = phases.main.filter((route) => route.status === 308);
  const sourceMaps = phases.main.find(route => route.src === '^/(?:sandbox/)?assets/.+\\.map$');
  assert.ok(sourceMaps);
  assert.equal(sourceMaps.status, 404);
  assert.deepEqual(sourceMaps.headers, { 'Cache-Control': 'no-store' });
  for (const asset of [APP_CHUNK, WORKER_CHUNK, SANDBOX_CHUNK]) {
    assert.ok(routeMatches(sourceMaps, `${asset}.map`));
    assert.ok(!routeMatches(sourceMaps, asset));
  }

  for (const route of phases.main) {
    if (route.src === '^/cs/topics(?:/.*)?$') {
      assert.equal(route.dest, '/app.html');
      assert.equal(route.status, 404);
      assert.equal(route.continue, undefined);
      assert.equal(route.headers?.['X-Robots-Tag'], 'noindex');
      continue;
    }
    if (route === privateAsset || route === sourceMaps || redirects.includes(route)) continue;
    assert.ok(route.continue === true && route.headers && !route.dest && route.status === undefined, `${route.src} runs before the filesystem check and must only add headers`);
  }
  // Public Learn previews must reach their own HTML before the SPA fallback.
  for (const id of ['web-developer', 'software-engineer']) {
    const source = `/learn/${id}`;
    const rewrite = (config.rewrites ?? []).find(one => one.source === source);
    assert.equal(rewrite?.destination, `${source}/index.html`, `${source} serves its public preview`);
    const fallback = (config.rewrites ?? []).findIndex(one => one.destination === '/app.html');
    assert.ok((config.rewrites ?? []).indexOf(rewrite!) < fallback, `${source} precedes the SPA fallback`);
  }
  for (const route of redirects) {
    assert.equal(route.status, 308, `${route.src} is a permanent redirect`);
    assert.ok(route.dest === undefined && route.continue === undefined, `${route.src} answers with a redirect and ends the request`);
    assert.deepEqual(Object.keys(route.headers ?? {}), ['Location'], `${route.src} sets Location and nothing else`);
    assert.ok(phases.main.indexOf(route) > Math.max(...phases.main.filter((one) => one.status === undefined).map((one) => phases.main.indexOf(one))), `${route.src} comes after every header rule`);
    for (const path of [...FILE_PATHS, ...DOCUMENTS]) assert.ok(!routeMatches(route, path), `${route.src} would redirect ${path}`);
  }
  // The FDE path moved into its Learn section (#489, plan decision D4). Its
  // old addresses go directly to the open section; reopened modules keep their id.
  // These routes sit before the filesystem check, as Vercel compiles a
  // `redirects` entry; a `redirects` property itself would land after
  // `handle: hit` here, where a page that is no file never reaches it.
  assert.equal(config.redirects, undefined, 'vercel.json keeps its redirects in `routes`, before the filesystem check');
  const redirectOf = (path: string) => {
    const route = redirects.find((one) => routeMatches(one, path));
    if (!route) return null;
    const match = new RegExp(route.src!).exec(path)!;
    return route.headers!.Location.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? '');
  };
  const fdeTarget = (suffix = '') => FDE_SECTION_VISIBLE ? '/learn/forward-deployed-engineer/path' + suffix : '/learn/web-developer';
  const MOVED: [string, string][] = [
    ['/support', '/premium'],
    ['/support/', '/premium'],
    ['/roadmap/specializations/fde', fdeTarget()],
    ['/roadmap/specializations/fde/', fdeTarget()],
    ['/roadmap/specializations/fde/fde-v1-m03', fdeTarget('/fde-v1-m03')],
    ['/roadmap/specializations/fde/fde-v1-m03/', fdeTarget('/fde-v1-m03')],
    ['/roadmap/specializations/fde/fde-v1-m03/extra', fdeTarget('/fde-v1-m03')],
    // E5 (#496) retired the DSA Foundations path. Its overview and every
    // module answer 308 to the DSA topic of the Software Engineer section,
    // where its readings and Coding tasks now live.
    ['/roadmap/paths/dsa-foundations', '/learn/software-engineer?topic=dsa'],
    ['/roadmap/paths/dsa-foundations/', '/learn/software-engineer?topic=dsa'],
    ['/roadmap/paths/dsa-foundations/dsa-v1-d04', '/learn/software-engineer?topic=dsa'],
    ['/roadmap/paths/dsa-foundations/dsa-v1-d04/extra', '/learn/software-engineer?topic=dsa'],
  ];
  for (const [from, to] of MOVED) assert.equal(redirectOf(from), to, `${from} answers 308 to ${to}`);
  for (const path of ['/learn/forward-deployed-engineer/path', '/learn/forward-deployed-engineer/path/fde-v1-m03', '/roadmap', '/roadmap/paths', '/roadmap/paths/dsa-foundationsx', '/learn/software-engineer', '/roadmap/specializations', '/roadmap/specializations/fdex']) {
    assert.equal(redirectOf(path), null, `${path} is not redirected`);
  }
  assert.ok(phaseHeaders('/roadmap/specializations/fde/fde-v1-m03', 'main', phases)['content-security-policy'], 'the 308 carries the app’s security headers');
  // Vercel accepts nothing else after `handle: hit`.
  for (const route of phases.hit) {
    assert.ok(route.continue === true && route.headers && !route.dest && route.status === undefined, `${route.src} runs after a file matched and may only add headers`);
  }

  // A file that exists is cached for a year; nothing before the filesystem
  // check sets a cache for these paths, so a missing file never inherits one.
  for (const path of ASSET_PATHS) {
    assert.equal(phaseHeaders(path, 'main', phases)['cache-control'], undefined, `${path}: a Cache-Control before the filesystem check would reach the 404 for a missing file`);
    if (path.endsWith('/')) continue;
    const cache = phaseHeaders(path, 'hit', phases)['cache-control'];
    assert.ok(cache, `${path} needs a Cache-Control once the file is found; hashed files should not be revalidated`);
    assert.match(cache, /immutable/, `${path} is content-hashed and should be immutable`);
    assert.match(cache, /max-age=\d{6,}/, `${path} should be cached for a long time, not seconds`);
  }

  // Missing bundles and public images answer 404 with no-store before any
  // rewrite could answer them with index.html.
  const [missing] = phases.filesystem;
  assert.ok(missing, 'the filesystem phase starts with the rule for a missing asset');
  for (const path of FILE_PATHS) {
    assert.ok(routeMatches(missing, path), `${path}: a missing file reaches the 404 rule`);
  }
  assert.equal(missing.status, 404, 'a missing asset answers 404');
  assert.equal(missing.dest, undefined, 'a missing asset is answered, not rewritten');
  assert.equal(missing.continue, undefined, 'the 404 for a missing asset ends the request');
  assert.equal(Object.entries(missing.headers ?? {}).find(([key]) => key.toLowerCase() === 'cache-control')?.[1], 'no-store', 'no cache keeps the 404 for a missing asset');
  for (const route of phases.filesystem.slice(1)) {
    for (const path of FILE_PATHS) assert.ok(!routeMatches(route, path), `${route.src} would answer ${path} after the 404 rule`);
  }

  // No rewrite may catch an asset path, the SPA fallback included, and the
  // fallback still serves the app's own pages.
  const rewrites = config.rewrites ?? [];
  for (const rewrite of rewrites) {
    const pattern = rewriteSourcePattern(rewrite.source);
    for (const path of FILE_PATHS) {
      assert.ok(!pattern.test(path), `the rewrite ${rewrite.source} → ${rewrite.destination} catches ${path}`);
    }
  }
  const fallback = rewrites.find((rewrite) => rewrite.destination === '/app.html');
  assert.ok(fallback, 'the SPA fallback rewrite exists');
  for (const path of ['/', '/coding', '/coding/javascript/js-double-numbers', '/assets', '/profile']) {
    assert.ok(rewriteSourcePattern(fallback.source).test(path), `the SPA fallback still serves ${path}`);
  }
  // A task page the build did not prerender (an id that does not exist) still
  // gets the app, which says so (C3-17). A rewrite is a `check: true` route:
  // when its file is missing, Vercel carries on with the rewritten path, and
  // the SPA fallback after it has to catch that path.
  const taskRewrite = rewrites.find((rewrite) => rewrite.source === '/coding/:track/:taskId');
  assert.ok(taskRewrite, 'coding task pages keep their prerender rewrite');
  assert.ok(rewrites.indexOf(taskRewrite) < rewrites.indexOf(fallback), 'the task rewrite runs before the SPA fallback');
  const missingTask = taskRewrite.destination.replace(':track', 'javascript').replace(':taskId', 'no-such-task');
  assert.ok(rewriteSourcePattern(fallback.source).test(missingTask), `a task page with no prerendered file (${missingTask}) falls through to the app`);
  // System design is hidden (owner decision, 9 Oct 2026): its track page and
  // every address under it, old task pages included, get the one noindex
  // not-found page the build writes, before the general coding rewrites or the
  // fallback can answer them.
  const firstMatch = (path: string) => rewrites.find((rewrite) => rewriteSourcePattern(rewrite.source).test(path));
  assert.equal(firstMatch('/')?.destination, '/index.html', 'the homepage serves the document with its own canonical');
  assert.equal(firstMatch('/today')?.destination, '/app.html', 'a private page serves the generic shell');
  for (const path of ['/coding/system-design', '/coding/system-design/', '/coding/system-design/sd-url-shortener', '/coding/system-design/dd-requests-per-second/extra']) {
    assert.equal(firstMatch(path)?.destination, '/coding/system-design/index.html', `${path} is answered by the hidden-track page`);
  }
  assert.equal(firstMatch('/coding/javascript')?.destination, '/coding/:track/index.html', 'a track page keeps its own head');
  assert.equal(firstMatch('/coding/javascript/js-double-numbers')?.destination, '/coding/:track/:taskId/index.html', 'a task page keeps its own head');

  // Public images and documents use stable names. An updated image or
  // document must be revalidated before it can be shown in a share preview.
  for (const path of [...DOCUMENTS, ...STATIC_MEDIA_PATHS, '/og/coding/js-double-numbers.png']) {
    for (const phase of ['main', 'hit'] as const) {
      assert.doesNotMatch(phaseHeaders(path, phase, phases)['cache-control'] ?? '', /immutable/, `${path} is a document and must not be cached immutably`);
    }
  }

  // The coding worker keeps its own policy: `new Function` is allowed there
  // and nowhere else, and the app's page policy does not apply.
  const worker = phaseHeaders(WORKER_CHUNK, 'main', phases);
  assert.equal(worker['content-security-policy'], WORKER_CSP, 'the coding worker keeps its own policy');
  assert.equal(worker['x-content-type-options'], 'nosniff');
  assert.equal(worker['cross-origin-resource-policy'], 'same-origin');
  // Vercel supplies wildcard CORS by default on static files. Ordinary app
  // assets advertise only the canonical site. The opaque exercise frame
  // loads its entire bundle separately from /sandbox/assets/.
  assert.equal(phaseHeaders(APP_CHUNK, 'main', phases)['access-control-allow-origin'], 'https://devshark.app');
  assert.equal(worker['access-control-allow-origin'], 'https://devshark.app');
  const sandbox = phaseHeaders(SANDBOX_CHUNK, 'main', phases);
  assert.equal(sandbox['access-control-allow-origin'], '*', 'the sandbox frame needs Access-Control-Allow-Origin on /sandbox/');
  assert.match(sandbox['content-security-policy'] ?? '', /script-src [^;]*'unsafe-eval'/, 'the sandbox compiles and runs code with new Function');
  assert.match(sandbox['content-security-policy'] ?? '', /default-src 'none'/, 'the sandbox frame stays network-less');
  assert.equal(sandbox['referrer-policy'], 'no-referrer');
  assert.equal(sandbox['x-content-type-options'], 'nosniff');
  // Pages keep the app's security headers.
  const page = phaseHeaders('/coding', 'main', phases);
  for (const key of ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
    assert.ok(page[key], `pages keep ${key}`);
  }
  // A page loads images from named hosts only: a bare scheme such as https:,
  // or *, would let any host receive an image request from the page. data:
  // is the one scheme allowed, for images the page carries itself.
  const imageSources = /(?:^|;)\s*img-src\s+([^;]*)/.exec(page['content-security-policy'] ?? '')?.[1].trim().split(/\s+/) ?? [];
  assert.ok(imageSources.length > 0, 'the app policy lists its image sources');
  assert.deepEqual(imageSources.filter((source) => source === '*' || (/^[a-z][a-z0-9+.-]*:$/i.test(source) && source.toLowerCase() !== 'data:')), [], 'img-src names its hosts and holds no scheme-only source but data:');
}
