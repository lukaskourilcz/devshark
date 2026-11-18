import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const dir = 'client/dist';
const sitemap = new JSDOM(readFileSync(`${dir}/sitemap.xml`, 'utf8'), { contentType: 'application/xml' });
const urls = [...sitemap.window.document.querySelectorAll('loc')].map(node => new URL(node.textContent));
assert(!urls.some(url => url.pathname.startsWith('/cs/')), 'retired guide URLs stay out of the sitemap');
assert(!existsSync(`${dir}/cs`), 'no retired guide HTML is emitted');
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
const ORIGIN = 'https://devshark.app';
const HIDDEN_CODING_PATH = '/coding/system-design';
const index = readFileSync('shared/coding-index.ts', 'utf8');
const tasks = [...index.matchAll(/\{"id":"([^"]+)","track":"([^"]+)"/g)].map(([, id, track]) => ({ id, track }));
assert(tasks.length > 700, 'the coding index was read');
assert(!tasks.some(({ track }) => track === 'system-design'), 'the index the browser ships holds no system design task');
// F15-01: every prerendered page has exactly one class, chosen by its address,
// and its head and the sitemap must agree with that class.
// - listed: in the sitemap, canonical to itself, indexable.
// - alias: canonical to another listed page, not in the sitemap. Only
//   /coding/review, which opens /coding (C4-4).
// - share-only: canonical to itself and indexable, not in the sitemap. The
//   coding task pages (owner decision, 9 Oct 2026) and the dated question of
//   the day pages.
// - noindex: robots noindex, no canonical, not in the sitemap. The hidden
//   system design track (owner decision, 9 Oct 2026).
// A page that no rule or more than one rule matches fails: give a new page a
// class here.
const ALIASES = { '/coding/review': '/coding' };
const TASK_PATHS = new Set(tasks.map(({ id, track }) => `/coding/${track}/${id}`));
const PAGE_CLASSES = [
  ['listed', (pagePath) => pagePath === '/' || /^\/topics\/[a-z0-9-]+$/.test(pagePath) || APP_PAGES.includes(pagePath) || SITEMAP_CODING_PAGES.includes(pagePath)],
  ['alias', (pagePath) => Object.hasOwn(ALIASES, pagePath)],
  ['share-only', (pagePath) => TASK_PATHS.has(pagePath) || /^\/daily\/\d{4}-\d{2}-\d{2}$/.test(pagePath)],
  ['noindex', (pagePath) => pagePath === HIDDEN_CODING_PATH],
];
const classesOf = (pagePath) => PAGE_CLASSES.filter(([, test]) => test(pagePath)).map(([kind]) => kind);
/** Every index.html in the build, by the address it is served at. The assets,
 * the React sandbox, the share images and the brand kit hold no page. */
const NOT_PAGES = new Set(['assets', 'sandbox', 'og', 'brand']);
const pagePaths = [];
const walk = (relative) => {
  for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
    if (entry.isDirectory() && !(relative === '' && NOT_PAGES.has(entry.name))) walk(path.posix.join(relative, entry.name));
    else if (entry.isFile() && entry.name === 'index.html') pagePaths.push(`/${relative}`);
  }
};
walk('');
const pageUrl = (pagePath) => `${ORIGIN}${pagePath}`;
// One parser for every page: a JSDOM window per page took 29 s and 2 GB for
// the 912 pages of 18 Nov 2026, this takes about 8 s. Text comes back decoded,
// so '&amp;' in a title counts as one character.
const parser = new (new JSDOM('').window.DOMParser)();
const readPage = (pagePath) => parser.parseFromString(readFileSync(path.join(dir, pagePath, 'index.html'), 'utf8'), 'text/html');
// F15-03: the schema.org types the site emits and the properties a page may
// give each, with the kinds of value schema.org expects (https://schema.org/
// <Type>, read 18 Nov 2026). Each list is a subset of what schema.org defines.
// Where schema.org also takes a type the site never emits (Person,
// ImageObject, DefinedTerm, QuantitativeValue), the table leaves it out. A
// misspelt property, an unknown type or a value of the wrong kind fails; add a
// new type or property here from schema.org before a page emits it.
const SCHEMA_PARENT = { LearningResource: 'CreativeWork', WebSite: 'CreativeWork', CreativeWork: 'Thing', Organization: 'Thing', Offer: 'Thing', UnitPriceSpecification: 'PriceSpecification', PriceSpecification: 'Thing' };
const isSchemaType = (type, expected) => {
  for (let one = type; one; one = SCHEMA_PARENT[one]) if (one === expected) return true;
  return false;
};
const THING = { additionalType: ['Text', 'URL'], alternateName: ['Text'], description: ['Text'], identifier: ['Text', 'URL'], image: ['URL'], mainEntityOfPage: ['CreativeWork', 'URL'], name: ['Text'], sameAs: ['URL'], url: ['URL'] };
const CREATIVE_WORK = {
  ...THING, about: ['Thing'], abstract: ['Text'], author: ['Organization'], copyrightHolder: ['Organization'], copyrightYear: ['Number'], creator: ['Organization'],
  dateCreated: ['Date', 'DateTime'], dateModified: ['Date', 'DateTime'], datePublished: ['Date', 'DateTime'], educationalLevel: ['Text', 'URL'], educationalUse: ['Text'], headline: ['Text'],
  inLanguage: ['Language'], isAccessibleForFree: ['Boolean'], isFamilyFriendly: ['Boolean'], isPartOf: ['CreativeWork', 'URL'], keywords: ['Text', 'URL'],
  learningResourceType: ['Text'], license: ['CreativeWork', 'URL'], offers: ['Offer'], provider: ['Organization'], publisher: ['Organization'], teaches: ['Text'], text: ['Text'],
  thumbnailUrl: ['URL'], timeRequired: ['Duration'], typicalAgeRange: ['Text'], version: ['Number', 'Text'],
};
const PRICE_SPECIFICATION = { ...THING, maxPrice: ['Number'], minPrice: ['Number'], price: ['Price'], priceCurrency: ['Currency'], validFrom: ['Date', 'DateTime'], validThrough: ['Date', 'DateTime'], valueAddedTaxIncluded: ['Boolean'] };
const SCHEMA_TYPES = {
  LearningResource: { ...CREATIVE_WORK, assesses: ['Text'], competencyRequired: ['Text', 'URL'] },
  WebSite: { ...CREATIVE_WORK, issn: ['Text'] },
  Organization: { ...THING, email: ['Text'], founder: ['Organization'], foundingDate: ['Date'], legalName: ['Text'], logo: ['URL'], slogan: ['Text'] },
  Offer: {
    ...THING, availability: ['URL'], category: ['Text', 'Thing', 'URL'], eligibleRegion: ['Text'], price: ['Price'], priceCurrency: ['Currency'],
    priceSpecification: ['PriceSpecification'], priceValidUntil: ['Date'], seller: ['Organization'], validFrom: ['Date', 'DateTime'], validThrough: ['Date', 'DateTime'],
  },
  UnitPriceSpecification: { ...PRICE_SPECIFICATION, billingDuration: ['Duration', 'Number'], billingIncrement: ['Number'], billingStart: ['Number'], priceType: ['Text', 'URL'], unitCode: ['Text', 'URL'], unitText: ['Text'] },
};
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const VALUE_KINDS = {
  Text: (value) => typeof value === 'string' && value.trim() !== '',
  URL: (value) => typeof value === 'string' && URL.canParse(value) && new URL(value).protocol === 'https:',
  Boolean: (value) => typeof value === 'boolean',
  Number: (value) => Number.isFinite(value),
  // schema.org: digits with '.' as the decimal point, as a Number or Text.
  Price: (value) => (Number.isFinite(value) && value >= 0) || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)),
  // ISO 4217.
  Currency: (value) => CURRENCIES.has(value),
  // ISO 8601 durations and dates.
  Duration: (value) => typeof value === 'string' && /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/.test(value),
  Date: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)),
  DateTime: (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
  // A BCP 47 tag in its canonical form.
  Language: (value) => {
    try { return Intl.getCanonicalLocales(value)[0] === value; } catch { return false; }
  },
};
/** One node and everything under it. `expected` lists the types schema.org
 * takes where the node sits (null at the top); `ids` holds the block's nodes
 * by @id, so `{ "@id": … }` can stand for one of them. */
