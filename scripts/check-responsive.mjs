// Sweeps every major route at the product's representative viewport widths
// using Chrome DevTools Protocol
// device emulation. Reports horizontal overflow + the elements that cause it,
// plus checks for child boxes that punch outside their parent (visual cut-off
// or overlap). Captures a screenshot per (route × width) only when something
// goes wrong, so the artifact pile stays small.
//
// A measurement counts only if the route rendered what it is for: the page
// must load, the app must mount with an <h1>, the route must not land on the
// not-found page (unless it is a /not-found-… probe), and every /api request
// it makes must be answered by a fixture below. The preview server has no API,
// so a route whose data has no fixture would otherwise be measured on its
// error state and pass.
//
// Run:   npm run check:responsive
// Focus: npm run check:responsive -- --routes /,/quiz --widths 390,1280
// Env:   RESPONSIVE_ROUTES=/learn,/challenge RESPONSIVE_WIDTHS=360,768

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLEARANCE, TOUCH_TARGETS } from './responsive-clearance.mjs';
import { closeBrowserProcess } from './responsive-browser-process.mjs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function resolveChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (found) return found;
  throw new Error(
    'No Chrome/Chromium binary found. Set CHROME_BIN to a headless-capable browser.',
  );
}

const IS_LINUX = platform() === 'linux';
const DEFAULT_BASE = 'http://localhost:4173';
// The routes that render their page on the preview server with the fixtures
// below, all signed out. Left out until the sweep has fixtures for their
// data, because without them they are measured on an error or empty state:
//   /roadmap (GET /api/user/* for the learner's profile);
//   /dev (GET /api/admin/settings); /play/EXPIRED
//   (signed out it is the same sign-in gate as /play).
const DEFAULT_ROUTES = [
  '/',
  '/quiz',
  '/daily',
  '/learn',
  // The three Learn sections (#488); /learn resolves to one of them.
  '/learn/web-developer',
  '/learn/software-engineer',
  '/learn/forward-deployed-engineer',
  '/big-o',
  '/learn/big-o',
  '/today',
  '/challenge',
  '/leaderboard',
  // This month's XP board, the fourth period (migration 056).
  '/leaderboard?tab=month',
  '/shop',
  '/play',
  '/cards',
  '/coding',
  '/coding/javascript',
  '/coding/algorithms',
  '/coding/system-design',
  '/coding/review',
  '/coding/javascript/js-double-numbers',
  '/learn/forward-deployed-engineer/path',
  '/settings/github',
  '/profile',
  '/premium',
  '/privacy',
  '/terms',
  '/premium/success',
  '/premium/cancel',
  '/auth/confirmed',
  '/reset-password',
  '/classroom',
  '/topics/javascript-closures',
  '/not-found-responsive-check',
];
const DEFAULT_VIEWPORTS = [
  { label: '320x700', width: 320, height: 700, mobile: true },
  { label: '360x800', width: 360, height: 800, mobile: true },
  { label: '390x844', width: 390, height: 844, mobile: true },
  { label: '430x932', width: 430, height: 932, mobile: true },
  { label: '768x1024', width: 768, height: 1024, mobile: false },
  { label: '820x1180', width: 820, height: 1180, mobile: false },
  { label: '1024x768', width: 1024, height: 768, mobile: false },
  { label: '1280x800', width: 1280, height: 800, mobile: false },
  { label: '1366x768', width: 1366, height: 768, mobile: false },
  { label: '1440x900', width: 1440, height: 900, mobile: false },
];

// The /api answers the sweep gives, in the wire shape of the real handlers.
// The preview server has no API; a route that asks for anything not listed
// here fails, because it would be measured on its error state.
// The launched deployment's public settings, which every page reads; the same
// body the client tests use, checked against api/settings.ts by test:launch.
const SETTINGS = JSON.parse(readFileSync(new URL('../tests/fixtures/api-settings.json', import.meta.url), 'utf8'));
const ACCOUNT = JSON.parse(readFileSync(new URL('../tests/fixtures/responsive-account.json', import.meta.url), 'utf8'));
const BUDGET = JSON.parse(readFileSync(new URL('../docs/quality/bundle-budget.json', import.meta.url), 'utf8'));
const AUTH_ORIGIN = new URL(BUDGET.measuredBuild.env.VITE_SUPABASE_URL).origin;

