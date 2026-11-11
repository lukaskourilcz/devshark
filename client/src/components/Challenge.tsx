import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/VStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Banner } from '@astryxdesign/core/Banner';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AppToast } from './ui/AppToast';
import { ApiError, apiFetch, friendlyError } from '../lib/api';
import {
  fetchChallengeBatch,
  completeChallengeRun,
  type ChallengeLeaderboard,
} from '../lib/challengeApi';
import { challengeLeaderboardQuery, useChallengeLeaderboard } from '../lib/queries';
import { readOnce, settled, useFirstData } from '../lib/routeData';
import type { Question, QuizResult } from '../types/quiz';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../lib/auth';
import { useActiveSubject, useSubject, deliveryCategoriesForSubject } from '../lib/subjects';
import { visuallyHidden } from '../theme/MuiTheme';
import { MotionPop } from '../lib/motion';
import { SharkFin } from './SharkFin';
import { renderQuestion } from './CodeBlock';
import { QuoteLoader, holdLoadingScreen } from './LoadingScreen';
import { announceVerifiedQuestXp, announceXpHeld, awardQuestXp, syncXpWithServer } from '../lib/xp';
import { challengeRunXp } from '../../../shared/progression';
import type { QuestionXpHeld } from '../../../shared/repeat-xp';
import { SwimCta } from './landing/LandingKit';
import { readJSON, writeJSON, removeStored } from '../lib/storage';
import { accountEpoch } from '../lib/accountData';
import { staleProfileStats } from '../lib/queryClient';
import './Challenge.css';
import {
  AnswerOptionList,
  ExitIcon,
  QuestionActions,
  QuestionFeedback,
  QuestionHeader,
  QuestionHint,
  QuestionIconButton,
  QuestionShell,
  ReportFlagIcon,
} from './question';
import { categoryLabelKey } from '../lib/categories';
import { CategoryTag, TopicPill } from './ui/CategoryTag';
import { PageHeader } from './ui/PageHeader';
import ResultShareActions from './ResultShareActions';
import ReferralMoment from './ReferralMoment';
import { SaveSharkCard } from './SaveSharkCard';
import { ReportDialog, type ReportReason } from './ReportDialog';
import { reportQuestion } from '../lib/supabase';

// Biggest Shark Challenge: answer as many questions as you can until you
// collect three strikes. Each question carries its own 90-second clock —
// letting it run out costs a fin, just like a wrong answer. Score = correct
// answers. Mix of all categories and difficulties. The page keeps its own
// state machine separate from the regular Quiz component.

type Phase = 'intro' | 'loading' | 'playing' | 'gameover' | 'error';

const MAX_LIVES = 3;
const LOW_BATCH_THRESHOLD = 4; // top up the buffer when this few remain
const TIME_LIMIT_S = 90; // each question is capped at 90 seconds
const LOW_TIME_S = 15; // highlight + pulse the clock under this many seconds
// A batch's session is sealed for an hour (lib/quiz-tokens.ts). No question is
// shown from a batch older than this, so its answer
// reaches the server while that session still grades it.
const STALE_BATCH_MS = 50 * 60 * 1000;
// A timeout strike the network or the rate limit refused is sent again after
// a pause that doubles each time, up to the cap.
const STRIKE_RETRY_MS = 2_000;
const STRIKE_RETRY_MAX_MS = 30_000;
// Finished runs whose reward has not reached the server yet. The first
// version held one run; a list is kept now, and both shapes parse.
const PENDING_CHALLENGE_KEY = 'studyshark:pending-challenge-reward:v1';
const MAX_PENDING_REWARDS = 20;
// Completion refusals that no retry can change: an expired or foreign run, or
// proofs that do not make a finished run. Such a run leaves the list.
const PERMANENT_REWARD_ERRORS = new Set(['invalid_run', 'invalid_run_scope', 'incomplete_run', 'invalid_proof', 'bad_request']);

interface PendingChallengeReward {
  userId: string | null;
  runToken: string;
  proofs: string[];
}

function readPendingRewards(): PendingChallengeReward[] {
  const raw = readJSON<unknown>(PENDING_CHALLENGE_KEY, null);
  const list: unknown[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((one): one is PendingChallengeReward => {
    const run = one as Partial<PendingChallengeReward> | null;
    return !!run && (run.userId === null || typeof run.userId === 'string') && typeof run.runToken === 'string' && Array.isArray(run.proofs);
  });
}

function writePendingRewards(list: PendingChallengeReward[]): void {
  if (list.length === 0) removeStored(PENDING_CHALLENGE_KEY);
  else writeJSON(PENDING_CHALLENGE_KEY, list.slice(-MAX_PENDING_REWARDS));
}

const dropPendingReward = (runToken: string) =>
  writePendingRewards(readPendingRewards().filter((run) => run.runToken !== runToken));

/** Send each saved run of this learner to the completion step. A run that
 * lands, or that can never land, leaves the list; one the network or the rate
 * limit turned away stays for the next try. `held` counts the right answers
 * whose question paid XP less than an hour ago (migration 060), with the time
 * the last of them pays again. The sending stops when the account signs
 * out: the rest are no longer this browser's to send. */
async function sendPendingRewards(userId: string | null): Promise<{ kept: number; xp: number; held: QuestionXpHeld | null; accountSaved: boolean }> {
  const epoch = accountEpoch();
  let kept = 0;
  let accountSaved = false;
  let xp = 0;
  let held = null as QuestionXpHeld | null;
  for (const run of readPendingRewards().filter((one) => one.userId === userId)) {
    if (accountEpoch() !== epoch) break;
    try {
      const res = await completeChallengeRun({ runToken: run.runToken, proofs: run.proofs });
      if (userId && res.score > 0) accountSaved = true;
      if (userId && res.awarded) xp += res.xp ?? 0;
      if (res.xpHeld) {
        held = {
          questions: (held?.questions ?? 0) + res.xpHeld.questions,
          availableAt: held && held.availableAt > res.xpHeld.availableAt ? held.availableAt : res.xpHeld.availableAt,
        };
      }
      dropPendingReward(run.runToken);
    } catch (err) {
      // 409: the run is already on the board with another result, and
      // sending it again is refused the same way.
      if (err instanceof ApiError && ((err.status === 400 && PERMANENT_REWARD_ERRORS.has(err.code ?? '')) || (err.status === 409 && err.code === 'run_already_saved'))) {
        dropPendingReward(run.runToken);
        continue;
      }
      kept += 1;
      // Offline or rate limited: the rest would be turned away the same way.
      if (err instanceof ApiError && (err.status === 0 || err.status === 429)) break;
    }
  }
  return { kept, xp, held, accountSaved };
}

/** The batch session that issued the question can no longer grade it: it
 * expired, or the answer reached a session the question is not in. */
const isSessionRefusal = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 400 &&
  (err.code === 'invalid_session' || /outside this session/i.test(err.message));

/** A refusal worth sending again later: offline, rate limited, or a server fault. */
const isRetryable = (err: unknown): boolean =>
  !(err instanceof ApiError) || err.status === 0 || err.status === 429 || err.status >= 500;

function gradeChallengeAnswer(sessionId: string, questionId: string, selectedIndex: number, signal: AbortSignal) {
  return apiFetch<QuizResult>('/api/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({ sessionId, answers: { [questionId]: selectedIndex } }),
    signal,
  });
}

