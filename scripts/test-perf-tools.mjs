// Contracts of the read-only performance tools (#630). No case launches a
// browser or sends a request: the CI tests job installs no Playwright browser,
// so every run points CHROME_BIN at a file that does not exist and --url at a
// port nothing listens on.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as lighthouse from './audit-performance.mjs';
import * as bundle from './check-bundle.mjs';
import * as lab from './measure-web-performance.mjs';
import { parseArgs, resolveOptions, UsageError } from './measure-web-performance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const measure = join(root, 'scripts/measure-web-performance.mjs');
const closedOrigin = 'http://127.0.0.1:9';
const translations = readFileSync(join(root, 'client/src/i18n/translations.ts'), 'utf8');

// The English label the app renders for a translation key.
function label(key) {
  const match = translations.match(new RegExp(`'${key.replaceAll('.', '\\.')}': '([^']*)'`));
  assert.ok(match, `client/src/i18n/translations.ts defines ${key}`);
  return match[1];
}

function runMeasure(t, flags, { url = closedOrigin } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'devshark-perf-tools-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'lab.json');
  const result = spawnSync(process.execPath, [measure, ...(url ? [`--url=${url}`] : []), ...flags, `--output=${output}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CHROME_BIN: join(scratch, 'no-such-chrome') },
  });
  return { ...result, output };
}

for (const [name, flags, mention] of [
  ['a sample count that is not a number', ['--samples=abc'], /--samples/],
  ['zero samples', ['--samples=0'], /--samples/],
  ['a profile it has no viewport for', ['--profiles=tablet'], /--profiles/],
  ['a route without a leading slash', ['--routes=learn'], /--routes/],
  ['a misspelt flag', ['--sample=3'], /--sample\b/],
]) {
  test(`perf:measure refuses ${name} before it launches a browser`, (t) => {
    const run = runMeasure(t, flags);
    assert.equal(run.error, undefined, 'the process ran to its end');
    assert.equal(run.status, 2, `exit code 2 (stderr: ${run.stderr.trim()})`);
    assert.match(run.stderr, /Usage: /);
    assert.match(run.stderr, mention);
    assert.equal(existsSync(run.output), false, 'a refused run writes no lab file');
  });
}

test('perf:measure reads a bare switch as on and splits a value at its first =', () => {
  const args = parseArgs(['--fixture', '--url=https://devshark.app/?a=b', '--samples=3', '--routes=/quiz?mode=a=b,/learn']);
  assert.deepEqual(args, { fixture: true, url: 'https://devshark.app/?a=b', samples: '3', routes: '/quiz?mode=a=b,/learn' });
  const options = resolveOptions(args);
  assert.equal(options.fixture, true);
  assert.equal(options.origin, 'https://devshark.app');
  assert.deepEqual(options.routes, ['/quiz?mode=a=b', '/learn']);
  assert.equal(options.samples, 3);
});

test('perf:measure refuses flags it cannot read', () => {
  for (const argv of [['--url'], ['--fixture=1'], ['--samples=3', '--samples=4'], ['learn'], ['--routes=/,'], ['--profiles=mobile,mobile'], ['--url=ftp://example.test'], ['--routes=//example.test'], ['--samples=1e1']]) {
    assert.throws(() => resolveOptions(parseArgs(argv)), UsageError, argv.join(' '));
  }
});

test('perf:measure needs --url, so a bare run never loads production', (t) => {
  const run = runMeasure(t, ['--routes=/', '--samples=1'], { url: null });
  assert.equal(run.error, undefined, 'the process ran to its end');
  assert.equal(run.status, 2, `exit code 2 (stderr: ${run.stderr.trim()})`);
  assert.match(run.stderr, /--url/);
  assert.match(run.stderr, /Usage: /);
  assert.equal(existsSync(run.output), false, 'a refused run writes no lab file');
});

test('perf:measure defaults to the Epic F routes, three samples and a lab file under artifacts/', () => {
  const options = resolveOptions(parseArgs(['--url=http://127.0.0.1:4211']));
  assert.deepEqual(options.routes, ['/', '/learn', '/coding', '/quiz', '/daily', '/premium', '/topics/javascript-closures', '/leaderboard']);
  assert.equal(options.samples, 3);
  assert.deepEqual(options.profiles, ['mobile', 'desktop']);
  assert.equal(options.output, 'artifacts/performance/web-lab.json');
});

test('perf:measure presses a button the app renders at each profile width', () => {
  assert.ok(lab.INTERACTION_CONTROLS, 'perf:measure names the buttons it presses per profile');
  // The menu button is display:none from 1024px (app-shell.css), so the 1440px
  // desktop profile presses the footer theme toggle, which names the mode it
  // switches to.
  assert.deepEqual(lab.INTERACTION_CONTROLS.mobile, [label('nav.menu')]);
  assert.deepEqual(lab.INTERACTION_CONTROLS.desktop, [label('footer.darkMode'), label('footer.lightMode')]);
  assert.deepEqual(Object.keys(lab.INTERACTION_CONTROLS), lab.PROFILES);
});

test('perf:measure loads pages without reduced motion unless --reduced-motion asks for it', () => {
  assert.equal(typeof lab.contextOptions, 'function', 'perf:measure builds each browser context in contextOptions');
  // Under 'reduce', client/src/lib/motion.tsx never loads the motion-features
  // chunk, so a forced setting measures a lighter page than a default visitor gets.
  const plain = resolveOptions(parseArgs(['--url=http://127.0.0.1:4211']));
  for (const profile of lab.PROFILES) assert.equal(lab.contextOptions(profile, plain).reducedMotion, 'no-preference', profile);
  const reduced = resolveOptions(parseArgs(['--url=http://127.0.0.1:4211', '--reduced-motion']));
  for (const profile of lab.PROFILES) assert.equal(lab.contextOptions(profile, reduced).reducedMotion, 'reduce', profile);
  assert.throws(() => parseArgs(['--reduced-motion=no']), UsageError);
});

test('perf:measure counts TTFB from navigation start and keeps the server wait beside it', () => {
  // A navigation entry with a redirect, DNS, TCP and TLS before the request.
  const entry = { redirectStart: 1, redirectEnd: 31, domainLookupStart: 31, domainLookupEnd: 51, connectStart: 51, secureConnectionStart: 71, connectEnd: 101, requestStart: 102, responseStart: 182, responseEnd: 230, domContentLoadedEventEnd: 640, loadEventEnd: 900 };
  const timings = lab.navigationTimings(entry);
  assert.equal(timings.ttfb, 182, 'web-vitals TTFB is responseStart');
  assert.equal(timings.serverWait, 80, 'the server wait is responseStart minus requestStart');
  assert.deepEqual([timings.redirect, timings.dns, timings.connect, timings.tls, timings.download], [30, 20, 50, 30, 48]);
  assert.deepEqual([timings.domContentLoaded, timings.load], [640, 900]);
  assert.equal(lab.navigationTimings({ ...entry, secureConnectionStart: 0 }).tls, 0, 'plain http has no TLS time');
});

test('perf:measure turns EventTiming entries into one INP value per sample', () => {
  assert.equal(typeof lab.summarizeInteractions, 'function', 'perf:measure computes INP in summarizeInteractions');
  // One press arrives as three entries that share an interactionId; the
  // pointermove before it has none.
  const press = [
    { name: 'pointermove', interactionId: 0, startTime: 900, processingStart: 901, processingEnd: 902, duration: 24 },
    { name: 'pointerdown', interactionId: 7, startTime: 1000, processingStart: 1004, processingEnd: 1010, duration: 56 },
    { name: 'pointerup', interactionId: 7, startTime: 1080, processingStart: 1082, processingEnd: 1090, duration: 64 },
    { name: 'click', interactionId: 7, startTime: 1080, processingStart: 1090, processingEnd: 1130, duration: 80 },
  ];
  assert.deepEqual(lab.summarizeInteractions(press, { pressed: true }), {
    inpMs: 80,
    interactionCount: 1,
    inpParts: { event: 'click', inputDelay: 10, processing: 40, presentation: 30 },
  });
  // Entries painted in one frame tie on duration: the first names the
  // interaction, and the click handler beside it counts as processing.
  const oneFrame = [
    { name: 'pointerdown', interactionId: 3, startTime: 1000, processingStart: 1007, processingEnd: 1014, duration: 224 },
    { name: 'pointerup', interactionId: 3, startTime: 1002, processingStart: 1014, processingEnd: 1020, duration: 224 },
    { name: 'click', interactionId: 3, startTime: 1003, processingStart: 1020, processingEnd: 1060, duration: 224 },
  ];
  assert.deepEqual(lab.summarizeInteractions(oneFrame, { pressed: true }), {
    inpMs: 224,
    interactionCount: 1,
    inpParts: { event: 'pointerdown,pointerup,click', inputDelay: 7, processing: 53, presentation: 164 },
  });
  // A press under the 16 ms threshold leaves no entry: fast, and measured.
  assert.deepEqual(lab.summarizeInteractions([], { pressed: true }), { inpMs: '<16', interactionCount: 0, inpParts: null });
  // No press, no value: a row that pressed nothing must not read as fast.
  assert.deepEqual(lab.summarizeInteractions([], { pressed: false }), { inpMs: null, interactionCount: 0, inpParts: null });
  // From 50 interactions on, web-vitals skips the longest one per 50.
  const many = Array.from({ length: 60 }, (_, i) => ({ name: 'click', interactionId: i + 1, startTime: i * 100, processingStart: i * 100, processingEnd: i * 100, duration: 16 + i }));
  const summary = lab.summarizeInteractions(many, { pressed: true });
  assert.equal(summary.interactionCount, 60);
  assert.equal(summary.inpMs, 74, 'the second-longest of 60 interactions');
});

test('perf:measure reports CLS as the largest session window of layout shifts', () => {
  assert.equal(typeof lab.summarizeLayoutShifts, 'function', 'perf:measure computes CLS in summarizeLayoutShifts');
  // Shifts at 0 and 500 ms share a window; 3000 ms is more than 1 s after
  // the last one and opens a second window. CLS is the larger window, not
  // the 0.875 sum the lab reported before.
  const shifts = [
    { startTime: 0, value: 0.25, hadRecentInput: false },
    { startTime: 500, value: 0.125, hadRecentInput: false },
    { startTime: 3000, value: 0.5, hadRecentInput: false },
  ];
  assert.deepEqual(lab.summarizeLayoutShifts(shifts), { cls: 0.5, clsSum: 0.875, clsInputFlagged: 0 });
  // A window ends 5 s after its first shift, however close the shifts sit.
  const steady = Array.from({ length: 7 }, (_, i) => ({ startTime: i * 900, value: 0.0625, hadRecentInput: false }));
  assert.deepEqual(lab.summarizeLayoutShifts(steady), { cls: 0.375, clsSum: 0.4375, clsInputFlagged: 0 });
  // A shift Chromium flags as recent input counts in clsInputFlagged only.
  // It cannot bridge two windows either: 0 and 1200 ms sit 1.2 s apart.
  const flagged = [
    { startTime: 0, value: 0.25, hadRecentInput: false },
    { startTime: 600, value: 0.5, hadRecentInput: true },
    { startTime: 1200, value: 0.125, hadRecentInput: false },
  ];
  assert.deepEqual(lab.summarizeLayoutShifts(flagged), { cls: 0.25, clsSum: 0.375, clsInputFlagged: 0.5 });
  assert.deepEqual(lab.summarizeLayoutShifts([]), { cls: 0, clsSum: 0, clsInputFlagged: 0 });
});

test('perf:measure sums blocking time over long tasks from FCP to the measurement point', () => {
  assert.equal(typeof lab.summarizeLongTasks, 'function', 'perf:measure computes TBT in summarizeLongTasks');
  const window = { fcp: 1000, end: 5000 };
  // 40 ms blocks nothing; 80 and 120 ms block 30 and 70 ms.
  const afterPaint = [
    { startTime: 1200, duration: 40 },
    { startTime: 1500, duration: 80 },
    { startTime: 2500, duration: 120 },
  ];
  assert.deepEqual(lab.summarizeLongTasks(afterPaint, window), { longTasks: { count: 2, longest: 120 }, tbtMs: 100 });
  // A task that ends before FCP counts as a long task but blocks nothing;
  // one that spans FCP or the measurement point counts only its part
  // inside: 900 + 180 ms keeps 80 ms (30 blocked), 4950 + 300 ms keeps 50 (0).
  const edges = [
    { startTime: 300, duration: 200 },
    { startTime: 900, duration: 180 },
    ...afterPaint,
    { startTime: 4950, duration: 300 },
  ];
  assert.deepEqual(lab.summarizeLongTasks(edges, window), { longTasks: { count: 5, longest: 300 }, tbtMs: 130 });
  // No contentful paint, no TBT window.
  assert.deepEqual(lab.summarizeLongTasks(afterPaint, { fcp: null, end: 5000 }), { longTasks: { count: 2, longest: 120 }, tbtMs: null });
  assert.deepEqual(lab.summarizeLongTasks([], window), { longTasks: { count: 0, longest: 0 }, tbtMs: 0 });
});

test('perf:measure names the LCP element of a row in one short line', () => {
  assert.equal(typeof lab.formatLcpElement, 'function', 'perf:measure formats lcpElement for its log line');
  const banner = { tag: 'p', id: '_r_4_', classes: ['ss-consent__body'], container: 'section.ss-consent', size: 21000, url: null };
  assert.equal(lab.formatLcpElement(banner), 'section.ss-consent p#_r_4_.ss-consent__body');
  const hero = { tag: 'img', id: null, classes: ['hero__art', 'is-wide'], container: 'main.page', size: 90000, url: 'http://127.0.0.1:4211/hero.webp' };
  assert.equal(lab.formatLcpElement(hero), 'main.page img.hero__art.is-wide http://127.0.0.1:4211/hero.webp');
  assert.equal(lab.formatLcpElement({ tag: null, id: null, classes: [], container: null, size: 400, url: null }), '(detached)');
  assert.equal(lab.formatLcpElement(null), 'none');
});

test('perf:measure loads the repeat row as a returning visitor who pressed Reject all', () => {
  assert.equal(typeof lab.rejectedConsent, 'function', 'perf:measure builds the stored choice in rejectedConsent');
  // client/src/lib/consent.ts reads the choice from this key, for this
  // version, in the four fields persist() writes.
  const consent = readFileSync(join(root, 'client/src/lib/consent.ts'), 'utf8');
  const key = consent.match(/export const CONSENT_STORAGE_KEY = '([^']+)';/);
  const version = consent.match(/export const CONSENT_VERSION = (\d+);/);
  assert.ok(key && version, 'client/src/lib/consent.ts names its storage key and version');
  assert.equal(lab.CONSENT_STORAGE_KEY, key[1]);
  assert.deepEqual(lab.rejectedConsent(1_763_424_000_000), { version: Number(version[1]), analytics: false, marketing: false, decidedAt: 1_763_424_000_000 });
  // A first visit always sees the banner; the repeat row has answered it
  // unless --consent=undecided keeps the banner for older comparisons.
  const plain = resolveOptions(parseArgs(['--url=http://127.0.0.1:4211']));
  assert.equal(plain.consent, 'rejected');
  assert.deepEqual(lab.consentByCache(plain.consent), { 'cold-browser': 'undecided', 'repeat-browser': 'rejected' });
  const undecided = resolveOptions(parseArgs(['--url=http://127.0.0.1:4211', '--consent=undecided']));
  assert.deepEqual(lab.consentByCache(undecided.consent), { 'cold-browser': 'undecided', 'repeat-browser': 'undecided' });
  // Accepting would load PostHog and send a lab run's events to it.
  for (const value of ['accepted', '']) assert.throws(() => resolveOptions(parseArgs(['--url=http://127.0.0.1:4211', `--consent=${value}`])), UsageError, value);
});

test('perf:measure replays only the anonymous API reads on its list', () => {
  assert.equal(typeof lab.replayableRead, 'function', 'perf:measure decides what --api-origin answers in replayableRead');
  const read = (path) => lab.replayableRead(new URL(path, 'http://127.0.0.1:4211'));
  for (const path of [
    '/api/settings',
    '/api/quiz/roadmap',
    '/api/quiz/roadmap?resource=learning-path-catalog',
    '/api/quiz/roadmap?resource=lesson&id=html-basics-1',
    '/api/quiz/daily?qotd=2026-11-18',
    '/api/quiz/questions?resource=curation',
    '/api/quiz/challenge?resource=leaderboard&categories=html,css',
    '/api/leaderboard?period=week&subject=webdev',
  ]) assert.equal(read(path), true, path);
  // The caller's own rows, a quiz batch, or any read the list does not name
  // gets the fixture 503.
  for (const path of [
    '/api/leaderboard?period=30d&me=1',
    '/api/quiz/roadmap?resource=progress',
    '/api/quiz/roadmap?topic=html',
    '/api/quiz/roadmap?resource=lesson&id=html-basics-1&level=2',
    '/api/quiz/daily?categories=html',
    '/api/quiz/questions?count=10',
    '/api/quiz/challenge?categories=html',
    '/api/user/stats',
    '/api/settings?fresh=1',
    '/api/flashcards?subject=webdev',
  ]) assert.equal(read(path), false, path);
});

test('perf:measure takes --api-origin as an https or loopback origin with a bounded delay', () => {
  const base = ['--url=http://127.0.0.1:4211'];
  const plain = resolveOptions(parseArgs(base));
  assert.equal(plain.apiOrigin, null, 'no replay unless asked');
  const replay = resolveOptions(parseArgs([...base, '--api-origin=https://devshark.app']));
  assert.equal(replay.apiOrigin, 'https://devshark.app');
  assert.equal(replay.apiDelayMs, 120, 'the API delay of the #587 walk');
  assert.equal(resolveOptions(parseArgs([...base, '--api-origin=http://127.0.0.1:3000', '--api-delay-ms=0'])).apiDelayMs, 0);
  for (const flags of [
    ['--api-origin=http://devshark.app'],
    ['--api-origin=https://devshark.app/api'],
    ['--api-origin=https://user:secret@devshark.app'],
    ['--api-origin=devshark.app'],
    ['--api-delay-ms=50'],
    ['--api-origin=https://devshark.app', '--api-delay-ms=-1'],
    ['--api-origin=https://devshark.app', '--api-delay-ms=10001'],
  ]) assert.throws(() => resolveOptions(parseArgs([...base, ...flags])), UsageError, flags.join(' '));
});

test('perf:measure takes the middle sample as the median and drops missing values', () => {
  assert.equal(typeof lab.median, 'function', 'perf:measure exports its median helper');
  assert.equal(lab.median([640, 512, 2200]), 640, 'three samples: the middle one');
  assert.equal(lab.median([4, 1, 3, 2]), 2, 'an even count takes the lower middle value, one a sample measured');
  assert.equal(lab.median([null, 7, undefined]), 7);
  assert.equal(lab.median([]), null);
  assert.equal(lab.median([null]), null);
  // A press under 16 ms sorts below every measured INP.
  const byInp = (a, b) => (a === '<16' ? -1 : a) - (b === '<16' ? -1 : b);
  assert.equal(lab.median(['<16', 40, '<16'], byInp), '<16');
  assert.equal(lab.median([88, '<16', 40], byInp), 40);
});

test('perf:measure counts each request under one kind', () => {
  const origin = 'https://devshark.app';
  const kind = (resourceType, path, options) => lab.requestKind(resourceType, new URL(path, origin), origin, options);
  assert.equal(kind('Document', '/learn'), 'document');
  assert.equal(kind('Script', '/assets/index-abc.js'), 'script');
  assert.equal(kind('Stylesheet', '/assets/index-abc.css'), 'stylesheet');
  assert.equal(kind('Font', '/fonts/inter.woff2'), 'font');
  assert.equal(kind('Image', '/brand/v9/fin.svg'), 'image');
  assert.equal(kind('Fetch', '/api/settings'), 'api', 'an API read counts as api whoever answers it');
  assert.equal(kind('XHR', '/api/quiz/roadmap'), 'api');
  assert.equal(kind('Manifest', '/manifest.webmanifest'), 'other');
  assert.equal(lab.requestKind('Fetch', new URL('https://eu.i.posthog.com/api/e'), origin), 'other', 'another origin\'s /api/ is not the app\'s API');
  assert.equal(kind('Fetch', '/api/user/stats', { blocked: true }), 'blocked', 'a request the lab failed counts as blocked only');
  const counts = lab.emptyRequestCounts();
  assert.deepEqual(Object.keys(counts), [...lab.REQUEST_KINDS, 'sent', 'sentApi']);
  assert.equal(lab.requestCount({ ...counts, script: 27, api: 1, blocked: 2, sent: 30, sentApi: 1 }), 30, 'sent and sentApi are not kinds');
});

test('perf:measure summarizes each profile, path and cache state with request totals', () => {
  const requests = (script, sent) => ({ ...lab.emptyRequestCounts(), document: 1, script, api: 1, sent, sentApi: 1 });
  const row = (sample, cache, lcp, extra = {}) => ({ profile: 'mobile', path: '/', sample, cache, navigation: { ttfb: 100 + sample }, fcp: lcp - 100, lcp, lcpElement: { tag: 'h1', id: null, classes: [`s${sample}`], container: null, size: 1, url: null }, cls: sample / 100, tbtMs: sample * 10, inpMs: 40 + sample, requests: requests(30 + sample, 31 + sample), ...extra });
  const results = [
    row(0, 'cold-browser', 2400),
    row(0, 'repeat-browser', 700),
    row(1, 'cold-browser', 2100, { inpMs: '<16' }),
    row(1, 'repeat-browser', 650),
    // A failed cold row: the repeat row of that sample never loaded.
    { profile: 'mobile', path: '/', sample: 2, cache: 'cold-browser', error: 'timeout', requests: requests(3, 2) },
    // A failed setup on another route: neither row loaded.
    { profile: 'desktop', path: '/learn', sample: 0, cache: null, error: 'net::ERR_CONNECTION_REFUSED' },
  ];
  const summary = lab.summarizeRows(results);
  assert.deepEqual(summary.map(({ profile, path, cache, samples, errors }) => [profile, path, cache, samples, errors]), [
    ['mobile', '/', 'cold-browser', 2, 1],
    ['mobile', '/', 'repeat-browser', 2, 1],
    ['desktop', '/learn', 'cold-browser', 0, 1],
    ['desktop', '/learn', 'repeat-browser', 0, 1],
  ]);
  const [cold] = summary;
  assert.equal(cold.lcpMs, 2100, 'the lower middle of two samples');
  assert.equal(cold.lcpElement, 'h1.s1', 'the LCP element of the median-LCP sample');
  assert.deepEqual([cold.ttfbMs, cold.fcpMs, cold.cls, cold.tbtMs, cold.inpMs, cold.requests], [100, 2000, 0, 0, '<16', 32]);
  assert.deepEqual(summary[2], { profile: 'desktop', path: '/learn', cache: 'cold-browser', samples: 0, errors: 1, ttfbMs: null, fcpMs: null, lcpMs: null, lcpElement: null, cls: null, tbtMs: null, inpMs: null, requests: null });
  // The failed cold row's requests still reached the origin and count.
  assert.deepEqual(lab.requestTotals(results, { forwarded: 4 }), { requests: 2 * 32 + 2 * 33 + 5, api: 5, sent: 31 + 32 + 31 + 32 + 2, sentApi: 5, forwarded: 4 });
});

const audit = join(root, 'scripts/audit-performance.mjs');

// Runs audit:performance with Chrome pointed at a file that does not exist,
// so a run that gets past its flag checks fails at once instead of loading a page.
function runAudit(t, flags, { url = closedOrigin } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'devshark-audit-tools-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'performance');
  const result = spawnSync(process.execPath, [audit, ...(url ? [`--url=${url}`] : []), ...flags, `--output=${output}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CHROME_PATH: join(scratch, 'no-such-chrome') },
  });
  return { ...result, output };
}

