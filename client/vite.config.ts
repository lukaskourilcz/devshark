import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { PurgeCSS } from 'purgecss';
import { PRODUCT_CATALOG, resolveCatalogProductId } from './product-catalog';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TopicArticle, topicPath } from './src/components/topics/TopicArticle';
import { BRAND_SHARE_IMAGE, BRAND_SHARE_IMAGE_ALT, DAILY_SHARE_IMAGE_PATH, PUBLIC_ORIGIN, PUBLIC_PAGES, codingShareDescription, premiumSchema, topicSchema } from './src/lib/publicMetadata';
import { TOPIC_LANDINGS } from './src/lib/topicCatalog';
import { PremiumCancelStaticArticle, PremiumStaticArticle, type Translate } from './src/components/PremiumFacts';
import { en, type TranslationKey } from './src/i18n/translations';
import { MERCH_SKUS } from '../shared/rewards';
import { DailyStaticArticle } from './src/components/DailyStaticArticle';
import { writeOgCard } from './src/og/ogImages';
import { CODING_INDEX } from '../shared/coding-index';
import { CODING_SECTION_TRACKS } from '../shared/coding-catalog';
import { freeCodingCounts } from '../shared/tiers';
import { addDays, qotdImagePath, qotdPath, qotdTrack, utcToday, QOTD_EPOCH } from '../shared/daily-question';

import { LEARN_SECTIONS } from '../shared/learn-sections';
import { pathInventory } from '../shared/learning-paths';
import { FDE_PATH } from '../lib/learning-paths/content/fde';
import { mergePath } from '../lib/learning-paths/types';
import { SectionPreviewStatic } from './src/components/learn/SectionPreviewStatic';

/** The English dictionary for the static pages, with the app's {name} slots. */
const translate: Translate = (key, vars) => en[key].replace(/\{(\w+)\}/g, (slot, name: string) => (vars && name in vars ? String(vars[name]) : slot));
const sectionBody = (id: string) => ({ t }: { t: Translate }) => {
  const section = LEARN_SECTIONS.find(one => one.id === id)!;
  const page = PUBLIC_PAGES.find(one => one.path === `/learn/${id}`)!;
  return createElement(SectionPreviewStatic, {
    name: t(page.titleKey).replace(' · devShark', ''), description: t(page.descriptionKey),
    topics: section.topics.map(topic => ({ name: t(`category.${topic}` as TranslationKey), href: `/learn/${id}?topic=${encodeURIComponent(topic)}` })),
    paths: section.paths.map(pathId => {
      if (pathId !== FDE_PATH.id) throw new Error(`No public preview for path ${pathId}`);
      const path = mergePath(FDE_PATH);
      return { title: path.title, summary: path.summary, href: `/learn/${id}/path`, inventory: pathInventory(path) };
    }),
  });
};
const STATIC_PAGE_BODIES = {
  '/learn/web-developer': sectionBody('web-developer'),
  '/learn/software-engineer': sectionBody('software-engineer'),
  '/learn/forward-deployed-engineer': sectionBody('forward-deployed-engineer'),
  '/premium': PremiumStaticArticle,
  '/premium/cancel': PremiumCancelStaticArticle,
  '/daily': DailyStaticArticle,
} as const;
/** Share images the build draws (src/og/ogImages.ts), by page. */
const STATIC_PAGE_IMAGES: Partial<Record<keyof typeof STATIC_PAGE_BODIES, string>> = { '/daily': DAILY_SHARE_IMAGE_PATH };
/** Dated question-of-the-day pages with their own head and share image: the
 * last 120 days and the next 45, rebuilt on every deploy. An older or later
 * date, like a task id the build did not write, has no file behind its
 * rewrite, so Vercel goes on to the app's catch-all rewrite and the app opens
 * it with the generic head (checked on a preview deployment, 28 Sep 2026). */
const QOTD_PAST_DAYS = 120;
/** The hidden system design track: one noindex not-found page, served by
 * vercel.json for this path and every path under it. */
const HIDDEN_CODING_PATH = '/coding/system-design';
const QOTD_FUTURE_DAYS = 45;
const dailyDateLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

// `ANALYZE=true npm run build` emits a treemap of the bundle to
// dist/bundle-stats.html (open it to inspect the design-system/router/app split) plus a
// machine-readable dist/bundle-stats.json. No effect on a normal build.
const analyze = process.env.ANALYZE === 'true';

