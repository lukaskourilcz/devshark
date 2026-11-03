import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { Kicker } from './landing/LandingKit';
import { useWaveVariant } from '../lib/waveBank';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SwimCta } from './landing/LandingKit';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Text } from '@astryxdesign/core/Text';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Banner } from '@astryxdesign/core/Banner';
import { Popover } from '@astryxdesign/core/Popover';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AppToast } from './ui/AppToast';
import { CloseIcon } from './ui/icons';
import { useAuth, getUserProfile } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import type { Question, QuizResult, QuizState, DifficultyMode, CategoryType } from '../types/quiz';
import {
  visibleCategoryOptionsFor,
  categoryLabelKey,
} from '../lib/categories';
import { getSubject, deliveryCategoriesForSubject } from '../lib/subjects';
import { readJSON, writeJSON } from '../lib/storage';
import {
  recordQuizResult,
  getDailyChallenge,
  reportQuestion,
} from '../lib/supabase';
import { apiFetch, ApiError, friendlyError } from '../lib/api';
import {
  attemptKeyOf,
  dropPendingReceipt,
  isReceiptRefused,
  queuePendingReceipt,
  type PendingReceipt,
} from '../lib/pendingQuizReceipts';
import { renderQuestion } from './CodeBlock';
import { TermsBar } from './ui/Terms';
import { glossaryDomainFor } from '../lib/glossaryDomain';
import { QuoteLoader, holdLoadingScreen } from './LoadingScreen';
import { SaveSharkCard } from './SaveSharkCard';
import { useLanguage } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { useSettings, playCorrect, playComplete } from '../lib/settings';
import { recordPerfectQuiz } from '../lib/achievements';
import { announceVerifiedQuestXp, announceXpHeld, awardQuestXp, syncXpWithServer } from '../lib/xp';
import { useGameConfig } from '../lib/gameConfig';
import { ReportDialog } from './ReportDialog';
import { capture } from '../lib/analytics';
import { MotionPop, MotionItem } from '../lib/motion';
import { RadioCardGroup, RadioCard } from './ui/RadioCards';
import {
  AnswerOptionList,
  ExitIcon,
  HintIcon,
  QuestionActions,
  QuestionHeader,
  QuestionHint,
  QuestionIconButton,
  QuestionShell,
  ReportFlagIcon,
} from './question';
import { queryClient } from '../lib/queryClient';
import { profileStatsQueryKey } from '../lib/queries';
import { useDayChangeTime } from '../lib/utcDay';
import './Quiz.css';
import { CategoryTag, TopicPill } from './ui/CategoryTag';
import { PageHeader } from './ui/PageHeader';
import { StatePanel } from './ui/StatePanel';

type QuizMode = 'standard' | 'daily' | 'review';
const QUIZ_MODES: readonly string[] = ['standard', 'daily', 'review'];
type ReviewWeakArea = { category: CategoryType; accuracyPct: number; answered: number; focusTags: string[] };

const DIFFICULTY_VALUES: DifficultyMode[] = ['basics', 'easy', 'zero-to-hero', 'advanced', 'mixed'];

const PROGRESS_KEY = 'devquiz:in-progress';
const SETUP_KEY = 'devquiz:quiz-setup:v1';

/** How a quiz was started, so Retry and "New quiz, same settings" repeat it
 * rather than always starting a standard quiz. */
type StartSpec =
  | { mode: 'standard'; count: number; difficulty: DifficultyMode; categories: CategoryType[] }
  | { mode: 'daily' }
  | { mode: 'review' };

/** Why a quiz stopped on the error screen without a result. */
type StopReason = 'expired' | 'graded' | 'daily-done';


interface SavedSetup {
  count?: number;
  difficulty?: DifficultyMode;
  categories?: string[];
}