for (const [name, flags, mention, url] of [
  ['a misspelt flag', ['--route=/learn'], /--route\b/],
  ['a route without a leading slash', ['--routes=learn'], /--routes/],
  ['two routes that share a report name', ['--routes=/learn,/learn/'], /--routes/],
  ['zero runs', ['--runs=0'], /--runs/],
  ['more runs than it allows', ['--runs=11'], /--runs/],
  ['a stray argument', ['learn'], /learn/],
  ['a URL it cannot load', [], /--url/, 'ftp://example.test'],
]) {
  test(`audit:performance refuses ${name} before it creates the output folder`, (t) => {
    const run = runAudit(t, flags, { url });
    assert.equal(run.error, undefined, 'the process ran to its end');
    assert.equal(run.status, 2, `exit code 2 (stderr: ${run.stderr.trim()})`);
    assert.match(run.stderr, /Usage: /);
    assert.match(run.stderr, mention);
    assert.equal(existsSync(run.output), false, 'a refused run creates no output folder');
  });
}

test('audit:performance names each route\'s reports after its path', () => {
  assert.equal(lighthouse.routeSlug('/'), 'home');
  assert.equal(lighthouse.routeSlug('/learn'), 'learn');
  assert.equal(lighthouse.routeSlug('/learn/'), 'learn');
  assert.equal(lighthouse.routeSlug('/topics/javascript-closures'), 'topics-javascript-closures');
  assert.equal(lighthouse.routeSlug('/quiz?mode=daily'), 'quiz-mode_daily', 'a query stays apart from the path');
});

