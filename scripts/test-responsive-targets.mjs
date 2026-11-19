// Effective touch targets include clickable labels and real pseudo-element
// hit areas. The inline prose exception does not excuse standalone actions.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { TOUCH_TARGETS } from './responsive-clearance.mjs';

const installedChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let browser, page;
test.before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || (existsSync(installedChrome) ? installedChrome : undefined) });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
});
test.after(async () => { await browser?.close(); });
async function measure(body) {
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>
    body{margin:20px}button{padding:0;border:0;width:44px;height:44px}a{display:inline-block}label{display:inline-flex;align-items:center;justify-content:center}input{margin:0}
    .compact{position:relative;width:36px;height:36px;margin:8px}.compact::before{content:'';position:absolute;inset:-4px}
  </style>${body}`);
  return page.evaluate(TOUCH_TARGETS);
}

for (const [dimension, style] of [['width', 'width:43px'], ['height', 'height:43px']]) {
  test(`F6-05: a standalone button with a 43px ${dimension} fails`, async () => {
    const result = await measure(`<button id="small" style="${style}">Go</button>`);
    assert.ok(result.violations.some((row) => row.selector === '#small' && row[dimension] === 43));
  });
}
test('F6-05: a 44px square button passes', async () => {
  assert.deepEqual((await measure('<button>Go</button>')).violations, []);
});
test('F6-05: a standalone text link needs both target dimensions', async () => {
  const result = await measure('<div><a id="small" href="#next" style="width:30px;height:20px">Next</a></div>');
  assert.ok(result.violations.some((row) => row.selector === '#small'));
});
test('F6-05: a full clickable 44px label supplies the native checkbox hit area', async () => {
  const result = await measure('<label style="width:44px;height:44px"><input type="checkbox" style="width:18px;height:18px" aria-label="Select"/></label>');
  assert.deepEqual(result.violations, []);
});
test('F6-05: a real 44px pseudo-element hit area supplies a compact button target', async () => {
  assert.deepEqual((await measure('<button class="compact">Go</button>')).violations, []);
});
test('F6-05: a noninteractive decorative pseudo-element does not expand a target', async () => {
  const result = await measure('<style>.compact::before{pointer-events:none}</style><button id="small" class="compact">Go</button>');
  assert.ok(result.violations.some((row) => row.selector === '#small'));
});
test('F6-05: hidden and disabled controls do not count as interactive targets', async () => {
  const result = await measure('<button style="display:none;width:20px;height:20px">Hidden</button><button disabled style="width:20px;height:20px">Disabled</button>');
  assert.deepEqual(result.violations, []);
});
test('F6-05: inline sentence links record the WCAG inline exception', async () => {
  const result = await measure('<p>Read the <a id="inline" style="display:inline" href="#privacy">privacy policy</a> before continuing.</p>');
  assert.deepEqual(result.violations, []);
  assert.ok(result.exceptions.some((row) => row.selector === '#inline' && /inline/i.test(row.reason)));
});
test('F6-05: a paragraph containing only a link does not invent a prose exception', async () => {
  const result = await measure('<p><a id="small" style="display:inline" href="#privacy">Terms</a></p>');
  assert.ok(result.violations.some((row) => row.selector === '#small'));
});
test('F6-05: clipping a 44px control to 20px fails its effective target width', async () => {
  const result = await measure('<div style="width:20px;height:44px;overflow:hidden"><button id="clipped">Go</button></div>');
  assert.ok(result.violations.some((row) => row.selector === '#clipped' && row.width === 20));
});
test('F6-05: a reachable control below a scrollport still receives a target measurement', async () => {
  const result = await measure('<div style="height:100px;overflow:hidden"><main style="height:100px;overflow:auto"><div style="height:200px"></div><button id="below" style="width:43px">Go</button></main></div>');
  assert.ok(result.violations.some((row) => row.selector === '#below' && row.width === 43));
});
test('F6-05: an outer clipped aperture limits a control inside a scrollport', async () => {
  const result = await measure('<div style="height:20px;overflow:hidden"><main style="height:100px;overflow:auto"><div style="height:200px"></div><button id="aperture">Go</button></main></div>');
  assert.ok(result.violations.some((row) => row.selector === '#aperture' && row.height === 20));
});
