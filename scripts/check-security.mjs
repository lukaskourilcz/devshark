import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const boot = readFileSync('client/index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const hash = `'sha256-${createHash('sha256').update(boot).digest('base64')}'`;
const scripts = csp.split(';').find(part => part.trim().startsWith('script-src '));
assert(scripts.includes(hash), 'Prepaint script must match its CSP hash');
assert(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), 'App scripts must not allow inline execution or eval');
for (const directive of ["frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) assert(csp.includes(directive));
const connections = csp.split(';').map(part => part.trim()).find(part => part.startsWith('connect-src '))?.split(/\s+/) ?? [];
// The Sentry SDK posts errors straight to its EU ingest host (the DSN in client/src/lib/sentry.ts sets no tunnel).
assert(connections.includes('https://*.ingest.de.sentry.io'), 'connect-src must allow the Sentry EU ingest host, or browser errors never arrive');
assert(!connections.some(source => source === '*' || source === 'https:' || source === 'https://*.sentry.io'), 'connect-src must name hosts, not open every origin');
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
const url = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
if (url) {
  const origin = new URL(url); assert.equal(origin.protocol, 'https:');
  for (const route of ['/', '/sandbox/index.html']) {
    const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `${route}: ${response.status}`);
    const live = response.headers.get('content-security-policy') || '';
    assert(live.includes(route === '/' ? hash : "frame-ancestors 'self'"), `${route}: expected deployed CSP`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    console.log(`${origin.origin}${route}: HTTPS ${response.status}, expected security headers present`);
  }
}
