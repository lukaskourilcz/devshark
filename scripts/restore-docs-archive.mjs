#!/usr/bin/env node
// Historical docs stay in the published source commit. Verify all bytes before
// restoring into an empty directory; current review inputs stay in this tree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const reviewRoots = [
  'docs/ux-audit-2026-11-03/',
  'docs/ux-review-platform-2026-11-05/',
  'docs/ux-review-platform-comments-2026-11-05/',
  'docs/ux-review-round3-2026-11-05/',
  'docs/ux-review-uizze-2026-11-05/',
];
const ledger = 'docs/audit/devshark-content-ledger.json';
const nativeRoot = 'docs/audit/wip/native/';
const brandRoot = 'docs/brand/source/';
const hash = (body) => createHash('sha256').update(body).digest('hex');
const protectedInput = (path) => path === ledger || path.startsWith(nativeRoot);

function options(args) {
  const result = { manifest: 'docs/archive/manifest.json', verify: false, output: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--verify') result.verify = true;
    else if (arg === '--manifest' || arg === '--output') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      result[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (Boolean(result.verify) === Boolean(result.output)) throw new Error('Choose --verify or --output <empty-directory>');
  return result;
}

function validPath(path) {
  if (typeof path !== 'string' || !path.startsWith('docs/') || /[\\\r\n\0]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid archive path: ${String(path)}`);
  }
}

function validateManifest(manifest) {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported docs archive schemaVersion');
  if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit ?? '')) throw new Error('Archive source must be a full 40-character commit SHA');
  for (const key of ['archivedFiles', 'preservedInputs', 'requiredPaths']) {
    if (!Array.isArray(manifest[key])) throw new Error(`Manifest must contain ${key}`);
  }
  if (!manifest.archivedFiles.length || !manifest.preservedInputs.length) throw new Error('Archive and preserved input records cannot be empty');
  const seen = new Set();
  for (const record of [...manifest.archivedFiles, ...manifest.preservedInputs]) {
    validPath(record.path);
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) {
      throw new Error(`Invalid byte/hash record: ${record.path}`);
    }
    if (manifest.archivedFiles.includes(record)) {
      if (protectedInput(record.path) || record.path.startsWith(brandRoot)) throw new Error(`Protected input cannot be archived: ${record.path}`);
      const oldReview = reviewRoots.some((root) => record.path.startsWith(root))
        && /\.(?:html|webp|png)$/.test(record.path) && !record.path.endsWith('/review-template.html');
      const oldData = record.path.startsWith('docs/audit/wip/') && /\.(?:json|jsonl)$/.test(record.path);
      if (!oldReview && !oldData) throw new Error(`Path is not a reviewed archive category: ${record.path}`);
    }
    if (seen.has(record.path)) throw new Error(`Duplicate archive/preserved path: ${record.path}`);
    seen.add(record.path);
  }
  const required = new Set();
  for (const path of manifest.requiredPaths) {
    validPath(path);
    if (required.has(path)) throw new Error(`Duplicate required path: ${path}`);
    if (manifest.archivedFiles.some((record) => record.path === path)) throw new Error(`Required path cannot be archived: ${path}`);
    required.add(path);
  }
}

function git(args, maxBuffer = 1024 * 1024) {
  return execFileSync('git', args, { maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
}

function sourceBlob(commit, record) {
  let body;
  try { body = git(['show', `${commit}:${record.path}`], Math.max(record.bytes + 1024, 1024 * 1024)); }
  catch { throw new Error(`Missing archive blob at ${commit}: ${record.path}`); }
  if (body.length !== record.bytes) throw new Error(`Byte count mismatch for ${record.path}: expected ${record.bytes}, found ${body.length}`);
  if (hash(body) !== record.sha256) throw new Error(`SHA-256 mismatch for ${record.path}`);
  return body;
}

function checkRequiredInputs(manifest, auditCurrentInputs) {
  let sourcePaths;
  try { sourcePaths = git(['ls-tree', '-r', '--name-only', '-z', manifest.sourceCommit, '--', 'docs']).toString('utf8').split('\0').filter(Boolean); }
  catch { throw new Error(`Archive source commit is unavailable: ${manifest.sourceCommit}. Fetch the published main history first.`); }
  if (!sourcePaths.length) throw new Error(`Archive source has no docs: ${manifest.sourceCommit}`);
  const expected = sourcePaths.filter(protectedInput).sort();
  const preserved = manifest.preservedInputs.map((record) => record.path).sort();
  if (JSON.stringify(expected) !== JSON.stringify(preserved)) throw new Error('Preserved inputs must include the original ledger and entire native subtree');
  const archived = new Set(manifest.archivedFiles.map((record) => record.path));
  const required = new Set(manifest.requiredPaths);
  for (const path of sourcePaths) {
    const review = reviewRoots.some((root) => path.startsWith(root));
    const wip = path.startsWith('docs/audit/wip/');
    const retained = !archived.has(path) && (path.startsWith(brandRoot)
      || ((review || wip) && (/\.md$/.test(path) || path.includes('/tools/') || path.endsWith('/review-template.html'))));
    if (retained && !required.has(path)) throw new Error(`Manifest omits required path: ${path}`);
  }
  for (const record of manifest.preservedInputs) {
    sourceBlob(manifest.sourceCommit, record);
    if (!auditCurrentInputs) continue;
    if (!existsSync(record.path)) throw new Error(`Missing preserved input: ${record.path}`);
    const body = readFileSync(record.path);
    if (body.length !== record.bytes || hash(body) !== record.sha256) throw new Error(`Preserved input changed: ${record.path}`);
  }
  for (const path of manifest.requiredPaths) {
    if (!sourcePaths.includes(path)) throw new Error(`Required path is absent from the source commit: ${path}`);
    if (auditCurrentInputs && (!existsSync(path) || !lstatSync(path).isFile())) throw new Error(`Missing required path: ${path}`);
  }
}

let config;
try { config = options(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exit(2); }

try {
  const manifest = JSON.parse(readFileSync(config.manifest, 'utf8'));
  validateManifest(manifest);
  if (config.output && existsSync(config.output)
    && (!lstatSync(config.output).isDirectory() || lstatSync(config.output).isSymbolicLink() || readdirSync(config.output).length)) {
    throw new Error(`Destination must be empty and cannot be a symlink: ${config.output}`);
  }
  checkRequiredInputs(manifest, config.verify);
  const bodies = manifest.archivedFiles.map((record) => sourceBlob(manifest.sourceCommit, record));
  const bytes = bodies.reduce((sum, body) => sum + body.length, 0);
  if (config.output) {
    const target = resolve(config.output);
    for (let i = 0; i < manifest.archivedFiles.length; i++) {
      const path = resolve(target, manifest.archivedFiles[i].path);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bodies[i], { flag: 'wx' });
    }
    console.log(`Restored ${bodies.length} archived files (${bytes} bytes) to ${target}; SHA-256 verified at ${manifest.sourceCommit}.`);
  } else {
    console.log(`Verified ${bodies.length} archived files (${bytes} bytes), ${manifest.preservedInputs.length} unchanged inputs and ${manifest.requiredPaths.length} required paths at ${manifest.sourceCommit}.`);
  }
} catch (error) {
  console.error(`Docs archive: ${error.message}`);
  process.exitCode = 1;
}
