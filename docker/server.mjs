// A small Node server that runs devShark the way Vercel does, for the Docker
// image (docs/packages.md). It serves client/dist, answers /api/* with the twelve
// handlers bundled by docker/build-handlers.mjs, and reads the headers,
// redirects and rewrites from vercel.json so it cannot drift from production.
// It approximates Vercel's router; production stays on Vercel.
import http from 'node:http';
import { Readable } from 'node:stream';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const STATIC = path.join(ROOT, 'client/dist');
const HANDLERS = path.join(ROOT, 'docker/dist/api');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 4.5 * 1024 * 1024; // Vercel's request body limit
const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const load = createRequire(path.join(ROOT, 'package.json'));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// ---- vercel.json routes: before and after the filesystem step ----
const routes = vercel.routes ?? [];
const fsIndex = routes.findIndex((r) => r.handle === 'filesystem');
const hitIndex = routes.findIndex((r) => r.handle === 'hit');
const beforeFs = routes.slice(0, fsIndex < 0 ? routes.length : fsIndex);
const missRoutes = fsIndex < 0 ? [] : routes.slice(fsIndex + 1, hitIndex < 0 ? routes.length : hitIndex);
const hitRoutes = hitIndex < 0 ? [] : routes.slice(hitIndex + 1);
// A Supabase that is not *.supabase.co (a local `supabase start`) has to be
// allowed in connect-src, or the browser blocks sign-in. CSP_CONNECT_EXTRA
// lists the extra sources, separated by spaces.
const extraConnect = (process.env.CSP_CONNECT_EXTRA ?? '').trim();
if (extraConnect) {
  for (const route of routes) {
    const csp = route.headers?.['Content-Security-Policy'];
    if (csp && /connect-src /.test(csp)) route.headers['Content-Security-Policy'] = csp.replace(/connect-src ([^;]*)/, `connect-src $1 ${extraConnect}`);
  }
}
const fill = (template, match) => template.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '');

// ---- vercel.json rewrites: ":name" segments and "(...)" groups ----
const rewrites = (vercel.rewrites ?? []).map(({ source, destination }) => {
  const names = [];
  const pattern = source.replace(/:([A-Za-z]+)/g, (_, name) => { names.push(name); return '([^/]+)'; });
  return { regex: new RegExp(`^${pattern}$`), names, destination };
});
function rewrite(pathname) {
  for (const rule of rewrites) {
    const match = rule.regex.exec(pathname);
    if (!match) continue;
    let target = rule.destination;
    rule.names.forEach((name, i) => { target = target.replaceAll(`:${name}`, match[i + 1]); });
    return target.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '');
  }
  return null;
}

