// Read-only localhost lab with invented public settings and fixed API delay.
// No database connection, credentials, user session, provider or write handler.
import http from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = realpathSync(resolve(process.argv[2]));
const port = Number(process.argv[3] || 4180);
const settings = JSON.parse(readFileSync('tests/fixtures/api-settings.json', 'utf8'));
settings.billing = { ...settings.billing, enabled: false, launchOffer: false };
const files = new Map();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };

http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
  // Decode before URL normalization can erase a traversal segment.
  const rawPath = (req.url ?? '/').split('?')[0];
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) { res.writeHead(400); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(rawPath); }
  catch { res.writeHead(400); return res.end(); }
  if (/[\\\u0000]/.test(pathname) || pathname.split('/').includes('..') || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i.test(pathname)) { res.writeHead(403); return res.end(); }
  if (pathname.startsWith('/api/')) {
    return setTimeout(() => {
      res.statusCode = pathname === '/api/settings' ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(pathname === '/api/settings' ? settings : { error: { code: 'fixture_only', message: 'No external provider in this lab' } }));
    }, 400);
  }
  // The opaque exercise frame loads its modules from /sandbox/assets/.
  if (pathname.startsWith('/sandbox/')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (pathname.startsWith('/assets/')) res.setHeader('Access-Control-Allow-Origin', 'https://devshark.app');
  const accept = req.headers.accept;
  const acceptsHtml = accept === undefined || accept.trim() === '*/*' || accept.split(',').some(value => /^\s*text\/html\s*(?:;|$)/i.test(value) && !/;\s*q=0(?:\.0*)?\s*(?:;|$)/i.test(value));
  const pagePath = !/^\/(?:assets|sandbox|api)(?:\/|$)/.test(pathname) && !pathname.split('/').some(part => part.startsWith('.')) && extname(pathname) === '';
  const navigation = pagePath && acceptsHtml;
  const candidate = resolve(root, '.' + pathname);
  if (!candidate.startsWith(root + sep) && candidate !== root) { res.writeHead(403); return res.end(); }
  let file;
  try {
    const info = statSync(candidate);
    const selected = info.isDirectory() ? resolve(candidate, 'index.html') : candidate;
    // A real directory index wins; an index-less directory is a SPA route.
    file = statSync(selected).isFile() ? selected : null;
  } catch { file = null; }
  if (!file && navigation) file = resolve(root, 'index.html');
  if (!file) { res.writeHead(404); return res.end(); }
  try {
    file = realpathSync(file);
    if (!file.startsWith(root + sep) && file !== root) { res.writeHead(403); return res.end(); }
  } catch { res.writeHead(404); return res.end(); }
  try {
    let entry = files.get(file);
    if (!entry) {
      const body = readFileSync(file);
      entry = { body, gzip: /\.(js|css|html|json|svg)$/.test(file) ? gzipSync(body) : null, type: types[extname(file)] || 'application/octet-stream' };
      files.set(file, entry);
    }
    res.setHeader('Content-Type', entry.type);
    res.setHeader('Cache-Control', pathname.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache');
    res.setHeader('Vary', 'Accept-Encoding');
    const compressed = entry.gzip && req.headers['accept-encoding']?.includes('gzip');
    if (compressed) res.setHeader('Content-Encoding', 'gzip');
    res.end(req.method === 'HEAD' ? undefined : compressed ? entry.gzip : entry.body);
  } catch { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Read-only fixture on http://127.0.0.1:${port}`));
