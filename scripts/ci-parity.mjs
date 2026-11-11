// Runs the `verify` job of .github/workflows/quality.yml on this machine, step
// by step, and reports each step's real result. The skill that explains it is
// .claude/skills/ci-parity-and-pr/SKILL.md.
//
//   npm run ci:parity                 the whole job: Storybook and browsers too
//   npm run ci:parity -- --fast       everything but the browser specs,
//                                     test:harness and Storybook/performance
//   npm run ci:parity -- --sql        also the `sql` job (needs DATABASE_URL
//                                     pointing at an empty Postgres)
//   npm run ci:parity -- --list       print the plan and exit
//   npm run ci:parity -- --only test:launch,build
//   npm run ci:parity -- --bail       stop at the first failure, as CI does
//   npm run ci:parity -- --install    run `npm ci` even when node_modules exist
//
// Before running anything the script compares its plan with the `verify` job.
// Every `npm` and `npx playwright` command there, in order and with its env
// prefix, must be a step here, and every other line of the job (the shell
// glue, env, conditions, setup) must match KNOWN_GLUE. When the workflow
// changes, the script stops with the difference instead of reporting a stale
// sequence as green.
//
// The steps run on the working tree. CI checks out only committed files, so a
// dirty tree is reported in the summary. A run that stops early still writes
// its summary, marked incomplete.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const WORKFLOW = '.github/workflows/quality.yml';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const FAST = flag('--fast');
const SQL = flag('--sql');
const BAIL = flag('--bail');
const LIST = flag('--list');
const FORCE_INSTALL = flag('--install');
const ONLY_RAW = option('--only');
const ONLY = args.includes('--only') ? (ONLY_RAW ?? '').split(',').map((one) => one.trim()).filter(Boolean) : undefined;
const LOG_DIR = path.resolve(option('--log-dir') ?? 'artifacts/ci-parity');

function usage(message) {
  console.error(message);
  process.exit(2);
}

if (!existsSync(WORKFLOW) || !existsSync('package.json')) usage('Run ci:parity from the repository root.');

// ---- What the workflow says ------------------------------------------------

const workflow = readFileSync(WORKFLOW, 'utf8');
// The verify gates are the jobs after `sql`, from `quickjs` to the `verify`
// job that requires them all; ci:parity runs them one after another.
const verifyStart = workflow.indexOf('\n  quickjs:');
if (verifyStart < 0 || !workflow.includes('\n  verify:')) usage(`${WORKFLOW} has no quickjs or verify job; update scripts/ci-parity.mjs.`);
const verifyJob = workflow.slice(verifyStart + 1);
const TOPIC = verifyJob.match(/^\s*TOPIC=(\S+)/m)?.[1] ?? '';
const QUICKJS_INPUTS = verifyJob.match(/git diff --quiet "\$QUICKJS_BASE_SHA" HEAD -- ([^;\n]+);/)?.[1].trim().split(/\s+/) ?? [];
const COMMAND = /^(?:[A-Z_]+=\S+\s+)*(?:npm |npx playwright )/;

/** Splits the verify jobs into their npm/npx commands and every other line.
 * A command an earlier job already ran (`npm ci`, the second build) is that
 * job's own setup, so it counts once. */
function readVerifyJob() {
  const commands = [];
  const seen = new Set();
  const glue = [];
  for (const raw of verifyJob.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.replace(/^-\s*/, '').replace(/^run:\s*\|?\s*/, '');
    const parts = body.split(/\s*&&\s*/);
    if (body && parts.every((part) => COMMAND.test(part))) {
      for (const part of parts) {
        const command = part.replace(/\s*>.*$/, '').replace(/\$TOPIC/g, TOPIC).trim();
        if (seen.has(command)) continue;
        seen.add(command);
        commands.push(command);
      }
    } else {
      glue.push(line);
    }
  }
  return { commands, glue };
}