const checkSchemaNode = (node, expected, where, ids) => {
  assert(node !== null && typeof node === 'object' && !Array.isArray(node), `${where}: a JSON-LD node`);
  if (Object.keys(node).length === 1 && Object.hasOwn(node, '@id')) {
    const target = ids.get(node['@id']);
    assert(target, `${where}: ${node['@id']} names a node in the same block`);
    assert(!expected || expected.some(type => isSchemaType(target['@type'], type)), `${where}: ${node['@id']} is a ${expected?.join(' or ')}`);
    return;
  }
  const type = node['@type'];
  assert(typeof type === 'string' && Object.hasOwn(SCHEMA_TYPES, type), `${where}: @type ${JSON.stringify(type)} is a known schema.org type (${Object.keys(SCHEMA_TYPES).join(', ')})`);
  assert(!expected || expected.some(one => isSchemaType(type, one)), `${where}: a ${type} where schema.org takes ${expected?.join(' or ')}`);
  for (const [key, value] of Object.entries(node)) {
    if (key === '@type') continue;
    if (key === '@id') {
      assert(VALUE_KINDS.URL(value), `${where}: @id is an absolute https URL`);
      continue;
    }
    assert(Object.hasOwn(SCHEMA_TYPES[type], key), `${where}: ${type} has no property "${key}" on schema.org`);
    const kinds = SCHEMA_TYPES[type][key];
    const types = kinds.filter(kind => !Object.hasOwn(VALUE_KINDS, kind));
    const items = Array.isArray(value) ? value : [value];
    assert(items.length > 0, `${where}: ${key} is not empty`);
    for (const item of items) {
      if (types.length && item !== null && typeof item === 'object') checkSchemaNode(item, types, `${where} > ${key}`, ids);
      else assert(kinds.some(kind => Object.hasOwn(VALUE_KINDS, kind) && VALUE_KINDS[kind](item)), `${where}: ${key} ${JSON.stringify(item)} is not a ${kinds.join(' or ')}`);
    }
  }
};
/** One application/ld+json block: it parses, names https://schema.org as its
 * context, and each top node (or each node of its @graph) that has a url gives
 * the page's canonical. */
