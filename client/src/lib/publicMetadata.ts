import { FDE_SECTION_VISIBLE } from '../../../shared/learn-section-ids';
import { TOPIC_LANDINGS, type TopicLandingDefinition } from './topicCatalog';
import { PREMIUM_PRICE } from '../../../shared/tiers';
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
