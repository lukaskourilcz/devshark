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

// Vercel matches a route's `src` without regard to case unless the route says so.
const routeMatches = (route: Route, path: string) => route.src !== undefined && new RegExp(route.src, 'i').test(path);

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
 * groups, which are regular expressions already. */
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
  return new RegExp(`^${pattern}$`, 'i');
}

// Paths the contract asks about. The hashes are made up: what matters is the
// shape, and a missing file has the same shape as one that exists.
const APP_CHUNK = '/assets/CodingSection-DVDpGXcJ.js';
const APP_STYLES = '/assets/main-BmQx2Zrs.css';
const WORKER_CHUNK = '/assets/coding-worker/worker-duXtWM9V.js';
const SANDBOX_CHUNK = '/sandbox/assets/index-DKkK9iSG.js';
const ASSET_PATHS = [APP_CHUNK, APP_STYLES, `${APP_CHUNK}.map`, WORKER_CHUNK, SANDBOX_CHUNK, '/assets/', '/sandbox/assets/'];
const DOCUMENTS = ['/', '/index.html', '/coding', '/coding/javascript/js-double-numbers', '/premium/index.html', '/topics/javascript-closures/index.html', '/sandbox/index.html'];
const WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'self'";

export function vercelRoutingContracts(): void {
  const config = readVercelConfig();
  assert.equal(config.headers, undefined, 'vercel.json keeps its header rules in `routes`: a `headers` property would be appended after the hit phase and reach existing files only');
  const handles = (config.routes ?? []).filter((route) => route.handle !== undefined).map((route) => route.handle);
  assert.deepEqual(handles, ['filesystem', 'hit'], 'vercel.json routes: header rules, then the filesystem phase, then the hit phase, each once');
  const phases = routePhases(config);

  // The browser adds robots metadata on navigation, but an email or payment
  // return must also stay out of search when a crawler never executes JS.
  for (const pathname of NOINDEX_PATHS) {
    for (const path of [pathname, `${pathname}/`]) {
      assert.equal(phaseHeaders(path, 'main', phases)['x-robots-tag'], 'noindex', `${path} is excluded before the app renders`);
    }
  }
  for (const path of ['/', '/premium', '/premium/cancel', '/daily', '/topics/javascript-closures']) {
    assert.equal(phaseHeaders(path, 'main', phases)['x-robots-tag'], undefined, `${path} remains indexable`);
  }

  // Every rule before the filesystem check only adds headers, so none of them
  // ends the request early and every rule after it still runs. The one
  // exception is a permanent redirect of a moved page, which ends the request
  // on purpose and comes after every header rule, so the 308 still carries
  // the app's security headers.
  const retiredGuides = phases.main.filter((route) => route.src === '^/cs/topics(?:/.*)?$');
  assert.equal(retiredGuides.length, 1, 'retired guide URLs answer the app shell with HTTP 404');
  const redirects = phases.main.filter((route) => route.status === 308);
  for (const route of phases.main) {
    if (route.src === '^/cs/topics(?:/.*)?$') {
      assert.equal(route.dest, '/index.html');
      assert.equal(route.status, 404);
      assert.equal(route.continue, undefined);
      assert.equal(route.headers?.['X-Robots-Tag'], 'noindex');
      continue;
    }
    if (redirects.includes(route)) continue;
    assert.ok(route.continue === true && route.headers && !route.dest && route.status === undefined, `${route.src} runs before the filesystem check and must only add headers`);
  }
  // Public Learn previews must reach their own HTML before the SPA fallback.
  for (const id of ['web-developer', 'software-engineer']) {
    const source = `/learn/${id}`;
    const rewrite = (config.rewrites ?? []).find(one => one.source === source);
    assert.equal(rewrite?.destination, `${source}/index.html`, `${source} serves its public preview`);
    const fallback = (config.rewrites ?? []).findIndex(one => one.destination === '/index.html');
    assert.ok((config.rewrites ?? []).indexOf(rewrite!) < fallback, `${source} precedes the SPA fallback`);
  }
  for (const route of redirects) {
    assert.equal(route.status, 308, `${route.src} is a permanent redirect`);
    assert.ok(route.dest === undefined && route.continue === undefined, `${route.src} answers with a redirect and ends the request`);
    assert.deepEqual(Object.keys(route.headers ?? {}), ['Location'], `${route.src} sets Location and nothing else`);
    assert.ok(phases.main.indexOf(route) > Math.max(...phases.main.filter((one) => one.status === undefined).map((one) => phases.main.indexOf(one))), `${route.src} comes after every header rule`);
    for (const path of [...ASSET_PATHS, ...DOCUMENTS]) assert.ok(!routeMatches(route, path), `${route.src} would redirect ${path}`);
  }
  // The FDE path moved into its Learn section (#489, plan decision D4). Its
  // old addresses answer a crawler with a 308 to the new one, the module kept.
  // These routes sit before the filesystem check, as Vercel compiles a
  // `redirects` entry; a `redirects` property itself would land after
  // `handle: hit` here, where a page that is no file never reaches it.
  assert.equal(config.redirects, undefined, 'vercel.json keeps its redirects in `routes`, before the filesystem check');
  const redirectOf = (path: string) => {
    const route = redirects.find((one) => routeMatches(one, path));
    if (!route) return null;
    const match = new RegExp(route.src!, 'i').exec(path)!;
    return route.headers!.Location.replace(/\$(\d)/g, (_, index: string) => match[Number(index)] ?? '');
  };
  const MOVED: [string, string][] = [
    ['/roadmap/specializations/fde', '/learn/forward-deployed-engineer/path'],
    ['/roadmap/specializations/fde/', '/learn/forward-deployed-engineer/path'],
    ['/roadmap/specializations/fde/fde-v1-m03', '/learn/forward-deployed-engineer/path/fde-v1-m03'],
    ['/roadmap/specializations/fde/fde-v1-m03/', '/learn/forward-deployed-engineer/path/fde-v1-m03'],
    ['/roadmap/specializations/fde/fde-v1-m03/extra', '/learn/forward-deployed-engineer/path/fde-v1-m03'],
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

  // A path under /assets/ or /sandbox/assets/ that matched no file answers 404
  // with no-store, before any rewrite could answer it with index.html.
  const [missing] = phases.filesystem;
  assert.ok(missing, 'the filesystem phase starts with the rule for a missing asset');
  for (const path of ASSET_PATHS) {
    assert.ok(routeMatches(missing, path), `${path}: a missing file reaches the 404 rule`);
  }
  assert.equal(missing.status, 404, 'a missing asset answers 404');
  assert.equal(missing.dest, undefined, 'a missing asset is answered, not rewritten');
  assert.equal(missing.continue, undefined, 'the 404 for a missing asset ends the request');
  assert.equal(Object.entries(missing.headers ?? {}).find(([key]) => key.toLowerCase() === 'cache-control')?.[1], 'no-store', 'no cache keeps the 404 for a missing asset');
  for (const route of phases.filesystem.slice(1)) {
    for (const path of ASSET_PATHS) assert.ok(!routeMatches(route, path), `${route.src} would answer ${path} after the 404 rule`);
  }

  // No rewrite may catch an asset path, the SPA fallback included, and the
  // fallback still serves the app's own pages.
  const rewrites = config.rewrites ?? [];
  for (const rewrite of rewrites) {
    const pattern = rewriteSourcePattern(rewrite.source);
    for (const path of ASSET_PATHS) {
      assert.ok(!pattern.test(path), `the rewrite ${rewrite.source} → ${rewrite.destination} catches ${path}`);
    }
  }
  const fallback = rewrites.find((rewrite) => rewrite.destination === '/index.html');
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
  // fallback (whose shell names the home page as canonical) can answer them.
  const firstMatch = (path: string) => rewrites.find((rewrite) => rewriteSourcePattern(rewrite.source).test(path));
  for (const path of ['/coding/system-design', '/coding/system-design/', '/coding/system-design/sd-url-shortener', '/coding/system-design/dd-requests-per-second/extra']) {
    assert.equal(firstMatch(path)?.destination, '/coding/system-design/index.html', `${path} is answered by the hidden-track page`);
  }
  assert.equal(firstMatch('/coding/javascript')?.destination, '/coding/:track/index.html', 'a track page keeps its own head');
  assert.equal(firstMatch('/coding/javascript/js-double-numbers')?.destination, '/coding/:track/:taskId/index.html', 'a task page keeps its own head');

  // Documents stay revalidated, or a deploy would never reach anyone.
  for (const path of DOCUMENTS) {
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
  // App assets and the sandbox frame's assets stay loadable across origins
  // (the frame has an opaque origin, so its module script is a CORS load).
  assert.equal(phaseHeaders(APP_CHUNK, 'main', phases)['access-control-allow-origin'], '*', 'app assets keep Access-Control-Allow-Origin');
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
}
