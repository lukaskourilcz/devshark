// Image release contracts for F4. The fixtures stay in a temporary directory;
// these tests never build the client or alter the served brand files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const checker = fileURLToPath(new URL('./check-images.mjs', import.meta.url));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-labelledby="brand"><title id="brand">devShark</title><path id="dev" d="M4 28 16 4 28 28Z"/><use href="#dev"/></svg>';
const pngs = new Map();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4);
  return result;
}

function png(width, height) {
  const key = `${width}x${height}`;
  if (pngs.has(key)) return Buffer.from(pngs.get(key));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const offset = row * (width * 4 + 1) + 1 + column * 4;
      pixels.set([45, 122, 45, 255], offset);
    }
  }
  const result = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
  pngs.set(key, result);
  return Buffer.from(result);
}

function box(type, data) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length + 8);
  header.write(type, 4);
  return Buffer.concat([header, data]);
}

function avif(width, height) {
  const extents = (w, h) => {
    const value = Buffer.alloc(12);
    value.writeUInt32BE(w, 4);
    value.writeUInt32BE(h, 8);
    return box('ispe', value);
  };
  const primary = Buffer.from([0, 0, 0, 0, 0, 1]);
  // Item 1 uses property 2. Property 1 belongs to another item, so a
  // substring search for the first ispe would report the wrong dimensions.
  const association = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 2]);
  return Buffer.concat([
    box('ftyp', Buffer.from('6176696600000000617669666d696631', 'hex')),
    box('meta', Buffer.concat([Buffer.alloc(4), box('pitm', primary), box('iprp', Buffer.concat([
      box('ipco', Buffer.concat([extents(4000, 4000), extents(width, height)])), box('ipma', association),
    ]))])),
  ]);
}

function webp(width, height, kind) {
  let payload;
  if (kind === 'VP8X') {
    payload = Buffer.alloc(10);
    payload.writeUIntLE(width - 1, 4, 3);
    payload.writeUIntLE(height - 1, 7, 3);
  } else if (kind === 'VP8L') {
    payload = Buffer.alloc(6);
    payload[0] = 0x2f;
    payload.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  } else {
    payload = Buffer.alloc(10);
    Buffer.from('9d012a', 'hex').copy(payload, 3);
    payload.writeUInt16LE(width, 6);
    payload.writeUInt16LE(height, 8);
  }
  const image = Buffer.alloc(payload.length + 8);
  image.write(kind);
  image.writeUInt32LE(payload.length, 4);
  payload.copy(image, 8);
  const header = Buffer.alloc(12);
  header.write('RIFF');
  header.writeUInt32LE(image.length + 4, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, image]);
}

