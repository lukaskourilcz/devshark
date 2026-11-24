// The Terms of use and the privacy policy (#222). Both read their words from
// the legal.* keys, the price and the free plan from shared/tiers.ts, the
// trader from TRADER in client/product-catalog.ts and the seller of record
// from the public billing settings, so no fact lives in two places.
//
// The trader fields render only when the owner has set them; until then the
// page says they are missing rather than guessing. The owner's lawyer reviews
// the wording (NEEDED.md). The EU online dispute platform closed on 20 July
// 2025, so the page names the Czech out-of-court body and no ODR link.
import { useCallback, useEffect, useId, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { interpolate, useLanguage } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { termsEn, type TermsKey } from '../i18n/translations.terms';
import { privacyEn, type PrivacyKey } from '../i18n/translations.privacy';
import { useBilling } from '../lib/billing';
import { useMediaQuery } from '../lib/useMediaQuery';
import { openConsentSettings } from '../lib/consent';
import { useLaunchOffer } from '../lib/launchOffer';
import { TRADER } from '../../product-catalog';
import { FREE_LEARN_LEVELS, PREMIUM_PRICE } from '../../../shared/tiers';
import { Page } from './PublicInfoPages';
import './LegalPages.css';

/** The date of the current wording. Change it with the words. */
export const LEGAL_UPDATED = '2026-10-09';
export const PRIVACY_UPDATED = '2026-10-14';

const ADR_URL = 'https://coi.gov.cz/en/information-about-adr/';
const STRIPE_PRIVACY_URL = 'https://stripe.com/privacy';
const LINK_PRIVACY_URL = 'https://link.com/privacy';

type Seller = 'link' | 'trader' | null;

type CopyKey = TranslationKey | PrivacyKey | TermsKey;
const isPrivacyKey = (key: CopyKey): key is PrivacyKey => Object.prototype.hasOwnProperty.call(privacyEn, key);
const isTermsKey = (key: CopyKey): key is TermsKey => Object.prototype.hasOwnProperty.call(termsEn, key);

function useCopy() {
  const { t } = useLanguage();
  return useCallback((key: CopyKey, vars?: Parameters<typeof t>[1]): string => {
    if (isPrivacyKey(key)) return privacyEn[key];
    if (isTermsKey(key)) return interpolate(termsEn[key], vars);
    return t(key, vars);
  }, [t]);
}
interface LinkSpec { to: string; label: CopyKey; external?: boolean; when?: (seller: Seller) => boolean }
type Block =
  | { kind: 'p'; key: CopyKey }
  | { kind: 'seller'; link: CopyKey; trader: CopyKey; unknown: CopyKey }
  | { kind: 'waiver' }
  | { kind: 'links'; links: LinkSpec[] }
  | { kind: 'trader' }
  | { kind: 'form' }
  // The launch price paragraph: rendered only while the offer is on.
  | { kind: 'launch' }
  | { kind: 'list'; items: CopyKey[] }
  | { kind: 'table'; caption: CopyKey; head: CopyKey[]; rows: Cell[][] }
  // Opens the cookie settings dialog (CookieConsent.tsx).
  | { kind: 'consent' };
interface Section { id: string; title: CopyKey; blocks: Block[] }

const p = (key: CopyKey): Block => ({ kind: 'p', key });

const TERMS: Section[] = [
  { id: 'trader', title: 'legal.terms.trader.title', blocks: [p('legal.terms.trader.body'), { kind: 'trader' }] },
  { id: 'plans', title: 'legal.terms.plans.title', blocks: [p('legal.terms.plans.free'), p('legal.terms.plans.premium'), p('legal.terms.plans.fair')] },
  {
    id: 'price',
    title: 'legal.terms.price.title',
    blocks: [
      p('legal.terms.price.body'),
      { kind: 'launch' },
      p('legal.terms.price.discount'),
      { kind: 'seller', link: 'legal.terms.price.sellerLink', trader: 'legal.terms.price.sellerTrader', unknown: 'legal.terms.price.sellerUnknown' },
    ],
  },
  {
    id: 'renewal',
    title: 'legal.terms.renewal.title',
    blocks: [
      p('legal.terms.renewal.body'),
      p('legal.terms.renewal.cancel'),
      { kind: 'links', links: [{ to: '/premium/cancel', label: 'legal.link.cancel' }, { to: '/profile', label: 'legal.link.profile' }] },
      p('legal.terms.renewal.failed'),
    ],
  },
  { id: 'withdrawal', title: 'legal.terms.withdrawal.title', blocks: [p('legal.terms.withdrawal.body'), { kind: 'waiver' }, p('legal.terms.withdrawal.consequence')] },
  {
    id: 'refund',
    title: 'legal.terms.refund.title',
    blocks: [p('legal.terms.refund.body'), p('legal.terms.refund.takeBack'), { kind: 'links', links: [{ to: '/premium/cancel?action=withdraw', label: 'legal.link.cancel' }] }],
  },
  { id: 'how-to-withdraw', title: 'legal.terms.howTo.title', blocks: [p('legal.terms.howTo.body'), { kind: 'form' }] },
  { id: 'grants', title: 'legal.terms.grants.title', blocks: [p('legal.terms.grants.body')] },
  { id: 'fair-use', title: 'legal.terms.fairUse.title', blocks: [p('legal.terms.fairUse.body')] },
  { id: 'content', title: 'legal.terms.content.title', blocks: [p('legal.terms.content.body')] },
  { id: 'account', title: 'legal.terms.account.title', blocks: [p('legal.terms.account.body')] },
  { id: 'changes', title: 'legal.terms.changes.title', blocks: [p('legal.terms.changes.body')] },
  {
    id: 'law',
    title: 'legal.terms.law.title',
    blocks: [p('legal.terms.law.body'), p('legal.terms.law.adr'), { kind: 'links', links: [{ to: ADR_URL, label: 'legal.link.adr', external: true }] }],
  },
  { id: 'complaints', title: 'legal.terms.complaints.title', blocks: [p('legal.terms.complaints.body')] },
];

/** A table cell: words from the dictionary, or a storage name shown as code. */
type Cell = CopyKey | { code: string; where: CopyKey };

/** What devShark keeps in the browser (the cookie table). The names are the
 * real keys: lib/consent.ts, lib/supabaseClient.ts, lib/analytics.ts and the
 * PostHog SDK. Keep the table in step with them. */
const COOKIE_ROWS: Cell[][] = [
  [{ code: 'devshark_consent', where: 'legal.privacy.cookies.cookie' }, 'legal.privacy.cookies.consentCookie', 'legal.privacy.cookies.months12', 'legal.privacy.cookies.necessary'],
  [{ code: 'devshark:consent', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.consentLocal', 'legal.privacy.cookies.months12Ask', 'legal.privacy.cookies.necessary'],
  [{ code: 'sb-…-auth-token', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.signIn', 'legal.privacy.cookies.untilSignOut', 'legal.privacy.cookies.necessary'],
  [{ code: 'sb-…-auth-token-code-verifier', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.verifier', 'legal.privacy.cookies.untilSignedIn', 'legal.privacy.cookies.necessary'],
  [{ code: 'devquiz:…, devshark:…', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.app', 'legal.privacy.cookies.untilCleared', 'legal.privacy.cookies.necessary'],
  [{ code: 'devquiz:…, devshark:…', where: 'legal.privacy.cookies.session' }, 'legal.privacy.cookies.tab', 'legal.privacy.cookies.untilTabCloses', 'legal.privacy.cookies.necessary'],
  [{ code: 'devshark:campaign', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.campaign', 'legal.privacy.cookies.days30', 'legal.privacy.cookies.analytics'],
  [{ code: 'ph_…_posthog', where: 'legal.privacy.cookies.cookieAndLocal' }, 'legal.privacy.cookies.posthog', 'legal.privacy.cookies.months12', 'legal.privacy.cookies.analytics'],
  [{ code: '__ph_opt_in_out_…', where: 'legal.privacy.cookies.local' }, 'legal.privacy.cookies.posthogConsent', 'legal.privacy.cookies.untilWithdraw', 'legal.privacy.cookies.analytics'],
  [{ code: 'ph_…_window_id', where: 'legal.privacy.cookies.session' }, 'legal.privacy.cookies.posthogTab', 'legal.privacy.cookies.untilTabCloses', 'legal.privacy.cookies.analytics'],
];

/** How long each kind of data stays. The periods are the purge routines in
 * supabase/ (purge_expired_learning_data, 057 for the sign-in log) and the
 * limits in lib/rate-limit.ts and lib/consent.ts. */
const RETENTION_ROWS: Cell[][] = [
  ['legal.privacy.retention.account', 'legal.privacy.retention.untilDeletion'],
  ['legal.privacy.retention.answers', 'legal.privacy.retention.days90'],
  ['legal.privacy.retention.coding', 'legal.privacy.retention.codingHow'],
  ['legal.privacy.retention.signIn', 'legal.privacy.cookies.months12'],
  ['legal.privacy.retention.reports', 'legal.privacy.retention.reportsHow'],
  ['legal.privacy.retention.rooms', 'legal.privacy.retention.roomsHow'],
  ['legal.privacy.retention.hallOfFame', 'legal.privacy.retention.hallOfFameHow'],
  ['legal.privacy.retention.cancel', 'legal.privacy.retention.cancelHow'],
  ['legal.privacy.retention.rateLimits', 'legal.privacy.retention.hours2'],
  ['legal.privacy.retention.consent', 'legal.privacy.cookies.months12Ask'],
  ['legal.privacy.retention.analytics', 'legal.privacy.retention.analyticsHow'],
  ['legal.privacy.retention.backups', 'legal.privacy.retention.days7'],
];

const PRIVACY: Section[] = [
  {
    id: 'controller',
    title: 'legal.privacy.controller.title',
    blocks: [p('legal.privacy.controller.body'), { kind: 'links', links: [{ to: '/terms#trader', label: 'legal.link.terms' }] }],
  },
  { id: 'account', title: 'legal.privacy.account.title', blocks: [p('legal.privacy.account.body'), p('legal.privacy.account.log')] },
  { id: 'learning', title: 'legal.privacy.learning.title', blocks: [p('legal.privacy.learning.body'), p('legal.privacy.learning.month'), p('legal.privacy.learning.guest')] },
  { id: 'friends', title: 'legal.privacy.friends.title', blocks: [p('legal.privacy.friends.body'), p('legal.privacy.friends.see')] },
  { id: 'leaderboards', title: 'legal.privacy.leaderboards.title', blocks: [p('legal.privacy.leaderboards.body'), p('legal.privacy.leaderboards.month')] },
  { id: 'hall-of-fame', title: 'legal.privacy.hallOfFame.title', blocks: [p('legal.privacy.hallOfFame.body')] },
  { id: 'play', title: 'legal.privacy.play.title', blocks: [p('legal.privacy.play.body')] },
  { id: 'invitations', title: 'legal.privacy.referrals.title', blocks: [p('legal.privacy.referrals.body'), p('legal.privacy.referrals.deletion')] },
  { id: 'reports', title: 'legal.privacy.reports.title', blocks: [p('legal.privacy.reports.body')] },
  {
    id: 'payments',
    title: 'legal.privacy.payments.title',
    blocks: [
      p('legal.privacy.payments.body'),
      { kind: 'seller', link: 'legal.privacy.payments.sellerLink', trader: 'legal.privacy.payments.sellerTrader', unknown: 'legal.privacy.payments.sellerUnknown' },
      {
        kind: 'links',
        links: [
          { to: STRIPE_PRIVACY_URL, label: 'legal.link.stripePrivacy', external: true },
          { to: LINK_PRIVACY_URL, label: 'legal.link.linkPrivacy', external: true, when: (seller) => seller === 'link' },
        ],
      },
    ],
  },
  { id: 'vouchers', title: 'legal.privacy.voucher.title', blocks: [p('legal.privacy.voucher.body')] },
  { id: 'merchandise', title: 'legal.privacy.merch.title', blocks: [p('legal.privacy.merch.body')] },
  { id: 'email', title: 'legal.privacy.email.title', blocks: [p('legal.privacy.email.body')] },
  {
    id: 'cookies',
    title: 'legal.privacy.cookies.title',
    blocks: [
      p('legal.privacy.cookies.body'),
      { kind: 'consent' },
      {
        kind: 'table',
        caption: 'legal.privacy.cookies.caption',
        head: ['legal.privacy.cookies.colName', 'legal.privacy.cookies.colPurpose', 'legal.privacy.cookies.colLifetime', 'legal.privacy.cookies.colCategory'],
        rows: COOKIE_ROWS,
      },
      p('legal.privacy.cookies.others'),
    ],
  },
  { id: 'analytics', title: 'legal.privacy.analytics.title', blocks: [p('legal.privacy.analytics.body'), p('legal.privacy.analytics.withdraw')] },
  { id: 'marketing', title: 'legal.privacy.marketing.title', blocks: [p('legal.privacy.marketing.body')] },
  { id: 'errors', title: 'legal.privacy.errors.title', blocks: [p('legal.privacy.errors.body')] },
  {
    id: 'providers',
    title: 'legal.privacy.providers.title',
    blocks: [
      p('legal.privacy.providers.body'),
      {
        kind: 'list',
        items: [
          'legal.privacy.providers.supabase',
          'legal.privacy.providers.vercel',
          'legal.privacy.providers.upstash',
          'legal.privacy.providers.stripe',
          'legal.privacy.providers.resend',
          'legal.privacy.providers.posthog',
          'legal.privacy.providers.sentry',
          'legal.privacy.providers.github',
        ],
      },
      p('legal.privacy.providers.transfers'),
    ],
  },
  { id: 'ai', title: 'legal.privacy.ai.title', blocks: [p('legal.privacy.ai.body')] },
  { id: 'github', title: 'legal.privacy.github.title', blocks: [p('legal.privacy.github.body')] },
  {
    id: 'legal-bases',
    title: 'legal.privacy.bases.title',
    blocks: [{ kind: 'list', items: ['legal.privacy.bases.contract', 'legal.privacy.bases.interest', 'legal.privacy.bases.consent', 'legal.privacy.bases.law'] }],
  },
  {
    id: 'retention',
    title: 'legal.privacy.retention.title',
    blocks: [{ kind: 'table', caption: 'legal.privacy.retention.caption', head: ['legal.privacy.retention.colWhat', 'legal.privacy.retention.colHow'], rows: RETENTION_ROWS }],
  },
  { id: 'deletion', title: 'legal.privacy.deletion.title', blocks: [p('legal.privacy.deletion.body'), p('legal.privacy.deletion.kept')] },
  { id: 'rights', title: 'legal.privacy.rights.title', blocks: [p('legal.privacy.rights.body')] },
  { id: 'changes', title: 'legal.privacy.changes.title', blocks: [p('legal.privacy.changes.body')] },
  {
    id: 'contact',
    title: 'legal.privacy.contact.title',
    blocks: [p('legal.privacy.contact.body'), { kind: 'links', links: [{ to: '/terms#trader', label: 'legal.link.terms' }] }],
  },
];

const TRADER_ROWS = [
  ['legal.trader.name', 'name'],
  ['legal.trader.companyId', 'companyId'],
  ['legal.trader.address', 'registeredAddress'],
  ['legal.trader.email', 'email'],
] as const satisfies readonly (readonly [TranslationKey, keyof typeof TRADER])[];

/** The trader's details that are set, in order. */
export function traderRows(trader = TRADER): { label: TranslationKey; field: keyof typeof TRADER; value: string }[] {
  return TRADER_ROWS.flatMap(([label, field]) => {
    const value = trader[field]?.trim();
    return value ? [{ label, field, value }] : [];
  });
}

function TraderDetails() {
  const { t } = useLanguage();
  const rows = traderRows();
  return (
    <>
      {rows.length > 0 && (
        <dl className="ss-legal-trader">
          {rows.map((row) => (
            <div key={row.field}>
              <dt>{t(row.label)}</dt>
              <dd>{row.field === 'email' ? <a href={`mailto:${row.value}`}>{row.value}</a> : row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {rows.length < TRADER_ROWS.length && (
        <p className="ss-info-note">{t(rows.length === 0 ? 'legal.trader.none' : 'legal.trader.partial')}</p>
      )}
    </>
  );
}

function WithdrawalForm() {
  const { t } = useLanguage();
  const headingId = useId();
  const set = traderRows().filter((row) => row.field !== 'companyId').map((row) => row.value);
  const to = set.length > 0 ? set.join(', ') : t('legal.terms.form.toFallback');
  const lines: TranslationKey[] = [
    'legal.terms.form.notice',
    'legal.terms.form.ordered',
    'legal.terms.form.name',
    'legal.terms.form.address',
    'legal.terms.form.signature',
    'legal.terms.form.date',
  ];
  return (
    <div className="ss-legal-form" role="group" aria-labelledby={headingId}>
      <h3 id={headingId}>{t('legal.terms.form.title')}</h3>
      <p className="ss-legal-form__intro">{t('legal.terms.form.intro')}</p>
      <p>{t('legal.terms.form.to', { trader: to })}</p>
      {lines.map((key) => <p key={key}>{t(key)}</p>)}
    </div>
  );
}

function LinkRow({ links, seller }: { links: LinkSpec[]; seller: Seller }) {
  const t = useCopy();
  const shown = links.filter((link) => !link.when || link.when(seller));
  return (
    <p className="ss-text-links">
      {shown.map((link) => (link.external
        ? <a key={link.to} href={link.to} rel="noopener noreferrer">{t(link.label)}</a>
        : <Link key={link.to} to={link.to}>{t(link.label)}</Link>))}
    </p>
  );
}

function LegalTable({ caption, head, rows }: { caption: CopyKey; head: CopyKey[]; rows: Cell[][] }) {
  const t = useCopy();
  const captionId = useId();
  // A wide table scrolls inside its own box on a phone, never the page; the
  // box takes focus so a keyboard can scroll it too.
  return (
    <div className="ss-legal-table" role="region" aria-labelledby={captionId} tabIndex={0}>
      <table>
        <caption id={captionId}>{t(caption)}</caption>
        <thead>
          <tr>{head.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => {
                if (typeof cell !== 'string') {
                  return (
                    <th key={column} scope="row">
                      <code>{cell.code}</code>
                      <span className="ss-legal-table__where">{t(cell.where)}</span>
                    </th>
                  );
                }
                return column === 0 ? <th key={column} scope="row">{t(cell)}</th> : <td key={column}>{t(cell)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 'On this page': the section titles as jump links, under the lead (UX audit
 * shell-public-18). The privacy policy is 26 sections over 9,000px. Body type
 * and no panel; closed on a phone, where it would push the first section a
 * screen down, and open from 1024px. The titles are the sections' own, so no
 * legal wording changes. A jump scrolls inside <main> and moves focus to the
 * section's heading, so the next Tab continues from there.
 */
function LegalIndex({ sections }: { sections: Section[] }) {
  const t = useCopy();
  const wide = useMediaQuery('(min-width: 1024px)');
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true });
  };
  return (
    // Keyed by the width, so it opens or closes when the breakpoint is crossed
    // and otherwise keeps what the reader chose.
    <details key={wide ? 'wide' : 'narrow'} className="ss-legal-index" open={wide}>
      <summary>{t('page.onThisPage')}</summary>
      <nav aria-label={t('page.onThisPage')}>
        <ol>
          {sections.map((section) => (
            <li key={section.id}>
              <Link to={`#${section.id}`} onClick={() => jump(section.id)}>{t(section.title)}</Link>
            </li>
          ))}
        </ol>
      </nav>
    </details>
  );
}

function LegalDocument({ title, lead, sections }: { title: CopyKey; lead: CopyKey; sections: Section[] }) {
  const t = useCopy();
  const billing = useBilling();
  const { hash } = useLocation();
  // Until the settings arrive, the seller sentence stays neutral.
  const seller: Seller = billing.known ? billing.seller : null;
  const offer = useLaunchOffer();
  const vars = {
    level: FREE_LEARN_LEVELS.react ?? 0,
    symbol: PREMIUM_PRICE.symbol,
    monthly: PREMIUM_PRICE.monthly,
    annual: PREMIUM_PRICE.annual,
  };
  const updated = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${title === 'legal.privacy.title' ? PRIVACY_UPDATED : LEGAL_UPDATED}T00:00:00Z`));

  // Another page links to a section (/terms#trader); the app scrolls inside
  // <main>, so the browser's own jump does not happen on a client navigation.
  // A malformed escape (/privacy#%E0) makes decodeURIComponent throw, which
  // replaced the whole policy with the error page: such a hash names no
  // section, so the page simply stays at the top.
  useEffect(() => {
    if (!hash) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const render = (block: Block, index: number): ReactNode => {
    switch (block.kind) {
      case 'p': return <p key={index}>{t(block.key, vars)}</p>;
      case 'seller': return <p key={index}>{t(seller === 'link' ? block.link : seller === 'trader' ? block.trader : block.unknown)}</p>;
      case 'waiver': return <blockquote key={index} className="ss-legal-quote"><p>{t('premium.page.waiver')}</p></blockquote>;
      case 'links': return <LinkRow key={index} links={block.links} seller={seller} />;
      case 'trader': return <TraderDetails key={index} />;
      case 'form': return <WithdrawalForm key={index} />;
      case 'launch': return offer ? <p key={index}>{t('legal.terms.price.launch', offer)}</p> : null;
      case 'list': return <ul key={index} className="ss-legal-list">{block.items.map((key) => <li key={key}>{t(key)}</li>)}</ul>;
      case 'table': return <LegalTable key={index} caption={block.caption} head={block.head} rows={block.rows} />;
      case 'consent': return (
        <p key={index} className="ss-text-links">
          <button type="button" onClick={openConsentSettings} aria-haspopup="dialog">{t('legal.privacy.cookies.change')}</button>
        </p>
      );
    }
  };

  return (
    // The 'Legal' kicker, as the purchase steps carry 'devShark Premium'
    // (UX audit money-08): every Page names its group above the h1.
    <Page kicker={t('page.legalKicker')} title={t(title)} lead={t(lead)}>
      <p className="ss-legal-updated">{t('legal.updated', { date: updated })}</p>
      <LegalIndex sections={sections} />
      <div className="ss-legal">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="ss-legal-section" aria-labelledby={`${section.id}-title`}>
            <h2 id={`${section.id}-title`} tabIndex={-1}>{t(section.title)}</h2>
            {section.blocks.map(render)}
          </section>
        ))}
      </div>
    </Page>
  );
}

export const TermsPage = () => <LegalDocument title="legal.terms.title" lead="legal.terms.lead" sections={TERMS} />;
export const PrivacyPage = () => <LegalDocument title="legal.privacy.title" lead="legal.privacy.lead" sections={PRIVACY} />;
