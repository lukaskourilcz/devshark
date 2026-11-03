// The Coding section: home, one track and one task. The review queue is
// retired (a pass is permanent); /coding/review only redirects home.
// devShark-only routes; the App gates them like /roadmap and /typing.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useLanguage } from '../../i18n/LanguageContext';
import { codingListCopy } from '../../i18n/translations.codingLists';
import { useAuth } from '../../lib/auth';
import { accountEpoch } from '../../lib/accountData';
import { FadeFinCta, Kicker, SwimCta } from '../landing/LandingKit';
import { WaterlineProgress } from '../SharkFin';
import LoadingScreen from '../LoadingScreen';
import { preloadTaskWorkbench, useWorkbench, useWarmWorkbench } from '../../coding/loadWorkbench';
import { codingKeys, codingProgressQuery, useCodingProgress, useCodingTask } from '../../coding/api';
import { releaseCodingTaskRead, startCodingTaskRead } from '../../coding/earlyTaskRead';
import { splitsTaskRead } from '../../coding/taskRead';
import { queryClient as appQueryClient } from '../../lib/queryClient';
import { freshStoredAccessToken, storedSessionUserId } from '../../lib/supabaseClient';
import { autosaveDraft, deviceDraft, draftStoredBySubmit, flushAutosave, forgetDeviceDraft, keepDeviceDraft, openingDraft, saveDraft } from '../../coding/drafts';
import { DraftNote, useDraftChoice } from '../../coding/DraftNote';
import { bookmarksQuery, practiceSessionQuery, useAdvanceSession, useBookmarks, usePracticeSession, useSaveChallenge } from '../../coding/practice';
import { ChallengeRunPlanner, taskHref } from './ChallengeRunPlanner';
import { CategoryGlyph } from '../ui/techIcons';
import { CODING_INDEX } from '../../../../shared/coding-index';
import { evolvingResume, evolvingStage, evolvingTaskTrack, evolvingPassed, evolvingUnlocked, listedChallenges, type EvolvingCategory } from '../../../../shared/evolving';
import { prepareEvolvingDraft } from '../../../../shared/coding-fullstack-support';
import {
  CODING_DIFFICULTIES,
  CODING_SECTION_TRACKS,
  CODING_TECHNIQUE_GROUPS,
  CODING_TIERS,
  TIER_DIFFICULTY,
  formatOf,
  hasLearnLevel,
  isCodingSectionTrack,
  isCodingTier,
  isDifficulty,
  stageDifficulty,
  tierLockReason,
  tierUnlocked,
  type CodingTaskSummary,
  type CodingTechniqueGroup,
  type CodingTier,
  type CodingTrack,
  type Difficulty,
} from '../../../../shared/coding-catalog';
import type { CodingProgressResponse, CodingTaskProgress, CodingVerdictResponse } from '../../../../shared/coding-api';
import { Badge } from '@astryxdesign/core/Badge';
import { ApiError, friendlyError, isPremiumRequired } from '../../lib/api';
import { isBarred, useLocks, type LockState } from '../../lib/locks';
import { entitlementQuery } from '../../lib/entitlement';
import { readOnce, settled, useFirstData } from '../../lib/routeData';
import { openUpgradeSheet } from '../../lib/upgradeSheet';
import { codingContent, gatedRef } from '../../../../shared/tiers';
import '../../coding/Coding.css';
import { Button } from '@astryxdesign/core/Button';
import { LockedButton } from '../ui/LockedButton';

type Status = 'open' | 'in_progress' | 'passed' | 'revealed' | 'locked' | 'premium';

/** Premium opens this task and the account holds the free plan: open the upgrade sheet. */
const askForPremium = (taskId: string) => {
  const content = codingContent(taskId);
  openUpgradeSheet({ kind: content.kind, ref: gatedRef(content) });
};

const GROUPS = Object.keys(CODING_TECHNIQUE_GROUPS) as CodingTechniqueGroup[];

// Everything the section lists. CODING_INDEX holds only the tracks the section
// offers: system design is hidden, and no task of it ships (CODING_SECTION_TRACKS).
const SECTION_INDEX = CODING_INDEX.filter((task) => isCodingSectionTrack(task.track) && !evolvingStage(task.id));
const INDEX_BY_ID = new Map(CODING_INDEX.map((task) => [task.id, task]));
const TIERS: readonly CodingTier[] = [1, 2, 3, 4, 5];
/** How many project or path rows a list shows before "Show all". */
const LIST_FOLD = 5;

/** The difficulty a track list is filtered to. `?difficulty=` is the filter;
 * an older `?tier=` link still lands on the label its tier projects to. */
function difficultyParam(params: URLSearchParams): Difficulty | 'all' {
  const value = params.get('difficulty');
  if (isDifficulty(value)) return value;
  const tier = Number(params.get('tier'));
  return isCodingTier(tier) ? TIER_DIFFICULTY[tier] : 'all';
}

/** The sealed Learn session a task tab was opened with: in the address's
 * fragment when the Build-it link opened it, then in this tab's storage. */
function learnSessionAt(taskId: string | undefined): string | undefined {
  const sealed = new URLSearchParams(window.location.hash.slice(1)).get('learn');
  try { return sealed ?? sessionStorage.getItem(`devshark:learn-coding:${taskId}`) ?? undefined; } catch { return sealed ?? undefined; }
}

// The first page of a visit (perf baseline #587 C16): a task address asks for
// its task, and fetches its workbench and editor, as this chunk evaluates,
// before the screen renders. The screen's own read then takes the answer
// (coding/earlyTaskRead.ts); a hidden track asks for nothing.
{
  const first = /^\/coding\/([^/]+)\/([^/]+)\/?$/.exec(window.location.pathname);
  let taskId: string | null = null;
  try { taskId = first ? decodeURIComponent(first[2]) : null; } catch { taskId = null; }
  if (first && taskId && isCodingSectionTrack(first[1])) {
    startCodingTaskRead(appQueryClient, taskId, learnSessionAt(taskId));
    void preloadTaskWorkbench().catch(() => undefined);
  }
  // A list address (perf baseline #587 C15): a signed-in list holds its first
  // draw on the plan, the coding progress and the open run (home) or the
  // saved stars (a track), which left only once the screen rendered. The
  // plan already leaves as the app starts (lib/entitlement.ts
  // prefetchStoredAccountPlan); the others leave now, for the stored
  // session's account and only with a token supabase-js would hand out
  // unchanged, under the keys the hold and the screen read, one attempt each
  // as the hold's own reads (lib/routeData.ts readOnce). A session that turns
  // out to have ended signs out, and the sign-out empties the cache.
  const list = /^\/coding(?:\/([^/]+))?\/?$/.exec(window.location.pathname);
  const screen = !list ? null : list[1] === undefined ? 'home' : list[1] === 'fullstack' ? 'fullstack' : isCodingSectionTrack(list[1]) ? 'track' : null;
  if (screen && storedSessionUserId() && freshStoredAccessToken()) {
    void appQueryClient.prefetchQuery({ ...codingProgressQuery, retry: false });
    if (screen === 'home') void appQueryClient.prefetchQuery({ ...practiceSessionQuery, retry: false });
    if (screen === 'track') void appQueryClient.prefetchQuery({ ...bookmarksQuery, retry: false });
  }
}

/** A track, or a challenge, that does not exist (or no longer does): a
 * heading that says so and a way back, never the raw error. Kept out of
 * search results while it shows, as the app's own not-found page is. A hidden
 * track (system design) and anything under it read as a track that does not
 * exist, and the task behind it is never asked for. */