test('audit:performance keeps CI\'s single page without --routes and resolves routes against --url', () => {
  const plain = lighthouse.resolveOptions({});
  assert.deepEqual(plain, { url: 'http://localhost:4173', output: 'artifacts/performance', pages: [{ route: '/', url: 'http://localhost:4173', slug: null }], runs: 1 });
  const routes = lighthouse.resolveOptions({ url: 'https://devshark.app/learn', routes: '/,/topics/javascript-closures' });
  assert.deepEqual(routes.pages, [
    { route: '/', url: 'https://devshark.app/', slug: 'home' },
    { route: '/topics/javascript-closures', url: 'https://devshark.app/topics/javascript-closures', slug: 'topics-javascript-closures' },
  ]);
  for (const value of ['learn', '//example.test', '/,', '/learn,/learn']) {
    assert.throws(() => lighthouse.resolveOptions({ routes: value }), UsageError, value);
  }
});

// A Lighthouse report with the fields audit:performance reads, and nothing else.
function fakeReport({ performance = 0.9, lcp = 2000, cls = 0, tbt = 100, runtimeError } = {}) {
  return {
    finalDisplayedUrl: 'http://127.0.0.1:9/', fetchTime: '2026-11-18T12:00:00.000Z', lighthouseVersion: '13.4.1', runWarnings: [],
    ...(runtimeError && { runtimeError }),
    categories: { performance: { score: performance }, accessibility: { score: 1 } },
    audits: {
      'largest-contentful-paint': { numericValue: lcp },
      'cumulative-layout-shift': { numericValue: cls },
      'total-blocking-time': { numericValue: tbt },
      'total-byte-weight': { numericValue: 400000 },
    },
  };
}

