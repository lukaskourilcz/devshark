import { FDE_SECTION_VISIBLE } from '../../../../shared/learn-section-ids';
// The plan table: what every account gets next to what Premium opens. It sits
// on the landing and on /premium. The free column mirrors `shared/tiers.ts`
// (the three free topics, React up to FREE_LEARN_LEVELS.react, a starter set
// of challenges and the opening stages of every project); the counts come from the
// registries, and every word from the landing.compare.* keys.
//
// Deep End v2: an editorial section (kicker, h2, subtitle), one .ss-panel
// wrapping a real <table>. Under 600px each row becomes a small block: the
// feature on its own line, then Free and Premium side by side (UX audit
// shell-public-07 and money-16), so no cell is squeezed to 77px. The table
// keeps explicit ARIA roles, because a table drawn with display: grid or
// block loses its implicit ones in some browsers. Status is a ✓ / – / ✗
// glyph PLUS a word, so it never relies on colour alone.

import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { FREE_LEARN_LEVELS, PREMIUM_PRICE } from '../../../../shared/tiers';
import { useLaunchOffer } from '../../lib/launchOffer';
import { useEntitlement } from '../../lib/entitlement';
import { useAuth } from '../../lib/auth';
import { LaunchOfferNote, PremiumMonthlyCaption } from '../LaunchOffer';
import { SUBJECT_SCOPE_CATALOG } from '../../../../shared/subject-catalog';
import { Button } from '@astryxdesign/core/Button';
import { Kicker, SwimCta } from './LandingKit';
import { anyLearningPathOpen, redemptionOpen, useGameConfig } from '../../lib/gameConfig';
import './landingSections.css';

type MarkKind = 'yes' | 'partial' | 'no';

/** Tiny inline status marks (feather geometry, currentColor). Decorative — the
 *  neighbouring word is the accessible text. */
function Mark({ kind }: { kind: MarkKind }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 3,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  if (kind === 'yes') return (<svg {...common}><polyline points="20 6 9 17 4 12" /></svg>);
  if (kind === 'no') return (<svg {...common}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>);
  return (<svg {...common}><line x1="5" y1="12" x2="19" y2="12" /></svg>); // partial: a minus
}

interface Cell { mark: MarkKind; key: TranslationKey }
/** A row that describes something not open yet names the switch that opens
 * it, and renders only while that switch is on (design audit P0.1). */
interface PlanRow { labelKey: TranslationKey; free: Cell; premium: Cell; when?: 'paths' | 'redemption' }

const YES: Cell = { mark: 'yes', key: 'landing.compare.yes' };
const NO: Cell = { mark: 'no', key: 'landing.compare.no' };

// Access first, then what both plans share, then coins once redemption opens.
// Projects and the FDE path have rows of their own (UX audit money-03), so the
// table says everything the Premium list says and /premium can drop the list;
// the coding row no longer folds the project stages into its free cell. The
// AI and bilingual rows of the old table are gone, because devShark ships
// neither.
export const PLAN_ROWS: readonly PlanRow[] = [
  { labelKey: 'landing.compare.rowLessons', free: { mark: 'partial', key: 'landing.compare.othersLessons' }, premium: { mark: 'yes', key: 'landing.compare.premiumLessons' } },
  { labelKey: 'landing.compare.rowReact', free: { mark: 'partial', key: 'landing.compare.freeReact' }, premium: { mark: 'yes', key: 'landing.compare.premiumReact' } },
  { labelKey: 'landing.compare.rowCoding', free: { mark: 'partial', key: 'landing.compare.freeCoding' }, premium: { mark: 'yes', key: 'landing.compare.premiumCoding' } },
  { labelKey: 'landing.compare.rowProjects', free: { mark: 'partial', key: 'landing.compare.freeProjects' }, premium: { mark: 'yes', key: 'landing.compare.premiumProjects' } },
  { labelKey: 'landing.compare.rowPaths', free: { mark: 'partial', key: 'landing.compare.freePaths' }, premium: { mark: 'yes', key: 'landing.compare.premiumPaths' }, when: 'paths' },
  { labelKey: 'landing.compare.rowQuizzes', free: YES, premium: YES },
  { labelKey: 'landing.compare.rowLeaderboards', free: YES, premium: YES },
  // Redemption ships closed until the owner opens it, so the claim says so,
  // as the paths row does (review finding product-6).
  { labelKey: 'landing.compare.rowCoins', free: NO, premium: { mark: 'yes', key: 'landing.compare.premiumCoins' }, when: 'redemption' },
];

