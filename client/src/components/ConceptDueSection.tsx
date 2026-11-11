// Concepts whose review is due, as one Today card.
//
// One card rather than one per concept: a review session is a session, and
// listing eight rows a learner cannot start individually would be a to-do list
// that does not do anything. The card says how many concepts, roughly how long,
// and which ideas — so the learner knows what they are agreeing to before they
// start it.
//
// It renders nothing while loading, for a signed-out visitor, or when nothing
// is due, so Today keeps its shape. A failed fetch also renders nothing: a
// missing review card is not worth an error banner over the plan.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../lib/auth';
import { conceptDueQuery } from '../lib/queries';
import { HELD_READ } from '../lib/routeData';
import { conceptById } from '../../../shared/concepts';

const NAMED = 3;

const ClockGlyph = ({ size = 22 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  </svg>
);
const ArrowGlyph = ({ size = 16 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export function ConceptDueSection() {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();

  const { data } = useQuery({ ...conceptDueQuery, ...HELD_READ, enabled: isAuthenticated });

  const due = data?.due ?? [];
  if (due.length === 0) return null;

  const names = due
    .map((one) => conceptById(one.conceptId))
    .filter((concept): concept is NonNullable<typeof concept> => concept !== null)
    .map((concept) => concept.label);
  if (names.length === 0) return null;

  const shown = names.slice(0, NAMED).join(', ');
  const meta = names.length > NAMED
    ? t('today.dueConceptsMore', { list: shown, n: names.length - NAMED })
    : shown;
  const actionLabel = t('today.review');

  return (
    <section className="today-section" aria-label={t('today.dueSection')}>
      <h2 className="today-section__title">{t('today.dueSection')}</h2>
      <ul className="today-list">
        <li>
          <Link
            to="/quiz?mode=review"
            className="today-card ss-panel ss-lift"
            aria-label={`${actionLabel}: ${meta}`}
          >
            <span className="today-card__glyph" aria-hidden="true" style={{ color: 'var(--brand-accent)' }}>
              <ClockGlyph size={22} />
            </span>
            <span className="today-card__body">
              <span className="today-card__meta">{meta}</span>
              {/* The reason, said plainly: it is time, not a penalty. */}
              <span className="today-card__reason">
                {t('today.dueReason', { n: names.length, minutes: data?.estimatedMinutes ?? names.length })}
              </span>
            </span>
            <span className="today-card__action" aria-hidden="true">
              <span className="today-card__action-label">{actionLabel}</span>
              <ArrowGlyph />
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

export default ConceptDueSection;