// Runs audit:performance's main in this process with a stand-in for
// Lighthouse: answer(profile, route, call) returns a report to write and
// exit 0, a number to exit with and write nothing, or [status, report].
function auditWith(t, pages, answer, options = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'devshark-audit-main-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'performance');
  for (const method of ['table', 'log', 'warn', 'error']) t.mock.method(console, method, () => {});
  t.mock.method(process, 'exit', (code) => { throw new Error(`process.exit(${code})`); });
  const calls = [];
  const fake = (url, profile, prefix) => {
    const route = pages.find((page) => page.url === url).route;
    calls.push({ profile, route, prefix });
    const reply = answer(profile, route, calls.length);
    const [status, report] = Array.isArray(reply) ? reply : typeof reply === 'number' ? [reply, null] : [0, reply];
    if (report) writeFileSync(`${prefix}.report.json`, JSON.stringify(report));
    return status;
  };
  const prepare = options.prepare ?? (() => {});
  mkdirSync(output, { recursive: true });
  prepare(output);
  const results = lighthouse.main({ output, pages, runs: options.runs ?? 1 }, { lighthouse: fake });
  return { results, calls, output, summary: JSON.parse(readFileSync(join(output, 'summary.json'), 'utf8')) };
}

const homePage = [{ route: '/', url: 'http://127.0.0.1:9', slug: null }];

