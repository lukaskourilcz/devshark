// A Learn level or part test once it is open: its questions with instant
// feedback, the coding tasks a level ends with, and the result. Roadmap.tsx
// loads it when a level opens, with the level intros and worked-example
// figures it shows, so the Learn map paints without them.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button as AxButton } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { Kicker, SwimCta } from '../landing/LandingKit';
import { AppToast } from '../ui/AppToast';
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
  type QuestionPrimaryAction,
} from '../question';
import type { RoadmapPlayable, RoadmapQuestion, RoadmapAnswerResult } from '../../types/quiz';
import type { LearnRepeatXp } from '../../../../shared/repeat-xp';
import type { PlayableCodingTask } from '../../../../shared/coding-catalog';
import { submitRoadmapAnswer, completeRoadmapAttempt, checkRoadmapAttempt } from '../../lib/roadmap';
import ReferralMoment from '../ReferralMoment';
import ResultShareActions from '../ResultShareActions';
import { ROADMAP_MAX_HEARTS } from '../../../../shared/assessment';
import { levelIntro } from '../../lib/levelIntros';
import { categoryLabelKey } from '../../lib/categories';
import { BRAND } from '../../theme/MuiTheme';
import { useLanguage } from '../../i18n/LanguageContext';
import type { TranslationKey } from '../../i18n/translations';
import { useAuth } from '../../lib/auth';
import { ApiError, friendlyError } from '../../lib/api';
import { reportQuestion } from '../../lib/supabase';
import { shuffleDifferentFrom } from '../../lib/shuffle';
import { autosaveDraft, codingDraftQuery, flushAutosave, forgetDeviceDraft, openingDraft, saveDraft } from '../../coding/drafts';
import { fetchCodingTask } from '../../coding/api';
import { DraftNote, useDraftChoice } from '../../coding/DraftNote';
import { renderQuestion } from '../CodeBlock';
import { TermsBar } from '../ui/Terms';
import { LessonFigures } from '../ui/LessonFigure';
import { figuresFor } from '../../../../shared/lesson-figures';
import { glossaryDomainFor } from '../../lib/glossaryDomain';
import { RedFlagDialog } from '../RedFlagDialog';
import { IconTile, CloseIcon, TrophyIcon } from '../ui/icons';
import { preloadTaskWorkbench, useWorkbench } from '../../coding/loadWorkbench';
import { ShellPartBoundary } from '../ShellPartBoundary';
import ErrorRetry from '../ErrorRetry';
import './LessonRunner.css';
import { SaveSharkCard } from '../SaveSharkCard';
import { CheckIcon } from './SectionRail';

// The coding workbench pulls the editor and the runner in; keep it out of the
// Learn chunk until a devShark level reaches its last question before a
// coding step (preloadTaskWorkbench below), as a task link's intent does on
// /coding. It is drawn from state, not through Suspense, as the task screen
// draws it (useWorkbench): React held a suspended step's reveal back for up
// to 300 ms after its code was in (#587 paths walk). When its code does not
// load, the level stays on screen with "Could not load this task." and a Try
// again that asks again, or reloads when the same failure comes straight back.

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

const CHECKPOINT_GOLD = BRAND.gold;
// Lives for a level lesson: one heart that drains a third per wrong answer.
// The API grades the same rule, so the number is shared.
const MAX_HEARTS = ROADMAP_MAX_HEARTS;
const HEART_COLOR = BRAND.coral;

// The server already shuffles answer options and seals their accepted indices.
// We may vary question order locally without changing those protected indices.
function presentQuestions(questions: RoadmapQuestion[], prev?: RoadmapQuestion[]): RoadmapQuestion[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const reference = (prev ?? questions).map((q) => byId.get(q.id)).filter((q): q is RoadmapQuestion => !!q);
  return reference.length === questions.length
    ? shuffleDifferentFrom(questions, reference)
    : shuffleDifferentFrom(questions, questions);
}

/* ──── lesson runner (instant feedback) ─────────────────────────────────── */

/** A new screen of the level (the intro, a question, a result) takes focus
 * without the browser's own scroll and, when its top is out of sight, opens
 * at its top under the site header. The page scrolled down to reach the last
 * Continue or Finish, under a long verdict, and the next screen otherwise
 * opened with its header and question above the screen (UX audit learn-02).
 * A screen already in sight does not move, so the exit button keeps its place
 * from the intro to the first question (learn-03). */
function openAtTop(target: HTMLElement | null) {
  target?.focus({ preventScroll: true });
  const shell = target?.closest<HTMLElement>('.ss-question');
  if (!shell) return;
  const clearance = parseFloat(getComputedStyle(shell).scrollMarginTop) || 0;
  if (shell.getBoundingClientRect().top < clearance) shell.scrollIntoView?.({ block: 'start' });
}