/** A local session that no server issued. Fetch interception supplies Auth. */
export function fixtureSession() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: ACCOUNT.user.id, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })}.${Buffer.from('responsive-fixture-not-a-signature').toString('base64url')}`,
    refresh_token: 'responsive-fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user: ACCOUNT.user,
  };
}
// The roadmap structure, the path catalog and a coding task, built from the
// server's own modules (scripts/responsive-fixtures.ts), bundled once here.
let SERVER;
async function loadServerFixtures() {
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [new URL('./responsive-fixtures.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error',
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
}
const ROADMAP = '/api/quiz/roadmap';
// The Biggest Shark Challenge board (lib/challenge-store.ts) and the 30-day
// board (window_leaderboard rows): invented learners in the real shapes, the
// same ones the client tests use.
const CHALLENGE_BOARD = {
  top: [{ id: 'run-1', name: 'Harbour reader', score: 42, createdAt: '2026-09-25T10:00:00Z' }],
  champion: { id: 'run-1', name: 'Harbour reader', score: 42, createdAt: '2026-09-25T10:00:00Z' },
};
const WINDOW_BOARD = {
  period: '30d', days: 30, category: null, min_answers: 5,
  entries: [
    { rank: 1, display_name: 'Workshop learner', picture: null, correct: 8, answered: 10, accuracy_pct: 80, is_viewer: false },
    { rank: 2, display_name: 'Harbour reader', picture: null, correct: 6, answered: 9, accuracy_pct: 67, is_viewer: false },
  ],
};
// This month's XP (period=month, month_xp_leaderboard rows), with a shared
// first place as the server ranks it.
const MONTH_BOARD = {
  period: 'month', month: '2026-10', subject: 'webdev',
  entries: [
    { rank: 1, display_name: 'Night owl', picture: null, xp: 1240, is_viewer: false },
    { rank: 1, display_name: 'Early bird', picture: null, xp: 1240, is_viewer: false },
    { rank: 3, display_name: null, picture: null, xp: 980, is_viewer: false },
  ],
};
// GET /api/user/[op]?op=shop: redemption closed, as the launched settings say.
const SHOP = {
  enabled: false, cashCheckoutEnabled: false, testMode: false, policyUrl: '',
  items: [
    { sku: 'mug', variants: [], availability: 'unconfigured', price: null, variantStock: [{ variant: '', free: 0 }] },
    { sku: 't-shirt', variants: ['S', 'M'], availability: 'unconfigured', price: null, variantStock: [] },
  ],
  crown: { available: true, tokenPrice: 1200 },
  protection: { available: true, tokenPrice: 250, cap: 2 },
};

const API_FIXTURES = [
  { method: 'GET', match: (url) => url.pathname === '/api/settings', body: () => SETTINGS },
  {
    // GET /api/quiz/daily?qotd=<date|today>: the question of the day, as
    // api/quiz/daily.ts sends it (the same fixture tests/browser/daily.spec.ts
    // uses). The server names the day it answered for, never "today".
    method: 'GET',
    match: (url) => url.pathname === '/api/quiz/daily' && url.searchParams.has('qotd'),
    body: (url) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('qotd') ?? '')
        ? url.searchParams.get('qotd')
        : new Date().toISOString().slice(0, 10),
      track: 'javascript',
      sessionId: 'responsive-sweep-session',
      question: { id: 'q-1', question: 'What does `typeof null` return?', options: ['"null"', '"object"', '"undefined"', '"number"'], category: 'javascript', difficulty: 2 },
    }),
  },
];

API_FIXTURES.push(
  { method: 'GET', match: (url) => url.pathname === ROADMAP && !url.searchParams.has('resource'), body: () => SERVER.roadmapStructure() },
  // Career checks for account progress even for a guest. The real endpoint
  // requires sign-in; answer that known read without inventing progress.
  { method: 'GET', status: 401, match: (url) => url.pathname === ROADMAP && url.searchParams.get('resource') === 'progress', body: () => ({ error: { code: 'unauthorized', message: 'Authentication required' } }) },
  { method: 'GET', match: (url) => url.pathname === ROADMAP && url.searchParams.get('resource') === 'learning-path-catalog', body: () => SERVER.pathCatalog() },
  {
    method: 'GET',
    // A task page's read: combined, or a free task's brief and visitor's part.
    match: (url) => url.pathname === ROADMAP && SERVER.codingTaskRead(url.searchParams.get('resource') ?? '', url.searchParams.get('id') ?? '') !== null,
    body: (url) => SERVER.codingTaskRead(url.searchParams.get('resource') ?? '', url.searchParams.get('id') ?? ''),
  },
  { method: 'GET', match: (url) => url.pathname === '/api/quiz/challenge' && url.searchParams.get('resource') === 'leaderboard', body: () => CHALLENGE_BOARD },
  { method: 'GET', match: (url) => url.pathname === '/api/leaderboard' && url.searchParams.get('period') === '30d', body: (url) => ({ ...WINDOW_BOARD, category: url.searchParams.get('category') }) },
  { method: 'GET', match: (url) => url.pathname === '/api/leaderboard' && url.searchParams.get('period') === 'month', body: () => MONTH_BOARD },
  { method: 'GET', match: (url) => decodeURIComponent(url.pathname) === '/api/user/[op]' && url.searchParams.get('op') === 'shop', body: () => SHOP },
);

export function apiFixture(method, url, authMode = 'signed-in') {
  if (url.origin === AUTH_ORIGIN && authMode === 'signed-in') {
    if (method === 'OPTIONS' && ['/auth/v1/user', '/auth/v1/token'].includes(url.pathname)) return { status: 204, body: null };
    if (method === 'GET' && url.pathname === '/auth/v1/user') return { status: 200, body: ACCOUNT.user };
    if (method === 'POST' && url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return { status: 200, body: fixtureSession() };
  }
  if (url.pathname.startsWith('/auth/')) return null;
  const userRoute = decodeURIComponent(url.pathname).match(/^\/api\/user\/([^/]+)$/);
  const op = userRoute && (userRoute[1] === '[op]' ? url.searchParams.get('op') : userRoute[1]);
  if (authMode === 'signed-in') {
    if (method === 'POST' && op === 'authevent') return { status: 200, body: { ok: true } };
    if (method === 'GET') {
      const bodies = {
        stats: { data: { ...ACCOUNT.stats, last_quiz_date: new Date().toISOString().slice(0, 10) } },
        entitlement: { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null },
        xp: { data: { quest_xp: 200, by_subject: { webdev: 200 } } },
        freezes: { remaining: 2, period: new Date().toISOString().slice(0, 7), used: [], shieldUntil: null, shieldDays: [], shieldSupported: true },
        advisor: { weakAreas: [{ category: 'javascript', accuracyPct: 65, answered: 20 }], suggestedWeek: [{ day: 1, category: 'javascript', focus: 'practice' }], generatedAt: new Date().toISOString() },
        'leaderboard-name': { mode: 'nickname', nickname: 'responsiveShark1', accountName: ACCOUNT.user.user_metadata.full_name, showPhoto: false },
        'friends-handle': { handle: 'responsiveShark1', discoverable: true, country: null, canChangeAt: null },
        identity: { showRealName: false, showPhoto: false, realName: ACCOUNT.user.user_metadata.full_name, photo: null },
        'friends-list': { friends: [], requests: [] },
        'learning-preference': { preference: ACCOUNT.user.user_metadata.devquiz_learning_preference_v1, legacyTrack: 'frontend', profile: ACCOUNT.user.user_metadata.devquiz_learner_profile_v2, missingProfileFields: [] },
        'learning-path-enrollment': { enrollments: [] },
        'coding-bookmarks': { saved: ['js-double-numbers'], collections: [] },
        'practice-session': { session: null },
        'coding-progress': { tasks: {}, stagesWithSavedCode: [], due: [], javascriptLevelsCleared: 0, passedByTrack: { javascript: 0, typescript: 0, react: 0, 'system-design': 0, algorithms: 0 } },
        'github-connection': { available: true, status: 'not_connected', accountLogin: null, repoFullName: null, defaultBranch: null, lastCommitAt: null, queued: 0, lastError: null },
        wallet: ACCOUNT.wallet,
        orders: { orders: [] },
      };
      if (op && Object.hasOwn(bodies, op)) return { status: 200, body: bodies[op] };
      if (url.pathname === '/api/flashcards') return { status: 200, body: { cards: ACCOUNT.cards } };
      if (url.pathname === ROADMAP && url.searchParams.get('resource') === 'progress') return { status: 200, body: { data: ACCOUNT.progress, extra: { unlocked: [], wallets: { webdev: { balance: 350 } }, inventories: {} } } };
      if (url.pathname === '/api/quiz/questions' && url.searchParams.get('resource') === 'due') return { status: 200, body: { due: [], estimatedMinutes: 0 } };
    }
  }
  const fixture = API_FIXTURES.find((one) => one.method === method && one.match(url));
  if (!fixture) return null;
  const body = fixture.body(url);
  if (authMode === 'signed-in' && url.pathname === ROADMAP && ['coding-task', 'coding-state'].includes(url.searchParams.get('resource'))) {
    return { status: fixture.status ?? 200, body: { ...body, signedIn: true } };
  }
  return { status: fixture.status ?? 200, body };
}

// A route under /not-found-… is there to measure the not-found page itself.
const isNotFoundProbe = (route) => route.startsWith('/not-found-');

// Offline/sandboxed runs: block the webfont hosts (see the CDP setup below).
const BLOCK_EXTERNAL = process.argv.includes('--block-external') ||
  process.env.RESPONSIVE_BLOCK_EXTERNAL === '1';

// The app reads the theme from local storage before it paints, so seeding it
// lets one sweep cover dark mode as well as the widths. There is no language
// to seed: the app ships English only (#485), so a language seed would
// measure the English pages again under another name.
const THEME = process.env.RESPONSIVE_THEME ?? '';
if (process.env.RESPONSIVE_LOCALE) {
  throw new Error('RESPONSIVE_LOCALE has no effect: the app ships English only. Remove it.');
}
const SEED = THEME ? `try { localStorage.setItem('devquiz:color-mode', ${JSON.stringify(THEME)}); } catch (e) {}` : '';

function optionValue(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function commaList(value) {
  return value?.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeRoute(route) {
  return route.startsWith('/') ? route : `/${route}`;
}

class UsageError extends Error {}

function selectedMatrix() {
  const authMode = optionValue('--auth') ?? (process.env.RESPONSIVE_AUTH || 'signed-in');
  if (!['signed-in', 'guest'].includes(authMode)) throw new UsageError(`Invalid responsive auth mode: ${authMode}. Use signed-in or guest.`);
  const zoomText = optionValue('--zoom') ?? (process.env.RESPONSIVE_ZOOM || '100');
  if (!['100', '200', '400'].includes(zoomText)) {
    throw new UsageError(`Invalid responsive zoom: ${zoomText}. Use 100, 200 or 400 percent.`);
  }
  const zoom = Number(zoomText);
  const routeFilter = commaList(optionValue('--routes') ?? process.env.RESPONSIVE_ROUTES);
  const widthFilter = commaList(optionValue('--widths') ?? process.env.RESPONSIVE_WIDTHS)
    ?.map((width) => {
      if (!/^\d+$/.test(width)) throw new UsageError(`Invalid responsive width: ${width}. Use a supported integer width.`);
      return Number(width);
    });
  const routes = routeFilter?.map(normalizeRoute) ?? DEFAULT_ROUTES;
  const viewports = widthFilter
    ? DEFAULT_VIEWPORTS.filter((viewport) => widthFilter.includes(viewport.width))
    : DEFAULT_VIEWPORTS;

  if (routes.length === 0) throw new UsageError('Responsive route filter selected no routes.');
  if (viewports.length === 0) {
    throw new UsageError(`Responsive width filter must use one of: ${DEFAULT_VIEWPORTS.map(({ width }) => width).join(', ')}.`);
  }
  const unsupported = widthFilter?.filter((width) => !DEFAULT_VIEWPORTS.some((viewport) => viewport.width === width));
  if (unsupported?.length) {
    throw new UsageError(`Unsupported responsive width(s): ${unsupported.join(', ')}. Use one of: ${DEFAULT_VIEWPORTS.map(({ width }) => width).join(', ')}.`);
  }
  return { routes, zoom, authMode, viewports: viewports.map((viewport) => ({
    ...viewport,
    physicalWidth: viewport.width,
    physicalHeight: viewport.height,
    width: Math.floor(viewport.width * 100 / zoom),
    height: Math.floor(viewport.height * 100 / zoom),
    deviceScaleFactor: (viewport.mobile ? 2 : 1) * zoom / 100,
    zoom,
    label: zoom === 100 ? viewport.label : `${viewport.label}@${zoom}%`,
  })) };
}

function printHelp() {
  console.log(`Responsive layout sweep