test('audit:performance keeps going when one Lighthouse run fails and records the failure', (t) => {
  // A report an earlier run left behind must not stand in for a failed run.
  const prepare = (output) => writeFileSync(join(output, 'mobile.report.json'), JSON.stringify(fakeReport({ lcp: 1 })));
  const run = auditWith(t, homePage, (profile) => (profile === 'mobile' ? 1 : fakeReport({ lcp: 900 })), { prepare });
  assert.deepEqual(run.calls.map((call) => call.profile), ['mobile', 'desktop'], 'the desktop audit still runs');
  assert.deepEqual(run.results[0], { profile: 'mobile', route: '/', requestedUrl: 'http://127.0.0.1:9', run: 1, error: 'Lighthouse exited with code 1' });
  assert.equal(run.results[1].lcpMs, 900);
  assert.deepEqual(run.summary, run.results, 'summary.json holds the finished row and the error row');
  assert.equal(existsSync(join(run.output, 'mobile.report.json')), false, 'the stale report is gone');
});

test('audit:performance records a Lighthouse runtime error as an error row', (t) => {
  const runtimeError = { code: 'ERRORED_DOCUMENT_REQUEST', message: 'Lighthouse was unable to reliably load the page you requested.' };
  const run = auditWith(t, homePage, (profile) => (profile === 'desktop' ? [1, fakeReport({ runtimeError })] : fakeReport()));
  assert.equal(run.results[0].error, undefined);
  assert.deepEqual(run.results[1], { profile: 'desktop', route: '/', requestedUrl: 'http://127.0.0.1:9', run: 1, error: `${runtimeError.code}: ${runtimeError.message}` });
  assert.deepEqual(run.summary, run.results);
});

