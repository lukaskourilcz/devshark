// The grader loads TypeScript at runtime. Installing it into the root package
// would also restore unrelated devDependencies, so use a separate locked prefix.
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function requireDependencyFreeCompiler(entry) {
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']) {
    if (entry[key] && Object.keys(entry[key]).length > 0) {
      throw new Error(`TypeScript ${key} require an explicit reviewed locked dependency closure`);
    }
  }
  if (entry.hasInstallScript || entry.scripts?.install || entry.scripts?.postinstall || entry.scripts?.preinstall) {
    throw new Error('TypeScript install scripts require an explicit runtime dependency review');
  }
}

const root = resolve('.');
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const compiler = lock.packages?.['node_modules/typescript'];
if (!compiler || compiler.link || !compiler.version || !compiler.resolved || !compiler.integrity) {
  throw new Error('TypeScript requires an exact version, resolved tarball and integrity in the root lockfile');
}
requireDependencyFreeCompiler(compiler);
const target = join(root, 'node_modules/typescript');
try {
  await lstat(target);
  throw new Error('TypeScript must be absent after the production dependency install');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// npm treats a prefix reached through a symlink (macOS /var -> /private/var)
// as a link to its real path and then reports the folder as a missing package.
const prefix = await mkdtemp(join(await realpath(tmpdir()), 'devshark-runtime-typescript-'));
try {
  const pkg = { name: 'devshark-runtime-compiler', version: '1.0.0', private: true, dependencies: { typescript: compiler.version } };
  const { dev, devOptional, optional, ...runtimeCompiler } = compiler;
  const isolatedLock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': pkg, 'node_modules/typescript': runtimeCompiler } };
  await writeFile(join(prefix, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(prefix, 'package-lock.json'), JSON.stringify(isolatedLock));
  const result = spawnSync('npm', ['ci', '--prefix', prefix, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Locked TypeScript installation failed (status ${result.status})`);
  const source = join(prefix, 'node_modules/typescript');
  const installed = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  if (installed.name !== 'typescript' || installed.version !== compiler.version) {
    throw new Error('Installed TypeScript does not match the root lockfile');
  }
  requireDependencyFreeCompiler(installed);
  // Keep declarations, standard libraries, compiler entry points and licenses.
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
} finally {
  // Never remove or reify the root dependency tree while cleaning up.
  await rm(prefix, { recursive: true, force: true });
}
