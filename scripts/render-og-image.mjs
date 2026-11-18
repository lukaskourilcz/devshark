#!/usr/bin/env node
// Exact October 2026 navbar outlines + the selected Higgsfield background.
// node scripts/render-og-image.mjs [--dark] [--out path.png]
// --reference exports the authentic lockup for reference upload, without art.
// --logo-svg --out path.svg exports the same deterministic SVG for share cards.
// --shape square|portrait --out path.png renders optional campaign crops.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { FIN_BODY, FIN_MIRROR, FIN_WAVE_CUT, FIN_WAVE_LINE, LOGO_WAVE_STROKE } from '../client/src/components/brandGeometry.ts';
import { compressSharePng } from '../client/src/og/png.ts';

const dark = process.argv.includes('--dark');
const reference = process.argv.includes('--reference');
const outIndex = process.argv.indexOf('--out');
const out = outIndex > 0 ? process.argv[outIndex + 1] : 'client/public/og-image.png';
const shapeIndex = process.argv.indexOf('--shape');
const shape = shapeIndex > 0 ? process.argv[shapeIndex + 1] : 'og';
const [width, height] = shape === 'portrait' ? [1080, 1920] : shape === 'square' ? [1080, 1080] : [1200, 630];
const green = dark ? '#4CAF50' : '#2D7A2D';
const ink = dark ? '#FFFFFF' : '#132019';
const paper = dark ? '#0C161E' : '#F3F6F1';

// Same bounds and placement as BrandLogo.tsx; never regenerate the lettering.
const scale = 229 / 19.6;
const wordmarkX = 27 * scale + 229 * .28;
const lockupWidth = wordmarkX + 1347;
const wordmark = readFileSync('client/src/assets/brand/devshark-wordmark.svg', 'utf8');
const paths = wordmark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const lockup = `<defs><clipPath id="fin-cut"><path d="${FIN_WAVE_CUT}"/></clipPath>${paths}</defs>
<g fill="${green}" transform="translate(${.5 * scale} ${-2.1 * scale}) scale(${scale})"><g clip-path="url(#fin-cut)"><path d="${FIN_BODY}" transform="${FIN_MIRROR}"/></g><path d="${FIN_WAVE_LINE}" fill="none" stroke="${green}" stroke-width="${LOGO_WAVE_STROKE}" stroke-linecap="round"/></g>
<g transform="translate(${wordmarkX} 0)"><use href="#dev" fill="${green}"/><use href="#shark" fill="${ink}"/></g>`;

async function render(html, renderWidth, renderHeight) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport:{width:renderWidth,height:renderHeight},deviceScaleFactor:1});
    await page.setContent(html);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(img => img.decode()));
    });
    const png = await page.screenshot({type:'png'});
    writeFileSync(out, await compressSharePng(png));
  } finally { await browser.close(); }
}

if (process.argv.includes('--logo-svg')) {
  writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockupWidth} 229">${lockup}</svg>`);
} else if (reference) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="400" viewBox="0 0 ${lockupWidth + 100} 400"><rect width="100%" height="100%" fill="${paper}"/><g transform="translate(50 85)">${lockup}</g></svg>`;
  await render(`<body style="margin:0;background:${paper}">${svg}</body>`, 1800, 400);
} else {
  const art = readFileSync('docs/brand/source/og/architecture-current.webp').toString('base64');
  const font = readFileSync('client/node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2').toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lockupWidth} 229">${lockup}</svg>`;
  const logoWidth = width * (shape === 'og' ? 940 / 1200 : .85);
  const logoTop = shape === 'og' ? 220 : height * .36;
  const captionTop = shape === 'og' ? 390 : logoTop + logoWidth * 229 / lockupWidth + height * .05;
  const urlTop = shape === 'og' ? 467 : captionTop + 80;
  const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:Manrope;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:700}
  html,body{margin:0;width:${width}px;height:${height}px;background:${paper};overflow:hidden}
  .art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:${dark ? .06 : 1}}
  .logo{position:absolute;top:${logoTop}px;left:${(width - logoWidth) / 2}px;width:${logoWidth}px;height:auto;display:block}
  p{position:absolute;left:0;width:100%;margin:0;text-align:center;font-family:Manrope,sans-serif;font-weight:700;color:${ink}}
  .caption{top:${captionTop}px;font-size:30px;line-height:42px}.url{top:${urlTop}px;font-size:22px;line-height:32px;color:${green}}
  </style><img class="art" src="data:image/webp;base64,${art}" alt=""><div class="logo">${svg}</div><p class="caption">Lessons · Quizzes · Coding challenges</p><p class="url">devShark.app</p>`;
  await render(html, width, height);
}
console.log(`wrote ${out} (${readFileSync(out).length} bytes, ${process.argv.includes('--logo-svg') ? 'exact SVG logo' : reference ? 'exact logo reference' : `${width}×${height} ${shape}`})`);