// Every line of the verify jobs that is not an npm/npx command, in order. The
// plan below reproduces what these lines do; change both together.
const KNOWN_GLUE = [
  "quickjs:",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 30",
  "steps:",
  "- uses: actions/checkout@v4",
  "- uses: actions/setup-node@v4",
  "with:",
  "node-version: 24",
  "cache: npm",
  "cache-dependency-path: |",
  "package-lock.json",
  "client/package-lock.json",
  "- name: Rebuild modified QuickJS runtime from pinned sources",
  "env:",
  "QUICKJS_BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}",
  "run: |",
  "if [[ -n \"$QUICKJS_BASE_SHA\" && \"$QUICKJS_BASE_SHA\" != \"0000000000000000000000000000000000000000\" ]]; then",
  "[[ \"$QUICKJS_BASE_SHA\" =~ ^[a-f0-9]{40}$ ]] || exit 1",
  "git fetch --no-tags --depth=1 origin \"$QUICKJS_BASE_SHA\"",
  "if git diff --quiet \"$QUICKJS_BASE_SHA\" HEAD -- lib/coding/vendor lib/coding/quickjs-variant.ts scripts/rebuild-quickjs-sort.mjs package.json package-lock.json client/package-lock.json; then",
  "echo \"QuickJS inputs unchanged; required runtime integrity tests still run below.\"",
  "exit 0",
  "fi",
  "fi",
  "static:",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 30",
  "steps:",
  "- uses: actions/checkout@v4",
  "- uses: actions/setup-node@v4",
  "with:",
  "node-version: 24",
  "cache: npm",
  "cache-dependency-path: |",
  "package-lock.json",
  "client/package-lock.json",
  "- run: |",
  "VITE_SUPABASE_URL=$(node -p \"require('./docs/quality/bundle-budget.json').measuredBuild.env.VITE_SUPABASE_URL\")",
  "VITE_SUPABASE_ANON_KEY=$(node -p \"require('./docs/quality/bundle-budget.json').measuredBuild.env.VITE_SUPABASE_ANON_KEY\")",
  "export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY",
  "id: build",
  "env:",
  "VITE_PRODUCT: devshark",
  "VITE_LOCK_SUBJECT: webdev",
  "tests:",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 30",
  "steps:",
  "- uses: actions/checkout@v4",
  "- uses: actions/setup-node@v4",
  "with:",
  "node-version: 24",
  "cache: npm",
  "cache-dependency-path: |",
  "package-lock.json",
  "client/package-lock.json",
  "coding:",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 30",
  "steps:",
  "- uses: actions/checkout@v4",
  "- uses: actions/setup-node@v4",
  "with:",
  "node-version: 24",
  "cache: npm",
  "cache-dependency-path: |",
  "package-lock.json",
  "client/package-lock.json",
  "browser:",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 30",
  "steps:",
  "- uses: actions/checkout@v4",
  "- uses: actions/setup-node@v4",
  "with:",
  "node-version: 24",
  "cache: npm",
  "cache-dependency-path: |",
  "package-lock.json",
  "client/package-lock.json",
  "- run: |",
  "VITE_SUPABASE_URL=$(node -p \"require('./docs/quality/bundle-budget.json').measuredBuild.env.VITE_SUPABASE_URL\")",
  "VITE_SUPABASE_ANON_KEY=$(node -p \"require('./docs/quality/bundle-budget.json').measuredBuild.env.VITE_SUPABASE_ANON_KEY\")",
  "export VITE_SUPABASE_URL VITE_SUPABASE_ANON_KEY",
  "id: build",
  "env:",
  "VITE_PRODUCT: devshark",
  "VITE_LOCK_SUBJECT: webdev",
  "- name: Browser checks",
  "run: |",
  "node scripts/wait-for-preview.mjs",
  "export CHROME_BIN=$(node -e \"console.log(require('@playwright/test').chromium.executablePath())\")",
  "TOPIC=javascript-closures",
  "- if: ${{ !cancelled() && steps.build.conclusion == 'success' }}",
  "name: Storybook and performance",
  "run: |",
  "TEST_BASE_URL=http://localhost:6006 node scripts/wait-for-preview.mjs",
  "- uses: actions/upload-artifact@v4",
  "if: always()",
  "with:",
  "name: quality",
  "path: |",
  "artifacts/",
  "playwright-report/",
  "test-results/",
  "client/storybook-static/",
  "retention-days: 14",
  "verify:",
  "needs: [quickjs, static, tests, coding, browser]",
  "if: ${{ always() }}",
  "runs-on: ubuntu-latest",
  "timeout-minutes: 5",
  "steps:",
  "- run: echo \"quickjs=${{ needs.quickjs.result }} static=${{ needs.static.result }} tests=${{ needs.tests.result }} coding=${{ needs.coding.result }} browser=${{ needs.browser.result }}\"",
  "- if: ${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped') }}",
  "run: exit 1",
];