function CodingNotFound({ what, track }: { what: 'track' | 'task' | 'retired'; track: CodingTrack | null }) {
  const { t } = useLanguage();
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots'; robots.content = 'noindex'; robots.dataset.notFound = '';
    document.head.append(robots);
    return () => robots.remove();
  }, []);
  return (
    <div className="cd-page ss-pop">
      <header>
        <Kicker><Link className="cd-link" to="/coding">{t('coding.title')}</Link></Kicker>
        <h1>{t(`coding.notFound.${what}`)}</h1>
      </header>
      <p className="cd-lead">{t('coding.notFound.body')}</p>
      <div className="cd-actions">
        {track && <Button variant="primary" as={Link} href={`/coding/${track}`} label={t('coding.verdict.back')} />}
        <Button variant={track ? 'secondary' : 'primary'} as={Link} href="/coding" label={t('coding.retired.toCoding')} />
      </div>
    </div>
  );
}

function useStatuses(progress: CodingProgressResponse | undefined) {
  const passed = useMemo(() => new Set(Object.entries(progress?.tasks ?? {}).filter(([, p]) => p.status === 'passed').map(([id]) => id)), [progress]);
  const cleared = progress?.javascriptLevelsCleared ?? 0;
  const { lockOf, loading: planLoading, failed: planFailed, refetch: retryPlan, signedIn } = useLocks();
  /** The Premium state of a task. A task already passed stays open on any plan. */
  const premiumOf = useCallback((taskId: string): LockState => (evolvingPassed(taskId, passed) ? 'open' : lockOf(codingContent(taskId))), [lockOf, passed]);
  const unlocked = useCallback((task: CodingTaskSummary) => tierUnlocked({ track: task.track, tier: task.tier, progress: { passed }, tasks: CODING_INDEX, javascriptLevelsCleared: cleared }), [passed, cleared]);
  const lockReason = useCallback((track: CodingTrack, tier: CodingTier) => tierLockReason({ track, tier, progress: { passed }, tasks: CODING_INDEX, javascriptLevelsCleared: cleared }), [passed, cleared]);
  const statusOf = useCallback((task: CodingTaskSummary): Status => {
    if (isBarred(premiumOf(task.id))) return 'premium';
    if (!unlocked(task)) return 'locked';
    const row: CodingTaskProgress | undefined = progress?.tasks[task.id];
    if (!row) return 'open';
    return row.status;
  }, [unlocked, progress, premiumOf]);
  return { passed, statusOf, unlocked, lockReason, premiumOf, planLoading, planFailed: signedIn && planFailed, retryPlan };
}

/** A signed-in account's plan and progress (and, where the screen shows them,
 * the open run or the saved stars), in the cache before the screen's first
 * render, so it draws once instead of drawing zeros and a blank run first. */
function useCodingFirstData(extra: 'session' | 'bookmarks' | null) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  useFirstData(user ? `${user.id} ${extra ?? ''}` : null, () => settled(user
    ? [
        readOnce(queryClient, entitlementQuery(user.id)),
        readOnce(queryClient, codingProgressQuery),
        extra === 'session' ? readOnce(queryClient, practiceSessionQuery) : null,
        extra === 'bookmarks' ? readOnce(queryClient, bookmarksQuery) : null,
      ]
    : []));
}

const nextOpenTask = (tasks: readonly CodingTaskSummary[], statusOf: (t: CodingTaskSummary) => Status, after?: string): CodingTaskSummary | null => {
  const start = after ? tasks.findIndex((t) => t.id === after) + 1 : 0;
  const ordered = [...tasks.slice(start), ...tasks.slice(0, start)];
  return ordered.find((t) => { const s = statusOf(t); return s === 'open' || s === 'in_progress'; }) ?? null;
};

function StatusText({ status }: { status: Status }) {
  const { t } = useLanguage();
  return <span className={`cd-row__status cd-status--${status}`}>{t(`coding.status.${status}` as never)}</span>;
}

/** Save is offered only after both access and progression are known to open a challenge. */
function SaveButton({ taskId, saved, onToggle, busy, toolbar = false }: { taskId: string; saved: boolean; onToggle: (next: boolean) => void; busy: boolean; toolbar?: boolean }) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      className={`cd-save${saved ? ' cd-save--on' : ''}${toolbar ? ' cd-save--toolbar' : ''}`}
      aria-pressed={saved}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      title={t(saved ? 'coding.saved.remove' : 'coding.saved.add')}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onToggle(!saved); }}
    >
      <span aria-hidden>{saved ? '★' : '☆'}</span>
      <span className="cd-visually-hidden">{t(saved ? 'coding.saved.remove' : 'coding.saved.add', { id: taskId })}</span>
    </button>
  );
}

/** One row of a track's list. A track lists up to three hundred of them, and
 * every key typed in its search box draws the list again: a row whose task
 * and state did not change is not drawn again. */
const TaskRow = memo(function TaskRow({ task, status, premium = 'open', saved, onSave, saving, saveError }: {
  task: CodingTaskSummary;
  status: Status;
  /** 'locked' and 'preview' show the "Premium" badge. 'unknown' (the plan is
   * loading or failed) shows none: the server decides when the row opens. */
  premium?: LockState;
  saved?: boolean;
  onSave?: (taskId: string, next: boolean) => void;
  saving?: boolean;
  saveError?: boolean;
}) {
  const { t } = useLanguage();
  const locked = status === 'locked';
  // One line (UX audit coding-06): the title, its level as quiet meta, any
  // tag, then the status at the row's end; every row the same height.
  const level = task.topic === 'dsa'
    ? hasLearnLevel(task) ? `${t('category.dsa')} · ${t('coding.level', { n: task.level })}` : t('category.dsa')
    : hasLearnLevel(task) ? t('coding.level', { n: task.level }) : null;
  const inner = (
    <>
      <span className="cd-row__main">
        <span className="cd-row__title">{task.title}</span>
        {level && <span className="cd-row__meta"><span aria-hidden>·</span>{level}</span>}
        {formatOf(task) === 'debug' && <span className="cd-tag cd-tag--format">{t('coding.format.debug')}</span>}
        {isBarred(premium) && status !== 'premium' && <Badge variant="neutral" label={t('premium.badge')} />}
      </span>
      <StatusText status={status} />
    </>
  );
  const save = onSave && !locked && status !== 'premium' && premium === 'open'
    ? <SaveButton taskId={task.id} saved={saved === true} busy={saving === true} onToggle={(next) => onSave(task.id, next)} />
    : null;
  return (
    <li className="cd-row-item">
      {status === 'premium'
        // Focusable and announced as unavailable; activating it explains why.
        ? <button type="button" className="cd-row cd-row--premium" aria-disabled="true" onClick={() => askForPremium(task.id)}>{inner}</button>
        : locked
          ? <div className="cd-row" aria-disabled="true">{inner}</div>
          : <Link className="cd-row" to={`/coding/${task.track}/${task.id}`}>{inner}</Link>}
      {save}
      {saveError && <p className="cd-row-item__error" role="alert">{codingListCopy('coding.saved.saveFailed')}</p>}
    </li>
  );
});

/** On the free plan: which stages of a project, or levels of a short path,
 * come with it. The numbers are the index's projected flags, so they are
 * shared/tiers.ts's rule: stages 1, 2 and 3 of a ten-stage project, 1 and 2
 * of a FullStack app, level 1 of a short path, always the first ones. */
function freeStages(stages: readonly string[]): { count: number; list: string } {
  const free = stages.flatMap((id, index) => (INDEX_BY_ID.get(id)?.free ? [index + 1] : []));
  return { count: free.length, list: free.length > 1 ? `${free.slice(0, -1).join(', ')} and ${free[free.length - 1]}` : String(free[0] ?? 1) };
}