test('audit:performance keeps every run\'s report and summarizes the runs of each profile and page', (t) => {
  const pages = [{ route: '/learn', url: 'http://127.0.0.1:9/learn', slug: 'learn' }];
  // Mobile LCP per run: 3000, 2600, 4100; the second desktop run fails.
  const lcps = [3000, 2600, 4100];
  const run = auditWith(t, pages, (profile, route, call) => {
    if (profile === 'mobile') return fakeReport({ performance: [0.8, 0.9, 0.6][call - 1], lcp: lcps[call - 1], cls: 0.01 * call, tbt: 100 * call });
    return call === 5 ? 1 : fakeReport({ performance: 0.99, lcp: 800, tbt: 0 });
  }, { runs: 3 });
  assert.deepEqual(run.calls.map((call) => call.prefix.slice(run.output.length + 1)), ['mobile-learn-run1', 'mobile-learn-run2', 'mobile-learn-run3', 'desktop-learn-run1', 'desktop-learn-run2', 'desktop-learn-run3']);
  assert.equal(run.results.length, 6, 'main returns every audit');
  assert.deepEqual(run.summary.map(({ profile, route, runs, failed }) => [profile, route, runs, failed]), [['mobile', '/learn', 3, 0], ['desktop', '/learn', 3, 1]]);
  const [mobile, desktop] = run.summary;
  const unread = { fcpMs: null, speedIndexMs: null, benchmarkIndex: null };
  assert.deepEqual(mobile.median, { performance: 0.8, lcpMs: 3000, cls: 0.02, tbtMs: 200, ...unread });
  assert.deepEqual(mobile.min, { performance: 0.6, lcpMs: 2600, cls: 0.01, tbtMs: 100, ...unread });
  assert.deepEqual(mobile.max, { performance: 0.9, lcpMs: 4100, cls: 0.03, tbtMs: 300, ...unread });
  assert.deepEqual(mobile.results.map((row) => row.run), [1, 2, 3]);
  assert.deepEqual(desktop.median, { performance: 0.99, lcpMs: 800, cls: 0, tbtMs: 0, ...unread }, 'the median of the two finished runs');
  assert.equal(desktop.results[1].error, 'Lighthouse exited with code 1');
});