const env = { ...process.env, CI: 'true' };
let budget;
try {
  budget = JSON.parse(readFileSync('docs/quality/bundle-budget.json', 'utf8')).measuredBuild.env;
} catch (error) {
  usage(`docs/quality/bundle-budget.json has no measuredBuild.env: ${error.message}`);
}
// The build step's env in quality.yml: the product lock plus the placeholder
// Supabase project that check:bundle measures with.
const BUILD_ENV = {
  VITE_PRODUCT: 'devshark',
  VITE_LOCK_SUBJECT: 'webdev',
  VITE_SUPABASE_URL: budget.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: budget.VITE_SUPABASE_ANON_KEY,
};

// ---- The plan ----------------------------------------------------------------
// `ci` lists the workflow commands a step stands for, env prefix included; the
// drift check joins them in plan order and compares them with the workflow.
// `tier`: 'fast' runs in --fast and the full run, 'full' only in the full run.
// `chrome`: CI exports CHROME_BIN only from check:responsive on, so only these
// steps get it; the browser specs launch Playwright's own Chromium.

const npmRun = (script, extra = '') => `npm run ${script}${extra ? ` ${extra}` : ''}`;
const step = (id, command, more = {}) => ({ id, command, ci: [command], tier: 'fast', ...more });

const RESPONSIVE_LIGHT = `-- --routes /,/quiz,/topics/${TOPIC},/daily,/not-found-responsive-check --widths 360,390,430,768,1024,1280,1440`;
const RESPONSIVE_DARK = `-- --routes /,/topics/${TOPIC},/daily --widths 390,768,1280`;
const BROWSER_SPECS = [
  'public', 'guide-startup profile-leaderboard-preferences profile-path-picker admin', 'evolving', 'coding-pages', 'coding-workbench',
  'coding-drafts', 'learning-release learn-sections',
  'fde-hub fde-taster fde-positioning interview-shelf', 'path-content-shapes portfolio-export diagnostic-overview dsa-advanced', 'segmented', 'on-accent', 'navigation', 'lazy-auth', 'sign-in',
  'route-errors', 'first-load', 'home-sample', 'routes-axe', 'daily', 'launch-offer',
].map((names) => names.split(' ').map((name) => `tests/browser/${name}.spec.ts`).join(' '));