interface PersistedProgress {
  sessionId: string;
  questions: Question[];
  answers: Record<string, number>;
  currentIndex: number;
  mode: QuizMode;
  /** When the server stops grading this session (epoch ms). Absent from a
   * quiz saved before it was recorded. */
  expiresAt?: number;
  /** Questions whose hint was opened, so a reload does not record them as
   * answered unaided. */
  hinted?: string[];
  /** A submit was sent: the answers can no longer change. */
  locked?: boolean;
  start?: StartSpec;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isSavedQuestion = (value: unknown): value is Question =>
  isRecord(value) && typeof value.id === 'string' && typeof value.question === 'string' &&
  typeof value.category === 'string' && Array.isArray(value.options) && value.options.length > 0 &&
  value.options.every((option) => typeof option === 'string');

function savedStart(value: unknown): StartSpec | null {
  if (!isRecord(value)) return null;
  if (value.mode === 'daily' || value.mode === 'review') return { mode: value.mode };
  if (value.mode !== 'standard') return null;
  const { count, difficulty, categories } = value;
  return Number.isInteger(count) && (count as number) > 0 &&
    DIFFICULTY_VALUES.includes(difficulty as DifficultyMode) &&
    Array.isArray(categories) && categories.every((category) => typeof category === 'string')
    ? { mode: 'standard', count: count as number, difficulty: difficulty as DifficultyMode, categories: categories as CategoryType[] }
    : null;
}

/** The quiz this tab saved, or null when the copy is not one this build can
 * resume: a position that is not a number left the screen blank, and a
 * question without options threw. Answers keep only real picks of its own
 * questions. */
type RestoredProgress = Omit<PersistedProgress, 'expiresAt' | 'start'> & { expiresAt: number | null; start: StartSpec | null };
function restoredProgress(raw: unknown): RestoredProgress | null {
  if (!isRecord(raw) || typeof raw.sessionId !== 'string' || !raw.sessionId) return null;
  const { questions } = raw;
  if (!Array.isArray(questions) || questions.length === 0 || !questions.every(isSavedQuestion)) return null;
  const answers: Record<string, number> = {};
  if (isRecord(raw.answers)) {
    for (const question of questions) {
      const pick = Object.prototype.hasOwnProperty.call(raw.answers, question.id) ? raw.answers[question.id] : undefined;
      if (Number.isInteger(pick) && (pick as number) >= 0 && (pick as number) < question.options.length) answers[question.id] = pick as number;
    }
  }
  const index = Number.isInteger(raw.currentIndex) ? Math.min(Math.max(raw.currentIndex as number, 0), questions.length - 1) : 0;
  return {
    sessionId: raw.sessionId,
    questions,
    answers,
    currentIndex: index,
    mode: QUIZ_MODES.includes(raw.mode as string) ? raw.mode as QuizMode : 'standard',
    expiresAt: typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : null,
    hinted: Array.isArray(raw.hinted) ? raw.hinted.filter((id): id is string => typeof id === 'string') : [],
    locked: raw.locked === true,
    start: savedStart(raw.start),
  };
}

function Quiz({ onActiveChange }: { onActiveChange?: (active: boolean) => void }) {
  // Its own wave from the shared bank, so the review heading does not repeat
  // the tile the kicker above it drew.
  const reviewWave = useWaveVariant();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const config = useGameConfig();
  const [state, setState] = useState<QuizState>('ready');
  const [sessionId, setSessionId] = useState<string>('');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stop, setStop] = useState<StopReason | null>(null);
  const [lastStart, setLastStart] = useState<StartSpec | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  // Set when a submit is sent. The server claims the answer set on its first
  // grade, so an answer changed after that could never be graded: a retry
  // after a lost response must send the same answers.
  const [answersLocked, setAnswersLocked] = useState(false);
  // Setup preferences persist across visits, so a returning learner's
  // categories/count/difficulty are one tap from "Start quiz".
  const [questionCount, setQuestionCount] = useState<number>(() => {
    const saved = readJSON<SavedSetup>(SETUP_KEY, {});
    return typeof saved.count === 'number' && saved.count >= 1 && saved.count <= config.quiz.maxCount
      ? saved.count
      : config.quiz.defaultCount;
  });
  const [difficultyMode, setDifficultyMode] = useState<DifficultyMode>(() => {
    const saved = readJSON<SavedSetup>(SETUP_KEY, {});
    return saved.difficulty && DIFFICULTY_VALUES.includes(saved.difficulty)
      ? saved.difficulty
      : (DIFFICULTY_VALUES.includes(config.quiz.defaultDifficulty as DifficultyMode)
        ? config.quiz.defaultDifficulty as DifficultyMode
        : 'zero-to-hero');
  });
  const [selectedCategories, setSelectedCategories] = useState<CategoryType[]>(() => {
    const linkedCategory = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('category')
      : null;
    // Only categories the server still serves. A saved setup or an old link
    // can name a retired section, and one of those gets the whole quiz refused.
    const known = new Set<string>(deliveryCategoriesForSubject(getSubject()));
    if (linkedCategory && known.has(linkedCategory)) {
      return [linkedCategory as CategoryType];
    }
    const saved = readJSON<SavedSetup>(SETUP_KEY, {});
    if (!Array.isArray(saved.categories)) return [];
    return saved.categories.filter((c): c is CategoryType => known.has(c));
  });
  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  // Whether a hint was *ever* opened for a question, which is not the same as
  // whether one is open now. The popover light-dismisses on the click that
  // picks an answer, so the open flag is already false by the time the session
  // is submitted; reporting that would have recorded every hinted answer as an
  // independent one and let it lengthen a review interval. This is sticky on
  // purpose: opening a hint cannot be taken back, and it is cleared only when a
  // new session starts.
  const [hintedIds, setHintedIds] = useState<string[]>([]);
  const [attemptedStart, setAttemptedStart] = useState(false);
  const [snack, setSnack] = useState<string | null>(null);
  const dayChange = useDayChangeTime();
  const [mode, setMode] = useState<QuizMode>('standard');
  const [reviewPlan, setReviewPlan] = useState<ReviewWeakArea[]>([]);
  // Set only when the session actually mixes related concepts. One line,
  // once, and never a learning-science tutorial nobody asked for.
  const [interleaved, setInterleaved] = useState(false);
  // Advanced asked of topics with no advanced questions: the server served
  // their hardest instead, and the first question says so.
  const [hardestAvailable, setHardestAvailable] = useState(false);
  // The item being reported, with the version of the wording that was on
  // screen, so a fix can be matched to what the learner actually saw.
  const [reportTarget, setReportTarget] = useState<{ id: string; version?: string } | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [settings] = useSettings();

  const resultHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const questionTextRef = useRef<HTMLDivElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  // Leaving the page drops a quiz, review or daily set still loading.
  useEffect(() => () => fetchAbortRef.current?.abort(), []);
  // One submit at a time. `submitting` reaches the next handler only after a
  // render, and a second Enter or click in that gap sent the answer set
  // twice: the result was recorded, announced and counted twice.
  const submittingRef = useRef(false);
  // Which quiz is on screen, moved by every start and by leaving one. A submit
  // answered after the learner left its quiz (Exit during a slow submit, then
  // a new quiz) drew its result over the new screen and cleared the new quiz's
  // saved progress. Its result is still recorded to the account.
  const screenRef = useRef(0);
  const leaveScreen = useCallback(() => {
    screenRef.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
  }, []);

  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  // The saved plan, used only to say whether this topic is part of it.
  const profile = getUserProfile(user);
  // Once per account, not per render: a new list each render made the
  // memos below and the review start's identity new on every render.
  const visibleCategoryOptions = useMemo(() => visibleCategoryOptionsFor(profile.email), [profile.email]);

  // The /dev "default visible categories" setting picks which chips appear on
  // first sight; the rest unlock when the learner clicks "Show all". Empty
  // list (or no overlap with what this user can see) means show everything.
  const defaultCategoryIds = config.quiz.defaultCategoryIds ?? [];
  const defaultVisibleSet = useMemo(() => new Set(defaultCategoryIds), [defaultCategoryIds]);
  const collapsedOptions = useMemo(
    () =>
      defaultVisibleSet.size > 0
        ? visibleCategoryOptions.filter((c) => defaultVisibleSet.has(c.value))
        : visibleCategoryOptions,
    [defaultVisibleSet, visibleCategoryOptions],
  );
  const hasCollapsedSubset =
    collapsedOptions.length > 0 && collapsedOptions.length < visibleCategoryOptions.length;
  const [showAllCategories, setShowAllCategories] = useState(false);

  // Lookup table for the review-mode result rows. Replaces an O(n) array.find()
  // per question with an O(1) Map.get() — important when the snackbar/report
  // dialog opens and re-renders the whole list of 20–50 questions.
  const resultsById = useMemo(
    () => new Map((result?.results ?? []).map((r) => [r.questionId, r])),
    [result],
  );
  const displayedCategoryOptions = hasCollapsedSubset && !showAllCategories
    ? collapsedOptions
    : visibleCategoryOptions;

  // Hide the app chrome only while actively taking the quiz (and the brief load
  // before it). On the results/review screen ('submitted') the nav + footer come
  // back so the learner can navigate away easily.
  useEffect(() => {
    onActiveChange?.(state === 'in-progress' || state === 'loading');
  }, [state, onActiveChange]);

