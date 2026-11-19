import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compilerVersion = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages['node_modules/typescript'].version;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Execute the real deps-stage RUN commands without a Docker daemon. All
// packages are tiny local tarballs, and npm is explicitly offline.
function depsCommands() {
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const stage = dockerfile.split(/^FROM .* AS deps\s*$/mi)[1]?.split(/^FROM /m)[0];
  assert(stage, 'Dockerfile has its production dependency stage');
  const lines = stage.split('\n');
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('RUN ')) continue;
    let command = lines[i].slice(4);
    while (command.endsWith('\\')) command = command.slice(0, -1) + lines[++i].trimStart();
    // Cache mounts change cache location, not the shell program being tested.
    command = command.replace(/^(?:--mount=\S+\s+)+/, '');
    commands.push(command);
  }
  assert(commands.length > 0);
  return commands.join('\n');
}

async function fixture(t, { transitive = false, corruptIntegrity = false } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'devshark-runtime-deps-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const app = join(scratch, 'app');
  const cache = join(scratch, 'npm-cache');
  const temporary = join(scratch, 'temporary');
  for (const dir of [app, cache, temporary]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(temporary, 'unrelated-owner-file'), 'preserve unrelated temporary files');
  const env = { ...process.env, npm_config_offline: 'true', npm_config_cache: cache, TMPDIR: temporary };
  for (const name of ['NODE_ENV', 'npm_config_omit', 'NPM_CONFIG_OMIT', 'npm_config_production', 'NPM_CONFIG_PRODUCTION']) delete env[name];
  const tarballs = new Map();
  const packages = new Map();

  const pack = (name, version, files, dependencies = undefined) => {
    const source = join(scratch, 'sources', name);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version, main: name === 'typescript' ? 'lib/typescript.js' : 'index.js', ...(dependencies ? { dependencies } : {}) }));
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(source, file)), { recursive: true });
      writeFileSync(join(source, file), content);
    }
    const packed = spawnSync('npm', ['pack', source, '--pack-destination', scratch, '--json', '--ignore-scripts', '--offline'], { cwd: scratch, env, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const path = join(scratch, JSON.parse(packed.stdout)[0].filename);
    tarballs.set(name, path);
    const entry = { version, integrity: `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`, ...(dependencies ? { dependencies } : {}) };
    packages.set(name, entry);
    return entry;
  };
  const prod = pack('fixture-prod', '1.0.0', { 'index.js': 'module.exports = "production";\n' });
  const extra = pack('fixture-extra-dev', '1.0.0', { 'index.js': 'module.exports = "unrelated development tool";\n' });
  const compiler = pack('typescript', compilerVersion, {
    'lib/typescript.js': `exports.version = ${JSON.stringify(compilerVersion)}; exports.readDefaultLib = () => require('node:fs').readFileSync(require('node:path').join(__dirname, 'lib.fixture.d.ts'), 'utf8');\n`,
    'lib/lib.fixture.d.ts': 'declare const preservedCompilerLibrary: unique symbol;\n',
    'LICENSE.txt': 'fixture license\n',
  }, transitive ? { 'fixture-extra-dev': '1.0.0' } : undefined);
  const registry = createServer((req, res) => {
    const name = req.url.split('/')[1];
    const entry = packages.get(name);
    if (!entry) { res.writeHead(404).end(); return; }
    if (req.url.includes('/-/')) { res.end(readFileSync(tarballs.get(name))); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ name, 'dist-tags': { latest: entry.version }, versions: { [entry.version]: { name, version: entry.version, ...(entry.dependencies ? { dependencies: entry.dependencies } : {}), dist: { tarball: entry.resolved, integrity: entry.integrity } } } }));
  });
  registry.listen(0, '127.0.0.1');
  await once(registry, 'listening');
  const registryUrl = `http://127.0.0.1:${registry.address().port}`;
  env.npm_config_registry = registryUrl;
  for (const [name, entry] of packages) entry.resolved = `${registryUrl}/${name}/-/${name}-${entry.version}.tgz`;
  const run = (command, args, options = {}) => new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: app, env, ...options });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('offline npm fixture timed out')); }, 30_000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', status => { clearTimeout(timeout); resolveRun({ status, stdout, stderr }); });
  });
  // Warm npm's own metadata/content cache from the loopback-only registry,
  // then close it. The actual Docker RUN commands have no network service.
  try {
    for (const [name, entry] of packages) {
      const cached = await run('npm', ['cache', 'add', `${name}@${entry.version}`, '--ignore-scripts'], { env: { ...env, npm_config_offline: 'false' } });
      assert.equal(cached.status, 0, cached.stderr);
    }
  } finally { await new Promise(resolveClose => registry.close(resolveClose)); }
  if (corruptIntegrity) {
    // A local tarball guarantees npm reads the mismatched bytes while offline,
    // instead of rejecting the incorrect digest as a missing cache key.
    compiler.resolved = `file:${tarballs.get('typescript')}`;
    compiler.integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  }
  const pkg = { name: 'runtime-contract-fixture', version: '1.0.0', private: true, dependencies: { 'fixture-prod': '1.0.0' }, devDependencies: { typescript: compilerVersion, 'fixture-extra-dev': '1.0.0' } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': pkg, 'node_modules/fixture-prod': prod, 'node_modules/typescript': { ...compiler, dev: true }, 'node_modules/fixture-extra-dev': { ...extra, dev: true } } };
  writeFileSync(join(app, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(app, 'package-lock.json'), JSON.stringify(lock));
  const before = digest(readFileSync(join(app, 'package-lock.json')));
  const helper = join(root, 'docker/install-runtime-typescript.mjs');
  if (existsSync(helper)) {
    mkdirSync(join(app, 'docker'), { recursive: true });
    copyFileSync(helper, join(app, 'docker/install-runtime-typescript.mjs'));
  }
  const result = await run('sh', ['-eu', '-c', depsCommands()]);
  return { app, temporary, before, result, output: result.stdout + result.stderr };
}

test('runtime installs the locked compiler and its libraries without unrelated devDependencies', async (t) => {
  const { app, temporary, before, result, output } = await fixture(t);
  assert.equal(result.status, 0, output);
  const require = createRequire(join(app, 'package.json'));
  assert.equal(require('fixture-prod'), 'production');
  assert.equal(require('typescript').version, compilerVersion);
  assert.match(require('typescript').readDefaultLib(), /preservedCompilerLibrary/);
  assert.equal(readFileSync(join(app, 'node_modules/typescript/LICENSE.txt'), 'utf8'), 'fixture license\n');
  assert.deepEqual(readdirSync(join(app, 'node_modules')).filter(name => !name.startsWith('.')).sort(), ['fixture-prod', 'typescript']);
  assert.equal(digest(readFileSync(join(app, 'package-lock.json'))), before);
  assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith('devshark-runtime-typescript-')), [], 'the installer cleans its owned temporary prefix');
  assert.equal(readFileSync(join(temporary, 'unrelated-owner-file'), 'utf8'), 'preserve unrelated temporary files');
});

test('a future compiler dependency requires an explicit locked-closure design', async (t) => {
  const { app, before, result, output } = await fixture(t, { transitive: true });
  assert.notEqual(result.status, 0, 'unreviewed runtime dependencies must not be silently omitted or installed');
  assert.match(output, /TypeScript.*dependenc/i);
  assert.equal(existsSync(join(app, 'node_modules/typescript')), false);
  assert.equal(digest(readFileSync(join(app, 'package-lock.json'))), before);
});

test('compiler tarball integrity is enforced and a failed install leaves no copied compiler', async (t) => {
  const { app, temporary, before, result, output } = await fixture(t, { corruptIntegrity: true });
  assert.notEqual(result.status, 0);
  assert.match(output, /EINTEGRITY/);
  assert.equal(existsSync(join(app, 'node_modules/typescript')), false);
  assert.equal(digest(readFileSync(join(app, 'package-lock.json'))), before);
  assert.deepEqual(readdirSync(temporary).filter(name => name.startsWith('devshark-runtime-typescript-')), []);
  assert.equal(readFileSync(join(temporary, 'unrelated-owner-file'), 'utf8'), 'preserve unrelated temporary files');
});