// ---- the twelve handlers: /api/user/[op] matches /api/user/anything ----
const handlerFiles = JSON.parse(readFileSync(path.join(HANDLERS, 'manifest.json'), 'utf8'));
const apiRoutes = handlerFiles.map((file) => {
  const segments = file.replace(/\.cjs$/, '').split('/');
  return { file, segments };
}).sort((a, b) => a.segments.filter((s) => s.startsWith('[')).length - b.segments.filter((s) => s.startsWith('[')).length);
const loaded = new Map();
function findHandler(pathname) {
  const parts = pathname.replace(/^\/api\//, '').replace(/\/$/, '').split('/');
  for (const route of apiRoutes) {
    if (route.segments.length !== parts.length) continue;
    const params = {};
    if (route.segments.every((s, i) => (s.startsWith('[') ? ((params[s.slice(1, -1)] = decodeURIComponent(parts[i])), true) : s === parts[i]))) {
      if (!loaded.has(route.file)) {
        const mod = load(path.join(HANDLERS, route.file));
        loaded.set(route.file, mod.default ?? mod);
      }
      return { handler: loaded.get(route.file), params };
    }
  }
  return null;
}

// ---- request and response helpers in the shape lib/vercel-types.ts declares ----
function queryOf(url) {
  const query = {};
  for (const [key, value] of url.searchParams) {
    const existing = query[key];
    query[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return query;
}

function parseBody(raw, type) {
  if (!raw.length) return undefined;
  const text = raw.toString('utf8');
  if (/application\/json/i.test(type)) {
    try { return JSON.parse(text); } catch { return text; }
  }
  if (/application\/x-www-form-urlencoded/i.test(type)) return Object.fromEntries(new URLSearchParams(text));
  if (/^text\//i.test(type)) return text;
  return raw;
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decorate(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
  res.send = (body) => {
    if (body === undefined || body === null) { res.end(); return res; }
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'application/octet-stream');
      res.end(body);
    } else if (typeof body === 'object') {
      return res.json(body);
    } else {
      if (!res.getHeader('content-type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(String(body));
    }
    return res;
  };
  res.redirect = (statusOrUrl, url) => {
    const [code, location] = typeof statusOrUrl === 'number' ? [statusOrUrl, url] : [307, statusOrUrl];
    res.statusCode = code;
    res.setHeader('Location', location);
    res.end();
    return res;
  };
  return res;
}

async function runApi(req, res, url) {
  let found;
  try { found = findHandler(url.pathname); } catch (error) {
    // A handler that throws while loading (a missing SESSION_SECRET in
    // production) answers like a failed request instead of a dropped one.
    console.error(JSON.stringify({ level: 'error', category: 'docker_handler_load', path: url.pathname, message: String(error?.message ?? error) }));
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"internal_error"}');
    return;
  }
  if (!found) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"not_found"}'); return; }
  let raw;
  try { raw = await readRaw(req); } catch (error) {
    res.statusCode = error.status ?? 400; res.end(); return;
  }
  // Path parameters fill the query only where the query has no value: the
  // client calls /api/user/[op]?op=x, and the explicit op must win.
  const query = { ...found.params, ...queryOf(url) };
  // Vercel sets these headers itself. A Docker client can send any value,
  // so rate limits here use the peer address on the socket.
  const headers = { ...req.headers };
  delete headers['x-forwarded-for'];
  delete headers['x-real-ip'];
  // A fresh stream over the same bytes, so a handler that verifies a raw body
  // (the Stripe webhook in lib/billing/stripe.ts) can still read it.
  const request = Object.assign(Readable.from(raw.length ? [raw] : []), {
    method: req.method, url: req.url, headers, query, socket: req.socket,
    body: parseBody(raw, String(req.headers['content-type'] ?? '')),
  });
  try {
    await found.handler(request, decorate(res));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', category: 'docker_handler', path: url.pathname, message: String(error?.message ?? error) }));
    if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end('{"error":"internal_error"}'); }
    else res.end();
  }
}

function staticFile(pathname) {
  const file = path.normalize(path.join(STATIC, decodeURIComponent(pathname)));
  if (!file.startsWith(STATIC + path.sep) && file !== STATIC) return null;
  try { return statSync(file).isFile() ? file : null; } catch { return null; }
}

function sendFile(res, file, status, headers) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (!res.getHeader('content-type')) res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  if (file.endsWith('.html') && !res.getHeader('cache-control')) res.setHeader('Cache-Control', 'no-cache');
  res.statusCode = status;
  createReadStream(file).pipe(res);
}

function applyHeaderRoutes(list, pathname, headers) {
  for (const route of list) {
    if (!route.src || !route.continue || !route.headers) continue;
    if (new RegExp(route.src).test(pathname)) Object.assign(headers, route.headers);
  }
}

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;
  const headers = {};

  for (const route of beforeFs) {
    if (!route.src) continue;
    const match = new RegExp(route.src).exec(pathname);
    if (!match) continue;
    if (route.continue) { if (route.headers) Object.assign(headers, route.headers); continue; }
    if (route.status && route.headers?.Location) {
      res.statusCode = route.status;
      for (const [name, value] of Object.entries({ ...headers, ...route.headers })) res.setHeader(name, fill(value, match));
      res.end();
      return;
    }
    if (route.dest) {
      const file = staticFile(fill(route.dest, match));
      if (file) { sendFile(res, file, route.status ?? 200, { ...headers, ...route.headers }); return; }
    }
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    await runApi(req, res, url);
    return;
  }

  const direct = staticFile(pathname);
  if (direct) {
    applyHeaderRoutes(hitRoutes, pathname, headers);
    sendFile(res, direct, 200, headers);
    return;
  }

  for (const route of missRoutes) {
    if (route.src && route.status && new RegExp(route.src).test(pathname)) {
      res.statusCode = route.status;
      for (const [name, value] of Object.entries({ ...headers, ...route.headers })) res.setHeader(name, value);
      res.end();
      return;
    }
  }

  const target = rewrite(pathname);
  if (target && /^https?:\/\//.test(target)) {
    // The PostHog ingest proxy is not part of the image; analytics stay off.
    res.statusCode = 404;
    res.end();
    return;
  }
  const file = target ? staticFile(target) : null;
  if (file) { sendFile(res, file, 200, headers); return; }
  const notFound = staticFile('/index.html');
  if (notFound) { sendFile(res, notFound, 404, headers); return; }
  res.statusCode = 404;
  res.end();
}

if (!existsSync(STATIC)) {
  console.error('client/dist is missing: build the client first (npm run build).');
  process.exit(1);
}

http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(JSON.stringify({ level: 'error', category: 'docker_server', message: String(error?.message ?? error) }));
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
}).listen(PORT, () => console.log(`devShark listening on http://localhost:${PORT}`));
