// How Vercel answers one path under vercel.json: how the request ends and the
// headers vercel.json's routes give the response. docker/server.test.mjs holds
// the Docker adapter to this model. docker/server.mjs keeps its own copy of the
// routing, because the Dockerfile copies that file alone.
//
// The model follows Vercel's phases (scripts/vercel-routing-contract.ts says
// why the header rules are routes):
// 1. Every main-phase route whose `src` matches adds its headers, in order,
//    until a route without `continue` ends the request: a redirect, or a
//    `dest` answered with the route's status.
// 2. A path that names a file (or a function under /api/) is served; a file
//    also gets the headers of the hit-phase routes.
// 3. A path that names nothing meets the filesystem-phase routes: the no-store
//    404 for a missing asset.
// 4. The rewrites run in order. Each one that matches rewrites the path, the
//    next ones see the rewritten path, and the first whose destination is a
//    file serves it. An external destination is proxied.
// 5. A path nothing serves gets Vercel's own plain-text 404.
// Vercel matches route `src` and rewrite `source` case-sensitively: on
// production /ROADMAP/specializations/fde is no redirect.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readVercelConfig(root = process.cwd()) {
  return JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
}

function routePhases(config) {
  const phases = { main: [], filesystem: [], hit: [] };
  let phase = 'main';
  for (const route of config.routes ?? []) {
    if (route.handle === 'filesystem' || route.handle === 'hit') phase = route.handle;
    else if (route.handle !== undefined) throw new Error(`vercel.json routes use handle "${route.handle}", which this model does not know`);
    else phases[phase].push(route);
  }
  return phases;
}

const lowerKeys = (headers = {}) => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
const fillGroups = (template, match) => template.replace(/\$(\d+)/g, (_, index) => match[Number(index)] ?? '');

/** Every header name a route in vercel.json sets, lower-cased and sorted. */
export function headerNames(config) {
  const names = new Set();
  for (const route of config.routes ?? []) for (const name of Object.keys(route.headers ?? {})) names.add(name.toLowerCase());
  return [...names].sort();
}

/** A rewrite `source` (path-to-regexp, as Vercel reads it) for the shapes
 * vercel.json uses: literal text, `:name` segments and `(...)` groups, which
 * are regular expressions already. */
function rewritePattern(source) {
  const names = [];
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
      if (end >= source.length) throw new Error(`unbalanced group in rewrite source ${source}`);
      pattern += source.slice(i, end + 1);
      names.push(null);
      i = end + 1;
    } else if (char === ':') {
      const name = /^:(\w+)/.exec(source.slice(i));
      if (!name) throw new Error(`unnamed parameter in rewrite source ${source}`);
      pattern += '([^/]+?)';
      names.push(name[1]);
      i += name[0].length;
    } else {
      pattern += char.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return { regex: new RegExp(`^${pattern}$`), names };
}

function rewriteTarget(rule, match) {
  let target = rule.destination;
  rule.names.forEach((name, index) => { if (name) target = target.replaceAll(`:${name}`, match[index + 1]); });
  return fillGroups(target, match);
}

function headersOf(routes, pathname, headers = {}) {
  for (const route of routes) {
    if (route.src && route.continue && new RegExp(route.src).test(pathname)) Object.assign(headers, lowerKeys(route.headers));
  }
  return headers;
}

/**
 * How Vercel answers `pathname`. `isFile(path)` says whether the deployment
 * holds a static file at that path. `ends` is one of redirect, route, file,
 * function, missing, rewrite, proxy or not-found; `status` is null where the
 * function or the proxied host decides it; `headers` maps lower-cased names
 * to the values vercel.json gives them, and leaves out what the platform adds.
 */
export function vercelAnswer(config, pathname, isFile) {
  const phases = routePhases(config);
  const headers = {};
  for (const route of phases.main) {
    if (!route.src) continue;
    const match = new RegExp(route.src).exec(pathname);
    if (!match) continue;
    if (route.continue) { Object.assign(headers, lowerKeys(route.headers)); continue; }
    const own = Object.fromEntries(Object.entries(lowerKeys(route.headers)).map(([name, value]) => [name, fillGroups(value, match)]));
    if (own.location !== undefined && route.status) return { ends: 'redirect', status: route.status, headers: { ...headers, ...own } };
    if (route.dest) return { ends: 'route', status: route.status ?? 200, file: fillGroups(route.dest, match), headers: { ...headers, ...own } };
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) return { ends: 'function', status: null, headers };
  if (isFile(pathname)) return { ends: 'file', status: 200, file: pathname, headers: headersOf(phases.hit, pathname, headers) };

  for (const route of phases.filesystem) {
    if (!route.src || !new RegExp(route.src).test(pathname)) continue;
    if (route.continue) { Object.assign(headers, lowerKeys(route.headers)); continue; }
    if (route.status) return { ends: 'missing', status: route.status, headers: { ...headers, ...lowerKeys(route.headers) } };
  }

  let current = pathname;
  for (const rule of (config.rewrites ?? []).map((one) => ({ ...one, ...rewritePattern(one.source) }))) {
    const match = rule.regex.exec(current);
    if (!match) continue;
    current = rewriteTarget(rule, match);
    if (/^https?:\/\//.test(current)) return { ends: 'proxy', status: null, target: current, headers };
    if (isFile(current)) return { ends: 'rewrite', status: 200, file: current, headers: headersOf(phases.hit, current, headers) };
  }
  return { ends: 'not-found', status: 404, headers };
}
