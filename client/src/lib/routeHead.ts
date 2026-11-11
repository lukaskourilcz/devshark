// The document head for each route: its title, description, canonical URL,
// structured data and robots line. The app shell (App.tsx) applies it on
// every navigation.
import type { TranslationKey } from '../i18n/translations';
import { CURRENT_PRODUCT } from './products';
import { BRAND_SHARE_IMAGE, BRAND_SHARE_IMAGE_ALT, DAILY_SHARE_IMAGE_PATH, NOINDEX_PATHS, PUBLIC_ORIGIN, premiumSchema, publicPage, topicFromPath, topicSchema } from './publicMetadata';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const ROUTE_TITLE_KEYS: Record<string, TranslationKey> = {
  '/admin': 'admin.title',
  '/admin/users': 'admin.users',
  '/admin/vouchers': 'admin.vouchers',
  '/admin/emails': 'admin.emails',
  '/': 'title.home',
  '/quiz': 'title.quiz',
  '/learn': 'title.learn',
  '/big-o': 'bigO.title',
  '/learn/big-o': 'bigO.pathTitle',
  '/roadmap': 'title.roadmap',
  '/profile': 'title.profile',
  '/leaderboard': 'title.leaderboard',
  '/cards': 'title.cards',
  '/today': 'title.today',
  '/collection': 'title.collection',
  '/typing': 'title.typing',
  '/coding': 'title.coding',
  '/coding/review': 'title.coding',
  '/settings/github': 'title.github',
  '/shop': 'title.shop',
  '/play': 'title.play',
  '/challenge': 'title.challenge',
  '/privacy': 'title.privacy',
  '/terms': 'title.terms',
  '/premium': 'title.premium',
  '/premium/success': 'title.premiumSuccess',
  '/premium/checkout': 'title.premium',
  '/premium/cancel': 'title.premiumCancel',
  '/daily': 'title.daily',
  '/classroom': 'title.classroom',
  '/dev': 'title.dev',
  '/auth/confirmed': 'title.emailConfirmed',
  '/reset-password': 'title.resetPassword',
};

// A learning path's pages, its overview and every module, carry the path's
// name: the manifest title, which the path picker labels in the same words.
const PATH_TITLE_NAMES: readonly (readonly [string, TranslationKey])[] = [
  ['/learn/forward-deployed-engineer/path', 'paths.picker.fdeLabel'],
];

/** A guide address the topic route serves but no guide answers: the route
 * says "not found" in place, so the head keeps it out of search results. A
 * deeper /topics/… path is the not-found page's, which adds its own line. */
const UNKNOWN_TOPIC_PATH = /^\/topics\/[^/]+$/;

/** The path without a trailing slash ("/" stays "/"). React Router renders
 * /quiz/ as /quiz, so the head must read it the same way. */
const trimSlash = (pathname: string) => pathname.replace(/(.)\/$/, '$1');

export function routeTitle(rawPath: string, t: Translate): string {
  const pathname = trimSlash(rawPath);
  const publicTopic = topicFromPath(pathname);
  if (publicTopic) return `${publicTopic.topic.title} · ${CURRENT_PRODUCT.brand}`;
  if (pathname === '/') return CURRENT_PRODUCT.title;
  const sectionPage = publicPage(pathname);
  if (sectionPage) return t(sectionPage.titleKey);
  const titleKey = ROUTE_TITLE_KEYS[pathname];
  if (titleKey) return t(titleKey);
  // A Learn section (/learn/web-developer, …) carries the Learn title.
  if (/^\/learn\/[^/]+\/?$/.test(pathname)) return t('title.learn');
  const path = PATH_TITLE_NAMES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (path) return t('title.path', { name: t(path[1]) });
  if (pathname.startsWith('/play/')) return t('title.playMatch');
  if (pathname.startsWith('/daily/')) return t('title.daily');
  if (pathname.startsWith('/coding/')) return t('title.coding');
  return t('title.notFound');
}

// ── Share pages ────────────────────────────────────────────────────────────
//
// The build writes a head of its own for every coding task and every dated
// question of the day (vite.config.ts, #239): the task's title, a line about
// it, its canonical URL. So it does for the Coding home and its track pages
// (C4-4). The app keeps that head when it starts on such a page instead of
// writing the generic "Coding" one over it.

