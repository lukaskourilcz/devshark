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
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
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
