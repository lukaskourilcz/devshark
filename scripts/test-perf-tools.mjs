// Contracts of the read-only performance tools (#630). No case launches a
// browser or sends a request: the CI tests job installs no Playwright browser,
// so every run points CHROME_BIN at a file that does not exist and --url at a
// port nothing listens on.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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