const SHARE_PAGE_PATH = /^\/(?:daily\/\d{4}-\d{2}-\d{2}|coding(?:\/[a-z-]+(?:\/[a-z0-9-]+)?)?)$/;
const SHARED_META = [
  'meta[name="description"]',
  'meta[property="og:title"]',
  'meta[property="og:description"]',
  'meta[property="og:image"]',
  'meta[property="og:image:alt"]',
  'meta[name="twitter:title"]',
  'meta[name="twitter:description"]',
  'meta[name="twitter:image"]',
] as const;

export interface ShareHead {
  path: string;
  title: string;
  /** The content of each of SHARED_META, in order. */
  content: string[];
  url: string;
}

/** The head this document arrived with, when it is a share page's own: its
 * canonical URL names this path. Null for the plain app shell. Read it before
 * the first route writes a head. */
export function readShareHead(): ShareHead | null {
  if (typeof document === 'undefined') return null;
  const path = trimSlash(window.location.pathname);
  if (!SHARE_PAGE_PATH.test(path)) return null;
  const url = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (url !== PUBLIC_ORIGIN + path) return null;
  const content = SHARED_META.map((selector) => document.querySelector(selector)?.getAttribute('content') ?? '');
  return { path, title: document.title, content, url };
}

/**
 * Writes the head for `pathname`. A robots line marked `data-not-found`
 * belongs to the not-found page, which adds it while it shows and removes it
 * when it goes (PublicInfoPages.tsx), so it is left alone here.
 */
export function applyRouteHead(rawPath: string, t: Translate, shareHead: ShareHead | null = null): void {
  const pathname = trimSlash(rawPath);
  const setMeta = (selector: string, value: string) => {
    document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', value);
  };
  const clear = () => document
    .querySelectorAll('link[rel="canonical"], link[hreflang], #public-schema, meta[property="og:url"], meta[name="robots"]:not([data-not-found])')
    .forEach((node) => node.remove());

  if (shareHead && shareHead.path === pathname) {
    document.title = shareHead.title;
    SHARED_META.forEach((selector, index) => setMeta(selector, shareHead.content[index]));
    clear();
    const link = document.createElement('link'); link.rel = 'canonical'; link.href = shareHead.url;
    const ogUrl = document.createElement('meta'); ogUrl.setAttribute('property', 'og:url'); ogUrl.content = shareHead.url;
    document.head.append(link, ogUrl);
    return;
  }

  const publicTopic = topicFromPath(pathname);
  document.title = routeTitle(pathname, t);
  // /premium and /premium/cancel carry their own description and canonical,
  // the same ones the build writes into their static HTML.
  const page = publicPage(pathname);
  const description = publicTopic
    ? publicTopic.topic.description
    : page ? t(page.descriptionKey) : CURRENT_PRODUCT.description;
  const image = pathname === '/daily' ? PUBLIC_ORIGIN + DAILY_SHARE_IMAGE_PATH : BRAND_SHARE_IMAGE;
  const imageAlt = pathname === '/daily' ? document.title : BRAND_SHARE_IMAGE_ALT;
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', document.title);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:image"]', image);
  setMeta('meta[property="og:image:alt"]', imageAlt);
  setMeta('meta[name="twitter:title"]', document.title);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:image"]', image);
  clear();
  const canonical = publicTopic
    ? PUBLIC_ORIGIN + pathname
    : pathname === '/' ? PUBLIC_ORIGIN + '/' : page ? PUBLIC_ORIGIN + page.path : null;
  // The build writes og:url beside every canonical it writes (vite.config.ts),
  // so the head a page arrived with and the one the app writes agree.
  if (canonical) {
    const link = document.createElement('link'); link.rel = 'canonical'; link.href = canonical;
    const ogUrl = document.createElement('meta'); ogUrl.setAttribute('property', 'og:url'); ogUrl.content = canonical;
    document.head.append(link, ogUrl);
  }
  if (publicTopic && canonical) {
    const schema = document.createElement('script'); schema.id = 'public-schema'; schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify(topicSchema(document.title, description, canonical)); document.head.append(schema);
  } else if (page?.schema === 'premium' && canonical) {
    const schema = document.createElement('script'); schema.id = 'public-schema'; schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify(premiumSchema(document.title, description, canonical)); document.head.append(schema);
  } else if (UNKNOWN_TOPIC_PATH.test(pathname) || NOINDEX_PATHS.includes(pathname)) {
    const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.append(robots);
  }
}
