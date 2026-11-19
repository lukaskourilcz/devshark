// Checks served image metadata and references without loading an image library.
// This is a byte/dimension contract, not a pixel or maskable-safe-zone audit.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { attributes, imageMetadata } from './image-metadata.mjs';

const MAX_RASTER_BYTES = 300_000;
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico']);
const OPTIONS = new Set(['public-dir', 'assets-dir', 'dist-dir', 'html']);
const failures = new Set();
const metadata = new Map();
let checked = 0;

function fail(file, message) { failures.add(`${file}: ${message}`); }
function image(file) {
  if (metadata.has(file)) return metadata.get(file);
  let result = null;
  try {
    result = imageMetadata(readFileSync(file), file);
  } catch (error) { fail(file, error.message); }
  metadata.set(file, result);
  return result;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
  });
}

function checkDirectory(directory) {
  for (const file of walk(directory)) {
    const extension = path.extname(file).toLowerCase();
    if (!RASTER.has(extension) && extension !== '.svg') continue;
    checked++;
    const info = image(file);
    if (!info) continue;
    if (RASTER.has(extension) && info.bytes > MAX_RASTER_BYTES) fail(file, `${info.bytes} bytes exceeds the ${MAX_RASTER_BYTES}-byte raster cap`);
    const relative = path.relative(directory, file).split(path.sep).join('/');
    if (RASTER.has(extension) && (relative.startsWith('og/') || /^og-image\./i.test(path.basename(file)))) {
      for (const { width, height } of info.sizes) {
        if (width > 1200 || height > 630) fail(file, `share image ${width}x${height} exceeds 1200x630`);
      }
    }
    // BrandLogo uses both fragments of this external SVG. An optimizer may
    // remove ids that no element inside the SVG itself references.
    if (/^devshark-wordmark(?:-[\w-]+)?\.svg$/i.test(path.basename(file))) {
      for (const id of ['dev', 'shark']) if (!info.ids?.has(id)) fail(file, `external brand fragment #${id} has no matching id`);
    }
  }
}

function localFile(root, reference, from) {
  try {
    const origin = 'https://image-check.invalid';
    const containing = path.relative(root, from);
    // Source client/index.html sits beside public/, not inside it. In that
    // source-only mode it still represents the served root document.
    const inside = containing && !containing.startsWith(`..${path.sep}`) && containing !== '..' && !path.isAbsolute(containing);
    const base = inside ? `/${containing.split(path.sep).map(encodeURIComponent).join('/')}` : '/';
    const url = new URL(reference, origin + base);
    if (url.origin !== origin) throw new Error('must refer to a local image');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('reference escapes the served directory');
    if (!existsSync(file)) throw new Error('file does not exist');
    return file;
  } catch (error) { fail(from, `${reference}: ${error.message}`); return null; }
}

function icon(root, entry, from, required = false) {
  if (!entry.src || typeof entry.src !== 'string') { fail(from, 'icon src is required'); return; }
  const file = localFile(root, entry.src, from);
  if (!file) return;
  const info = image(file);
  if (!info) return;
  if (required && (!entry.type || !entry.sizes)) fail(file, 'manifest icon type and sizes are required');
  const type = entry.type?.toLowerCase();
  if (type && type !== info.mime && !(info.mime === 'image/x-icon' && ['image/vnd.microsoft.icon', 'image/ico'].includes(type))) {
    fail(file, `icon MIME type ${entry.type} does not match ${info.mime}`);
  }
  if (entry.sizes) {
    for (const size of String(entry.sizes).trim().split(/\s+/)) {
      if (size === 'any' && info.mime === 'image/svg+xml') continue;
      const match = size.match(/^([1-9]\d*)x([1-9]\d*)$/);
      if (!match || !info.sizes.some(({ width, height }) => width === Number(match[1]) && height === Number(match[2]))) {
        fail(file, `declared icon size ${size} does not match ${info.sizes.map(({ width, height }) => `${width}x${height}`).join(', ')}`);
      }
    }
  }
}

function manifest(root, file) {
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(document.icons) || !document.icons.length) throw new Error('icons must be a non-empty array');
    for (const entry of document.icons) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { fail(file, 'invalid manifest icon object'); continue; }
      icon(root, entry, file, true);
    }
  } catch (error) { fail(file, `invalid manifest JSON or icons: ${error.message}`); }
}

function html(root, file) {
  if (!existsSync(file)) { fail(file, 'HTML file does not exist'); return; }
  for (const tag of readFileSync(file, 'utf8').match(/<link\b[^>]*>/gi) ?? []) {
    const attr = attributes(tag, true);
    const rel = (attr.rel ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('manifest')) {
      const target = attr.href && localFile(root, attr.href, file);
      if (target) manifest(root, target);
      else if (!attr.href) fail(file, 'manifest link href is required');
    } else if (rel.some((value) => ['icon', 'apple-touch-icon', 'apple-touch-icon-precomposed', 'mask-icon'].includes(value))) {
      icon(root, { src: attr.href, type: attr.type, sizes: attr.sizes }, file);
    }
  }
}

function main() {
  const options = {};
  for (const argument of process.argv.slice(2)) {
    const match = argument.match(/^--([^=]+)=(.+)$/);
    if (!match || !OPTIONS.has(match[1])) {
      throw new Error(`Unknown or empty option ${argument}. Usage: node scripts/check-images.mjs [--public-dir=client/public] [--assets-dir=client/src/assets] [--dist-dir=client/dist] [--html=client/dist/index.html]`);
    }
    options[match[1]] = path.resolve(match[2]);
  }
  const publicDir = options['public-dir'] ?? path.resolve('client/public');
  const assetsDir = options['assets-dir'] ?? path.resolve('client/src/assets');
  const distDir = options['dist-dir'] ?? path.resolve('client/dist');
  for (const directory of [publicDir, assetsDir]) {
    if (!existsSync(directory)) fail(directory, 'source image directory does not exist');
    else checkDirectory(directory);
  }
  const built = existsSync(distDir);
  if (built) checkDirectory(distDir);
  else if (options['dist-dir']) fail(distDir, 'built image directory does not exist');
  const root = built ? distDir : publicDir;
  const document = options.html ?? (built ? path.join(distDir, 'index.html') : path.resolve('client/index.html'));
  html(root, document);
  // Check the generated manifest even if a future HTML edit removes its link.
  const generated = path.join(root, 'manifest.webmanifest');
  if (existsSync(generated)) manifest(root, generated);
  else if (built) fail(generated, 'generated manifest file does not exist');
  for (const failure of failures) console.error(failure);
  console.log(`Images: ${checked} images checked across source${built ? ' and build' : ' (build absent)'}; ${failures.size} failure(s). Raster cap ${MAX_RASTER_BYTES} bytes; share cap 1200x630.`);
  if (failures.size) process.exitCode = 1;
}

try { main(); } catch (error) { console.error(`Image check: ${error.message}`); process.exitCode = 1; }