// Class names the app composes at runtime (`prefix--${value}`), so they never
// appear whole in the bundle. The purge must keep every one of them that the
// source stylesheet defines; the build fails if one goes missing.
const RUNTIME_COMPOSED_CLASSES = [
  'lp-state--verified_pass', 'lp-state--self_reviewed', 'lp-state--needs_revision', 'lp-state--in_progress',
  'lp-criterion--passed', 'lp-criterion--failed',
  'lp-trace__cell--active', 'lp-trace__cell--compare', 'lp-trace__cell--settled', 'lp-trace__cell--excluded',
  'ss-typing__ch--done', 'ss-compare-mark--partial', 'cd-result--pass', 'cd-verdict--timeout', 'cd-status--revealed',
] as const;
const hasClassRule = (css: string, name: string) => new RegExp(`\\.${name}(?![\\w-])`).test(css);

// Astryx ships ONE monolithic astryx.css covering ~100 components while the
// app imports ~40, and CSS has no per-component entry to import selectively.
// This post-build pass purges the emitted stylesheet against the emitted,
// tree-shaken JS — the exact class names that actually ship — so unused
// component styles are dropped without guessing at the source level.
// StyleX class names appear as literal strings in the bundle, which is what
// makes this safe; keyframes/font-faces/CSS variables are kept wholesale.
function purgeAstryxCss(): Plugin {
  // The resolved output directory, so a build with --outDir (the bundle
  // budget's production-shaped build) is purged like the deployed one.
  let outDir = path.resolve(__dirname, 'dist');
  return {
    name: 'purge-astryx-css',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      const assetsDir = path.join(outDir, 'assets');
      const files = await readdir(assetsDir);
      const cssFiles = files.filter((f) => f.endsWith('.css'));
      const content = [
        path.join(outDir, 'index.html'),
        ...files.filter((f) => f.endsWith('.js')).map((f) => path.join(assetsDir, f)),
      ];
      for (const cssFile of cssFiles) {
        const cssPath = path.join(assetsDir, cssFile);
        const source = await readFile(cssPath, 'utf8');
        const before = source.length;
        const [result] = await new PurgeCSS().purge({
          content,
          css: [cssPath],
          // Keep everything that isn't provably unused:
          variables: false, // custom properties pass through untouched
          keyframes: false, // all @keyframes kept (some are toggled at runtime)
          fontFace: false, // all @font-face kept
          safelist: {
            // `astryx-*` are the design system's own semantic class names. They
            // are composed at runtime rather than written as literals in the
            // bundle, so PurgeCSS cannot see them and silently deleted the
            // app's overrides of them — a rule that worked in dev and was gone
            // in production, which is the worst shape a bug can take. Twelve
            // such classes exist in total, so keeping them costs almost nothing.
            // `lp-` is the learning paths: `lp-state--${state}`,
            // `lp-criterion--${…}` and `lp-trace__cell--${role}` are composed
            // at runtime, and all ten of their modifier rules were being purged.
            standard: [/^ss-/, /^rm-/, /^quiz-/, /^devshark/, /^cd-/, /^cm-/, /^lp-/, /^astryx-/, 'html', 'body'],
            // Attribute/state selectors composed at runtime.
            // Preserve compound hover/focus selectors: PurgeCSS otherwise drops
            // :is(...):not(:disabled) even when its classes are safelisted.
            // `data-motion` is set through `dataset` (lib/motion.tsx), so the
            // attribute's name never appears whole in the bundle.
            greedy: [/ss-fin-button/, /data-scroll-active/, /data-design/, /data-theme/, /data-color-mode/, /data-selected/, /data-active/, /data-tone/, /data-locked/, /data-complete/, /data-motion/],
          },
        });
        if (result.css.includes('.ss-fin-hover__swimmer') && !/ss-fin-button[^{}]*:hover[^{}]*\{/.test(result.css)) {
          throw new Error('CSS cleanup removed the shark fin hover activation rule');
        }
        // The default design is assigned through dataset before first paint.
        // Its root token block must survive production CSS cleanup too.
        const appleRoot = /:root\[data-design=(["']?)apple\1\]\s*\{/;
        if (appleRoot.test(source) && !appleRoot.test(result.css)) {
          throw new Error('CSS cleanup removed the Apple design tokens');
        }
        if (source.includes('data-motion') && !result.css.includes('data-motion')) {
          throw new Error('CSS cleanup removed the rule that shows the page when Motion’s features chunk fails');
        }
        const purged = RUNTIME_COMPOSED_CLASSES.filter((name) => hasClassRule(source, name) && !hasClassRule(result.css, name));
        if (purged.length) {
          throw new Error(`CSS cleanup removed runtime-composed classes: ${purged.join(', ')}. Add their prefix to the safelist.`);
        }
        await writeFile(cssPath, result.css);
        const after = result.css.length;
        this.info(
          `purge-astryx-css: ${cssFile} ${(before / 1024).toFixed(1)}kB -> ${(after / 1024).toFixed(1)}kB`,
        );
      }
    },
  };
}

function productMetadata(env: Record<string, string>): Plugin {
  const id = resolveCatalogProductId({ lockSubject: env.VITE_LOCK_SUBJECT, product: env.VITE_PRODUCT });
  const product = PRODUCT_CATALOG[id];
  const title = product.title;
  const description = product.description;
  const manifest = JSON.stringify({
    name: product.brand,
    short_name: product.brand,
    description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F3F6F1',
    theme_color: '#2D7A2D',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any maskable' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any maskable' },
    ],
  }, null, 2);
  const renderHtml = (html: string) => html
    .split('__PRODUCT_NAME__').join(product.brand)
    .split('__PRODUCT_TITLE__').join(title)
    .split('__PRODUCT_DESCRIPTION__').join(description)
    .split('__PRODUCT_SHARE_IMAGE__').join(BRAND_SHARE_IMAGE)
    .split('__PRODUCT_SHARE_IMAGE_ALT__').join(BRAND_SHARE_IMAGE_ALT);

  let outDir = path.resolve(__dirname, 'dist');
  return {
    name: 'product-metadata',
    transformIndexHtml: renderHtml,
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/manifest.webmanifest') return next();
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.end(manifest);
      });
    },
    configurePreviewServer(server) {
      // Vite's SPA fallback does not resolve clean topic URLs to nested index
      // files. Mirror the Vercel rewrites so no-JS and Lighthouse checks inspect
      // the same public HTML that production serves.
      server.middlewares.use((req, _res, next) => {
        const [pathname, search] = (req.url || '').split('?');
        if (/^\/topics\/[a-z0-9-]+\/?$/.test(pathname) || PUBLIC_PAGES.some(page => page.path === pathname.replace(/\/$/, ''))) {
          req.url = `${pathname.replace(/\/$/, '')}/index.html${search ? `?${search}` : ''}`;
        } else if (pathname === HIDDEN_CODING_PATH || pathname.startsWith(`${HIDDEN_CODING_PATH}/`)) {
          // vercel.json: the hidden track and everything under it.
          req.url = `${HIDDEN_CODING_PATH}/index.html${search ? `?${search}` : ''}`;
        } else if (/^\/(?:daily(?:\/\d{4}-\d{2}-\d{2})?|coding(?:\/[a-z-]+(?:\/[a-z0-9-]+)?)?)\/?$/.test(pathname)) {
          // #239: only when the build wrote that page, as on Vercel; any
          // other path falls through to the app.
          const file = `${pathname.replace(/\/$/, '')}/index.html`;
          if (existsSync(path.join(outDir, file))) req.url = `${file}${search ? `?${search}` : ''}`;
        }
        next();
      });
    },
    generateBundle(_options, bundle) {
      const asset = bundle['manifest.webmanifest'];
      if (asset?.type === 'asset') asset.source = manifest;
    },
    async writeBundle() {
      await writeFile(path.join(outDir, 'manifest.webmanifest'), manifest);

      const topics = TOPIC_LANDINGS;
      const origin = PUBLIC_ORIGIN;
      const indexHtml = await readFile(path.join(outDir, 'index.html'), 'utf8');
      const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
      const urls = [`${origin}/`];
      /** The shell with one page's og:image (absolute) and its size and alt. */
      const withImage = (html: string, image: string | null, alt: string) => image
        ? html
          .replace(/(<meta (?:property|name)="(?:og:image|twitter:image)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(image) + end)
          .replace(/(<meta property="og:image:alt" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(alt) + end)
        : html;
      /** The shell with a page's own title, description, canonical URL and
       * image. No URL writes no canonical; no image keeps the shell's. */
      const pageHead = (html: string, page: { title: string; description: string; url: string | null; image: string | null; imageAlt: string }) =>
        withImage(html, page.image, page.imageAlt)
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
          .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(page.description) + end)
          .replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(page.title) + end)
          .replace('</head>', page.url ? `<link rel="canonical" href="${page.url}" /><meta property="og:url" content="${page.url}" /></head>` : '</head>');
      const writePage = async (pagePath: string, html: string) => {
        const dir = path.join(outDir, pagePath);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'index.html'), html);
      };
      for (const topic of topics) {
        const topicTitle = `${topic.title} · ${product.brand}`;
        const description = topic.description;
        const url = origin + topicPath(topic.slug);
        const schema = JSON.stringify(topicSchema(topicTitle, description, url)).replace(/</g, '\\u003c');
        const links = `<link rel="canonical" href="${url}" />`;
        const article = renderToStaticMarkup(createElement(TopicArticle, { topic, brand: product.brand, related: topics }));
        const html = indexHtml
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(topicTitle)}</title>`)
          .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(description) + end)
          .replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(topicTitle) + end)
          .replace('</head>', `${links}<meta property="og:url" content="${url}" /><script id="public-schema" type="application/ld+json">${schema}</script></head>`)
          .replace('<div id="root"></div>', `<div id="root"><main class="ss-public-fallback">${article}</main></div>`);
        const topicDir = path.join(outDir, topicPath(topic.slug));
        await mkdir(topicDir, { recursive: true });
        await writeFile(path.join(topicDir, 'index.html'), html);
        urls.push(url);
      }
      // The app pages with public HTML (#222): /premium and /premium/cancel.
      // Same shell, their own title, description, canonical and body, so the
      // price with VAT, the renewal terms and the cancellation route read the
      // same without JavaScript.
      for (const page of PUBLIC_PAGES) {
        const url = origin + page.path;
        const pageTitle = en[page.titleKey];
        const description = en[page.descriptionKey];
        const schema = page.schema === 'premium'
          ? `<script id="public-schema" type="application/ld+json">${JSON.stringify(premiumSchema(pageTitle, description, url)).replace(/</g, '\\u003c')}</script>`
          : '';
        const body = renderToStaticMarkup(createElement(STATIC_PAGE_BODIES[page.path] as (props: { t: Translate }) => ReturnType<typeof PremiumStaticArticle>, { t: translate }));
        const image = STATIC_PAGE_IMAGES[page.path];
        if (image) await writeOgCard(path.join(outDir, image), { kind: 'daily-home' });
        const html = withImage(indexHtml, image ? origin + image : null, pageTitle)
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(pageTitle)}</title>`)
          .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(description) + end)
          .replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*(" \/>)/g, (_, start, end) => start + escape(pageTitle) + end)
          .replace('</head>', `<link rel="canonical" href="${url}" /><meta property="og:url" content="${url}" />${schema}</head>`)
          .replace('<div id="root"></div>', `<div id="root"><main class="ss-public-fallback">${body}</main></div>`);
        const pageDir = path.join(outDir, page.path);
        await mkdir(pageDir, { recursive: true });
        await writeFile(path.join(pageDir, 'index.html'), html);
        urls.push(url);
      }
      // #239: a page head and a share image for every coding task, so a shared
      // task link previews that task. Only the head differs from the app
      // shell; the body is the app, with a line for a visitor without
      // JavaScript. Not in the sitemap: the pages are the app itself. The
      // index holds only the tracks the section offers, so a hidden track
      // (system design) gets no page and no image.
      const coding = freeCodingCounts(CODING_INDEX.map((task) => task.id));
      let drawn = 0;
      for (const task of CODING_INDEX) {
        const track = en[`coding.track.${task.track}` as TranslationKey] ?? task.track;
        const difficulty = en[`coding.difficulty.${task.difficulty}` as TranslationKey] ?? task.difficulty;
        const pagePath = `/coding/${task.track}/${task.id}`;
        const image = `/og/coding/${task.id}.png`;
        const pageTitle = `${task.title} · ${track} coding challenge · ${product.brand}`;
        const description = codingShareDescription({ difficulty, track, brand: product.brand, ...coding });
        if ((await writeOgCard(path.join(outDir, image), {
          kind: 'coding', title: task.title, track, difficulty, free: task.free === true, freeCount: coding.free, totalCount: coding.total,
        })) === 'drawn') drawn++;
        await writePage(pagePath, pageHead(indexHtml, { title: pageTitle, description, url: origin + pagePath, image: origin + image, imageAlt: `${task.title}: ${track}, ${difficulty}` })
          .replace('<div id="root"></div>', `<div id="root"><noscript><main class="ss-public-fallback ss-info-page"><h1>${escape(task.title)}</h1><p>${escape(description)}</p></main></noscript></div>`));
      }
      // C4-4: the Coding home and its track pages get a head of their own the
      // same way, so a crawler or a link preview that runs no JavaScript stops
      // reading them as copies of the home page. The home and the five track
      // pages are in the sitemap (owner decision, 9 Oct 2026); the task pages
      // are not. /coding/review opens /coding, so it names that page as
      // canonical and stays out.
      const sectionTracks = [...CODING_SECTION_TRACKS.map((track) => ({
        path: `/coding/${track}`, name: en[`coding.track.${track}` as TranslationKey], description: en[`coding.trackBlurb.${track}` as TranslationKey],
      })), { path: '/coding/fullstack', name: en['coding.evolving.fullstack'], description: en['coding.evolving.fullstackBody'] }];
      const sectionLinks = `<ul class="ss-topic-links">${sectionTracks.map((page) => `<li><a href="${page.path}">${escape(page.name)}</a></li>`).join('')}</ul>`;
      const sectionHome = { name: en['coding.title'], title: `${en['coding.title']} · ${product.brand}`, description: en['coding.subtitle'], canonical: '/coding' };
      const sectionPages = [
        { path: '/coding', ...sectionHome },
        { path: '/coding/review', ...sectionHome },
        ...sectionTracks.map((page) => ({ ...page, title: `${page.name} coding challenges · ${product.brand}`, canonical: page.path })),
      ];
      for (const page of sectionPages) {
        await writePage(page.path, pageHead(indexHtml, { title: page.title, description: page.description, url: origin + page.canonical, image: null, imageAlt: page.title })
          .replace('<div id="root"></div>', `<div id="root"><noscript><main class="ss-public-fallback ss-info-page"><h1>${escape(page.name)}</h1><p>${escape(page.description)}</p>${sectionLinks}</main></noscript></div>`));
        if (page.path === page.canonical) urls.push(origin + page.path);
      }
      // System design is hidden (owner decision, 9 Oct 2026): /coding/system-design
      // and every address under it (vercel.json sends them all here) are the
      // Coding not-found page, marked noindex in the HTML itself, so a crawler
      // that runs no JavaScript drops the old pages too. No canonical, no
      // image of its own, not in the sitemap.
      const hiddenTrack = { title: en['title.notFound'], name: en['coding.notFound.track'], description: en['coding.notFound.body'] };
      await writePage(HIDDEN_CODING_PATH, pageHead(indexHtml, { title: hiddenTrack.title, description: hiddenTrack.description, url: null, image: null, imageAlt: hiddenTrack.title })
        .replace('</head>', '<meta name="robots" content="noindex" /></head>')
        .replace('<div id="root"></div>', `<div id="root"><noscript><main class="ss-public-fallback ss-info-page"><h1>${escape(hiddenTrack.name)}</h1><p>${escape(hiddenTrack.description)}</p><p><a href="/coding">${escape(en['coding.retired.toCoding'])}</a></p></main></noscript></div>`));
      // #239: the question of the day, one page head and image per day. The
      // head names the day and its track; the question itself comes from
      // the server when the page runs, so no question or answer is here.
      const today = utcToday();
      const first = [addDays(today, -QOTD_PAST_DAYS), QOTD_EPOCH].sort()[1];
      let days = 0;
      for (let date = first; date <= addDays(today, QOTD_FUTURE_DAYS); date = addDays(date, 1)) {
        const track = en[`category.${qotdTrack(date)}` as TranslationKey];
        const dateLabel = dailyDateLabel(date);
        const pagePath = qotdPath(date);
        const pageTitle = `${translate('daily.title', { track })}, ${dateLabel} · ${product.brand}`;
        const description = en['daily.description'];
        const image = qotdImagePath(date);
        if ((await writeOgCard(path.join(outDir, image), { kind: 'daily', track, dateLabel })) === 'drawn') drawn++;
        const body = renderToStaticMarkup(createElement(DailyStaticArticle, { t: translate, track, dateLabel, date }));
        await writePage(pagePath, pageHead(indexHtml, { title: pageTitle, description, url: origin + pagePath, image: origin + image, imageAlt: `${track} question of the day, ${dateLabel}` })
          .replace('<div id="root"></div>', `<div id="root"><main class="ss-public-fallback">${body}</main></div>`));
        days++;
      }
      this.info(`share pages: ${CODING_INDEX.length} coding tasks, ${sectionPages.length} Coding section pages and the hidden system design page, ${days} days of the question of the day, ${drawn} images drawn (the rest from cache)`);

      const fallback = `<main class="ss-public-fallback ss-info-page"><h1>${escape(title)}</h1><p>${escape(description)}</p><ul class="ss-topic-links">${topics.map(topic => `<li><a href="${topicPath(topic.slug)}">${escape(topic.title)}</a></li>`).join('')}</ul></main>`;
      await writeFile(path.join(outDir, 'index.html'), indexHtml.replace('</head>', `<link rel="canonical" href="${origin}/" /><meta property="og:url" content="${origin}/" /></head>`).replace('<div id="root"></div>', `<div id="root"><noscript>${fallback}</noscript></div>`));
      await writeFile(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`);
      await writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /sandbox/\nDisallow: /dev\nSitemap: ${origin}/sitemap.xml\n`);
    },
  };
}

