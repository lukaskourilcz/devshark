import { FDE_SECTION_VISIBLE } from '../../../shared/learn-section-ids';
import { TOPIC_LANDINGS, type TopicLandingDefinition } from './topicCatalog';
import { PREMIUM_PRICE } from '../../../shared/tiers';
import type { TranslationKey } from '../i18n/translations';
export const PUBLIC_ORIGIN = 'https://devshark.app';
export const BRAND_SHARE_IMAGE = PUBLIC_ORIGIN + '/og-image.png?v=20261012';
export const BRAND_SHARE_IMAGE_ALT = 'devShark — Lessons, quizzes and coding challenges';
export const DAILY_SHARE_IMAGE_PATH = '/og/daily.png';
/** Resolve only the published English guide addresses. */
export function topicFromPath(pathname: string): { topic: TopicLandingDefinition } | null {
  const match = /^\/topics\/([a-z0-9-]+)\/?$/.exec(pathname);
  if (!match) return null;
  const topic = TOPIC_LANDINGS.find(topic => topic.slug === match[1]);
  return topic ? { topic } : null;
}
export function topicSchema(title: string, description: string, url: string) {
  return { '@context': 'https://schema.org', '@type': 'LearningResource', name: title, description, url, inLanguage: 'en', learningResourceType: 'Quick guide', isAccessibleForFree: true };
}

/** App routes with their own static HTML, canonical URL and sitemap entry
 * (#222). The build prerenders them (vite.config.ts), the app shell sets the
 * same canonical and description at runtime, and check:public reads them back
 * from the sitemap. Descriptions are translation keys, resolved by the caller. */
const ALL_PUBLIC_PAGES = [
  { path: '/learn/web-developer', titleKey: 'title.learnWebDeveloper', descriptionKey: 'publicSection.webDeveloper', schema: null },
  { path: '/learn/software-engineer', titleKey: 'title.learnSoftwareEngineer', descriptionKey: 'publicSection.softwareEngineer', schema: null },
  { path: '/learn/forward-deployed-engineer', titleKey: 'title.learnFde', descriptionKey: 'publicSection.fde', schema: null },
  { path: '/premium', titleKey: 'title.premium', descriptionKey: 'premium.page.lead', schema: 'premium' },
  { path: '/premium/cancel', titleKey: 'title.premiumCancel', descriptionKey: 'billing.cancel.lead', schema: null },
  // #239: the public question of the day (its dated pages /daily/<date> have
  // their own static heads, outside the sitemap).
  { path: '/daily', titleKey: 'title.daily', descriptionKey: 'daily.description', schema: null },
] as const;
export const PUBLIC_PAGES = ALL_PUBLIC_PAGES.filter(page => FDE_SECTION_VISIBLE || page.path !== '/learn/forward-deployed-engineer');
export type PublicPage = (typeof PUBLIC_PAGES)[number];
export const publicPage = (pathname: string): PublicPage | null =>
  PUBLIC_PAGES.find((page) => page.path === pathname.replace(/(.)\/$/, '$1')) ?? null;

/** A key of the privacy policy's own dictionary (translations.privacy.ts),
 * which only the legal pages load. Named by its prefix, so neither this file
 * nor the build config (tsconfig.node.json) imports that dictionary. */
export type PrivacyCopyKey = `legal.privacy.${string}`;
export const isPrivacyCopyKey = (key: string): key is PrivacyCopyKey => key.startsWith('legal.privacy.');
type PageCopyKey = TranslationKey | PrivacyCopyKey;
export interface PrerenderedAppPage {
  path: string;
  titleKey: TranslationKey;
  /** The h1 and the lead the live page opens with: the build puts them in a
   * noscript for a visitor without JavaScript. */
  headingKey: PageCopyKey;
  leadKey: PageCopyKey;
  /** The page copy the description is cut from (metaDescription), joined
   * with a space. */
  descriptionKeys: readonly PageCopyKey[];
  /** The LegalPages.tsx constant holding the date the page last changed: the
   * build reads it from that file's source as the sitemap's lastmod. */
  updated?: 'LEGAL_UPDATED' | 'PRIVACY_UPDATED';
}
/** App routes the build writes a static page for too (F15-11): a title, a
 * description cut from the page's own copy, a canonical URL and og:url, a
 * sitemap entry, and the page's h1 and lead in a noscript; the app is the
 * body. The app (routeHead.ts) writes the same canonical and description.
 * Kept apart from PUBLIC_PAGES, which scripts/test-launch-contracts.ts holds
 * to one vercel.json rewrite each: until those rewrites land (F15-55),
 * Vercel serves <path>/index.html as a directory index, as it does
 * /sandbox. */
