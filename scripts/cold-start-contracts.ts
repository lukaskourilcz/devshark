/* What a fresh function instance evaluates before it can answer (#587).
 *
 * Vercel's @vercel/node compiles every file under api/ and lib/ to CommonJS
 * on its own and leaves node_modules outside, so a `require` runs when its
 * module first evaluates. These checks bundle a module the same way (esbuild,
 * CommonJS, packages external, dynamic `import()` kept lazy), require it in a
 * fresh Node process with no Supabase or Upstash settings, and read what that
 * process loaded. Nothing calls the network.
 *
 * They pin the cold-start properties the performance pass bought:
 *  - lib/coding/active.ts computes the per-task source versions on first
 *    read, not at import (server item 15), and the lazy map holds the same
 *    hashes as before;
 *  - neither the complexity estimator nor the type-check pool loads the
 *    TypeScript compiler at import (server item 16); the first assessment
 *    and the in-thread fallback load it and still work;
 *  - api/settings.ts, read on every page load, loads neither the learning-
 *    path handlers nor a grader (server item 17), and publishes the same
 *    capability the handlers compute;
 *  - api/user/[op].ts loads its op families on first call (server item 3):
 *    a fresh instance evaluates no grader, no TypeScript, no Stripe and no
 *    coding catalogue before it answers, and an op that needs them loads them
 *    and answers; the wallet loads the tier gate without the coding
 *    catalogue, which lib/access.ts reads on first use;
 *  - api/quiz/roadmap.ts does the same for its coding and learning-path
 *    resources, the tier check and a code level's tasks (server item 4);
 *  - the learning-path handlers load the attempt sessions, the graders and
 *    the grading material only when an activity is opened or graded, so the
 *    catalogue and the enrollment and progress reads evaluate none of them;
 *  - only the roadmap function ships the compiler's lib files and the grader
 *    bundles (server item 24): nothing in another function reads them. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { bundleColdEntry } from './cold-start-bundle.mjs';

const root = process.cwd();
const out = join(root, 'node_modules/.cache/shark/cold-start');

interface Loaded {
  /** npm packages the process had loaded once the module was required. */
  packages: string[];
  /** What the probe expression returned, JSON-encoded by the child. */
  probe: unknown;
}

/** Bundle `entry` as @vercel/node would ship it and require it in a fresh
 * process. `probe` is a JavaScript expression evaluated in that process with
 * `mod` bound to the module's exports, after the require. Each repository
 * file named in `markers` records itself in `globalThis.__evaluated` when it
 * evaluates, so a probe can tell whether a module of our own (which has no
 * package to look for) ran. */