function PremiumStagesNote({ stages, short }: { stages: readonly string[]; short: boolean }) {
  const { t } = useLanguage();
  const { count, list } = freeStages(stages);
  const note = short ? t('premium.levelsNote') : t(count > 1 ? 'premium.stagesNote' : 'premium.stageNote', { stages: list });
  return <p className="ss-premium-note"><span className="ss-premium-label">{t('premium.badge')}</span> {note}</p>;
}

/** The free-plan stages of a list of projects, as "1, 2 and 3", or null when
 * the list holds no long project. Every long project in one list opens the
 * same opening stages (shared/tiers.ts), so the first one speaks for all. */
function freeStagesOf(challenges: readonly { stages: readonly string[]; short?: boolean }[]): string | null {
  const project = challenges.find((challenge) => !challenge.short);
  return project ? freeStages(project.stages).list : null;
}

/** The Premium rule of one list, said once in its intro rather than under
 * every row (UX audit coding-05): level 1 of a path, the opening stages of a
 * project, or both when the list holds both. */
function PremiumRuleNote({ challenges }: { challenges: readonly { stages: readonly string[]; short?: boolean }[] }) {
  const { t } = useLanguage();
  const stages = freeStagesOf(challenges);
  const paths = challenges.some((challenge) => challenge.short);
  const note = stages === null
    ? codingListCopy('premium.pathsRule')
    : paths ? codingListCopy('premium.pathsProjectsRule', { stages }) : codingListCopy('premium.projectsRule', { stages });
  return <p className="ss-premium-note cd-projects__rule"><span className="ss-premium-label">{t('premium.badge')}</span> {note}</p>;
}

/** Signed out, what a pass needs: said once per screen, as one quiet line
 * under the page lead (UX audit coding-10), not a tinted bar and not again in
 * a list's intro. The header's Sign in button is the way to act on it. */
function SignInLine() {
  const { t } = useLanguage();
  return <p className="cd-signin-line">{t('coding.signInHint')}</p>;
}

/** Unknown access and stale progress mean the same thing on every Coding list. */
function PlanNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useLanguage();
  return failed ? <p className="cd-note cd-note--error" role="alert">{t('coding.planFailed')} <Button variant="secondary" onClick={onRetry} label={t('coding.retry')} /></p> : null;
}