/** Seconds → "m:ss" (e.g. 90 → "1:30"). Clamps negatives to 0. */
const fmtClock = (s: number): string => {
  const safe = Math.max(0, s);
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
};

interface AnsweredQ {
  questionId: string;
  selectedIndex: number;
  correctAnswer: number;
  isCorrect: boolean;
  explanation: string;
  question: Question;
  /** True when the strike came from the per-question clock hitting zero. */
  timedOut?: boolean;
  /** Set when the answer does not count either way: the question was
   * retired mid-run, or its batch session expired before it was graded. No
   * strike, no point, no proof. */
  notCounted?: 'retired' | 'expired';
}

interface BufferedQuestion {
  question: Question;
  /** The batch session that issued the question, and so the one that grades it. */
  sessionId: string;
  receivedAt: number;
}

interface BufferState {
  queue: BufferedQuestion[];
}

/** Ids still queued, so a refill does not repeat them. */
const queuedIds = (buffer: BufferState | null): string[] => buffer?.queue.map((entry) => entry.question.id) ?? [];

/** The board line beside the intro, in the cache before the first render: it
 * used to fill in after the page. It is best-effort, so the wait is the usual
 * capped one and a failed read draws the page with its own notice. */
function useBoardFirstData() {
  const queryClient = useQueryClient();
  const [subject] = useSubject();
  useFirstData(`challenge ${subject}`, () => settled([readOnce(queryClient, challengeLeaderboardQuery(subject))]));
}

