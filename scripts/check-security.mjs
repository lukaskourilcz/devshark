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
  // Stripe.js for checkout (client/src/lib/stripeCheckoutForm.ts), and the
  // theme bootstrap in client/index.html by its hash.
  'script-src': ["'self'", 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://checkout.stripe.com', hash],
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
const appPolicy = parsePolicy(csp);
const policyDrift = [];
for (const directive of new Set([...appPolicy.keys(), ...Object.keys(APP_POLICY)])) {
  const listed = appPolicy.get(directive) ?? [];
  const expected = APP_POLICY[directive] ?? [];
  const added = listed.filter(source => !expected.includes(source));
  const missing = expected.filter(source => !listed.includes(source));
  if (!appPolicy.has(directive)) policyDrift.push(`${directive}: missing from vercel.json`);
  else if (!Object.hasOwn(APP_POLICY, directive)) policyDrift.push(`${directive}: in vercel.json, not in APP_POLICY`);
  else if (added.length || missing.length) policyDrift.push(`${directive}: vercel.json adds [${added.join(' ')}] and lacks [${missing.join(' ')}]`);
  else if (listed.length !== expected.length) policyDrift.push(`${directive}: vercel.json repeats a source`);
}
assert.deepEqual(policyDrift, [], `The app policy in vercel.json differs from APP_POLICY in scripts/check-security.mjs:\n  ${policyDrift.join('\n  ')}`);
const scripts = appPolicy.get('script-src').join(' ');
assert(!scripts.includes("'unsafe-inline'") && !scripts.includes("'unsafe-eval'"), 'App scripts must not allow inline execution or eval');
const connections = appPolicy.get('connect-src');
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
