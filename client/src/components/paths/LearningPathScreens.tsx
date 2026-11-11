import { FdeEvidence, FdeLoop } from './FdeHub';
// The learning-path screens of the FDE role specialization, the one
// published path since E5 (#496) retired DSA Foundations:
//
//   PathOverview   — outcomes, non-goals, the real inventory, the module
//                    outline, bridges and one concrete next action.
//   ModuleWorkspace — one module, and one activity open inside it.
//
// Both stay path-neutral. `pathId` decides which manifest is fetched and
// which route the links point at; nothing else differs.
//
// A guest sees the whole outline. Signing in is required to record graded
// work, and the screen says so rather than hiding the material behind a wall.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth';
import { useT } from '../../i18n/LanguageContext';
import { pathsEn as pathCopy } from '../../i18n/translations.paths';
import { ApiError, friendlyError } from '../../lib/api';
import { isBarred, useContentLocks } from '../../lib/contentLocks';
import { openUpgradeSheet } from '../../lib/upgradeSheet';
import { openSignIn } from '../../lib/signInDialog';
import { SwimCta } from '../landing/LandingKit';
import { useTrack } from '../../lib/tracks';
import { capturePathEvent } from '../../lib/analytics';
import { CodingCompletion } from '../../coding/CodingCompletion';
import { announceVerifiedQuestXp, syncXpWithServer } from '../../lib/xp';
import LoadingScreen from '../LoadingScreen';
import ErrorRetry from '../ErrorRetry';
import { PortfolioExport } from './PortfolioExport';
import {
  ArtifactActivity,
  CheckActivity,
  CodeActivity,
  CriteriaList,
  Feedback,
  LessonActivity,
  STATE_GLYPH,
  StateBadge,
  type DraftStatus,
} from './ActivityViews';
import {
  activityHref,
  changeEnrollment,
  entryFor,
  isOpen,
  learningPathKeys,
  moduleHref,
  newIdempotencyKey,
  pathHref,
  savePathDraft,
  startActivity,
  submitActivity,
  useEnrollments,
  usePathCatalog,
  usePathProgress,
} from '../../lib/learningPaths';
import { forgetLocalDraft, keepDraftLocally, localDraftOver, withChangedEnrollments } from '../../lib/learningPathWorkspace';
import { accountEpoch } from '../../lib/accountData';
import { loadEditor } from '../../coding/loadEditor';
import type {
  EnrollmentListResponse,
  PathCatalogEntry,
  PathDraft,
  PathProgressResponse,
  StartActivityResponse,
  SubmitActivityResponse,
} from '../../../../shared/learning-path-api';
import type { ActivitySummary, EvidenceState, LearningPathId, ModuleShelf, ModuleSummary } from '../../../../shared/learning-paths';
import './LearningPaths.css';
import { Button } from '@astryxdesign/core/Button';
import { Breadcrumb } from '../ui/Breadcrumb';

/* ── shared hooks ──────────────────────────────────────────────────────── */

// Off the loop: an optional module or one on a shelf. The server's
// isOffLoopModule decides progress; this local copy only lays the page out,
// because a value import from shared/learning-paths would add to the initial
// download (that module ships with the shell).
const offLoop = (module: ModuleSummary) => module.optional === true || module.shelf !== undefined;

// Every shelf's heading and note. A Record, so adding a shelf to
// MODULE_SHELVES fails the type check until it has copy here.
const SHELF_COPY: Record<ModuleShelf, { title: string; note: string }> = {
  'interview-prep': {
    title: pathCopy['paths.shelf.interviewPrep.title'],
    note: pathCopy['paths.shelf.interviewPrep.note'],
  },
};

function usePathState(pathId: LearningPathId) {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id;
  const catalog = usePathCatalog();
  const enrollments = useEnrollments(isAuthenticated ? userId : undefined);
  const entry = entryFor(catalog.data, pathId);
  const enrollment = enrollments.data?.enrollments.find(
    (one) => one.pathId === pathId && one.curriculumVersion === entry?.manifest.version,
  );
  const progress = usePathProgress(userId, enrollment?.enrollmentId, enrollment?.curriculumVersion);
  return { userId, isAuthenticated, catalog, entry, enrollment, enrollments, progress };
}

/** activity id → recorded state, for badges and the outline. */
function statesOf(progress: PathProgressResponse | undefined): Map<string, EvidenceState> {
  const map = new Map<string, EvidenceState>();
  for (const module of progress?.modules ?? []) {
    for (const activity of module.activities) map.set(activity.activityId, activity.state);
  }
  return map;
}

/**
 * An activity's title without the kind its row already shows (UX audit
 * learn-12). Reviewed content titles a lesson 'Read: baseline and scope', and
 * the row's kind column says 'Read' beside it; the prefix is dropped here, at
 * render time, and the content stays as reviewed.
 */
function titleWithoutKind(title: string, kindLabel: string): string {
  const prefix = `${kindLabel.toLowerCase()}:`;
  if (!title.toLowerCase().startsWith(prefix)) return title;
  const rest = title.slice(prefix.length).trimStart();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title;
}

// The module page's next row title, which describes a primary whose label cut
// the title short (UX audit learn-13). One module page shows at a time.
const NEXT_TITLE_ID = 'lp-module-next-title';

function ActivityRow({
  pathId,
  moduleId,
  activity,
  state,
  interactive,
  locked = false,
  compact = false,
  next = false,
  premiumSaid = false,
}: {
  pathId: LearningPathId;
  locked?: boolean;
  /** The module's head already says Premium for every row: the row keeps
   * the word for screen readers only. */
  premiumSaid?: boolean;
  moduleId: string;
  activity: ActivitySummary;
  state: EvidenceState;
  interactive: boolean;
  /** One 48px line (kind · title · minutes), without the summary: the hub. */
  compact?: boolean;
  /** The module's next activity, marked with the accent edge (learn-13). */
  next?: boolean;
}) {
  const t = useT();
  const kind = t(`paths.kind.${activity.kind}` as never);
  const className = ['lp-activity', 'lp-activity--row', compact ? 'lp-activity--compact' : '', next ? 'lp-activity--next' : ''].filter(Boolean).join(' ');
  const body = (
    <>
      <span className="lp-activity__kind">{kind}</span>
      <span className="lp-activity__title" id={next ? NEXT_TITLE_ID : undefined}>{titleWithoutKind(activity.title, kind)}</span>
      {next && <span className="lp-activity__next">{pathCopy['paths.activity.next']} <span aria-hidden="true">→</span></span>}
      <span className="lp-activity__minutes">{t('paths.minutes', { minutes: activity.estimatedMinutes })}</span>
      {/* 'Not started' is every row's default and goes unsaid; any other
          state is a glyph beside the minutes, its words read aloud. */}
      {state !== 'not_started' && (
        <span className={`lp-activity__state lp-activity__state--${state}`}>
          <span aria-hidden="true">{STATE_GLYPH[state]}</span>
          <span className="ss-sr-only">{t(`paths.state.${state}` as never)}</span>
        </span>
      )}
      {locked && <span className={premiumSaid ? 'ss-sr-only' : 'ss-premium-label'}>{t('premium.badge')}</span>}
      {!compact && <p className="lp-activity__summary">{activity.summary}</p>}
    </>
  );
  if (!interactive) return <li className={className}>{body}</li>;
  return (
    <li>
      <Link className={className} to={activityHref(pathId, moduleId, activity.id)} onClick={event => { if (locked) { event.preventDefault(); openUpgradeSheet({ kind: 'learning-path-activity', ref: `${pathId}:${activity.id}` }); } }}>
        {body}
      </Link>
    </li>
  );
}