const PLAN = [
  step('install', 'npm ci --no-audit && npm ci --no-audit --prefix client', { ci: ['npm ci --no-audit', 'npm ci --no-audit --prefix client'], kind: 'install' }),
  step('check:quickjs-build', npmRun('check:quickjs-build'), { kind: 'quickjs' }),
  step('typecheck:api', npmRun('typecheck:api')),
  step('typecheck:scripts', npmRun('typecheck:scripts')),
  step('typecheck:tooling', npmRun('typecheck:tooling', '--prefix client')),
  step('audit:native-reviews', npmRun('audit:native-reviews')),
  step('check:unused', npmRun('check:unused')),
  step('check:security', npmRun('check:security')),
  step('build', npmRun('build'), { env: BUILD_ENV }),
  step('check:public', npmRun('check:public'), { env: BUILD_ENV, needs: ['build'] }),
  step('check:bundle', npmRun('check:bundle'), { env: BUILD_ENV, needs: ['build'] }),
  step('audit:prod', 'npm audit --omit=dev'),
  step('audit:client', 'npm audit --omit=dev --prefix client'),
  ...['test:performance', 'test:launch', 'test:coding-auth', 'test:grading-integrity', 'test:path-authority',
    'test:react-authority', 'test:paths', 'test:billing', 'test:fallbacks', 'test:garden',
    'test:live-grading', 'test:client', 'test:coding'].map((script) => step(script, npmRun(script))),
  step('chromium', 'npx playwright install chromium', { ci: ['npx playwright install --with-deps chromium'], kind: 'chromium' }),
  step('preview', 'npm run preview --prefix client -- --host 0.0.0.0 --port 4173',
    { kind: 'server', url: 'http://localhost:4173', needs: ['build'] }),
  ...BROWSER_SPECS.map((specs) => step(`browser:${specs.replace(/tests\/browser\/|\.spec\.ts/g, '').replace(/ /g, '+')}`,
    npmRun('test:browser', `-- ${specs}`), { tier: 'full', needs: ['preview', 'chromium'] })),
  step('check:responsive', npmRun('check:responsive', RESPONSIVE_LIGHT), { needs: ['preview', 'chromium'], chrome: true }),
  step('check:responsive:dark', npmRun('check:responsive', RESPONSIVE_DARK), {
    ci: [`RESPONSIVE_THEME=dark ${npmRun('check:responsive', RESPONSIVE_DARK)}`],
    needs: ['preview', 'chromium'], chrome: true, env: { RESPONSIVE_THEME: 'dark' },
  }),
  step('test:harness', npmRun('test:harness'), { tier: 'full', needs: ['build', 'chromium'], chrome: true }),
  step('audit:performance', npmRun('audit:performance'), { tier: 'full', needs: ['preview', 'chromium'], chrome: true }),
  step('build:storybook', npmRun('build:storybook'), { tier: 'full', needs: ['build'] }),
  step('storybook', npmRun('storybook', '--prefix client -- --ci'),
    { tier: 'full', kind: 'server', url: 'http://localhost:6006', needs: ['build:storybook'] }),
  step('browser:storybook', npmRun('test:browser', '-- tests/browser/storybook.spec.ts'), {
    ci: [`STORYBOOK_URL=http://localhost:6006 ${npmRun('test:browser', '-- tests/browser/storybook.spec.ts')}`],
    tier: 'full', needs: ['storybook', 'chromium'], chrome: true, env: { STORYBOOK_URL: 'http://localhost:6006' },
  }),
];
const SQL_STEP = step('test:sql', npmRun('test:sql'), { ci: [], kind: 'sql' });

function firstDifference(expected, actual) {
  const at = expected.findIndex((line, index) => line !== actual[index]);
  if (at === -1 && expected.length === actual.length) return null;
  const index = at === -1 ? Math.min(expected.length, actual.length) : at;
  return { index, expected: expected[index] ?? '(nothing)', actual: actual[index] ?? '(nothing)' };
}

function checkDrift() {
  const { commands, glue } = readVerifyJob();
  const problems = [];
  const commandDiff = firstDifference(commands, PLAN.flatMap((one) => one.ci));
  if (commandDiff) problems.push(`command ${commandDiff.index + 1}:\n  workflow: ${commandDiff.expected}\n  plan:     ${commandDiff.actual}`);
  const glueDiff = firstDifference(glue, KNOWN_GLUE);
  if (glueDiff) problems.push(`non-command line ${glueDiff.index + 1}:\n  workflow:   ${glueDiff.expected}\n  KNOWN_GLUE: ${glueDiff.actual}`);
  if (!QUICKJS_INPUTS.length || !TOPIC) problems.push('the QuickJS inputs or the responsive TOPIC could not be read');
  if (!problems.length) return;
  console.error(`scripts/ci-parity.mjs no longer matches the verify job in ${WORKFLOW}. First difference at ${problems.join('\nand at ')}`);
  console.error('Update PLAN or KNOWN_GLUE in scripts/ci-parity.mjs and the sequence in .claude/skills/ci-parity-and-pr/SKILL.md.');
  process.exit(2);
}
checkDrift();

// ---- Arguments that need the plan ------------------------------------------

