// Deterministic source inventory; lexical reference candidates are not reachability.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IMAGE_EXTENSIONS, imageMetadata } from './image-metadata.mjs';

const SOURCE_ROOTS = ['client/public', 'client/src/assets'];
const CODE_ROOTS = ['client/src', 'client/index.html', 'client/vite.config.ts', 'client/product-catalog.ts', 'client/sandbox', 'api', 'lib', 'shared', 'vercel.json'];
const DOC_ROOTS = ['docs', 'README.md', 'NEEDED.md', 'about-project.md', 'scaling.md', 'monetization.md'];
const TEXT = /\.(?:tsx?|jsx?|mjs|cjs|html|css|json|webmanifest|svg|md|txt)$/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slash = value => value.split(path.sep).join('/');
const hash = value => createHash('sha256').update(value).digest('hex');
const within = (root, file) => file === root || file.startsWith(root + path.sep);
function walk(directory, skipped, root) {
  // The fixed scan roots may hide an aliased ancestor even when their final
  // component is a regular directory. Refuse it before reading file bytes.
  if (!within(root, directory) || realpathSync(path.dirname(directory)) !== path.dirname(directory)) {
    throw new Error('Inventory input traverses a symlinked ancestor: ' + slash(path.relative(root, directory)));
  }
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink()) { skipped.add(directory); return []; }
  if (stat.isFile()) return [directory];
  if (!stat.isDirectory()) return [];
  return readdirSync(directory).sort(compare).flatMap(name => walk(path.join(directory, name), skipped, root));
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map(key => [key, ordered(value[key])]));
  return value;
}
function fileRecord(root, file) {
  const bytes = readFileSync(file), extension = path.extname(file).toLowerCase();
  const row = { path: slash(path.relative(root, file)), bytes: bytes.length, sha256: hash(bytes), format: extension.slice(1) || 'unknown', metadataStatus: 'not-decoded', intrinsicSizes: null, dimensionBasis: null, metadataError: null };
  if (IMAGE_EXTENSIONS.includes(extension)) {
    try {
      const metadata = imageMetadata(bytes, file);
      row.metadataStatus = 'decoded'; row.intrinsicSizes = metadata.sizes;
      row.dimensionBasis = extension === '.svg' ? 'SVG viewBox extents from the shared F4 validator; fixed rendered width/height not established' : 'raster header/frame dimensions';
    } catch (error) { row.metadataStatus = 'invalid'; row.metadataError = String(error.message); }
  }
  return row;
}
function hints(line) {
  const result = {};
  for (const name of ['width', 'height', 'sizes']) {
    const match = line.match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"\\n]{1,100})"|\'([^\'\\n]{1,100})\'|\\{(\\d+(?:\\.\\d+)?)\\})'));
    if (match) result[name] = match[1] ?? match[2] ?? match[3];
  }
  const width = line.match(/(?:^|[;{\s])width\s*:\s*([^;}\n]{1,100})/);
  if (width) result.cssWidth = width[1].trim();
  return { status: 'unknown-rendered-size', sourceLineHints: result, limitation: 'Same-line text only; no computed CSS, viewport, component dataflow or browser measurement' };
}
function references(root, files, assets, excluded, skipped) {
  const inputs = [], skippedText = [];
  for (const file of files) {
    if (excluded.has(file) || !TEXT.test(file)) continue;
    const bytes = readFileSync(file), relative = slash(path.relative(root, file));
    inputs.push({ path: relative, sha256: hash(bytes) });
    if (bytes.length > 4 * 1024 * 1024) { skippedText.push(relative); continue; }
    const kind = /(?:^docs\/|\.(?:md|txt)$)/i.test(relative) ? 'documentation' : relative.startsWith('client/public/') ? 'static-text' : 'code-text';
    for (const [lineIndex, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
      const literals = [...line.matchAll(/(["'`])([^"'`\r\n]+)\1/g)].map(match => match[2]).filter(value => !value.includes('${'));
      literals.push(...[...line.matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g)].map(match => match[2].trim()).filter(value => !value.includes('${')));
      const templates = [...line.matchAll(/`([^`\r\n]*?)\$\{/g)].map(match => match[1]);
      for (const asset of assets) {
        const absolute = path.join(root, asset.path), publicPath = asset.path.startsWith('client/public/') ? '/' + asset.path.slice('client/public/'.length) : null;
        const exact = literals.some(value => {
          const bare = value.split(/[?#]/)[0];
          return (publicPath && bare === publicPath) || (!bare.startsWith('/') && path.resolve(path.dirname(file), bare) === absolute) || bare === asset.path;
        });
        const basename = path.basename(asset.path);
        const basenameCandidate = !exact && line.includes(basename);
        if (exact || basenameCandidate) asset.references.push({ file: relative, line: lineIndex + 1, kind, match: exact ? 'literal-path' : 'basename-candidate', rendered: hints(line) });
        for (const prefix of templates) {
          const matches = publicPath && prefix.startsWith('/') ? publicPath.startsWith(prefix) : prefix && within(path.resolve(path.dirname(file), prefix), absolute);
          if (matches) asset.dynamicReferences.push({ file: relative, line: lineIndex + 1, kind, prefix, certainty: 'prefix candidate only; per-file reachability and rendered size unknown' });
        }
      }
    }
  }
  return { limitations: ['Lexical text candidates, including comments; not a reachability or unused-file proof', 'Basenames can collide; template prefixes are candidates only', 'Concatenated/indirect/bundler-aliased/runtime paths and multiline CSS/props are not exhaustively resolved', 'Rendered sizes remain unknown; hints are same-line source text only', 'Files over4MiB and symlinks are listed as unscanned rather than followed'], inputs, skippedText, skippedSymlinks: [...skipped].map(file => slash(path.relative(root, file))).sort(compare) };
}
function summary(rows) {
  const byFormat = Object.create(null);
  for (const row of rows) { const group = byFormat[row.format] ??= { files: 0, bytes: 0 }; group.files++; group.bytes += row.bytes; }
  return { files: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), byFormat, invalidMetadata: rows.filter(row => row.metadataStatus === 'invalid').map(row => row.path) };
}

export function collectImageInventory(projectRoot, { distDir = null, exclude = [] } = {}) {
  const root = realpathSync(projectRoot), skipped = new Set(), excluded = new Set(exclude.map(file => path.resolve(file)));
  const sourceFiles = SOURCE_ROOTS.flatMap(directory => {
    const file = path.join(root, directory);
    if (!existsSync(file)) throw new Error('Missing source inventory directory: ' + directory);
    return walk(file, skipped, root);
  }).sort(compare);
  const entries = sourceFiles.map(file => ({ ...fileRecord(root, file), references: [], dynamicReferences: [] }));
  const scanFiles = [...new Set([...sourceFiles, ...[...CODE_ROOTS, ...DOC_ROOTS].flatMap(relative => existsSync(path.join(root, relative)) ? walk(path.join(root, relative), skipped, root) : [])])].sort(compare);
  const coverage = references(root, scanFiles, entries, excluded, skipped);
  const noCodeLiteral = entries.filter(row => !row.references.some(reference => reference.kind === 'code-text' && reference.match === 'literal-path'));
  let build = { status: 'not-requested', limitation: 'Source files and built/generated images are separate scopes. No dist snapshot was read.' };
  if (distDir) {
    const requested = path.resolve(root, distDir);
    if (!within(root, requested) || realpathSync(path.dirname(requested)) !== path.dirname(requested) || lstatSync(requested).isSymbolicLink()) {
      throw new Error('Build directory must stay inside the project root without symlink aliases');
    }
    const directory = realpathSync(requested);
    if (!within(root, directory)) throw new Error('Build directory must stay inside the project root');
    const buildSkipped = new Set();
    const rows = walk(directory, buildSkipped, root).filter(file => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())).sort(compare).map(file => {
      const row = fileRecord(directory, file); return { ...row, origin: 'built/generated image; source/package attribution not established' };
    });
    const og = rows.filter(row => row.path.startsWith('og/'));
    build = { skippedSymlinks: [...buildSkipped].map(file => slash(path.relative(directory, file))).sort(compare), status: 'explicit-dist-snapshot', matchingSourceRevision: 'not established by this filesystem inventory', summary: summary(rows), generatedOg: summary(og), largest: [...rows].sort((a, b) => b.bytes - a.bytes || compare(a.path, b.path)).slice(0, 10), entries: rows };
  }
  return ordered({ kind: 'image-inventory', schemaVersion: 1, tools: { inventorySha256: hash(readFileSync(fileURLToPath(import.meta.url))), decoderSha256: hash(readFileSync(fileURLToPath(new URL('./image-metadata.mjs', import.meta.url)))) }, scope: 'Every regular source file under client/public and client/src/assets, including files not decoded as images. Format labels come from extensions; supported image headers are validated. Reference candidates are lexical, not proof of served reachability or absence.', sourceRoots: SOURCE_ROOTS, source: { summary: { ...summary(entries), noCodeLiteralReferences: { files: noCodeLiteral.length, bytes: noCodeLiteral.reduce((sum, row) => sum + row.bytes, 0), limitation: 'Not an unused-file proof; basename, dynamic, runtime and unscanned references may exist' } }, entries }, referenceCoverage: coverage, build });
}

function inventoryArguments(argv) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(output|dist-dir)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new Error('Usage: node scripts/audit-image-inventory.mjs --output=<file.json> [--dist-dir=client/dist]');
    options[match[1]] = match[2];
  }
  if (!options.output || !options.output.endsWith('.json')) throw new Error('An explicit --output=<file.json> is required');
  return options;
}
function inventoryTarget(output) {
  const requested = path.resolve(output), requestedDirectory = path.dirname(requested);
  if (existsSync(requestedDirectory) && lstatSync(requestedDirectory).isSymbolicLink()) throw new Error('Output directory must not be a symlink');
  let directory = requestedDirectory; const missing = [];
  while (!existsSync(directory)) { missing.unshift(path.basename(directory)); directory = path.dirname(directory); }
  directory = path.join(realpathSync(directory), ...missing);
  return path.join(directory, path.basename(requested));
}
function writeInventory(target, report) {
  const directory = path.dirname(target); mkdirSync(directory, { recursive: true });
  const check = () => {
    if (realpathSync(directory) !== directory || lstatSync(directory).isSymbolicLink()) throw new Error('Output directory changed');
    try {
      const stat = lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) throw new Error('Output must be one bounded regular inventory report');
      if (JSON.parse(readFileSync(target, 'utf8')).kind !== 'image-inventory') throw new Error('Refusing to replace an unrelated file');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  check(); const temporary = path.join(directory, '.image-inventory-' + randomUUID() + '.tmp');
  const json = JSON.stringify(report, null, 2) + '\n';
  if (Buffer.byteLength(json) > 16 * 1024 * 1024) throw new Error('Inventory exceeds the 16MiB report bound');
  try { writeFileSync(temporary, json, { flag: 'wx', mode: 0o600 }); check(); renameSync(temporary, target); }
  finally { rmSync(temporary, { force: true }); }
}
function invokedDirectly() { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } }
if (invokedDirectly()) {
  try {
    const args = inventoryArguments(process.argv.slice(2)), root = realpathSync(process.cwd()), output = inventoryTarget(args.output);
    if ([...SOURCE_ROOTS, ...CODE_ROOTS].some(relative => within(path.join(root, relative), output))) throw new Error('Output must not replace a source inventory or code input');
    const report = collectImageInventory(root, { distDir: args['dist-dir'] ?? null, exclude: [output] });
    writeInventory(output, report); console.log(`Image inventory: ${report.source.summary.files} source files; ${report.source.summary.bytes} bytes. ${report.source.summary.invalidMetadata.length} metadata error(s). No reachability/rendered-size claim.`);
  } catch (error) { console.error('Image inventory: ' + error.message); process.exitCode = 1; }
}