function StaleProgressNotice({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useLanguage();
  return failed ? <p className="cd-note cd-note--error" role="alert">{codingListCopy('coding.progress.stale')} <Button variant="secondary" onClick={onRetry} label={t('coding.retry')} /></p> : null;
}

/* ── /coding ──────────────────────────────────────────────────────────── */
/** The evolving projects of one category (the plain ones, the FullStack
 * builds or the debugging paths), or with `track`, the short paths of one
 * section, listed on that section's page. Each list has its own copy. The
 * FullStack list holds its short path and its long apps together; the
 * debugging list holds its three short paths; the plain list on the Coding
 * home holds the long projects only. `listedChallenges` decides. */
function EvolvingGallery({ passed, premiumOf, category, track, progressKnown = true, labelledBy }: { passed: ReadonlySet<string>; premiumOf: (taskId: string) => LockState; category?: EvolvingCategory; track?: CodingTrack; progressKnown?: boolean; labelledBy?: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const fullstack = category === 'fullstack';
  const challenges = useMemo(() => listedChallenges({ category, track }), [category, track]);
  const titleId = labelledBy ?? `${track ? `${track}-paths` : category ?? 'evolving'}-title`;
  const listId = `${titleId}-list`;
  // A long list shows its first five rows and a button for the rest, in
  // place of a scroll box inside the page (UX audit coding-09). The open list
  // is remembered by its id, so another track's list starts folded.
  const foldable = challenges.length > LIST_FOLD;
  const [openList, setOpenList] = useState<string | null>(null);
  const showAll = !foldable || openList === listId;
  // Opening the rest moves focus to the first row that was hidden.
  const focusFirstHidden = useRef(false);
  useEffect(() => {
    if (!focusFirstHidden.current || !showAll) return;
    focusFirstHidden.current = false;
    (listRef.current?.children[LIST_FOLD] as HTMLElement | undefined)?.focus();
  }, [showAll]);
  const titleKey = track ? 'coding.evolving.paths' : category === 'fullstack' ? 'coding.evolving.fullstack' : category === 'debugging' ? 'coding.evolving.debugging' : 'coding.evolving.title';
  const bodyKey = track ? 'coding.evolving.pathsBody' : category === 'fullstack' ? 'coding.evolving.fullstackBody' : category === 'debugging' ? 'coding.evolving.debuggingBody' : 'coding.evolving.body';
  if (challenges.length === 0) return null;
  // On a free account the stages after the opening ones read "Premium". The
  // rule is said once, in the intro; each row keeps only its badge.
  const laterLockedIn = (challenge: (typeof challenges)[number]) => challenge.stages.some((id) => isBarred(premiumOf(id)));
  const anyLocked = challenges.some(laterLockedIn);
  return <section className="cd-projects" aria-labelledby={titleId}>
    <div className="cd-projects__intro">
    {!labelledBy && <Kicker as="h2" id={titleId}>{t(titleKey)}</Kicker>}
    <p className="cd-lead">{t(bodyKey)}</p>
    {anyLocked && <PremiumRuleNote challenges={challenges} />}
    </div>
    <div className="cd-projects__body">
    <div ref={listRef} id={listId} className="cd-project-list">{(showAll ? challenges : challenges.slice(0, LIST_FOLD)).map((challenge, index) => {
      const completed = challenge.stages.filter(id => evolvingPassed(id, passed)).length;
      const resumeId = evolvingResume(challenge, passed);
      const laterLocked = laterLockedIn(challenge);
      // The verb says where the learner stands: nothing done, part done, all done.
      const action = !progressKnown ? codingListCopy('coding.project.open') : completed === challenge.stages.length ? codingListCopy('coding.evolving.review') : completed > 0 ? t('coding.continue') : codingListCopy('coding.evolving.start');
      return <article key={challenge.id} className="cd-project" tabIndex={index >= LIST_FOLD ? -1 : undefined} aria-labelledby={`${challenge.id}-name`}>
        <span className="cd-project__number" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
        <div className="cd-project__name">
        {/* On a section's own page every path is that section's, so the line would only repeat the heading. */}
        {!track && !fullstack && <p className="cd-project__track">{category === 'debugging' ? `${t(`coding.track.${challenge.track}` as never)} · ${t('coding.format.debug')}` : t(`coding.track.${challenge.track}` as never)}</p>}
        <h3 id={`${challenge.id}-name`}>{challenge.title}</h3>
        </div>
        <div className="cd-project__progress">
          {progressKnown && <div className="cd-stage-meter" aria-hidden>{challenge.stages.map(id => <span key={id} data-complete={evolvingPassed(id, passed)} />)}</div>}
          <p>{progressKnown ? t(challenge.short ? 'coding.evolving.levelsProgress' : 'coding.evolving.progress', { n: completed, total: challenge.stages.length }) : codingListCopy('coding.progress.unavailable')}{laterLocked && <> <Badge variant="neutral" label={t('premium.badge')} /></>}</p>
        </div>
        {/* The quieter fin: the page's one SwimCta is its next challenge. */}
        <FadeFinCta label={action} ariaLabel={codingListCopy('coding.project.action', { action, title: challenge.title })} finLeft="62%" finSize={26} accent="var(--brand-accent)" onClick={() => { if (isBarred(premiumOf(resumeId))) askForPremium(resumeId); else navigate(`/coding/${evolvingTaskTrack(resumeId)}/${resumeId}`); }} />
      </article>;
    })}</div>
    {foldable && (
      <Button
        variant="ghost"
        className="cd-projects__more"
        aria-expanded={showAll}
        aria-controls={listId}
        label={showAll ? codingListCopy('coding.evolving.showFewer') : codingListCopy('coding.evolving.showAll', { n: challenges.length })}
        onClick={() => {
          focusFirstHidden.current = !showAll;
          setOpenList(showAll ? null : listId);
        }}
      />
    )}
    </div>
  </section>;
}

/** Which challenge is next, and a way into it, beside the page heading. For a
 * signed-in learner it waits for their progress: worked out from nothing, it
 * would name the first challenge and then swap it for the real one. */
function NextChallenge({ next, state, onRetry }: { next: CodingTaskSummary | null; state: 'loading' | 'error' | 'ready'; onRetry: () => void }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  return (
    <section className="cd-next" aria-labelledby="cd-next-label" aria-busy={state === 'loading' || undefined}>
      <div className="cd-next__text">
        <h2 id="cd-next-label" className="cd-next__label">{t('coding.discovery.next')}</h2>
        {state === 'loading' && (
          <p className="cd-next__title">
            <span className="cd-next__placeholder" aria-hidden="true" />
            <span className="cd-visually-hidden">{t('coding.discovery.loading')}</span>
          </p>
        )}
        {state === 'error' && <p className="cd-next__title cd-next__title--error" role="alert">{t('coding.discovery.failed')}</p>}
        {state === 'ready' && <p className="cd-next__title">{next ? next.title : t('coding.allDone')}</p>}
      </div>
      {state === 'error' && <Button variant="secondary" onClick={onRetry} label={t('coding.retry')} />}
      {/* Held disabled while loading, so the card keeps its size when the title arrives. */}
      {state !== 'error' && (state === 'loading' || next) && (
        <SwimCta label={t('coding.continue')} disabled={state === 'loading'} onClick={() => { if (next) navigate(`/coding/${next.track}/${next.id}`); }} />
      )}
    </section>
  );
}

export function CodingHome() {
  useCodingFirstData('session');
  useWarmWorkbench();
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const progress = useCodingProgress(isAuthenticated);
  const { passed, statusOf, premiumOf, planLoading, planFailed, retryPlan } = useStatuses(progress.data);
  const progressKnown = !isAuthenticated || Boolean(progress.data);
  const next = useMemo(() => nextOpenTask(SECTION_INDEX, statusOf), [statusOf]);
  // The plan decides which tasks are Premium, so the card also waits for it:
  // otherwise a free account would see a Premium task named first.
  const nextState = authLoading || planLoading || (isAuthenticated && progress.isLoading)
    ? 'loading'
    : isAuthenticated && progress.isError && !progress.data ? 'error' : 'ready';

  return (
    <div className="cd-page cd-discovery ss-pop">
      <div className="cd-home-head">
        <header>
          <Kicker as="h1" className="ss-section-title">{t('coding.title')}</Kicker>
          <p className="cd-lead">{t('coding.subtitle')}</p>
          {!authLoading && !isAuthenticated && <SignInLine />}
        </header>
        <NextChallenge next={next} state={nextState} onRetry={() => void progress.refetch()} />
      </div>
      <PlanNotice failed={planFailed} onRetry={retryPlan} />
      <StaleProgressNotice failed={isAuthenticated && progress.isError && Boolean(progress.data)} onRetry={() => void progress.refetch()} />
      <section aria-label={t('coding.title')} className="cd-track-directory">
        {CODING_SECTION_TRACKS.map((track) => {
          const tasks = SECTION_INDEX.filter((task) => task.track === track);
          const done = tasks.filter((task) => passed.has(task.id)).length;
          return (
            <Link key={track} className="cd-track-entry" to={`/coding/${track}`}>
              <span className="cd-track-entry__symbol" aria-hidden><CategoryGlyph category={track} color="var(--color-text-accent)" size={30} /></span>
              <div className="cd-track-entry__body">
              <div className="cd-track__title">
                <h2>{t(`coding.track.${track}` as never)}</h2>
                <span className="cd-track__count">{progressKnown ? t('coding.progress', { passed: done, total: tasks.length }) : codingListCopy('coding.progress.unavailable')}</span>
              </div>
              {progressKnown && <WaterlineProgress decorativeFins value={tasks.length ? (100 * done) / tasks.length : 0} label={t('coding.progress', { passed: done, total: tasks.length })} />}
              <p className="cd-track__blurb">{t(`coding.trackBlurb.${track}` as never)}</p>
              </div>
              <span className="cd-track-entry__arrow" aria-hidden>↗</span>
            </Link>
          );
        })}
      </section>
      {/* Below the tracks and collapsed to one row until it is opened: a run
          is a way through the tracks, not the first thing to read. */}
      <ChallengeRunPlanner signedIn={isAuthenticated} collapsible />
      <EvolvingGallery passed={passed} premiumOf={premiumOf} category="debugging" progressKnown={progressKnown} />
      <EvolvingGallery passed={passed} premiumOf={premiumOf} progressKnown={progressKnown} />
      <Link className="cd-fullstack-feature" to="/coding/fullstack">
        <div><Kicker>{t('coding.discovery.build')}</Kicker><h2>{t('coding.evolving.fullstack')}</h2><p>{t('coding.discovery.fullstack')}</p><span className="cd-link">{t('coding.discovery.explore')} <span aria-hidden>↗</span></span></div>
        <div className="cd-stack-path" aria-hidden><span>JS</span><i>→</i><span>TS</span><i>→</i><span>API</span><i>→</i><span>React</span></div>
      </Link>
      {/* Ten technique groups, each one a row that says what it is rather than
          a pill that says only its name and a number. A row opens the track
          with the most of that technique, filtered to it, and counts that
          track's challenges, so the number is the one the list shows; the
          sentence is what makes the name mean something to a learner who has
          not met it yet. */}
      <section aria-labelledby="cd-techniques">
        <Kicker as="h2" id="cd-techniques">{t('coding.techniques')}</Kicker>
        <p className="cd-lead">{t('coding.techniquesLead')}</p>
        <div className="cd-techniques">
          {GROUPS.map((group) => {
            const tags = CODING_TECHNIQUE_GROUPS[group] as readonly string[];
            const counts = new Map<CodingTrack, number>();
            for (const task of SECTION_INDEX) if (task.focus.some((tag) => tags.includes(tag))) counts.set(task.track, (counts.get(task.track) ?? 0) + 1);
            const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
            if (!best) return null;
            const [track, count] = best;
            return (
              <Link key={group} className="cd-technique" to={`/coding/${track}?group=${group}`}>
                <span className="cd-technique__head">
                  <span className="cd-technique__name">{t(`coding.group.${group}` as never)}</span>
                  <span className="cd-technique__count">{t('coding.techniqueCount', { n: count, track: t(`coding.track.${track}` as never) })}</span>
                </span>
                <span className="cd-technique__blurb">{t(`coding.groupBlurb.${group}` as never)}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function FullStackScreen() {
  useCodingFirstData(null);
  useWarmWorkbench();
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();
  const progress = useCodingProgress(isAuthenticated);
  const { passed, premiumOf, planLoading, planFailed, retryPlan } = useStatuses(progress.data);
  if ((isAuthenticated && progress.isLoading) || planLoading) return <LoadingScreen label={t('coding.loading')} />;
  return <div className="cd-page ss-pop">
    <Link className="cd-link" to="/coding">{t('coding.title')}</Link>
    <Kicker as="h1" className="ss-section-title" id="cd-fullstack-title">{codingListCopy('coding.fullstack.title')}</Kicker>
    <PlanNotice failed={planFailed} onRetry={retryPlan} />
    {isAuthenticated && progress.isError && !progress.data && <p className="cd-note cd-note--error" role="alert">{t('coding.discovery.failed')} <Button variant="secondary" onClick={()=>void progress.refetch()} label={t('coding.retry')} /></p>}
    <StaleProgressNotice failed={isAuthenticated && progress.isError && Boolean(progress.data)} onRetry={() => void progress.refetch()} />
    <EvolvingGallery passed={passed} premiumOf={premiumOf} category="fullstack" progressKnown={!isAuthenticated || Boolean(progress.data)} labelledBy="cd-fullstack-title" />
  </div>;
}

/* ── /coding/:track ──────────────────────────────────────────────────── */
/** A track the section does not offer (system design is hidden) is the
 * not-found page, decided before anything loads: it reads no plan, progress
 * or stars and warms no workbench (perf baseline #587 C26). */
export function CodingTrackScreen() {
  const { track } = useParams();
  return isCodingSectionTrack(track) ? <CodingTrackList track={track} /> : <CodingNotFound what="track" track={null} />;
}

function CodingTrackList({ track }: { track: CodingTrack }) {
  useCodingFirstData('bookmarks');
  useWarmWorkbench();
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const progress = useCodingProgress(isAuthenticated);
  const { passed, statusOf, lockReason, premiumOf, planLoading, planFailed, retryPlan } = useStatuses(progress.data);
  const group = params.get('group');
  // An old ?status=due link (the retired review queue) lists everything.
  const statusParam = params.get('status');
  const statusFilter = statusParam === 'open' || statusParam === 'passed' ? statusParam : 'all';
  // Every filter lives in the URL, so a filtered list is a link a learner can
  // keep, share with themselves on another device, or reload without losing.
  const query = params.get('q') ?? '';
  // The search box keeps what is typed itself. Read back from the URL, which
  // the router updates in a transition, it lost keys: React put the old value
  // back until the list re-rendered, and the next key replaced the one before.
  // Clearing the filters empties it, and another track starts a fresh one.
  const searchBox = useRef<HTMLInputElement>(null);
  const difficulty = difficultyParam(params);
  const duration = params.get('time') ?? 'all';
  // No task is graded by a checklist since 29 Sep 2026, so an old
  // ?format=checklist link reads as no format filter rather than an empty list.
  const formatParam = params.get('format');
  // Old ?format=tests links still include every test-graded task. All issued
  // formats use tests; the current choices describe what the learner does.
  const format = formatParam === 'write' || formatParam === 'debug' ? formatParam : 'all';
  const savedOnly = params.get('saved') === '1';
  const bookmarks = useBookmarks(isAuthenticated);
  const savedIds = useMemo(() => new Set(bookmarks.data?.saved ?? []), [bookmarks.data]);
  const save = useSaveChallenge();
  // `mutate` keeps its identity while the mutation's result object does not,
  // so the rows' callback stays the same and the rows can skip a redraw.
  const saveChallenge = save.mutate;
  const onSave = useCallback((taskId: string, next: boolean) => {
    saveChallenge({ op: 'save', taskId, saved: next });
  }, [saveChallenge]);

  const tasks = useMemo(() => SECTION_INDEX.filter((task) => task.track === track), [track]);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => tasks.filter((task) => {
    if (group && group in CODING_TECHNIQUE_GROUPS) {
      const tags = CODING_TECHNIQUE_GROUPS[group as CodingTechniqueGroup] as readonly string[];
      if (!task.focus.some((tag) => tags.includes(tag))) return false;
    }
    if (needle) {
      // The title as the row shows it, plus the technique tags: the words a
      // learner actually remembers about a challenge.
      const haystack = `${task.title} ${task.focus.join(' ')}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (difficulty !== 'all' && task.difficulty !== difficulty) return false;
    if (duration === 'short' && task.estimatedMinutes > 10) return false;
    if (duration === 'medium' && (task.estimatedMinutes <= 10 || task.estimatedMinutes > 25)) return false;
    if (duration === 'long' && task.estimatedMinutes <= 25) return false;
    // A single dimension: write the implementation or repair an existing one.
    if (format === 'debug' && formatOf(task) !== 'debug') return false;
    if (format === 'write' && formatOf(task) !== 'implement') return false;
    if (savedOnly && !savedIds.has(task.id)) return false;
    if (statusFilter === 'all') return true;
    const status = statusOf(task);
    if (statusFilter === 'passed') return status === 'passed';
    return status === 'open' || status === 'in_progress' || status === 'revealed';
  }), [tasks, group, needle, difficulty, duration, format, savedOnly, savedIds, statusFilter, statusOf]);
  const filtersOn = Boolean(group) || needle !== '' || difficulty !== 'all' || duration !== 'all'
    || format !== 'all' || savedOnly || statusFilter !== 'all';
  const groupsHere = useMemo(() => GROUPS.filter((g) => tasks.some((task) => task.focus.some((tag) => (CODING_TECHNIQUE_GROUPS[g] as readonly string[]).includes(tag)))), [tasks]);
  // The plan decides which rows carry the Premium mark, so the list waits for
  // it, as the Coding home does; a plan that cannot load says so.
  if (planLoading || (isAuthenticated && progress.isLoading && !progress.data)) return <LoadingScreen label={t('coding.loading')} />;
  // Without the learner's progress the list would read "0 passed", every
  // passed task "Open" and later tiers locked. It says the read failed
  // instead, as the Coding home does, and offers it again.
  if (isAuthenticated && progress.isError && !progress.data) {
    return (
      <div className="cd-page ss-pop">
        <header>
          <Kicker as="h1" className="ss-section-title">{t(`coding.track.${track}` as never)}</Kicker>
          <p className="cd-lead">{t(`coding.trackBlurb.${track}` as never)}</p>
        </header>
        <p className="cd-note cd-note--error" role="alert">
          {t('coding.discovery.failed')} <Button variant="secondary" onClick={() => void progress.refetch()} isLoading={progress.isFetching} isInterruptible label={t('coding.retry')} />
        </p>
      </div>
    );
  }
  const done = tasks.filter((task) => passed.has(task.id)).length;
  // Easy, then Medium, then Hard; inside each, the tiers that fall in it, so
  // a tier's lock line stays beside the challenges it locks.
  const bands = CODING_DIFFICULTIES
    .map((level) => ({ level, tiers: TIERS.filter((tier) => filtered.some((task) => task.difficulty === level && task.tier === tier)) }))
    .filter((band) => band.tiers.length > 0);
  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    // The label filter replaces the old tier one; never leave both in a link.
    if (key === 'difficulty') next.delete('tier');
    setParams(next, { replace: true });
  };

  return (
    <div className="cd-page ss-pop">
      <header>
        <Kicker as="h1" className="ss-section-title">{t(`coding.track.${track}` as never)}</Kicker>
        <p className="cd-lead">{t(`coding.trackBlurb.${track}` as never)}</p>
        {!authLoading && !isAuthenticated && <SignInLine />}
        <div style={{ marginTop: 12, maxWidth: 420 }}>
          <WaterlineProgress decorativeFins value={tasks.length ? (100 * done) / tasks.length : 0} label={t('coding.progress', { passed: done, total: tasks.length })} />
          <p className="cd-track__count" style={{ margin: '6px 0 0' }}>{t('coding.progress', { passed: done, total: tasks.length })}</p>
        </div>
      </header>
      <PlanNotice failed={planFailed} onRetry={retryPlan} />
      <StaleProgressNotice failed={isAuthenticated && progress.isError && Boolean(progress.data)} onRetry={() => void progress.refetch()} />
      <EvolvingGallery passed={passed} premiumOf={premiumOf} track={track} />
      {/* One filter row (UX audit coding-16): the search and one select per
          filter, the technique one at every width, and status with Saved for
          a signed-in learner. Under 760px it folds to a 2-column grid. */}
      <div className="cd-search">
        <label className="cd-visually-hidden" htmlFor={`${track}-search`}>{t('coding.filter.searchLabel')}</label>
        <input
          key={track}
          ref={searchBox}
          id={`${track}-search`}
          type="search"
          defaultValue={query}
          placeholder={t('coding.filter.searchPlaceholder')}
          onChange={(event) => setFilter('q', event.target.value || null)}
        />
        <label className="cd-visually-hidden" htmlFor={`${track}-technique`}>{t('coding.techniques')}</label>
        <select id={`${track}-technique`} value={group ?? 'all'} onChange={(event) => setFilter('group', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">{t('coding.techniques.all')}</option>
          {groupsHere.map((g) => <option key={g} value={g}>{t(`coding.group.${g}` as never)}</option>)}
        </select>
        <label className="cd-visually-hidden" htmlFor={`${track}-difficulty`}>{t('coding.filter.difficulty')}</label>
        <select id={`${track}-difficulty`} value={difficulty} onChange={(event) => setFilter('difficulty', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">{t('coding.filter.difficulty')}</option>
          {CODING_DIFFICULTIES.map((level) => (
            <option key={level} value={level}>{t(`coding.difficulty.${level}`)}</option>
          ))}
        </select>
        <label className="cd-visually-hidden" htmlFor={`${track}-time`}>{t('coding.filter.duration')}</label>
        <select id={`${track}-time`} value={duration} onChange={(event) => setFilter('time', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">{t('coding.filter.duration')}</option>
          <option value="short">{t('coding.filter.durationShort')}</option>
          <option value="medium">{t('coding.filter.durationMedium')}</option>
          <option value="long">{t('coding.filter.durationLong')}</option>
        </select>
        <label className="cd-visually-hidden" htmlFor={`${track}-format`}>{codingListCopy('coding.filter.taskType')}</label>
        <select id={`${track}-format`} value={format} onChange={(event) => setFilter('format', event.target.value === 'all' ? null : event.target.value)}>
          <option value="all">{codingListCopy('coding.filter.taskType')}</option>
          <option value="write">{codingListCopy('coding.filter.write')}</option>
          <option value="debug">{t('coding.filter.formatDebug')}</option>
        </select>
        {isAuthenticated && (
          <>
            <label className="cd-visually-hidden" htmlFor={`${track}-status`}>{t('coding.filter.status')}</label>
            <select
              id={`${track}-status`}
              value={savedOnly ? 'saved' : statusFilter}
              onChange={(event) => {
                const value = event.target.value;
                const next = new URLSearchParams(params);
                next.delete('status');
                next.delete('saved');
                if (value === 'saved') next.set('saved', '1');
                else if (value !== 'all') next.set('status', value);
                setParams(next, { replace: true });
              }}
            >
              <option value="all">{codingListCopy('coding.filter.anyStatus')}</option>
              <option value="open">{t('coding.status.open')}</option>
              <option value="passed">{t('coding.status.passed')}</option>
              <option value="saved">{t('coding.filter.saved')}</option>
            </select>
          </>
        )}
        {filtersOn && (
          <Button variant="ghost" onClick={() => { if (searchBox.current) searchBox.current.value = ''; setParams(new URLSearchParams(), { replace: true }); }} label={t('coding.filter.reset')} />
        )}
      </div>
      {isAuthenticated && bookmarks.isError && <p className="cd-note cd-note--error" role="alert">{bookmarks.data ? codingListCopy('coding.saved.stale') : t('coding.saved.loadFailed')} <Button variant="secondary" onClick={() => void bookmarks.refetch()} label={t('coding.retry')} /></p>}
      {/* The total is the header's; the count speaks only once a filter
          narrows the list. The live region stays in place, empty, so the
          first filter is announced too. */}
      <p className="cd-filter-count" role="status">{savedOnly && !bookmarks.data ? bookmarks.isPending ? codingListCopy('coding.saved.loading') : '' : filtersOn ? t('coding.filter.count', { shown: filtered.length, total: tasks.length }) : ''}</p>

      {filtered.length === 0 && !(savedOnly && !bookmarks.data) && <p className="cd-note">{filtersOn ? t('coding.filter.empty') : t('coding.empty')}</p>}
      {bands.map(({ level, tiers }) => (
        <section key={level} className="cd-band" aria-labelledby={`cd-band-${level}`}>
          <h2 id={`cd-band-${level}`} className="cd-band__title">{t(`coding.difficulty.${level}`)}</h2>
          {tiers.map((tier) => {
            const reason = lockReason(track, tier);
            return (
              <section key={tier} className="cd-tier" aria-labelledby={`cd-tier-${level}-${tier}`}>
                <div className="cd-tier__head">
                  <h3 id={`cd-tier-${level}-${tier}`}>{t(`coding.tier.${CODING_TIERS[tier]}` as never)}</h3>
                  {reason && <p className="cd-tier__lock">{t(`coding.lock.${reason}` as never)}</p>}
                </div>
                <ul className="cd-rows">
                  {filtered.filter((task) => task.difficulty === level && task.tier === tier).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      status={statusOf(task)}
                      premium={premiumOf(task.id)}
                      saved={savedIds.has(task.id)}
                      onSave={isAuthenticated && bookmarks.data ? onSave : undefined}
                      saving={save.isPending && save.variables?.op === 'save' && save.variables.taskId === task.id}
                      saveError={save.isError && save.variables?.op === 'save' && save.variables.taskId === task.id}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/* ── /coding/:track/:taskId ──────────────────────────────────────────── */
/** The stages of the path the open task belongs to, numbered, under their
 * difficulty. Consecutive stages with one label share a labelled group, so the
 * order stays the path's order even when an authored label breaks a band. */
function StageNav({ stages, short, currentId, passed, premiumOf }: { stages: readonly string[]; short: boolean; currentId: string; passed: ReadonlySet<string>; premiumOf: (taskId: string) => LockState }) {
  const { t } = useLanguage();
  const navRef = useRef<HTMLElement>(null);
  const [explainedLock, setExplainedLock] = useState<string | null>(null);
  const prerequisiteReason = (index: number) => codingListCopy(short ? 'coding.level.unlock' : 'coding.stage.unlock', {
    previous: stages.slice(0, index).findIndex((id) => !evolvingPassed(id, passed)) + 1,
    n: index + 1,
  });
  const explainedIndex = explainedLock ? stages.indexOf(explainedLock) : -1;
  const lockReason = explainedIndex > 0 && !evolvingUnlocked(stages[explainedIndex], passed)
    ? prerequisiteReason(explainedIndex) : null;
  // On a phone the list scrolls sideways; bring the open stage into view
  // without moving the page.
  useEffect(() => {
    const nav = navRef.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const navBox = nav.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    nav.scrollLeft += box.left - navBox.left - (navBox.width - box.width) / 2;
  }, [currentId]);
  const groups: { level: Difficulty; entries: { id: string; index: number }[] }[] = [];
  stages.forEach((id, index) => {
    const level = INDEX_BY_ID.get(id)?.difficulty ?? stageDifficulty(index, stages.length);
    const last = groups[groups.length - 1];
    if (last && last.level === level) last.entries.push({ id, index });
    else groups.push({ level, entries: [{ id, index }] });
  });
  return (
    <><nav ref={navRef} className="cd-actions cd-stage-nav" aria-label={t(short ? 'coding.evolving.levels' : 'coding.evolving.title')}>
      {groups.map(({ level, entries }) => {
        const labelId = `cd-stage-group-${entries[0].index}`;
        return (
          <div key={labelId} className="cd-stage-group" role="group" aria-labelledby={labelId}>
            <span id={labelId} className="cd-stage-group__label">{t(`coding.difficulty.${level}`)}</span>
            {entries.map(({ id, index }) => {
              const label = t(short ? 'coding.evolving.level' : 'coding.evolving.stage', { n: index + 1, total: stages.length });
              const current = id === currentId;
              // A Premium stage stays focusable and opens the upgrade sheet.
              if (!current && isBarred(premiumOf(id))) {
                const premiumLabel = t('premium.stageLabel', { label });
                return <LockedButton key={id} variant="secondary" size="sm" label={premiumLabel} tooltip={premiumLabel} onClick={() => askForPremium(id)}>{index + 1}</LockedButton>;
              }
              return evolvingUnlocked(id, passed) || current
                ? <Button key={id} variant="secondary" size="sm" as={Link} href={`/coding/${evolvingTaskTrack(id)}/${id}`} label={label} tooltip={label} aria-current={current ? 'step' : undefined}>{evolvingPassed(id, passed) ? '✓ ' : ''}{index + 1}</Button>
                : <LockedButton key={id} variant="secondary" size="sm" tooltip={prerequisiteReason(index)} label={`${label}. ${prerequisiteReason(index)}`} onClick={() => setExplainedLock(id)}>{index + 1}</LockedButton>;
            })}
          </div>
        );
      })}
    </nav>{lockReason && <p className="cd-note" role="status">{lockReason}</p>}</>
  );
}

/** A track the section does not offer (system design is hidden) is not
 * found. Its task is never fetched, so no session is issued, and the screen
 * reads no plan, progress, stars or run for it (perf baseline #587 C26). */
export function CodingTaskScreen() {
  const { track, taskId } = useParams();
  return isCodingSectionTrack(track) && taskId ? <CodingTaskView track={track} taskId={taskId} /> : <CodingNotFound what="track" track={null} />;
}

function CodingTaskView({ track, taskId }: { track: CodingTrack; taskId: string }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const progress = useCodingProgress(isAuthenticated);
  const { statusOf, premiumOf, passed: passedIds } = useStatuses(progress.data);
  const [learnLink, setLearnLink] = useState(() => ({ taskId, session: learnSessionAt(taskId) }));
  const learnSession = learnLink.taskId === taskId ? learnLink.session : undefined;
  useEffect(() => {
    if (!learnSession || !taskId) return;
    try { sessionStorage.setItem(`devshark:learn-coding:${taskId}`, learnSession); } catch { /* memory copy still works */ }
    if (new URLSearchParams(window.location.hash.slice(1)).has('learn')) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  }, [learnSession, taskId]);
  const task = useCodingTask(taskId, learnSession, splitsTaskRead(taskId, learnSession));
  // This screen's read is on: an early read of the first page lets go.
  useEffect(() => { releaseCodingTaskRead(); }, []);
  useEffect(() => {
    if (learnSession && task.data?.session && task.data.session !== learnSession && task.data.task.id === taskId) {
      setLearnLink({ taskId, session: task.data.session });
    }
  }, [learnSession, task.data, taskId]);
  const [attempt, setAttempt] = useState(0);
  // The code kept across a refresh of the brief belongs to the account it
  // was typed under: after a sign-out the editor does not reopen on it.
  const [refreshDraft, setRefreshDraft] = useState<{ taskId: string; code: string; epoch: number } | null>(null);
  const [completedTask, setCompletedTask] = useState<string | null>(null);
  const workbench = useWorkbench(true, attempt);
  const bookmarks = useBookmarks(isAuthenticated);
  const save = useSaveChallenge();
  // An active challenge run carries the learner from one queued task to the
  // next: a pass moves the run's position, and Next points at the queue.
  const run = usePracticeSession(isAuthenticated);
  const advanceRun = useAdvanceSession();
  const activeRun = run.data?.session?.status === 'active' ? run.data.session : null;
  const runIndex = activeRun && taskId ? activeRun.queue.indexOf(taskId) : -1;

  useEffect(() => {
    if (task.data && task.data.task.track !== track) navigate(`/coding/${task.data.task.track}/${task.data.task.id}`, { replace: true });
  }, [task.data, track, navigate]);

  // The code the editor opens with, decided once per load of the task: this
  // device's copy or the account draft. The page says which opened when they
  // differ, and a copy from this device that did not open is offered back.
  const opening = useMemo(() => task.data ? openingDraft(task.data.task.id, task.data.draft, task.data.draftUpdatedAt) : null, [task.data]);
  const keepOnDevice = Boolean(taskId && evolvingStage(taskId));
  const choice = useDraftChoice(task.data?.task.id ?? null, opening, task.data?.draftUpdatedAt, { signedIn: isAuthenticated, keepOnDevice });
  const { base: draftBase, epoch: draftEpoch } = choice;

  // A device copy a second after typing stops, and the account draft on Run
  // and Submit, silently (coding/drafts.ts). Evolving code is also the
  // offline starting point of the next stage, so it stays on the device after
  // the account takes it.
  const onDraft = useCallback((code: string) => (
    taskId ? saveDraft(taskId, code, { signedIn: isAuthenticated, base: draftBase, epoch: draftEpoch, keepOnDevice }) : null
  ), [taskId, isAuthenticated, draftBase, draftEpoch, keepOnDevice]);
  const onEdit = useCallback((code: string) => { if (taskId) autosaveDraft(taskId, code, draftBase, draftEpoch); }, [taskId, draftBase, draftEpoch]);
  // Leaving the task writes what is still waiting.
  useEffect(() => () => { if (taskId) flushAutosave(taskId); }, [taskId]);
  // Signed in on this page (the sign-in dialog, another tab): the task is
  // read again for the account, and the editor reopens on whichever copy the
  // rules choose, the code kept at a sign-out the learner did not choose
  // included (lib/accountData.ts). Signed out on it, the task is read again
  // for nobody: the account's code does not stay in the editor for whoever
  // uses the device next, on a session whose saves and Submit were its own.
  const fetchedSignedIn = task.data?.signedIn;
  const refetchTask = task.refetch;
  useEffect(() => {
    if (!authLoading && fetchedSignedIn !== undefined && fetchedSignedIn !== isAuthenticated) void refetchTask();
  }, [authLoading, fetchedSignedIn, isAuthenticated, refetchTask]);

  const onVerdict = useCallback((verdict: CodingVerdictResponse, submittedCode?: string) => {
    setCompletedTask(verdict.verdict === 'passed' && !verdict.graderUnavailable ? taskId ?? null : null);
    if (verdict.progress) void queryClient.invalidateQueries({ queryKey: codingKeys.progress() });
    // An accepted order comes back as "passed" about the arrangement. The task
    // itself stays open for the code (the server records no progress), so it
    // neither moves a challenge run on nor lets go of the draft.
    const passed = verdict.verdict === 'passed' && !verdict.puzzle;
    if (passed && activeRun && runIndex >= 0 && runIndex >= activeRun.position) {
      const position = runIndex + 1;
      advanceRun.mutate({ sessionId: activeRun.sessionId, position, ...(position >= activeRun.queue.length ? { status: 'finished' as const } : {}) });
    }
    if (passed && taskId) {
      const stage = evolvingStage(taskId);
      if (stage) {
        // Capture the submitted snapshot synchronously, before Next can navigate
        // and before the account save started by Submit settles. Never seed
        // over a next-stage draft.
        if (submittedCode !== undefined) keepDeviceDraft(taskId, submittedCode, draftBase, draftEpoch);
        if (stage.next) queryClient.removeQueries({queryKey:codingKeys.task(stage.next), exact:true, type:'inactive'});
      } else forgetDeviceDraft(taskId, draftEpoch);
    }
    // An evolving stage's Submit stored its code as the stage draft: the next
    // save from here builds on that time.
    if (taskId && verdict.draftUpdatedAt) draftStoredBySubmit(taskId, verdict.draftUpdatedAt, draftEpoch);
  }, [queryClient, taskId, activeRun, runIndex, advanceRun, draftBase, draftEpoch]);

  const onRetry = useCallback(() => {
    if (workbench.reloading) return;
    void task.refetch();
    setAttempt((n) => n + 1);
  }, [task, workbench.reloading]);

  // One loading state until the task and its editor are both in.
  if (task.isLoading || (!task.isError && !workbench.View && !workbench.failed)) {
    return <LoadingScreen label={t('coding.loading')} />;
  }
  // Premium opens this task and the account holds the free plan. The API
  // client already opened the upgrade sheet; the page says the same thing in
  // words, and keeps a way back that does not depend on the sheet.
  if (task.isError && isPremiumRequired(task.error)) {
    return (
      <div className="cd-page">
        <header>
          <Kicker><Link className="cd-link" to={`/coding/${track}`}>{t(`coding.track.${track}` as never)}</Link></Kicker>
          <h1>{t('premium.taskTitle')}</h1>
        </header>
        <p className="cd-lead">{t('premium.taskBody')}</p>
        <div className="cd-actions">
          <Button variant="primary" onClick={() => askForPremium(taskId)} label={t('profile.plan.see')} />
          <Button variant="secondary" as={Link} href={`/coding/${track}`} label={t('coding.verdict.back')} />
        </div>
      </div>
    );
  }
  // An id the catalogue does not hold, or no longer does. The task screen
  // shows no workbench and no retry: asking again gives the same answer.
  if (task.isError && task.error instanceof ApiError && (task.error.status === 404 || task.error.status === 410)) {
    return <CodingNotFound what={task.error.status === 410 ? 'retired' : 'task'} track={track} />;
  }
  const CodingWorkbench = workbench.View;
  if (task.isError || !task.data || !CodingWorkbench) {
    if (learnSession && task.error instanceof ApiError && ['invalid_session', 'session_owner_mismatch'].includes(task.error.code ?? '')) return <div className="cd-page">
      <p className="cd-note cd-note--error" role="alert">{friendlyError(task.error)}</p>
      <Button as={Link} href="/learn" variant="secondary" label={t('coding.lesson.backToLearn')} />
    </div>;
    return (
      <div className="cd-page">
        <p className="cd-note cd-note--error" role="alert">{t('coding.loadError')}</p>
        <div className="cd-actions">
          {/* Busy but focusable while the press reloads the page. */}
          <Button variant="primary" onClick={onRetry} isLoading={workbench.reloading} isInterruptible label={t('coding.retry')} />
          <Button variant="secondary" as={Link} href={`/coding/${track}`} label={t('coding.verdict.back')} />
        </div>
      </div>
    );
  }
  const data = task.data;
  const stage = evolvingStage(data.task.id);
  const trackTasks = SECTION_INDEX.filter((one) => one.track === data.task.track);
  const next = nextOpenTask(trackTasks, statusOf, data.task.id);
  const runNext = runIndex >= 0 && activeRun ? activeRun.queue[runIndex + 1] ?? null : null;
  const nextHref = runIndex >= 0
    ? runNext ? taskHref(runNext) : '/coding'
    : stage
      ? stage.next ? `/coding/${evolvingTaskTrack(stage.next)}/${stage.next}` : null
      : next && next.id !== data.task.id ? `/coding/${next.track}/${next.id}` : null;
  const backHref = stage?.challenge.category === 'fullstack' ? '/coding/fullstack' : stage?.challenge.category === 'debugging' ? '/coding' : `/coding/${data.task.track}`;
  const previousLocal = stage?.previous ? deviceDraft(stage.previous) : null;
  const initialCode = (refreshDraft?.taskId === taskId && refreshDraft.epoch === accountEpoch() ? refreshDraft.code : null) ?? choice.code ?? (stage && previousLocal !== null
    ? prepareEvolvingDraft(previousLocal, stage.challenge, stage.index)
    : null);

  return (
    <div className="cd-page ss-pop">
      {/* Rendered only when it has something to say: an empty row would still
          take a gap in the page's column and push the brief down for nothing. */}
      {completedTask !== taskId && (stage || (runIndex >= 0 && activeRun)) && <div className="cd-actions">
        {stage && <span>{stage.challenge.title} — {t(stage.challenge.short ? 'coding.evolving.level' : 'coding.evolving.stage', { n: stage.index + 1, total: stage.challenge.stages.length })}</span>}
        {runIndex >= 0 && activeRun && <Link className="cd-link" to="/coding">{t('coding.run.stage', { n: runIndex + 1, total: activeRun.queue.length })}</Link>}
      </div>}
      {/* A list that did not load offers to load it again; a star that did
          not save says so, and the star itself is the way to try again. */}
      {completedTask !== taskId && bookmarks.isError && <p role="alert" className="cd-note cd-note--error">{t('coding.saved.loadFailed')} <Button variant="secondary" onClick={() => void bookmarks.refetch()} label={t('coding.retry')} /></p>}
      {completedTask !== taskId && save.isError && <p role="alert" className="cd-note cd-note--error">{t('coding.collections.failed')}</p>}
      {completedTask !== taskId && <DraftNote choice={choice} />}
      {completedTask !== taskId && stage && stage.challenge.stages.some((id) => isBarred(premiumOf(id))) && (
        <PremiumStagesNote stages={stage.challenge.stages} short={stage.challenge.short === true} />
      )}
      {completedTask !== taskId && stage && <StageNav stages={stage.challenge.stages} short={stage.challenge.short === true} currentId={data.task.id} passed={passedIds} premiumOf={premiumOf} />}
      {CodingWorkbench && <CodingWorkbench
            key={`${data.task.id}-${attempt}-${choice.version}-${data.signedIn}`}
            task={data.task}
            session={data.session}
            locked={data.locked}
            signedIn={data.signedIn}
            progress={data.progress}
            initialCode={initialCode}
            mode="section"
            onDraft={onDraft}
            onEdit={onEdit}
            onVerdict={onVerdict}
            onRefreshTask={async (code) => {
              keepDeviceDraft(data.task.id, code, draftBase, draftEpoch);
              setRefreshDraft({ taskId: data.task.id, code, epoch: accountEpoch() });
              const refreshed = await task.refetch();
              if (refreshed.error) throw refreshed.error;
            }}
            nextHref={nextHref}
            backHref={backHref}
            // The star sits with the workbench's own utilities, beside the
            // report flag, rather than floating above the brief.
            saveAction={isAuthenticated && !data.locked && premiumOf(data.task.id) === 'open' && (
              <SaveButton
                toolbar
                taskId={data.task.id}
                saved={bookmarks.data?.saved.includes(data.task.id) ?? false}
                busy={bookmarks.isPending || bookmarks.isError || save.isPending}
                onToggle={(saved) => save.mutate({ op: 'save', taskId: data.task.id, saved })}
              />
            )}
          />}
    </div>
  );
}

/* ── /coding/review ──────────────────────────────────────────────────── */
export function CodingReviewScreen() {
  return <Navigate to="/coding" replace />;
}
