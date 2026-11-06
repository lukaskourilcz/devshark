import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const dir = 'client/dist';
const sitemap = new JSDOM(readFileSync(`${dir}/sitemap.xml`, 'utf8'), { contentType: 'application/xml' });
const urls = [...sitemap.window.document.querySelectorAll('loc')].map(node => new URL(node.textContent));
assert(!urls.some(url => url.pathname.startsWith('/cs/')), 'retired guide URLs stay out of the sitemap');
assert(!existsSync(`${dir}/cs`), 'no retired guide HTML is emitted');
assert.equal(urls.length, 17, 'Home, five English guides, two published Learn sections, /premium, /premium/cancel, /daily, /coding and its five track pages');
assert(!urls.some(url => url.pathname.includes('forward-deployed-engineer')), 'the paused FDE section is absent from the sitemap');
// The app pages with public HTML (#222, #239). /premium/success stays out: a
// Stripe return means nothing to anyone else, and the app marks it noindex.
const LEARN_SECTION_PAGES = ['/learn/web-developer', '/learn/software-engineer'];
const APP_PAGES = [...LEARN_SECTION_PAGES, '/premium', '/premium/cancel', '/daily'];
assert.deepEqual(urls.filter(url => APP_PAGES.includes(url.pathname)).map(url => url.pathname), APP_PAGES);
// The Coding home and its track pages (owner decision, 9 Oct 2026). The task
// pages, /coding/review and hidden system design stay out.
const CODING_TRACK_PAGES = ['javascript', 'typescript', 'react', 'algorithms', 'fullstack'].map(track => `/coding/${track}`);
const SITEMAP_CODING_PAGES = ['/coding', ...CODING_TRACK_PAGES];
assert.deepEqual(urls.filter(url => url.pathname.startsWith('/coding')).map(url => url.pathname), SITEMAP_CODING_PAGES, 'the sitemap lists the Coding home and its track pages, and nothing else under /coding');
assert(!urls.some(url => url.pathname.startsWith('/premium/success')), 'the checkout return page is never listed');
assert(!urls.some(url => url.pathname.startsWith('/premium/checkout')), 'the private checkout page is never listed');
const tiers = readFileSync('shared/tiers.ts', 'utf8');
const price = (plan) => tiers.match(new RegExp(`${plan}: '([0-9.]+)'`))?.[1];
for (const url of urls) {
  const file = path.join(dir, url.pathname, 'index.html');
  const doc = new JSDOM(readFileSync(file, 'utf8')).window.document;
  assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute('href'), url.href);
  assert.equal(doc.querySelector('meta[property="og:url"]')?.getAttribute('content'), url.href, `${url}: og:url matches the canonical`);
  // Link previews on LinkedIn, Slack and iMessage need an absolute image URL.
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    assert.match(doc.querySelector(selector)?.getAttribute('content') ?? '', /^https:\/\/devshark\.app\//, `${url}: ${selector} is absolute`);
  }
  assert.equal(url.hostname, 'devshark.app');
  if (url.pathname === '/') continue;
  assert.equal(doc.querySelectorAll('h1').length, 1, `${url}: one static h1`);
  // Checked as section pages below.
  if (SITEMAP_CODING_PAGES.includes(url.pathname)) continue;
  if (APP_PAGES.includes(url.pathname)) {
    assert.equal(doc.documentElement.lang, 'en');
    assert.equal(doc.querySelectorAll('link[hreflang]').length, 0, `${url}: English only`);
    const text = doc.querySelector('#root').textContent;
    if (LEARN_SECTION_PAGES.includes(url.pathname)) {
      assert(!doc.querySelector('#public-schema'), `${url}: preview makes no certification or paid-course schema claim`);
      assert(doc.querySelectorAll('#root li a[href*="?topic="]').length > 0, `${url}: authored topics are readable without JavaScript`);
      assert.match(text, /Sign in to save progress/, `${url}: preview and saved work are distinct`);
      if (url.pathname.endsWith('forward-deployed-engineer')) assert.match(text, /modules.*lessons.*check questions.*code exercises/, `${url}: inventory comes from the manifest`);
    } else if (url.pathname === '/premium') {
      const schema = JSON.parse(doc.querySelector('#public-schema').textContent);
      assert.equal(schema['@type'], 'LearningResource'); assert.equal(schema.url, url.href); assert.equal(schema.name, doc.title);
      assert.equal(schema.isAccessibleForFree, false, 'Premium is the paid subscription');
      assert.deepEqual(schema.offers.map(offer => offer.price), [price('monthly'), price('annual')], 'the offers carry the prices from shared/tiers.ts');
      assert(schema.offers.every(offer => offer.priceSpecification.valueAddedTaxIncluded === false), 'every price excludes VAT, as selected by the owner');
      assert.match(text, new RegExp(`${price('monthly').replace('.', '\\.')}`), `${url}: the monthly price is in the HTML`);
      assert.match(text, new RegExp(`${price('annual').replace('.', '\\.')}`), `${url}: the annual price is in the HTML`);
      assert.match(text, /before VAT/, `${url}: prices say VAT is extra`);
      assert.doesNotMatch(text, /VAT included/i, `${url}: no obsolete tax-inclusive claim`);
      assert.match(text, /renews automatically/i, `${url}: auto-renewal is stated before purchase`);
      assert.match(text, /lose my 14-day right of withdrawal/, `${url}: the waiver sentence is stated before purchase`);
      assert(doc.querySelector('a[href="/terms"]') && doc.querySelector('a[href="/premium/cancel"]'), `${url}: links to the Terms and the cancellation page`);
    } else if (url.pathname === '/premium/cancel') {
      assert(!doc.querySelector('#public-schema'), `${url}: no structured data`);
      assert.match(text, /Withdraw from the contract/, `${url}: both options are named without JavaScript`);
    } else if (url.pathname === '/daily') {
      assert.equal(doc.querySelector('meta[property="og:image"]').getAttribute('content'), 'https://devshark.app/og/daily.png');
      assert(existsSync(`${dir}/og/daily.png`), '/daily has its share image');
      assert(!doc.querySelector('[role="radio"], .ss-radio-card'), '/daily holds no question in its HTML');
    }
    continue;
  }
  assert.equal(doc.documentElement.lang, 'en');
  assert.equal(doc.querySelectorAll('details').length, 3, 'Practice is present without JS');
  assert.equal(doc.querySelectorAll('link[hreflang]').length, 0);
  for (const alternate of doc.querySelectorAll('link[hreflang]')) assert(existsSync(path.join(dir, new URL(alternate.href).pathname, 'index.html')));
  const schema = JSON.parse(doc.querySelector('#public-schema').textContent);
  assert.equal(schema['@type'], 'LearningResource'); assert.equal(schema.url, url.href); assert.equal(schema.inLanguage, 'en');
  // A guide is free to read without an account; Premium is not a guide.
  assert.equal(schema.name, doc.title); assert.equal(schema.isAccessibleForFree, true);
  assert(doc.querySelector('pre code'), `${url}: the guide carries its code example`);
  assert.equal(doc.querySelector('.ss-topic-cta').getAttribute('href').startsWith('/quiz?category='), true);
}
// #239: every coding task and every day in the window has its own head and
// share image, and none of those pages carries a question, an answer or a
// solution.
const index = readFileSync('shared/coding-index.ts', 'utf8');
const tasks = [...index.matchAll(/\{"id":"([^"]+)","track":"([^"]+)"/g)].map(([, id, track]) => ({ id, track }));
assert(tasks.length > 700, 'the coding index was read');
assert(!tasks.some(({ track }) => track === 'system-design'), 'the index the browser ships holds no system design task');
const free = tasks.filter(({ id }) => new RegExp(`"id":"${id}"[^\n]*"free":true`).test(index)).length;
for (const { id, track } of tasks) {
  const file = path.join(dir, 'coding', track, id, 'index.html');
  assert(existsSync(file), `${id} has its page head`);
  const html = readFileSync(file, 'utf8');
  assert(html.includes(`<meta property="og:image" content="https://devshark.app/og/coding/${id}.png" />`), `${id}: its own og:image`);
  assert(html.includes(`${free} of ${tasks.length} coding tasks are free`), `${id}: the free count comes from the catalogue`);
  assert(!/solution|expected|hiddenTests/i.test(html.slice(html.indexOf('<div id="root">'))), `${id}: no task body in the HTML`);
  assert(existsSync(path.join(dir, 'og', 'coding', `${id}.png`)), `${id}: its image exists`);
}
// C4-4: the Coding home and its track pages carry a head of their own, not
// the home page's: /coding/review opens /coding and names it. The home and the
// track pages are in the sitemap; /coding/review is not.
const home = new JSDOM(readFileSync(`${dir}/index.html`, 'utf8')).window.document;
const homeDescription = home.querySelector('meta[name="description"]').getAttribute('content');
const SECTION_PAGES = {
  '/coding': '/coding', '/coding/review': '/coding',
  ...Object.fromEntries(CODING_TRACK_PAGES.map(page => [page, page])),
};
for (const [pagePath, canonicalPath] of Object.entries(SECTION_PAGES)) {
  const doc = new JSDOM(readFileSync(path.join(dir, pagePath, 'index.html'), 'utf8')).window.document;
  const canonical = canonicalPath && `https://devshark.app${canonicalPath}`;
  assert.equal(doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null, canonical, `${pagePath}: canonical`);
  assert.equal(doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? null, canonical, `${pagePath}: og:url matches the canonical`);
  assert.notEqual(doc.title, home.title, `${pagePath}: its own title`);
  assert.equal(doc.querySelector('meta[property="og:title"]').getAttribute('content'), doc.title, `${pagePath}: og:title is the title`);
  assert.notEqual(doc.querySelector('meta[name="description"]').getAttribute('content'), homeDescription, `${pagePath}: its own description`);
  assert.equal(urls.some(url => url.pathname === pagePath), pagePath === canonicalPath, `${pagePath}: in the sitemap only under its own address`);
  assert.equal(doc.querySelectorAll('meta[name="robots"]').length, 0, `${pagePath}: indexable`);
}
const rewrites = JSON.parse(readFileSync('vercel.json', 'utf8')).rewrites;
for (const source of ['/coding', '/coding/:track']) {
  assert(rewrites.some(rule => rule.source === source && rule.destination === `${source}/index.html`), `${source} serves its own HTML on Vercel`);
}
// System design is hidden (owner decision, 9 Oct 2026). /coding/system-design
// and every address under it are one not-found page, noindex in the HTML
// itself, with no canonical and no image of its own. No share page or share
// image of a system design task is built, and the sitemap names none.
{
  const HIDDEN = '/coding/system-design';
  const doc = new JSDOM(readFileSync(path.join(dir, HIDDEN, 'index.html'), 'utf8')).window.document;
  assert.equal(doc.querySelector('meta[name="robots"]')?.getAttribute('content'), 'noindex', `${HIDDEN}: noindex without JavaScript`);
  assert.equal(doc.querySelector('link[rel="canonical"]'), null, `${HIDDEN}: no canonical`);
  assert.equal(doc.querySelector('meta[property="og:url"]'), null, `${HIDDEN}: no og:url`);
  assert.equal(doc.querySelector('h1')?.textContent, 'That track does not exist.', `${HIDDEN}: the not-found heading`);
  assert.deepEqual(readdirSync(path.join(dir, HIDDEN)), ['index.html'], `${HIDDEN}: no task page under it`);
  assert(!readdirSync(path.join(dir, 'og', 'coding')).some(file => /^(?:sd|dd)-/.test(file)), 'no system design share image');
  assert(!urls.some(url => url.pathname.startsWith(HIDDEN)), `${HIDDEN}: not in the sitemap`);
  for (const source of [HIDDEN, `${HIDDEN}/(.*)`]) {
    assert(rewrites.some(rule => rule.source === source && rule.destination === `${HIDDEN}/index.html`), `${source} is the hidden-track page on Vercel`);
  }
}
const days = readdirSync(`${dir}/daily`).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name));
assert(days.length >= 30, 'the question of the day has dated pages');
for (const day of days) {
  const html = readFileSync(`${dir}/daily/${day}/index.html`, 'utf8');
  assert(html.includes(`content="https://devshark.app/og/daily/${day}.png"`), `${day}: its own og:image`);
  assert(existsSync(`${dir}/og/daily/${day}.png`), `${day}: its image exists`);
  assert(!/ss-radio-card|correctAnswer|explanation/.test(html), `${day}: no question in the HTML`);
}
// V3-6: the app ships English only, so the code a coding screen loads carries
// no unexpected accented glyphs. A chunk counts as coding when its source map lists a module of the
// coding client or a shared coding module (the build emits hidden maps).
const UNEXPECTED_DIACRITICS = /[áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/g;
const CODING_SOURCE = /(?:^|\/)(?:src\/coding\/|src\/components\/coding\/|shared\/coding-)/;
const codingChunks = readdirSync(`${dir}/assets`, { recursive: true })
  .filter((file) => file.endsWith('.js') && existsSync(`${dir}/assets/${file}.map`))
  .filter((file) => JSON.parse(readFileSync(`${dir}/assets/${file}.map`, 'utf8')).sources.some((source) => CODING_SOURCE.test(source)));
assert(codingChunks.some((file) => /^CodingWorkbench-/.test(file)), 'the workbench chunk was found by its source map');
for (const file of codingChunks) {
  const found = readFileSync(`${dir}/assets/${file}`, 'utf8').match(UNEXPECTED_DIACRITICS) ?? [];
  assert.equal(found.length, 0, `${file}: ${found.length} unexpected accented glyphs in a coding chunk`);
}
assert(readFileSync(`${dir}/robots.txt`, 'utf8').includes(`Sitemap: ${urls[0].origin}/sitemap.xml`));
assert(!existsSync(`${dir}/mockServiceWorker.js`), 'Mocks must never ship with the app');
assert(!readdirSync(`${dir}/assets`).some(file => /storybook|mocks|\.stories\./i.test(file)));
console.log(`Public HTML passed: ${urls.length} URLs, canonical, schema, teaching content, the Premium terms, ${tasks.length} coding share pages, ${Object.keys(SECTION_PAGES).length} Coding section pages, hidden system design, ${days.length} question-of-the-day pages, and no unexpected accented glyphs in ${codingChunks.length} coding chunks.`);
