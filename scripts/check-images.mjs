// Checks served image metadata and references without loading an image library.
// This is a byte/dimension contract, not a pixel or maskable-safe-zone audit.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MAX_RASTER_BYTES = 300_000;
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};
const OPTIONS = new Set(['public-dir', 'assets-dir', 'dist-dir', 'html']);
const failures = new Set();
const metadata = new Map();
let checked = 0;

function fail(file, message) { failures.add(`${file}: ${message}`); }
function requireBytes(bytes, minimum, format) {
  if (bytes.length < minimum) throw new Error(`invalid ${format} metadata: truncated file`);
}
function dimensions(width, height, format) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`invalid ${format} dimensions ${width}x${height}`);
  }
  return { width, height };
}

function png(bytes) {
  requireBytes(bytes, 33, 'PNG');
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('invalid PNG signature or IHDR metadata');
  }
  return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20), 'PNG');
}

function jpeg(bytes) {
  requireBytes(bytes, 4, 'JPEG');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('invalid JPEG signature');
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  for (let offset = 2; offset < bytes.length;) {
    if (bytes[offset++] !== 0xff) throw new Error('invalid JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw new Error('invalid JPEG segment length');
    if (sof.has(marker)) {
      if (length < 8 || bytes[offset + 7] < 1 || bytes[offset + 7] > 4 || length !== 8 + 3 * bytes[offset + 7]) {
        throw new Error('invalid JPEG frame metadata');
      }
      return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3), 'JPEG');
    }
    offset += length;
  }
  throw new Error('invalid JPEG metadata: no frame dimensions');
}

function webp(bytes) {
  requireBytes(bytes, 20, 'WebP');
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('invalid WebP RIFF signature');
  }
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length || end < 20) throw new Error('invalid WebP RIFF length');
  for (let offset = 12; offset + 8 <= end;) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + length > end) throw new Error('invalid WebP chunk length');
    if (type === 'VP8X' && length >= 10) {
      return dimensions(1 + bytes.readUIntLE(start + 4, 3), 1 + bytes.readUIntLE(start + 7, 3), 'WebP');
    }
    if (type === 'VP8 ' && length >= 10 && bytes.subarray(start + 3, start + 6).toString('hex') === '9d012a') {
      return dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff, 'WebP');
    }
    if (type === 'VP8L' && length >= 5 && bytes[start] === 0x2f) {
      const bits = bytes.readUInt32LE(start + 1);
      if ((bits >>> 29) !== 0) throw new Error('invalid WebP lossless version');
      return dimensions(1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff), 'WebP');
    }
    offset = start + length + (length & 1);
  }
  throw new Error('invalid WebP metadata: no image dimensions');
}

// ISO BMFF properties belong to items. Read the primary item's associated
// ispe property, rather than mistaking a thumbnail or arbitrary byte string
// for the AVIF canvas. Multiple unassociated dimensions are ambiguous.
function boxes(bytes, start, end) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw new Error('invalid AVIF box header');
    let size = bytes.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) throw new Error('invalid AVIF extended box header');
      const extended = bytes.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('invalid AVIF box size');
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) throw new Error('invalid AVIF box length');
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function avif(bytes) {
  const top = boxes(bytes, 0, bytes.length);
  const ftyp = top.find((box) => box.type === 'ftyp');
  if (!ftyp || ftyp.end - ftyp.start < 8) throw new Error('invalid AVIF ftyp metadata');
  const brands = [bytes.toString('ascii', ftyp.start, ftyp.start + 4)];
  for (let offset = ftyp.start + 8; offset + 4 <= ftyp.end; offset += 4) brands.push(bytes.toString('ascii', offset, offset + 4));
  if (!brands.some((brand) => brand === 'avif' || brand === 'avis')) throw new Error('invalid AVIF compatible brand');
  const meta = top.find((box) => box.type === 'meta');
  if (!meta || meta.end - meta.start < 4) throw new Error('invalid AVIF meta box');
  const children = boxes(bytes, meta.start + 4, meta.end);
  const pitm = children.find((box) => box.type === 'pitm');
  let primary;
  if (pitm) {
    const idSize = bytes[pitm.start] === 0 ? 2 : 4;
    if (pitm.start + 4 + idSize > pitm.end) throw new Error('invalid AVIF primary item');
    primary = bytes.readUIntBE(pitm.start + 4, idSize);
  }
  const iprp = children.find((box) => box.type === 'iprp');
  if (!iprp) throw new Error('invalid AVIF item properties');
  const properties = boxes(bytes, iprp.start, iprp.end);
  const ipco = properties.find((box) => box.type === 'ipco');
  if (!ipco) throw new Error('invalid AVIF property container');
  const entries = boxes(bytes, ipco.start, ipco.end);
  const sizes = new Map();
  for (const [index, entry] of entries.entries()) {
    if (entry.type !== 'ispe') continue;
    if (entry.end - entry.start < 12) throw new Error('invalid AVIF spatial extents');
    sizes.set(index + 1, dimensions(bytes.readUInt32BE(entry.start + 4), bytes.readUInt32BE(entry.start + 8), 'AVIF'));
  }
  for (const ipma of properties.filter((box) => box.type === 'ipma')) {
    if (ipma.end - ipma.start < 8) throw new Error('invalid AVIF associations');
    const idSize = bytes[ipma.start] < 1 ? 2 : 4;
    const associationSize = (bytes.readUIntBE(ipma.start + 1, 3) & 1) ? 2 : 1;
    const count = bytes.readUInt32BE(ipma.start + 4);
    let offset = ipma.start + 8;
    for (let index = 0; index < count; index++) {
      if (offset + idSize + 1 > ipma.end) throw new Error('invalid AVIF item association');
      const id = bytes.readUIntBE(offset, idSize);
      offset += idSize;
      const associations = bytes[offset++];
      for (let entry = 0; entry < associations; entry++) {
        if (offset + associationSize > ipma.end) throw new Error('invalid AVIF property association');
        const property = bytes.readUIntBE(offset, associationSize) & (associationSize === 1 ? 0x7f : 0x7fff);
        offset += associationSize;
        if (id === primary && sizes.has(property)) return sizes.get(property);
      }
    }
  }
  if (sizes.size === 1) return [...sizes.values()][0];
  throw new Error('invalid AVIF metadata: no unambiguous primary dimensions');
}