const HEART_PATH =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

const HeartShape = ({ color, style }: { color: string; style?: CSSProperties }) => (
  <svg width="30" height="30" viewBox="0 0 24 24" style={style} aria-hidden>
    <path fill={color} d={HEART_PATH} />
  </svg>
);

// A single heart that drains a third per mistake. The red fill is anchored to the
// bottom and clipped to the remaining fraction, so it empties from the top down.
function HeartMeter({ mistakes, max, hit, t }: { mistakes: number; max: number; hit: boolean; t: TFn }) {
  const remaining = Math.max(0, max - mistakes);
  const frac = remaining / max;
  return (
    <div
      className={`rm-heart${hit ? ' rm-shake' : ''}`}
      role="img"
      aria-label={t('roadmap.heartsLeft', { n: remaining, max })}
      style={{ position: 'relative', width: 30, height: 30, flexShrink: 0 }}
    >
      <HeartShape color={`${HEART_COLOR}2e`} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${frac * 100}%`, overflow: 'hidden', transition: 'height 0.45s cubic-bezier(0.34, 1.3, 0.5, 1)' }}>
        <HeartShape color={HEART_COLOR} style={{ position: 'absolute', bottom: 0, left: 0 }} />
      </div>
    </div>
  );
}

/** Why a level's session can no longer be used. `expired`: it outlived the
 * attempt the server keeps for it (two hours), or the attempt was closed.
 * `signInChanged`: it was opened under a different sign-in than the one now
 * answering (a sign-in or sign-out mid-level). */
type SessionRestart = 'expired' | 'signInChanged';
function sessionRestartFor(error: unknown): SessionRestart | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'session_owner_mismatch') return 'signInChanged';
  if (error.code === 'invalid_session' || error.code === 'attempt_conflict') return 'expired';
  return null;
}

/** One coding task of a level. It opens on this device's copy or the
 * account draft, keeps a device copy as the learner types and saves to the
 * account on Run and Submit, as a task in the Coding section does
 * (coding/drafts.ts): a copy from this device that did not open is offered
 * back, and a save the account refused is asked about. The workbench reads
 * its code once, so it waits for the account's draft; a draft that cannot
 * load leaves this device's copy. */
function LessonCodingTask({ task, session, signedIn, onPassed, onRevealed, onContinue }: {
  task: PlayableCodingTask;
  session: string;
  signedIn: boolean;
  onPassed: () => void;
  onRevealed: () => void;
  onContinue: () => void;
}) {
  const { t } = useLanguage();
  const [currentTask, setCurrentTask] = useState({ task, session });
  const draft = useQuery({ ...codingDraftQuery(task.id), enabled: signedIn });
  const waiting = signedIn && draft.isLoading;
  const opening = useMemo(() => (waiting ? null : openingDraft(task.id, draft.data?.code ?? null, draft.data?.updatedAt)), [waiting, task.id, draft.data]);
  const choice = useDraftChoice(task.id, opening, draft.data?.updatedAt ?? null, { signedIn });
  const { base, epoch } = choice;
  // Leaving the step writes what is still waiting.
  useEffect(() => () => flushAutosave(task.id), [task.id]);
  const [attempt, setAttempt] = useState(0);
  const workbench = useWorkbench(true, attempt);
  const CodingWorkbench = workbench.View;
  const loading = <div className="cd-note" role="status">{t('common.loading')}</div>;
  if (workbench.failed && !CodingWorkbench) return <ErrorRetry message={t('coding.loadError')} onRetry={() => setAttempt((n) => n + 1)} busy={workbench.reloading} />;
  if (!opening || !CodingWorkbench) return loading;
  return (
    <>
      <DraftNote choice={choice} />
      <ShellPartBoundary fallback={(retry, busy) => <ErrorRetry message={t('coding.loadError')} onRetry={retry} busy={busy} />}>
          <CodingWorkbench
            key={choice.version}
            task={currentTask.task}
            session={currentTask.session}
            locked={null}
            signedIn={signedIn}
            initialCode={choice.code}
            mode="lesson"
            onDraft={(code) => saveDraft(task.id, code, { signedIn, base, epoch })}
            onEdit={(code) => autosaveDraft(task.id, code, base, epoch)}
            onVerdict={(verdict, _submittedCode, sourceChanged) => {
              if (verdict.verdict === 'passed') {
                if (!sourceChanged) forgetDeviceDraft(task.id, epoch);
                onPassed();
              }
            }}
            onRefreshTask={async (code) => {
              saveDraft(task.id, code, { signedIn, base, epoch });
              const refreshed = await fetchCodingTask(task.id, undefined, currentTask.session);
              if (!refreshed.session) throw new Error(t('coding.loadError'));
              setCurrentTask({ task: refreshed.task, session: refreshed.session });
            }}
            onRevealed={onRevealed}
            onContinue={onContinue}
          />
      </ShellPartBoundary>
    </>
  );
}

export function LessonRunner({
  playable, firstLevelPass = false, topicCompleted = false, skipIntro = false, topicColor, hasNext, nextLabel, onExit, onFinished, onNext, onReplay, onActiveChange, t,
}: {
  playable: RoadmapPlayable;
  /** No Learn level was passed before this one opened (#239). */
  firstLevelPass?: boolean;
  topicCompleted?: boolean;
  /** Full lesson reading already preceded this attempt. */
  skipIntro?: boolean;
  topicColor: string; hasNext: boolean; nextLabel: string;
  onExit: () => void; onFinished: (pct: number, repeatXp?: LearnRepeatXp) => void; onNext: () => void;
  onReplay: () => void;
  /** True while a question is on screen: the app shell then hides its header
   * and footer, as for a Quiz or a Challenge run (UX audit questions-07). The
   * header's Exit is the way out. */
  onActiveChange?: (active: boolean) => void;
  t: TFn;
}) {
  const { user } = useAuth();
  // Fixed when the level opens: the pass itself updates the progress the
  // parent reads, and the offer must stay on the finish screen.
  const [firstPassMoment] = useState(() => firstLevelPass && playable.kind === 'level');
  const isCheckpoint = playable.kind === 'checkpoint';
  const accent = isCheckpoint ? CHECKPOINT_GOLD : topicColor;
  // A level opens with a short info panel (what this section is about + a core
  // principle) before the first question. Checkpoints/part-tests skip it, as do
  // levels with no authored intro.
  const intro = playable.kind === 'level' ? levelIntro(playable.topic, playable.ref) : null;
  const [showIntro, setShowIntro] = useState<boolean>(() => !skipIntro && !!intro);
  // Question sequence + answer order are shuffled on every play (and re-shuffled
  // on replay, avoiding the previous layout) so positions stay unmemorisable.
  const [presented] = useState<RoadmapQuestion[]>(() => presentQuestions(playable.questions));
  const total = presented.length;
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [grade, setGrade] = useState<RoadmapAnswerResult | null>(null);
  const [grading, setGrading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  // Hearts apply to levels only; checkpoints keep the percent-based pass rule.
  const [mistakes, setMistakes] = useState(0);
  const [dead, setDead] = useState(false);
  const [heartHit, setHeartHit] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagSnack, setFlagSnack] = useState(false);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  // devShark code levels end with coding tasks. The level passes only when the
  // server has a passed verdict for every one of them (the ids are sealed in
  // the level session), so the finish screen reads the server's answer.
  const codingTasks = useMemo(() => (playable.kind === 'level' ? playable.coding ?? [] : []), [playable]);
  // One answer before a coding step, its workbench (and, where it will show,
  // the editor) starts loading, so the step opens at once (#587 paths walk).
  const nearCoding = codingTasks.length > 0 && qIndex >= total - 1;
  useEffect(() => { if (nearCoding) void preloadTaskWorkbench().catch(() => undefined); }, [nearCoding]);
  const [codingPhase, setCodingPhase] = useState(false);
  const [codingIndex, setCodingIndex] = useState(0);
  const [codingPassed, setCodingPassed] = useState<string[]>([]);
  const [codingPending, setCodingPending] = useState<string[]>([]);
  // The learner showed the current task's solution, which ends the attempt.
  // The workbench stays, with the solution open, until they finish the level.
  const [solutionShown, setSolutionShown] = useState(false);
  // Signed out, the server passes a level on its questions and says its
  // coding tasks went unchecked; the finish screen says when they count.
  const [codingUnverified, setCodingUnverified] = useState(false);
  // The attempt was closed without a verdict because a question in it was
  // retired while it was open. Nothing was recorded, so the finish screen
  // offers the level again rather than a score.
  const [invalidated, setInvalidated] = useState(false);
  // The server can no longer use this session: it outlived its attempt, or it
  // was opened under a different sign-in. Sending it again fails the same
  // way, so the level offers a fresh start instead of Try again.
  const [restart, setRestart] = useState<SessionRestart | null>(null);
  const reportError = useCallback((error: unknown) => {
    const reason = sessionRestartFor(error);
    if (reason) setRestart(reason);
    else setAnswerError(friendlyError(error));
  }, []);

  const question = presented[qIndex];
  // Out of hearts once this answer is revealed and it pushed mistakes to the max.
  const outOfHearts = !isCheckpoint && mistakes >= MAX_HEARTS;

  // The question an answer was sent for. A ref, not only `grading`: a second
  // key press or click can land before the first one's state re-renders, and
  // each sent its own answer. Cleared when the send fails, so Try again works.
  const answeredRef = useRef<string | null>(null);
  const choose = useCallback(
    async (index: number) => {
      if (revealed || grading || answeredRef.current === question.id) return;
      answeredRef.current = question.id;
      setGrading(true);
      setAnswerError(null);
      setSelected(index);
      try {
        const result = await submitRoadmapAnswer(playable.sessionId, question.id, index);
        setSelected(result.selectedIndex);
        setGrade(result);
        setRevealed(true);
        if (result.isCorrect) {
          setCorrectCount((count) => count + 1);
        } else if (!isCheckpoint) {
          setMistakes((mistakeCount) => mistakeCount + 1);
          setHeartHit(true);
          window.setTimeout(() => setHeartHit(false), 500);
        }
      } catch (error) {
        answeredRef.current = null;
        reportError(error);
      } finally {
        setGrading(false);
      }
    },
    [revealed, grading, playable.sessionId, question.id, isCheckpoint, reportError],
  );

  // One completion at a time, and none after the attempt finished. Finish, the
  // coding step's Continue, Check completion and the focus and visibility
  // re-checks can each ask, sometimes at once (returning to the tab fires
  // both events); a second answer recorded the pass again, toasted its XP
  // twice and could replace the result with "timed out". A ref, because the
  // second ask can come before `completing` re-renders.
  const completionRef = useRef<'idle' | 'sending' | 'done'>('idle');
  const complete = useCallback(async () => {
    if (completionRef.current !== 'idle') return;
    completionRef.current = 'sending';
    setCompleting(true);
    setAnswerError(null);
    try {
      const result = await completeRoadmapAttempt(playable.sessionId);
      if (result.invalidated) {
        completionRef.current = 'done';
        setInvalidated(true);
        setCodingPhase(false);
        setFinished(true);
        return;
      }
      setCorrectCount(result.correctAnswers);
      setCodingPending(result.codingPending ?? []);
      setCodingUnverified(result.codingUnverified === true);
      if (result.waiting) {
        setCodingPhase(true);
        return;
      }
      completionRef.current = 'done';
      // A level that fails its coding gate is recorded as not passed even with
      // a full question score; report the percentage the server computed but
      // keep the local pass record honest.
      onFinished((result.codingPending?.length ?? 0) > 0 ? Math.min(result.percentage, playable.passPct - 1) : result.percentage, result.repeatXp);
      setCodingPhase(false);
      setFinished(true);
    } catch (error) {
      reportError(error);
    } finally {
      if (completionRef.current === 'sending') completionRef.current = 'idle';
      setCompleting(false);
    }
  }, [onFinished, playable.passPct, playable.sessionId, reportError]);

  const checkCoding = useCallback(async () => {
    try {
      const status = await checkRoadmapAttempt(playable.sessionId);
      const passed = status.coding.filter(item => item.passed).map(item => item.taskId);
      setCodingPassed(passed);
      if (status.coding.some(item => item.revealed)) setSolutionShown(true);
      if (codingPhase && codingTasks.every(item => passed.includes(item.task.id))) await complete();
    } catch (error) { reportError(error); }
  }, [playable.sessionId, codingPhase, codingTasks, complete, reportError]);
  useEffect(() => {
    if (!user || codingTasks.length === 0 || finished) return;
    const refresh = () => { if (document.visibilityState === 'visible') void checkCoding(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [user, codingTasks.length, finished, checkCoding]);

  const advance = useCallback(async () => {
    if (outOfHearts) {
      if (completionRef.current !== 'idle') return;
      completionRef.current = 'sending';
      setCompleting(true);
      setAnswerError(null);
      try {
        const result = await completeRoadmapAttempt(playable.sessionId);
        completionRef.current = 'done';
        if (result.invalidated) {
          setInvalidated(true);
          setFinished(true);
          return;
        }
        setCorrectCount(result.correctAnswers);
        // Out of hearts is a failed level however the percentage lands, so keep
        // the local record below the pass mark and let the server decide.
        onFinished(result.passed ? result.percentage : Math.min(result.percentage, playable.passPct - 1), result.repeatXp);
        setDead(true);
        setFinished(true);
      } catch (error) {
        reportError(error);
      } finally {
        if (completionRef.current === 'sending') completionRef.current = 'idle';
        setCompleting(false);
      }
    } else if (qIndex < total - 1) {
      setQIndex((i) => i + 1);
      setSelected(null);
      setRevealed(false);
      setGrade(null);
      setAnswerError(null);
    } else if (codingTasks.length > 0) {
      // Questions done: the coding phase decides the rest of the level.
      setRevealed(false);
      setGrade(null);
      setAnswerError(null);
      setCodingPhase(true);
    } else {
      await complete();
    }
  }, [total, outOfHearts, qIndex, onFinished, playable.passPct, playable.sessionId, codingTasks.length, complete, reportError]);

  const submitFlag = async (detail?: string) => {
    await reportQuestion({
      questionId: question.id,
      reason: 'needs-review',
      detail,
      reporterSub: user?.id,
      // The wording that was on screen, so a fix can be checked against it.
      contentVersion: question.review?.version,
    });
    setFlagOpen(false);
    setFlagSnack(true);
  };

  const questionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (finished || restart || showIntro || codingPhase) return;
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], [role="radio"], [role="checkbox"]')) return;
      if (!revealed && /^[1-9]$/.test(e.key)) {
        if (!target || !questionRef.current?.closest('.ss-question')?.contains(target)) return;
        const idx = parseInt(e.key, 10) - 1;
        if (idx < question.options.length) {
          e.preventDefault();
          void choose(idx);
        }
      } else if (revealed && e.key === 'Enter') {
        e.preventDefault();
        void advance();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [finished, restart, showIntro, codingPhase, revealed, question, choose, advance]);

  useEffect(() => {
    if (finished || restart) openAtTop(resultHeadingRef.current);
  }, [finished, restart]);

  // Focus follows the lesson. An answer disables the option that held focus
  // and the next question removes the Continue that did, and focus fell to
  // the page: a keyboard learner had to tab through the whole shell to go on.
  // A revealed answer takes focus to its Continue (or Try again); a question
  // takes it to the question, where the number keys still answer.
  const showingQuestion = !finished && !restart && !showIntro && !codingPhase;
  useEffect(() => {
    if (showingQuestion) openAtTop(questionRef.current);
  }, [showingQuestion, qIndex]);
  useEffect(() => { onActiveChange?.(showingQuestion); }, [showingQuestion, onActiveChange]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
  // The intro opens from the map, wherever it was scrolled; its h1 takes
  // focus, as a result's does, so a screen reader starts at the level's name.
  const introTitleRef = useRef<HTMLHeadingElement>(null);
  const showingIntro = showIntro && !!intro && !restart;
  useEffect(() => {
    if (showingIntro) openAtTop(introTitleRef.current);
  }, [showingIntro]);
  // The coding step (and each next task of it) takes focus like every other
  // screen of the level: the last question's Continue that held it is gone,
  // and focus fell to the page, so a keyboard learner started again at the
  // site header. Its line says what the step is.
  const codingIntroRef = useRef<HTMLParagraphElement>(null);
  const showingCoding = codingPhase && !restart && !showingIntro && codingIndex < codingTasks.length;
  useEffect(() => {
    if (showingCoding) openAtTop(codingIntroRef.current);
  }, [showingCoding, codingIndex]);

  // The one header row of every screen in a level (UX audit learn-03): the
  // level in the h1, progress and hearts (or the checkpoint score) on the
  // first row, with Exit beside the hearts or score.
  const counter = t('roadmap.question', { current: qIndex + 1, total });
  const progressPct = ((qIndex + (revealed ? 1 : 0)) / total) * 100;
  const levelHeader = (meta?: ReactNode, titleRef?: Ref<HTMLHeadingElement>) => (
    <QuestionHeader
      titleRef={titleRef}
      title={`${isCheckpoint ? t('roadmap.checkpoint') : t('roadmap.levelLabel', { n: playable.ref })} · ${playable.title}`}
      progress={{ value: progressPct, label: counter }}
      status={isCheckpoint
        ? <Text type="supporting" color="secondary" weight="bold">{correctCount}/{total}</Text>
        : <HeartMeter mistakes={mistakes} max={MAX_HEARTS} hit={heartHit} t={t} />}
      meta={meta}
      exit={<QuestionIconButton label={t('roadmap.exit')} icon={<ExitIcon />} onClick={onExit} />}
    />
  );

  if (restart) {
    return (
      <LessonResult
        heading={restart === 'expired' ? t('roadmap.expiredTitle') : t('roadmap.signInChangedTitle')}
        headingRef={resultHeadingRef}
        primary={{ label: t('roadmap.restartLevel'), onClick: onReplay }}
        secondary={<AxButton variant="ghost" label={t('roadmap.backToPath')} onClick={onExit} />}
      >
        <p role="status" className="rm-result__line">
          {restart === 'expired' ? t('roadmap.expiredBody') : t('roadmap.signInChangedBody')}
        </p>
      </LessonResult>
    );
  }

  if (showIntro && intro) {
    // The intro uses the question screen's column, panel and header, so
    // pressing Start moves nothing but the content (UX audit learn-03), and
    // Start is the screen's one SwimCta md, right-aligned under the panel
    // (learn-04).
    return (
      <QuestionShell
        questionId="lesson-intro"
        focusable={false}
        stable={false}
        header={levelHeader(<Text type="supporting" color="secondary" weight="bold">{t('roadmap.introKicker')}</Text>, introTitleRef)}
        question={
          <>
            <p className="rm-intro__text">{intro}</p>
            {/* The worked example for this level's objective, before the
                questions. Figures that would answer one of them are held back;
                `figuresFor` filters them out at this phase rather than the
                renderer hiding them afterwards. */}
            <LessonFigures figures={figuresFor(playable.topic, playable.ref, 'before')} />
            {codingTasks.length > 0 && (
              <p className="rm-intro__coding">
                <strong>{t('coding.lesson.kicker')}: </strong>
                {codingTasks.map(({ task, session }, index) => <span key={task.id}>
                  {index > 0 && ' · '}<a className="cd-link" target="_blank" rel="noopener noreferrer" href={`/coding/${task.track}/${task.id}#learn=${encodeURIComponent(session)}`}>{task.title}</a>
                </span>)}
              </p>
            )}
          </>
        }
        actions={<QuestionActions primary={{ label: t('roadmap.introStart'), onClick: () => setShowIntro(false) }} />}
      />
    );
  }

  if (codingPhase && codingTasks[codingIndex]) {
    const current = codingTasks[codingIndex];
    const title = current.task.title;
    // ss-wide-page: while the editor is mounted the route box widens to the
    // wide page (1200px), so the workbench has the same frame and editor size
    // as on /coding (UX audit coding-03). Reading and quiz phases stay narrow.
    return (
      <div className="cd-page ss-wide-page" data-activity="active" style={{ flex: 1, minHeight: 0, overflowY: 'auto', gap: 12, paddingBottom: 24 }}>
        <p ref={codingIntroRef} tabIndex={-1} className="cd-visually-hidden">{t('coding.lesson.intro')} {t('coding.lesson.giveUpNote')}</p>
        <LessonCodingTask
          key={current.task.id}
          task={current.task}
          session={current.session}
          signedIn={Boolean(user)}
          onPassed={() => setCodingPassed((prev) => (prev.includes(current.task.id) ? prev : [...prev, current.task.id]))}
          onRevealed={() => setSolutionShown(true)}
          onContinue={() => {
            if (codingIndex < codingTasks.length - 1) setCodingIndex((i) => i + 1);
            else void complete();
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <AxButton isIconOnly icon={<CloseIcon size={18} />} variant="ghost" size="md" label={t('roadmap.exit')} onClick={onExit} />
          <span style={{ fontWeight: 700, backgroundColor: `${accent}22`, color: 'var(--color-text-primary)', borderRadius: 999, padding: '2px 10px', fontSize: '0.8125rem', display: 'inline-block' }}>
            {`${t('roadmap.levelLabel', { n: playable.ref })} · ${playable.title}`}
          </span>
          <Kicker style={{ marginLeft: 'auto' }}>{t('coding.lesson.kicker')} · {t('coding.lesson.counter', { n: codingIndex + 1, total: codingTasks.length })}</Kicker>
        </div>
        <div className="cd-actions">
          <a className="cd-link" target="_blank" rel="noopener noreferrer" href={`/coding/${current.task.track}/${current.task.id}#learn=${encodeURIComponent(current.session)}`}>{t('coding.lesson.openTab')}</a>
          {user && <AxButton variant="secondary" label={t('coding.lesson.checkCompletion')} onClick={() => void checkCoding()} isDisabled={completing} />}
        </div>
        {answerError && <div role="alert" className="cd-note cd-note--error">{answerError}</div>}
        {/* The solution the learner asked for stays on screen: the attempt
            ends when they finish the level, not the moment it opens. */}
        {solutionShown && (
          <div className="cd-note" role="status">
            <p style={{ margin: '0 0 12px' }}>{t('coding.lesson.solutionShown')}</p>
            <SwimCta label={t('coding.lesson.finishLevel')} onClick={() => void complete()} disabled={completing} />
          </div>
        )}
        <span className="cd-visually-hidden" aria-live="polite">{t('coding.lesson.pending', { n: codingTasks.length - codingPassed.length })}: {title}</span>
      </div>
    );
  }

  if (finished && invalidated) {
    return (
      <LessonResult
        heading={t('roadmap.invalidatedTitle')}
        headingRef={resultHeadingRef}
        primary={{ label: t('roadmap.retryLevel'), onClick: onReplay }}
        secondary={<AxButton variant="ghost" label={t('roadmap.backToPath')} onClick={onExit} />}
      >
        <p role="status" className="rm-result__line">{t('roadmap.invalidatedBody')}</p>
      </LessonResult>
    );
  }

  if (finished) {
    const pct = Math.round((correctCount / total) * 100);
    const passed = !dead && pct >= playable.passPct && codingPending.length === 0;
    const title = dead
      ? t('roadmap.outOfHeartsTitle')
      : passed
        ? isCheckpoint ? t('roadmap.checkpointComplete') : t('roadmap.levelComplete')
        : isCheckpoint ? t('roadmap.checkpointFailed') : t('roadmap.levelFailed');
    // One primary (UX audit learn-04): the next level after a pass, Retry
    // after a miss, and back to the path when a pass has nothing after it.
    const retry = { label: t('roadmap.retryLevel'), onClick: onReplay };
    const back = { label: t('roadmap.backToPath'), onClick: onExit };
    const primary = passed ? (hasNext ? { label: nextLabel, onClick: onNext } : back) : retry;
    return (
      <LessonResult
        heading={title}
        headingRef={resultHeadingRef}
        primary={primary}
        secondary={
          <>
            {passed && <AxButton variant="secondary" label={retry.label} onClick={retry.onClick} />}
            {primary !== back && <AxButton variant="ghost" label={back.label} onClick={back.onClick} />}
          </>
        }
        celebrate={passed ? (
          <>
            {/* Confetti IS the celebration on a pass; the icon stays quiet. */}
            <Confetti color={accent} />
            <div className="rm-celebrate rm-result__icon" aria-hidden>
              <IconTile color={accent} size={56}>
                {isCheckpoint ? <TrophyIcon size={26} /> : <CheckIcon size={26} />}
              </IconTile>
            </div>
          </>
        ) : null}
        after={
          <>
            {/* The learner's first passed level is the moment to offer the
                invite link (#239): a friend who joins gets the same first win. */}
            {passed && firstPassMoment && <ReferralMoment signedIn={!!user} source="learn_level" />}
            {passed && topicCompleted && <ResultShareActions centered kind="learn_topic_result"
              label={t(categoryLabelKey(playable.topic))} headline={t('roadmap.topicCompleted')}
              detail={t('roadmap.topicShareDetail')} text={t('roadmap.topicShareText', { topic: t(categoryLabelKey(playable.topic)) })}
              path={`/learn?topic=${playable.topic}`} />}
          </>
        }
      >
        {dead ? (
          <p className="rm-result__line">{t('roadmap.outOfHeartsBody', { max: MAX_HEARTS })}</p>
        ) : (
          <>
            {/* In text colours: the track colour (JavaScript's #f7df1e,
                the checkpoint gold) is under 3:1 on the panel. It stays on
                the confetti and the icon tile. */}
            <div className="rm-count rm-result__score" data-passed={passed || undefined}>
              {pct}%
            </div>
            <p className="rm-result__line">{t('roadmap.scoreLine', { correct: correctCount, total })}</p>
            {codingTasks.length > 0 && !codingUnverified && (
              <p className="rm-result__line" data-tone={codingPending.length === 0 ? 'success' : 'warning'}>
                {codingPending.length === 0 ? t('coding.lesson.allPassed') : t('coding.lesson.pending', { n: codingPending.length })}
              </p>
            )}
            {/* Signed out, a coding task's pass is never stored, so the level
                passed on its questions and is kept on this device only. */}
            {codingTasks.length > 0 && codingUnverified && (
              <p className="rm-result__line">{t('coding.lesson.guestUnverified')}</p>
            )}
            {!passed && pct < playable.passPct && (
              <p className="rm-result__line">{t('roadmap.passNeeded', { pct: playable.passPct })}</p>
            )}
          </>
        )}
      </LessonResult>
    );
  }

  const isRight = grade?.isCorrect === true;
  // After grading (or a failed send) the one primary is Continue, Finish, See
  // the result or Try again. A key per state remounts the row, so focus moves
  // to the new action each time.
  const feedbackAction = answerError
    ? {
      label: t('roadmap.retry'),
      onClick: () => { if (revealed) void advance(); else if (selected !== null) void choose(selected); },
      disabled: grading || completing || (!revealed && selected === null),
    }
    : grade
      ? {
        label: outOfHearts ? t('roadmap.seeResult') : qIndex < total - 1 ? t('roadmap.continue') : t('roadmap.finish'),
        onClick: () => void advance(),
        disabled: completing,
      }
      : null;

  return (
    <>
      <QuestionShell
        compact
        contentKey={qIndex}
        ref={questionRef}
        questionId="lesson-question"
        header={levelHeader()}
        question={
          <>
            {renderQuestion(question.question)}
            {/* One control for the whole item: the question, every option and
                the explanation. Beside the block rather than inside an option,
                so it can never select an answer, and the same list for every
                option, so it can never single one out. */}
            <TermsBar
              texts={[question.question, ...question.options, grade?.explanation]}
              domain={glossaryDomainFor(playable.topic)}
            />
          </>
        }
        actions={
          <QuestionActions
            key={feedbackAction ? (answerError ? 'retry' : 'next') : 'answer'}
            counter={counter}
            primary={feedbackAction ?? undefined}
            focusPrimary={feedbackAction != null}
            secondary={
              <>
                {revealed && grade && !isRight && (
                  <SaveSharkCard question={question} correctIndex={grade.correctAnswer} explanation={grade.explanation ?? ''} />
                )}
                <QuestionIconButton label={t('flag.ariaLabel')} icon={<ReportFlagIcon />} onClick={() => setFlagOpen(true)} />
              </>
            }
          />
        }
      >
        {/* The shared answer list (UX audit questions-04): 48px rows, the
            brand accent for the selection, and the graded marks in words. A
            press grades at once, so onActivate answers; arrow keys only browse. */}
        <AnswerOptionList
          options={question.options}
          value={selected}
          onChange={setSelected}
          onActivate={(index) => void choose(index)}
          labelledBy="lesson-question"
          disabled={revealed || grading}
          grade={revealed && grade ? { correct: grade.correctAnswer, picked: selected } : null}
        />

        {/* Feedback replaces the keyboard hint below the answers. */}
        <QuestionHint max={question.options.length} verb="answer" hidden={revealed || !!answerError} />

        {/* The verdict, under the answers it explains. The Banner is a status
            (or an alert for a failed send), so it is read out; focus goes to
            Continue in the action row. */}
        {answerError ? (
          <QuestionFeedback status="error" title={answerError} autoFocus={false} />
        ) : revealed && grade ? (
          <QuestionFeedback
            status={isRight ? 'success' : 'error'}
            title={isRight ? t('roadmap.correct') : t('roadmap.incorrect')}
            description={grade.explanation}
            autoFocus={false}
          />
        ) : null}
      </QuestionShell>

      <RedFlagDialog open={flagOpen} onClose={() => setFlagOpen(false)} onSubmit={submitFlag} />
      <AppToast
        open={flagSnack}
        onClose={() => setFlagSnack(false)}
        message={t('flag.sent')}
        autoHideDuration={3000}
      />
    </>
  );
}

/* ──── result screens ──────────────────────────────────────────────────── */

/** A level's end (passed, failed, out of hearts) and the screens that start it
 * again (timed out, sign-in changed, a retired question): the question
 * screen's 640px column and panel (UX audit learn-03), the outcome as the h1,
 * and one action row with the one SwimCta md (learn-04). */
function LessonResult({ heading, headingRef, primary, secondary, celebrate, after, children }: {
  heading: string;
  headingRef: Ref<HTMLHeadingElement>;
  primary: QuestionPrimaryAction;
  secondary?: ReactNode;
  /** Drawn over and above the heading on a pass. */
  celebrate?: ReactNode;
  /** Under the action row: the invite and share offers. */
  after?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <QuestionShell
      questionId="lesson-result"
      focusable={false}
      stable={false}
      className="rm-result"
      question={
        <div className="rm-result__body">
          {celebrate}
          <h1 ref={headingRef} tabIndex={-1} className="rm-finish-title">{heading}</h1>
          {children}
        </div>
      }
      actions={
        <>
          <QuestionActions primary={primary} secondary={secondary} />
          {after}
        </>
      }
    />
  );
}

/* ──── confetti burst ───────────────────────────────────────────────────── */

function Confetti({ color }: { color: string }) {
  const colors = [color, '#f5b301', '#2e7d32', '#3178c6', '#ec4899'];
  return (
    <div className="rm-confetti" aria-hidden>
      {Array.from({ length: 16 }).map((_, i) => (
        <i
          key={i}
          style={{
            left: `${(i / 16) * 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 5) * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}