export const PRERENDERED_APP_PAGES: readonly PrerenderedAppPage[] = [
  { path: '/privacy', titleKey: 'title.privacy', headingKey: 'legal.privacy.title', leadKey: 'legal.privacy.lead', descriptionKeys: ['legal.privacy.lead'], updated: 'PRIVACY_UPDATED' },
  { path: '/terms', titleKey: 'title.terms', headingKey: 'legal.terms.title', leadKey: 'legal.terms.lead', descriptionKeys: ['legal.terms.lead'], updated: 'LEGAL_UPDATED' },
];
export const prerenderedAppPage = (pathname: string): PrerenderedAppPage | null =>
  PRERENDERED_APP_PAGES.find((page) => page.path === pathname.replace(/(.)\/$/, '$1')) ?? null;

/** The longest description a head carries, in characters: about what a
 * search result shows (check:public asserts 50 to 160). */
export const META_DESCRIPTION_MAX = 160;
/**
 * A page's head description, made from its page copy: the copy itself when it
 * fits, else its longest run of whole sentences from the start that fits, else
 * its first words and an ellipsis. Counted in code points. The build
 * (vite.config.ts) and the app (routeHead.ts) both cut with it, so the head a
 * page arrives with and the head the app writes agree; the page itself still
 * shows the whole copy.
 */
export function metaDescription(text: string): string {
  const fits = (value: string) => [...value].length <= META_DESCRIPTION_MAX;
  if (fits(text)) return text;
  let cut = '';
  // A sentence ends at . ! or ? before a space and a capital, a digit or an
  // opening quote; "4.99" and "e.g. a" do not end one.
  for (const end of text.matchAll(/[.!?](?=\s+["'“‘(]?[A-Z0-9])/g)) {
    const next = text.slice(0, end.index + 1);
    if (!fits(next)) break;
    cut = next;
  }
  if (cut) return cut;
  const start = [...text].slice(0, META_DESCRIPTION_MAX - 1).join('');
  const space = start.lastIndexOf(' ');
  return `${(space > 0 ? start.slice(0, space) : start).replace(/[\s,;:.]+$/, '')}…`;
}

/** The description in a coding task's share page head (vite.config.ts, #239):
 * "An easy JavaScript coding challenge…", "A medium…". */
export function codingShareDescription({ difficulty, track, brand, free, total }: { difficulty: string; track: string; brand: string; free: number; total: number }): string {
  const level = difficulty.toLowerCase();
  return `${/^[aeiou]/.test(level) ? 'An' : 'A'} ${level} ${track} coding challenge on ${brand}, graded on the server. ${free} of ${total} coding tasks are free.`;
}

/** App routes that must stay out of search results: a Stripe return carries a
 * checkout id and means nothing to anyone else, and the pages an email link
 * opens mean something only to whoever got the email. */
export const NOINDEX_PATHS: readonly string[] = ['/admin', '/admin/users', '/admin/vouchers', '/admin/emails', '/admin/questions', '/admin/triage', '/admin/quality', '/admin/paths', '/admin/flags', '/admin/settings', '/admin/logs', '/admin/merch', '/premium/success', '/premium/checkout', '/auth/confirmed', '/reset-password'];

/** Structured data for /premium. The guides above stay free to read
 * (`isAccessibleForFree: true`); Premium is the paid subscription, so it says
 * `false` and lists both prices before VAT. */
export function premiumSchema(title: string, description: string, url: string) {
  const offer = (period: 'monthly' | 'annual') => ({
    '@type': 'Offer',
    name: period === 'annual' ? 'devShark Premium, yearly' : 'devShark Premium, monthly',
    price: PREMIUM_PRICE[period],
    priceCurrency: PREMIUM_PRICE.currency,
    url,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price: PREMIUM_PRICE[period],
      priceCurrency: PREMIUM_PRICE.currency,
      valueAddedTaxIncluded: PREMIUM_PRICE.taxBehavior !== 'exclusive',
      billingDuration: period === 'annual' ? 'P1Y' : 'P1M',
    },
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: title,
    description,
    url,
    inLanguage: 'en',
    learningResourceType: 'Subscription',
    isAccessibleForFree: false,
    offers: [offer('monthly'), offer('annual')],
  };
}