test('audit:performance summarizes a page whose runs all failed with empty statistics', () => {
  const rows = [1, 2].map((run) => ({ profile: 'mobile', route: '/', requestedUrl: 'http://127.0.0.1:9', run, error: 'Lighthouse exited with code 1' }));
  const [summary] = lighthouse.summarize(rows, 2);
  const empty = { performance: null, fcpMs: null, lcpMs: null, speedIndexMs: null, cls: null, tbtMs: null, benchmarkIndex: null };
  assert.deepEqual(summary, { profile: 'mobile', route: '/', requestedUrl: 'http://127.0.0.1:9', runs: 2, failed: 2, median: empty, min: empty, max: empty, results: rows });
  assert.equal(lighthouse.summarize(rows, 1), rows, 'one run per profile keeps one row per audit');
});

test('audit:performance reads the LCP element, FCP, Speed Index, requests and machine speed from a report', () => {
  const report = fakeReport({ lcp: 3800 });
  report.audits['first-contentful-paint'] = { numericValue: 2700 };
  report.audits['speed-index'] = { numericValue: 2900 };
  report.audits['network-requests'] = { details: { items: Array.from({ length: 49 }, (_, i) => ({ url: `/assets/${i}.js` })) } };
  // The shape Lighthouse 13 writes: a subpart table, then the node.
  report.audits['lcp-breakdown-insight'] = { details: { type: 'list', items: [
    { type: 'table', items: [{ subpart: 'timeToFirstByte', label: 'Time to first byte', duration: 12.6 }, { subpart: 'elementRenderDelay', label: 'Element render delay', duration: 167.2 }] },
    { type: 'node', selector: 'section.ss-consent > div.ss-consent__inner > div.ss-consent__copy > p#_r_4_', nodeLabel: 'devShark keeps what sign-in, settings and progress need', snippet: '<p id="_r_4_">' },
  ] } };
  report.environment = { benchmarkIndex: 2482.5 };
  report.configSettings = { throttlingMethod: 'simulate', throttling: { rttMs: 150, cpuSlowdownMultiplier: 4 } };
  const row = lighthouse.reportRow(report);
  assert.deepEqual(row.lcpElement, {
    selector: 'section.ss-consent > div.ss-consent__inner > div.ss-consent__copy > p#_r_4_',
    nodeLabel: 'devShark keeps what sign-in, settings and progress need',
    subparts: { timeToFirstByte: 12.6, elementRenderDelay: 167.2 },
  });
  assert.deepEqual([row.fcpMs, row.lcpMs, row.speedIndexMs, row.requestCount, row.benchmarkIndex, row.throttlingMethod], [2700, 3800, 2900, 49, 2482.5, 'simulate']);
  assert.deepEqual(row.throttling, { rttMs: 150, cpuSlowdownMultiplier: 4 });
  // A report without these audits still gives a row, with null in their place.
  const bare = lighthouse.reportRow(fakeReport());
  assert.deepEqual([bare.fcpMs, bare.speedIndexMs, bare.lcpElement, bare.requestCount, bare.benchmarkIndex, bare.throttlingMethod, bare.throttling], [null, null, null, null, null, null, null]);
});