const selected = [...PLAN, ...(SQL ? [SQL_STEP] : [])];
if (ONLY) {
  if (!ONLY.length || ONLY_RAW?.startsWith('--')) usage('--only needs a comma-separated list of step ids (see --list).');
  const unknown = ONLY.filter((id) => !selected.some((one) => one.id === id));
  if (unknown.length) usage(`Unknown step id${unknown.length > 1 ? 's' : ''} for --only: ${unknown.join(', ')} (see --list${SQL ? '' : '; test:sql needs --sql'}).`);
}
const MODE = ONLY ? 'partial' : FAST ? 'fast' : 'full';
const inMode = (one) => (ONLY ? ONLY.includes(one.id) : !(FAST && one.tier === 'full'));

if (LIST) {
  for (const one of selected) console.log(`${one.id.padEnd(40)} ${(inMode(one) ? 'run' : 'skip').padEnd(5)} ${one.command}`);
  process.exit(0);
}

// ---- Running -----------------------------------------------------------------

const git = (...gitArgs) => spawnSync('git', gitArgs, { encoding: 'utf8' });
const head = git('rev-parse', 'HEAD').stdout.trim();
const dirty = git('status', '--porcelain').stdout.trim() !== '';
const nodeMajor = Number(process.versions.node.split('.')[0]);
const startedAt = new Date().toISOString();
const started = Date.now();
const results = new Map();
const servers = [];
let chromePath = '';
let finished = false;
const logFile = (one) => path.join(LOG_DIR, `${one.id.replace(/[^\w.-]+/g, '_')}.log`);
const summaryFile = path.join(LOG_DIR, 'summary.json');

