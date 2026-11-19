// F1 inventory fixtures only: no source inventory, build, browser or network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const metadataUrl = new URL('./image-metadata.mjs', import.meta.url);
const inventoryUrl = new URL('./audit-image-inventory.mjs', import.meta.url);
function scratch(t) { const root = mkdtempSync(join(tmpdir(), 'devshark-inventory-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
function put(root, file, bytes) { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); return target; }
// Minimal metadata headers, deliberately not pixel-decoder fixtures.
function png(w, h) { const b = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; }
function webp(kind, w, h) {
  const data = Buffer.alloc(kind === 'VP8L' ? 6 : 10);
  if (kind === 'VP8X') { data.writeUIntLE(w - 1, 4, 3); data.writeUIntLE(h - 1, 7, 3); }
  else if (kind === 'VP8L') { data[0] = 0x2f; data.writeUInt32LE(((h - 1) << 14) | (w - 1), 1); }
  else { Buffer.from('9d012a', 'hex').copy(data, 3); data.writeUInt16LE(w, 6); data.writeUInt16LE(h, 8); }
  const b = Buffer.alloc(20 + data.length); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8); b.write(kind, 12); b.writeUInt32LE(data.length, 16); data.copy(b, 20); return b;
}
function ico() { const image = png(3, 2), b = Buffer.alloc(22 + image.length); b.writeUInt16LE(1, 2); b.writeUInt16LE(1, 4); b[6] = 3; b[7] = 2; b.writeUInt32LE(image.length, 14); b.writeUInt32LE(22, 18); image.copy(b, 22); return b; }

test('inventory decoder imports without running the image checker or touching cwd', (t) => {
  const root = scratch(t);
  for (const url of [metadataUrl, inventoryUrl]) {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(url.href)});`], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout, ''); assert.equal(run.stderr, ''); assert.deepEqual(readdirSync(root), []);
  }
});

test('shared metadata decoder preserves PNG/GIF/WebP/ICO/SVG dimensions and refusal semantics', async () => {
  const { imageMetadata } = await import(metadataUrl);
  assert.deepEqual(imageMetadata(png(3, 2), 'x.PNG').sizes, [{ width: 3, height: 2 }]);
  const gif = Buffer.from('47494638396103000200', 'hex'); assert.deepEqual(imageMetadata(gif, 'x.gif').sizes, [{ width: 3, height: 2 }]);
  for (const kind of ['VP8 ', 'VP8L', 'VP8X']) assert.deepEqual(imageMetadata(webp(kind, 3, 2), 'x.webp').sizes, [{ width: 3, height: 2 }], kind);
  assert.deepEqual(imageMetadata(ico(), 'x.ico').sizes, [{ width: 3, height: 2 }]);
  const svg = imageMetadata(Buffer.from('<svg viewBox="0 0 12 8"><path id="dev"/><use href="#dev"/></svg>'), 'x.svg');
  assert.deepEqual(svg.sizes.map(({ width, height }) => ({ width, height })), [{ width: 12, height: 8 }]);
  assert.equal(svg.ids.has('dev'), true); assert.equal(svg.sizes[0].ids, svg.ids, 'the F4 SVG metadata shape keeps its original shared id set');
  assert.throws(() => imageMetadata(Buffer.from('<svg width="12" height="8"/>'), 'x.svg'), /viewBox/, 'F4 still requires a valid viewBox');
  assert.throws(() => imageMetadata(Buffer.from('<svg viewBox="0 0 12 8"><use href="#missing"/></svg>'), 'x.svg'), /no matching id/);
  assert.throws(() => imageMetadata(Buffer.from([1]), 'x.png'), /truncated/); assert.throws(() => imageMetadata(png(0, 2), 'x.png'), /dimensions/);
  assert.throws(() => imageMetadata(Buffer.from('unknown'), 'x.xyz'), /unsupported/);
});

function project(t) {
  const root = scratch(t);
  put(root, 'client/public/brand/a.svg', '<svg viewBox="0 0 12 8"/>'); put(root, 'client/public/brand/b.svg', '<svg viewBox="0 0 16 16"/>');
  put(root, 'client/public/bad.png', Buffer.from([1])); put(root, 'client/public/config.json', '{}'); put(root, 'client/public/unknown.bin', 'unknown bytes'); put(root, 'client/public/readme.md', 'a.svg documentation only');
  put(root, 'client/src/assets/tile.png', png(3, 2));
  put(root, 'client/src/App.tsx', 'import tile from "./assets/tile.png";\nconst a = <img src="/brand/a.svg" width={24} height="16" sizes="50vw"/>;\nconst b = `/brand/${name}.svg`;');
  put(root, 'client/src/style.css', '.brand { background: url(/brand/b.svg); width: 40px; }'); put(root, 'docs/usage.md', '![brand](/brand/b.svg)');
  return root;
}

test('inventory lists all regular source files and labels literal/docs/basename/dynamic candidates honestly', async (t) => {
  const { collectImageInventory } = await import(inventoryUrl), root = project(t);
  const report = collectImageInventory(root);
  assert.deepEqual(report.source.entries.map(row => row.path), ['client/public/bad.png', 'client/public/brand/a.svg', 'client/public/brand/b.svg', 'client/public/config.json', 'client/public/readme.md', 'client/public/unknown.bin', 'client/src/assets/tile.png']);
  const a = report.source.entries.find(row => row.path.endsWith('/a.svg')), b = report.source.entries.find(row => row.path.endsWith('/b.svg'));
  assert.ok(a.references.some(ref => ref.file === 'client/src/App.tsx' && ref.match === 'literal-path' && ref.rendered.sourceLineHints.width === '24'));
  assert.ok(a.references.some(ref => ref.kind === 'documentation' && ref.match === 'basename-candidate'));
  assert.ok(b.references.some(ref => ref.file.endsWith('.css') && ref.match === 'literal-path' && ref.rendered.sourceLineHints.cssWidth === '40px'));
  assert.ok(b.references.some(ref => ref.kind === 'documentation')); assert.equal(a.dynamicReferences.length, 1); assert.equal(b.dynamicReferences.length, 1);
  assert.equal(a.references.every(ref => ref.rendered.status === 'unknown-rendered-size'), true);
  const invalid = report.source.entries.find(row => row.path.endsWith('/bad.png')); assert.equal(invalid.metadataStatus, 'invalid'); assert.equal(invalid.intrinsicSizes, null); assert.match(invalid.metadataError, /truncated/);
  const json = report.source.entries.find(row => row.path.endsWith('/config.json')); assert.equal(json.metadataStatus, 'not-decoded'); assert.equal(json.format, 'json'); assert.equal(json.sha256.length, 64);
  const unknown = report.source.entries.find(row => row.path.endsWith('/unknown.bin')); assert.equal(unknown.metadataStatus, 'not-decoded'); assert.equal(unknown.intrinsicSizes, null);
  assert.equal(report.build.status, 'not-requested'); assert.deepEqual(collectImageInventory(root), report, 'no timestamp, absolute temp root or mtime affects the inventory');
});

test('source and explicit built image scopes remain separate, including unknown metadata and symlinks', async (t) => {
  const { collectImageInventory } = await import(inventoryUrl), root = project(t);
  put(root, 'client/dist/og/example.png', png(4, 3)); put(root, 'client/dist/assets/package.svg', '<svg viewBox="0 0 2 2"/>');
  const outside = scratch(t); const file = put(outside, 'outside.svg', '<svg viewBox="0 0 99 99"/>'); symlinkSync(file, join(root, 'client/public/escape.svg'));
  const before = collectImageInventory(root), built = collectImageInventory(root, { distDir: 'client/dist' });
  assert.deepEqual(before.source, built.source); assert.equal(built.build.summary.files, 2); assert.equal(built.build.generatedOg.files, 1); assert.equal(built.build.matchingSourceRevision, 'not established by this filesystem inventory');
  assert.deepEqual(built.referenceCoverage.skippedSymlinks, ['client/public/escape.svg']);
  rmSync(join(root, 'client/src/assets'), { recursive: true }); assert.throws(() => collectImageInventory(root), /Missing source inventory directory/);
});

test('inventory CLI writes deterministic JSON twice and refuses unsafe/unrelated outputs', (t) => {
  const root = project(t), output = join(root, 'docs/audit/inventory.json');
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(inventoryUrl), ...args], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  const first = run('--output=' + output); assert.equal(first.status, 0, first.stderr); const bytes = readFileSync(output);
  const second = run('--output=' + output); assert.equal(second.status, 0, second.stderr); assert.deepEqual(readFileSync(output), bytes, 'output excludes its own source/doc reference input');
  assert.notEqual(run().status, 0); assert.notEqual(run('--output=x.json', '--unknown=1').status, 0);
  const original = readFileSync(join(root, 'client/public/config.json')); assert.notEqual(run('--output=client/public/config.json').status, 0); assert.deepEqual(readFileSync(join(root, 'client/public/config.json')), original);
  const unrelated = put(root, 'docs/unrelated.json', '{"keep":true}'); assert.notEqual(run('--output=' + unrelated).status, 0); assert.equal(readFileSync(unrelated, 'utf8'), '{"keep":true}');
  const alias = join(root, 'docs/alias.json'); symlinkSync(unrelated, alias); assert.notEqual(run('--output=' + alias).status, 0); assert.equal(readFileSync(unrelated, 'utf8'), '{"keep":true}');
});


test('all-file format groups are own data even for prototype-shaped extensions', async (t) => {
  const { collectImageInventory } = await import(inventoryUrl), root = project(t);
  put(root, 'client/public/a.__proto__', 'abc'); put(root, 'client/public/b.constructor', 'abcd');
  const targets = [Object.prototype, Object];
  const before = targets.map(target => new Map(['files', 'bytes'].map(key => [key, Object.getOwnPropertyDescriptor(target, key)])));
  try {
    const report = collectImageInventory(root), groups = report.source.summary.byFormat;
    assert.equal(report.source.summary.files, 9, 'both unknown-format regular files are inventoried');
    assert.equal(Object.hasOwn(groups, '__proto__'), true); assert.deepEqual(groups.__proto__, { bytes: 3, files: 1 });
    assert.equal(Object.hasOwn(groups, 'constructor'), true); assert.deepEqual(groups.constructor, { bytes: 4, files: 1 });
    assert.equal(Object.getPrototypeOf(groups), Object.prototype, 'ordered output holds own data keys without changing its prototype');
    for (const [index, target] of targets.entries()) for (const [key, descriptor] of before[index]) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(target, key), descriptor, 'format grouping never mutates a built-in object');
    }
  } finally {
    // A red run must not contaminate the remaining fixtures if it hit the old bug.
    for (const [index, target] of targets.entries()) for (const [key, descriptor] of before[index]) {
      if (descriptor) Object.defineProperty(target, key, descriptor); else delete target[key];
    }
  }
});

test('source scan roots refuse symlinked ancestors before reading outside files', async (t) => {
  const { collectImageInventory } = await import(inventoryUrl), root = scratch(t), outside = scratch(t);
  put(outside, 'public/private.svg', '<svg viewBox="0 0 99 99"/>'); put(outside, 'src/assets/private.png', png(3, 2));
  symlinkSync(outside, join(root, 'client'));
  assert.throws(() => collectImageInventory(root), /symlinked ancestor/);
  const run = spawnSync(process.execPath, [fileURLToPath(inventoryUrl), '--output=client/public/report.json'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /symlinked ancestor/);
  assert.equal(existsSync(join(outside, 'public/report.json')), false, 'an output alias into the real source tree writes nothing');
  assert.equal(readFileSync(join(outside, 'public/private.svg'), 'utf8'), '<svg viewBox="0 0 99 99"/>');
});

test('nested source/output aliases and explicit dist aliases are refused', async (t) => {
  const { collectImageInventory } = await import(inventoryUrl), root = project(t), outside = scratch(t);
  put(outside, 'assets/private.png', png(3, 2)); rmSync(join(root, 'client/src'), { recursive: true });
  symlinkSync(outside, join(root, 'client/src'));
  assert.throws(() => collectImageInventory(root), /symlinked ancestor/);

  const normal = project(t); mkdirSync(join(normal, 'client/public/nested')); mkdirSync(join(normal, 'docs/aliases'));
  symlinkSync(join(normal, 'client/public'), join(normal, 'docs/aliases/source'));
  const run = spawnSync(process.execPath, [fileURLToPath(inventoryUrl), '--output=docs/aliases/source/nested/report.json'], { cwd: normal, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10000 });
  assert.notEqual(run.status, 0); assert.match(run.stderr, /source inventory or code input/);
  assert.equal(existsSync(join(normal, 'client/public/nested/report.json')), false);

  put(normal, 'client/dist/og/example.png', png(4, 3)); symlinkSync(join(normal, 'client/dist'), join(normal, 'client/dist-alias'));
  assert.throws(() => collectImageInventory(normal, { distDir: 'client/dist-alias' }), /without symlink aliases/);
});