Usage:
  npm run check:responsive
  npm run check:responsive -- --routes /,/quiz --widths 390,1280

Options:
  --routes <csv>      Route paths to probe (default: complete route inventory)
  --widths <csv>      Viewport widths (${DEFAULT_VIEWPORTS.map(({ width }) => width).join(', ')})
  --base-url <url>    Running preview URL (default: ${DEFAULT_BASE})
  --output-dir <path> Keep failure screenshots at an explicit path
  --print-matrix      Print the selected route and viewport inventory as JSON
  --zoom <percent>    Reflow at 100, 200 or 400 percent (RESPONSIVE_ZOOM)
  --auth <mode>       Local signed-in fixture (default) or guest
  --help              Show this help

The same settings are available through RESPONSIVE_ROUTES,
RESPONSIVE_WIDTHS, RESPONSIVE_BASE_URL, RESPONSIVE_OUTPUT_DIR,
RESPONSIVE_BLOCK_EXTERNAL=1 (or --block-external) to block the webfont
hosts on a runner without outbound network, and RESPONSIVE_THEME=dark to
sweep the other theme. A route under /not-found-… is expected to render the
not-found page; every other route must not.
Failure screenshots use a temporary directory by default.`);
  console.log('Zoom profiles keep the physical viewport and image pixel dimensions, shrink the CSS viewport and increase device pixel density. At 400 percent, 1280px becomes 320 CSS pixels. This synthetic full-page zoom does not establish physical-device keyboard behavior.');
}

// A DevTools command that has not answered by now is not going to. Long enough
// for a slow first paint on a cold preview server, short enough that a hung
// route costs one route rather than the run.
const CALL_TIMEOUT_MS = 30000;

async function waitFor(predicate, { timeout = 15000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await predicate()) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function rpc(ws) {
  let id = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  // Every command gets a deadline. Without one a single unresponsive renderer
  // stalls the whole sweep silently and forever: `waitFor` looks like it has a
  // timeout, but its predicate awaits a call, and a promise that never settles
  // never lets the loop reach its own clock. That is not hypothetical — it
  // stopped a full-route run dead for half an hour on one route, with the
  // process alive and the log frozen mid-sweep.
  return (method, params = {}, { timeout = CALL_TIMEOUT_MS } = {}) =>
    new Promise((resolve, reject) => {
      const reqId = id++;
      const timer = setTimeout(() => {
        if (!pending.has(reqId)) return;
        pending.delete(reqId);
        reject(new Error(`${method} did not answer within ${timeout}ms`));
      }, timeout);
      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      pending.set(reqId, { resolve: settle(resolve), reject: settle(reject) });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });
}

async function evaluate(call, expression) {
  const { result, exceptionDetails } = await call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
}

const PROBE = `(() => {
  const winW = window.innerWidth;
  const docW = document.documentElement.scrollWidth;
  const overflow = Math.max(0, docW - winW);

  // 1) Elements whose right edge punches past the viewport.
  const horizOffenders = [];
  if (overflow > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > winW + 0.5) {
        horizOffenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 80),
          id: el.id || '',
          right: Math.round(r.right),
          width: Math.round(r.width),
          overshoot: Math.round(r.right - winW),
        });
        if (horizOffenders.length >= 12) break;
      }
    }
  }

  // 2) Children punching outside their parent's box (clipping / overlap risk).
  //    Skip overflow:visible parents (they intentionally let kids escape) and
  //    body itself (we already covered the viewport).
  const parentOffenders = [];
  const PARENT_TAGS = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'ASIDE', 'UL', 'OL']);
  const ROOT = document.body;
  const describe = (el) => {
    const cls = (el.className && el.className.toString ? el.className.toString() : '').trim();
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.split(/\\s+/).join('.').slice(0, 60) : '');
  };
  function check(el) {
    if (!PARENT_TAGS.has(el.tagName)) return;
    const pr = el.getBoundingClientRect();
    if (pr.width === 0 || pr.height === 0) return;
    const style = getComputedStyle(el);
    if (style.overflow === 'visible' && style.overflowX === 'visible') return;
    // A horizontal scroller is SUPPOSED to hold content wider than its box —
    // that is what the scrollbar is for. Only a parent that clips without
    // scrolling actually loses content.
    const scrollableX = /auto|scroll/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1;
    if (scrollableX) return;
    for (const child of el.children) {
      const cr = child.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) continue;
      // A watermark placed out of flow and hidden from assistive tech is meant
      // to bleed off the panel edge; clipping it loses no content.
      const cs = getComputedStyle(child);
      const decorative = (cs.position === 'absolute' || cs.position === 'fixed') &&
        child.getAttribute('aria-hidden') === 'true';
      if (decorative) continue;
      const overshoot = Math.max(0, cr.right - pr.right);
      if (overshoot > 1) {
        parentOffenders.push({
          parent: describe(el),
          child: describe(child),
          overflowX: style.overflowX,
          overshoot: Math.round(overshoot),
        });
        if (parentOffenders.length >= 8) return;
      }
    }
  }
  function walk(el) {
    check(el);
    for (const c of el.children) walk(c);
  }
  walk(ROOT);

  return { winW, docW, overflow, horizOffenders, parentOffenders };
})()`;

// What the route drew: whether the app mounted, and its page headings.
const RENDERED = `(() => ({
  mounted: (document.getElementById('root')?.childElementCount ?? 0) > 0,
  headings: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()).filter(Boolean),
  pathname: location.pathname,
  readyMarkers: [['profile', '.de-profile-identity'], ['cards', '.sc-card'], ['today', '.today-card'], ['shop', '.rw-wallet__amount']].filter(([, selector]) => document.querySelector(selector)).map(([name]) => name),
}))()`;

export function renderProblems(route, rendered, apiRequests, notFoundHeading, authMode = 'signed-in') {
  const problems = [];
  if (!rendered.mounted) problems.push('the app did not mount (#root is empty)');
  if (rendered.headings.length === 0) problems.push('no <h1>: the page did not draw its heading');
  const notFound = rendered.headings.includes(notFoundHeading);
  if (isNotFoundProbe(route) && !notFound) problems.push('expected the not-found page');
  if (!isNotFoundProbe(route) && notFound) problems.push(`landed on the not-found page ("${notFoundHeading}")`);
  const expected = new URL(route, 'https://responsive.invalid').pathname;
  const redirects = {
    '/learn': ['/learn/web-developer'], '/coding/review': ['/coding'], '/classroom': ['/play'],
    '/learn/forward-deployed-engineer': ['/learn/web-developer'],
    '/learn/forward-deployed-engineer/path': ['/learn/web-developer'],
  };
  if (rendered.pathname && rendered.pathname !== expected && !redirects[expected]?.includes(rendered.pathname)) {
    problems.push(`requested route ${expected} landed on ${rendered.pathname}`);
  }
  const requiredMarker = { '/profile': 'profile', '/cards': 'cards', '/today': 'today', '/shop': 'shop' }[expected];
  if (authMode === 'signed-in' && requiredMarker && !rendered.readyMarkers?.includes(requiredMarker)) {
    problems.push(`${requiredMarker} content is not ready; a heading or sign-in gate does not establish this route`);
  }
  const unanswered = [...new Set(apiRequests.filter((one) => !one.answered).map((one) => one.request))];
  if (unanswered.length) problems.push(`asked the API for data with no fixture in this script: ${unanswered.join(', ')}`);
  return problems;
}

async function probeRoute(session, baseUrl, route, vp, notFoundHeading) {
  const { call } = session;
  await call('Emulation.setDeviceMetricsOverride', {
    width: vp.width,
    height: vp.height,
    // Shrink the layout viewport and grow density together. Pinch scale alone
    // would leave the layout unchanged, and density alone would not reflow it.
    deviceScaleFactor: vp.deviceScaleFactor,
    screenWidth: vp.physicalWidth,
    screenHeight: vp.physicalHeight,
    mobile: vp.mobile,
  });
  // `mobile: true` does not make `(pointer: coarse)` match — touch emulation is
  // what does. Without this the sweep is blind to every coarse-pointer rule,
  // which is where the app's touch-target floors live: a phone width was being
  // measured with a mouse's stylesheet.
  await call('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: vp.mobile ? 5 : 1 });
  // Blank between routes: a route that redirects itself (signed-out /profile)
  // can still have a client-side navigation in flight, which races the next
  // Page.navigate and leaves the document loading forever.
  await call('Page.navigate', { url: 'about:blank' });
  await waitFor(async () => (await evaluate(call, 'document.readyState')) === 'complete', { timeout: 5000 })
    .catch(() => undefined);
  session.apiRequests.length = 0;
  const navigation = await call('Page.navigate', { url: baseUrl + route });
  if (navigation.errorText) throw new Error(`could not load ${baseUrl + route}: ${navigation.errorText}`);
  // A stray pending subresource must not abort the sweep: measure at
  // `interactive` and say so, rather than losing every later route.
  let ready = true;
  try {
    await waitFor(async () => (await evaluate(call, 'document.readyState')) === 'complete', { timeout: 8000 });
  } catch {
    ready = false;
    // Fall back to a parsed document; layout is measurable at `interactive`.
    await waitFor(async () => (await evaluate(call, 'document.readyState')) !== 'loading', { timeout: 4000 })
      .catch(() => undefined);
  }
  // A lazy route draws its heading late; wait for it, then give Suspense and
  // lazy chunks a beat to settle.
  await waitFor(async () => Boolean(await evaluate(call, "document.querySelector('h1')?.textContent.trim()")), { timeout: 8000 })
    .catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  const rendered = await evaluate(call, RENDERED);
  const problems = renderProblems(route, rendered, session.apiRequests, notFoundHeading, session.authMode);
  const geometry = await evaluate(call, `({ width: innerWidth, height: innerHeight, density: devicePixelRatio, screenWidth: screen.width, screenHeight: screen.height })`);
  if (Math.abs(geometry.width - vp.width) > 1 || Math.abs(geometry.height - vp.height) > 1 ||
      Math.abs(geometry.density - vp.deviceScaleFactor) > 0.01 ||
      geometry.screenWidth !== vp.physicalWidth || geometry.screenHeight !== vp.physicalHeight) {
    problems.push(`zoom geometry differs: expected ${vp.width}x${vp.height} CSS at ${vp.deviceScaleFactor} density on ${vp.physicalWidth}x${vp.physicalHeight}, got ${JSON.stringify(geometry)}`);
  }
  const data = await evaluate(call, PROBE);
  const targets = vp.mobile ? await evaluate(call, TOUCH_TARGETS) : { measured: 0, violations: [], exceptions: [] };
  const clearance = await evaluate(call, CLEARANCE);
  if (process.env.RESPONSIVE_DEBUG === '1') {
    console.log(`  [debug] ${route} ${vp.label}: ${clearance.overlays} bottom overlay(s), ${clearance.covered.length} covered, h1 ${JSON.stringify(rendered.headings)}, api ${JSON.stringify(session.apiRequests)}`);
  }
  return { route, viewport: vp.label, zoom: vp.zoom, geometry, physicalWidth: vp.physicalWidth, physicalHeight: vp.physicalHeight, targets, ready, covered: clearance.covered, problems, headings: rendered.headings, ...data };
}

/** The heading of the not-found page, read from an address that cannot exist,
 * so the sweep can tell a route that fell through to it from a real page. */
async function notFoundReference(session, baseUrl, vp) {
  const route = `/not-found-responsive-reference-${Date.now()}`;
  const probe = await probeRoute(session, baseUrl, route, vp, null);
  const heading = probe.headings[0];
  const other = probe.problems.filter((problem) => problem !== 'expected the not-found page');
  if (!heading || other.length) {
    throw new Error(`The not-found page at ${route} did not render cleanly (${other.join('; ') || 'no <h1>'}), so a missing route cannot be told from a real one.`);
  }
  return heading;
}

/** Fail fast, and say why, when no preview server is running. */
async function preflight(baseUrl) {
  let response;
  try {
    response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new Error(`Nothing answered at ${baseUrl} (${error instanceof Error ? error.message : error}). Start the preview first: npm run preview --prefix client`);
  }
  if (!response.ok) throw new Error(`${baseUrl}/ answered HTTP ${response.status}; the sweep needs the built app.`);
}

async function screenshot(call, outDir, name) {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outDir, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

// Bumped per launch so a relaunch never reuses the port a wedged browser may
// still be holding.
let browserGeneration = 0;

/**
 * Start a browser and connect to its page target.
 *
 * Separated out so the sweep can start a *new* one. A long headless run wedges
 * its renderer eventually — twice in one afternoon here, both times about
 * seventy probes in, after which every DevTools command times out and every
 * remaining route goes unmeasured. Relaunching costs a couple of seconds and
 * recovers the rest of the sweep, which is worth far more than the seconds.
 */
async function openBrowser(seed, baseUrl, authMode) {
  const userData = mkdtempSync(path.join(tmpdir(), 'shark-responsive-profile-'));
  const debugPort = Number.parseInt(process.env.RESPONSIVE_DEBUG_PORT ?? '', 10)
    || 9300 + ((process.pid + browserGeneration++) % 500);
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userData}`,
    'about:blank',
  ];
  if (IS_LINUX) chromeArgs.unshift('--no-sandbox', '--disable-dev-shm-usage');
  const chrome = spawn(resolveChrome(), chromeArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let devtoolsSocket;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    // Release the control socket explicitly before shutting down its peer.
    try { devtoolsSocket?.close(); } catch { /* ignore */ }
    closeBrowserProcess(chrome);
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    await waitFor(async () => {
      const tabs = await getJSON(`http://127.0.0.1:${debugPort}/json`);
      return Array.isArray(tabs) && tabs.some((t) => t.type === 'page');
    });
    const tabs = await getJSON(`http://127.0.0.1:${debugPort}/json`);
    const tab = tabs.find((t) => t.type === 'page');
    const ws = devtoolsSocket = new globalThis.WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Unable to connect to Chrome DevTools.')), { once: true });
    });
    const call = rpc(ws);
    await call('Page.enable');
    await call('Runtime.enable');
    if (seed) await call('Page.addScriptToEvaluateOnNewDocument', { source: seed });
    // The sweep answers /api itself (API_FIXTURES) and keeps what the page
    // asked for, so a route measured on a request nobody answered fails.
    const apiRequests = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = msg.params;
      const url = new URL(request.url);
      const baseOrigin = new URL(baseUrl).origin;
      const apiOrAuth = (url.origin === baseOrigin && url.pathname.startsWith('/api/')) || url.pathname.startsWith('/auth/v1/');
      if (!apiOrAuth && (url.origin === baseOrigin || url.protocol === 'data:' || url.protocol === 'about:')) {
        call('Fetch.continueRequest', { requestId }).catch(() => undefined);
        return;
      }
      const fixture = apiOrAuth ? apiFixture(request.method, url, authMode) : null;
      apiRequests.push({ request: `${request.method} ${url.pathname}${url.search}`, answered: Boolean(fixture) });
      const { status, body } = fixture
        ?? { status: 503, body: { error: { code: 'not_configured', message: 'The responsive sweep has no fixture for this request' } } };
      call('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }, { name: 'Access-Control-Allow-Origin', value: baseOrigin }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: 'authorization,apikey,content-type,x-client-info,x-supabase-api-version' }],
        body: Buffer.from(status === 204 ? '' : JSON.stringify(body)).toString('base64'),
      }).catch(() => undefined);
    });
    await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    // Sandboxed runners cannot reach the Google Fonts hosts, so every document
    // waits out its font requests and never fires `load`. Blocking them makes
    // an offline run fast and deterministic; the page then measures with the
    // fallback stack, so leave this off wherever the fonts are reachable.
    if (BLOCK_EXTERNAL) {
      await call('Network.enable');
      await call('Network.setBlockedURLs', {
        urls: ['*://fonts.googleapis.com/*', '*://fonts.gstatic.com/*', '*://www.google.com/*'],
      });
    }
    return { call, close, ws, apiRequests, authMode };
  } catch (err) {
    close();
    throw err;
  }
}