  // Restore in-progress quiz on mount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      if (!raw) return;
      const saved = restoredProgress(JSON.parse(raw));
      if (!saved) {
        sessionStorage.removeItem(PROGRESS_KEY);
        return;
      }
      // Past its hour the server would refuse every answer: say so now rather
      // than after the learner has answered the rest.
      if (saved.expiresAt !== null && Date.now() >= saved.expiresAt) {
        sessionStorage.removeItem(PROGRESS_KEY);
        setSnack(t('quiz.resumeExpired'));
        return;
      }
      setSessionId(saved.sessionId);
      setQuestions(saved.questions);
      setAnswers(saved.answers);
      setHintedIds(saved.hinted ?? []);
      setExpiresAt(saved.expiresAt);
      setAnswersLocked(saved.locked === true);
      setLastStart(saved.start);
      setCurrentIndex(saved.currentIndex);
      // A quiz saved before practice mode was removed still says 'practice'
      // here. Nothing branches on it any more, but it would still be reported
      // as the mode to analytics, so an unknown mode reads as a standard quiz.
      setMode(saved.mode);
      setState('in-progress');
    } catch {
      // ignore corrupt state
    }
    // Once, on mount; `t` only words the notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The account epoch the quiz on screen was dealt or restored under. A sign-
  // out clears the saved progress (clearAccountData); the quiz stays on
  // screen, but its next answer must not write it back for the next account.
  const progressEpochRef = useRef(accountEpoch());
  useEffect(() => {
    progressEpochRef.current = accountEpoch();
  }, [sessionId]);

  // Persist in-progress state
  useEffect(() => {
    if (state !== 'in-progress' || questions.length === 0) return;
    if (accountEpoch() !== progressEpochRef.current) return;
    try {
      const payload: PersistedProgress = {
        sessionId, questions, answers, currentIndex, mode,
        ...(expiresAt !== null ? { expiresAt } : {}),
        hinted: hintedIds,
        ...(answersLocked ? { locked: true } : {}),
        ...(lastStart ? { start: lastStart } : {}),
      };
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify(payload));
    } catch {
      // quota or private mode — ignore
    }
  }, [state, sessionId, questions, answers, currentIndex, mode, expiresAt, hintedIds, answersLocked, lastStart]);

  // Persist the setup preferences so the next visit starts pre-configured.
  useEffect(() => {
    writeJSON(SETUP_KEY, {
      count: questionCount,
      difficulty: difficultyMode,
      categories: selectedCategories,
    } satisfies SavedSetup);
  }, [questionCount, difficultyMode, selectedCategories]);

  const clearProgress = useCallback(() => {
    try {
      sessionStorage.removeItem(PROGRESS_KEY);
    } catch {
      // ignore
    }
  }, []);

  const fetchQuestions = useCallback(
    async (
      count: number,
      difficulty: DifficultyMode,
      categories: CategoryType[],
    ) => {
      fetchAbortRef.current?.abort();
      const controller = new AbortController();
      fetchAbortRef.current = controller;
      leaveScreen();

      setLastStart({ mode: 'standard', count, difficulty, categories });
      setStop(null);
      setState('loading');
      setError(null);
      const startedAt = Date.now();
      try {
        const params = new URLSearchParams({
          count: String(count),
          difficulty,
          categories: categories.join(','),
        });
        const data = await apiFetch<{ sessionId: string; expiresAt?: number; questions: Question[]; hardestAvailable?: boolean }>(
          `/api/quiz/questions?${params}`,
          { signal: controller.signal },
        );
        await holdLoadingScreen(startedAt);
        if (controller.signal.aborted) return;
        // Guard against an empty question set (e.g. a difficulty/category combo
        // the server can't fill). Rendering 'in-progress' with no questions
        // would leave the learner staring at a blank screen.
        if (!Array.isArray(data.questions) || data.questions.length === 0) {
          setError(t('quiz.noQuestions'));
          setState('error');
          return;
        }
        setSessionId(data.sessionId);
        setQuestions(data.questions);
        setAnswers({});
        setHintedIds([]);
        setExpiresAt(data.expiresAt ?? null);
        setAnswersLocked(false);
        setReviewPlan([]);
        setHardestAvailable(data.hardestAvailable === true);
        setCurrentIndex(0);
        setMode('standard');
        setState('in-progress');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(friendlyError(err));
        setState('error');
      }
    },
    [leaveScreen, t],
  );

  const startDailyChallenge = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    leaveScreen();
    setLastStart({ mode: 'daily' });
    setStop(null);
    setState('loading');
    setError(null);
    capture('quiz_started', { mode: 'daily' });
    const startedAt = Date.now();
    try {
      const data = await getDailyChallenge(controller.signal);
      await holdLoadingScreen(startedAt);
      if (controller.signal.aborted) return;
      // Already submitted today: the grader would refuse a second run.
      if (data.completed) {
        setStop('daily-done');
        setState('error');
        return;
      }
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        setError(t('quiz.noQuestions'));
        setState('error');
        return;
      }
      setSessionId(data.sessionId);
      setQuestions(data.questions as Question[]);
      setAnswers({});
      setHintedIds([]);
      setExpiresAt(data.expiresAt ?? null);
      setAnswersLocked(false);
      setCurrentIndex(0);
      setMode('daily');
      setState('in-progress');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(friendlyError(err));
      setState('error');
    }
  }, [leaveScreen, t]);

  const startPersonalizedReview = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    leaveScreen();
    setLastStart({ mode: 'review' });
    setStop(null);
    setState('loading');
    setError(null);
    const startedAt = Date.now();
    try {
      const categories = visibleCategoryOptions.map((option) => option.value);
      const params = new URLSearchParams({
        resource: 'review',
        count: String(Math.min(10, config.quiz.maxCount)),
        difficulty: 'mixed',
        categories: categories.join(','),
      });
      const data = await apiFetch<{
        sessionId: string;
        expiresAt?: number;
        questions: Question[];
        reviewPlan?: ReviewWeakArea[];
        interleaved?: { contrasted: string[] };
      }>(`/api/quiz/questions?${params}`, { signal: controller.signal });
      await holdLoadingScreen(startedAt);
      if (controller.signal.aborted) return;
      if (!data.questions?.length) throw new Error(t('quiz.noQuestions'));
      setSessionId(data.sessionId);
      setQuestions(data.questions);
      setAnswers({});
      setHintedIds([]);
      setExpiresAt(data.expiresAt ?? null);
      setAnswersLocked(false);
      setReviewPlan(data.reviewPlan ?? []);
      setInterleaved(Boolean(data.interleaved));
      setCurrentIndex(0);
      setMode('review');
      capture('quiz_started', { mode: 'review', question_count: data.questions.length });
      setState('in-progress');
    } catch (error) {
      if (controller.signal.aborted) return;
      setError(friendlyError(error));
      setState('error');
    }
  }, [config.quiz.maxCount, leaveScreen, t, visibleCategoryOptions]);

  // Retry after an error, and "New quiz, same settings" after an expired
  // one, repeat how the last quiz was started: a failed daily retries the
  // daily, not an all-topics quiz.
  const startAgain = () => {
    if (lastStart?.mode === 'daily') return void startDailyChallenge();
    if (lastStart?.mode === 'review') return void startPersonalizedReview();
    const spec = lastStart ?? { count: questionCount, difficulty: difficultyMode, categories: selectedCategories };
    void fetchQuestions(spec.count, spec.difficulty, spec.categories);
  };

  // Today's review card links straight here. The parameter starts the same
  // session the button does, once, and is then cleared so a reload does not
  // silently restart it under the learner.
  //
  // The URL changes in a transition, after the start's own render. The start
  // is read through a ref: it is a new function on every render (the topic
  // list it reads is), so as a dependency it ran this effect again on the
  // start's render, which started again, and so on until React gave up with
  // "Maximum update depth exceeded".
  const [searchParams, setSearchParams] = useSearchParams();
  const reviewRequested = searchParams.get('mode') === 'review';
  const startReviewRef = useRef(startPersonalizedReview);
  startReviewRef.current = startPersonalizedReview;
  useEffect(() => {
    if (!reviewRequested || !isAuthenticated) return;
    setSearchParams({}, { replace: true });
    void startReviewRef.current();
  }, [reviewRequested, isAuthenticated, setSearchParams]);

  // The Home tile and the leaderboard's Today tab link to the daily challenge
  // the same way. It starts once the sign-in is known, since a daily fetched
  // signed out is practice and records nothing.
  const dailyRequested = searchParams.get('mode') === 'daily';
  useEffect(() => {
    if (!dailyRequested || authLoading) return;
    setSearchParams({}, { replace: true });
    void startDailyChallenge();
  }, [dailyRequested, authLoading, setSearchParams, startDailyChallenge]);

  const handleStart = () => {
    setAttemptedStart(true);
    if (selectedCategories.length === 0) {
      setError(t('quiz.selectCategoryError'));
      return;
    }
    setError(null);
    setResult(null);
    // Top of the quiz funnel. No-op unless PostHog is configured.
    capture('quiz_started', {
      mode: 'standard',
      question_count: questionCount,
      difficulty: difficultyMode,
      category_count: selectedCategories.length,
    });
    fetchQuestions(questionCount, difficultyMode, selectedCategories);
  };

  const handleCategoryToggle = (category: CategoryType) => {
    setSelectedCategories((prev) =>
      prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category],
    );
  };

  const handleSelectAll = () => {
    const pool = displayedCategoryOptions.map((c) => c.value);
    setSelectedCategories((prev) =>
      pool.every((c) => prev.includes(c))
        ? prev.filter((c) => !pool.includes(c))
        : [...new Set([...prev, ...pool])],
    );
  };

  const displayedCategoryIds = displayedCategoryOptions.map((c) => c.value);
  const hiddenSelectedCount = selectedCategories.filter((category) => !displayedCategoryIds.includes(category)).length;
  const isAllSelected =
    displayedCategoryIds.length > 0 &&
    displayedCategoryIds.every((c) => selectedCategories.includes(c));

  const handleAnswer = (questionId: string, answerIndex: number) => {
    if (answersLocked) return;
    setAnswers((prev) => ({ ...prev, [questionId]: answerIndex }));
    if (settings.soundEffects) {
      // soft confirmation tone on each pick — no correctness reveal until submit.
      playCorrect();
    }
  };

  const handleReport = useCallback(
    async (reason: 'incorrect-answer' | 'unclear' | 'typo' | 'outdated' | 'duplicate' | 'other', detail?: string) => {
      if (!reportTarget) return;
      try {
        await reportQuestion({
          questionId: reportTarget.id,
          reason,
          detail,
          reporterSub: user?.id,
          contentVersion: reportTarget.version,
        });
        setSnack(t('quiz.reportSent'));
      } catch {
        setSnack(t('quiz.reportFailed'));
      } finally {
        setReportTarget(null);
      }
    },
    [reportTarget, user, t],
  );

  const handleNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, questions.length - 1));
  }, [questions.length]);

  const handlePrevious = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const screen = screenRef.current;
    // The account the quiz was submitted under. Signed out elsewhere while
    // the grade was on its way, the receipt was queued after the account's
    // data was cleared and left on the device for the next person.
    const epoch = accountEpoch();
    setSubmitting(true);
    setAnswersLocked(true);
    setError(null);
    try {
      const data = await apiFetch<QuizResult>('/api/quiz/submit', {
        method: 'POST',
        // Which questions had a hint open. Reported so a hinted answer does not
        // lengthen a review interval; it can only weaken the outcome, never
        // strengthen it, which is why the server can take it as given.
        body: JSON.stringify({
          sessionId,
          answers,
          hinted: hintedIds,
        }),
      });
      const onScreen = screen === screenRef.current;
      const say = (message: string) => { if (onScreen) setSnack(message); };
      if (onScreen) {
        setResult(data);
        setState('submitted');
        clearProgress();
        playComplete();
      }
      // Bottom of the quiz funnel. Pairs with 'quiz_started' for conversion and
      // score-distribution analysis. No-op unless PostHog is configured.
      capture('quiz_submitted', {
        mode,
        percentage: data.percentage,
        correct: data.correctAnswers,
        total: data.totalQuestions,
      });

      // Every quiz counts. There is no unranked kind any more, so the only
      // question left is whether there is an account to record it against.
      // Signed out since the submit, nothing of the account is kept here.
      const sameAccount = accountEpoch() === epoch;
      if (sameAccount && data.percentage === 100) recordPerfectQuiz();
      if (sameAccount && isAuthenticated && user?.id) {
        if (!data.resultReceipt) {
          // Nothing to record. A daily fetched signed out is practice; with
          // every question retired there was nothing to grade, and the
          // result screen already says why.
          if (data.totalQuestions > 0) say(t(mode === 'daily' ? 'quiz.dailyPractice' : 'quiz.resultNotSaved'));
        } else {
          const pending: PendingReceipt = {
            userId: user.id,
            receipt: data.resultReceipt,
            profile: { email: profile.email, name: profile.name, picture: profile.picture },
          };
          const attemptKey = attemptKeyOf(sessionId);
          queuePendingReceipt(attemptKey, pending);
          try {
            const saved = await recordQuizResult(pending.receipt, pending.profile);
            if (saved.data) queryClient.setQueryData(profileStatsQueryKey(user.id), saved.data);
            dropPendingReceipt(attemptKey);
            // The gain the account recorded first, then the rank it crosses
            // once the account's verified balance is in. A server from before
            // migration 048 names no amount and awarded the result's.
            const recordedXp = typeof saved.questXp === 'number' ? saved.questXp : data.questXp;
            if (saved.applied) announceVerifiedQuestXp(recordedXp);
            // The answers whose question paid XP less than an hour ago, and
            // when they pay again (migration 060).
            if (saved.xpHeld) announceXpHeld({ on: 'questions', count: saved.xpHeld.questions, availableAt: saved.xpHeld.availableAt });
            await syncXpWithServer({ announceRankUp: saved.applied });
          } catch (writeError) {
            console.error('Stat write failed:', writeError);
            // Refused (expired or invalid) can never be recorded: drop it and
            // say so. Anything else waits in the queue and is sent again.
            if (isReceiptRefused(writeError)) {
              dropPendingReceipt(attemptKey);
              say(t('quiz.resultNotSaved'));
            } else {
              say(t('quiz.streakWarning'));
            }
          }
        }
      } else if (sameAccount && data.questXp > 0) {
        // Anonymous progress remains local. Signing in replaces it with the
        // account's verified balance rather than uploading a client total.
        awardQuestXp(data.questXp, 'quiz');
      }
    } catch (err) {
      // The learner left this quiz: the screen is another one's now.
      if (screen !== screenRef.current) return;
      // An hour past its start the session is gone, and an answer set that
      // was already graded cannot be graded again. Neither improves with
      // another submit, so the quiz stops and says what happened.
      if (err instanceof ApiError && (err.code === 'invalid_session' || err.code === 'attempt_already_graded')) {
        clearProgress();
        setStop(err.code === 'invalid_session' ? 'expired' : mode === 'daily' ? 'daily-done' : 'graded');
        setState('error');
      } else {
        setError(friendlyError(err));
      }
    } finally {
      if (screen === screenRef.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }, [answers, clearProgress, isAuthenticated, sessionId, user, t, questions, mode, hintedIds]);

  const handleRestart = () => {
    leaveScreen();
    clearProgress();
    setState('ready');
    setQuestions([]);
    setResult(null);
    setAnswers({});
    setHintedIds([]);
    setAnswersLocked(false);
    setExpiresAt(null);
    setStop(null);
    setCurrentIndex(0);
    setMode('standard');
    setReviewPlan([]);
    setError(null);
  };

  // In-app confirm dialog (window.confirm is blocked in many mobile WebViews
  // and bypasses i18n).
  const handleAbandon = () => setLeaveConfirmOpen(true);
  const confirmAbandon = () => {
    setLeaveConfirmOpen(false);
    handleRestart();
  };

  const currentQuestion = questions[currentIndex];

  // Move focus to the result heading, which reads the score out. It is no
  // live region: one drawn together with its words is not read, and where a
  // reader did read it, the score was heard twice.
  useEffect(() => {
    if (state === 'submitted' && resultHeadingRef.current) {
      resultHeadingRef.current.focus();
    }
  }, [state]);

  // Starting unmounts the setup screen with the button that was pressed, so
  // focus goes to the first question instead of falling to <body>.
  useEffect(() => {
    if (state === 'in-progress') questionTextRef.current?.focus({ preventScroll: true });
  }, [state]);

  // Previous on the second question disables itself, and a disabled button
  // drops the focus to the page: the question that came up takes it instead.
  useEffect(() => {
    const active = document.activeElement;
    if (state !== 'in-progress' || !active) return;
    if (active === document.body || (active instanceof HTMLButtonElement && active.disabled)) {
      questionTextRef.current?.focus({ preventScroll: true });
    }
  }, [state, currentIndex]);

  // Keyboard shortcuts during in-progress quiz
  useEffect(() => {
    if (state !== 'in-progress' || !currentQuestion) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      // Typing, or working in a dialog (report, leave): the keys are theirs.
      if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="dialog"], [role="alertdialog"]')) return;
      // The shortcuts keep working after a click has left focus on an answer
      // or a button. Only Enter on a button or link is left alone: the
      // browser already activates it, and acting as well would act twice.
      const onAnswer = !!target?.closest('[role="radio"]');
      const onControl = !onAnswer && !!target?.closest('button, a[href], [role="button"]');

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (currentIndex < questions.length - 1) handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (currentIndex > 0) handlePrevious();
      } else if (e.key === 'Enter') {
        if (onControl) return;
        // On a focused answer this also stops the browser's click, which
        // would re-pick that answer over one chosen with a number key.
        const allAnswered = questions.every((q) => answers[q.id] !== undefined);
        if (currentIndex === questions.length - 1 && allAnswered) {
          e.preventDefault();
          handleSubmit();
        } else if (currentIndex < questions.length - 1) {
          e.preventDefault();
          handleNext();
        }
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < currentQuestion.options.length && !answersLocked) {
          e.preventDefault();
          handleAnswer(currentQuestion.id, idx);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state, currentIndex, currentQuestion, questions, answers, answersLocked, handleNext, handlePrevious, handleSubmit]);

  // Confirm-on-leave during quiz
  useEffect(() => {
    if (state !== 'in-progress') return;
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state]);

  /* ──── render branches ─────────────────────────────────────────── */

  if (state === 'loading') {
    return <QuoteLoader quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
  }

  if (state === 'error') {
    const banner = stop === 'daily-done'
      ? { status: 'info' as const, title: t('quiz.dailyDoneTitle'), description: t('quiz.dailyDoneBody', { time: dayChange }) }
      : stop === 'expired'
        ? { status: 'error' as const, title: t('quiz.expiredTitle'), description: t('quiz.expiredBody') }
        : stop === 'graded'
          ? { status: 'error' as const, title: t('quiz.alreadyGradedTitle'), description: t('quiz.alreadyGradedBody') }
          : { status: 'error' as const, title: error || t('error.somethingWrong') };
    // The task column, the message, and the shared action row: back to the
    // settings on the left, the one way on as the primary on the right.
    return (
      <div className="quiz-stop">
        <Banner {...banner} />
        <QuestionActions
          secondary={<Button variant="secondary" label={t('quiz.backToSettings')} onClick={handleRestart} />}
          primary={stop === 'daily-done'
            ? { label: t('quiz.dailyLeaderboard'), onClick: () => navigate('/leaderboard?tab=today') }
            : { label: stop ? t('quiz.startAgainSame') : t('quiz.retry'), onClick: startAgain }}
        />
      </div>
    );
  }

  if (state === 'ready') {
    const labelStyle: CSSProperties = { fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: 'var(--ss-type-compact)' };
    const pill = (on: boolean): CSSProperties => ({
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: on ? 'var(--brand-accent-soft)' : 'var(--ss-card-bg)',
      color: on ? 'var(--brand-accent-on-soft)' : 'var(--color-text-primary)',
      border: `1px solid ${on ? 'var(--brand-accent)' : 'var(--ss-card-line)'}`,
      borderRadius: 999, padding: '7px 14px', minHeight: 44, width: 'auto', fontFamily: 'var(--font-family-body)',
      fontWeight: 600, fontSize: 'var(--ss-type-compact)', cursor: 'pointer',
      transition: 'border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease',
    });
    return (
      <div className="ss-pop quiz-setup">
        {/* The one operational page header (UX audit U2, questions-19). */}
        <PageHeader title={t('quiz.buildTitle')} lead={t('quiz.buildSubtitle')} />

        <div className="ss-panel quiz-setup__panel">
          {/* Categories as accent pills. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span id="quiz-categories-label" style={labelStyle}>{t('quiz.categories')}</span>
              <span className="ss-text-links" style={{ margin: 0 }}>
                <button type="button" onClick={handleSelectAll}>
                  {t(hasCollapsedSubset && !showAllCategories
                    ? isAllSelected ? 'quiz.deselectVisible' : 'quiz.selectVisible'
                    : isAllSelected ? 'quiz.deselectAll' : 'quiz.selectAll')}
                </button>
              </span>
            </div>
            <div role="group" aria-labelledby="quiz-categories-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {displayedCategoryOptions.map((cat) => {
                const selected = selectedCategories.includes(cat.value);
                return (
                  <TopicPill key={cat.value} category={cat.value} selected={selected} onClick={() => handleCategoryToggle(cat.value)} />
                );
              })}
            </div>
            {hasCollapsedSubset && (
              <span className="ss-text-links" style={{ margin: 0, alignSelf: 'flex-start' }}>
                <button type="button" onClick={() => setShowAllCategories((v) => !v)}>
                  {showAllCategories ? t('quiz.showFewer') : t('quiz.showAllCategories')}
                </button>
                {hiddenSelectedCount > 0 && <span className="quiz-setup__helper">{t('quiz.moreTopicsSelected', { count: hiddenSelectedCount })}</span>}
              </span>
            )}
            {/* Takes no line until it has something to say, so the next
                section is the panel's one 20px gap below (questions-15). */}
            <div id="categories-error" role="alert" className="quiz-setup__error">
              {attemptedStart && selectedCategories.length === 0 ? t('quiz.selectAtLeastOne') : ''}
            </div>
          </div>

          {/* Questions, then Difficulty: each full width, so each is one
              row of pills under its label (questions-15). Side by side,
              Difficulty wrapped to two rows in half the panel. */}
          <div className="quiz-setup__settings">
            <div className="quiz-setup__group">
              <span id="quiz-count-label" style={labelStyle}>{t('quiz.questionsLegend')}</span>
              <RadioCardGroup value={questionCount} onChange={(value) => setQuestionCount(Number(value))} labelledBy="quiz-count-label" orientation="horizontal" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {config.quiz.countOptions.map((count, index) => (
                  <RadioCard key={count} value={count} index={index} label={t('quiz.countQuestionsAria', { count })} style={{ ...pill(questionCount === count), borderRadius: 'var(--radius-element)', minWidth: 48, justifyContent: 'center' }}>
                    {count}
                  </RadioCard>
                ))}
              </RadioCardGroup>
            </div>
            <div className="quiz-setup__group">
              <span id="quiz-difficulty-label" style={labelStyle}>{t('quiz.difficulty')}</span>
              <RadioCardGroup value={difficultyMode} onChange={(value) => setDifficultyMode(value as DifficultyMode)} labelledBy="quiz-difficulty-label" orientation="horizontal" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {DIFFICULTY_VALUES.map((value, index) => {
                  const label = t(`difficulty.${value}` as TranslationKey);
                  return (
                    <RadioCard key={value} value={value} index={index} label={t('quiz.difficultyAria', { label })} style={{ ...pill(difficultyMode === value), borderRadius: 'var(--radius-element)' }}>
                      {label}
                    </RadioCard>
                  );
                })}
              </RadioCardGroup>
              <p className="quiz-setup__helper" role="status">
                {t(`difficulty.${difficultyMode}` as TranslationKey)}: {t(`difficulty.${difficultyMode}.tip` as TranslationKey)}
              </p>
            </div>
          </div>

          {!authLoading && !isAuthenticated && (
            <StatePanel inline body={t('quiz.guestSetup')} signIn={{ emphasis: 'secondary' }} />
          )}

          {/* Start: the screen's one primary, SwimCta md. */}
          <div className="quiz-setup__start">
            {/* aria-disabled, not disabled: with no category it stays in the
                Tab order, and pressing it names what is missing. */}
            <SwimCta label={t('quiz.startQuiz')} onClick={handleStart} dir={1} unavailable={selectedCategories.length === 0} describedBy="categories-error" size="md" />
          </div>
        </div>

        {/* Quick entries into the daily challenge — kept as quiet links. */}
        <div className="ss-text-links" style={{ justifyContent: 'center', marginTop: 16 }}>
          {config.features.dailyChallenge && (
            <button type="button" onClick={startDailyChallenge}>{t('quiz.todaysChallenge')}</button>
          )}
          {isAuthenticated && (
            <button type="button" onClick={() => void startPersonalizedReview()}>{t('quiz.reviewWeakAreas')}</button>
          )}
          <button type="button" onClick={() => navigate('/challenge')}>{t('challenge.cta')}</button>
        </div>

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

  if (state === 'submitted' && result) {
    // "80% · JavaScript, React · Climb": what was scored, on which topics, at
    // which difficulty (design audit P1.7). Daily and review sets draw across
    // levels, so they read Mixed.
    const resultCategories = [...new Set(questions.map((question) => question.category))];
    const resultTopics = resultCategories.length <= 3
      ? resultCategories.map((category) => t(categoryLabelKey(category))).join(', ')
      : t('quiz.resultTopics', { n: resultCategories.length });
    const resultDifficulty = t(`difficulty.${mode === 'standard' ? difficultyMode : 'mixed'}` as TranslationKey);
    return (
      <>
        {/* The summary and the review share one column and both edges
            (UX audit U2, questions-12). */}
        <div className="ss-pop quiz-results">
          <div
            className="ss-panel quiz-results__summary"
            role="region"
            aria-labelledby="quiz-result-heading"
          >
            <Kicker center style={{ position: 'relative' }}>{t('quiz.complete')}</Kicker>
            <MotionPop>
              <h1
                id="quiz-result-heading"
                ref={resultHeadingRef}
                tabIndex={-1}
                aria-label={t('quiz.scoreOutOf', { correct: result.correctAnswers, total: result.totalQuestions })}
                style={{ position: 'relative', margin: 0, fontFamily: 'var(--font-family-heading)', fontWeight: 800, fontSize: '3rem', lineHeight: 1, letterSpacing: '-0.02em', color: 'var(--brand-accent)' }}
              >
                {result.correctAnswers} / {result.totalQuestions}
              </h1>
            </MotionPop>
            <span style={{ position: 'relative', fontSize: 'var(--ss-type-compact)', color: 'var(--color-text-secondary)' }}>
              {result.percentage}% · {resultTopics} · {resultDifficulty}
            </span>

            {(result.voided?.length ?? 0) > 0 && (
              <Text type="supporting" color="secondary" justify="center">
                {t('quiz.voidedNote', { n: result.voided!.length })}
              </Text>
            )}

            {mode === 'daily' && (
              <Text type="supporting" color="secondary" justify="center">
                {t('quiz.dailyComplete')} {t('quiz.dailyNext', { time: dayChange })}
              </Text>
            )}

            {!isAuthenticated && (
              <Text type="supporting" color="secondary" justify="center">
                {t('register.deviceOnly')}
              </Text>
            )}

            {mode === 'review' && reviewPlan.length > 0 && (
              <div style={{ position: 'relative', width: '100%', maxWidth: 520, textAlign: 'left' }}>
                <Text weight="bold">{t('quiz.reviewPlanTitle')}</Text>
                <Text type="supporting" size="sm" color="secondary">
                  {reviewPlan.map((area) => `${t(categoryLabelKey(area.category))} ${area.accuracyPct}%`).join(' · ')}
                </Text>
              </div>
            )}

          </div>
          <QuestionActions
            secondary={
              <Button
                variant="secondary"
                label={t('quiz.reviewAnswersArrow')}
                onClick={() => {
                  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                  document.getElementById('quiz-review')?.scrollIntoView({ behavior: still ? 'auto' : 'smooth' });
                }}
              />
            }
            primary={{ label: t('quiz.newQuiz'), onClick: handleRestart }}
          />
        </div>

        <h2 id="quiz-review" className={`quiz-review-header ${reviewWave}`}>
          {t('quiz.reviewYourAnswers', { count: questions.length })}
        </h2>
        <div className="quiz-review-grid">
        {questions.map((question, index) => {
          const questionResult = resultsById.get(question.id);
          const isCorrect = questionResult?.isCorrect;
          // Retired while the quiz was open: graded as void, so there is no
          // verdict and no answer key to show or to bookmark.
          const isVoided = !questionResult && (result.voided ?? []).includes(question.id);

          return (
            <MotionItem key={question.id} index={index} className={`quiz-review-item ${isVoided ? 'is-voided' : isCorrect ? 'is-correct' : 'is-incorrect'}`}>
              <Card variant="default" padding={3} width="100%" className="quiz-review-card">
                <VStack gap={1.5}>
                  <HStack justify="between" align="center" wrap="wrap" gap={1}>
                    {/* One meta line: number, topic, verdict (glyph and word). */}
                    <Text type="supporting" color="secondary">
                      {index + 1} · {t(categoryLabelKey(question.category))} ·{' '}
                      {isVoided ? (
                        <span style={{ fontWeight: 600 }}>{t('quiz.voidedItem')}</span>
                      ) : (
                        <span style={{ color: isCorrect ? 'var(--ss-success-strong)' : 'var(--ss-error)', fontWeight: 600 }}>
                          <span aria-hidden>{isCorrect ? '✓' : '✕'}</span> {isCorrect ? t('quiz.correct') : t('quiz.incorrect')}
                        </span>
                      )}
                    </Text>
                    <HStack gap={0.5} align="center">
                      {questionResult && !isVoided && <SaveSharkCard question={question} correctIndex={questionResult.correctAnswer} explanation={questionResult.explanation ?? ''} />}
                      <QuestionIconButton
                        label={t('quiz.reportAria')}
                        icon={<ReportFlagIcon />}
                        onClick={() => setReportTarget({ id: question.id, version: question.review?.version })}
                      />
                    </HStack>
                  </HStack>

                  <div className="quiz-review-question">{renderQuestion(question.question)}</div>

                  {!isVoided && (
                    <Text type="body" size="sm">
                      {t('quiz.yourAnswerLabel')}{' '}
                      <strong>{question.options[questionResult?.selectedIndex ?? 0]}</strong>
                    </Text>
                  )}
                  {!isCorrect && !isVoided && (
                    <span style={{ color: 'var(--ss-success-strong)' }}>
                      <Text type="body" size="sm" color="inherit">
                        {t('quiz.correctLabel')}{' '}
                        <strong>{question.options[questionResult?.correctAnswer ?? 0]}</strong>
                      </Text>
                    </span>
                  )}
                  {/* Plain secondary text under one hairline: a bordered
                      box in every card was a panel inside a card. */}
                  {questionResult?.explanation && (
                    <p className="quiz-review-explanation">{questionResult.explanation}</p>
                  )}
                  {/* Shark Cards (owner decision 12): keep a question to come
                      back to, with the answer and explanation graded here. */}

                </VStack>
              </Card>
            </MotionItem>
          );
        })}
        </div>

        <AppToast
          open={!!snack}
          onClose={() => setSnack(null)}
          severity="info"
          message={snack ?? ''}
          autoHideDuration={2500}
        />
        <ReportDialog
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
          onSubmit={handleReport}
        />
      </>
    );
  }

  // in-progress
  if (!currentQuestion) return null;

  const answered = Object.keys(answers).length;
  const progress = (answered / questions.length) * 100;
  const allAnswered = questions.every((q) => answers[q.id] !== undefined);
  const remaining = questions.length - answered;
  const isLast = currentIndex === questions.length - 1;
  const questionId = `question-text-${currentQuestion.id}`;
  const hintOpen = !!revealedHints[currentQuestion.id];
  // Submit with questions left stays pressable and says how many; pressed,
  // it goes to the first one still open.
  const submitPressed = () => {
    if (!allAnswered) {
      const open = questions.findIndex((q) => answers[q.id] === undefined);
      if (open >= 0) setCurrentIndex(open);
      return;
    }
    void handleSubmit();
  };

  const hintTool = currentQuestion.introduction ? (
    <Popover
      isOpen={hintOpen}
      onOpenChange={(o) =>
        setRevealedHints((prev) => {
          if (o) {
            setHintedIds((ids) =>
              ids.includes(currentQuestion.id) ? ids : [...ids, currentQuestion.id],
            );
          }
          return { ...prev, [currentQuestion.id]: o };
        })
      }
      placement="below"
      // The hint button sits at the right of the header, so the popover
      // hangs from its right edge and opens leftwards. With
      // `alignment="end"` the anchored area runs from the viewport's left
      // edge to that button, and the percentage below resolves against it:
      // 320px where there is room, and on a phone the width that fits, 16px
      // clear of the edge. Centred at a fixed 320px it ran up to 199px off a
      // 390px screen.
      alignment="end"
      width="min(320px, calc(100% - 16px))"
      label={t('quiz.showHint')}
      // Astryx's own close button is visually hidden until it has focus.
      // Here the hint is plain text, so autofocus landed on that button and
      // it surfaced as a "Close popover" label; on touch, the tap moved focus
      // before the click arrived, the button collapsed back to one pixel, and
      // the click missed — the label vanished and the hint stayed open. An
      // always visible × that closes the hint replaces it.
      hasCloseButton={false}
      content={
        <div className="quiz-hint">
          <div className="quiz-hint__text">{currentQuestion.introduction}</div>
          <Button
            isIconOnly
            icon={<CloseIcon size={18} />}
            variant="ghost"
            label={t('quiz.closeHint')}
            onClick={() => setRevealedHints((prev) => ({ ...prev, [currentQuestion.id]: false }))}
          />
        </div>
      }
    >
      <QuestionIconButton label={t('quiz.showHint')} icon={<HintIcon />} pressed={hintOpen} tooltip={false} />
    </Popover>
  ) : null;

  return (
    <>
      {/* One question screen from the shared parts (UX audit U2): the 640px
          shell, the run's h1 in the header, a question block of one height
          so the answers start at the same y on every question, and the
          action row under the panel. */}
      <QuestionShell
        ref={questionTextRef}
        questionId={questionId}
        notice={error && (
          <Banner
            status="error"
            title={error}
            description={answersLocked ? t('quiz.answersLocked') : undefined}
            isDismissable
            onDismiss={() => setError(null)}
          />
        )}
        header={
          <QuestionHeader
            run={t('nav.quiz')}
            title={t('quiz.questionCounter', { current: currentIndex + 1, total: questions.length })}
            progress={{ value: progress, label: t('quiz.progressAria') }}
            meta={<CategoryTag category={currentQuestion.category} />}
            difficulty={currentQuestion.difficulty}
            tools={
              <>
                {hintTool}
                <QuestionIconButton
                  label={t('quiz.reportAria')}
                  icon={<ReportFlagIcon />}
                  onClick={() => setReportTarget({ id: currentQuestion.id, version: currentQuestion.review?.version })}
                />
                <QuestionIconButton label={t('quiz.exitQuiz')} icon={<ExitIcon />} onClick={handleAbandon} />
              </>
            }
          />
        }
        question={
          <>
            {renderQuestion(currentQuestion.question)}
            {/* Beside the block, never inside an option: opening help must
                not select an answer, and the list is the same whichever
                option is right. */}
            <TermsBar
              texts={[currentQuestion.question, ...currentQuestion.options]}
              domain={glossaryDomainFor(currentQuestion.category)}
            />
            {mode === 'review' && interleaved && currentIndex === 0 && (
              <p className="quiz-question-note">{t('quiz.interleavedNote')}</p>
            )}
            {mode === 'standard' && hardestAvailable && currentIndex === 0 && (
              <p className="quiz-question-note">{t('quiz.hardestAvailableNote')}</p>
            )}
          </>
        }
        actions={
          <>
            <QuestionActions
              secondary={
                <Button
                  variant="secondary"
                  label={t('quiz.previous')}
                  onClick={handlePrevious}
                  isDisabled={currentIndex === 0}
                />
              }
              primary={
                isLast
                  ? {
                    label: submitting ? t('quiz.submitting') : t('quiz.submitQuiz'),
                    onClick: submitPressed,
                    disabled: submitting,
                    unavailable: !allAnswered,
                    describedBy: !allAnswered ? 'quiz-submit-why' : undefined,
                  }
                  : { label: t('quiz.next'), onClick: handleNext }
              }
            />
            {/* Why Submit reads unavailable, in sight under it: the old
                disabled button said so in a hover tooltip. */}
            {isLast && !allAnswered && (
              <p id="quiz-submit-why" className="quiz-submit-why">{t('quiz.answerMore', { count: remaining })}</p>
            )}
          </>
        }
      >
        <AnswerOptionList
          options={currentQuestion.options}
          value={answers[currentQuestion.id] ?? null}
          onChange={(index) => handleAnswer(currentQuestion.id, index)}
          labelledBy={questionId}
          disabled={answersLocked}
        />
        <QuestionHint
          max={currentQuestion.options.length}
          verb="select"
          next={!isLast ? 'continue' : allAnswered ? 'submit' : undefined}
        />
      </QuestionShell>

      <AppToast
        open={!!snack}
        onClose={() => setSnack(null)}
        severity="info"
        message={snack ?? ''}
        autoHideDuration={2500}
      />
      <ReportDialog
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={handleReport}
      />
      <AlertDialog
        className="ss-alert-dialog"
        isOpen={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title={t('quiz.leaveTitle')}
        description={t('quiz.leaveBody')}
        actionLabel={t('quiz.leaveConfirm')}
        cancelLabel={t('quiz.leaveCancel')}
        onAction={confirmAbandon}
        width="min(460px, calc(100vw - 32px))"
      />
    </>
  );
}

export default Quiz;