function ModuleCard({
  pathId,
  module,
  index,
  states,
  completed,
  interactive,
  activityLock,
}: {
  pathId: LearningPathId;
  module: ModuleSummary;
  index: number;
  states: Map<string, EvidenceState>;
  completed: boolean;
  interactive: boolean;
  activityLock: (activityId: string, state: EvidenceState) => boolean;
}) {
  const t = useT();
  // A module whose every activity Premium opens says Premium once, in its
  // head, instead of on each row (as the Learn map does, UX audit learn-22).
  const lockedRows = module.activities.map((activity) => activityLock(activity.id, states.get(activity.id) ?? 'not_started'));
  const allLocked = lockedRows.length > 0 && lockedRows.every(Boolean);
  const className = [
    'lp-module',
    completed ? 'lp-module--done' : '',
    offLoop(module) ? 'lp-module--optional' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section className={className}>
      <div className="lp-module__head">
        <h2 className="lp-module__title">
          <span className="lp-module__index">
            {offLoop(module) ? t('paths.module.optional') : t('paths.module.index', { index })}
          </span>
          {interactive ? <Link to={moduleHref(pathId, module.id)}>{module.title}</Link> : module.title}
        </h2>
        <span className="lp-module__meta">
          {(module.shelf || allLocked) && <><span className="ss-premium-label">{t('premium.badge')}</span>{' '}</>}
          {t('paths.minutes', { minutes: module.estimatedMinutes })}
          {completed ? ` · ${t('paths.module.complete')}` : ''}
        </span>
      </div>
      <ul className="lp-module__outcomes">
        {module.outcomes.map((outcome, position) => (
          <li key={position}>{outcome}</li>
        ))}
      </ul>
      <ul className="lp-activities">
        {module.activities.map((activity, position) => (
          <ActivityRow
            key={activity.id}
            pathId={pathId}
            moduleId={module.id}
            activity={activity}
            locked={lockedRows[position]}
            premiumSaid={allLocked}
            state={states.get(activity.id) ?? 'not_started'}
            interactive={interactive}
            compact
          />
        ))}
      </ul>
    </section>
  );
}

/* ── overview ──────────────────────────────────────────────────────────── */

