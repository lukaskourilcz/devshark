import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Kicker, SwimCta } from './landing/LandingKit';
import { useNavigate, useParams } from 'react-router-dom';
import { useIsMobile, useMediaQuery } from '../lib/useMediaQuery';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Badge } from '@astryxdesign/core/Badge';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Banner } from '@astryxdesign/core/Banner';
import { Divider } from '@astryxdesign/core/Divider';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { TextInput } from '@astryxdesign/core/TextInput';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { ToggleButtonGroup } from '@astryxdesign/core/ToggleButton';
import { useAuth, getUserProfile } from '../lib/auth';
import {
  createMatch,
  joinMatch,
  fetchMatchState,
  controlMatch,
  submitMatchAnswer,
  fetchDistribution,
  sendHeartbeat,
  questionCountOf,
  serverClockOffset,
  type Match,
  type Participant,
  type ScoreboardEntry,
  type DistributionBucket,
} from '../lib/play';
import { coalesceReads, joinMatchChannel, trailingThrottle, type CoalescedRead, type RealtimeChannel } from '../lib/realtime';
import { visibleCategoryOptionsFor } from '../lib/categories';
import type { CategoryType } from '../types/quiz';
import { friendlyError, ApiError } from '../lib/api';
import { categoryLabelKey } from '../lib/categories';
import { TopicPill } from './ui/CategoryTag';
import { renderQuestion } from './CodeBlock';
import { QuoteLoader } from './LoadingScreen';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { RadioCardGroup, RadioCard } from './ui/RadioCards';
import { StatePanel } from './ui/StatePanel';
import { PageHeader } from './ui/PageHeader';
import { Breadcrumb } from './ui/Breadcrumb';
import { useGameConfig } from '../lib/gameConfig';
import './DeepEndScreens.css';
import './Play.css';
import { BookIcon, TargetIcon } from './ui/icons';
import { capture } from '../lib/analytics';
import { visuallyHidden } from '../theme/MuiTheme';

const POLL_FALLBACK_MS = 4000;
const REALTIME_HEALING_POLL_MS = 30_000;
const DEFAULT_DURATION_S = 60;
// A timed multiplayer question that runs out moves on when someone reads the
// room: the server advances it lazily, 2 s past the limit. With Realtime up
// the next read could be the 30 s healing poll, so each client reads once just
// after.
const EXPIRY_RESYNC_MS = 2500;
// The server still takes an answer this long past a timed question's limit
// (QUESTION_EXPIRE_GRACE_MS in api/play/[action].ts), so the presenter's
// screen keeps the answer key hidden until then.
const ANSWER_GRACE_MS = 2000;
// The host reads the room this long after a player's answer, and the answers
// that land meanwhile join that read.
const ANSWERED_READ_MS = 1500;
// A new estimate of the server's clock replaces the one in use only when it
// differs by this much, so the countdown does not jitter with each read.
const CLOCK_STEP_MS = 500;

/** What a `match_updated` broadcast carries: the room's phase and question,
 * and in a classroom whether the teacher closed that question (056). */
type RoomState = Pick<Match, 'status' | 'current_index' | 'revealed_idx'>;

/** The room state in a broadcast, or null for one without it (a tab still
 * running the build from before broadcasts carried it). */
function roomStateIn(payload: unknown): RoomState | null {
  const value = payload as Partial<RoomState> | null | undefined;
  if (!value || !['lobby', 'running', 'finished'].includes(value.status as string)) return null;
  if (typeof value.current_index !== 'number' || !Number.isInteger(value.current_index)) return null;
  const room: RoomState = { status: value.status as Match['status'], current_index: value.current_index };
  if (typeof value.revealed_idx === 'number' && Number.isInteger(value.revealed_idx)) room.revealed_idx = value.revealed_idx;
  return room;
}

/** The question on screen is one the teacher closed. */
const closedNow = (room: RoomState): boolean => room.revealed_idx === room.current_index;

/** Whether two room states show the same screen: the question, and whether it
 * is closed, only matter while the room runs. */
const sameRoom = (a: RoomState | null | undefined, b: RoomState | null | undefined): boolean =>
  !!a && !!b && a.status === b.status &&
  (a.status !== 'running' || (a.current_index === b.current_index && closedNow(a) === closedNow(b)));

/** A match code's length (lib/play-helpers.ts generateMatchCode). */
const MATCH_CODE_LENGTH = 6;

/** The Play switch in /dev → Settings is off, and the server says so. */
const isPlayOff = (err: unknown) => err instanceof ApiError && err.code === 'feature_disabled';

/** Shown in place of a Play page while live games are switched off. */
function PlayUnavailable() {
  const navigate = useNavigate();
  const t = useT();
  return (
    <StatePanel level={1} title={t('play.unavailableTitle')} body={t('play.unavailableBody')}>
      <Button variant="primary" label={t('common.back')} onClick={() => navigate('/')} />
    </StatePanel>
  );
}

/** /play and /play/:code signed out: the shared sign-in gate, as on /cards
 * and /collection (UX audit social-account-16). */
function PlaySignIn() {
  const t = useT();
  return (
    <StatePanel level={1} title={t('play.signInTitle')} body={t('play.signInBody')} signIn />
  );
}

// Human-readable label for a per-question time limit (0 = no limit).
function formatDuration(n: number, t: ReturnType<typeof useT>): string {
  if (n <= 0) return t('play.timeLimitNone');
  if (n < 60) return t('play.timeLimitSeconds', { n });
  return t('play.timeLimitMinutes', { n: n / 60 });
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  }
}

