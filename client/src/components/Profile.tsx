import { createContext, Suspense, useContext, useEffect, useId, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Kicker } from './landing/LandingKit';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Avatar } from '@astryxdesign/core/Avatar';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Banner } from '@astryxdesign/core/Banner';
import { AppToast } from './ui/AppToast';
import type { UserStats } from '../lib/supabase';
import { useProfileStats } from '../lib/queries';
import { useRoadmapProgress, syncProgressWithServer } from '../lib/roadmap';
import { useTrack, rankLabelKeyFor } from '../lib/tracks';
import LearningPathsCard from './paths/LearningPathsCard';
import { useQuestXp, syncXpWithServer } from '../lib/xp';
import { computeLearningXp, levelForXp, MAX_RANK } from '../lib/leveling';
import { useAuth, getUserProfile } from '../lib/auth';
import { apiFetch, friendlyError } from '../lib/api';
import { useBookmarks, removeBookmark } from '../lib/bookmarks';
import { getStreakProtection, activateShield, streakState, shieldRemaining, type StreakProtection } from '../lib/streakFreezes';
import { DayChangeNote } from './DayChangeNote';
import { getAdvice, advisorCategoryKey, type Advice } from '../lib/advisor';
import { renderQuestion } from './CodeBlock';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { useEquippedRingColor, useEquippedFlair } from '../lib/shop';
import { useActiveSubject, topicSetForSubject } from '../lib/subjects';
// The friends tab keeps its code out of the profile until it opens, with a
// boundary of its own: when that code does not load, the tab says so with a
// Retry and the rest of the profile stays.
const FriendsPanel = lazyShellPart(() => import('./FriendsPanel'));
import LoadingScreen from './LoadingScreen';
import ErrorRetry from './ErrorRetry';
import { ShellPartBoundary } from './ShellPartBoundary';
import { lazyShellPart } from '../lib/routeRecovery';
import { ShieldIcon, TrophyIcon, TargetIcon } from './ui/icons';
import { BrandedConfirmDialog, type ConfirmRequest } from './ui/BrandedConfirmDialog';
import { GithubGardenCard } from './coding/GithubGardenCard';
import PlanLine from './PlanLine';
import { leaderboardVisibilityQuery } from '../lib/leaderboardVisibility';
import SharknameCard from './SharknameCard';
import { useEntitlement } from '../lib/entitlement';
import { clearAccountData } from '../lib/accountData';
import { useGithubConnection } from '../coding/api';
import './DeepEndScreens.css';

// Section opener in the brand's editorial voice: uppercase accent kicker with
// the waterline tick beneath (the "dive marker" that starts every section).
function SectionLabel({ children }: { children: ReactNode }) {
  return <Kicker as="h2">{children}</Kicker>;
}

// Reads the cards need, started with the stats read while the page waits
// for it, so no card is a round trip behind the stats. The first card to ask
// takes its read; a card that mounts again (back from the Friends tab) reads
// afresh.
interface EarlyReads {
  protection?: Promise<StreakProtection>;
  advice?: { subject: string; read: Promise<Advice> };
}
const EarlyReadsContext = createContext<MutableRefObject<EarlyReads> | null>(null);

function takeProtectionRead(early: MutableRefObject<EarlyReads> | null): Promise<StreakProtection> {
  const read = early?.current.protection;
  if (early) early.current.protection = undefined;
  return read ?? getStreakProtection();
}

function takeAdviceRead(early: MutableRefObject<EarlyReads> | null, subject: Parameters<typeof getAdvice>[0]): Promise<Advice> {
  const held = early?.current.advice;
  if (early) early.current.advice = undefined;
  return held && held.subject === subject ? held.read : getAdvice(subject);
}