/** The merchandise mockups the owner has exported from Spreadshop (#229):
 * `public/merch/<sku>.webp` (or .avif, .png, .jpg). The Rewards tiles show an
 * image only for a SKU listed here, so a missing file is never requested and
 * no placeholder art stands in for it. Read when the config loads; restart
 * the dev server after adding a file. */
function merchImages(dir: string): Record<string, string> {
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return {};
  }
  const found: Record<string, string> = {};
  for (const sku of MERCH_SKUS) {
    const file = ['webp', 'avif', 'png', 'jpg', 'jpeg'].map((ext) => `${sku}.${ext}`).find((name) => files.includes(name));
    if (file) found[sku] = `/merch/${file}`;
  }
  return found;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
  define: {
    __MERCH_IMAGES__: JSON.stringify(merchImages(path.resolve(__dirname, 'public/merch'))),
  },
  plugins: [
    productMetadata(env),
    react(),
    purgeAstryxCss(),
    ...(analyze
      ? [
          visualizer({ filename: 'dist/bundle-stats.html', template: 'treemap', gzipSize: true, brotliSize: true }),
          visualizer({ filename: 'dist/bundle-stats.json', template: 'raw-data', gzipSize: true }),
        ]
      : []),
  ],
  // The React iframe has an opaque origin; preview must serve its public
  // module assets to Origin:null, just as the production /sandbox headers do.
  preview: { cors: { origin: 'null' } },
  server: {
    port: 3000,
    // For local dev, run `vercel dev` from the repo root which serves the
    // client + api/ routes together. Plain `vite` is fine if you don't need
    // the API.
  },
  // The coding runner worker is a separate bundle. Its files live under one
  // directory so vercel.json can serve them with their own policy (`new
  // Function` is allowed there and nowhere else on the page).
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/coding-worker/[name]-[hash].js',
        chunkFileNames: 'assets/coding-worker/[name]-[hash].js',
        assetFileNames: 'assets/coding-worker/[name]-[hash][extname]',
      },
    },
  },
  build: {
    manifest: true,
    target: 'es2020',
    // 'hidden' still emits .map files (for Sentry/source-map tooling) but
    // strips the //# sourceMappingURL comment so browsers don't fetch them
    // for end users.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      // The coding sandbox that hosts React tasks is a second, separate build
      // (vite.sandbox.config.ts): it needs the development React so Testing
      // Library has `React.act`, which the app itself must not ship.
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          // React core in its own long-lived chunk. (The app is now MUI-free —
          // the old combined `mui` chunk is gone.) `react-dom/client` must be
          // listed explicitly: the app only imports the subpath (createRoot),
          // and the bare `react-dom` entry alone never matches it — the
          // renderer was silently landing in the main app chunk and getting
          // re-downloaded on every deploy.
          react: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'],
          router: ['react-router-dom'],
          tanstack: ['@tanstack/react-query', '@tanstack/query-core'],
          supabase: ['@supabase/supabase-js'],
          // Note: `motion` and `posthog-js` are intentionally NOT pinned to a
          // manual chunk. Motion's heavy DOM-animation features are loaded via a
          // dynamic import (lib/motion) and posthog-js via another (lib/analytics);
          // forcing either into a manualChunk would pull the whole package into
          // the initial graph and defeat that lazy code-splitting.
        },
      },
    },
  },
  };
});