async function main() {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('Responsive checks require Node.js 22 or newer (the version declared in package.json).');
  }
  const { routes, viewports, zoom, authMode } = selectedMatrix();
  if (process.argv.includes('--print-matrix')) {
    console.log(JSON.stringify({ routes, viewports, zoom, authMode }, null, 2));
    return;
  }
  SERVER = await loadServerFixtures();
  const baseUrl = (optionValue('--base-url') ?? process.env.RESPONSIVE_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
  const configuredOutput = optionValue('--output-dir') ?? process.env.RESPONSIVE_OUTPUT_DIR;
  const outDir = configuredOutput
    ? path.resolve(configuredOutput)
    : mkdtempSync(path.join(tmpdir(), 'shark-responsive-shots-'));
  mkdirSync(outDir, { recursive: true });
  await preflight(baseUrl);
  const sessionKey = `sb-${new URL(AUTH_ORIGIN).hostname.split('.')[0]}-auth-token`;
  const authSeed = authMode === 'signed-in'
    ? `try { localStorage.setItem(${JSON.stringify(sessionKey)}, ${JSON.stringify(JSON.stringify(fixtureSession()))}); sessionStorage.setItem('devquiz:auth-reported', '1'); } catch (e) {}`
    : '';
  const seed = SEED + authSeed;
  let session = await openBrowser(seed, baseUrl, authMode);
  console.log(`  fixture auth=${authMode}; unlisted API, Auth and external requests are blocked`);
  if (SEED) console.log(`  seeded theme=${THEME}`);
  console.log(`  zoom=${zoom}%: physical viewport to effective CSS viewport: ${viewports.map((vp) => `${vp.physicalWidth}x${vp.physicalHeight} -> ${vp.width}x${vp.height} at ${vp.deviceScaleFactor} density`).join('; ')}`);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    session.close();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    const notFoundHeading = await notFoundReference(session, baseUrl, viewports[0]);
    const results = [];
    for (const vp of viewports) {
      for (const route of routes) {
        // A route that cannot be probed is a result, not a gap. Reported as a
        // failure and skipped, so one bad route costs its own line rather than
        // the rest of the sweep — and never passes by being unmeasured.
        let r;
        try {
          r = await probeRoute(session, baseUrl, route, vp, notFoundHeading);
        } catch (first) {
          // A timed-out command usually means the renderer has wedged, and a
          // wedged renderer answers nothing again — so every route after this
          // one would fail too. Start a fresh browser and give the route one
          // more try; if it fails on a browser that has just started, the
          // route is the problem rather than the browser.
          process.stdout.write(`  ..... ${vp.label.padEnd(10)} ${route}  (restarting the browser)\n`);
          try {
            session.close();
            session = await openBrowser(seed, baseUrl, authMode);
            r = await probeRoute(session, baseUrl, route, vp, notFoundHeading);
          } catch (second) {
            const reason = second instanceof Error ? second.message : String(second);
            results.push({
              route, viewport: vp.label, error: reason, overflow: 0,
              horizOffenders: [], parentOffenders: [], covered: [], problems: [], ready: false,
              winW: vp.width, docW: vp.width,
            });
            process.stdout.write(`  ERROR ${vp.label.padEnd(10)} ${route}  (${reason})\n`);
            continue;
          }
        }
        results.push(r);
        const broken = r.overflow > 0 || r.parentOffenders.length > 0 || r.covered.length > 0 || r.problems.length > 0 || r.targets.violations.length > 0;
        const tag = broken ? 'FAIL' : 'OK';
        const slow = r.ready ? '' : '  (measured before load finished)';
        process.stdout.write(`  ${tag.padEnd(5)} ${vp.label.padEnd(10)} ${route}${slow}\n`);
        if (broken) {
          const safeRoute = route === '/' ? '_home' : route.replace(/\//g, '_');
          await screenshot(session.call, outDir, `${vp.label}_${safeRoute}.png`);
        }
      }
    }
    session.close();

    const errored = results.filter((r) => r.error);
    const fails = results.filter((r) => r.overflow > 0 || r.parentOffenders.length > 0 || r.covered.length > 0 || r.problems.length > 0 || r.targets?.violations.length > 0);
    console.log(`\n${results.length} probes · ${fails.length} with issues · ${errored.length} unprobed`);
    console.log(`Touch targets: ${results.reduce((sum, row) => sum + (row.targets?.measured ?? 0), 0)} measured; ${results.reduce((sum, row) => sum + (row.targets?.exceptions.length ?? 0), 0)} inline prose exceptions.`);
    if (errored.length) {
      console.log('\nCould not be probed:');
      for (const e of errored) console.log(`  ${e.viewport}  ${e.route} — ${e.error}`);
    }
    if (fails.length) {
      console.log('\nDetails:');
      for (const f of fails) {
        console.log(`\n  ${f.viewport}  ${f.route}`);
        for (const problem of f.problems) console.log(`    not measured as rendered: ${problem}`);
        for (const target of f.targets?.violations ?? []) console.log(`    touch target ${target.selector} ${target.tag}[${target.type}] ${target.classes}: ${target.width}x${target.height}px (${target.text})`);
        console.log(`    winW=${f.winW} docW=${f.docW} overflow=${f.overflow}`);
        if (f.horizOffenders.length) {
          console.log('    horizontal offenders (top elements past viewport):');
          for (const o of f.horizOffenders.slice(0, 5)) {
            console.log(`      <${o.tag}${o.cls ? ' class="' + o.cls + '"' : ''}> right=${o.right} +${o.overshoot}px`);
          }
        }
        if (f.parentOffenders.length) {
          console.log('    children overflowing their parent:');
          for (const o of f.parentOffenders.slice(0, 5)) {
            console.log(`      ${o.child} overshoots ${o.parent} by +${o.overshoot}px (parent overflow-x: ${o.overflowX})`);
          }
        }
        if (f.covered.length) {
          console.log('    content under the fixed ocean footer at the end of the page:');
          for (const o of f.covered.slice(0, 5)) {
            console.log(`      <${o.tag}> "${o.text}" covered by ${o.overlap}px`);
          }
        }
      }
      console.log(`\nFailure screenshots: ${outDir}`);
      process.exitCode = 1;
    } else if (errored.length) {
      // Nothing was found to be broken, but not everything was looked at.
      // Saying "all clear" here would be the sweep reporting a result it does
      // not have.
      console.log(`\n${errored.length} route(s) could not be probed; the rest are clear.`);
      process.exitCode = 1;
    } else {
      console.log('\nAll clear — every route rendered its page, with no horizontal overflow, no child escaping its parent, nothing under the ocean footer.');
      if (zoom !== 100) console.log('Synthetic full-page zoom reflow passed; physical browser keyboard and mobile safe-area behavior require their separate device checks.');
      if (!configuredOutput) rmSync(outDir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(err instanceof UsageError ? 2 : 1);
  });
}