export interface ComparisonTableProps {
  /** Where the "Start free" CTA navigates. Defaults to /learn. */
  startHref?: string;
  /** If provided, the CTA becomes a button calling this instead of a link
   *  (e.g. to scroll to the topic picker on the same page). */
  onStart?: () => void;
  /** /premium has its own plan actions, so it leaves the CTA out. */
  showCta?: boolean;
  /** The launch-price note under the table; /premium prints it by its plans. */
  showOfferNote?: boolean;
  /** Optional homepage announcement directly below the comparison card. */
  afterTable?: ReactNode;
  /** Inside a page that already has its own section kicker and states VAT by
   *  its prices (/premium): the table leaves out its kicker, its subtitle and
   *  the Premium caption's ", before VAT" (UX audit money-03). */
  embedded?: boolean;
}

export default function ComparisonTable({ startHref = '/learn', onStart, showCta = true, showOfferNote = true, afterTable, embedded = false }: ComparisonTableProps) {
  const t = useT();
  const offer = useLaunchOffer();
  const entitlement = useEntitlement();
  const { isAuthenticated } = useAuth();
  const headingId = useId();
  const config = useGameConfig();
  const open = { paths: FDE_SECTION_VISIBLE && anyLearningPathOpen(config), redemption: redemptionOpen(config) };
  const rows = PLAN_ROWS.filter((row) => !row.when || open[row.when]);
  const vars = {
    topics: SUBJECT_SCOPE_CATALOG.webdev.topics.length,
    level: FREE_LEARN_LEVELS.react ?? 0,
    symbol: PREMIUM_PRICE.symbol,
    monthly: PREMIUM_PRICE.monthly,
    annual: PREMIUM_PRICE.annual,
  };

  const cell = ({ mark, key }: Cell) => (
    <span className={`ss-compare-mark ss-compare-mark--${mark}`}>
      <Mark kind={mark} />
      {t(key, vars)}
    </span>
  );

  return (
    <section aria-labelledby={headingId} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!embedded && <Kicker>{t('landing.compare.kicker')}</Kicker>}
        <h2 id={headingId} className="ss-section-title" style={{ marginTop: 4 }}>
          {t('landing.compare.title')}
        </h2>
        {!embedded && (
          <p style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-secondary)', maxWidth: '70ch' }}>
            {t('landing.compare.subtitle', vars)}
          </p>
        )}
      </div>

      <div className="ss-panel" style={{ overflow: 'hidden' }}>
        <div
          className="ss-compare-scroll"
          role="region"
          aria-label={t('landing.compare.title')}
          tabIndex={0}
        >
          <table className="ss-compare" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="ss-compare__featurecol">{t('landing.compare.colFeature')}</th>
                <th scope="col" role="columnheader">
                  {t('landing.compare.colBrand')}
                  <span className="ss-compare-caption">{t('landing.compare.freeCaption')}</span>
                </th>
                <th scope="col" role="columnheader" className="ss-compare__herocell">
                  {t('landing.compare.colOthers')}
                  <span className="ss-compare-caption"><PremiumMonthlyCaption offer={offer} withVat={!embedded} /></span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {rows.map((row) => (
                <tr key={row.labelKey} role="row">
                  <th scope="row" role="rowheader">{t(row.labelKey)}</th>
                  <td role="cell">{cell(row.free)}</td>
                  <td role="cell" className="ss-compare__herocell">{cell(row.premium)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {afterTable}

      {offer && showOfferNote && <LaunchOfferNote offer={offer} compact />}

      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)', maxWidth: '70ch' }}>
        {t('landing.compare.footnote')}
      </p>

      {/* 'Start free' is for a visitor without an account (UX audit
          shell-public-17). A signed-in free learner already started: the
          table's next step for them is Premium, as a secondary link, and a
          Premium member needs no action here at all. */}
      {showCta && isAuthenticated && !entitlement.loading && !entitlement.failed && entitlement.tier !== 'premium' && (
        <div className="ss-compare-cta">
          <Button variant="secondary" size="md" className="ss-action" as={Link} href="/premium" label={t('landing.compare.seePremium')} />
        </div>
      )}
      {showCta && !isAuthenticated && (
        <div className="ss-compare-cta">
          {entitlement.loading ? (
            <Button variant="primary" size="lg" className="ss-action" label={t('landing.compare.cta')} isDisabled isLoading />
          ) : entitlement.failed ? (
            <Button variant="primary" size="lg" className="ss-action" label={t('landing.compare.cta')} isDisabled tooltip={t('profile.plan.failed')} />
          ) : onStart ? (
            <SwimCta label={t('landing.compare.cta')} onClick={onStart} dir={1} />
          ) : (
            <Button variant="primary" size="lg" className="ss-action" as={Link} href={startHref} label={t('landing.compare.cta')} />
          )}
        </div>
      )}
    </section>
  );
}