function Profile() {
  const t = useT();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const profile = getUserProfile(user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const subjectId = useActiveSubject().id;
  const early = useRef<EarlyReads>({});

  // Redirect signed-out visitors home once auth has resolved.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/', { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  const enabled = isAuthenticated && !!user?.id;
  const statsQuery = useProfileStats(
    user?.id,
    { email: profile.email, name: profile.name, picture: profile.picture },
    enabled,
  );
  const stats: UserStats | null = statsQuery.data ?? null;
  const loading = authLoading || (enabled && statsQuery.isPending);
  const error = statsQuery.error ? friendlyError(statsQuery.error) : null;

  // Only while the page waits: with the stats already cached the cards draw
  // at once and read for themselves.
  const waiting = enabled && statsQuery.isPending;
  const userId = user?.id;
  useEffect(() => {
    if (!waiting || !userId) return;
    early.current = { protection: getStreakProtection(), advice: { subject: subjectId, read: getAdvice(subjectId) } };
    void queryClient.prefetchQuery(leaderboardVisibilityQuery(userId));
  }, [waiting, userId, subjectId, queryClient]);

  if (authLoading || loading) {
    return <LoadingScreen label={t('profile.loading')} />;
  }

  if (!isAuthenticated || !user) {
    return (
      <div role="status" style={{ textAlign: 'center', marginTop: '3rem' }}>
        <Text type="supporting" color="secondary">
          {t('profile.redirecting')}
        </Text>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="de-page">
        <VStack gap={2}>
          <Heading level={1}>{t('nav.profile')}</Heading>
          <StreakCard stats={null} unavailable />
          <ErrorRetry message={error} onRetry={() => statsQuery.refetch()} />
        </VStack>
      </div>
    );
  }

  const totalQuizzes = stats?.total_quizzes ?? 0;
  const totalCorrect = stats?.total_correct ?? 0;
  const totalQuestions = stats?.total_questions ?? 0;
  const averageScore =
    stats && stats.total_questions > 0
      ? Math.round((stats.total_correct / stats.total_questions) * 100)
      : 0;
  return (
    <EarlyReadsContext.Provider value={early}>
    <ProfileBody
      user={profile}
      stats={stats}
      totalQuizzes={totalQuizzes}
      totalCorrect={totalCorrect}
      totalQuestions={totalQuestions}
      averageScore={averageScore}
      statsWarning={error}
      onRetryStats={() => statsQuery.refetch()}
    />
    </EarlyReadsContext.Provider>
  );
}

interface ProfileBodyProps {
  user: { name?: string; email?: string; picture?: string };
  stats: UserStats | null;
  totalQuizzes: number;
  totalCorrect: number;
  totalQuestions: number;
  averageScore: number;
  statsWarning: string | null;
  onRetryStats: () => void;
}

function ProfileBody({
  user,
  stats,
  totalQuizzes,
  totalCorrect,
  totalQuestions,
  averageScore,
  statsWarning,
  onRetryStats,
}: ProfileBodyProps) {
  const t = useT();
  const ringColor = useEquippedRingColor();
  const flair = useEquippedFlair();
  const { questions: bookmarkedQuestions } = useBookmarks();
  const [tab, setTab] = useState<'overview' | 'friends'>('overview');
  // An account made with an email and password has no name from Google: the
  // heading falls back to the address's first part, never to an empty h1.
  const shownName = user.name || user.email?.split('@')[0] || t('auth.account');
  // The Friends tab's "Change sharkname" opens the Overview at the card.
  const [focusSharkname, setFocusSharkname] = useState(false);

  return (
    <div className="de-page">
      <VStack gap={2}>
        {/* Identity header — subject-accented top edge, avatar and name, then
            the plan in one row. Appearance and sound live in the footer on
            every route, so the banner does not repeat them next to the name
            (UX audit social-account-08). */}
        <div className="ss-raised ss-pop" style={{ display: 'flex', width: '100%' }}>
          <div className="de-profile-identity" style={{ borderTop: '4px solid var(--brand-accent)', borderRadius: 'var(--radius-container)', width: '100%', position: 'relative', overflow: 'hidden' }}>
            <Card variant="default" padding={4} width="100%">
              <div className="de-profile-identity__row">
                <HStack gap={2} align="center">
                  <div
                    style={{
                      flexShrink: 0,
                      borderRadius: '50%',
                      display: 'inline-flex',
                      ...(ringColor
                        ? { padding: 3, background: `${ringColor}33`, boxShadow: `0 0 0 2px ${ringColor}` }
                        : null),
                    }}
                  >
                    <Avatar src={user.picture} name={shownName} alt="" size={64} />
                  </div>
                  {/* min-width 0 lets a long name or email ellipsise inside
                      the card instead of running past it. */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="de-profile-identity__text">
                      <Heading level={1} maxLines={1}>
                        {flair ? `${flair} ` : ''}{shownName}
                      </Heading>
                      <Text type="supporting" color="secondary" maxLines={1}>
                        {user.email}
                      </Text>
                    </div>
                  </div>
                </HStack>
              </div>
              <PlanLine />
            </Card>
          </div>
        </div>

        {/* Two tabs. The overview is everything the profile has always been;
            Friends is the only thing on this page about anybody else, so it
            gets its own space rather than becoming a ninth card. */}
        {/* A tab list as the ARIA pattern has it: one Tab stop, the arrow
            keys (and Home and End) move between the two tabs. */}
        <div
          className="de-tabs"
          role="tablist"
          aria-label={t('nav.profile')}
          onKeyDown={(event) => {
            const next = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
              ? (tab === 'overview' ? 'friends' : 'overview')
              : event.key === 'Home' ? 'overview' : event.key === 'End' ? 'friends' : null;
            if (!next) return;
            event.preventDefault();
            setTab(next);
            document.getElementById(`profile-tab-${next}`)?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="profile-tab-overview"
            aria-selected={tab === 'overview'}
            aria-controls="profile-panel-overview"
            tabIndex={tab === 'overview' ? 0 : -1}
            className="de-tab"
            onClick={() => setTab('overview')}
          >
            {t('friends.tabOverview')}
          </button>
          <button
            type="button"
            role="tab"
            id="profile-tab-friends"
            aria-selected={tab === 'friends'}
            aria-controls="profile-panel-friends"
            tabIndex={tab === 'friends' ? 0 : -1}
            className="de-tab"
            onClick={() => setTab('friends')}
          >
            {t('friends.tabFriends')}
          </button>
        </div>

        {tab === 'friends' && (
          <div role="tabpanel" id="profile-panel-friends" aria-labelledby="profile-tab-friends">
            <Suspense fallback={null}>
              <ShellPartBoundary fallback={(retry, busy) => <ErrorRetry message={t('friends.loadFailed')} onRetry={retry} busy={busy} />}>
                <FriendsPanel onEditSharkname={() => { setTab('overview'); setFocusSharkname(true); }} />
              </ShellPartBoundary>
            </Suspense>
          </div>
        )}

        {tab === 'overview' && (<div role="tabpanel" id="profile-panel-overview" aria-labelledby="profile-tab-overview"><VStack gap={2}>

        {statsWarning && (
          <Banner
            status="warning"
            title={t('profile.statsRefreshFailed')}
            description={statsWarning}
            endContent={<Button variant="ghost" size="sm" label={t('quiz.retry')} onClick={onRetryStats} />}
          />
        )}

        {/* Keep the streak in the first scan path for both products, including
            a useful zero state. It must not be buried below track/stat cards. */}
        <StreakCard stats={stats} />

        {/* Natural-height columns group study/account settings separately from
            progress and identity. Keep Track → Account adjacent in the DOM. */}
        <Grid columns={{ minWidth: 360, max: 2 }} gap={2} align="start" width="100%">
          <div className="de-profile-column" data-column="learning">
          <VStack gap={2}>
            {/* One card owns the track: the paths card, which carries the
                joined Learn sections, the specialization and the picker. */}
            <LearningPathsCard />

            <AccountDeletionCard />
            <AdvisorCard />
          </VStack>
          </div>

          <div className="de-profile-column" data-column="account">
          <VStack gap={2}>
            <CareerCard
              totals={{ quizzes: totalQuizzes, questions: totalQuestions, correct: totalCorrect, average: averageScore }}
            />

            <SharknameCard focus={focusSharkname} onFocused={() => setFocusSharkname(false)} />
            <GithubGardenCard />

            {bookmarkedQuestions.length > 0 && (
              <div className="ss-panel" style={{ padding: 24, width: '100%' }}>
                <VStack gap={2}>
                  <SectionLabel>{t('profile.bookmarks', { count: bookmarkedQuestions.length })}</SectionLabel>
                  <VStack gap={1.5}>
                    {bookmarkedQuestions.slice(0, 20).map((q) => (
                      <Card key={q.id} variant="muted" padding={2}>
                        <VStack gap={1}>
                          <div style={{ fontSize: 'var(--ss-type-compact)' }}>{renderQuestion(q.question)}</div>
                          <Text type="supporting" size="xsm" color="accent">
                            {t('profile.answerLabel', { answer: q.options[q.correctIndex] ?? '-' })}
                          </Text>
                          {q.explanation && (
                            <Text type="supporting" size="xsm" color="secondary">
                              {q.explanation}
                            </Text>
                          )}
                          <HStack justify="end">
                            <Button variant="ghost" size="sm" label={t('common.remove')} onClick={() => removeBookmark(q.id)} />
                          </HStack>
                        </VStack>
                      </Card>
                    ))}
                    {bookmarkedQuestions.length > 20 && (
                      <Text type="supporting" size="xsm" color="secondary">
                        {t('profile.showingOf', { total: bookmarkedQuestions.length })}
                      </Text>
                    )}
                  </VStack>
                </VStack>
              </div>
            )}

          </VStack>
          </div>
        </Grid>
        </VStack></div>)}
      </VStack>
    </div>
  );
}

export function StreakCard({
  stats,
  unavailable = false,
}: {
  stats: UserStats | null;
  unavailable?: boolean;
}) {
  const { t } = useLanguage();
  const currentLabelId = useId();
  const longestLabelId = useId();
  // The shield and the count read one protection state, so a streak that a
  // shield or a protection still covers shows its days rather than 0.
  const [protection, setProtection] = useState<StreakProtection | null>(null);
  const early = useContext(EarlyReadsContext);
  useEffect(() => {
    if (unavailable) return;
    let active = true;
    takeProtectionRead(early).then((next) => { if (active) setProtection(next); });
    return () => { active = false; };
  }, [unavailable, early]);
  // A failed read leaves the shields and protections unknown. A streak whose
  // last day was today or yesterday needs neither; any other is shown as
  // unknown rather than as the 0 the no-protection rule would give.
  const { streak: currentStreak, missed } = streakState(stats, protection?.failed ? null : protection);
  const streakUnknown = protection?.failed === true && missed > 0;
  const longestStreak = stats?.longest_streak ?? 0;
  const currentStreakDisplay = unavailable || streakUnknown ? '—' : currentStreak;
  const longestStreakDisplay = unavailable ? '—' : longestStreak;
  const dayUnit = (value: number) => t(value === 1 ? 'profile.day' : 'profile.days');

  return (
    <div className="ss-panel" style={{ padding: 24, width: '100%' }}>
        <VStack gap={2}>
          <SectionLabel>{t('profile.streaks')}</SectionLabel>

          {/* Side by side down to a 320px phone: each tile holds a figure
              and a two-word label, so at 390 the pair takes one 96px row
              instead of two (UX audit social-account-18). */}
          <Grid columns={{ minWidth: 120, max: 2 }} gap={2}>
            <div role="group" aria-labelledby={currentLabelId} style={{ display: 'flex', width: '100%' }}>
              <Card variant="muted" padding={1.5} width="100%">
                <VStack gap={0.5} align="center">
                  {/* "4 days": the number and its unit on one line. */}
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                    <Text
                      size="2xl"
                      weight="bold"
                      aria-label={unavailable || streakUnknown ? t('profile.streakValueUnavailable') : undefined}
                    >
                      {currentStreakDisplay}
                    </Text>
                    {!unavailable && !streakUnknown && <Text type="supporting" color="secondary">{dayUnit(currentStreak)}</Text>}
                  </span>
                  <Text id={currentLabelId} type="supporting" color="primary" weight="semibold" justify="center">
                    {t('profile.currentStreak')}
                  </Text>
                </VStack>
              </Card>
            </div>

            <div role="group" aria-labelledby={longestLabelId} style={{ display: 'flex', width: '100%' }}>
              <Card variant="muted" padding={1.5} width="100%">
                <VStack gap={0.5} align="center">
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                    <Text
                      size="2xl"
                      weight="bold"
                      aria-label={unavailable ? t('profile.streakValueUnavailable') : undefined}
                    >
                      {longestStreakDisplay}
                    </Text>
                    {!unavailable && <Text type="supporting" color="secondary">{dayUnit(longestStreak)}</Text>}
                  </span>
                  <Text id={longestLabelId} type="supporting" color="primary" weight="semibold" justify="center">
                    {t('profile.longestStreak')}
                  </Text>
                </VStack>
              </Card>
            </div>
          </Grid>

          {/* Protection sits under the pair, full width, so both tiles are
              sized to their figures (UX audit social-account-17). It used to
              be a card of its own, then a button inside the current tile,
              which stretched the longest-streak tile beside it. */}
          {!unavailable && <StreakShield state={protection} streak={currentStreak} missed={missed} onChange={setProtection} />}

          {unavailable ? (
            <Text type="supporting" size="xsm" color="secondary" justify="center">
              {t('profile.streakUnavailable')}
            </Text>
          ) : (
            // What makes a streak day, and when a day ends here: the server
            // counts UTC days, which rarely end at the learner's midnight.
            <VStack gap={0.5} align="center">
              <Text type="supporting" size="xsm" color="secondary" justify="center">
                {t('profile.streakRule')}
              </Text>
              <DayChangeNote justify="center" />
            </VStack>
          )}
        </VStack>
      </div>
  );
}

/**
 * The shield: spend one of the month's two protections and today and tomorrow
 * (UTC dates) count as streak days.
 *
 * Three states and nothing else. A shield is running (a countdown to the end
 * of tomorrow, in whole hours and minutes, read once on load — a live clock on
 * a window of up to two days is decoration). A protection is available (the
 * button). The month's two are spent (a line saying when the next arrive).
 * Everything is server-owned: the budget, the spend and the expiry, so a
 * client cannot grant itself either.
 *
 * It renders nothing at all until the read lands, and nothing if the server
 * cannot offer it yet, so the streak card never shows a control that would
 * fail. The streak card reads the state once, on mount, and shares it with the
 * count: the window lasts at most two days, and re-reading it while the page
 * sits open would tell the learner nothing they cannot get by reloading.
 *
 * Without a live streak there is nothing to protect, so the button is not
 * offered: it would spend one of the month's two for nothing. Nor is it when a
 * missed day still needs the protection the shield would take: spending it
 * would end the streak the moment the learner came back, so the card says to
 * learn today instead, as the server does when asked anyway (409
 * shield_would_end_streak). A shield that is already running still shows.
 */
function StreakShield({
  state,
  streak,
  missed,
  onChange,
}: {
  state: StreakProtection | null;
  /** The live streak, as the card shows it. */
  streak: number;
  /** Days missed since the last learning day that no shield covered. */
  missed: number;
  onChange: (next: StreakProtection) => void;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());

  if (!state || !state.shieldSupported) return null;

  // One labelled group under the two tiles, whichever state it shows.
  const row = (children: ReactNode) => (
    <div className="de-streak-protect" role="group" aria-label={t('shop.protectionName')}>{children}</div>
  );

  const left = shieldRemaining(state.shieldUntil, now);
  if (left) {
    return row(
      <span className="de-shield de-shield--on">
        <ShieldIcon size={16} />
        {t('profile.shieldActive', { h: left.hours, m: left.minutes })}
      </span>,
    );
  }

  if (state.remaining <= 0) {
    return row(
      <span className="de-shield de-shield--spent">
        <ShieldIcon size={16} />
        {t('profile.shieldNone')}
      </span>,
    );
  }

  if (streak <= 0) return null;

  if (state.remaining - 1 < missed) {
    return row(<span className="de-shield__meta">{t('profile.shieldLearnToday')}</span>);
  }

  const spend = async () => {
    setPending(true);
    setError(null);
    try {
      onChange(await activateShield());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  return row(
    <>
      <button type="button" className="de-shield de-shield--action" onClick={spend} disabled={pending}>
        <ShieldIcon size={16} />
        {pending ? t('profile.shieldSpending') : t('profile.shieldAction')}
      </button>
      <span className="de-shield__meta">{t('profile.shieldLeft', { n: state.remaining })}</span>
      {error && <span className="de-shield__meta de-shield__meta--error" role="alert">{error}</span>}
    </>,
  );
}

// Career level card: the learner's rank (derived from total XP = learning XP +
// quest XP), with a progress bar toward the next rank, and the four quiz
// figures in one neutral row (design audit P1.5). Pulls account XP on mount
// so it stays in sync even if the user hasn't visited the learning path.
function CareerCard({ totals }: { totals: { quizzes: number; questions: number; correct: number; average: number } }) {
  const t = useT();
  const progress = useRoadmapProgress();
  const questXp = useQuestXp();
  const [syncWarning, setSyncWarning] = useState(false);

  // These independent subject-scoped reads can run together. Keep the current
  // local snapshot useful if either service is temporarily unavailable.
  useEffect(() => {
    let active = true;
    Promise.all([syncProgressWithServer(), syncXpWithServer()])
      .then(() => { if (active) setSyncWarning(false); })
      .catch(() => { if (active) setSyncWarning(true); });
    return () => { active = false; };
  }, []);

  const [track] = useTrack();
  // XP and rank are per subject: only the active subject's roadmap progress
  // and quest accumulator count here.
  const subject = useActiveSubject();
  const learningXp = computeLearningXp(progress, topicSetForSubject(subject.id));
  const totalXp = learningXp + questXp;
  const info = levelForXp(totalXp);
  // Subject-aware rank label ("Junior Full-Stack Developer" for Web Dev,
  // "Junior Explorer" for Geography, "Club Player" for Chess, …), localized.
  const rankKeys = rankLabelKeyFor(info.rank, track);
  const title = t(rankKeys.key, rankKeys.vars);
  const nextKeys = info.next ? rankLabelKeyFor(info.next, track) : null;
  const nextTitle = nextKeys ? t(nextKeys.key, nextKeys.vars) : null;
  const nf = (n: number) => n.toLocaleString();
  const nextLabel = info.isMax
    ? t('profile.maxRank')
    : t('profile.xpToNext', { xp: nf(info.xpToNext), title: nextTitle ?? '' });

  return (
    <div className="ss-panel" style={{ padding: 24, width: '100%' }}>
      <VStack gap={2}>
        <SectionLabel>{t('profile.career')}</SectionLabel>
        {syncWarning && <Banner status="warning" title={t('profile.syncUnavailable')} />}

        {/* One row at every width (UX audit social-account-18): the rank
            title takes what is left and wraps to two lines, the XP figure keeps
            its width beside it. Below 480px the decorative rank tile steps out
            so the title keeps its room. */}
        <div className="de-career-head">
          {/* The learner's earned rank icon (data, not chrome) in a quiet tile. */}
          <div
            aria-hidden
            className="ss-tile de-career-head__tile"
            style={{
              width: 52,
              height: 52,
              fontSize: '1.75rem',
              background: 'var(--brand-accent-soft, rgba(0,0,0,0.05))',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--brand-accent) 35%, transparent)',
            }}
          >
            <TrophyIcon size={24} />
          </div>
          <div className="de-career-head__title">
            <Heading level={3} maxLines={2}>{title}</Heading>
            <Text type="supporting" size="xsm" color="secondary">
              {t('profile.careerLevelOf', { level: info.level, max: MAX_RANK })}
            </Text>
          </div>
          <span className="de-career-head__xp">
            <Text size="xl" weight="bold" color="accent">{nf(totalXp)}</Text>
            <Text type="supporting" color="secondary">{t('profile.xpUnit')}</Text>
          </span>
        </div>

        <VStack gap={1}>
          <ProgressBar
            label={nextLabel}
            value={info.progressPct}
            isLabelHidden
          />
          <Text type="supporting" size="xsm" color="secondary" weight="semibold">
            {nextLabel}
          </Text>
        </VStack>

        {/* Two by two: the card's column is too narrow for four abreast, and
            three plus one reads as a mistake. */}
        <Grid columns={{ minWidth: 120, max: 2 }} gap={1.5}>
          <StatTile label={t('profile.quizzesCompleted')} value={nf(totals.quizzes)} />
          <StatTile label={t('profile.questionsAnswered')} value={nf(totals.questions)} />
          <StatTile label={t('profile.correctAnswers')} value={nf(totals.correct)} />
          <StatTile label={t('profile.averageScore')} value={`${totals.average}%`} />
        </Grid>
      </VStack>
    </div>
  );
}

function AdvisorCard() {
  const t = useT();
  const subject = useActiveSubject();
  const [advice, setAdvice] = useState<Advice | null>(null);
  const early = useContext(EarlyReadsContext);

  useEffect(() => {
    let active = true;
    setAdvice(null);
    takeAdviceRead(early, subject.id).then((a) => { if (active) setAdvice(a); });
    return () => { active = false; };
  }, [subject.id, early]);

  const hasData = !!advice && advice.weakAreas.length > 0;

  return (
    <div className="ss-panel" style={{ padding: 24, width: '100%' }}>
        <VStack gap={2}>
          <HStack gap={1.5} align="center">
            <div aria-hidden className="ss-tile" style={{ width: 40, height: 40, color: 'var(--brand-accent-on-soft)', background: 'var(--brand-accent-soft)' }}>
              <TargetIcon size={20} />
            </div>
            <VStack gap={0}>
              <SectionLabel>{t('advisor.title')}</SectionLabel>
              <Text type="supporting" size="xsm" color="secondary">{t('advisor.subtitle')}</Text>
            </VStack>
          </HStack>

          {!advice ? (
            <div role="status" aria-live="polite" style={{ padding: '6px 0' }}>
              <Text type="supporting" size="xsm" color="secondary">{t('advisor.loading')}</Text>
            </div>
          ) : !hasData ? (
            <div style={{ padding: '2px 0' }}>
              <Text weight="semibold">{t('advisor.empty')}</Text>
              <Text type="supporting" size="xsm" color="secondary" display="block">{t('advisor.emptyBody')}</Text>
            </div>
          ) : (
            <VStack gap={1}>
              <Text weight="semibold">{t('advisor.weakest')}</Text>
              {advice.weakAreas.map((w) => (
                <div key={w.category}>
                  <HStack justify="between" align="center" gap={1} wrap="wrap">
                    <Text weight="semibold" size="sm">{t(advisorCategoryKey(w.category))}</Text>
                    <Text type="supporting" size="xsm" color="secondary">
                      {t('advisor.accuracy', { pct: w.accuracyPct })} · {t('advisor.answered', { n: w.answered })}
                    </Text>
                  </HStack>
                  <div aria-hidden style={{ marginTop: 4, height: 6, borderRadius: 999, background: 'var(--color-background-muted)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, w.accuracyPct))}%`, height: '100%', background: 'var(--brand-accent)', borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </VStack>
          )}
        </VStack>
      </div>
  );
}

export function AccountDeletionCard() {
  const t = useT();
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();
  const plan = useEntitlement();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  // Log out in the account menu ends this browser's session only; this ends
  // every session of the account, this one included.
  const signOutEverywhere = () => {
    setSigningOut(true);
    void signOut('global')
      .catch(() => setMessage(t('auth.signOutFailed')))
      .finally(() => setSigningOut(false));
  };
  // Deleting the account ends a paid subscription at once and refunds nothing,
  // so the card and the dialog say so, with the way to a refund while it
  // still exists (review finding product-4).
  const paying = plan.data?.subscriptionLive === true || (plan.tier === 'premium' && plan.data?.source === 'provider');
  // Deleting the account does not uninstall the GitHub app: say so to anyone
  // who installed it. The garden card beside this one reads the same query.
  const github = useGithubConnection(isAuthenticated).data;
  const githubInstalled = github?.available === true && github.status !== 'not_connected';

  const requestDeletion = () => {
    setConfirm({
      title: t('profile.deleteTitle'),
      description: [
        t('profile.deleteConfirm'),
        githubInstalled ? t('profile.deleteGithub') : null,
        paying ? t('profile.deletePremium') : null,
      ].filter(Boolean).join(' '),
      actionLabel: t('profile.deleteAction'),
      destructive: true,
      onConfirm: async () => {
        try {
          await apiFetch<{ ok: true }>('/api/user/delete-account', {
            method: 'DELETE',
            body: JSON.stringify({ confirmation: 'DELETE' }),
            timeoutMs: 20_000,
          });
          clearAccountData();
          await signOut().catch(() => undefined);
          navigate('/', { replace: true });
        } catch (error) {
          setMessage(friendlyError(error));
        }
      },
    });
  };

  return (
    <>
      {/* Settings rows (UX audit social-account-07): one row per action, its
          title and a short description on the left and its 44px button on the
          right; stacked below 600px. The row title names what the action
          reaches, so it does not repeat the button. Plain panel stock, like
          every other Profile card. */}
      <div className="ss-panel" style={{ padding: 24, width: '100%' }}>
        <VStack gap={2}>
          <SectionLabel>{t('profile.account')}</SectionLabel>
          <div className="de-setting-row">
            <div className="de-setting-row__text">
              <h3 className="de-setting-row__title">{t('profile.allDevices')}</h3>
              <Text type="supporting" size="xsm" color="secondary">{t('profile.signOutEverywhereDescription')}</Text>
            </div>
            <Button
              variant="secondary"
              label={t('profile.signOutEverywhere')}
              isDisabled={!isAuthenticated || signingOut}
              onClick={signOutEverywhere}
            />
          </div>
          <div className="de-setting-row">
            <div className="de-setting-row__text">
              <h3 className="de-setting-row__title">{t('profile.deleteTitle')}</h3>
              <Text type="supporting" size="xsm" color="secondary">{t('profile.deleteDescription')}</Text>
              {paying && (
                <Text type="supporting" size="xsm">
                  {t('profile.deletePremium')}{' '}
                  <Link to="/premium/cancel?action=withdraw">{t('legal.link.cancel')}</Link>
                </Text>
              )}
            </div>
            <Button variant="destructive" label={t('profile.deleteAction')} onClick={requestDeletion} />
          </div>
        </VStack>
      </div>
      <BrandedConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      <AppToast open={!!message} message={message} onClose={() => setMessage(null)} severity="error" autoHideDuration={null} />
    </>
  );
}

// One neutral figure: every tile the same muted surface, whatever the value.
const StatTile = ({ label, value }: { label: string; value: number | string }) => (
  <div style={{ display: 'flex', width: '100%' }}>
    <Card variant="muted" padding={2} width="100%">
      <VStack gap={0.5}>
        <Text size="lg" weight="bold" style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Text>
        <Text type="supporting" size="xsm" color="primary" weight="semibold">{label}</Text>
      </VStack>
    </Card>
  </div>
);

export default Profile;