async function answers(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
}
async function waitFor(url, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await answers(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// A preview or Storybook left over from another run would serve another build.
for (const server of selected.filter((one) => one.kind === 'server' && inMode(one))) {
  if (await answers(server.url)) usage(`${server.url} already answers. Stop that server (or the other ci:parity run) first.`);
}

mkdirSync(LOG_DIR, { recursive: true });
rmSync(summaryFile, { force: true });

function writeSummary(stopped) {
  const rows = [...results.values()];
  const count = (result) => rows.filter((row) => row.result === result).length;
  const summary = {
    mode: MODE,
    only: ONLY ?? null,
    complete: finished && !stopped,
    stopped: stopped ?? null,
    head,
    dirty,
    node: process.versions.node,
    startedAt,
    minutes: Math.round((Date.now() - started) / 600) / 100,
    passed: count('pass'),
    failed: count('fail'),
    skipped: count('skipped'),
    notRun: count('not-run'),
    steps: rows,
  };
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function record(one, result, detail, seconds = 0) {
  const logged = result === 'pass' || result === 'fail';
  results.set(one.id, { id: one.id, result, detail, seconds, log: logged ? path.relative(ROOT, logFile(one)) : '' });
  const mark = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP', 'not-run': 'NOT RUN' }[result];
  console.log(`${mark.padEnd(8)} ${one.id}${seconds ? ` (${seconds}s)` : ''}${detail ? `: ${detail}` : ''}`);
}

function stepEnv(one) {
  return { ...env, ...(one.chrome && chromePath ? { CHROME_BIN: chromePath } : {}), ...one.env };
}

function runToLog(one) {
  return new Promise((resolve) => {
    const out = createWriteStream(logFile(one));
    out.write(`$ ${one.command}\n`);
    const child = spawn(one.command, { shell: true, env: stepEnv(one), stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('error', (error) => { out.end(`\n${error.message}\n`); resolve(1); });
    child.on('close', (code) => { out.end(`\nexit ${code}\n`); resolve(code ?? 1); });
  });
}

function playwrightChromium() {
  try {
    return execFileSync(process.execPath, ['-e', "console.log(require('@playwright/test').chromium.executablePath())"], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Why a step cannot run here, or null. */
function precondition(one) {
  if (one.kind === 'sql' && !env.DATABASE_URL) {
    return 'DATABASE_URL is not set; scripts/test-sql.mjs needs an empty Postgres';
  }
  if (one.kind === 'quickjs' && !env.SHARK_EMSDK_DIR) {
    const python = env.SHARK_PYTHON || 'python3';
    const check = spawnSync(python, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)']);
    if (check.status !== 0) return `the rebuild needs Python 3.10+ (set SHARK_PYTHON) or SHARK_EMSDK_DIR; ${python} is older or missing`;
  }
  return null;
}

async function runStep(one) {
  if (!inMode(one)) return record(one, 'skipped', ONLY ? 'not in --only' : 'not part of --fast');
  const blocked = (one.needs ?? []).filter((need) => ['fail', 'not-run'].includes(results.get(need)?.result));
  if (blocked.length) return record(one, 'not-run', `needs ${blocked.join(', ')}`);

  if (one.kind === 'install') {
    const missing = !existsSync('node_modules') || !existsSync('client/node_modules');
    if (!missing && !FORCE_INSTALL) return record(one, 'skipped', 'node_modules present (pass --install to run npm ci)');
  }
  if (one.kind === 'quickjs') {
    const base = git('merge-base', 'HEAD', 'origin/main').stdout.trim();
    if (!base) return record(one, 'not-run', 'no origin/main to compare the QuickJS inputs with; run git fetch origin');
    if (git('diff', '--quiet', base, '--', ...QUICKJS_INPUTS).status === 0) {
      return record(one, 'skipped', `QuickJS inputs unchanged against origin/main ${base.slice(0, 8)}, as CI skips it`);
    }
  }
  if (one.kind === 'chromium') {
    // An explicit CHROME_BIN wins; the Claude Code cloud sandbox ships its
    // Chromium at /opt/pw-browsers/chromium and cannot download browsers.
    const given = [env.CHROME_BIN, '/opt/pw-browsers/chromium'].find((candidate) => candidate && existsSync(candidate));
    if (given) {
      chromePath = given;
      return record(one, 'skipped', `using ${given}`);
    }
  }
  const missing = precondition(one);
  if (missing) return record(one, 'not-run', missing);
  if (one.kind === 'server') return startServer(one);

  const begin = Date.now();
  const code = await runToLog(one);
  const seconds = Math.round((Date.now() - begin) / 1000);
  if (one.kind === 'chromium' && code === 0) chromePath = playwrightChromium();
  record(one, code === 0 ? 'pass' : 'fail', code === 0 ? '' : `exit ${code}`, seconds);
}

async function startServer(one) {
  const fd = openSync(logFile(one), 'w');
  const child = spawn(one.command, { shell: true, detached: true, env: stepEnv(one), stdio: ['ignore', fd, fd] });
  closeSync(fd);
  servers.push(child);
  const begin = Date.now();
  const up = await waitFor(one.url);
  record(one, up ? 'pass' : 'fail', up ? `serving ${one.url}` : `${one.url} did not answer within 60 s`, Math.round((Date.now() - begin) / 1000));
}

function stopServers() {
  for (const child of servers.splice(0)) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopServers();
    writeSummary(signal);
    process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 })[signal]);
  });
}
process.on('exit', stopServers);

if (nodeMajor !== 24) console.log(`Node ${process.versions.node}: CI runs Node 24, so results may differ.`);
if (dirty) console.log('The working tree has uncommitted changes; CI sees only what you commit.');
console.log(`ci:parity ${MODE}${ONLY ? ` (${ONLY.join(', ')})` : ''} at ${head.slice(0, 8)}, logs in ${path.relative(ROOT, LOG_DIR)}/`);

let crash = null;
try {
  for (const one of selected) {
    await runStep(one);
    if (BAIL && results.get(one.id)?.result === 'fail') break;
  }
  finished = true;
} catch (error) {
  crash = error;
} finally {
  stopServers();
}

const summary = writeSummary(crash ? `crashed: ${crash.message}` : BAIL && !selected.every((one) => results.has(one.id)) ? 'bail' : undefined);
console.log(`\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, ${summary.notRun} not run in ${summary.minutes} min (${MODE}${summary.complete ? '' : ', incomplete'}).`);
if (!SQL) console.log('The sql job did not run; pass --sql with DATABASE_URL set to include it.');
for (const row of summary.steps.filter((one) => one.result === 'fail')) console.log(`  failed: ${row.id}, see ${row.log}`);
if (crash) {
  console.error(crash);
  process.exit(1);
}
process.exit(summary.failed || !summary.complete ? 1 : 0);