export async function loadFresh(entry: string, probe = 'null', extraEnv: Record<string, string> = {}, markers: string[] = [], beforeImport = ''): Promise<Loaded> {
  mkdirSync(out, { recursive: true });
  const outfile = join(out, `${entry.replace(/[/[\]]/g, '_').replace(/\.ts$/, '')}${markers.length ? '-marked' : ''}.cjs`);
  await bundleColdEntry(entry, outfile, markers, root);
  const code = [
    beforeImport,
    `const mod = require(${JSON.stringify(outfile)});`,
    'const packages = [...new Set(Object.keys(require.cache)',
    '  .map((path) => (path.match(/node_modules\\/((?:@[^/]+\\/)?[^/]+)/) || [])[1])',
    "  .filter((name) => name && name !== '.cache'))].sort();",
    `Promise.resolve(${probe}).then((probe) => { console.log(JSON.stringify({ packages, probe })); process.exit(0); });`,
  ].join('\n');
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', NODE_ENV: 'development', ...extraEnv };
  const child = spawnSync(process.execPath, ['-e', code], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(child.status, 0, `${entry} loads in a fresh process: ${child.stderr.slice(0, 800)}`);
  return JSON.parse(child.stdout.trim().split('\n').pop()!) as Loaded;
}

/** The learning-path handlers and what only grading a code submission or
 * opening an attempt needs: the attempt sessions (./session through ./audit),
 * the coding catalogue, the reference solutions, the protected harness and
 * the QuickJS sandbox. */
const PATH_GRADING_MARKERS = [
  'lib/learning-paths/handlers.ts', 'lib/learning-paths/session.ts', 'lib/learning-paths/audit.ts', 'lib/coding/active.ts',
  'lib/coding/solutions/index.ts', 'lib/learning-paths/solutions/index.ts', 'lib/learning-paths/harness.ts', 'lib/coding/sandbox.ts',
];

export async function coldStartContracts(): Promise<void> {
  // F14-03: ordinary admin work and refused methods never evaluate the overlay.
  {
    const marker = 'lib/admin-triage.ts';
    const probe = (op: string, method = 'GET', password = 'triage-cold-contract') => `(async () => {
      const res = { statusCode: 200, headers: {}, body: null,
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; return this; },
        getHeader(name) { return this.headers[name.toLowerCase()]; },
        json(body) { this.body = body; return this; }, end() { return this; } };
      await mod.default({ method: ${JSON.stringify(method)}, url: '/api/admin/triage',
        headers: { 'x-dev-password': ${JSON.stringify(password)}, 'x-forwarded-for': 'triage-cold' },
        query: { op: ${JSON.stringify(op)} } }, res);
      return { status: res.statusCode, total: res.body?.meta?.total ?? null,
        cache: res.headers['cache-control'], loaded: globalThis.__evaluated ?? [] };
    })()`;
    for (const [op, method, password, expected] of [
      ['settings', 'GET', 'triage-cold-contract', 200],
      ['triage', 'POST', 'triage-cold-contract', 405],
      ['triage', 'GET', '', 401],
    ] as const) {
      const fresh = await loadFresh('api/admin/[op].ts', probe(op, method, password), { DEV_PASSWORD: 'triage-cold-contract' }, [marker]);
      const result = fresh.probe as { status: number; loaded: string[] };
      assert.equal(result.status, expected);
      assert.ok(!result.loaded.includes(marker), `${op} ${method} loads no triage data`);
    }
    const fresh = await loadFresh('api/admin/[op].ts', probe('triage'), { DEV_PASSWORD: 'triage-cold-contract' }, [marker]);
    const result = fresh.probe as { status: number; total: number; cache: string; loaded: string[] };
    assert.equal(result.status, 200);
    assert.equal(result.total, 3609);
    assert.equal(result.cache, 'private, no-store');
    assert.ok(result.loaded.includes(marker));
  }

  // ── server item 15: the coding source versions are hashed on first read ──
  {
    const fresh = await loadFresh('lib/coding/active.ts', 'mod.CODING_SOURCE_VERSIONS.built');
    assert.equal(fresh.probe, false, 'importing lib/coding/active.ts hashes no task for CODING_SOURCE_VERSIONS');
    const [{ CODING_SOURCE_VERSIONS }, { CODING_TASKS }, { taskHash }, { solutionFor }] = await Promise.all([
      import('../lib/coding/active'),
      import('../lib/coding/catalog'),
      import('../lib/curation'),
      import('../lib/coding/solutions'),
    ]);
    assert.equal(CODING_SOURCE_VERSIONS.size, CODING_TASKS.length, 'one source version per authored task');
    for (const task of CODING_TASKS) {
      assert.equal(CODING_SOURCE_VERSIONS.get(task.id), taskHash(task, solutionFor(task.id)), `${task.id}: the same source version as an eager hash`);
    }
    assert.deepEqual([...CODING_SOURCE_VERSIONS.keys()], CODING_TASKS.map((task) => task.id), 'in catalogue order');
    assert.equal(CODING_SOURCE_VERSIONS.has('not-a-task'), false);
    console.log('PASS cold start: lib/coding/active.ts hashes source versions on first read, with the same values');
  }

  // ── server item 16: TypeScript loads on first use, not at import ─────────
  for (const entry of ['lib/coding/complexity.ts', 'lib/coding/ts-check-pool.ts']) {
    const fresh = await loadFresh(entry);
    assert.ok(!fresh.packages.includes('typescript'), `${entry} does not load the TypeScript compiler at import (${fresh.packages.join(', ')})`);
  }
  {
    // The first assessment in a fresh process loads the compiler and answers
    // as the eager import did.
    const assessed = await loadFresh('lib/coding/complexity.ts', `(() => {
      const report = mod.assessComplexity({ track: 'javascript', prompt: '', tests: [{ call: 'sum([1, 2, 3])', expected: 6 }] },
        'function sum(xs) { let total = 0; for (let i = 0; i < xs.length; i++) total += xs[i]; return total; }');
      return { time: report.time, typescript: Object.keys(require.cache).some((path) => path.includes('/node_modules/typescript/')) };
    })()`);
    assert.deepEqual(assessed.probe, { time: 'O(n)', typescript: true }, 'the first assessment loads TypeScript and estimates O(n)');
    // The in-thread fallback (no worker bundle in a fresh checkout's probe,
    // and in-thread grading allowed off a deployment) loads it too.
    const checked = await loadFresh('lib/coding/ts-check-pool.ts', `(process.chdir(require('node:os').tmpdir()), mod.checkTypes('const n: number = 1;', [[{ code: 'const s: string = n;', rejects: true }]]).then((outcome) => ({ stopped: outcome.stopped, results: outcome.results?.length, javascript: typeof outcome.javascript })))`);
    assert.deepEqual(checked.probe, { stopped: false, results: 1, javascript: 'string' }, 'the in-thread type check still answers');
    console.log('PASS cold start: the complexity estimator and the type-check pool load TypeScript on first use');
  }

  // ── server item 17: /api/settings without the learning-path handlers ─────
  {
    const fresh = await loadFresh('api/settings.ts');
    for (const heavy of ['typescript', 'quickjs-emscripten', 'stripe']) {
      assert.ok(!fresh.packages.includes(heavy), `api/settings.ts does not load ${heavy} (${fresh.packages.join(', ')})`);
    }
    const [{ learningPathCapability: published }, { learningPathCapability: handlers }] = await Promise.all([
      import('../lib/learning-paths/capability'),
      import('../lib/learning-paths/handlers'),
    ]);
    const before = process.env.LEARNING_PATH_FDE_ENABLED;
    try {
      for (const value of [undefined, 'false', 'true']) {
        if (value === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
        else process.env.LEARNING_PATH_FDE_ENABLED = value;
        assert.deepEqual(published(), handlers(), `the settings capability matches the handlers' with the switch ${value ?? 'unset'}`);
      }
      assert.ok(Object.keys(published().paths).length > 0, 'and it names the paths');
    } finally {
      if (before === undefined) delete process.env.LEARNING_PATH_FDE_ENABLED;
      else process.env.LEARNING_PATH_FDE_ENABLED = before;
    }
    console.log('PASS cold start: /api/settings publishes the learning-path capability without the handlers or a grader');
  }

  // ── server item 3: api/user/[op].ts loads op families on first call ──────
  {
    const fresh = await loadFresh('api/user/[op].ts');
    for (const heavy of ['typescript', 'quickjs-emscripten', '@jitl/quickjs-singlefile-cjs-release-sync', 'stripe']) {
      assert.ok(!fresh.packages.includes(heavy), `api/user/[op].ts does not load ${heavy} at import (${fresh.packages.join(', ')})`);
    }
    // An op served by a lazily loaded family loads it on its first call and
    // answers. The database address is a closed local port and the request
    // carries no token, so the op's own sign-in check answers 401 without
    // any network call; QuickJS loading shows the coding handlers ran.
    const called = await loadFresh('api/user/[op].ts', `(async () => {
      const res = { statusCode: 200, headers: {}, body: undefined, headersSent: false,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
        status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { this.headersSent = true; return this; } };
      const loaded = () => Object.keys(require.cache).some((path) => path.includes('/node_modules/quickjs-emscripten/'));
      const before = loaded();
      await mod.default({ method: 'GET', headers: { 'x-forwarded-for': '198.51.100.7' }, query: { op: 'coding-progress' }, url: '/api/user/coding-progress', socket: {} }, res);
      return { before, after: loaded(), status: res.statusCode, code: res.body && res.body.error && res.body.error.code };
    })()`, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'cold-start-anon', SUPABASE_SERVICE_ROLE_KEY: 'cold-start-service' });
    assert.deepEqual(called.probe, { before: false, after: true, status: 401, code: 'missing_token' }, 'a coding op loads its handlers on first call and answers');
    // The wallet, read on every signed-in page, loads the rewards handlers
    // and the tier gate (lib/access.ts) but not the coding catalogue, which
    // the gate reads only for a coding task.
    const wallet = await loadFresh('api/user/[op].ts', `(async () => {
      const res = { statusCode: 200, headers: {}, body: undefined, headersSent: false,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
        status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { this.headersSent = true; return this; } };
      await mod.default({ method: 'GET', headers: { 'x-forwarded-for': '198.51.100.9' }, query: { op: 'wallet' }, url: '/api/user/wallet', socket: {} }, res);
      return { evaluated: globalThis.__evaluated ?? [], status: res.statusCode };
    })()`, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'cold-start-anon', SUPABASE_SERVICE_ROLE_KEY: 'cold-start-service' },
    ['lib/rewards/handlers.ts', 'lib/access.ts', 'lib/coding/active.ts']);
    assert.deepEqual(wallet.probe, { evaluated: ['lib/access.ts', 'lib/rewards/handlers.ts'], status: 401 }, 'the wallet loads the tier gate without the coding catalogue');
    // The gate still reads the catalogue's free flags the moment a coding
    // task is asked about.
    const gated = await loadFresh('lib/access.ts', `(() => {
      const before = (globalThis.__evaluated ?? []).includes('lib/coding/active.ts');
      const index = mod.serverContentIndex();
      const free = index.coding.find((task) => task.free === true);
      return { before, after: (globalThis.__evaluated ?? []).includes('lib/coding/active.ts'), free: Boolean(free), same: index.coding === mod.serverContentIndex().coding };
    })()`, {}, ['lib/coding/active.ts']);
    assert.deepEqual(gated.probe, { before: false, after: true, free: true, same: true }, 'the content index loads the coding summaries on first read, once');
    // The learning-path enrollment and progress reads, made by every Learn
    // section for a signed-in learner, load the path handlers without the
    // attempt sessions, the graders or the grading material.
    for (const op of ['learning-path-enrollment', 'learning-path-progress']) {
      const read = await loadFresh('api/user/[op].ts', `(async () => {
        const res = { statusCode: 200, headers: {}, body: undefined, headersSent: false,
          setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
          status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { this.headersSent = true; return this; } };
        await mod.default({ method: 'GET', headers: { 'x-forwarded-for': '198.51.100.10' }, query: { op: ${JSON.stringify(op)}, enrollmentId: 'e' }, url: '/api/user/x', socket: {} }, res);
        const grader = Object.keys(require.cache).some((path) => path.includes('/node_modules/quickjs-emscripten/') || path.includes('/node_modules/typescript/'));
        return { evaluated: globalThis.__evaluated ?? [], grader, status: res.statusCode };
      })()`, { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_ANON_KEY: 'cold-start-anon', SUPABASE_SERVICE_ROLE_KEY: 'cold-start-service', LEARNING_PATH_FDE_ENABLED: 'true' }, PATH_GRADING_MARKERS);
      assert.deepEqual(read.probe, { evaluated: ['lib/learning-paths/handlers.ts'], grader: false, status: 401 }, `${op} loads the path handlers without a grader or the grading material`);
    }
    console.log('PASS cold start: api/user/[op].ts loads no grader, TypeScript, Stripe or coding catalogue before its first answer');
  }

  // ── server item 4: api/quiz/roadmap.ts loads coding and paths on use ─────
  {
    const fresh = await loadFresh('api/quiz/roadmap.ts');
    for (const heavy of ['typescript', 'quickjs-emscripten', '@jitl/quickjs-singlefile-cjs-release-sync']) {
      assert.ok(!fresh.packages.includes(heavy), `api/quiz/roadmap.ts does not load ${heavy} at import (${fresh.packages.join(', ')})`);
    }
    // The public path catalogue is served by the lazily loaded path handlers,
    // and answers as before. The handlers load the graders and the grading
    // material only when a code submission is graded, so the catalogue
    // evaluates neither (#587, server item 3).
    const called = await loadFresh('api/quiz/roadmap.ts', `(async () => {
      const res = { statusCode: 200, headers: {}, body: undefined, headersSent: false,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; }, getHeader(k) { return this.headers[k.toLowerCase()]; },
        status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; this.headersSent = true; return this; }, end() { this.headersSent = true; return this; } };
      const loaded = () => Object.keys(require.cache).some((path) => path.includes('/node_modules/quickjs-emscripten/') || path.includes('/node_modules/typescript/'));
      const handlers = () => (globalThis.__evaluated ?? []).includes('lib/learning-paths/handlers.ts');
      const before = { grader: loaded(), handlers: handlers() };
      await mod.default({ method: 'GET', headers: { 'x-forwarded-for': '198.51.100.8' }, query: { resource: 'learning-path-catalog' }, url: '/api/quiz/roadmap', socket: {} }, res);
      return { before, handlers: handlers(), grader: loaded(), material: (globalThis.__evaluated ?? []).filter((file) => file !== 'lib/learning-paths/handlers.ts'), status: res.statusCode, paths: Array.isArray(res.body && res.body.paths) };
    })()`, {}, PATH_GRADING_MARKERS);
    assert.deepEqual(called.probe, { before: { grader: false, handlers: false }, handlers: true, grader: false, material: [], status: 200, paths: true },
      'the path catalogue loads its handlers on first call and answers, without a grader or the grading material');
    console.log('PASS cold start: api/quiz/roadmap.ts loads no grader or TypeScript before its first answer');
  }

  // ── server item 24: only the roadmap function ships grading files ────────
  {
    const { readFileSync, readdirSync } = await import('node:fs');
    const functions = (JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')) as { functions: Record<string, { includeFiles?: string; maxDuration?: number }> }).functions;
    const roadmap = functions['api/quiz/roadmap.ts'];
    assert.ok(roadmap?.includeFiles?.includes('lib/coding/generated/*.cjs') && roadmap.includeFiles.includes('node_modules/typescript/lib/lib.*.d.ts'),
      'the roadmap function ships the grader bundles and the compiler\'s lib files');
    assert.equal(functions['api/**/*.ts']?.includeFiles, undefined, 'the other functions ship neither the compiler\'s lib files nor React\'s development builds');
    // Why nothing else needs them. The lib files are read by the in-thread
    // type checker, which never runs on a deployment (the checker's worker,
    // in the roadmap function, reads them there) ...
    const { inThreadGradingAllowed } = await import('../lib/coding/grader-capacity');
    const env = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL };
    try {
      process.env.VERCEL = '1';
      assert.equal(inThreadGradingAllowed(), false, 'no type check runs on a deployment\'s request thread');
    } finally {
      if (env.VERCEL === undefined) delete process.env.VERCEL; else process.env.VERCEL = env.VERCEL;
    }
    // ... and React's development builds by the in-process React runner,
    // which the server reaches for its types only: React is graded in a
    // Vercel Sandbox.
    const serverFiles = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? (entry.name === 'generated' ? [] : serverFiles(join(dir, entry.name))) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : []);
    for (const file of [...serverFiles('api'), ...serverFiles('lib')]) {
      const source = readFileSync(join(root, file), 'utf8');
      if (file === 'lib/coding/react-runner.ts') continue;
      for (const match of source.matchAll(/import\s+(type\s+)?[^;]*?from\s+'[^']*react-runner'|import\('[^']*react-runner'\)/g)) {
        assert.ok(match[1], `${file} loads lib/coding/react-runner at run time; ship React's development builds with that function`);
      }
    }
    console.log('PASS cold start: only the roadmap function ships the grader bundles and the compiler\'s lib files');
  }
}

/** Bundle a test script as the npm scripts do and run it in its own process,
 * for a script that sets the settings modules read when they load. */
export async function runIsolated(script: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  const outfile = join(out, `${script.replace(/[/[\]]/g, '_').replace(/\.ts$/, '')}.mjs`);
  await build({ entryPoints: [join(root, script)], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile, logLevel: 'warning', absWorkingDir: root });
  const child = spawnSync(process.execPath, [outfile], { cwd: root, env: process.env, stdio: 'inherit' });
  assert.equal(child.status, 0, `${script} passes`);
}
