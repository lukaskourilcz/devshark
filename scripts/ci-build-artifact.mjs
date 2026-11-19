// Share one production build between CI jobs without losing hidden manifests
// or maps. All consumers verify the same commit and complete byte inventory.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [action, output] = process.argv.slice(2);
const roots = ['client/dist', 'lib/coding/generated'];
const manifestPath = 'artifacts/client-build-manifest.json';
const archive = output && path.resolve(output);
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
function inventory(root, relative) {
  const target = path.join(root, relative);
  if (!existsSync(target)) throw new Error(`Missing build path: ${relative}`);
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) throw new Error(`Unexpected build symlink: ${relative}`);
  if (stat.isDirectory()) return readdirSync(target).sort().flatMap((name) => inventory(root, `${relative}/${name}`));
  if (!stat.isFile()) throw new Error(`Unexpected build entry: ${relative}`);
  return [{ path: relative, sha256: hash(target) }];
}
// The generic archive inventory proves each stored file matches its manifest.
// Independently require the guest/digest pair, so an inventory recomputed
// around a missing or stale pair cannot pass on its own. No record is evaluated.
function verifyReactArtifact(root) {
  try {
    const runner = readFileSync(path.join(root, 'lib/coding/generated/react-sandbox.cjs'));
    const expected = JSON.parse(readFileSync(path.join(root, 'lib/coding/generated/react-sandbox.sha256.cjs'), 'utf8'));
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected) || createHash('sha256').update(runner).digest('hex') !== expected) throw new Error();
  } catch { throw new Error('React guest artifact/digest pair is missing or invalid.'); }
}
function head() {
  const value = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('A full commit head is required.');
  return value;
}
try {
  if (!archive || !['pack', 'restore'].includes(action)) throw new Error('Usage: ci-build-artifact.mjs pack|restore <archive.tar>');
  const expectedHead = head();
  if (action === 'pack') {
    for (const required of ['client/dist/index.html', 'client/dist/.vite/manifest.json']) {
      if (!existsSync(required)) throw new Error(`Missing required build manifest/input: ${required}`);
    }
    const files = roots.flatMap((root) => inventory('.', root));
    verifyReactArtifact('.');
    if (!files.some((file) => file.path.endsWith('.js.map'))) throw new Error('Missing build source maps.');
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify({ head: expectedHead, files }, null, 2) + '\n');
    mkdirSync(path.dirname(archive), { recursive: true });
    execFileSync('tar', ['-cf', archive, ...roots, manifestPath]);
    console.log(`Packed ${files.length} build files at head ${expectedHead}.`);
  } else {
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', archive, manifestPath], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    if (metadata.head !== expectedHead) throw new Error(`Build head ${metadata.head} differs from checkout head ${expectedHead}.`);
    // Reject unexpected archive paths before extraction into the temporary tree.
    const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split('\n');
    for (const entry of entries) {
      if (entry.startsWith('/') || entry.split('/').includes('..') || !(entry === manifestPath || roots.some((root) => entry === root || entry.startsWith(`${root}/`)))) {
        throw new Error(`Unexpected archive path: ${entry}`);
      }
    }
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'devshark-ci-restore-'));
    try {
      execFileSync('tar', ['-xf', archive, '-C', temporary]);
      const actual = roots.flatMap((root) => inventory(temporary, root));
      if (JSON.stringify(actual) !== JSON.stringify(metadata.files)) throw new Error('Shared build file/hash inventory differs.');
      verifyReactArtifact(temporary);
      for (const root of roots) {
        rmSync(root, { recursive: true, force: true }); mkdirSync(path.dirname(root), { recursive: true });
        cpSync(path.join(temporary, root), root, { recursive: true });
      }
      console.log(`Restored ${actual.length} verified build files at head ${expectedHead}.`);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
