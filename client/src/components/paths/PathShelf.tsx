// The paths shelf of a Learn section (#489): the learning paths that live in
// the section, one card each. Only Forward Deployed Engineer has one
// (shared/learn-sections.ts). The card is the one the Career page used to
// show, before the paths moved into their sections: the path's title and
// summary, its real inventory from the published manifest, the learner's
// enrollment state and the Premium mark. Counts come from the manifest, so
// nothing can advertise content that has not been written.
//
// The Learn page loads this file only when a section with a path is on
// screen, inside its own boundary (Roadmap.tsx).

import { Link } from 'react-router-dom';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { useT } from '../../i18n/LanguageContext';
import { learnText } from '../../i18n/translations.learn';
import { useAuth } from '../../lib/auth';
import { isBarred, useContentLocks } from '../../lib/contentLocks';
import { entryFor, isOpen, pathHref, useEnrollments, usePathCatalog } from '../../lib/learningPaths';
import { preloadPathPagesWithLinks } from '../../lib/learningPathWorkspace';
import type { PathCatalogEntry, PathEnrollment } from '../../../../shared/learning-path-api';
import type { LearningPathId } from '../../../../shared/learning-paths';
import { Kicker } from '../landing/LandingKit';
import './LearningPaths.css';

// Its links to the path pages start those pages' first reads (#587 C27).
preloadPathPagesWithLinks();

/** One path: what it is, how much of it exists, and where the learner stands. */
export function PathCard({ entry, enrollment, premium }: {
  entry: PathCatalogEntry;
  enrollment: PathEnrollment | undefined;
  /** The path is open and the plan does not open it. */
  premium: boolean;
}) {
  const t = useT();
  const { manifest, inventory, availability } = entry;
  const open = isOpen(availability);
  const cardTitle = learnText(open ? 'learn.paths.card' : 'learn.paths.cardOutline');
  const action = learnText(!open ? 'learn.paths.outline'
    : enrollment?.status === 'paused' ? 'learn.paths.resume'
      : enrollment ? 'learn.paths.continue' : 'learn.paths.open');
  return (
    <section className="lp-module">
      <div className="lp-module__head">
        <h3 className="lp-module__title">{cardTitle}</h3>
        <span className="lp-module__meta">
          {premium && <><span className="ss-premium-label">{t('premium.badge')}</span>{' '}</>}
          <Button variant="secondary" as={Link} href={pathHref(manifest.id)} label={action}
            aria-label={learnText('learn.paths.actionAria', { action, path: manifest.title })} />
        </span>
      </div>
      {!open && <p className="lp-note">{t(`paths.availability.${availability}` as never)}</p>}
      <p className="lp-lead" style={{ margin: 0 }}>
        {manifest.summary}
      </p>
      <ul className="lp-inventory">
        <li>
          <strong>{inventory.modules}</strong> {t('paths.inventory.modules')}
        </li>
        <li>
          <strong>{inventory.lessons}</strong> {t('paths.inventory.lessons')}
        </li>
        <li>
          <strong>{inventory.moduleChecks}</strong> {t('paths.inventory.checks')}
        </li>
        <li>
          <strong>{inventory.moduleCodeExercises + inventory.finalCodeExercises}</strong>{' '}
          {t('paths.inventory.exercises')}
        </li>
        <li>
          {t('paths.inventory.hours', {
            min: manifest.estimatedHours.min,
            max: manifest.estimatedHours.max,
          })}
        </li>
      </ul>
      <p className="lp-activity__summary">{manifest.entryRequirement}</p>
    </section>
  );
}

/** A section's paths, under one heading. While the catalogue loads the card's
 * place is held; when it fails, the shelf says so and asks again on a press. */
export default function PathShelf({ pathIds }: { pathIds: readonly LearningPathId[] }) {
  const t = useT();
  const { user, isAuthenticated } = useAuth();
  const catalog = usePathCatalog();
  const enrollments = useEnrollments(isAuthenticated ? user?.id : undefined);
  const { lockOf } = useContentLocks();
  const entries = pathIds.flatMap((pathId) => entryFor(catalog.data, pathId) ?? []);

  let body;
  if (catalog.isPending) {
    body = <Skeleton width="100%" height={180} radius="rounded" />;
  } else if (!catalog.data) {
    body = (
      <div className="rm-path-shelf__error" role="alert">
        <p>{t('paths.error.catalog')}</p>
        <Button variant="secondary" label={t('roadmap.retry')} onClick={() => void catalog.refetch()} />
      </div>
    );
  } else if (entries.length === 0) {
    return null;
  } else {
    body = (
      <div className="lp-modules">
        {entries.map((entry) => (
          <PathCard
            key={entry.manifest.id}
            entry={entry}
            enrollment={enrollments.data?.enrollments.find((one) => one.pathId === entry.manifest.id)}
            // Premium opens the paths: an open path the plan does not open
            // carries the Premium mark, and its page asks for Premium on Start.
            premium={isOpen(entry.availability) && isBarred(lockOf({ kind: 'learning-path', pathId: entry.manifest.id }))}
          />
        ))}
      </div>
    );
  }

  return (
    <section className="lp-section rm-path-shelf" aria-labelledby="learn-path-shelf-title">
      <Kicker as="h2" id="learn-path-shelf-title" className="rm-path-shelf__title">{learnText('learn.paths.title')}</Kicker>
      {body}
    </section>
  );
}