export function PlayLanding() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const config = useGameConfig();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  // Below 600px the topic pills fold behind one 44px "Topics: all" row, so
  // Create is not a full screen below the mode choice (social-account-13).
  const foldTopics = useIsMobile();
  const timeLimitId = useId();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const profile = getUserProfile(user);
  const [mode, setMode] = useState<'ffa' | 'classroom'>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'classroom'
      ? 'classroom'
      : 'ffa',
  );
  const [count, setCount] = useState(() => config.play.countOptions[0] ?? 10);
  const [durationS, setDurationS] = useState(() => config.play.defaultDurationS);
  const [selectedCategories, setSelectedCategories] = useState<CategoryType[]>([]);
  const [joinCode, setJoinCode] = useState('');

  const categoryOptions = visibleCategoryOptionsFor(profile.email, { includePlayOnly: true });
  const toggleCategory = (c: CategoryType) =>
    setSelectedCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<'create' | 'join' | null>(null);
  // Set at the press itself: `loading` disables the buttons a render later,
  // after a double click has already sent its second create (a second room).
  const busyRef = useRef(false);
  const [playOff, setPlayOff] = useState(false);

  if (!config.features.multiplayer || playOff) return <PlayUnavailable />;

  if (authLoading) {
    return <QuoteLoader quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
  }

  if (!isAuthenticated) return <PlaySignIn />;

  const handleCreate = async () => {
    if (!user?.id || busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setLoading('create');
    try {
      const m = await createMatch({
        host_id: user.id,
        mode: mode === 'classroom' ? 'classroom' : 'multiplayer',
        count,
        // "No selection" means every topic of the ACTIVE subject — sending the
        // explicit list keeps other subjects' questions out of the match.
        categories: selectedCategories.length
          ? selectedCategories
          : categoryOptions.map((c) => c.value),
        duration_s: durationS,
      });
      capture(mode === 'classroom' ? 'classroom_created' : 'multiplayer_created', { question_count: count });
      navigate(`/play/${m.code}`);
    } catch (err) {
      if (isPlayOff(err)) setPlayOff(true);
      else setError(friendlyError(err));
    } finally {
      busyRef.current = false;
      setLoading(null);
    }
  };

  const handleJoin = async () => {
    if (!user?.id || busyRef.current) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError(t('play.enterCode'));
      return;
    }
    busyRef.current = true;
    setError(null);
    setLoading('join');
    try {
      await joinMatch({
        code,
        user_id: user.id,
      });
      capture('classroom_or_match_joined');
      navigate(`/play/${code}`);
    } catch (err) {
      if (isPlayOff(err)) setPlayOff(true);
      else setError(friendlyError(err));
    } finally {
      busyRef.current = false;
      setLoading(null);
    }
  };

  // The same pills open on wide screens and inside the fold on a phone.
  const topicPills = (
    <div role="group" aria-label={t('play.categories')} className="play-topics__pills">
      {categoryOptions.map((cat) => (
        <TopicPill
          category={cat.value}
          selected={selectedCategories.includes(cat.value)}
          onClick={() => toggleCategory(cat.value)}
          key={cat.value}
        />
      ))}
    </div>
  );
  const clearTopics = selectedCategories.length > 0 && (
    <Button variant="ghost" label={t('play.clear')} onClick={() => setSelectedCategories([])} />
  );

  return (
    <div className="de-page">
      <VStack gap={3}>
        {/* The operational header the social pages share: kicker, an ink
            h1 at display-3 and one lead (UX audit social-account-11). */}
        <PageHeader kicker={t('play.title')} title={t('play.heading')} lead={t('play.subtitle')} />

        {error && (
          <Banner
            status="error"
            title={error}
            isDismissable
            onDismiss={() => setError(null)}
          />
        )}

        {/* Host + Join sit side by side on desktop (2:1) so the short "join" card
            no longer stacks below the tall host card. They stack on mobile. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isDesktop ? '2fr 1fr' : '1fr',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <div style={{ display: 'flex', width: '100%' }}>
          <Card padding={4} width="100%">
            <VStack gap={3}>
              <VStack gap={2}>
                <Kicker>{t('play.hostGame')}</Kicker>
                <RadioCardGroup className="de-mode-list" value={mode} onChange={(value) => setMode(value as 'ffa' | 'classroom')} label={t('play.gameMode')}>
                  {([
                    ['ffa', <TargetIcon key="ffa" size={20} />, t('play.multiplayerFfa'), t('play.modeFfaBlurb')],
                    ['classroom', <BookIcon key="classroom" size={20} />, t('play.classroom'), t('play.modeClassroomBlurb')],
                  ] as const).map(([id, icon, name, blurb]) => (
                    <RadioCard key={id} value={id} index={id === 'ffa' ? 0 : 1} className="de-mode-card" padding={4}>
                      <span className="de-mode-card__icon" aria-hidden>{icon}</span>
                      <span className="de-mode-card__copy"><strong>{name}</strong><span>{blurb}</span></span>
                      <span className="de-mode-card__check" aria-hidden style={{ opacity: mode === id ? 1 : 0 }}>✓</span>
                    </RadioCard>
                  ))}
                </RadioCardGroup>
              </VStack>

              {foldTopics ? (
                <details className="play-topics">
                  <summary className="play-topics__summary">
                    {selectedCategories.length === 0
                      ? t('play.topicsAll')
                      : t('play.topicsSelected', { count: selectedCategories.length })}
                  </summary>
                  <div className="play-topics__body">
                    {topicPills}
                    {clearTopics}
                  </div>
                </details>
              ) : (
                <VStack gap={1}>
                  <HStack justify="between" align="center">
                    <Text type="label" weight="bold" color="secondary">
                      {t('play.categories')}
                    </Text>
                    {clearTopics}
                  </HStack>
                  {topicPills}
                  <Text type="supporting" size="xsm" color="secondary">
                    {selectedCategories.length === 0
                      ? t('play.allCategoriesHint')
                      : t('play.categoriesSelected', { count: selectedCategories.length })}
                  </Text>
                </VStack>
              )}

              {/* Question count and time limit: each with its label above, at
                  the shared 44px control height, side by side from 900px
                  (UX audit social-account-12). The time limit is one 44px
                  select, as the Leaderboard's topic filter, so it never wraps
                  a lone "No limit" onto a second row (social-account-13). */}
              <div style={{ display: 'flex', flexDirection: isDesktop ? 'row' : 'column', flexWrap: 'wrap', gap: '16px 32px' }}>
                <VStack gap={1}>
                  <Text type="label" weight="bold" color="secondary">
                    {t('play.questions')}
                  </Text>
                  <ToggleButtonGroup
                    label={t('play.questions')}
                    type="single"
                    value={String(count)}
                    onChange={(v) => v && setCount(Number(v))}
                  >
                    {config.play.countOptions.map((n) => (
                      <ToggleButton key={n} value={String(n)} label={String(n)} />
                    ))}
                  </ToggleButtonGroup>
                </VStack>

                <VStack gap={1}>
                  <label htmlFor={timeLimitId} className="play-field-label">
                    <Text type="label" weight="bold" color="secondary">
                      {t('play.timeLimit')}
                    </Text>
                  </label>
                  <select
                    id={timeLimitId}
                    className="ss-select play-time-select"
                    value={String(durationS)}
                    onChange={(event) => setDurationS(Number(event.target.value))}
                  >
                    {config.play.durationOptionsS.map((n) => (
                      <option key={n} value={String(n)}>{formatDuration(n, t)}</option>
                    ))}
                  </select>
                </VStack>
              </div>

              <VStack gap={1} align="stretch">
                {/* The page's one filled primary (SwimCta md, 44px). */}
                <div style={{ display: 'grid' }}>
                  <SwimCta
                    label={
                      loading === 'create'
                        ? t('play.creating')
                        : mode !== 'classroom'
                          ? t('play.createMultiplayer')
                          : t('play.createClassroom')
                    }
                    disabled={loading !== null}
                    onClick={() => void handleCreate()}
                  />
                </div>
                <Text type="supporting" size="xsm" color="secondary">
                  {mode !== 'classroom' ? t('play.multiplayerHint') : t('play.classroomHint')}
                </Text>
              </VStack>
            </VStack>
          </Card>
          </div>

          <div>
            {!isDesktop && (
              <div style={{ margin: '8px 0 16px' }}>
                <Divider label={t('play.or')} />
              </div>
            )}
            <div className="ss-raised" style={{ display: 'flex', width: '100%' }}>
            <Card padding={4} width="100%">
              <VStack gap={2}>
                <Kicker>{t('play.joinWithCode')}</Kicker>
                {/* One frame around the field: the card. The code itself is
                    monospaced and spaced like a ticket stub; the label keeps
                    the body type (UX audit social-account-20). */}
                <div className="play-code">
                  <TextInput
                    label={t('play.matchCode')}
                    value={joinCode}
                    placeholder="ABC123"
                    onChange={(v) => setJoinCode(v.toUpperCase())}
                    // Enter in the code joins, as it would in a form; the
                    // join's own ref guard keeps a held key to one join.
                    onEnter={() => void handleJoin()}
                  />
                </div>
                {/* Join stays secondary beside the page's one primary (Create)
                    until the field holds a whole six-character code. */}
                <div style={{ display: 'grid' }}>
                  <Button
                    variant={joinCode.trim().length >= MATCH_CODE_LENGTH ? 'primary' : 'secondary'}
                    label={loading === 'join' ? '…' : `${t('play.join')} →`}
                    isLoading={loading === 'join'}
                    isDisabled={loading !== null}
                    onClick={handleJoin}
                  />
                </div>
                <div className="de-scoring-note"><strong>{t('play.scoringTitle')}</strong>{t('play.scoringBody')}</div>
              </VStack>
            </Card>
            </div>
          </div>
        </div>
      </VStack>
    </div>
  );
}