function ico(sizes) {
  const images = sizes.map((size) => png(size, size));
  const directory = Buffer.alloc(6 + 16 * sizes.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(sizes.length, 4);
  let offset = directory.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(images[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  return Buffer.concat([directory, ...images]);
}

function put(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devshark-images-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publicDir = join(root, 'public');
  const assetsDir = join(root, 'assets');
  const distDir = join(root, 'dist');
  const html = join(distDir, 'index.html');
  for (const directory of [publicDir, assetsDir, distDir]) mkdirSync(directory);
  const manifest = { name: 'devShark', icons: [
    { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
    { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any maskable' },
    { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any maskable' },
  ] };
  for (const directory of [publicDir, distDir]) {
    put(join(directory, 'icon.svg'), SVG);
    put(join(directory, 'favicon.ico'), ico([16, 32]));
    put(join(directory, 'icon-192.png'), png(192, 192));
    put(join(directory, 'icon-512.png'), png(512, 512));
    put(join(directory, 'og-image.png'), png(1200, 630));
    put(join(directory, 'manifest.webmanifest'), JSON.stringify(manifest));
  }
  put(html, '<!doctype html><html lang="en"><head><link rel="icon" type="image/svg+xml" href="/icon.svg?v=1"><link rel="icon" type="image/x-icon" sizes="16x16 32x32" href="/favicon.ico"><link rel="apple-touch-icon" sizes="192x192" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"></head><body></body></html>');
  put(join(assetsDir, 'brand.svg'), SVG);
  put(join(distDir, 'og', 'coding', 'example.png'), png(1200, 630));
  function run() {
    const result = spawnSync(process.execPath, [checker, `--public-dir=${publicDir}`, `--assets-dir=${assetsDir}`, `--dist-dir=${distDir}`, `--html=${html}`], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.error, undefined, 'the checker process finishes');
    return { ...result, output: result.stdout + result.stderr };
  }
  function writeManifest(value) { put(join(distDir, 'manifest.webmanifest'), JSON.stringify(value)); }
  return { publicDir, assetsDir, distDir, html, manifest, run, writeManifest };
}

function refused(run, message) {
  assert.notEqual(run.status, 0, 'invalid served images fail the release check');
  assert.match(run.output, message);
}

test('valid source, built share cards, ICO sizes and accessible SVG fragments pass without rewriting files', (t) => {
  const data = fixture(t);
  const before = readFileSync(join(data.assetsDir, 'brand.svg'), 'utf8');
  const run = data.run();
  assert.equal(run.status, 0, run.output);
  assert.match(run.output, /image/i);
  assert.equal(readFileSync(join(data.assetsDir, 'brand.svg'), 'utf8'), before);
  assert.match(before, /aria-labelledby="brand"/);
  assert.match(before, /href="#dev"/);
});

for (const area of ['publicDir', 'distDir']) {
  test(`a ${area} raster over the 300000-byte cap fails`, (t) => {
    const data = fixture(t);
    const oversized = Buffer.alloc(300001);
    png(8, 8).copy(oversized);
    put(join(data[area], 'too-large.png'), oversized);
    refused(data.run(), /too-large\.png[^\n]*(?:300001|300,001|300000|300,000)/);
  });
}

for (const [width, height] of [[1201, 630], [1200, 631]]) {
  test(`a built share card at ${width}x${height} exceeds the Open Graph dimension cap`, (t) => {
    const data = fixture(t);
    put(join(data.distDir, 'og', 'coding', 'oversized.png'), png(width, height));
    refused(data.run(), /oversized\.png[^\n]*(?:1200|630)/);
  });
}

test('a source brand share image over 1200x630 fails before a build', (t) => {
  const data = fixture(t);
  put(join(data.publicDir, 'og-image.png'), png(1201, 630));
  refused(data.run(), /og-image\.png[^\n]*1200/);
});

test('a PNG with an invalid zero dimension fails metadata validation', (t) => {
  const data = fixture(t);
  const invalid = png(8, 8);
  invalid.writeUInt32BE(0, 16);
  put(join(data.assetsDir, 'invalid.png'), invalid);
  refused(data.run(), /invalid\.png[^\n]*(?:dimension|width|PNG|metadata)/i);
});

test('HTML icon links must resolve to an existing built file', (t) => {
  const data = fixture(t);
  put(data.html, readFileSync(data.html, 'utf8').replace('/icon.svg?v=1', '/missing.svg'));
  refused(data.run(), /missing\.svg/);
});

test('HTML icon MIME types must match the file contents', (t) => {
  const data = fixture(t);
  put(data.html, readFileSync(data.html, 'utf8').replace('type="image/svg+xml"', 'type="image/png"'));
  refused(data.run(), /icon\.svg[^\n]*(?:type|MIME|image\/png)/i);
});

test('HTML icon sizes must match an actual raster or ICO size', (t) => {
  const data = fixture(t);
  put(data.html, readFileSync(data.html, 'utf8').replace('sizes="16x16 32x32"', 'sizes="16x16 48x48"'));
  refused(data.run(), /favicon\.ico[^\n]*(?:48x48|size|dimension)/i);
});

test('a generated manifest icon must exist', (t) => {
  const data = fixture(t);
  data.manifest.icons[1].src = '/missing-192.png';
  data.writeManifest(data.manifest);
  refused(data.run(), /missing-192\.png/);
});

test('a generated manifest must declare the icon file type', (t) => {
  const data = fixture(t);
  data.manifest.icons[1].type = 'image/jpeg';
  data.writeManifest(data.manifest);
  refused(data.run(), /icon-192\.png[^\n]*(?:type|MIME|image\/jpeg)/i);
});

test('generated manifest icon dimensions must equal its declared sizes', (t) => {
  const data = fixture(t);
  put(join(data.distDir, 'icon-192.png'), png(128, 128));
  refused(data.run(), /icon-192\.png[^\n]*(?:192x192|128x128|dimension)/i);
});

test('an existing icon with invalid bytes fails even when its extension and manifest agree', (t) => {
  const data = fixture(t);
  put(join(data.distDir, 'icon-192.png'), 'not a PNG');
  refused(data.run(), /icon-192\.png[^\n]*(?:invalid|PNG|metadata|format)/i);
});

test('ICO directory dimensions must match the embedded PNG frame', (t) => {
  const data = fixture(t);
  const invalid = ico([32]);
  invalid[6] = invalid[7] = 16;
  put(join(data.publicDir, 'incorrect.ico'), invalid);
  refused(data.run(), /incorrect\.ico[^\n]*(?:16x16|32x32|dimension)/i);
});

test('a Windows cursor cannot pass as an ICO just by its extension', (t) => {
  const data = fixture(t);
  const invalid = ico([32]);
  invalid.writeUInt16LE(2, 2);
  put(join(data.publicDir, 'cursor.ico'), invalid);
  refused(data.run(), /cursor\.ico[^\n]*(?:type|ICO)/i);
});

for (const kind of ['VP8X', 'VP8L', 'VP8 ']) {
  test(`WebP ${kind.trim()} metadata enforces the actual share dimensions`, (t) => {
    const data = fixture(t);
    put(join(data.distDir, 'og', 'too-wide.webp'), webp(1201, 630, kind));
    refused(data.run(), /too-wide\.webp[^\n]*1201x630/);
  });
}

test('AVIF reads the primary item rather than another item or an ispe substring', (t) => {
  const data = fixture(t);
  put(join(data.distDir, 'og', 'valid.avif'), avif(1200, 630));
  const run = data.run();
  assert.equal(run.status, 0, run.output);
  put(join(data.distDir, 'og', 'too-tall.avif'), avif(1200, 631));
  refused(data.run(), /too-tall\.avif[^\n]*1200x631/);
});

test('JPEG dimensions come from a bounded SOF segment', (t) => {
  const data = fixture(t);
  const jpeg = Buffer.from('ffd8ffc0000b08027704b001011100ffd9', 'hex');
  put(join(data.distDir, 'og', 'too-tall.jpg'), jpeg);
  refused(data.run(), /too-tall\.jpg[^\n]*1200x631/);
});

test('the external wordmark retains both dev and shark fragment ids', (t) => {
  const data = fixture(t);
  put(join(data.assetsDir, 'devshark-wordmark.svg'), SVG);
  refused(data.run(), /devshark-wordmark\.svg[^\n]*#shark/);
  put(join(data.assetsDir, 'devshark-wordmark.svg'), SVG.replace('</svg>', '<path id="shark" d="M1 1h1v1Z"/></svg>'));
  const run = data.run();
  assert.equal(run.status, 0, run.output);
});

test('internal SVG use and accessible-name references must resolve', (t) => {
  const data = fixture(t);
  put(join(data.assetsDir, 'broken.svg'), SVG.replace('href="#dev"', 'href="#missing"'));
  refused(data.run(), /broken\.svg[^\n]*#missing/);
});

test('an invalid generated manifest fails with its path', (t) => {
  const data = fixture(t);
  put(join(data.distDir, 'manifest.webmanifest'), '{');
  refused(data.run(), /manifest\.webmanifest[^\n]*(?:JSON|invalid|parse)/i);
});

for (const [name, svg] of [
  ['missing viewBox', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1Z"/></svg>'],
  ['zero viewBox width', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 32"><path d="M0 0h1v1Z"/></svg>'],
  ['editor metadata', SVG.replace('<path', '<metadata>Editor export</metadata><path')],
  ['editor namespace', SVG.replace('xmlns=', 'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns=')],
  ['editor element', SVG.replace('<path', '<sodipodi:namedview/><path')],
]) {
  test(`served SVGs reject ${name}`, (t) => {
    const data = fixture(t);
    put(join(data.assetsDir, 'invalid.svg'), svg);
    refused(data.run(), /invalid\.svg[^\n]*(?:viewBox|metadata|editor|namespace|sodipodi|inkscape)/i);
  });
}