export function PathOverview({ pathId }: { pathId: LearningPathId }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId, isAuthenticated, catalog, entry, enrollment, enrollments, progress } = usePathState(pathId);
  const [track] = useTrack();
  const pathManifests = useMemo(() => entry ? [entry.manifest] : [], [entry]);
  const { lockOf } = useContentLocks(undefined, { paths: pathManifests });
  const activityLock = useCallback((activityId: string, state: EvidenceState) =>
    state !== 'verified_pass' && state !== 'self_reviewed' && isBarred(lockOf({ kind: 'learning-path-activity', pathId, activityId })), [lockOf, pathId]);
  const [enrolling, setEnrolling] = useState(false);
  // Set before the first await, so a second click on Start or Pause before the
  // button re-renders as disabled sends nothing.
  const enrollingNow = useRef(false);
  const [enrollError, setEnrollError] = useState<string | null>(null);
  // Premium opens the paths. Starting or resuming one the plan does not open
  // asks for Premium instead, and the button carries the Premium mark.
  const barred = isBarred(lockOf({ kind: 'learning-path', pathId }));
  const askForPremium = useCallback(() => openUpgradeSheet({ kind: 'learning-path', ref: pathId }), [pathId]);

  const states = useMemo(() => statesOf(progress.data), [progress.data]);
  const completedModules = useMemo(
    () => new Set((progress.data?.modules ?? []).filter((one) => one.completed).map((one) => one.moduleId)),
    [progress.data],
  );

  const enrol = useCallback(
    async (action: 'enroll' | 'pause' | 'resume') => {
      if (!entry || enrollingNow.current) return;
      enrollingNow.current = true;
      setEnrolling(true);
      setEnrollError(null);
      try {
        const changed = await changeEnrollment({
          pathId,
          curriculumVersion: entry.manifest.version,
          action,
          // A role specialization records the base track it sits above.
          ...(entry.manifest.kind === 'role_specialization' ? { baseTrack: track } : {}),
        });
        if (action === 'enroll') {
          capturePathEvent('learning_path_enrolled', { pathId, curriculumVersion: entry.manifest.version });
        }
        const key = learningPathKeys.enrollments(userId);
        queryClient.setQueryData<EnrollmentListResponse>(key, (list) => withChangedEnrollments(list, changed));
        void queryClient.invalidateQueries({ queryKey: key });
      } catch (error) {
        setEnrollError(friendlyError(error));
      } finally {
        enrollingNow.current = false;
        setEnrolling(false);
      }
    },
    [entry, pathId, queryClient, userId, track],
  );

  if (catalog.isLoading) return <LoadingScreen label={t('paths.loading')} />;
  if (catalog.isError || !entry) {
    return (
      <div className="lp-page">
        <ErrorRetry message={t('paths.error.catalog')} onRetry={() => catalog.refetch()} />
      </div>
    );
  }

  const { manifest, inventory, availability } = entry;
  const open = isOpen(availability);
  const next = progress.data?.nextActivityId ?? null;
  const nextModule = next ? manifest.modules.find((one) => one.activities.some((a) => a.id === next)) : undefined;
  const nextBarred = next ? activityLock(next, states.get(next) ?? 'not_started') : false;
  const requiredModules = manifest.modules.filter((one) => !offLoop(one));
  // Shelf modules list under their own heading, so the optional section's
  // note about placement and bridges never describes interview practice.
  const optionalModules = manifest.modules.filter((one) => one.optional && one.shelf === undefined);
  const shelves = (Object.keys(SHELF_COPY) as ModuleShelf[])
    .map((shelf) => ({ shelf, modules: manifest.modules.filter((one) => one.shelf === shelf) }))
    .filter((one) => one.modules.length > 0);
  // Activities link only while the path is open to this learner; a closed
  // path, a lapsed plan or a paused enrollment (the server refuses its
  // activities with enrollment_paused until Resume) keeps its outline and
  // evidence without dead ends.
  const reachable = Boolean(enrollment) && enrollment?.status !== 'paused' && open && !barred;
  const premiumMark = <span className="ss-premium-label">{t('premium.badge')}</span>;
  const hubState = {
    manifest,
    progress: progress.data,
    pending: Boolean((isAuthenticated && enrollments.isPending) || (enrollment && progress.isPending)),
    error: Boolean(enrollments.error || progress.error),
  };
  const diagnosticModule = manifest.diagnosticActivityId
    ? manifest.modules.find(module => module.activities.some(activity => activity.id === manifest.diagnosticActivityId))
    : undefined;

  // The one action row under the hero (UX audit learn-10): at most one filled
  // primary (SwimCta md) and a ghost Pause, left-aligned in every state. A
  // guest is offered Sign in only while the path is open; a closed path's
  // notice already says the outline stays readable.
  const actions = [
    !isAuthenticated && open && (
      <SwimCta key="sign-in" label={pathCopy['paths.action.signIn']} onClick={() => openSignIn({ returnTo: pathHref(pathId) })} />
    ),
    open && (barred || nextBarred) && <span key="premium">{premiumMark}</span>,
    // Only once the account's enrollments are known: while they load (or
    // after they failed) an enrolled learner would be offered Start.
    isAuthenticated && enrollments.data && !enrollment && open && (
      <SwimCta key="start" onClick={() => (barred ? askForPremium() : void enrol('enroll'))} disabled={enrolling} label={enrolling ? t('paths.action.starting') : t('paths.action.start')} />
    ),
    isAuthenticated && enrollment?.status === 'paused' && open && (
      <SwimCta key="resume" onClick={() => (barred ? askForPremium() : void enrol('resume'))} disabled={enrolling} label={t('paths.action.resume')} />
    ),
    enrollment?.status === 'active' && open && next && nextModule && (
      <SwimCta key="continue" onClick={() => (nextBarred ? openUpgradeSheet({ kind: 'learning-path-activity', ref: `${pathId}:${next}` }) : navigate(activityHref(pathId, nextModule.id, next)))} label={t('paths.action.continue')} />
    ),
    enrollment?.status === 'active' && (
      <Button key="pause" variant="ghost" onClick={() => enrol('pause')} isDisabled={enrolling} label={t('paths.action.pause')} />
    ),
  ].filter(Boolean);
  // While a signed-in learner's enrollments load, the row keeps its 44px, so
  // the page below does not move down when Start, Resume or Continue arrives.
  const actionsPending = isAuthenticated && open && enrollments.isPending;

  return (
    <div className="lp-page">
      <Breadcrumb items={[{ label: t('roadmap.title'), href: '/learn' }, { label: entry.manifest.title }]} />
      <header className="lp-head">
        <div className="lp-head__text">
          <p className="lp-kicker">
            {t('paths.kicker.role')}
          </p>
          <h1>{manifest.title}</h1>
          <p className="lp-lead">{manifest.summary}</p>
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
            {inventory.artifacts > 0 && (
              <li>
                <strong>{inventory.artifacts}</strong> {t('paths.inventory.artifacts')}
              </li>
            )}
            <li>
              {t('paths.inventory.hours', { min: manifest.estimatedHours.min, max: manifest.estimatedHours.max })}
            </li>
          </ul>
        </div>
        {(actions.length > 0 || actionsPending) && (
          <div className="lp-head__actions" aria-busy={actions.length === 0 || undefined}>{actions}</div>
        )}
      </header>

      {enrollError && (
        <div className="lp-notice lp-notice--error" role="alert">
          <span className="lp-notice__glyph" aria-hidden="true">
            !
          </span>
          <span>{enrollError}</span>
        </div>
      )}
      {!open && (
        <div className="lp-notice lp-notice--warning">
          <span className="lp-notice__glyph" aria-hidden="true">
            ◐
          </span>
          <span>{t(`paths.availability.${availability}` as never)}</span>
        </div>
      )}
      {enrollment?.status === 'paused' && (
        <div className="lp-notice">
          <span className="lp-notice__glyph" aria-hidden="true">
            ⏸
          </span>
          <span>{t('paths.paused')}</span>
        </div>
      )}

      <section className="lp-card lp-section">
        <h2>{t('paths.outcomes')}</h2>
        <ul className="lp-list">
          {manifest.outcomes.map((outcome, index) => (
            <li key={index}>{outcome}</li>
          ))}
        </ul>
        <h2>{t('paths.nonGoals')}</h2>
        <ul className="lp-list">
          {manifest.nonGoals.map((entryText, index) => (
            <li key={index}>{entryText}</li>
          ))}
        </ul>
        <h2>{t('paths.entryRequirement')}</h2>
        <p className="lp-lead">{manifest.entryRequirement}</p>
      </section>

      {pathId === 'fde' && <FdeLoop {...hubState} retry={() => { void enrollments.refetch(); if (enrollment) void progress.refetch(); }} />}

      {progress.data && (
        <section className="lp-card lp-completion">
          <h2>{t('paths.progressTitle')}</h2>
          {/* 'Guided path' and its state (UX audit learn-14): the content's
              completion label ('… guided path completed') read as a claim
              beside an 'In progress' badge. */}
          <div className="lp-completion__line">
            <span className="lp-completion__label">{pathCopy['paths.guidedPath']}</span>
            {progress.data.guidedComplete ? (
              <span className="lp-state lp-state--verified_pass">
                <span className="lp-state__glyph" aria-hidden="true">✓</span>
                {pathCopy['paths.guidedPath.completed']}
              </span>
            ) : (
              <StateBadge state="in_progress" />
            )}
          </div>
          {inventory.artifacts > 0 && (
            <>
              <div className="lp-completion__line">
                <span className="lp-completion__label">{t('paths.portfolioSelfReviewed')}</span>
                <span className="lp-module__meta">
                  {t('paths.portfolioCount', {
                    submitted: progress.data.artifacts.submitted,
                    total: progress.data.artifacts.total,
                  })}
                </span>
              </div>
              {/* The modules require these pieces, so completion waits for
                  them; say so rather than implying they sit apart from it. */}
              <p className="lp-completion__note">{t('paths.portfolioRequired', { total: progress.data.artifacts.total })}</p>
              {enrollment && <PortfolioExport key={`${userId}:${enrollment.enrollmentId}`} manifest={manifest} enrollmentId={enrollment.enrollmentId} states={states} />}
            </>
          )}
        </section>
      )}

      {progress.data && diagnosticModule && progress.data.competencies.length > 0 && (
        <section className="lp-card lp-section" aria-labelledby="path-diagnostic-title">
          <h2 id="path-diagnostic-title">{pathCopy['paths.diagnosticTitle']}</h2>
          <p className="lp-lead">{pathCopy['paths.diagnosticNote']}</p>
          <ul className="lp-list">
            {progress.data.competencies.map(result => {
              const competency = manifest.competencies.find(one => one.id === result.competencyId);
              if (!competency) return null;
              return (
                <li key={result.competencyId}>
                  <strong>{competency.title}</strong>{' — '}
                  {pathCopy[`paths.competency.${result.state}`]}
                  {result.score !== null && result.assessedItems > 0 && (
                    <> · {pathCopy['paths.diagnosticItems'].replace('{percent}', String(Math.round(result.score * 100))).replace('{count}', String(result.assessedItems))}</>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="lp-note">{pathCopy['paths.diagnosticRetakeNote']}</p>
          {reachable && manifest.diagnosticActivityId && (
            <Link to={activityHref(pathId, diagnosticModule.id, manifest.diagnosticActivityId)}>
              {pathCopy['paths.openDiagnostic']}
            </Link>
          )}
        </section>
      )}

      {progress.data && progress.data.recommendedBridges.length > 0 && (
        <section className="lp-card lp-section">
          <h2>{t('paths.bridgesTitle')}</h2>
          <p className="lp-lead">{t('paths.bridgesNote')}</p>
          {progress.data.recommendedBridges.map((bridgeId) => {
            const bridge = manifest.bridges.find((one) => one.id === bridgeId);
            if (!bridge) return null;
            return (
              <div key={bridge.id} className="lp-section">
                <h3>{bridge.title}</h3>
                <p className="lp-lead">{bridge.summary}</p>
                <ul className="lp-list">
                  {bridge.references.map((reference, index) => (
                    <li key={index}>
                      {reference.kind === 'doc' ? (
                        <a href={reference.ref} target="_blank" rel="noreferrer noopener">
                          {reference.label}
                        </a>
                      ) : reference.kind === 'roadmap-topic' ? (
                        <Link to={`/learn?topic=${encodeURIComponent(reference.ref)}`}>{reference.label}</Link>
                      ) : reference.kind === 'coding-task' ? (
                        <Link to={`/coding/javascript/${encodeURIComponent(reference.ref)}`}>{reference.label}</Link>
                      ) : (
                        reference.label
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      )}

      <section className="lp-section">
        <h2>{t('paths.outline')}</h2>
        {/* What the four kinds of activity are for, said once above the
            modules rather than at each one (UX audit learn-10 moved it out of
            the hero). The last sentence is the one that matters: coming back
            to earlier material is the plan working, not the plan slipping. */}
        <p className="lp-note">{pathCopy['paths.activityKinds']}</p>
        <div className="lp-modules">
          {requiredModules.map((module, index) => (
            <ModuleCard
              key={module.id}
              pathId={pathId}
              module={module}
              index={index + 1}
              states={states}
              completed={completedModules.has(module.id)}
              activityLock={activityLock}
              interactive={reachable}
            />
          ))}
        </div>
      </section>

      {/* Competency evidence sums up the modules, so it follows them, closed
          (UX audit learn-11). */}
      {pathId === 'fde' && <FdeEvidence {...hubState} reachable={reachable} activityLock={activityLock} />}

      {/* The loop, then the shelves, then placement and bridges. */}
      {shelves.map(({ shelf, modules }) => (
        <section key={shelf} className="lp-section" aria-labelledby={`path-shelf-${shelf}`}>
          <h2 id={`path-shelf-${shelf}`}>{SHELF_COPY[shelf].title}</h2>
          <p className="lp-lead">{SHELF_COPY[shelf].note}</p>
          <div className="lp-modules">
            {modules.map((module) => (
              <ModuleCard
                key={module.id}
                pathId={pathId}
                module={module}
                index={0}
                states={states}
                completed={false}
                activityLock={activityLock}
              interactive={reachable}
              />
            ))}
          </div>
        </section>
      ))}

      {optionalModules.length > 0 && (
        <section className="lp-section">
          <h2>{pathCopy['paths.optionalTitle']}</h2>
          <p className="lp-lead">{pathCopy['paths.optionalNote']}</p>
          <div className="lp-modules">
            {optionalModules.map((module) => (
              <ModuleCard
                key={module.id}
                pathId={pathId}
                module={module}
                index={0}
                states={states}
                completed={false}
                activityLock={activityLock}
              interactive={reachable}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── workspace ─────────────────────────────────────────────────────────── */

/** An opened attempt: its sealed session, when that expires, the idempotency
 * key its submission carries, and whether it has taken its one result. */
interface Attempt {
  session: string;
  expiresAt: string;
  key: string;
  usedUp: boolean;
}

/** One opened activity's autosave. Saves go one at a time; `revision` is the
 * one the server returned last, so a keystroke during a save never sends a
 * revision the server has already moved past; `queued` is the newest content
 * not sent yet. A save that lands after the learner moved on changes nothing
 * on screen, because the next activity has a channel of its own. `epoch` is
 * the account it was opened under (lib/accountData.ts accountEpoch): once that
 * account's data is forgotten or kept, the channel writes and sends nothing,
 * so a save that lands after a sign-out puts no draft back into the browser. */
interface DraftChannel {
  enrollmentId: string;
  activityId: string;
  revision: number;
  sending: PathDraft['content'] | null;
  lastSaved: PathDraft | null;
  conflict: boolean;
  queued: PathDraft['content'] | null;
  epoch: number;
}

const channelGone = (channel: DraftChannel) => channel.epoch !== accountEpoch();
const draftChannelKey = (enrollmentId: string, activityId: string) => `${enrollmentId}:${activityId}`;

/** Refusals that mean the attempt cannot take this submission. */
const ATTEMPT_USED_UP = new Set(['idempotency_conflict', 'session_expired', 'attempt_expired']);

export function ModuleWorkspace({ pathId }: { pathId: LearningPathId }) {
  const t = useT();
  const { moduleId = '' } = useParams();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const { userId, isAuthenticated, catalog, entry, enrollment, enrollments, progress } = usePathState(pathId);
  const pathManifests = useMemo(() => entry ? [entry.manifest] : [], [entry]);
  const { lockOf } = useContentLocks(undefined, { paths: pathManifests });
  const activityLock = useCallback((activityId: string, state: EvidenceState) =>
    state !== 'verified_pass' && state !== 'self_reviewed' && isBarred(lockOf({ kind: 'learning-path-activity', pathId, activityId })), [lockOf, pathId]);

  const activityId = search.get('activity');
  // A paused enrollment opens no activity: the server would refuse it with
  // enrollment_paused. The page says it is paused and leads to Resume.
  const paused = enrollment?.status === 'paused';
  const enrollmentId = paused ? undefined : enrollment?.enrollmentId;
  const curriculumVersion = enrollment?.curriculumVersion;
  const [open, setOpen] = useState<StartActivityResponse | null>(null);
  const [result, setResult] = useState<SubmitActivityResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>('idle');
  const [draft, setDraft] = useState<PathDraft | null>(null);
  // Bumped to start the open activity again: a check's "Try again" deals its
  // questions afresh, with a new order and a new sealed key.
  const [deal, setDeal] = useState(0);
  // The attempt the next submission goes to. The server accepts one result per
  // attempt, so once it has one (or has expired, or refused the key) the next
  // submission opens a fresh attempt with a key of its own. Until then a retry
  // after a network failure reuses the key, and the server replays its stored
  // result instead of grading twice.
  const attempt = useRef<Attempt | null>(null);
  // The submission or brief refresh running for the open activity, one at a
  // time. Opening another activity drops it, so an answer that lands late
  // changes nothing on the new activity's screen.
  const working = useRef<object | null>(null);
  const [attemptUsedUp, setAttemptUsedUp] = useState(false);
  const [briefChanged, setBriefChanged] = useState(false);
  // The autosave for the open activity: one save in flight at a time, the
  // revision the next one expects, and the newest content waiting behind it.
  const drafts = useRef<DraftChannel | null>(null);
  // The channel of the activity just left. Its view sends what its debounce
  // still holds as it unmounts, after this screen has moved on: that save
  // goes to the activity it was typed in, never to the next one.
  const leftDrafts = useRef<DraftChannel | null>(null);
  // A save can outlive a visit to its activity. Reopening the activity while
  // it is still saving uses that same channel and its next revision.
  const savingDrafts = useRef(new Map<string, DraftChannel>());

  const module = entry?.manifest.modules.find((one) => one.id === moduleId);
  const activity = module?.activities.find((one) => one.id === activityId);
  // A code exercise's editor loads beside its start, as soon as the catalogue
  // says what the activity is, rather than after the start answered (#587
  // paths walk): the start then no longer leads a second wait for CodeMirror.
  const opensCode = activity?.kind === 'code';
  useEffect(() => { if (opensCode) void loadEditor().catch(() => undefined); }, [opensCode]);

  useEffect(() => {
    let cancelled = false;
    // The previous activity's view goes first, so nothing it holds (an
    // editor's source, a form's fields, a check's answers) carries into the
    // next activity or is autosaved as its draft.
    setOpen(null);
    setBriefChanged(false);
    setResult(null);
    setAttemptUsedUp(false);
    setError(null);
    attempt.current = null;
    working.current = null;
    if (drafts.current) leftDrafts.current = drafts.current;
    drafts.current = null;
    setBusy(Boolean(activityId && enrollmentId));
    if (!activityId || !enrollmentId) return;
    // Leaving the activity (or the page) stops the request, so switching
    // quickly through several activities leaves no answers in flight.
    const controller = new AbortController();
    const key = draftChannelKey(enrollmentId, activityId);
    const saveAtOpen = savingDrafts.current.get(key);
    startActivity({ enrollmentId, activityId }, controller.signal)
      .then((started) => {
        if (cancelled) return;
        const saving = savingDrafts.current.get(key);
        const pending = saving && !channelGone(saving) ? saving.queued ?? saving.sending : null;
        if (saving && pending) {
          drafts.current = saving;
          setDraft({ activityId, revision: saving.revision, content: pending, updatedAt: new Date().toISOString() });
          setDraftStatus('saving');
        } else {
          // The start response may have read the draft before the pending
          // write committed. Its confirmed result can be newer than that read.
          const confirmed = saveAtOpen && !channelGone(saveAtOpen) ? saveAtOpen.lastSaved : null;
          const serverDraft = confirmed && confirmed.revision > (started.draft?.revision ?? 0) ? confirmed : started.draft;
          const serverUnknown = !serverDraft && started.draftUnavailable === true;
          const kept = localDraftOver(enrollmentId, activityId, serverDraft, serverUnknown);
          const conflict = !!(kept && serverDraft && kept.revision !== serverDraft.revision);
          drafts.current = {
            enrollmentId,
            activityId,
            revision: kept?.revision ?? serverDraft?.revision ?? 0,
            sending: null,
            lastSaved: null,
            conflict,
            queued: kept?.content ?? null,
            epoch: accountEpoch(),
          };
          setDraft(kept ?? serverDraft);
          setDraftStatus(conflict ? 'conflict' : serverDraft ? 'saved' : 'idle');
        }
        attempt.current = { session: started.session, expiresAt: started.expiresAt, key: newIdempotencyKey(), usedUp: false };
        setOpen(started);
        capturePathEvent(
          started.previous && started.previous.attempts > 0
            ? 'learning_path_returned'
            : 'learning_path_activity_started',
          {
            pathId,
            curriculumVersion: curriculumVersion ?? 0,
            activityId: started.activity.id,
            activityKind: started.activity.kind,
          },
        );
      })
      .catch((caught) => {
        if (!cancelled) setError(friendlyError(caught));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activityId, enrollmentId, curriculumVersion, deal, pathId]);

  const pushDraft = useCallback(async (channel: DraftChannel | null) => {
    if (!channel || channel.sending || channel.conflict || !channel.queued || channelGone(channel)) return;
    const live = () => drafts.current === channel;
    const key = draftChannelKey(channel.enrollmentId, channel.activityId);
    savingDrafts.current.set(key, channel);
    try {
      while (channel.queued) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          // Offline keeps the copy on this device and says so; reconnecting
          // sends it. It never overwrites a newer server revision: that save
          // would conflict first.
          if (live()) setDraftStatus('offline');
          return;
        }
        const content = channel.queued;
        channel.sending = content;
        channel.queued = null;
        if (live()) setDraftStatus('saving');
        try {
          const saved = await savePathDraft({
            enrollmentId: channel.enrollmentId,
            activityId: channel.activityId,
            expectedRevision: channel.revision,
            content,
          });
          if (channelGone(channel)) return;
          channel.revision = saved.draft.revision;
          channel.lastSaved = saved.draft;
          if (channel.queued) keepDraftLocally(channel.enrollmentId, channel.activityId, channel.revision, channel.queued);
          else forgetLocalDraft(channel.enrollmentId, channel.activityId);
          if (live()) {
            setDraft(saved.draft);
            if (!channel.queued) setDraftStatus('saved');
          }
        } catch (caught) {
          if (channelGone(channel)) return;
          // The newest unsaved content waits for the next keystroke or the
          // connection coming back.
          channel.queued ??= content;
          channel.conflict = caught instanceof ApiError && caught.code === 'draft_conflict';
          if (live()) setDraftStatus(channel.conflict ? 'conflict' : 'error');
          return;
        }
      }
    } finally {
      channel.sending = null;
      if (savingDrafts.current.get(key) === channel) savingDrafts.current.delete(key);
    }
  }, []);

  const saveDraft = useCallback(
    (forActivity: string, content: PathDraft['content']) => {
      const channel = [drafts.current, leftDrafts.current].find((one) => one?.activityId === forActivity);
      if (!channel || channelGone(channel)) return;
      channel.queued = content;
      keepDraftLocally(channel.enrollmentId, channel.activityId, channel.revision, content);
      void pushDraft(channel);
    },
    [pushDraft],
  );

  // A copy kept on this device from an earlier visit goes out as soon as the
  // activity opens, and anything waiting goes out when the connection is back.
  useEffect(() => {
    if (open) void pushDraft(drafts.current);
  }, [open, pushDraft]);
  useEffect(() => {
    const resend = () => {
      void pushDraft(drafts.current);
      void pushDraft(leftDrafts.current);
    };
    window.addEventListener('online', resend);
    return () => window.removeEventListener('online', resend);
  }, [pushDraft]);

  // Starts the open activity again. A check is dealt afresh; anything else
  // keeps what the learner wrote, and the next Submit opens a new attempt.
  const retry = useCallback(() => {
    if (open?.check) {
      setDeal((count) => count + 1);
      return;
    }
    setResult(null);
    setError(null);
  }, [open]);

  const refreshBrief = async () => {
    if (!open || !enrollment || !attempt.current || working.current) return;
    const token = {};
    working.current = token;
    const live = () => working.current === token;
    setBusy(true);
    try {
      const fresh = await startActivity({ enrollmentId: enrollment.enrollmentId, activityId: open.activity.id });
      if (!live()) return;
      attempt.current = { session: fresh.session, expiresAt: fresh.expiresAt, key: newIdempotencyKey(), usedUp: false };
      setOpen(fresh);
      setBriefChanged(false);
      setError(null);
      setResult(null);
    } catch (caught) {
      if (live()) setError(friendlyError(caught));
    } finally {
      if (live()) {
        working.current = null;
        setBusy(false);
      }
    }
  };

  const submit = useCallback(
    async (payload: Record<string, unknown>) => {
      const current = attempt.current;
      // One submission at a time: a second click before the first re-render
      // would otherwise open a second attempt or grade the work twice.
      if (!open || !enrollment || !current || briefChanged || working.current) return;
      const expired = Date.parse(current.expiresAt) <= Date.now();
      // A check's answers index its own attempt's order, so a check whose
      // attempt is used up is dealt again rather than resubmitted. An expired
      // one says so and offers Try again: dealing it afresh at once would
      // clear the learner's answers without a word.
      if (open.check && expired && !current.usedUp) {
        current.usedUp = true;
        setAttemptUsedUp(true);
        setError(t('error.pathAttemptExpired'));
        return;
      }
      if (open.check && current.usedUp) {
        retry();
        return;
      }
      const token = {};
      const epoch = accountEpoch();
      working.current = token;
      // False once the learner opened another activity (or dealt this check
      // again): this submission's answer then belongs to a screen that is gone.
      const live = () => working.current === token;
      setBusy(true);
      setError(null);
      let target = current;
      try {
        if (current.usedUp || expired) {
          const fresh = await startActivity({ enrollmentId: enrollment.enrollmentId, activityId: open.activity.id, previousSession: current.session });
          if (!live() || accountEpoch() !== epoch) return;
          target = { session: fresh.session, expiresAt: fresh.expiresAt, key: newIdempotencyKey(), usedUp: false };
          attempt.current = target;
          if (fresh.needsBriefReview) {
            setOpen(fresh);
            setBriefChanged(true);
            setError(t('coding.verdict.taskChanged'));
            return;
          }
        }
        const graded = await submitActivity({
          session: target.session,
          idempotencyKey: target.key,
          ...payload,
        });
        target.usedUp = true;
        if (accountEpoch() !== epoch) return;
        // The result also counts if this learner has moved to another activity.
        // A replay can confirm a reward whose first response was lost.
        if (graded.xpAwarded > 0) {
          if (!graded.replayed) announceVerifiedQuestXp(graded.xpAwarded);
          void syncXpWithServer({ announceRankUp: !graded.replayed });
        }
        if (graded.state === 'verified_pass') {
          capturePathEvent('learning_path_activity_verified', {
            pathId,
            curriculumVersion: enrollment.curriculumVersion,
            activityId: graded.activityId,
            state: graded.state,
          });
        }
        // In the background: the verdict is on screen now, and the controls
        // need not wait a further round trip for the outline's badges.
        void queryClient.invalidateQueries({
          queryKey: learningPathKeys.progress(userId, enrollment.enrollmentId, enrollment.curriculumVersion),
        });
        if (!live()) return;
        setAttemptUsedUp(false);
        setResult(graded);
      } catch (caught) {
        // A late refusal belongs to the activity it was sent for, not to the
        // one on screen now, whose attempt is untouched.
        if (!live() || accountEpoch() !== epoch) return;
        // An attempt that expired or already holds a result cannot take this
        // submission; the next one goes to a new attempt.
        if (caught instanceof ApiError && caught.code && ATTEMPT_USED_UP.has(caught.code)) {
          target.usedUp = true;
          setAttemptUsedUp(true);
        }
        if (caught instanceof ApiError && caught.code === 'task_changed') setBriefChanged(true);
        setError(friendlyError(caught));
      } finally {
        if (live()) {
          working.current = null;
          setBusy(false);
        }
      }
    },
    [open, enrollment, retry, queryClient, userId, pathId, briefChanged, t],
  );

  // Focus follows what changed. The workspace opens below the activity list,
  // and the control the learner used often disappears (a check's Submit, the
  // Close button), so without this a keyboard or screen-reader user is left
  // on a link far above the change, or on nothing. Opening another activity
  // moves focus to its heading, closing it to the list, and a verdict to the
  // result; a passed code exercise's banner takes focus itself.
  const activityHeading = useRef<HTMLHeadingElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const focusedActivity = useRef(activityId);
  useEffect(() => {
    if (focusedActivity.current === activityId) return;
    focusedActivity.current = activityId;
    (activityId ? activityHeading.current : listHeading.current)?.focus();
  }, [activityId]);
  const codePassed = Boolean(open?.code && result?.state === 'verified_pass' && result.code?.outcome === 'passed');
  useEffect(() => {
    if (result && !codePassed) resultHeading.current?.focus();
  }, [result, codePassed]);

  if (catalog.isLoading) return <LoadingScreen label={t('paths.loading')} />;
  if (catalog.isError || !entry || !module) {
    return (
      <div className="lp-page">
        <ErrorRetry message={t('paths.error.module')} onRetry={() => catalog.refetch()} />
      </div>
    );
  }

  const states = statesOf(progress.data);
  const moduleProgress = progress.data?.modules.find((one) => one.moduleId === module.id);
  // A path that is switched off, that the plan no longer opens or that is
  // paused lists its activities without links: starting one would be refused.
  const reachable = Boolean(enrollment) && !paused && isOpen(entry.availability) && !isBarred(lockOf({ kind: 'learning-path', pathId }));
  // Only the dimensions this artifact is judged against, so the learner reads
  // the criteria that apply rather than the whole rubric.
  const rubric = entry.manifest.rubric.dimensions
    .filter((dimension) => open?.activity.rubricDimensions?.includes(dimension.id))
    .map((dimension) => ({
      id: dimension.id,
      title: dimension.title,
      levels: dimension.levels as unknown as Record<string, string>,
    }));
  const shown = activity ?? open?.activity;
  // The module's one primary (UX audit learn-13): the first activity that is
  // neither passed nor self-reviewed, 'Start module' while nothing is recorded
  // and 'Continue: <title>' after. It shows while the list is the screen; an
  // open activity carries its own primary.
  // It waits for the recorded progress: before it arrives, a learner part-way
  // through would read 'Start module' aimed at the first row. Until then the
  // row keeps its 44px, so the list does not move when the primary arrives.
  const started = Boolean(moduleProgress?.activities.some((one) => one.state !== 'not_started'));
  const target = reachable && progress.data
    ? module.activities.find((one) => {
        const state = states.get(one.id) ?? 'not_started';
        return state !== 'verified_pass' && state !== 'self_reviewed';
      })
    : undefined;
  const targetLocked = target ? activityLock(target.id, states.get(target.id) ?? 'not_started') : false;
  const targetTitle = target ? titleWithoutKind(target.title, t(`paths.kind.${target.kind}` as never)) : '';
  const targetCut = targetTitle.length > 32;
  const ctaLabel = started
    ? pathCopy['paths.action.continueTo'].replace('{title}', targetCut ? `${targetTitle.slice(0, 31).trimEnd()}…` : targetTitle)
    : pathCopy['paths.action.startModule'];
  const ctaPending = !target && isAuthenticated && !enrollments.error && !progress.error
    && (enrollments.isPending || (reachable && !progress.data));

  const resultContent = result && !codePassed && (
<section className={open?.code ? 'lp-section' : 'lp-card lp-section'}>
              <div className="lp-completion__line">
                <h2 ref={resultHeading} tabIndex={-1}>{t('paths.result')}</h2>
                <StateBadge state={result.state} />
                {result.score !== null && (
                  <span className="lp-module__meta">
                    {t('paths.score', { percent: Math.round(result.score * 100) })}
                  </span>
                )}
              </div>
              {result.replayed && <p className="lp-completion__note">{t('paths.replayed')}</p>}
              {result.domainScores && (
                <ul className="lp-list lp-list--plain">
                  {Object.entries(result.domainScores).map(([domain, share]) => (
                    <li key={domain}>
                      {t(`paths.domain.${domain}` as never)}: {Math.round(share * 100)}%
                      {result.failedDomains?.includes(domain) ? ` — ${t('paths.domainBelow')}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <CriteriaList criteria={result.criteria} />
              <Feedback feedback={result.feedback} />
              {/* When the next thing worth doing is this activity again, the way
                  on is another attempt, not a link back to where the learner
                  already is. A check offers its own "Try again" above. */}
              {result.nextActivityId && result.nextActivityId !== open?.activity.id && (
                <div className="lp-actions lp-actions--end">
                  <Button variant="primary" onClick={() => {
                      const nextModule = entry.manifest.modules.find((one) =>
                        one.activities.some((a) => a.id === result.nextActivityId),
                      );
                      if (!nextModule) return;
                      navigate(activityHref(pathId, nextModule.id, result.nextActivityId!));
                    }} label={t('paths.action.next')} />
                </div>
              )}
              {result.nextActivityId && result.nextActivityId === open?.activity.id && !open.check && (
                <div className="lp-actions lp-actions--end">
                  <Button variant="primary" onClick={retry} label={t('error.tryAgain')} />
                </div>
              )}
            </section>
  );

  return (
    <div className="lp-page">
      {(!open?.code || codePassed) && <Breadcrumb items={[{ label: t('roadmap.title'), href: '/learn' }, { label: entry.manifest.title, href: pathHref(pathId) }, { label: module.title, href: activityId ? moduleHref(pathId, module.id) : undefined }, ...(activityId ? [{ label: shown?.title ?? t('paths.loadingActivity') }] : [])]} />}
      {!(activityId && enrollmentId) && <div className="lp-module-layout"><div className="lp-module-overview">
      <header className="lp-head">
        <div className="lp-head__text">
          <div className="lp-head__kicker-row">
            <span className="lp-head__status">
              {/* An off-loop module never completes, so "In progress" would
                  read as unfinished for good. A module with no recorded
                  evidence has not started, whatever the enrollment says. */}
              {offLoop(module)
                ? t('paths.module.optional')
                : moduleProgress?.completed ? t('paths.module.complete')
                  : started ? t('paths.module.inProgress') : t('paths.module.notStarted')}
            </span>
          </div>
          <h1>{module.title}</h1>
          {module.outcomes[0] && <p className="lp-lead">{module.outcomes[0]}</p>}
          {module.outcomes.length > 1 && <details className="lp-objectives"><summary>{t('paths.outcomes')}</summary>
          <ul className="lp-module__outcomes">
            {module.outcomes.slice(1).map((outcome, index) => (
              <li key={index}>{outcome}</li>
            ))}
          </ul>
          </details>}
        </div>
        {!activityId && (target || ctaPending) && (
          <div className="lp-head__actions" aria-busy={!target || undefined}>
            {target && <SwimCta
              label={ctaLabel}
              // A title cut at 32 characters is read whole from the marked row.
              describedBy={targetCut ? NEXT_TITLE_ID : undefined}
              onClick={() => (targetLocked
                ? openUpgradeSheet({ kind: 'learning-path-activity', ref: `${pathId}:${target.id}` })
                : navigate(activityHref(pathId, module.id, target.id)))}
            />}
            {targetLocked && <span className="ss-premium-label">{t('premium.badge')}</span>}
          </div>
        )}
      </header>

      {!isAuthenticated && (
        <div className="lp-notice lp-notice--info">
          <span className="lp-notice__glyph" aria-hidden="true">
            ℹ
          </span>
          <span>{t('paths.signInToRecord')}</span>
        </div>
      )}
      {/* A failed read says so; a missing enrollment is only claimed once the
          list has loaded, never while it is on its way. */}
      {isAuthenticated && (enrollments.error || progress.error) ? (
        <ErrorRetry
          message={pathCopy['paths.hub.error']}
          onRetry={() => {
            void enrollments.refetch();
            if (enrollment) void progress.refetch();
          }}
        />
      ) : isAuthenticated && enrollments.data && !enrollment && (
        <div className="lp-notice lp-notice--info">
          <span className="lp-notice__glyph" aria-hidden="true">
            ℹ
          </span>
          <span>
            {t('paths.notEnrolled')} <Link to={pathHref(pathId)}>{t('paths.action.start')}</Link>
          </span>
        </div>
      )}
      {paused && (
        <div className="lp-notice">
          <span className="lp-notice__glyph" aria-hidden="true">
            ⏸
          </span>
          <span>
            {t('paths.paused')} <Link to={pathHref(pathId)}>{t('paths.action.resume')}</Link>
          </span>
        </div>
      )}

      </div>
      <section className="lp-section lp-module-activities">
        <h2 ref={listHeading} tabIndex={-1}>{t('paths.activities')}</h2>
        <ul className="lp-activities">
          {module.activities.map((one) => (
            <ActivityRow
              key={one.id}
              pathId={pathId}
              moduleId={module.id}
              activity={one}
              locked={activityLock(one.id, states.get(one.id) ?? 'not_started')}
              state={states.get(one.id) ?? 'not_started'}
              interactive={reachable}
              next={one.id === target?.id}
            />
          ))}
        </ul>
      </section>

      </div>}

      {activityId && enrollmentId && (
        // No live region here: it would read the whole activity (a lesson, the
        // editor) aloud on every change. Errors are alerts, the draft status
        // is its own live region, and focus carries the rest.
        <section className="lp-workspace">
          {(!open?.code || codePassed) && <div className="lp-head">
            <div className="lp-head__text">
              {/* An activity linked from another module (an old link, or one
                  that moved between versions) still gets its own name. */}
              <h1 ref={activityHeading} tabIndex={-1}>{shown?.title ?? ''}</h1>
              {shown && <p className="lp-lead">{shown.summary}</p>}
            </div>
            <div className="lp-head__actions">
              <Button variant="ghost" onClick={() => {
                  const next = new URLSearchParams(search);
                  next.delete('activity');
                  setSearch(next, { replace: true });
                }} label={t('paths.action.close')} />
            </div>
          </div>}

          {error && (
            <div className="lp-notice lp-notice--error" role="alert">
              <span className="lp-notice__glyph" aria-hidden="true">
                !
              </span>
              <span>{error}</span>
              {briefChanged && <Button className="lp-brief-refresh" variant="secondary" isDisabled={busy} onClick={() => void refreshBrief()} label={t('coding.verdict.reloadBrief')} />}
              {/* The activity never opened (a dropped connection, a timeout):
                  without this the only way on was Close and open it again. */}
              {!open && !busy && <Button className="lp-brief-refresh" variant="secondary" onClick={() => setDeal((count) => count + 1)} label={t('error.tryAgain')} />}
            </div>
          )}

          {busy && !open && <LoadingScreen label={t('paths.loadingActivity')} />}

          {open?.previous && open.previous.state !== 'not_started' && (
            <div className="lp-notice">
              <span className="lp-notice__glyph" aria-hidden="true">
                ↺
              </span>
              <span>
                {t('paths.previousAttempt', {
                  attempts: open.previous.attempts,
                })}{' '}
                <StateBadge state={open.previous.state} />
              </span>
            </div>
          )}

          {open?.lesson && (
            <LessonActivity
              activity={open}
              busy={busy}
              acknowledged={result?.state === 'self_reviewed'}
              onAcknowledge={() => submit({ acknowledged: true })}
            />
          )}

          {open?.check && (
            <CheckActivity
              questions={open.check.questions}
              scenario={open.activity.scenario}
              passThreshold={open.check.passThreshold}
              domains={open.activity.domains}
              domainThreshold={open.check.domainThreshold}
              result={result}
              busy={busy}
              onSubmit={(answers) => submit({ answers })}
              onRetry={retry}
              retryNeeded={attemptUsedUp}
            />
          )}

          {open?.code && result && codePassed && <CodingCompletion
            xp={result.xpAwarded} complexity={result.complexity} backHref={moduleHref(pathId,module.id)}
            nextHref={result.nextActivityId && result.nextActivityId !== open.activity.id ? (() => {
              const nextModule = entry.manifest.modules.find(one => one.activities.some(activity => activity.id === result.nextActivityId));
              return nextModule ? activityHref(pathId,nextModule.id,result.nextActivityId!) : undefined;
            })() : undefined} />}
          {open?.code && !codePassed && (
            <CodeActivity
              key={open.activity.id}
              code={open.code}
              feedback={resultContent}
              title={titleWithoutKind(shown?.title ?? open.activity.title, t(`paths.kind.${open.activity.kind}` as never))}
              titleRef={activityHeading}
              ancestry={[{ label: t('roadmap.title'), href: '/learn' }, { label: entry.manifest.title, href: pathHref(pathId) }, { label: module.title, href: moduleHref(pathId, module.id) }]}
              onClose={() => { const next = new URLSearchParams(search); next.delete('activity'); setSearch(next, { replace: true }); }}
              fixtureNote={open.activity.fixtureNote}
              submitBlocked={briefChanged}
              draft={draft}
              result={result}
              busy={busy}
              draftStatus={draftStatus}
              onDraft={(source) => saveDraft(open.activity.id, { code: source })}
              onSubmit={(source) => submit({ code: source })}
            />
          )}

          {open?.artifact && (
            <ArtifactActivity
              key={open.activity.id}
              artifact={open.artifact}
              rubric={rubric}
              draft={draft}
              result={result}
              busy={busy}
              draftStatus={draftStatus}
              onDraft={(values) => saveDraft(open.activity.id, { artifact: values })}
              onSubmit={(values) => submit({ artifact: values })}
            />
          )}

          {!open?.code && resultContent}

        </section>
      )}
    </div>
  );
}

/* ── route entry points ────────────────────────────────────────────────── */

export const FdeOverview = () => <PathOverview pathId="fde" />;
export const FdeModule = () => <ModuleWorkspace pathId="fde" />;

export type { PathCatalogEntry };