/** One room per code and account. Going from one /play/:code straight to
 * another keeps the route element, and an account change keeps the screen,
 * so without the key the previous room's question, pick and scoreboard stayed
 * on screen (and answerable) until the new join landed. Keyed by the
 * account's id, not the user object, which every session refresh replaces. */
export function PlayMatch() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  return <PlayRoom key={`${(code || '').toUpperCase()}:${user?.id ?? ''}`} />;
}

function PlayRoom() {
  const { code: codeParam } = useParams<{ code: string }>();
  const code = (codeParam || '').toUpperCase();
  const navigate = useNavigate();
  const t = useT();
  const config = useGameConfig();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [playOff, setPlayOff] = useState(false);
  const playOn = config.features.multiplayer && !playOff;
  // Bumped by "Try again" after a failed join, which runs the join again: a
  // state read alone draws the room without making this learner a player.
  const [joinAttempt, setJoinAttempt] = useState(0);
  const [match, setMatch] = useState<Match | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [joining, setJoining] = useState(true);
  const [canReadRoom, setCanReadRoom] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [controlPending, setControlPending] = useState(false);
  const [questionShownAt, setQuestionShownAt] = useState<number>(Date.now());
  const [connectionState, setConnectionState] = useState<'live' | 'polling' | 'stale'>('polling');
  const refreshFailures = useRef(0);
  // How far the server's clock runs ahead of this device's. Each question is
  // counted down against the server's clock, so a device clock that is off
  // neither closes a question early for a player nor reveals it early on the
  // presenter's screen.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const noteServerClock = useCallback((serverNow: string | undefined, sentAt: number) => {
    const offset = serverClockOffset(serverNow, sentAt, Date.now());
    if (offset === null) return;
    setClockOffsetMs((current) => (Math.abs(offset - current) >= CLOCK_STEP_MS ? Math.round(offset) : current));
  }, []);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isHost = !!(user?.id && match?.host_id === user.id);
  // The broadcast handlers are set up once per match, so they read the room
  // and the host flag through refs.
  const matchRef = useRef<Match | null>(null);
  const isHostRef = useRef(false);
  useEffect(() => {
    matchRef.current = match;
  }, [match]);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);
  // The last room state this client went to read: one it announced, or one a
  // broadcast named. A broadcast of the same state again needs no new read.
  const handledRef = useRef<RoomState | null>(null);
  // Tell every client the room changed phase or question. Only a change is
  // announced, never a single answer: each broadcast sets off a state read on
  // every client that does not show that state yet.
  const announce = useCallback((room: RoomState) => {
    handledRef.current = {
      status: room.status,
      current_index: room.current_index,
      ...(room.status === 'running' && closedNow(room) ? { revealed_idx: room.current_index } : {}),
    };
    void channelRef.current?.send('match_updated', handledRef.current).catch(() => undefined);
  }, []);
  // Records when the local client first observed the current question_started_at,
  // so a slow broadcast doesn't unfairly penalise the speed bonus.
  const clientReceivedAtRef = useRef<string | null>(null);
  // Synchronous submit lock: two clicks can land in the same render tick,
  // before the async `submitted` state re-renders — the ref closes that gap
  // so the first click is the one that counts.
  const submitLockRef = useRef(false);

  // Join once per account. The room reader loads the first full state after
  // this, so a join snapshot or parallel read can't put the room back a step.
  const userId = user?.id;
  useEffect(() => {
    if (!isAuthenticated || !userId || !code || !playOn) return;
    let cancelled = false;
    (async () => {
      try {
        const sentAt = Date.now();
        try {
          const { server_now: serverNow, ...room } = await joinMatch({ code, user_id: userId });
          if (cancelled) return;
          noteServerClock(serverNow, sentAt);
          setMatch(room);
        } catch (err) {
          // A finished room takes no new players, but its results are still
          // there to read: reopening it shows them instead of an error.
          if (!(err instanceof ApiError && err.code === 'finished')) throw err;
        }
        if (!cancelled) setCanReadRoom(true);
      } catch (err) {
        if (cancelled) return;
        if (isPlayOff(err)) setPlayOff(true);
        else setError(friendlyError(err));
        setJoining(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, isAuthenticated, userId, joinAttempt, playOn, noteServerClock]);

  // Pull the latest match state. Shared by the realtime/poll loop and by
  // submitAnswer so an auto-advance is reflected immediately for the answerer.
  // Every call goes through the match's coalesced reader (set up below), so a
  // burst of broadcasts costs one read in flight and one trailing read.
  const readerRef = useRef<CoalescedRead | null>(null);
  const refresh = useCallback(() => readerRef.current?.request() ?? Promise.resolve(), []);

  // Realtime broadcast wiring.
  useEffect(() => {
    if (!code || !user?.id || !playOn || !canReadRoom) return;
    const userId = user.id;
    // Cancel the room's reads when it closes or changes, including the
    // fetch already in flight as well as any queued refresh.
    const controller = new AbortController();
    const { signal } = controller;
    let realtimeReady = false;
    let firstRead = true;
    handledRef.current = null;
    const reader = coalesceReads(async () => {
      const initial = firstRead;
      firstRead = false;
      try {
        const sentAt = Date.now();
        const state = await fetchMatchState(code, userId, signal);
        if (signal.aborted) return;
        noteServerClock(state.server_now, sentAt);
        const before = matchRef.current;
        matchRef.current = state.match;
        setMatch(state.match);
        setParticipants(state.participants);
        setScoreboard(state.scoreboard);
        setReadError(null);
        refreshFailures.current = 0;
        // A read that works again clears the "could not refresh" warning,
        // even while Realtime stayed connected throughout.
        setConnectionState(realtimeReady ? 'live' : 'polling');
        // A read can move the room on itself (a timed question past its
        // grace, the last answers of an untimed one), and then no answer or
        // control announces it. The host announces a change they read that
        // no broadcast named.
        if (isHostRef.current && before && !sameRoom(before, state.match) && !sameRoom(handledRef.current, state.match)) {
          announce(state.match);
        }
      } catch (err) {
        if (signal.aborted) return;
        // The state a broadcast named was not read: the next broadcast of it
        // reads again.
        handledRef.current = null;
        if (isPlayOff(err)) {
          setPlayOff(true);
          return;
        }
        if (initial) setReadError(friendlyError(err));
        refreshFailures.current += 1;
        setConnectionState(refreshFailures.current >= 3 ? 'stale' : 'polling');
      } finally {
        if (!signal.aborted && initial) setJoining(false);
      }
    });
    readerRef.current = reader;
    const channel = joinMatchChannel(code);
    channelRef.current = channel;

    channel.subscribe('participant_joined', refresh);
    channel.subscribe('match_updated', (payload: unknown) => {
      const room = roomStateIn(payload);
      // A broadcast of the room this client shows, or already went to read,
      // changes nothing here.
      if (room && (sameRoom(room, matchRef.current) || sameRoom(room, handledRef.current))) return;
      if (room) handledRef.current = room;
      void refresh();
    });
    // Each player's answer reaches the host alone, whose live scoreboard
    // follows the room: one read at most every ANSWERED_READ_MS, however
    // many answers land. A classroom scoreboard changes only when a question
    // closes (056), so a classroom answer sets off no read.
    const answeredRead = trailingThrottle(() => void refresh(), ANSWERED_READ_MS);
    channel.subscribe('answered', () => {
      if (isHostRef.current && matchRef.current?.mode !== 'classroom') answeredRead.request();
    });
    const stopStatus = channel.onStatus((status) => {
      realtimeReady = status === 'SUBSCRIBED';
      setConnectionState(realtimeReady ? 'live' : 'polling');
      if (realtimeReady) {
        refreshFailures.current = 0;
        void channel.send('participant_joined', { sub: userId });
      }
    });

    // Fast polling only while Realtime is unavailable. A slow healing poll is
    // retained while connected in case a broadcast is dropped.
    const healing = window.setInterval(() => void refresh(), REALTIME_HEALING_POLL_MS);
    const fallback = window.setInterval(() => {
      if (!realtimeReady) void refresh();
    }, POLL_FALLBACK_MS);
    void refresh();

    return () => {
      controller.abort();
      reader.cancel();
      answeredRead.cancel();
      if (readerRef.current === reader) readerRef.current = null;
      window.clearInterval(healing);
      window.clearInterval(fallback);
      stopStatus();
      channel.unsubscribe();
    };
  }, [code, user?.id, refresh, playOn, canReadRoom, noteServerClock, announce]);

  // Read the room once just after a timed question's clock (and the server's
  // expiry grace) runs out: a multiplayer room moves on without waiting for
  // a poll, and a classroom scoreboard counts the question that just closed.
  // A classroom question itself stays until the teacher moves on.
  const matchStatus = match?.status;
  const questionStartedAt = match?.question_started_at;
  const questionDurationS = match?.question_duration_s ?? 0;
  useEffect(() => {
    if (matchStatus !== 'running' || !questionStartedAt || questionDurationS <= 0) return;
    const serverNow = Date.now() + clockOffsetMs;
    const dueIn = new Date(questionStartedAt).getTime() + questionDurationS * 1000 + EXPIRY_RESYNC_MS - serverNow;
    const id = window.setTimeout(() => void refresh(), Math.max(0, dueIn));
    return () => window.clearTimeout(id);
  }, [matchStatus, match?.current_index, questionStartedAt, questionDurationS, clockOffsetMs, refresh]);

  // Which question the per-question state belongs to: bumped with each new
  // one, so an answer's response that lands after the room moved on leaves
  // the new question's lock alone.
  const questionSeqRef = useRef(0);
  // Reset per-question UI when the index changes.
  useEffect(() => {
    questionSeqRef.current += 1;
    setSelected(null);
    setSubmitted(false);
    submitLockRef.current = false;
    setQuestionShownAt(Date.now());
    clientReceivedAtRef.current = new Date().toISOString();
  }, [code, userId, match?.id, match?.current_index, match?.status]);

  // Host heartbeat — keeps the match from being auto-finished by the
  // server's stale-match cleanup (5 min). Pinged every 30 s while the
  // host is actively viewing the page.
  useEffect(() => {
    if (!isHost || !user?.id || !code) return;
    if (match?.status !== 'lobby' && match?.status !== 'running') return;
    let cancelled = false;
    const tick = () => {
      sendHeartbeat(code, user.id!).catch(() => {
        /* ignore — UI keeps working, server will auto-finish if truly gone */
      });
    };
    tick();
    const id = window.setInterval(() => {
      if (!cancelled) tick();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isHost, user?.id, code, match?.status]);

  // Synchronous control lock, like the submit lock: a double click on Next
  // lands both clicks before `controlPending` disables the button, and the
  // server would advance twice, skipping a question for the whole room.
  const controlLockRef = useRef(false);
  const runHostControl = async (action: 'start' | 'advance' | 'finish' | 'reveal') => {
    if (!user?.id || !match || controlLockRef.current) return;
    controlLockRef.current = true;
    setControlPending(true);
    try {
      const result = await controlMatch({ code, host_id: user.id, action });
      if (action === 'reveal') {
        // The server closed the question: its key and its points can show.
        const revealed = typeof result.revealed_idx === 'number' ? result.revealed_idx : match.current_index;
        setMatch((current) => (current && current.current_index === revealed ? { ...current, revealed_idx: revealed } : current));
      }
      announce(
        action === 'start'
          ? { status: 'running', current_index: 0 }
          : action === 'finish'
            ? { status: 'finished', current_index: match.current_index }
            : action === 'reveal'
              ? { status: 'running', current_index: match.current_index, revealed_idx: match.current_index }
              : {
                  status: result.status === 'finished' ? 'finished' : 'running',
                  current_index: typeof result.current_index === 'number' ? result.current_index : match.current_index + 1,
                },
      );
      // The broadcast reaches this client too, but names the state it
      // announced, so the host reads the room here. The controls stay
      // disabled until the new question is on screen.
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      controlLockRef.current = false;
      setControlPending(false);
    }
  };

  const startMatch = () => void runHostControl('start');
  const advance = () => void runHostControl('advance');
  const finish = () => void runHostControl('finish');
  const reveal = () => void runHostControl('reveal');

  // Selection is only mutable until the first submit locks it in.
  const selectOption = (i: number) => {
    if (submitLockRef.current) return;
    setSelected(i);
  };

  // One tap locks the answer — no confirm step. The card is marked selected
  // and disabled optimistically, then the answer is recorded; a misclick is
  // the player's own (by design).
  const submitAnswer = async (selectedIdx: number) => {
    if (!match || !user?.id || submitLockRef.current) return;
    submitLockRef.current = true;
    const seq = questionSeqRef.current;
    setSelected(selectedIdx);
    setSubmitted(true);
    try {
      const result = await submitMatchAnswer({
        code,
        user_id: user.id,
        question_idx: match.current_index,
        selected_idx: selectedIdx,
        duration_ms: Date.now() - questionShownAt,
        client_received_at: clientReceivedAtRef.current ?? new Date().toISOString(),
      });
      if (questionSeqRef.current !== seq) return;
      if (result.advanced) {
        // In multiplayer the server advances as soon as the last player locks
        // in. Tell everyone, and pull fresh state right away so this client
        // jumps to the next question (or the results) without waiting.
        const next = match.current_index + 1;
        announce(
          next >= questionCountOf(match)
            ? { status: 'finished', current_index: match.current_index }
            : { status: 'running', current_index: next },
        );
        await refresh();
      } else if (match.mode !== 'classroom') {
        // One answer changes no one's screen but the host's live scoreboard.
        // A classroom scoreboard waits for the question to close (056).
        void channelRef.current?.send('answered', { question_idx: match.current_index }).catch(() => undefined);
      }
    } catch (err) {
      if (questionSeqRef.current !== seq) return;
      if (err instanceof ApiError && (err.code === 'wrong_question' || err.code === 'time_up' || err.code === 'question_closed')) {
        // The clock ran out, the teacher closed the question, or the match
        // moved past it before the answer landed. Tell the player it didn't
        // count, then resync.
        setError(t(err.code === 'question_closed' ? 'play.closedBeforeAnswer' : 'play.tooLate'));
        await refresh();
        return;
      }
      if (err instanceof ApiError && err.code === 'bad_state') {
        // Match ended while the submit was in flight — just resync.
        await refresh();
        return;
      }
      // The current answer did not arrive. Unlock so the player can retry.
      submitLockRef.current = false;
      setSubmitted(false);
      setError(friendlyError(err));
    }
  };

  if (!playOn) return <PlayUnavailable />;

  if (authLoading) {
    return <QuoteLoader quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
  }

  if (!isAuthenticated) return <PlaySignIn />;

  if (joining) {
    // Same loading look as the other study modes, but no artificial minimum
    // hold: a live match runs on a shared clock, so joining must be instant.
    return <QuoteLoader quote={t('quiz.loadingQuote')} label={t('play.joining')} />;
  }

  const notice = error ?? readError;
  if (notice && !match) {
    return (
      <div style={{ maxWidth: 'var(--ss-width-task)', margin: '0 auto', width: '100%' }}>
        <VStack gap={2}>
          {/* The page's heading, so a match that cannot open still has one. */}
          <PageHeader title={t('play.title')} />
          <Banner status="error" title={notice} />
          <HStack gap={1} wrap="wrap">
            <Button
              variant="primary"
              label={t('error.tryAgain')}
              onClick={() => {
                setError(null);
                setReadError(null);
                setJoining(true);
                setCanReadRoom(false);
                setJoinAttempt((n) => n + 1);
              }}
            />
            <Button variant="secondary" label={t('common.back')} onClick={() => navigate('/play')} />
          </HStack>
        </VStack>
      </div>
    );
  }
  if (!match) return null;

  const totalQuestions = questionCountOf(match);
  const currentQuestion = match.questions[match.current_index];

  return (
    // The shared task column (--ss-width-task, 640px) inside the route's page,
    // as on Quiz, Learn and Challenge (UX audit social-account-01).
    <div data-activity={match.status === 'running' ? 'active' : undefined} style={{ maxWidth: match.status === 'running' ? 'var(--ss-width-question)' : 'var(--ss-width-task)', margin: '0 auto', width: '100%' }}>
      {match.status !== 'running' && <Breadcrumb items={[{ label: t('play.title'), href: '/play' }, { label: code }]} />}
      <VStack gap={2}>
        {/* The shared operational header, with the room's code badge as its
            one compact action on the right (social-account-11, -15). */}
        <div className="play-room__head">
          <PageHeader
            kicker={t('play.title')}
            title={match.mode === 'classroom' ? t('play.classroom') : t('play.multiplayer')}
            lead={t('play.hostedBy', { name: match.host_name })}
          />
          <CodeBadge code={code} />
        </div>

        {notice && (
          <Banner
            status="warning"
            title={notice}
            isDismissable
            onDismiss={() => error ? setError(null) : setReadError(null)}
          />
        )}

        {connectionState !== 'live' && (
          <Banner
            status={connectionState === 'stale' ? 'warning' : 'info'}
            title={connectionState === 'stale' ? t('play.connectionStale') : t('play.connectionPolling')}
          />
        )}

        {match.status === 'lobby' && (
          <Lobby
            match={match}
            participants={participants}
            isHost={isHost}
            onStart={startMatch}
            startPending={controlPending}
          />
        )}

        {match.status === 'running' && currentQuestion && (
          <RunningQuestion
            match={match}
            questionIdx={match.current_index}
            total={totalQuestions}
            q={currentQuestion}
            isHost={isHost}
            mode={match.mode}
            selected={selected}
            submitted={submitted}
            onSelect={selectOption}
            onAnswer={submitAnswer}
            onAdvance={advance}
            onFinish={finish}
            onReveal={reveal}
            controlPending={controlPending}
            scoreboard={scoreboard}
            participants={participants}
            hostSub={user?.id}
            code={code}
            clockOffsetMs={clockOffsetMs}
          />
        )}

        {match.status === 'finished' && (
          <Finished match={match} scoreboard={scoreboard} onLeave={() => navigate('/play')} />
        )}
      </VStack>
    </div>
  );
}

const CodeBadge = ({ code }: { code: string }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const status = copyFailed ? t('play.copyFailed') : copied ? t('play.copied') : t('play.copy');
  return (
    <Button
      variant="secondary"
      label={`${code} — ${status}`}
      onClick={() => {
        void copyText(code).then((ok) => {
          setCopied(ok);
          setCopyFailed(!ok);
          setTimeout(() => {
            setCopied(false);
            setCopyFailed(false);
          }, 1600);
        });
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'monospace', letterSpacing: '0.2em', fontWeight: 700 }}>{code}</span>
        <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>{status}</span>
      </span>
    </Button>
  );
};

function Lobby({
  match,
  participants,
  isHost,
  onStart,
  startPending,
}: {
  match: Match;
  participants: Participant[];
  isHost: boolean;
  onStart: () => void;
  startPending: boolean;
}) {
  const t = useT();
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/play/${match.code}` : '';
  // The QR's box is held while the code draws, so the share text beside it
  // does not jump; a QR that cannot be drawn leaves the URL and the buttons.
  const [qrUrl, setQrUrl] = useState<string | null>('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    let active = true;
    void import('qrcode')
      .then(({ toDataURL }) => toDataURL(shareUrl, {
        width: 220,
        margin: 1,
        color: { dark: '#132019ff', light: '#ffffffff' },
        errorCorrectionLevel: 'M',
      }))
      .then((url) => { if (active) setQrUrl(url); })
      .catch(() => { if (active) setQrUrl(null); });
    return () => { active = false; };
  }, [shareUrl]);
  // One panel with rows inside it, never a card in a card (UX audit
  // social-account-14). The header's badge carries the code, so the
  // instruction does not repeat it.
  return (
    <section className="ss-panel ss-pop play-invite play-lobby">
      <div className="play-lobby__head">
        <HStack gap={1.5} align="center">
          <Heading level={2}>{t('play.lobby')}</Heading>
          {participants.length > 0 && (
            <span className="play-lobby__count">{participants.length}</span>
          )}
        </HStack>
        <Text color="secondary">{isHost ? t('play.shareHost') : t('play.shareGuest')}</Text>
      </div>

      <div className="play-lobby__share">
        {qrUrl !== null && (
          <div className="play-lobby__qr">
            {qrUrl && <img src={qrUrl} alt={t('play.qrAlt', { code: match.code })} width={164} height={164} />}
          </div>
        )}
        <div className="play-lobby__share-text">
          {qrUrl !== null && <Text weight="bold">{t('play.scanToJoin')}</Text>}
          <span className="play-lobby__url">{shareUrl}</span>
          <div className="play-lobby__share-actions">
            <Button
              variant="secondary"
              label={copyStatus === 'copied' ? t('play.copied') : copyStatus === 'failed' ? t('play.copyFailed') : t('play.copyLink')}
              onClick={() => {
                void copyText(shareUrl).then((ok) => {
                  setCopyStatus(ok ? 'copied' : 'failed');
                  setTimeout(() => setCopyStatus('idle'), 1600);
                });
              }}
            />
            <Button variant="ghost" label={t('play.printInvite')} onClick={() => window.print()} />
          </div>
        </div>
      </div>

      {participants.length > 0 ? (
        <ul className="play-lobby__players" aria-label={t('play.players')}>
          {participants.map((p) => (
            <li key={p.user_id} className="play-lobby__player">
              <Avatar name={p.display_name} size="small" />
              <span className="play-lobby__name">{p.display_name}</span>
              {p.user_id === match.host_id && <Badge variant="yellow" label={t('play.host')} />}
            </li>
          ))}
        </ul>
      ) : (
        <p className="play-lobby__empty">{t('play.noPlayers')}</p>
      )}

      {/* The host's Start is the screen's one primary (SwimCta md, 44px):
          right-aligned on its own row, full width on a phone, never a
          wrapped afterthought under the share buttons (social-account-15). */}
      {isHost && (
        <div className="play-lobby__start">
          <SwimCta
            label={t('play.startWithCount', { count: questionCountOf(match) })}
            disabled={participants.length < 1 || startPending}
            onClick={onStart}
          />
        </div>
      )}
    </section>
  );
}

function RunningQuestion({
  match,
  questionIdx,
  total,
  q,
  isHost,
  mode,
  selected,
  submitted,
  onSelect,
  onAnswer,
  onAdvance,
  onFinish,
  onReveal,
  controlPending,
  scoreboard,
  participants,
  hostSub,
  code,
  clockOffsetMs,
}: {
  match: Match;
  questionIdx: number;
  total: number;
  q: NonNullable<Match['questions'][number]>;
  isHost: boolean;
  mode: Match['mode'];
  selected: number | null;
  submitted: boolean;
  onSelect: (i: number) => void;
  onAnswer: (i: number) => void;
  onAdvance: () => void;
  onFinish: () => void;
  /** Classroom presenter: close the question and show its answer. */
  onReveal: () => void;
  controlPending: boolean;
  scoreboard: ScoreboardEntry[];
  participants: Participant[];
  hostSub?: string;
  code: string;
  /** The server's clock minus this device's. */
  clockOffsetMs: number;
}) {
  const t = useT();
  const lastQuestion = questionIdx >= total - 1;
  // Multiplayer is a fair race: the host answers like everyone else and never
  // sees the answer key. Only a classroom host presents instead of playing.
  const isPlayer = mode === 'multiplayer' || !isHost;
  const isPresenter = isHost && mode === 'classroom';
  const questionLabelId = `play-question-${q.id}`;
  // "Reveal answer" closes a classroom question on the server (056): no
  // answer to it lands any more, and the scoreboard counts it. The room says
  // which question the teacher closed, so the next one opens again.
  const closedByTeacher = mode === 'classroom' && match.revealed_idx === questionIdx;

  // Presenter view polls the per-question answer distribution; the same
  // buckets drive both the histogram and the "answers received" count (the
  // cumulative scoreboard can't say who answered the CURRENT question).
  const [buckets, setBuckets] = useState<DistributionBucket[]>([]);
  const [distributionStale, setDistributionStale] = useState(false);
  useEffect(() => {
    setBuckets([]);
    setDistributionStale(false);
  }, [code, questionIdx]);
  useEffect(() => {
    if (!isPresenter || !hostSub) return;
    let cancelled = false;
    // One read at a time: on a slow connection a read outlasting the 1.5 s
    // tick stacked up more, and an older answer landing last drew counts
    // that had already gone up.
    let inFlight = false;
    const load = () => {
      if (inFlight) return;
      inFlight = true;
      fetchDistribution(code, questionIdx, hostSub)
        .then((r) => {
          if (!cancelled) {
            setBuckets(r.buckets);
            setDistributionStale(false);
            // Reveal closes the question on the server. Retry the final count
            // if needed, then stop once its result is in.
            if (closedByTeacher) window.clearInterval(id);
          }
        })
        .catch(() => {
          if (!cancelled) setDistributionStale(true);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const id = window.setInterval(load, 1500);
    load();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isPresenter, hostSub, code, questionIdx, closedByTeacher]);
  const answeredCount = useMemo(() => buckets.reduce((sum, b) => sum + b.count, 0), [buckets]);
  // The presenter is a participant row too but never answers — exclude them
  // from the denominator.
  const playerCount = useMemo(
    () => participants.filter((p) => p.user_id !== match.host_id).length,
    [participants, match.host_id],
  );

  // Countdown derived from question_started_at + question_duration_s, on the
  // server's clock. A duration of 0 (or missing) means the host chose "no
  // time limit".
  const durationS = match.question_duration_s ?? DEFAULT_DURATION_S;
  const noLimit = durationS <= 0;
  const startedMs = match.question_started_at ? new Date(match.question_started_at).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (noLimit) return;
    // The visible timer changes once per second; a 250 ms full subtree render
    // added churn without conveying more useful information.
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [noLimit]);
  const serverNow = now + clockOffsetMs;
  const remainingMs = noLimit
    ? Infinity
    : startedMs
      ? Math.max(0, startedMs + durationS * 1000 - serverNow)
      : durationS * 1000;
  const remainingS = Math.ceil(remainingMs / 1000);
  const pctLeft = noLimit ? 100 : startedMs ? (remainingMs / (durationS * 1000)) * 100 : 100;
  // The clock is out: the server refuses a new answer, so none can be picked.
  const timeUp = !noLimit && remainingMs === 0;
  // The server still takes an answer sent on the buzzer for a moment after
  // that; only then is the question closed for everyone.
  const answersClosed = !noLimit && startedMs !== null && serverNow >= startedMs + durationS * 1000 + ANSWER_GRACE_MS;
  // The presenter's screen is often projected while pupils answer, so the
  // answer key stays hidden until the question is closed: its clock ran out
  // or the teacher revealed it (an untimed question waits for the button).
  const hasKey = isPresenter && typeof q.correct_index === 'number';
  const showKey = hasKey && (answersClosed || closedByTeacher);

  // Time-up auto-lock: clicking locks instantly, so this only catches a
  // keyboard user who arrow-browsed to an option but never pressed Enter.
  // Once per question: a send that fails unlocks the answer, and `onAnswer`
  // is new on every render, so without the mark a failing connection sent it
  // again on every render, as fast as each request failed.
  const autoLockedRef = useRef<string | null>(null);
  const questionKey = `${match.id}:${questionIdx}`;
  useEffect(() => {
    if (!noLimit && isPlayer && !submitted && !closedByTeacher && remainingMs === 0 && selected !== null && autoLockedRef.current !== questionKey) {
      autoLockedRef.current = questionKey;
      onAnswer(selected);
    }
  }, [remainingMs, noLimit, isPlayer, submitted, closedByTeacher, selected, onAnswer, questionKey]);

  const timerColor = noLimit || closedByTeacher
    ? 'var(--astryx-color-text-secondary, currentColor)'
    : remainingS <= 5
      ? 'var(--ss-error)'
      : remainingS <= 10
        ? 'var(--ss-warning)'
        : 'var(--astryx-color-text-secondary, currentColor)';

  return (
    <div className="ss-raised" style={{ display: 'flex', width: '100%' }}>
    <Card padding={4} width="100%">
      <VStack gap={2}>
        <HStack justify="between" align="center" gap={1}>
          <Text type="supporting" size="xsm" color="secondary">
            {t('play.questionMeta', {
              idx: questionIdx + 1,
              total,
              category: t(categoryLabelKey(q.category)),
              difficulty: q.difficulty,
            })}
          </Text>
          <span style={visuallyHidden} aria-live="polite">
            {!noLimit && !closedByTeacher && remainingS === 10 ? t('play.timeWarning') : ''}
          </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'monospace',
              fontWeight: 700,
              fontSize: '0.95rem',
              padding: '4px 11px',
              borderRadius: 999,
              color: timerColor,
              background:
                !noLimit && !closedByTeacher && remainingS <= 5
                  ? 'color-mix(in srgb, var(--ss-error) 15%, transparent)'
                  : 'color-mix(in srgb, var(--brand-accent) 12%, transparent)',
            }}
            role="timer"
            aria-label={closedByTeacher ? t('play.closed') : noLimit ? t('play.timeLimitNone') : t('play.timeRemaining', { n: remainingS })}
          >
            {closedByTeacher ? t('play.closed') : noLimit ? '∞' : `${remainingS}s`}
          </span>
        </HStack>

        <ProgressBar
          label={t('play.timeLimit')}
          isLabelHidden
          value={closedByTeacher ? 0 : pctLeft}
          variant={!noLimit && !closedByTeacher && remainingS <= 5 ? 'error' : 'accent'}
        />

        <div id={questionLabelId}>{renderQuestion(q.question)}</div>

        <RadioCardGroup
          value={selected}
          onChange={(v) => onSelect(v as number)}
          // One click locks the answer in — no confirm button. Arrow keys
          // still browse without committing; Enter/Space commits.
          onActivate={(v) => {
            if (isPlayer && !submitted && !timeUp && !closedByTeacher) onAnswer(v as number);
          }}
          labelledBy={questionLabelId}
        >
          <VStack gap={1}>
            {q.options.map((opt, i) => {
              // Only the classroom presenter gets the answer key (the server
              // withholds correct_index from everyone else while running), and
              // it shows only once the question is closed or revealed.
              const isCorrect = showKey && q.correct_index === i;
              return (
                <RadioCard
                  key={i}
                  value={i}
                  index={i}
                  label={opt}
                  padding={2}
                  disabled={!isPlayer || submitted || timeUp || closedByTeacher}
                  tone={isCorrect ? 'success' : 'default'}
                >
                  <Text>{opt}</Text>
                </RadioCard>
              );
            })}
          </VStack>
        </RadioCardGroup>

        {isPlayer && !submitted && (
          <Text type="supporting" size="xsm" color="secondary">
            {closedByTeacher ? t('play.questionClosed') : timeUp ? t('play.timeUp') : t('play.tapToLock')}
          </Text>
        )}
        {isPlayer && submitted && (
          <Banner
            status="success"
            title={
              mode === 'multiplayer'
                ? t('play.answerLockedVs')
                : t('play.answerLocked', { who: t('play.theInstructor') })
            }
          />
        )}

        {/* A multiplayer host is just another player, but keeps quiet escape
            hatches: skip a question nobody is answering (e.g. a player left a
            no-limit match mid-question) or end the match early. */}
        {isHost && mode === 'multiplayer' && (
          <HStack gap={1} justify="between">
            <Button variant="ghost" label={t('play.endMatch')} isDisabled={controlPending} onClick={onFinish} />
            <Button
              variant="ghost"
              label={lastQuestion ? t('play.showResults') : t('play.skipQuestion')}
              isDisabled={controlPending}
              onClick={onAdvance}
            />
          </HStack>
        )}

        {isPresenter && (
          <VStack gap={1.5}>
            <Text type="supporting" size="xsm" color="secondary">
              {t('play.liveAnswers', { count: answeredCount, total: playerCount })}
            </Text>

            {hasKey && (showKey ? (
              <Text type="supporting" size="xsm" weight="semibold">
                {t('play.correctAnswerIs', { letter: String.fromCharCode(65 + q.correct_index!), option: q.options[q.correct_index!] ?? '' })}
              </Text>
            ) : (
              <HStack gap={1} justify="between" align="center" width="100%" wrap="wrap">
                <Text type="supporting" size="xsm" color="secondary">
                  {noLimit ? t('play.answerHiddenUntimed') : t('play.answerHiddenTimed')}
                </Text>
                <Button variant="secondary" label={t('play.revealAnswer')} isDisabled={controlPending} onClick={onReveal} />
              </HStack>
            ))}

            <DistributionChart options={q.options} buckets={buckets} correctIndex={showKey ? q.correct_index : undefined} />

            {distributionStale && <Banner status="warning" title={t('play.distributionUnavailable')} />}

            <HStack gap={1} justify="between">
              <Button variant="secondary" label={t('play.endMatch')} isDisabled={controlPending} onClick={onFinish} />
              <Button
                variant="primary"
                label={lastQuestion ? t('play.showResults') : t('play.nextQuestion')}
                isDisabled={controlPending}
                onClick={onAdvance}
              />
            </HStack>
          </VStack>
        )}

        <Divider />
        <ScoreboardList scoreboard={scoreboard} note={mode === 'classroom' ? t('play.scoreboardOnClose') : undefined} />
      </VStack>
    </Card>
    </div>
  );
}

function ScoreboardList({ scoreboard, note }: { scoreboard: ScoreboardEntry[]; note?: string }) {
  const t = useT();
  if (scoreboard.length === 0) return null;
  return (
    <VStack gap={1}>
      <Text type="label" weight="bold" color="secondary">
        {t('play.liveScoreboard')}
      </Text>
      {note && (
        <Text type="supporting" size="xsm" color="secondary">
          {note}
        </Text>
      )}
      <ol
        aria-label={t('play.liveScoreboard')}
        style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}
      >
        {scoreboard.map((s, i) => (
          <li
            key={s.user_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 8,
              background: i === 0 ? 'color-mix(in srgb, var(--brand-accent) 10%, transparent)' : 'transparent',
            }}
          >
            <span
              style={{
                width: 24,
                textAlign: 'center',
                fontWeight: 700,
                fontSize: i < 3 ? '1rem' : '0.8rem',
                color: i === 0 ? 'var(--brand-accent)' : 'inherit',
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Text weight="medium">{s.display_name}</Text>
            </div>
            <span style={{ fontWeight: 700 }}>{s.score ?? s.correct}</span>
            <span style={{ fontSize: '0.75rem', opacity: 0.65, whiteSpace: 'nowrap', flexShrink: 0 }}>
              {s.score != null ? `${s.correct} ${t('play.correctShort')} · ` : ''}{(s.total_ms / 1000).toFixed(1)} s
            </span>
          </li>
        ))}
      </ol>
    </VStack>
  );
}

// Presentational histogram of the current question's answers; the buckets are
// polled by RunningQuestion, which shares them with the live answered-count.
function DistributionChart({
  options,
  buckets,
  correctIndex,
}: {
  options: string[];
  buckets: DistributionBucket[];
  correctIndex?: number;
}) {
  const t = useT();
  const total = buckets.reduce((sum, b) => sum + b.count, 0) || 1;

  return (
    <VStack gap={1}>
      <Text type="label" weight="bold" color="secondary">
        {t('play.classAnswers')}
      </Text>
      <VStack gap={1}>
        {options.map((opt, i) => {
          const b = buckets.find((x) => x.selected_idx === i);
          const count = b?.count ?? 0;
          const pct = (count / total) * 100;
          const isCorrect = correctIndex === i;
          return (
            <HStack key={i} gap={1} align="center">
              <span
                data-correct={isCorrect || undefined}
                style={{
                  width: 18,
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  color: isCorrect ? 'var(--brand-accent)' : 'inherit',
                  flexShrink: 0,
                }}
              >
                {String.fromCharCode(65 + i)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <VStack gap={0.5}>
                  <Text type="supporting" size="xsm">
                    {opt}
                  </Text>
                  <ProgressBar
                    label={opt}
                    isLabelHidden
                    value={pct}
                    variant={isCorrect ? 'accent' : 'neutral'}
                  />
                </VStack>
              </div>
              <span style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.8rem' }}>
                {count}
              </span>
            </HStack>
          );
        })}
      </VStack>
    </VStack>
  );
}

function Finished({
  match,
  scoreboard,
  onLeave,
}: {
  match: Match;
  scoreboard: ScoreboardEntry[];
  onLeave: () => void;
}) {
  const t = useT();
  // Move focus to the heading when the match ends so AT announces the result
  // (same pattern as the Quiz/Challenge completion screens).
  const headingRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  // A room that finished without ever starting is a lobby its host left.
  const hostLeft = !match.started_at;
  // Nobody scored, so nobody won: first place would only be the fastest zero.
  const top = scoreboard[0];
  const hasWinner = !!top && (top.score ?? top.correct) > 0;
  if (hostLeft) {
    return (
      <div className="ss-raised ss-pop" style={{ display: 'flex', width: '100%' }}>
        <Card padding={5} width="100%">
          <VStack gap={2} align="center">
            <div ref={headingRef} tabIndex={-1}>
              <Heading level={1} type="display-3" justify="center">
                {t('play.hostLeftTitle')}
              </Heading>
            </div>
            <Text color="secondary" justify="center">{t('play.hostLeftBody')}</Text>
            <Button variant="primary" size="lg" label={t('common.back')} onClick={onLeave} />
          </VStack>
        </Card>
      </div>
    );
  }
  return (
    <div className="ss-raised ss-pop" style={{ display: 'flex', width: '100%' }}>
    <Card padding={5} width="100%">
      <VStack gap={3} align="center">
        <VStack gap={1.5} align="center">
          <div ref={headingRef} tabIndex={-1}>
            <Heading level={1} type="display-3" justify="center">
              {t('play.matchComplete')}
            </Heading>
          </div>
          {hasWinner && (
            <div
              style={{
                borderRadius: 999,
                padding: '6px 16px',
                fontWeight: 700,
                color: 'var(--brand-accent)',
                background: 'color-mix(in srgb, var(--brand-accent) 14%, transparent)',
                textAlign: 'center',
              }}
            >
              {t('play.winner', {
                name: top.display_name,
                correct: top.correct,
                total: questionCountOf(match),
              })}
            </div>
          )}
        </VStack>
        <div style={{ width: '100%', textAlign: 'left' }}>
          <ScoreboardList scoreboard={scoreboard} />
        </div>
        <Button variant="primary" size="lg" label={t('common.back')} onClick={onLeave} />
      </VStack>
    </Card>
    </div>
  );
}

export default PlayLanding;