function ico(bytes) {
  requireBytes(bytes, 6, 'ICO');
  if (bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) throw new Error('invalid ICO directory type');
  const count = bytes.readUInt16LE(4);
  if (!count || bytes.length < 6 + count * 16) throw new Error('invalid ICO directory length');
  const frames = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const width = bytes[entry] || 256;
    const height = bytes[entry + 1] || 256;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (!length || offset < 6 + count * 16 || offset + length > bytes.length) throw new Error('invalid ICO frame bounds');
    const data = bytes.subarray(offset, offset + length);
    let actual;
    if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') actual = png(data);
    else {
      requireBytes(data, 40, 'ICO bitmap');
      if (data.readUInt32LE(0) < 40 || data.readUInt32LE(0) > data.length) throw new Error('invalid ICO bitmap header');
      actual = dimensions(data.readInt32LE(4), data.readInt32LE(8) / 2, 'ICO bitmap');
    }
    if (width !== actual.width || height !== actual.height) {
      throw new Error(`invalid ICO frame dimensions: directory ${width}x${height}, embedded ${actual.width}x${actual.height}`);
    }
    frames.push(actual);
  }
  return frames;
}

function svg(bytes) {
  // Comments and CDATA contain text, not SVG elements or attributes. Read
  // attributes from actual opening tags so data-id cannot define an id.
  const text = bytes.toString('utf8').replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const tags = text.match(/<[A-Za-z_][\w:.-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/g) ?? [];
  const root = tags.find((tag) => /^<svg\b/.test(tag));
  const viewBox = root && attributes(root).viewBox;
  const parts = viewBox?.trim().split(/[\s,]+/).map(Number);
  if (!parts || parts.length !== 4 || !parts.every(Number.isFinite) || parts[2] <= 0 || parts[3] <= 0) {
    throw new Error('invalid SVG viewBox: provide four finite values with positive width and height');
  }
  if (/<(?:[\w-]+:)?metadata\b|\bxmlns:(?:inkscape|sodipodi|rdf|cc|dc)\s*=|\b(?:inkscape|sodipodi):|https?:\/\/(?:[^"'\s>]*\.)?(?:inkscape\.org|sodipodi\.sourceforge\.net|ns\.adobe\.com)\//i.test(text)) {
    throw new Error('SVG contains metadata or an editor namespace/element');
  }
  const entries = tags.map((tag) => attributes(tag));
  const ids = new Set(entries.map((entry) => entry.id).filter(Boolean));
  const cssAttributes = new Set(['style', 'fill', 'stroke', 'filter', 'clip-path', 'mask', 'marker', 'marker-start', 'marker-mid', 'marker-end', 'cursor']);
  const references = entries.flatMap((entry) => [
    ...[entry.href, entry['xlink:href']].filter((value) => value?.startsWith('#')).map((value) => value.slice(1)),
    ...(entry['aria-labelledby']?.trim().split(/\s+/) ?? []),
    ...Object.entries(entry).filter(([name]) => cssAttributes.has(name)).flatMap(([, value]) =>
      [...value.matchAll(/url\(\s*["']?#([^\s)'";]+)["']?\s*\)/g)].map((match) => match[1])),
  ]);
  for (const reference of references) if (!ids.has(reference)) throw new Error(`SVG fragment #${reference} has no matching id`);
  return { width: parts[2], height: parts[3], ids };
}

function image(file) {
  if (metadata.has(file)) return metadata.get(file);
  const extension = path.extname(file).toLowerCase();
  let result = null;
  try {
    const bytes = readFileSync(file);
    const size = extension === '.png' ? png(bytes)
      : extension === '.jpg' || extension === '.jpeg' ? jpeg(bytes)
      : extension === '.webp' ? webp(bytes)
      : extension === '.avif' ? avif(bytes)
      : extension === '.svg' ? svg(bytes)
      : extension === '.ico' ? ico(bytes)
      : extension === '.gif' ? (() => {
        requireBytes(bytes, 10, 'GIF');
        if (!['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) throw new Error('invalid GIF signature');
        return dimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8), 'GIF');
      })() : null;
    if (!size) throw new Error(`unsupported icon image format ${extension || '(no extension)'}`);
    result = { bytes: bytes.length, mime: MIME[extension], sizes: Array.isArray(size) ? size : [size], ids: size.ids };
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

function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity]) return named[entity];
    const number = /^&#x/i.test(entity) ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
    return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}
function attributes(tag, htmlNames = false) {
  return Object.fromEntries([...tag.matchAll(/(?:^|\s)([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map(([, name, double, single, bare]) => [htmlNames ? name.toLowerCase() : name, decode(double ?? single ?? bare)]));
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
