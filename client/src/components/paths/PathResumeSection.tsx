import { useMemo } from 'react';
import { openUpgradeSheet } from '../../lib/upgradeSheet';
// Learning paths on Today: one resume item per active enrollment.
//
// One item per path, never a list of everything outstanding — the server
// already computed the single next activity, and Today's whole point is that
// it fits in a sitting. A paused path contributes nothing; its evidence is
// still there, it is just not in the queue.
//
// Deduplication against the Learn plan and the coding review queue is
// structural rather than a filter: a path activity is its own thing with its
// own id, and passing one records path evidence only — no coding progress, no
// XP, no tier unlock — so the same work can never appear twice as two
// different rewards.

import { Link } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../lib/auth';
import { anyLearningPathOpen, GAME_CONFIG_KEY, type GameConfig } from '../../lib/gameConfig';
import { isBarred, useContentLocks } from '../../lib/contentLocks';
import { activityHref, entryFor, isOpen, pathProgressQuery, useEnrollments, usePathCatalog } from '../../lib/learningPaths';
import { preloadPathPagesWithLinks } from '../../lib/learningPathWorkspace';
import { isLearningPathId, type LearningPathId } from '../../../../shared/learning-paths';
import type { PathEnrollment } from '../../../../shared/learning-path-api';

// Its links to the path pages start those pages' first reads (#587 C27).
preloadPathPagesWithLinks();

const ArrowGlyph = ({ size = 16 }: { size?: number }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

interface ResumeRow {
  enrollment: PathEnrollment;
  pathTitle: string;
  moduleId: string;
  activityId: string;
  activityTitle: string;
  locked: boolean;
}

function PathRow({ row }: { row: ResumeRow }) {
  const { t } = useLanguage();
  return (
    <li className="today-path">
      <Link className="today-card ss-panel" to={activityHref(row.enrollment.pathId as LearningPathId, row.moduleId, row.activityId)} onClick={event => { if (row.locked) { event.preventDefault(); openUpgradeSheet({ kind: 'learning-path-activity', ref: `${row.enrollment.pathId}:${row.activityId}` }); } }}>
        <span className="today-card__body">
          <span className="today-card__meta">{row.activityTitle}</span>
          <span className="today-card__reason">
            {row.pathTitle} · {t('today.pathReason')}
            {row.locked && <> · <span className="ss-premium-label">{t('premium.badge')}</span></>}
          </span>
        </span>
        <span className="today-card__action">
          <span className="ss-sr-only">{t('today.pathResume', { path: row.pathTitle })}</span><span aria-hidden="true">{t('paths.action.continue')}</span>
          <ArrowGlyph />
        </span>
      </Link>
    </li>
  );
}

/**
 * Renders nothing while progress loads, when the learner is signed out, when
 * no path is active, or when every active path is finished — so the Learn plan
 * above keeps its shape. A path that is switched off, or that the plan no
 * longer opens, offers no row either: starting its activity would be refused.
 */
export function PathResumeSection() {
  const { t } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  // While the settings the app read as it started say no path is open, no row
  // can show (a closed path offers none), so neither the 30 KB catalogue nor
  // the account's enrollments are asked for (#587 paths walk; as the Learn
  // map and Career, C06 and C20). Settings not yet in, or failed: as before.
  const settings = useQuery<GameConfig>({ queryKey: GAME_CONFIG_KEY, enabled: false });
  const closed = settings.data?.learningPaths ? !anyLearningPathOpen(settings.data) : false;
  const userId = isAuthenticated && !closed ? user?.id : undefined;
  const catalog = usePathCatalog(!closed);
  const manifests = useMemo(() => catalog.data?.paths.map(entry => entry.manifest) ?? [], [catalog.data]);
  const { lockOf } = useContentLocks(undefined, { paths: manifests });
  const enrollments = useEnrollments(userId);
  // The server leaves out a stored enrollment of a retired path (E5, #496);
  // this guard keeps one that still arrives from costing a progress request.
  const active = (enrollments.data?.enrollments ?? []).filter((one) => one.status === 'active' && isLearningPathId(one.pathId));
  const progress = useQueries({
    queries: active.map((enrollment) => ({
      ...pathProgressQuery(userId, enrollment.enrollmentId, enrollment.curriculumVersion),
      enabled: Boolean(userId),
    })),
  });

  const rows: ResumeRow[] = active.flatMap((enrollment, index) => {
    const entry = entryFor(catalog.data, enrollment.pathId);
    if (!entry || !isOpen(entry.availability)) return [];
    if (isBarred(lockOf({ kind: 'learning-path', pathId: enrollment.pathId }))) return [];
    const next = progress[index]?.data?.nextActivityId;
    if (!next) return [];
    const module = entry.manifest.modules.find((one) => one.activities.some((activity) => activity.id === next));
    const activity = module?.activities.find((one) => one.id === next);
    if (!module || !activity) return [];
    return [{
      enrollment,
      pathTitle: entry.manifest.title,
      moduleId: module.id,
      activityId: next,
      activityTitle: activity.title,
      locked: !progress[index]?.data?.modules.some(module => module.activities.some(activity => activity.activityId === next && ['verified_pass', 'self_reviewed'].includes(activity.state))) && isBarred(lockOf({ kind: 'learning-path-activity', pathId: enrollment.pathId, activityId: next })),
    }];
  });
  if (rows.length === 0) return null;

  // The heading names no path, so it holds whichever paths are published.
  return (
    <section className="today-section today-path-section" aria-label={t('today.pathSection')}>
      <h2 className="today-section__title">{t('today.pathSection')}</h2>
      <ul className="today-list">
        {rows.map((row) => (
          <PathRow key={row.enrollment.enrollmentId} row={row} />
        ))}
      </ul>
    </section>
  );
}