const checkJsonLd = (text, where, canonical) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    assert.fail(`${where}: JSON-LD does not parse (${error.message})`);
  }
  assert(data !== null && typeof data === 'object' && !Array.isArray(data), `${where}: JSON-LD is one object`);
  const { '@context': context, ...top } = data;
  assert.equal(context, 'https://schema.org', `${where}: @context is https://schema.org`);
  const graph = Object.hasOwn(top, '@graph');
  if (graph) assert(Object.keys(top).length === 1 && Array.isArray(top['@graph']) && top['@graph'].length > 0, `${where}: @graph is a list of nodes and nothing sits beside it`);
  const nodes = graph ? top['@graph'] : [top];
  const ids = new Map();
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (value === null || typeof value !== 'object') return;
    if (typeof value['@id'] === 'string' && Object.keys(value).length > 1) ids.set(value['@id'], value);
    Object.values(value).forEach(collect);
  };
  collect(nodes);
  for (const node of nodes) {
    checkSchemaNode(node, null, `${where} ${node?.['@type'] ?? 'node'}`, ids);
    if (Object.hasOwn(node, 'url')) assert.equal(node.url, canonical, `${where}: the ${node['@type']} url is the page canonical`);
  }
};
let jsonLdBlocks = 0;
/** Titles a search result would cut (F15-04), reported together at the end. */
const longTitles = [];
const sitemapHrefs = new Set(urls.map(url => url.href));
assert.equal(sitemapHrefs.size, urls.length, 'the sitemap lists no URL twice');
for (const url of urls) {
  assert.equal(url.origin, ORIGIN, `${url}: a devshark.app address`);
  assert(existsSync(path.join(dir, url.pathname, 'index.html')), `${url}: in the sitemap without a page`);
}
const classCounts = { listed: 0, alias: 0, 'share-only': 0, noindex: 0 };
for (const pagePath of pagePaths) {
  const classes = classesOf(pagePath);
  assert.equal(classes.length, 1, `${pagePath}: ${classes.length ? `more than one class (${classes.join(', ')})` : 'no class; give the page one in scripts/check-public.mjs'}`);
  const [kind] = classes;
  const doc = readPage(pagePath);
  const url = pageUrl(pagePath);
  const canonicals = [...doc.querySelectorAll('link[rel="canonical"]')].map(link => link.getAttribute('href'));
  const ogUrls = [...doc.querySelectorAll('meta[property="og:url"]')].map(meta => meta.getAttribute('content'));
  assert(canonicals.length <= 1 && ogUrls.length <= 1, `${pagePath}: at most one canonical and one og:url`);
  const canonical = canonicals[0] ?? null;
  const noindex = [...doc.querySelectorAll('meta[name="robots"]')].some(meta => /\b(?:noindex|none)\b/i.test(meta.getAttribute('content') ?? ''));
  const listed = sitemapHrefs.has(url);
  if (kind === 'noindex') {
    assert(noindex, `${pagePath} (noindex): robots noindex in the HTML`);
    assert.equal(canonical, null, `${pagePath} (noindex): no canonical`);
    assert.equal(ogUrls[0] ?? null, null, `${pagePath} (noindex): no og:url`);
  } else {
    assert.equal(canonical, kind === 'alias' ? pageUrl(ALIASES[pagePath]) : url, `${pagePath} (${kind}): canonical`);
    assert.equal(ogUrls[0] ?? null, canonical, `${pagePath} (${kind}): og:url matches the canonical`);
    assert(!noindex, `${pagePath} (${kind}): indexable, no robots noindex`);
  }
  assert.equal(listed, kind === 'listed', `${pagePath} (${kind}): ${kind === 'listed' ? 'in' : 'not in'} the sitemap`);
  // F15-02: the title, description and image a crawler reads are the ones
  // every link preview reads, each tag written once.
  const one = (selector) => {
    const nodes = doc.querySelectorAll(selector);
    assert.equal(nodes.length, 1, `${pagePath}: exactly one ${selector}`);
    return nodes[0].getAttribute('content') ?? '';
  };
  assert.equal(doc.querySelectorAll('title').length, 1, `${pagePath}: exactly one title`);
  const title = doc.title;
  assert.equal(one('meta[property="og:title"]'), title, `${pagePath}: og:title is the title`);
  assert.equal(one('meta[name="twitter:title"]'), title, `${pagePath}: twitter:title is the title`);
  if (pagePath !== '/') assert(title.endsWith(' · devShark'), `${pagePath}: the title "${title}" ends with " · devShark"`);
  // F15-04: search results cut a title near 60 characters. Counted in code
  // points of the decoded title, so '&amp;' is one.
  if ((kind === 'listed' || kind === 'share-only') && [...title].length >= 60) longTitles.push({ pagePath, title, length: [...title].length });
  const description = one('meta[name="description"]');
  assert(description.trim(), `${pagePath}: a description`);
  assert.equal(one('meta[property="og:description"]'), description, `${pagePath}: og:description is the description`);
  assert.equal(one('meta[name="twitter:description"]'), description, `${pagePath}: twitter:description is the description`);
  // Link previews on LinkedIn, Slack and iMessage need an absolute image URL.
  const image = one('meta[property="og:image"]');
  assert.match(image, /^https:\/\/devshark\.app\//, `${pagePath}: og:image is absolute under https://devshark.app/`);
  assert.equal(one('meta[name="twitter:image"]'), image, `${pagePath}: twitter:image is og:image`);
  assert(one('meta[property="og:image:alt"]').trim(), `${pagePath}: og:image:alt is not empty`);
  assert.equal(one('meta[name="twitter:card"]'), 'summary_large_image', `${pagePath}: twitter:card summary_large_image`);
  assert.equal(doc.documentElement.getAttribute('lang'), 'en', `${pagePath}: html lang en`);
  assert.equal(doc.querySelectorAll('link[hreflang]').length, 0, `${pagePath}: English only, no hreflang`);
  // The h1 a visitor without JavaScript sees, in the body or its noscript.
  assert.equal(doc.querySelectorAll('h1').length, 1, `${pagePath}: one static h1`);
  for (const block of doc.querySelectorAll('script[type="application/ld+json"]')) {
    checkJsonLd(block.textContent, `${pagePath}: JSON-LD`, canonical ?? url);
    jsonLdBlocks++;
  }
  classCounts[kind]++;
}
for (const [alias, target] of Object.entries(ALIASES)) {
  assert(pagePaths.includes(alias) && pagePaths.includes(target), `${alias}: it and its canonical ${target} are both built`);
  assert.deepEqual(classesOf(target), ['listed'], `${alias}: its canonical ${target} is a listed page`);
}
assert.equal(urls.length, classCounts.listed, 'the sitemap lists exactly the listed pages');
const tiers = readFileSync('shared/tiers.ts', 'utf8');
const price = (plan) => tiers.match(new RegExp(`${plan}: '([0-9.]+)'`))?.[1];
for (const url of urls) {
  const file = path.join(dir, url.pathname, 'index.html');
  const doc = new JSDOM(readFileSync(file, 'utf8')).window.document;
  if (url.pathname === '/') continue;
  // Checked as section pages below.
  if (SITEMAP_CODING_PAGES.includes(url.pathname)) continue;
  if (APP_PAGES.includes(url.pathname)) {
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
  assert.equal(doc.querySelectorAll('details').length, 3, 'Practice is present without JS');
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
const SECTION_PAGES = ['/coding', '/coding/review', ...CODING_TRACK_PAGES];
for (const pagePath of SECTION_PAGES) {
  const doc = new JSDOM(readFileSync(path.join(dir, pagePath, 'index.html'), 'utf8')).window.document;
  assert.notEqual(doc.title, home.title, `${pagePath}: its own title`);
  assert.notEqual(doc.querySelector('meta[name="description"]').getAttribute('content'), homeDescription, `${pagePath}: its own description`);
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
  const HIDDEN = HIDDEN_CODING_PATH;
  const doc = new JSDOM(readFileSync(path.join(dir, HIDDEN, 'index.html'), 'utf8')).window.document;
  assert.equal(doc.querySelector('meta[name="robots"]')?.getAttribute('content'), 'noindex', `${HIDDEN}: noindex without JavaScript`);
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
{
  const shown = [...longTitles].sort((one, other) => other.length - one.length).slice(0, 25);
  const kinds = Object.entries(Object.groupBy(longTitles, ({ pagePath }) => pagePath.startsWith('/daily/') ? 'dated daily' : pagePath.startsWith('/coding/') ? 'coding task' : 'other')).map(([kind, list]) => `${list.length} ${kind}`).join(', ');
  assert.equal(longTitles.length, 0, `${longTitles.length} titles are 60 characters or longer (${kinds}); the longest:\n${shown.map(({ pagePath, title, length }) => `  ${length} ${pagePath}: ${title}`).join('\n')}${longTitles.length > shown.length ? `\n  and ${longTitles.length - shown.length} more` : ''}`);
}
console.log(`Public HTML passed: ${pagePaths.length} pages (${Object.entries(classCounts).map(([kind, count]) => `${count} ${kind}`).join(', ')}), ${urls.length} sitemap URLs, canonical, ${jsonLdBlocks} JSON-LD blocks against schema.org, teaching content, the Premium terms, ${tasks.length} coding share pages, ${SECTION_PAGES.length} Coding section pages, hidden system design, ${days.length} question-of-the-day pages, and no unexpected accented glyphs in ${codingChunks.length} coding chunks.`);