export default function Challenge({ onActiveChange }: { onActiveChange?: (active: boolean) => void } = {}) {
  useBoardFirstData();
  const { t } = useLanguage();
  const { user } = useAuth();
  const accent = useActiveSubject().accent;

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const timeLimitS = TIME_LIMIT_S;
  const availableTopics = deliveryCategoriesForSubject('webdev');
  const [topics, setTopics] = useState<string[]>(availableTopics);
  const runTopics = useRef<string[]>(availableTopics);

  // Leaderboard preview (intro screen + game-over) via TanStack Query.
  const boardQuery = useChallengeLeaderboard();
  const board: ChallengeLeaderboard | null = boardQuery.data ?? null;
  const boardLoading = boardQuery.isPending;

  // Active run state.
  const [score, setScore] = useState(0);
  const [livesLost, setLivesLost] = useState(0);
  const [seenIds, setSeenIds] = useState<string[]>([]);
  const [current, setCurrent] = useState<Question | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<AnsweredQ | null>(null);
  // Every graded miss of the run, for the game-over review (owner decision
  // 12): each can be saved as a Shark Card with its answer and explanation.
  const [missed, setMissed] = useState<AnsweredQ[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // One grade at a time, for a pick or the timeout. `submitting` reaches the
  // handlers only after a render, and a second Enter or press in that gap
  // sent the pick again: the server replays a pick's grade, so the point or
  // the strike counted twice.
  const gradingRequest = useRef<AbortController | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  // The question's deadline, set when it is shown. The clock counts down to
  // it rather than counting ticks, so time the page spends in the background
  // (a phone switched to another app) counts too. `clockNow` is when the
  // clock was last read; it stops while the feedback card is up.
  const [deadline, setDeadline] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const timeLeft = deadline > 0 ? Math.max(0, Math.ceil((deadline - clockNow) / 1000)) : timeLimitS;

  // Buffered question batches: we always keep one round of questions ready so
  // the next question appears instantly after each grade.
  const buffer = useRef<BufferState | null>(null);
  // The batch session of the question on screen: a refill brings a new
  // session, and the question already shown still belongs to the old one.
  const currentSessionRef = useRef('');
  const runTokenRef = useRef('');
  const scoreProofsRef = useRef<string[]>([]);
  // A refill in flight resolves to null when its batch landed, or to the
  // message of the error that stopped it.
  const topupInFlight = useRef<Promise<string | null> | null>(null);
  const topupAbort = useRef<AbortController | null>(null);
  // Bumped by every new run. A refill that returns after its run ended ("Play
  // again" pressed while it was in flight) carries the old run's token and
  // questions, and is dropped.
  const runGeneration = useRef(0);
  const cancelRunRequests = useCallback(() => {
    runGeneration.current += 1;
    topupAbort.current?.abort();
    topupAbort.current = null;
    topupInFlight.current = null;
    gradingRequest.current?.abort();
    gradingRequest.current = null;
  }, []);
  useEffect(() => cancelRunRequests, [cancelRunRequests]);
  // Set when the queue ran dry and the refill failed: the run is kept, and
  // Retry asks for the batch again under the same run.
  const [refillError, setRefillError] = useState<string | null>(null);
  const [refilling, setRefilling] = useState(false);
  // One move to the next question at a time, held until that question has
  // rendered. A second press of Next before then popped another one, and the
  // question between them was skipped unseen.
  const advancingRef = useRef(false);
  // The picks sent for the question on screen, in order. The server grades a
  // question once: when the response to a graded pick is lost, another pick
  // (or the timeout) is refused as already graded, and sending the earlier
  // pick again replays its grade and proof.
  const sentPicks = useRef<{ questionId: string; picks: number[] }>({ questionId: '', picks: [] });
  // Guards the once-per-run XP/token payout on game over.
  const awardedRef = useRef(false);
  // The timeout strike goes out once per question. A refusal worth retrying
  // is sent again after a growing pause, never on every render.
  const strikeSentFor = useRef<string | null>(null);
  const strikeRetry = useRef<{ timer: number | null; attempt: number }>({ timer: null, attempt: 0 });
  const [strikeWake, setStrikeWake] = useState(0);
  const [strikeWaiting, setStrikeWaiting] = useState(false);

  const clearStrikeRetry = useCallback(() => {
    if (strikeRetry.current.timer !== null) window.clearTimeout(strikeRetry.current.timer);
    strikeRetry.current = { timer: null, attempt: 0 };
    strikeSentFor.current = null;
    setStrikeWaiting(false);
  }, []);
  useEffect(() => clearStrikeRetry, [clearStrikeRetry]);

  // Saved rewards go out one after another, so a sync started at game over
  // never races the one started on arrival.
  const rewardSync = useRef<Promise<void>>(Promise.resolve());
  const syncRewards = useCallback((userId: string | null) => {
    rewardSync.current = rewardSync.current.then(async () => {
      const epoch = accountEpoch();
      const { kept, xp, held, accountSaved } = await sendPendingRewards(userId);
      // Signed out while the runs were on their way: what they earned is not
      // news for whoever is here now, and its rank marker is not theirs.
      if (accountEpoch() !== epoch) return;
      if (xp > 0) announceVerifiedQuestXp(xp);
      if (held) announceXpHeld({ on: 'questions', count: held.questions, availableAt: held.availableAt });
      if (accountSaved) {
        // A replay can confirm an award committed before the connection failed.
        // Refresh the account without announcing the same gain twice.
        staleProfileStats();
        await syncXpWithServer({ announceRankUp: xp > 0 });
        if (accountEpoch() !== epoch) return;
      }
      if (kept > 0) setSnack(t('challenge.rewardPending'));
      else void boardQuery.refetch();
    });
    return rewardSync.current;
  }, [t, boardQuery.refetch]);

  useEffect(() => {
    void syncRewards(user?.id ?? null);
  }, [syncRewards, user?.id]);
  useEffect(() => {
    const retry = () => { if (readPendingRewards().some(run => run.userId === (user?.id ?? null))) void syncRewards(user?.id ?? null); };
    window.addEventListener('online', retry);
    window.addEventListener('focus', retry);
    return () => { window.removeEventListener('online', retry); window.removeEventListener('focus', retry); };
  }, [syncRewards, user?.id]);
  // Back on the intro from a run (Exit, or Back after the game over), the h1
  // takes the focus the pressed button had.
  const introHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const leftIntro = useRef(false);
  useEffect(() => {
    if (phase !== 'intro') { leftIntro.current = true; return; }
    if (leftIntro.current) introHeadingRef.current?.focus();
  }, [phase]);
  // Focus target when the run ends, so AT users hear the transition.
  const gameOverHeadingRef = useRef<HTMLDivElement | null>(null);
  // Each new question takes the focus. Start unmounts with the intro, and
  // Next turns into a Submit that is disabled until a pick, so focus fell to
  // the page and a screen reader heard nothing of the question.
  const questionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (phase === 'playing' && current) questionRef.current?.focus({ preventScroll: true });
  }, [phase, current]);

  // The verdict's button takes the focus the clock took away. At time up the
  // focused answer or Submit disables itself, and the browser drops the focus
  // to the page, where a keyboard learner could not reach Next without
  // tabbing back through the page. Focus anywhere else is left alone.
  const actionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!lastResult) return;
    const active = document.activeElement as HTMLElement | null;
    const lost = !active || active === document.body || !active.isConnected || active.matches(':disabled');
    if (!lost) return;
    actionsRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    // Next is disabled while the next questions load: it is focused when
    // they have, if the focus is still nowhere.
  }, [lastResult, refilling]);

  const livesLeft = MAX_LIVES - livesLost;

  // A live run hides the site chrome, as the Quiz does (UX audit U2,
  // questions-07): the header and footer come back on the intro, the game
  // over and an error, and when the page goes.
  useEffect(() => {
    onActiveChange?.(phase === 'playing' || phase === 'loading');
  }, [phase, onActiveChange]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);

  // With the chrome hidden, Exit is the way out of a run. Leaving ends the
  // run where it stands and saves nothing, as leaving the page always has.
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaveRun = useCallback(() => {
    setLeaveOpen(false);
    cancelRunRequests();
    buffer.current = null;
    clearStrikeRetry();
    setCurrent(null);
    setSelected(null);
    setLastResult(null);
    setRefillError(null);
    setRefilling(false);
    setSubmitting(false);
    setDeadline(0);
    setPhase('intro');
  }, [cancelRunRequests, clearStrikeRetry]);

  // Report a question from the run, as from the Quiz.
  const [reportTarget, setReportTarget] = useState<{ id: string; version?: string } | null>(null);
  const handleReport = useCallback(async (reason: ReportReason, detail?: string) => {
    if (!reportTarget) return;
    try {
      await reportQuestion({ questionId: reportTarget.id, reason, detail, reporterSub: user?.id, contentVersion: reportTarget.version });
      setSnack(t('quiz.reportSent'));
    } catch {
      setSnack(t('quiz.reportFailed'));
    } finally {
      setReportTarget(null);
    }
  }, [reportTarget, user, t]);

  /* ─── leaderboard ───────────────────────────────────────────── */

  // Refetch the subject-scoped board after a score is submitted.

  /* ─── question buffer ───────────────────────────────────────── */

  const ensureBufferTopUp = useCallback(
    async (excluded: string[]): Promise<string | null> => {
      if (topupInFlight.current) return topupInFlight.current;
      const generation = runGeneration.current;
      const controller = new AbortController();
      topupAbort.current = controller;
      const p = (async (): Promise<string | null> => {
        try {
          const batch = await fetchChallengeBatch({
            exclude: excluded,
            runToken: runTokenRef.current || undefined,
            categories: runTopics.current,
            signal: controller.signal,
          });
          if (generation !== runGeneration.current) return null;
          runTokenRef.current = batch.runToken;
          // Append to what is still queued. Each question keeps the session
          // that issued it, and is graded against that session.
          const receivedAt = Date.now();
          const queued = buffer.current?.queue ?? [];
          const known = new Set(queued.map((entry) => entry.question.id));
          buffer.current = {
            queue: [
              ...queued,
              ...batch.questions
                .filter((question) => !known.has(question.id))
                .map((question) => ({ question, sessionId: batch.sessionId, receivedAt })),
            ],
          };
          return null;
        } catch (err) {
          if (generation !== runGeneration.current) return null;
          // A run that has no question yet cannot start: say why. Later
          // refills keep what is queued, and a dry queue offers Retry.
          if (!buffer.current) {
            setPhase('error');
            setError(friendlyError(err));
          }
          return friendlyError(err);
        }
      })();
      topupInFlight.current = p;
      try {
        return await p;
      } finally {
        if (topupInFlight.current === p) {
          topupInFlight.current = null;
          topupAbort.current = null;
        }
      }
    },
    [],
  );

  const popNext = useCallback((): BufferedQuestion | null => {
    const buf = buffer.current;
    if (!buf) return null;
    // A question from a batch near the end of its session's hour is skipped:
    // its answer could no longer be graded.
    while (buf.queue.length > 0 && Date.now() - buf.queue[0].receivedAt > STALE_BATCH_MS) buf.queue.shift();
    return buf.queue.shift() ?? null;
  }, []);

  const showQuestion = useCallback((next: BufferedQuestion) => {
    clearStrikeRetry();
    currentSessionRef.current = next.sessionId;
    sentPicks.current = { questionId: next.question.id, picks: [] };
    setCurrent(next.question);
    // Fresh question, fresh clock.
    const shownAt = Date.now();
    setDeadline(shownAt + timeLimitS * 1000);
    setClockNow(shownAt);
  }, [clearStrikeRetry, timeLimitS]);

  // The question a Next press moved to is on screen: the next press is its own.
  useEffect(() => { advancingRef.current = false; }, [current]);

  /* ─── game flow ─────────────────────────────────────────────── */

  const startRun = useCallback(async () => {
    if (topics.length === 0) return;
    runTopics.current = [...topics];
    // Any pending request still belongs to the run that ended.
    cancelRunRequests();
    const generation = runGeneration.current;
    setPhase('loading');
    setError(null);
    setRefillError(null);
    setRefilling(false);
    setSubmitting(false);
    setScore(0);
    setLivesLost(0);
    setSeenIds([]);
    setSelected(null);
    setLastResult(null);
    setMissed([]);
    setDeadline(0);
    awardedRef.current = false;
    runTokenRef.current = '';
    scoreProofsRef.current = [];
    buffer.current = null;
    const startedAt = Date.now();
    await ensureBufferTopUp([]);
    await holdLoadingScreen(startedAt);
    if (generation !== runGeneration.current) return;
    if (!buffer.current) return; // ensureBufferTopUp already set the error phase
    const next = popNext();
    if (!next) {
      setPhase('error');
      setError(t('challenge.noQuestions'));
      return;
    }
    showQuestion(next);
    setSeenIds([next.question.id]);
    setPhase('playing');
  }, [cancelRunRequests, ensureBufferTopUp, popNext, showQuestion, t, topics]);

  const advance = useCallback(
    async (becameGameOver: boolean) => {
      if (becameGameOver) {
        setPhase('gameover');
        return;
      }
      if (advancingRef.current) return;
      advancingRef.current = true;
      let moved = false;
      const generation = runGeneration.current;
      try {
        // Eagerly refill so the next question is ready before we render it.
        const remaining = buffer.current?.queue.length ?? 0;
        if (remaining <= LOW_BATCH_THRESHOLD && !topupInFlight.current) {
          // fire-and-forget; the next pop below uses whatever's available
          void ensureBufferTopUp([...seenIds, ...queuedIds(buffer.current)]);
        }
        let next = popNext();
        let failure: string | null = null;
        if (!next) {
          // Buffer ran dry while topping up — await it.
          setRefilling(true);
          try {
            failure = await ensureBufferTopUp([...seenIds, ...queuedIds(buffer.current)]);
          } finally {
            if (generation === runGeneration.current) setRefilling(false);
          }
          if (generation !== runGeneration.current) return;
          next = popNext();
        }
        if (!next) {
          // Offline, rate limited or a server fault. The run, its score and
          // its proofs stay; the graded card stays up and Retry asks again.
          setRefillError(failure ?? t('challenge.noQuestions'));
          return;
        }
        setRefillError(null);
        showQuestion(next);
        moved = true;
        // Cap the seen-ids list so a long run doesn't grow the `exclude`
        // query string without bound. The server caps at 500 already; we keep
        // the most recent 300 client-side to keep `advance` and the request
        // payload light.
        const shown = next.question.id;
        setSeenIds((prev) => [...prev, shown].slice(-300));
        setSelected(null);
        setLastResult(null);
      } finally {
        if (!moved && generation === runGeneration.current) advancingRef.current = false;
      }
    },
    [ensureBufferTopUp, popNext, seenIds, showQuestion, t],
  );

  // Record the server's grade for the question on screen. A question retired
  // after its batch was issued comes back void: it neither scores nor strikes,
  // and it carries no proof.
  const applyGrade = useCallback((question: Question, selectedIndex: number, result: QuizResult, timedOut: boolean) => {
    const graded = result.results.find((one) => one.questionId === question.id);
    if (!graded || result.voided?.includes(question.id)) {
      setLastResult({ questionId: question.id, selectedIndex, correctAnswer: -1, isCorrect: false, explanation: '', question, notCounted: 'retired' });
      return;
    }
    const answered: AnsweredQ = {
      questionId: question.id,
      selectedIndex,
      correctAnswer: graded.correctAnswer,
      isCorrect: graded.isCorrect,
      explanation: graded.explanation,
      question,
      ...(timedOut ? { timedOut: true } : {}),
    };
    setLastResult(answered);
    if (!graded.isCorrect) setMissed((list) => [...list.filter((one) => one.questionId !== question.id), answered]);
    if (graded.isCorrect) setScore((s) => s + 1);
    else setLivesLost((l) => l + 1);
    if (graded.scoreProof) scoreProofsRef.current.push(graded.scoreProof);
  }, []);

  // The session that issued this question cannot grade it any more, so the
  // question does not count. Its batch leaves the queue, and moving on asks
  // for a fresh batch under the same run.
  const expireQuestion = useCallback((question: Question, selectedIndex: number, sessionId: string) => {
    if (buffer.current) {
      buffer.current = { queue: buffer.current.queue.filter((entry) => entry.sessionId !== sessionId) };
    }
    setLastResult({ questionId: question.id, selectedIndex, correctAnswer: -1, isCorrect: false, explanation: '', question, notCounted: 'expired' });
  }, []);

  // Grade a pick (-1 is the timeout). When the server already graded an
  // earlier pick for this question, whose response never arrived, it refuses
  // this one; the earlier picks are sent again, first one first, and the one
  // the server replays is the grade that counts, with its proof.
  const gradeOrReplay = useCallback(async (sessionId: string, question: Question, pick: number, signal: AbortSignal) => {
    const sent = sentPicks.current.questionId === question.id ? sentPicks.current : { questionId: question.id, picks: [] };
    sentPicks.current = sent;
    const earlier = sent.picks.filter((one) => one !== pick);
    if (!sent.picks.includes(pick)) sent.picks.push(pick);
    const alreadyGraded = (err: unknown) => err instanceof ApiError && err.code === 'attempt_already_graded';
    try {
      return { pick, result: await gradeChallengeAnswer(sessionId, question.id, pick, signal) };
    } catch (err) {
      if (signal.aborted || !alreadyGraded(err)) throw err;
      for (const one of earlier) {
        try {
          return { pick: one, result: await gradeChallengeAnswer(sessionId, question.id, one, signal) };
        } catch (again) {
          if (signal.aborted || !alreadyGraded(again)) throw again;
        }
      }
      throw err;
    }
  }, []);

  const submitAnswer = useCallback(async () => {
    if (selected == null || !current || gradingRequest.current || timeLeft <= 0) return;
    const request = new AbortController();
    gradingRequest.current = request;
    const question = current;
    const sessionId = currentSessionRef.current;
    setSubmitting(true);
    try {
      const { pick, result } = await gradeOrReplay(sessionId, question, selected, request.signal);
      if (request.signal.aborted) return;
      if (pick !== selected) setSelected(pick);
      applyGrade(question, pick, result, false);
    } catch (err) {
      if (request.signal.aborted) return;
      if (isSessionRefusal(err)) expireQuestion(question, selected, sessionId);
      else setSnack(friendlyError(err));
    } finally {
      if (gradingRequest.current === request) {
        gradingRequest.current = null;
        setSubmitting(false);
      }
    }
  }, [selected, current, timeLeft, applyGrade, expireQuestion, gradeOrReplay]);

  const onContinue = useCallback(() => {
    const willGameOver = lastResult ? !lastResult.notCounted && !lastResult.isCorrect && livesLost >= MAX_LIVES : false;
    void advance(willGameOver);
  }, [advance, lastResult, livesLost]);

  // The per-question clock ran out before an answer was locked in. That costs a
  // fin, exactly like a wrong answer; the graded feedback card then lets the
  // learner continue (or ends the run if it was the third strike).
  const handleTimeout = useCallback(async () => {
    if (!current || lastResult || submitting || gradingRequest.current || strikeSentFor.current === current.id) return;
    const request = new AbortController();
    gradingRequest.current = request;
    strikeSentFor.current = current.id;
    const question = current;
    const sessionId = currentSessionRef.current;
    setSubmitting(true);
    try {
      // A timeout is graded as an explicit server-proven strike. This prevents
      // ranked clients from omitting timeouts from the final proof set.
      // A pick the server graded before the clock ran out is replayed and
      // counts as that answer, not as a timeout.
      const { pick, result } = await gradeOrReplay(sessionId, question, -1, request.signal);
      if (request.signal.aborted) return;
      if (pick !== -1) setSelected(pick);
      applyGrade(question, pick, result, pick === -1);
      setStrikeWaiting(false);
    } catch (err) {
      if (request.signal.aborted) return;
      if (isSessionRefusal(err)) {
        setStrikeWaiting(false);
        expireQuestion(question, -1, sessionId);
      } else if (isRetryable(err)) {
        // Offline, rate limited or a server fault: send it again after a
        // pause. Re-sending at once spent the shared rate bucket in a loop.
        const attempt = strikeRetry.current.attempt;
        strikeRetry.current.attempt = attempt + 1;
        strikeRetry.current.timer = window.setTimeout(() => {
          strikeRetry.current.timer = null;
          strikeSentFor.current = null;
          setStrikeWake((n) => n + 1);
        }, Math.min(STRIKE_RETRY_MAX_MS, STRIKE_RETRY_MS * 2 ** attempt));
        setStrikeWaiting(true);
      } else {
        // Refused for good: no proof comes back, but the clock did run out,
        // so the fin is lost here and the run goes on.
        setStrikeWaiting(false);
        setLivesLost((l) => l + 1);
        setLastResult({ questionId: question.id, selectedIndex: -1, correctAnswer: -1, isCorrect: false, explanation: '', question, timedOut: true });
      }
    } finally {
      if (gradingRequest.current === request) {
        gradingRequest.current = null;
        setSubmitting(false);
      }
    }
  }, [current, lastResult, submitting, applyGrade, expireQuestion, gradeOrReplay]);

  /* ─── countdown clock ───────────────────────────────────────── */

  // Each question is capped at TIME_LIMIT_S from the moment it is shown. Read
  // the clock each time the shown second changes while the learner is still
  // working on the current question; pause once it's graded (the feedback
  // card is up) so reading the explanation doesn't burn the next question's
  // time. The time left is counted from the deadline, so a page whose timers
  // were held in the background reads the right time when it comes back.
  // When the clock hits zero unanswered, it's a timeout strike; handleTimeout
  // sends it once, and `strikeWake` brings a delayed retry here.
  useEffect(() => {
    if (phase !== 'playing' || lastResult) return;
    if (timeLeft <= 0) {
      void handleTimeout();
      return;
    }
    const untilNextSecond = deadline - Date.now() - (timeLeft - 1) * 1000;
    const id = setTimeout(() => setClockNow(Date.now()), Math.max(0, untilNextSecond));
    return () => clearTimeout(id);
  }, [phase, timeLeft, lastResult, handleTimeout, strikeWake, deadline, clockNow]);

  /* ─── reward on game over ───────────────────────────────────── */

  // A finished run pays five XP per server-proven correct answer (and tokens,
  // which follow from XP). Signed in, the run joins the saved list and the
  // server credits it; every saved run is sent again now, so one that failed
  // earlier is not left behind by the next. Signed out, the same amount is
  // kept in this browser. Guarded so it pays exactly once per run.
  useEffect(() => {
    if (phase === 'gameover' && !awardedRef.current) {
      awardedRef.current = true;
      if (score > 0 && runTokenRef.current) {
        writePendingRewards([
          ...readPendingRewards().filter(run => run.runToken !== runTokenRef.current),
          { userId: user?.id ?? null, runToken: runTokenRef.current, proofs: [...scoreProofsRef.current] },
        ]);
        void syncRewards(user?.id ?? null);
      }
      if (!user) awardQuestXp(challengeRunXp(score), 'quiz');
    }
  }, [phase, score, user, syncRewards]);
  // Announce the run's end to AT by moving focus to the game-over heading,
  // once per game over. In the effect above it ran again on every new user
  // object (a token refresh, a return to the tab) and took the focus back
  // from Play again or the name field.
  useEffect(() => {
    if (phase !== 'gameover') return;
    const frame = requestAnimationFrame(() => gameOverHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  /* ─── keyboard during play ──────────────────────────────────── */

  // The run's keys rest while the leave or report dialog is open: a digit or
  // Enter pressed in the dialog must not pick an answer or move on behind it.
  const dialogOpen = leaveOpen || reportTarget !== null;
  useEffect(() => {
    if (phase !== 'playing' || !current || dialogOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], [role="radio"], [role="checkbox"], [role="dialog"], [role="alertdialog"]')) return;
      if (lastResult) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onContinue();
        }
        return;
      }
      if (timeLeft <= 0) return;
      if (/^[1-9]$/.test(e.key)) {
        if (!target || !questionRef.current?.closest('.ss-question')?.contains(target)) return;
        const idx = parseInt(e.key, 10) - 1;
        if (idx < current.options.length) {
          e.preventDefault();
          setSelected(idx);
        }
      } else if (e.key === 'Enter' && selected != null) {
        e.preventDefault();
        void submitAnswer();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, current, selected, lastResult, submitAnswer, onContinue, timeLeft, dialogOpen]);

  /* ─── render ────────────────────────────────────────────────── */

  const livesIndicator = useMemo(
    () => (
      // An image of the fins: a name on a plain div is not read out.
      <div
        role="img"
        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        aria-label={t('challenge.livesAria', { left: livesLeft })}
      >
        {Array.from({ length: MAX_LIVES }).map((_, i) => (
          <span key={i} style={{ display: 'inline-flex', opacity: i < livesLeft ? 1 : 0.2 }}>
            <SharkFin size={20} color={i < livesLeft ? 'var(--brand-accent)' : 'var(--color-text-disabled)'} />
          </span>
        ))}
      </div>
    ),
    [livesLeft, t],
  );

  if (phase === 'intro') {
    const allTopics = topics.length === availableTopics.length;
    return (
      // The Quiz setup's layout (UX audit U2, questions-10): one 640px column,
      // the h1 and lead above one panel of topic pills and Start, and the top
      // scores as a short list under it instead of a half-empty side column.
      <div className="ss-pop challenge-setup">
        <PageHeader title={t('challenge.title')} lead={t('challenge.description')} titleRef={introHeadingRef} />

        <div className="ss-panel challenge-setup__panel">
          <div className="challenge-setup__group">
            <div className="challenge-setup__label-row">
              <span id="challenge-topics-label" className="challenge-setup__label">{t('challenge.topics')}</span>
              <span className="ss-text-links">
                <button type="button" onClick={() => setTopics(allTopics ? [] : availableTopics)}>
                  {allTopics ? t('quiz.deselectAll') : t('quiz.selectAll')}
                </button>
              </span>
            </div>
            <div role="group" aria-labelledby="challenge-topics-label" className="ss-topic-pills">
              {availableTopics.map(category => <TopicPill key={category} category={category} selected={topics.includes(category)} onClick={() => setTopics(old => old.includes(category) ? old.filter(value => value !== category) : [...old, category])} />)}
            </div>
            {/* Takes no line until it has something to say. */}
            <p id="challenge-topics-why" role="status" className="challenge-setup__error">
              {topics.length === 0 ? t('challenge.noTopics') : ''}
            </p>
          </div>
          {/* Start: the screen's one primary. With no topic it stays in the
              Tab order and says why under the pills. */}
          <div className="challenge-setup__start">
            <SwimCta
              label={t('challenge.startButton')}
              dir={1}
              size="md"
              unavailable={topics.length === 0}
              describedBy="challenge-topics-why"
              onClick={() => void startRun()}
            />
          </div>
        </div>

        <section className="challenge-setup__board" aria-labelledby="challenge-top-scores">
          <h2 id="challenge-top-scores" className="challenge-setup__board-title">{t('challenge.topScores')}</h2>
          {boardLoading ? (
            <Text color="secondary">…</Text>
          ) : boardQuery.isError ? (
            <Banner
              status="warning"
              title={t('challenge.boardUnavailable')}
              endContent={<Button variant="ghost" label={t('quiz.retry')} onClick={() => void boardQuery.refetch()} />}
            />
          ) : board && board.top.length > 0 ? (
            <LeaderboardList board={{ ...board, top: board.top.slice(0, 5) }} />
          ) : (
            <Text type="supporting" color="secondary">{t('challenge.noChampion')}</Text>
          )}
        </section>
      </div>
    );
  }

  if (phase === 'loading') {
    return <QuoteLoader quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
  }

  if (phase === 'error') {
    return (
      <div className="ss-pop challenge-end">
        <Card padding={5} width="100%">
          <VStack gap={2}>
            <Banner status="error" title={error || t('error.somethingWrong')} />
            <div>
              <Button variant="secondary" label={t('quiz.retry')} onClick={() => void startRun()} />
            </div>
          </VStack>
        </Card>
      </div>
    );
  }

  if (phase === 'gameover') {
    return (
      <div className="ss-pop challenge-end">
        <Card padding={5} width="100%">
          <VStack gap={2}>
            <VStack gap={1} align="center">
              <div ref={gameOverHeadingRef} tabIndex={-1}>
                <Heading level={1} type="display-2" justify="center">
                  {t('challenge.gameOver')}
                </Heading>
              </div>
              <Text type="body" size="sm" color="secondary" justify="center">
                <span role="status">
                  {lastResult?.timedOut ? t('challenge.endedByTime') : t('challenge.endedByStrikes')}
                </span>
              </Text>
              {/* The big number IS the score — no repeated caption underneath. */}
              <MotionPop>
                <div style={{ fontSize: 'clamp(3rem, 12vw, 4.5rem)', fontWeight: 800, lineHeight: 1, color: accent }}>
                  {score}
                </div>
              </MotionPop>
            </VStack>

            <ResultShareActions
              kind="challenge_result"
              label={t('challenge.shareLabel')}
              headline={t('challenge.shareHeadline', { n: score })}
              detail={t('challenge.shareDetail')}
              text={t('challenge.shareText', { n: score })}
              path="/challenge"
              centered
            />

            {missed.length > 0 && (
              <section className="sc-missed" aria-labelledby="challenge-missed">
                <Heading level={2} id="challenge-missed">{t('sharkCards.missedTitle')}</Heading>
                <Text type="supporting" color="secondary">{t('sharkCards.missedBody')}</Text>
                <ol className="sc-missed__list">
                  {missed.map((one) => (
                    <li key={one.questionId} className="sc-missed__item">
                      <div className="sc-missed__question">{renderQuestion(one.question.question)}</div>
                      {one.correctAnswer >= 0 && (
                        <Text type="body" size="sm">
                          {t('quiz.correctLabel')} <strong>{one.question.options[one.correctAnswer]}</strong>
                        </Text>
                      )}
                      {one.explanation && <Text type="body" size="sm" color="secondary">{one.explanation}</Text>}
                      <SaveSharkCard question={one.question} correctIndex={one.correctAnswer} explanation={one.explanation} />
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {board && board.top.length > 0 && (
              <VStack gap={1}>
                <Text type="label" color="secondary">
                  {t('challenge.topScores')}
                </Text>
                <LeaderboardList board={board} />
              </VStack>
            )}

            {/* The run's action row: Play again is the one SwimCta md, as
                Start and Next were (UX audit U2). */}
            <QuestionActions
              secondary={<Button variant="secondary" label={t('challenge.backToIntro')} onClick={() => setPhase('intro')} />}
              primary={{ label: t('challenge.playAgain'), onClick: () => void startRun() }}
            />

            {/* The invite link at the end of a run (#239); nothing while
                signed out or while invitations are off. */}
            <ReferralMoment signedIn={!!user} source="challenge" />
          </VStack>
        </Card>

        <AppToast
          open={!!snack}
          onClose={() => setSnack(null)}
          severity="info"
          message={snack ?? ''}
          autoHideDuration={2500}
        />
      </div>
    );
  }

  // ── playing ──
  if (!current) return null;

  const low = timeLeft <= LOW_TIME_S;
  // Once the clock is out, no answer can be picked or sent: the question is a
  // timeout strike, whatever the connection is doing.
  const timeUp = timeLeft <= 0;
  // The graded marks: the right answer, and a wrong pick. A question that
  // does not count, or a strike the server refused for good, marks nothing.
  const grade = lastResult && !lastResult.notCounted && lastResult.correctAnswer >= 0
    ? { correct: lastResult.correctAnswer, picked: lastResult.selectedIndex >= 0 ? lastResult.selectedIndex : null }
    : null;

  return (
    <>
      {/* One-shot low-time announcement for screen readers (the visual cue is
          colour, which AT users can't perceive). */}
      <span style={visuallyHidden} aria-live="polite">
        {timeLeft === LOW_TIME_S ? t('challenge.lowTime') : ''}
      </span>

      {/* One question screen from the shared parts (UX audit U2,
          questions-01): the 640px shell, the run's h1 with the score, clock
          and fins, the answers, and the verdict in normal flow under them,
          so it never covers the pick it grades. */}
      <QuestionShell
        ref={questionRef}
        questionId="challenge-question"
        className="challenge-run"
        header={
          <QuestionHeader
            title={t('challenge.title')}
            status={
              <>
                <span className="challenge-run__score">
                  <span>{t('challenge.score')}</span>
                  <strong>{score}</strong>
                </span>
                <span
                  role="timer"
                  aria-label={t('challenge.timeAria', { seconds: Math.max(0, timeLeft) })}
                  className="challenge-run__clock"
                  data-low={low || undefined}
                >
                  <ClockIcon />
                  <span>{fmtClock(timeLeft)}</span>
                </span>
                {livesIndicator}
              </>
            }
            meta={<CategoryTag category={current.category} />}
            difficulty={current.difficulty}
            tools={
              <>
                <QuestionIconButton
                  label={t('quiz.reportAria')}
                  icon={<ReportFlagIcon />}
                  onClick={() => setReportTarget({ id: current.id, version: current.review?.version })}
                />
                <QuestionIconButton label={t('challenge.exitRun')} icon={<ExitIcon />} onClick={() => setLeaveOpen(true)} />
              </>
            }
          />
        }
        question={renderQuestion(current.question)}
        actions={
          <div ref={actionsRef}>
            <QuestionActions
              primary={
                !lastResult
                  ? {
                    label: t('challenge.lockIn'),
                    onClick: () => void submitAnswer(),
                    disabled: selected == null || submitting || timeUp,
                  }
                  : {
                    label: refillError !== null
                      ? t('quiz.retry')
                      : livesLost >= MAX_LIVES
                        ? t('challenge.seeResult')
                        : t('challenge.nextQuestion'),
                    onClick: onContinue,
                    disabled: refilling,
                  }
              }
            />
          </div>
        }
      >
        <AnswerOptionList
          options={current.options}
          value={selected}
          onChange={(index) => { if (!lastResult && !timeUp) setSelected(index); }}
          labelledBy="challenge-question"
          disabled={!!lastResult || timeUp}
          grade={grade}
        />
        {/* Graded, the answers take no key, so the line keeps its height
            but says nothing, as in the Learn runner; the focused verdict
            goes on with Enter. */}
        <QuestionHint
          max={current.options.length}
          verb="select"
          next={selected != null ? 'submit' : undefined}
          hidden={!!lastResult || timeUp}
        />
        {!lastResult && strikeWaiting && <Banner status="warning" title={t('challenge.strikeRetrying')} />}
        {lastResult && (
          // Takes the focus when it appears, so a screen reader reads the
          // verdict and Enter or the next Tab goes on from it.
          <QuestionFeedback
            key={lastResult.questionId}
            status={lastResult.notCounted ? 'info' : lastResult.isCorrect ? 'success' : 'error'}
            title={
              lastResult.notCounted === 'retired'
                ? t('challenge.questionRetired')
                : lastResult.notCounted === 'expired'
                  ? t('challenge.questionExpired')
                  : lastResult.isCorrect
                    ? t('challenge.correct')
                    : lastResult.timedOut
                      ? t('challenge.questionTimeout')
                      : t('challenge.wrong')
            }
            description={lastResult.explanation || undefined}
          >
            {refillError !== null && (
              <Banner status="warning" title={t('challenge.nextQuestionFailed')} description={refillError} />
            )}
          </QuestionFeedback>
        )}
      </QuestionShell>

      <AppToast
        open={!!snack}
        onClose={() => setSnack(null)}
        severity="info"
        message={snack ?? ''}
        autoHideDuration={2500}
      />
      <ReportDialog open={!!reportTarget} onClose={() => setReportTarget(null)} onSubmit={handleReport} />
      <AlertDialog
        className="ss-alert-dialog"
        isOpen={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t('challenge.leaveTitle')}
        description={t('challenge.leaveBody')}
        actionLabel={t('challenge.leaveConfirm')}
        cancelLabel={t('quiz.leaveCancel')}
        onAction={leaveRun}
        width="min(460px, calc(100vw - 32px))"
      />
    </>
  );
}

/** A small outline clock glyph for the countdown chip. Decorative. */
function ClockIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 15, height: 15, display: 'block' }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function LeaderboardList({ board }: { board: ChallengeLeaderboard }) {
  const { t } = useLanguage();
  // role="list" restores list semantics that Safari/VoiceOver drop when
  // list-style is none.
  return (
    <ol role="list" style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
      {board.top.map((row, i) => (
        <li
          key={row.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            // Rank, name and score on one line: the score used to sit at the
            // top of a row the 44px topic count made taller (questions-10).
            alignItems: 'center',
            gap: 8,
            padding: '6px 0',
            borderBottom: i === board.top.length - 1 ? 'none' : '1px dashed var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
            <span style={{ width: 24, flexShrink: 0 }}>
              <Text type="body" size="sm" color="secondary">
                {i + 1}.
              </Text>
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <Text type="body" size="sm" weight={i === 0 ? 'bold' : 'medium'}>
                {row.name}
              </Text>
            </span>
            {row.topics && row.topics.length > 0 && <Tooltip content={row.allTopics ? 'This beast completed the challenge with all topics! Watch out!' : row.topics.map(topic => t(categoryLabelKey(topic as Question['category']))).join(', ')}>
              <span tabIndex={0} className="challenge-topic-count" aria-label={row.allTopics ? 'All topics' : `${row.topics.length} topics`}>
                {row.allTopics ? <SharkFin size={20} color="var(--ss-challenge-gold)" /> : row.topics.length}
              </span>
            </Tooltip>}
          </div>
          <Text type="body" size="sm" weight="bold" color={i === 0 ? 'accent' : 'primary'}>
            {row.score}
          </Text>
        </li>
      ))}
    </ol>
  );
}