test('check:bundle budgets the entry, modulepreload and stylesheet requests and lists preloaded fonts apart', () => {
  // The tags a Vite build of client/index.html writes, in any attribute order.
  const html = `<!doctype html><html><head>
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/manrope-latin-wght-normal-A1.woff2" />
    <link href="/assets/inter-latin-wght-normal-B2.woff2" crossorigin as="font" rel="preload">
    <link rel="preconnect" href="https://eu.i.posthog.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
    <script type="module" crossorigin src="/assets/main-C3.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-D4.js">
    <link rel="modulepreload" crossorigin href="/assets/react-D4.js">
    <link rel="stylesheet" crossorigin href="/assets/main-E5.css">
    <link rel="icon" href="/assets/favicon-F6.svg">
    <script type="module" src="https://cdn.example.test/G7.js"></script>
  </head><body></body></html>`;
  assert.deepEqual(bundle.initialRequests(html), {
    files: ['assets/main-C3.js', 'assets/react-D4.js', 'assets/main-E5.css'],
    fonts: ['assets/manrope-latin-wght-normal-A1.woff2', 'assets/inter-latin-wght-normal-B2.woff2'],
  });
  assert.deepEqual(bundle.initialRequests('<html></html>'), { files: [], fonts: [] });
});

for (const [name, flag, mention] of [
  ['zero largest chunks', '--largest=0', /--largest must be a whole number from 1 to 100/],
  ['more largest chunks than it lists', '--largest=101', /--largest must be a whole number from 1 to 100/],
  ['a largest count that is not a number', '--largest=ten', /--largest must be a whole number from 1 to 100/],
  ['a misspelt flag', '--larges=3', /unknown argument "--larges=3"/],
]) {
  test(`check:bundle refuses ${name} before it starts a build`, () => {
    const run = spawnSync(process.execPath, [join(root, 'scripts/check-bundle.mjs'), flag], { cwd: root, encoding: 'utf8', timeout: 30_000 });
    assert.equal(run.error, undefined, 'the process ran to its end');
    assert.equal(run.status, 2, `exit code 2 (stderr: ${run.stderr.trim()})`);
    assert.match(run.stderr, mention);
    assert.match(run.stderr, /Usage: /);
    assert.equal(run.stdout, '', 'nothing built, nothing measured');
  });
}
