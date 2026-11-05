// The coding workbench: read the task, edit, run, submit, climb the hint
// ladder. Used by the Coding section (`mode="section"`) and inside a Learn
// level (`mode="lesson"`). It never fetches on its own: the parent hands it a
// playable task, its sealed session and the saved draft.
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { SwimCta, FinButton } from '../components/landing/LandingKit';
import { Button } from '@astryxdesign/core/Button';
import { DropdownMenu, DropdownMenuItem } from '@astryxdesign/core/DropdownMenu';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { workbenchCopy } from '../i18n/translations.workbench';
import { openSignIn } from '../lib/signInDialog';
import { readJSON, writeJSON } from '../lib/storage';
import { ApiError, friendlyError, isPremiumRequired } from '../lib/api';
import type { EditorProps } from './Editor';
import { loadEditor, loadedEditor, NARROW_EDITOR_KEY, readNarrowEditor } from './loadEditor';
import { lazyShellPart } from '../lib/routeRecovery';
import { ShellPartBoundary } from '../components/ShellPartBoundary';
import ErrorRetry from '../components/ErrorRetry';
import { CodingCompletion, ComplexityInfo } from './CodingCompletion';
import { formatCode } from './runner/format';
import { compilerStarted, holdCompiler, runCodeTests, runPassed, warmRunner, type RunOutcome, type RunPhase } from './runner/run-tests';
import { runtimePolicyForTask } from '../../../shared/coding-task-runtime';
import { TYPE_CHECK_STOPPED_MESSAGE } from '../../../shared/coding-evaluate';
import { HARNESS_URL, useReactHarness, type HarnessRun } from './useReactHarness';
import { attemptStarted, canGiveUp, giveUpAfter, ladderRungs, MIN_ATTEMPT_MS, type LadderRung } from './hint-ladder';
import { taskResources } from '../../../shared/coding-docs';
import { evolvingStage } from '../../../shared/evolving';
import { skipTask } from './practice';
import { TermsBar } from '../components/ui/Terms';
import { ReportDialog } from '../components/ReportDialog';
import { FlagIcon, FormatCodeIcon, ResetIcon, HintIcon, EyeIcon, SkipIcon } from '../components/ui/icons';
import { reportQuestion } from '../lib/supabase';
import { glossaryDomainFor } from '../lib/glossaryDomain';
import { CodePuzzle } from './CodePuzzle';
import { useIsNarrowForEditor } from '../lib/useMediaQuery';
import { CODING_CODE_LIMIT_BYTES, SKIP_REASONS, type SkipReason } from '../../../shared/coding-api';
import { classifyFailure, failureHint, isSyntaxError } from '../../../shared/coding-failure';
import { resetCoding, revealCoding, submitCoding, useCodingApproaches } from './api';
import { RepeatXpNote } from './RepeatXpNote';
import { CODING_TIERS, difficultyOf, formatOf, hasLearnLevel, type PlayableCodingTask } from '../../../shared/coding-catalog';
import { DifficultyBadge } from './DifficultyBadge';
import { BriefZone } from './BriefZone';
import { descriptionText } from './description';
import type { CodingLockReason, CodingSolutionPair, CodingTaskProgress, CodingVerdictResponse } from '../../../shared/coding-api';
import { complexityGuidance } from '../../../shared/coding-complexity';
import './Coding.css';

/** Moves focus to a confirmation's safe choice when it appears. Module-level,
 * so its identity is stable and it runs once per mount. */
const focusOnMount = (node: HTMLButtonElement | null) => { node?.focus(); };

/** A React suite that moves focus inside the preview frame takes the page's
 * focus with it. Call before a run; the function it returns gives focus back
 * to whatever held it, unless that was the frame. */
const keepFocus = () => {
  const before = document.activeElement;
  return () => {
    const now = document.activeElement;
    if (now instanceof HTMLIFrameElement && now !== before && before instanceof HTMLElement && before.isConnected) before.focus();
  };
};

/** A reference solution written on one long line reads as a run-on sentence,
 * so it is laid out for reading. Solutions already on several lines are shown
 * as their author wrote them. */
const displaySolution = (source: string, track: PlayableCodingTask['track']): Promise<string> => (
  source.trim().includes('\n') || source.length <= 80
    ? Promise.resolve(source)
    : formatCode(source, track).then((formatted) => formatted.trimEnd(), () => source)
);

export interface CodingWorkbenchProps {
  task: PlayableCodingTask;
  session: string | null;
  locked: CodingLockReason | null;
  signedIn: boolean;
  /** The learner's recorded progress on this task, when the parent has it. A
   * recorded pass opens the Solution tab on a return visit. */
  progress?: CodingTaskProgress | null;
  initialCode: string | null;
  mode: 'section' | 'lesson' | 'landing';
  /** The parent's save-for-later control, rendered beside the report flag. */
  saveAction?: ReactNode;
  /** Called with the current code when the learner presses Run or Submit —
   * the two moments they have said the code is worth keeping for the
   * account. 'tooLarge': the code was kept on this device only, too large
   * for the account. */
  onDraft?: (code: string) => 'tooLarge' | null | void;
  /** Called with the code after every edit (typing, Reset, Format). The
   * parent keeps a device copy once the learner pauses (coding/drafts.ts). */
  onEdit?: (code: string) => void;
  onVerdict?: (verdict: CodingVerdictResponse, submittedCode?: string) => void;
  onRevealed?: () => void;
  onRefreshTask?: (code: string) => Promise<void>;
  nextHref?: string | null;
  backHref?: string;
  onContinue?: () => void;
}

type Tab = 'description' | 'results' | 'types' | 'console' | 'preview' | 'resources' | 'solution' | 'approaches';
type Phase = 'idle' | 'running' | 'submitting';

// Layout is a preference of the person, not of the task, and it is not their
// work: it lives on the device beside the drafts but under its own key, so
// clearing one never touches the other.
const LAYOUT_KEY = 'devshark:coding:layout:v1';
const SPLIT_MIN = 35;
const SPLIT_MAX = 75;
const SPLIT_DEFAULT = 58;
const SPLIT_STEP = 5;
const FEEDBACK_MIN = 160;
const FEEDBACK_MAX = 400;
const FEEDBACK_DEFAULT = 220;
interface WorkbenchLayout { split: number; feedbackHeight: number }
const readLayout = (): WorkbenchLayout => {
  const stored = readJSON<Partial<WorkbenchLayout>>(LAYOUT_KEY, {});
  const split = typeof stored.split === 'number' && Number.isFinite(stored.split)
    ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(stored.split)))
    : SPLIT_DEFAULT;
  const feedbackHeight = typeof stored.feedbackHeight === 'number' && Number.isFinite(stored.feedbackHeight)
    ? Math.min(FEEDBACK_MAX, Math.max(FEEDBACK_MIN, Math.round(stored.feedbackHeight)))
    : FEEDBACK_DEFAULT;
  return { split, feedbackHeight };
};

// A narrow screen waits for a bigger one by default, but the learner may take
// the editor here instead (docs/interactive-content-manifest.md). The choice is
// theirs for the rest of the browser session, on every task, and nothing else
// reads it: the server grades the same code from any screen. The key and its
// reader live in loadEditor.ts, which also decides whether to fetch the editor.

/** CodeMirror loads as its own chunk (loadEditor.ts). The task screen and an
 * intent preload fetch it beside the workbench, so it is usually in before
 * the first render and draws at once; otherwise its box holds the editor's
 * place, and a load that failed offers Try again in that box alone. */
const LazyEditor = lazyShellPart(() => loadEditor().then((Editor) => ({ default: Editor })));
const EDITOR_MIN = 'var(--cd-editor-min, 280px)';
function EditorPart(props: EditorProps & { loadingLabel: string; failedLabel: string }) {
  const { loadingLabel, failedLabel, ...editor } = props;
  // Decided once per mount, so the editor never swaps one tree for the other.
  const [Loaded] = useState(loadedEditor);
  if (Loaded) return <Loaded {...editor} />;
  const box = (
    <div className={editor.fill ? 'cd-editor cd-editor--fill' : 'cd-editor'} style={{ minHeight: editor.minHeight ?? EDITOR_MIN, maxHeight: editor.maxHeight }}>
      <span className="cd-visually-hidden" role="status">{loadingLabel}</span>
    </div>
  );
  return (
    <Suspense fallback={box}>
      <ShellPartBoundary fallback={(retry, busy) => <ErrorRetry message={failedLabel} onRetry={retry} busy={busy} />}>
        <LazyEditor {...editor} />
      </ShellPartBoundary>
    </Suspense>
  );
}

/** The names a React suite gives its cases, in order, so Results can list them
 * before the first run. The suite is read, never executed, here. */
const suiteCaseNames = (suite: string | undefined): string[] =>
  Array.from((suite ?? '').matchAll(/\btest\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g), (match) => match[2]);

function Prompt({ text, className }: { text: string; className?: string }) {
  const parts = text.split('`');
  return (
    <p className={className}>
      {parts.map((part, index) => (index % 2 === 1 ? <code key={index}>{part}</code> : <span key={index}>{part}</span>))}
    </p>
  );
}

function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export function CodingWorkbench(props: CodingWorkbenchProps) {
  const { task, session, locked, signedIn, progress, initialCode, mode, onDraft, onEdit, onVerdict, onRevealed, nextHref, backHref, onContinue, saveAction, onRefreshTask } = props;
  const evolution = evolvingStage(task.id);
  const complexity = complexityGuidance(task);
  const { t } = useLanguage();
  const [reportOpen, setReportOpen] = useState(false);
  const online = useOnline();
  const baseId = useId();
  const isReact = task.track === 'react';
  const isTypeScript = task.track === 'typescript';
  const codeTrack = task.track === 'typescript' ? 'typescript' : 'javascript';
  const checklist = task.verify === 'checklist';

  const [code, setCode] = useState<string>(initialCode ?? task.starter);
  const shownCode = useRef(code);
  shownCode.current = code;
  // The last code Format produced, or the starter as authored: Format has
  // something to do once the code differs from it. Prettier (about 170 KB
  // gzip) loads on the first press only, never to decide this (perf baseline
  // #587 C02, C24).
  const [formattedCode, setFormattedCode] = useState<string>(task.starter);
  const [phase, setPhase] = useState<Phase>('idle');
  const [runPhase, setRunPhase] = useState<RunPhase | null>(null);
  const [run, setRun] = useState<RunOutcome | null>(null);
  const [serverChecked, setServerChecked] = useState(false);
  const [stale, setStale] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [failedRun, setFailedRun] = useState(false);
  const [verdict, setVerdict] = useState<CodingVerdictResponse | null>(null);
  // The code changed after the verdict: it still says what the server saw,
  // but no longer about the code on screen.
  const [verdictStale, setVerdictStale] = useState(false);
  // A pass recorded during this visit outlives the card that announced it: a
  // later Submit clears the card, not the pass.
  const [recordedPass, setRecordedPass] = useState(false);
  const [taskChanged, setTaskChanged] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // The last Run or Submit kept the code on this device only.
  const [draftTooLarge, setDraftTooLarge] = useState(false);
  // Coding keeps the brief open beside feedback. Embedded Learn/landing
  // workbenches retain their single strip and existing layout.
  const sectionLayout = mode === 'section';
  const [tab, setTab] = useState<Tab>(sectionLayout ? 'results' : 'description');
  const [referenceTab, setReferenceTab] = useState<Tab>('description');
  const [feedbackCollapsed, setFeedbackCollapsed] = useState(false);
  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    setFeedbackCollapsed(false);
  }, []);
  const previewShown = useRef(false);
  const [hintsTaken, setHintsTaken] = useState(0);
  const [confirming, setConfirming] = useState<'reset' | 'reveal' | null>(null);
  const [solution, setSolution] = useState<string | null>(null);
  const [checked, setChecked] = useState<boolean[]>(() => (task.checklist ?? []).map(() => false));
  const [formatError, setFormatError] = useState<string | null>(null);
  const [layout, setLayout] = useState<WorkbenchLayout>(readLayout);
  const [skipping, setSkipping] = useState(false);
  const [skipSubmitting, setSkipSubmitting] = useState(false);
  const [skipReason, setSkipReason] = useState<SkipReason>('later');
  const [skipNote, setSkipNote] = useState('');
  const [skipResult, setSkipResult] = useState<{ required: boolean; next: string | null } | null>(null);
  const [skipError, setSkipError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const verdictRef = useRef<HTMLElement | null>(null);
  const resetRef = useRef<HTMLButtonElement | null>(null);
  const revealRef = useRef<HTMLButtonElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const solutionRef = useRef<HTMLDivElement | null>(null);
  // The browser's run in progress: a Run, or the preview during a Submit,
  // which the server's answer replaces.
  const localRun = useRef<AbortController | null>(null);
  const harness = useReactHarness();
  // The sandbox frame (about 216 KB gzip, and a long task as it boots) loads
  // on the first Run or Submit, when the Preview tab opens, or when a pointer
  // or the focus reaches the Run and Submit row: not while the brief is read
  // (perf baseline #587 C13). Once loaded it stays for the visit.
  const [frameWanted, setFrameWanted] = useState(false);
  const wantFrame = useCallback(() => { if (isReact) setFrameWanted(true); }, [isReact]);
  // TypeScript's compiler (about 1 MB gzip) loads once the learner reaches
  // for the code: a pointer or the focus in the editor or on the Run and
  // Submit row, an edit, the first Run or Submit, or the choice of the editor
  // on a narrow screen. It stays loaded in its own worker while the task is
  // open (holdCompiler in runner/run-tests.ts, perf baseline #587 C01).
  const [compilerWanted, setCompilerWanted] = useState(false);
  const wantCompiler = useCallback(() => { if (isTypeScript) setCompilerWanted(true); }, [isTypeScript]);
  const reachForRun = useCallback(() => { wantFrame(); wantCompiler(); }, [wantFrame, wantCompiler]);
  // What a narrow screen gets instead of an editor: the task's puzzle when it
  // has one, and an honest pending state when it does not. Neither is a pass.
  // Both offer the editor anyway, so neither is a dead end: a puzzle never
  // completes its task, and without the editor a phone could not pass it.
  const narrow = useIsNarrowForEditor();
  // Below the two-column layout Hint, Solution, Skip and Report share one
  // More actions menu, so Run and Submit keep their words (UX audit coding-13).
  const menuCommands = mode === 'landing' || narrow;
  const [editorHere, setEditorHere] = useState(readNarrowEditor);
  const editorPaneRef = useRef<HTMLElement | null>(null);
  const focusEditorPane = useRef(false);
  const puzzleMode = narrow && Boolean(task.puzzle) && mode === 'section' && !editorHere;
  const pendingOnDesktop = mode !== 'landing' && narrow && !task.puzzle && !editorHere;
  const chooseEditorHere = useCallback(() => {
    try { sessionStorage.setItem(NARROW_EDITOR_KEY, '1'); } catch { /* the choice then lasts for this page only */ }
    focusEditorPane.current = true;
    setEditorHere(true);
    wantCompiler();
  }, [wantCompiler]);
  // The button that made the choice is gone, so focus goes to the pane that
  // replaced it rather than back to the top of the page.
  useEffect(() => {
    if (pendingOnDesktop || puzzleMode || !focusEditorPane.current) return;
    focusEditorPane.current = false;
    editorPaneRef.current?.focus();
  }, [pendingOnDesktop, puzzleMode]);

  const rungs = useMemo(() => ladderRungs(task), [task]);
  const taken = Math.min(hintsTaken, rungs.length);

  useEffect(() => { writeJSON(LAYOUT_KEY, layout); }, [layout]);
  // The runner's script loads while the brief is read: the first Run does not
  // wait for it, and Run still works if the connection drops afterwards.
  // TypeScript's compiler waits for the learner to reach for the code
  // (compilerWanted above). Neither loads while a puzzle or the wait for a
  // bigger screen stands in for the editor: a phone would download and start
  // a runner it has no Run for. Choosing the editor starts them.
  const editorShown = !puzzleMode && !pendingOnDesktop;
  // The editor mounts the first time it shows and then stays, hidden while a
  // puzzle or the pending note stands in for it after a resize, so its undo
  // history and selection survive (the code itself lives here). A phone that
  // never shows it never downloads it (perf baseline #587 C12).
  const [editorMounted, setEditorMounted] = useState(editorShown);
  if (editorShown && !editorMounted) setEditorMounted(true);
  useEffect(() => (isReact || !editorShown ? undefined : warmRunner(codeTrack)), [isReact, editorShown, codeTrack]);
  // A compiler another TypeScript task loaded is held at once: it costs no
  // download, and the next Run finds it ready.
  useEffect(() => (isTypeScript && editorShown && (compilerWanted || compilerStarted()) ? holdCompiler() : undefined), [isTypeScript, editorShown, compilerWanted]);
  // A Run, or a Submit's browser preview, has nowhere to report once the task
  // is left.
  useEffect(() => () => localRun.current?.abort(), []);
  useEffect(() => { if (verdict) verdictRef.current?.focus(); }, [verdict]);

  const setSplit = useCallback((next: number) => {
    setLayout((current) => ({ ...current, split: Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, Math.round(next))) }));
  }, []);

  // The separator is a real one: it takes focus, arrows move it in steps, Home
  // and End go to the limits, and Enter restores the default. Dragging is an
  // addition to that, never the only way.
  const onSeparatorKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowLeft' ? -SPLIT_STEP : event.key === 'ArrowRight' ? SPLIT_STEP : 0;
    if (step !== 0) { event.preventDefault(); setSplit(layout.split + step); return; }
    if (event.key === 'Home') { event.preventDefault(); setSplit(SPLIT_MIN); return; }
    if (event.key === 'End') { event.preventDefault(); setSplit(SPLIT_MAX); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSplit(SPLIT_DEFAULT); }
  }, [layout.split, setSplit]);

  const onSeparatorPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const box = grid.getBoundingClientRect();
      if (box.width <= 0) return;
      setSplit(((moveEvent.clientX - box.left) / box.width) * 100);
    };
    // A drag the browser takes over (a touch that turns into a scroll, a
    // lost capture) ends with pointercancel and no pointerup: without it the
    // split kept following the pointer after the drag was over.
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, [setSplit]);

  const onCodeChange = useCallback((next: string) => {
    wantCompiler();
    setCode(next);
    onEdit?.(next);
    if (run || harness.run) setStale(true);
    if (verdict) setVerdictStale(true);
    setServerChecked(false);
  }, [run, harness.run, verdict, onEdit, wantCompiler]);

  const files = useCallback(() => ({ '/App.js': code, '/App.test.js': task.suite ?? '' }), [code, task.suite]);

  const runLocal = useCallback(async () => {
    if (phase !== 'idle') return;
    setDraftTooLarge(onDraft?.(code) === 'tooLarge');
    localRun.current?.abort();
    setPhase('running');
    wantCompiler();
    setServerChecked(false);
    setFormatError(null);
    try {
      if (isReact) {
        setFrameWanted(true);
        const restoreFocus = keepFocus();
        const outcome = await harness.start(files(), { tests: Boolean(task.suite), preview: true });
        restoreFocus();
        if (outcome.status !== 'done' || outcome.failed > 0) setFailedRun(true);
        const rendered = outcome.status === 'done' && !outcome.previewError;
        const firstRender = rendered && !previewShown.current;
        if (rendered) previewShown.current = true;
        selectTab(firstRender || !task.suite ? 'preview' : 'results');
      } else {
        // Leaving the task stops the run (the unmount below aborts it), so a
        // loop or a first compile does not keep a worker busy for nothing.
        const controller = new AbortController();
        localRun.current = controller;
        setRunPhase('starting');
        const outcome = await runCodeTests({
          runtimePolicy: runtimePolicyForTask(task.id), track: codeTrack, code, tests: task.tests ?? [], typeTests: task.typeTests, grade: true, onPhase: setRunPhase, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setRun(outcome);
        setServerChecked(false);
        // A runner that never loaded is not an attempt, so it opens no hint.
        if (!outcome.runnerUnavailable && !runPassed(outcome)) setFailedRun(true);
        const typesBroken = outcome.check && (outcome.check.codeErrors.length > 0 || outcome.check.typeTests.some((one) => !one.pass));
        selectTab(outcome.codeError ? 'results' : typesBroken ? 'types' : 'results');
      }
      setStale(false);
      setRunCount((n) => n + 1);
    } finally {
      setRunPhase(null);
      setPhase('idle');
    }
  }, [phase, isReact, harness, files, task.suite, task.tests, task.typeTests, codeTrack, code, onDraft, selectTab]);

  /** What a failed request says: the server's reason in the learner's words.
   * Only a request that never arrived is a connection problem. */
  const submitFailure = useCallback((error: unknown): string => (
    error instanceof ApiError && error.code === 'too_large' ? t('coding.verdict.tooLarge') : friendlyError(error)
  ), [t]);

  const submit = useCallback(async () => {
    if (phase !== 'idle' || !session) return;
    setDraftTooLarge(onDraft?.(code) === 'tooLarge');
    // The server takes 20 kB of code; say so before sending more.
    if (new TextEncoder().encode(code).length > CODING_CODE_LIMIT_BYTES) {
      setSubmitError(t('coding.verdict.tooLarge'));
      return;
    }
    setPhase('submitting');
    wantCompiler();
    setSubmitError(null);
    setFormatError(null);
    // A new Submit replaces the last verdict. Left standing, the old one sat
    // beside a rate-limit or network error as if it were this Submit's answer.
    setVerdict(null);
    setVerdictStale(false);
    const durationMs = Date.now() - startedAt.current;
    try {
      let result: CodingVerdictResponse;
      if (isReact) {
        if (checklist) {
          if (!checked.every(Boolean)) {
            setSubmitError(t('coding.checklist.note'));
            return;
          }
          result = await submitCoding({ session, code, runCount, hintsUsed: taken, durationMs });
        } else {
          // The frame runs the suite so the learner sees named cases and a
          // fresh preview straight away; the verdict itself comes from the
          // server, which runs the same suite where it cannot be edited.
          setFrameWanted(true);
          const restoreFocus = keepFocus();
          const outcome = await harness.start(files(), { tests: true, preview: true });
          restoreFocus();
          if (!(outcome.status === 'done' && outcome.total > 0 && outcome.failed === 0)) setFailedRun(true);
          setStale(false);
          setRunCount((n) => n + 1);
          selectTab('results');
          result = await submitCoding({ session, code, runCount: runCount + 1, hintsUsed: taken, durationMs });
          setServerChecked(true);
        }
      } else {
        // The code goes to the server at once. The browser's own run is only a
        // preview while the server grades: a first compile, or a type that
        // keeps the checker busy, held Submit back for up to 45 s. Whichever
        // comes first, the server's run replaces it.
        const preview = new AbortController();
        localRun.current = preview;
        void runCodeTests({ runtimePolicy: runtimePolicyForTask(task.id), track: codeTrack, code, tests: task.tests ?? [], typeTests: task.typeTests, grade: true, signal: preview.signal }).then((local) => {
          if (preview.signal.aborted) return;
          setRun(local);
          setServerChecked(false);
          setStale(false);
          if (!local.runnerUnavailable && !runPassed(local)) setFailedRun(true);
        });
        setRunCount((n) => n + 1);
        result = await submitCoding({ session, code, runCount: runCount + 1, hintsUsed: taken, durationMs });
        preview.abort();
        // The server's run is the verdict of record; show what it saw.
        setRun({ results: result.results, logs: result.logs, codeError: result.codeError, check: result.check, timedOut: result.verdict === 'timeout' });
        // About the code just sent, even when the browser's preview, which
        // would have said so, was overtaken.
        setStale(false);
        setServerChecked(true);
        const typesBroken = result.check && (result.check.codeErrors.length > 0 || result.check.typeTests.some((one) => !one.pass));
        selectTab(result.codeError ? 'results' : typesBroken ? 'types' : 'results');
      }
      // The grader itself could not run. Nothing was recorded and nothing
      // was said about the code, so it reads as a problem to retry, not as a
      // build error or a failed attempt.
      if (result.graderUnavailable) {
        setServerChecked(false);
        setSubmitError(t('coding.verdict.graderUnavailable'));
        return;
      }
      if (result.verdict !== 'passed') setFailedRun(true);
      if (result.progress?.status === 'passed') setRecordedPass(true);
      setVerdict(result);
      onVerdict?.(result, code);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'task_changed') {
        localRun.current?.abort();
        setRun(null);
        setServerChecked(false);
        setTaskChanged(true);
        setSubmitError(t('coding.verdict.taskChanged'));
      }
      else if (error instanceof ApiError && error.code === 'invalid_session') setSubmitError(t('coding.verdict.sessionExpired'));
      // The upgrade sheet is already open; the line beside the button says why.
      else if (isPremiumRequired(error)) setSubmitError(t('error.premiumRequired'));
      else setSubmitError(submitFailure(error));
    } finally {
      setRunPhase(null);
      setPhase('idle');
    }
  }, [phase, session, isReact, checklist, checked, code, runCount, taken, harness, files, codeTrack, task.tests, task.typeTests, onVerdict, onDraft, t, submitFailure, selectTab]);

  const format = useCallback(async () => {
    try {
      const formatted = await formatCode(code, task.track);
      setCode(current => current === code ? formatted : current);
      // Kept as typed code is, unless the learner typed on meanwhile.
      if (shownCode.current === code) onEdit?.(formatted);
      setFormattedCode(formatted);
      setFormatError(null);
    } catch (error) {
      // Code Prettier cannot read: the note says why, and Format waits for
      // the next edit instead of saying the same again.
      setFormattedCode(code);
      setFormatError(String((error as Error)?.message ?? error).split('\n')[0]);
    }
  }, [code, task.track, onEdit]);

  /** Send an arrangement. It goes through the same submit route as code, and
   * the server grades it the same from any device — the viewport decided what
   * to show, and nothing else. */
  const submitOrder = useCallback(async (order: string[]) => {
    if (!session || phase !== 'idle') return;
    setPhase('submitting');
    setSubmitError(null);
    setVerdict(null);
    setVerdictStale(false);
    try {
      const result = await submitCoding({
        session, order, runCount, hintsUsed: taken, durationMs: Date.now() - startedAt.current,
      });
      setVerdict(result);
      onVerdict?.(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'task_changed') setTaskChanged(true);
      setSubmitError(isPremiumRequired(error) ? t('error.premiumRequired') : submitFailure(error));
    } finally {
      setPhase('idle');
    }
  }, [session, phase, runCount, taken, onVerdict, t, submitFailure]);

  const reset = useCallback(() => {
    setCode(task.starter);
    onEdit?.(task.starter);
    setFormattedCode(task.starter);
    setRun(null);
    setStale(false);
    setVerdictStale(true);
    setHintsTaken(0);
    setConfirming(null);
    // Signed in, the reset opens the task's XP again (migration 058). A reset
    // the server missed only means the next pass pays nothing, which its
    // verdict says.
    if (signedIn && session) void resetCoding({ session }).catch(() => {});
    // Reset is off now (there is nothing left to reset), so focus goes to the
    // code that was just replaced rather than to the page.
    editorPaneRef.current?.querySelector<HTMLElement>('.cm-content')?.focus();
  }, [task.starter, onEdit, signedIn, session]);

  const confirmSkip = useCallback(async () => {
    if (skipSubmitting) return;
    setSkipSubmitting(true);
    setSkipError(null);
    try {
      const answer = await skipTask({ taskId: task.id, reason: skipReason, note: skipNote.trim() || undefined });
      setSkipResult({ required: answer.required, next: answer.next });
      setSkipping(false);
    } catch {
      setSkipError(t('coding.skip.failed'));
    } finally {
      setSkipSubmitting(false);
    }
  }, [skipNote, skipReason, skipSubmitting, task.id, t]);

  // One reveal at a time: after a pass the Solution button asks straight
  // away and stays on screen until the answer comes, so a second press sent
  // a second request.
  const revealing = useRef(false);
  const reveal = useCallback(async () => {
    if (!session || revealing.current) return;
    revealing.current = true;
    setConfirming(null);
    setSubmitError(null);
    try {
      const response = await revealCoding({ session, hintsUsed: taken });
      setSolution(await displaySolution(response.solution, task.track));
      onRevealed?.();
    } catch (error) {
      setSubmitError(error instanceof ApiError && error.code === 'reveal_locked'
        ? t('coding.giveUpLocked', { n: giveUpAfter(rungs.length) })
        : isPremiumRequired(error) ? t('error.premiumRequired') : submitFailure(error));
      (revealRef.current ?? moreRef.current)?.focus();
    } finally {
      revealing.current = false;
    }
  }, [session, taken, onRevealed, rungs.length, t, submitFailure, task.track]);
  // The button that asked for the solution is gone once it shows, so focus
  // goes to the solution itself.
  useEffect(() => { if (solution) solutionRef.current?.focus(); }, [solution]);

  const attemptReady = attemptStarted({ code, starter: task.starter, elapsedMs: Date.now() - startedAt.current, failedRun });
  // The minute is counted at render time, so a learner who edits and then
  // stops typing needs a render when it is up; without one the Hint button
  // waited for the next keystroke.
  const edited = code.trim() !== task.starter.trim();
  const [, setAttemptClock] = useState(0);
  useEffect(() => {
    if (!edited || failedRun) return;
    const left = MIN_ATTEMPT_MS - (Date.now() - startedAt.current);
    if (left <= 0) return;
    const timer = window.setTimeout(() => setAttemptClock((n) => n + 1), left);
    return () => window.clearTimeout(timer);
  }, [edited, failedRun]);
  const nextRung: LadderRung | null = rungs[taken] ?? null;
  // Why a control is unavailable is said beside it, not hidden in a disabled
  // button: the buttons stay focusable and hoverable and carry the reason as a
  // tooltip, and a click on one does nothing.
  const hintUnavailable = solution ? t('coding.hintTip.solutionShown') : !nextRung ? t('coding.hintExhausted') : !attemptReady ? t('coding.hintTip.locked') : '';
  const giveUpUnavailable = !canGiveUp(taken, rungs.length) ? t('coding.giveUpLocked', { n: giveUpAfter(rungs.length) }) : '';
  // A revealed rung takes focus, so a screen reader reads it: it appears in
  // the pane beside the editor, away from the button that asked for it.
  const hintList = useRef<HTMLOListElement | null>(null);
  const hintRevealed = useRef(false);
  useEffect(() => {
    if (!hintRevealed.current) return;
    hintRevealed.current = false;
    (hintList.current?.lastElementChild as HTMLElement | null)?.focus();
  }, [taken]);
  const takeHint = () => {
    if (hintUnavailable || !nextRung) return;
    hintRevealed.current = true;
    setHintsTaken(taken + 1);
  };
  // Revealing the solution before a pass costs this task its XP and coins: the
  // server records the reveal against the account, and a later first pass then
  // pays nothing. After a recorded pass it costs nothing, so a section task
  // shows the solution at once; inside a Learn level showing it still ends the
  // level attempt, so that is asked first, without the XP line.
  const passedAlready = recordedPass || verdict?.progress?.status === 'passed' || progress?.status === 'passed';
  const revealCostsXp = signedIn && !passedAlready;
  const revealNote = mode === 'lesson'
    ? t(revealCostsXp ? 'coding.lesson.giveUpConfirm' : 'coding.lesson.giveUpEnds')
    : t(revealCostsXp ? 'coding.giveUpConfirmXp' : 'coding.giveUpConfirm');
  const askToReveal = () => {
    if (giveUpUnavailable) return;
    if (passedAlready && mode === 'section') void reveal();
    else setConfirming('reveal');
  };
  // Keeping the code, by the button or by Escape, hands focus back to the
  // button that asked; otherwise it fell to the page.
  const cancelConfirm = () => {
    // In the More actions menu, Solution has no button of its own: the menu's does.
    const trigger = confirming === 'reset' ? resetRef.current : (revealRef.current ?? moreRef.current);
    setConfirming(null);
    trigger?.focus();
  };
  const onConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    cancelConfirm();
  };
  // A pass after a reveal says why it paid nothing, instead of reading like
  // any other pass. An accepted order is not a pass at all: the server says
  // "passed" about the arrangement, and the task stays open for the code.
  const puzzleAccepted = verdict?.puzzle?.accepted === true;
  const verdictLabel = verdict
    ? puzzleAccepted ? t('coding.puzzle.accepted')
      : verdict.verdict === 'passed' && verdict.xpForfeited === true ? t('coding.verdict.passedNoXp') : t(`coding.verdict.${verdict.verdict}` as never)
    : '';

  const busy = phase !== 'idle';
  const submitDisabled = taskChanged || mode === 'landing' || busy || !session || !online || Boolean(solution);

  // The shortcut does what the button would: nothing, while Submit is off,
  // and nothing while a puzzle or the wait for a bigger screen stands in for
  // the editor. There is no Run or Submit then, and the code under them is
  // hidden: Ctrl+Shift+Enter on a puzzle sent it as a failed attempt.
  // They are the editor's keys, too: the skip note, the report dialog and the
  // confirmations sit inside the workbench, and Ctrl+Enter there (the "send"
  // of many forms) ran the code and Ctrl+Shift+Enter submitted it.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editorShown) return;
    if (event.target instanceof Element && event.target.closest('form, dialog, [role="dialog"], [role="alertdialog"]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) { if (!submitDisabled) void submit(); }
      else void runLocal();
    }
  };
  const formatDisabled = busy || !code.trim() || code === formattedCode;
  const resetDisabled = busy || (code === task.starter && taken === 0);
  const tierLabel = t(`coding.tier.${CODING_TIERS[task.tier]}` as never);
  const trackLabel = t(`coding.track.${task.track}` as never);

  /* ── panels ─────────────────────────────────────────────────────────── */
  const localPassed = run ? runPassed(run) : null;
  // Server results replace the local run after Submit; otherwise a runner
  // startup error looked like a stale failed browser test with no explanation.
  const reactRun: HarnessRun | null = serverChecked && verdict && isReact && !checklist
    ? {
      token: harness.run?.token ?? 'server', status: verdict.codeError ? 'compile-error' : verdict.verdict === 'timeout' ? 'timeout' : 'done',
      compileError: verdict.codeError, previewError: harness.run?.previewError ?? null,
      cases: verdict.results.map((result, index) => ({name: harness.run?.cases[index]?.name ?? `${index + 1}`, status: result.pass ? 'pass' : 'fail', error: result.error ?? null, durationMs: 0})),
      logs: harness.run?.logs ?? [], passed: verdict.results.filter(result => result.pass).length,
      failed: verdict.results.filter(result => !result.pass).length, total: verdict.results.length, ran: true,
    } : harness.run;
  const resultsBadge = isReact
    ? reactRun && reactRun.status === 'done' && reactRun.total > 0 ? `${reactRun.passed}/${reactRun.total}` : null
    : run && !run.codeError && run.results.length > 0 ? `${run.results.filter((r) => r.pass === true).length}/${run.results.length}` : null;
  // The Types badge reads like the Results one, checks passed of checks
  // (UX audit coding-19); compiler errors turn it to the failing colour and
  // are counted in the panel's summary, never added into the checks.
  const typesClean = run?.check ? run.check.codeErrors.length === 0 && run.check.typeTests.every((one) => one.pass) : null;
  const typesBadge = run?.check
    ? run.check.typeTests.length > 0 ? `${run.check.typeTests.filter((one) => one.pass).length}/${run.check.typeTests.length}` : typesClean ? 'ok' : String(run.check.codeErrors.length)
    : null;
  /** What the type checker said, each kind of error counted on its own:
   * "1 compiler error · 4 of 5 type checks fail". */
  const typesSummary = (check: NonNullable<RunOutcome['check']>): string => {
    const failing = check.typeTests.filter((one) => !one.pass).length;
    const parts: string[] = [];
    if (check.codeErrors.length > 0) parts.push(workbenchCopy(check.codeErrors.length === 1 ? 'coding.types.compilerError' : 'coding.types.compilerErrors', { n: check.codeErrors.length }));
    if (failing > 0) parts.push(workbenchCopy(check.typeTests.length === 1 ? 'coding.types.checkFails' : 'coding.types.checksFail', { failing, total: check.typeTests.length }));
    return parts.length > 0 ? parts.join(' · ') : t('coding.types.clean');
  };
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const resources = useMemo(() => taskResources(task.focus).filter(entry => !task.references?.some(ref => ref.url === entry.url)), [task.focus, task.references]);
  const resourceCount = resources.length + (task.references?.length ?? 0);

  // Approach comparisons open on a recorded pass, and the server decides that.
  // Giving up and reading the reference solution is a different thing: it does
  // not open this, which is why the flag below is the verdict and not `solution`.
  const passedNow = verdict?.verdict === 'passed' && !verdict.puzzle;
  // A pass made here shows the completion instead of the tabs (below), and
  // nothing on it returns to them, so the comparisons are read only where
  // their tab can show: a task passed before, or a pass gone stale. Read on
  // every pass, they were never seen (#587 paths walk).
  const completionShown = verdict?.verdict === 'passed' && !verdictStale && !verdict.graderUnavailable;
  const approaches = useCodingApproaches(task.id, signedIn && !completionShown && (passedNow || recordedPass || progress?.status === 'passed'));
  const approachList = approaches.data?.approaches ?? [];
  // The junior and senior solutions arrive with a verified pass — this one, or
  // a recorded earlier one — and from nowhere else.
  const solutions: CodingSolutionPair | null = verdict?.solutions ?? approaches.data?.solutions ?? null;
  const suiteCases = useMemo(() => suiteCaseNames(task.suite), [task.suite]);

  // What went wrong, said once, in the learner's language.
  //
  // The server's verdict wins when there is one: it classifies with the hidden
  // tests and the expected kinds, which the browser deliberately never sees.
  // Between submissions the Run button still gets a hint, from the narrower
  // signals the browser does hold — same vocabulary, same authored text, so a
  // learner is never told two different stories about one failure.
  const currentVerdict = verdictStale ? null : verdict;
  const localHint = useMemo(() => {
    if (currentVerdict || !run || runPassed(run)) return null;
    // Nothing ran, the types stopped the checker, or the code did not parse:
    // the note in Results already names the cause, and no hint about the
    // code would be true.
    if (run.runnerUnavailable || run.codeError === TYPE_CHECK_STOPPED_MESSAGE || isSyntaxError(run.codeError)) return null;
    const typesBroken = Boolean(run.check && (run.check.codeErrors.length > 0 || run.check.typeTests.some((one) => !one.pass)));
    return failureHint(
      classifyFailure({
        timedOut: run.timedOut,
        threw: Boolean(run.codeError),
        typeErrors: typesBroken,
        results: run.results.map((one) => ({ pass: one.pass, actual: one.actual })),
        pitfall: task.pitfall,
      }),
      task.failureHints,
    );
  }, [currentVerdict, run, task.pitfall, task.failureHints]);
  const shownHint = currentVerdict?.failureHint ?? localHint;
  /** Why a run produced no results: the runner never loaded, the checker
   * stopped on the types, or the code ran out of time. */
  const runNote = (outcome: RunOutcome): string => outcome.runnerUnavailable ? t('coding.results.runnerUnavailable')
    : outcome.codeError === TYPE_CHECK_STOPPED_MESSAGE ? t('coding.results.typeCheckStopped') : t('coding.results.timeout');
  // One order on every track: Description, Results, Console, then
  // the track's own tab (Types or Preview), then Resources, so the shared tabs
  // keep their place from one track to the next.
  const tabs: { key: Tab; label: string; badge: string | null; good: boolean | null }[] = [
    { key: 'description', label: workbenchCopy('coding.tab.description'), badge: null, good: null },
    { key: 'results', label: t('coding.tab.results'), badge: resultsBadge, good: isReact ? (reactRun ? reactRun.failed === 0 && reactRun.total > 0 : null) : localPassed },
    { key: 'console', label: t('coding.tab.console'), badge: null, good: null },
    ...(isTypeScript ? [{ key: 'types' as Tab, label: t('coding.tab.types'), badge: typesBadge, good: typesClean }] : []),
    ...(isReact ? [{ key: 'preview' as Tab, label: t('coding.tab.preview'), badge: null, good: null }] : []),
    // Reading the documentation is not asking for help: this tab is open from
    // the moment the task loads, costs no hint rung, and needs no failed run.
    { key: 'resources', label: t('coding.tab.resources'), badge: resourceCount > 0 ? String(resourceCount) : null, good: null },
    // Opens with a verified pass: two more ways to write what was just solved.
    ...(solutions ? [{ key: 'solution' as Tab, label: t('coding.tab.solution'), badge: '2', good: null }] : []),
    // Only when there is something to compare. A tab that opens on nothing is
    // worse than no tab.
    ...(approachList.length > 0
      ? [{ key: 'approaches' as Tab, label: t('coding.tab.approaches'), badge: String(approachList.length), good: null }]
      : []),
  ];

  // Arrow/Home/End across the tab strip, per the ARIA tabs pattern.
  const referenceTabs = tabs.filter((one) => ['description', 'resources', 'solution', 'approaches'].includes(one.key));
  const feedbackTabs = tabs.filter((one) => !referenceTabs.includes(one));
  const selectedReference = referenceTabs.some((one) => one.key === referenceTab) ? referenceTab : 'description';
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>, available: typeof tabs, selected: Tab, select: (key: Tab) => void) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const index = available.findIndex((one) => one.key === selected);
    let next = -1;
    if (event.key in keys) next = (index + keys[event.key] + available.length) % available.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = available.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const key = available[next].key;
    select(key);
    tabRefs.current[key]?.focus();
  };

  /** Reference pages for every technique this task declares. No solutions, no
   * hidden tests: these are the same public pages a working engineer opens. */
  const renderResources = (): ReactNode => {
    if (resourceCount === 0) {
      return <p className="cd-note">{t('coding.resources.empty')}</p>;
    }
    return (
      <div className="cd-resources">
        <p className="cd-shortcuts">{t('coding.resources.intro')}</p>
        <ul>
          {task.references?.map(ref => <li key={ref.url}><a href={ref.url} target="_blank" rel="noreferrer">{ref.title}</a></li>)}
          {resources.map((entry) => (
            <li key={entry.url}>
              <a href={entry.url} target="_blank" rel="noreferrer">
                {entry.title}
              </a>
              <span className="cd-resources__source">{entry.source}</span>
              <span className="cd-resources__blurb">{entry.blurb}</span>
            </li>
          ))}
        </ul>
        {resources.length > 0 && !task.references?.length && <p className="cd-shortcuts">{t('coding.resources.reviewed', { date: resources[0].reviewed })}</p>}
      </div>
    );
  };

  /** Two or three ways to solve the same task, once the learner has solved it
   * themselves. The point is the comparison, so each one carries its cost, its
   * assumptions and what it gives up. */
  const renderApproaches = (): ReactNode => (
    <div className="cd-approaches">
      <p className="cd-shortcuts">{t('coding.approaches.intro')}</p>
      {approachList.map((approach, index) => (
        <article key={index} className="cd-approach">
          <h4>{approach.name}</h4>
          <pre>{approach.code}</pre>
          <dl>
            <dt>{t('coding.approaches.cost')}</dt>
            <dd>{t('coding.approaches.costValue', { time: approach.time, space: approach.space })}</dd>
            <dt>{t('coding.approaches.readability')}</dt>
            <dd>{approach.readability}</dd>
            <dt>{t('coding.approaches.assumptions')}</dt>
            <dd>{approach.assumptions}</dd>
            <dt>{t('coding.approaches.tradeoffs')}</dt>
            <dd>{approach.tradeoffs}</dd>
          </dl>
        </article>
      ))}
    </div>
  );

  /** The junior and senior ways to write what the learner just solved. Both
   * pass every check the learner's own code did, and the point is the
   * distance between them. */
  const renderSolution = (): ReactNode => solutions && (
    <div className="cd-solutions">
      <p className="cd-shortcuts">{t('coding.solution.intro')}</p>
      {([['junior', solutions.junior], ['senior', solutions.senior]] as const).map(([level, code]) => (
        <article key={level} className="cd-hint cd-solution">
          <h4 className="cd-solution__title">{t(`coding.solution.${level}`)}</h4>
          <p className="cd-solution__note">{t(`coding.solution.${level}Note`)}</p>
          <pre>{code}</pre>
        </article>
      ))}
    </div>
  );

  /** One row of the Results list. Before a run the row still says what goes
   * in and what should come out; only the status column waits. A row is a
   * line of a divided list, not a card of its own (UX audit coding-15): the
   * call, then the expected value after an arrow, and after a run what came
   * back. "Expected" is never printed; a screen reader hears it in place of
   * the arrow. */
  const codeRow = (test: NonNullable<PlayableCodingTask['tests']>[number], result: RunOutcome['results'][number] | undefined, index: number): ReactNode => {
    const status = result?.pass === true ? 'pass' : result?.pass === false ? 'fail' : 'idle';
    return (
      <li key={index} className={`cd-result cd-result--${status}`}>
        <span className="cd-result__status">{status === 'pass' ? t('coding.results.pass') : status === 'fail' ? t('coding.results.fail') : <><span aria-hidden="true">—</span><span className="cd-visually-hidden">{t('coding.results.pending')}</span></>}</span>
        {/* The call alone is .cd-result__call; what it should return and
            what came back follow it on the same line. */}
        <span className="cd-result__line">
          <span className="cd-result__call">{test.shown ?? test.call}</span>
          {!result?.error && (
            <span className="cd-result__expect">
              <span aria-hidden="true"> → </span><span className="cd-visually-hidden"> {t('coding.results.expected')} </span>{JSON.stringify(test.expected)}
              {result && <> · {workbenchCopy('coding.results.got', { value: result.actual ?? '' })}</>}
            </span>
          )}
          {test.edge && <span className="cd-tag cd-result__edge">{t('coding.results.edge')}</span>}
        </span>
        {test.label && <span className="cd-result__label">{test.label}</span>}
        {result?.error && <span className="cd-result__detail"><b>{t('coding.results.error')}:</b> {result.error}</span>}
      </li>
    );
  };

  const renderResults = (): ReactNode => {
    if (isReact) {
      if (checklist) {
        return (
          <>
            <p className="cd-note">{t('coding.checklist.note')}</p>
            <ul className="cd-checklist">
              {(task.checklist ?? []).map((item, index) => (
                <li key={index}>
                  <label>
                    <input type="checkbox" checked={checked[index] ?? false} onChange={(e) => setChecked((prev) => prev.map((v, i) => (i === index ? e.target.checked : v)))} />
                    <span>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        );
      }
      if (!reactRun) {
        // Nothing has run, so the cases are listed by name with no verdict:
        // the learner sees what the suite will ask before writing a line.
        return (
          <>
            <p className="cd-console__empty">{t('coding.results.idle')}</p>
            {suiteCases.length > 0 && (
              <ul className="cd-results">
                {suiteCases.map((name, index) => (
                  <li key={index} className="cd-result cd-result--idle">
                    <span className="cd-result__status"><span aria-hidden="true">—</span><span className="cd-visually-hidden">{t('coding.results.pending')}</span></span>
                    <span className="cd-result__call">{name}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }
      if (reactRun.status === 'compile-error') return <p className="cd-note cd-note--error">{t('coding.preview.compileError', { message: reactRun.compileError ?? '' })}</p>;
      if (reactRun.status === 'timeout') return <p className="cd-note cd-note--warn">{t('coding.preview.timeout')}</p>;
      return (
        <>
          {/* The count is the tab's badge; the panel says only what the
              badge cannot (coding-19). */}
          {reactRun.status === 'done' && (serverChecked || stale) && <p className="cd-summary">{verdict?.hidden && serverChecked && <small>{t('coding.results.hidden', { passed: verdict.hidden.passed, total: verdict.hidden.total })}</small>}{serverChecked && <small>{t('coding.results.serverNote')}</small>}{stale && <small>{t('coding.results.stale')}</small>}</p>}
          <ul className="cd-results">
            {reactRun.cases.map((one, index) => (
              <li key={index} className={`cd-result cd-result--${one.status}`}>
                <span className="cd-result__status">{one.status === 'pass' ? t('coding.results.pass') : t('coding.results.fail')}</span>
                <span className="cd-result__call">{one.name}</span>
                {one.error && <span className="cd-result__detail"><b>{t('coding.results.error')}:</b> {one.error}</span>}
              </li>
            ))}
          </ul>
        </>
      );
    }
    const tests = task.tests ?? [];
    // Landing shows three examples; Run and server grading still execute the
    // complete test suite. Full challenge screens keep every result visible.
    const visibleTests = mode === 'landing' ? tests.slice(0, 3) : tests;
    if (!run) {
      // Before the first run every test is already on the board — the call
      // that goes in and the value that should come out — with no verdict.
      return (
        <>
          <p className="cd-console__empty">{t('coding.results.idle')}</p>
          {tests.length > 0 && (
            <ul className="cd-results">
              {visibleTests.map((test, index) => codeRow(test, undefined, index))}
            </ul>
          )}
        </>
      );
    }
    if (run.runnerUnavailable || run.timedOut) return <p className="cd-note cd-note--warn">{runNote(run)}</p>;
    if (run.codeError) return <p className="cd-note cd-note--error">{t('coding.results.codeError')} <code className="cd-inline-code">{run.codeError}</code></p>;
    // "N of M passing" is the Results badge above, so it is not said again
    // here; the live region still announces it (coding-19).
    return (
      <>
        {(serverChecked || stale) && <p className="cd-summary">
          {verdict?.hidden && serverChecked && <small>{t('coding.results.hidden', { passed: verdict.hidden.passed, total: verdict.hidden.total })}</small>}
          {serverChecked && <small>{t('coding.results.serverNote')}</small>}
          {stale && <small>{t('coding.results.stale')}</small>}
        </p>}
        <ul className="cd-results">
          {(mode === 'landing' ? run.results.slice(0, 3) : run.results).map((result, index) => codeRow(tests[index] ?? { call: '', expected: undefined }, result, index))}
        </ul>
      </>
    );
  };

  const renderTypes = (): ReactNode => {
    const check = run?.check;
    if (!check) {
      const typeTests = task.typeTests ?? [];
      return (
        <>
          <p className="cd-console__empty">{t('coding.results.idle')}</p>
          {typeTests.length > 0 && (
            <ul className="cd-results">
              {typeTests.map((typeTest, index) => (
                <li key={index} className="cd-result cd-result--idle">
                  <span className="cd-result__status"><span aria-hidden="true">—</span><span className="cd-visually-hidden">{t('coding.results.pending')}</span></span>
                  <span className="cd-result__call">{typeTest.code}{typeTest.rejects && <span className="cd-result__label"> · {t('coding.types.rejects')}</span>}</span>
                  {typeTest.label && <span className="cd-result__label">{typeTest.label}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      );
    }
    return (
      <>
        <p className="cd-summary">{typesSummary(check)}</p>
        {check.codeErrors.length > 0 && (
          <ul className="cd-results">
            {check.codeErrors.map((error, index) => (
              <li key={index} className="cd-result cd-result--fail">
                <span className="cd-result__status">{t('coding.types.line', { n: error.line })}</span>
                <span className="cd-result__detail">{error.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="cd-editor-label">{t('coding.types.tests')}</p>
        <ul className="cd-results">
          {check.typeTests.map((one, index) => {
            const typeTest = task.typeTests?.[index];
            return (
              <li key={index} className={`cd-result cd-result--${one.pass ? 'pass' : 'fail'}`}>
                <span className="cd-result__status">{one.pass ? t('coding.results.pass') : t('coding.results.fail')}</span>
                <span className="cd-result__call">{typeTest?.code ?? ''}{typeTest?.rejects && <span className="cd-result__label"> · {t('coding.types.rejects')}</span>}</span>
                {typeTest?.label && <span className="cd-result__label">{typeTest.label}</span>}
                {one.error && <span className="cd-result__detail">{one.error}</span>}
              </li>
            );
          })}
        </ul>
      </>
    );
  };

  const logs = isReact ? (reactRun?.logs.map((entry) => `${entry.level === 'log' ? '' : `[${entry.level}] `}${entry.text}`) ?? []) : (run?.logs ?? []);
  const renderConsole = (): ReactNode => (logs.length === 0 ? <p className="cd-console__empty">{t('coding.console.empty')}</p> : <pre className="cd-console">{logs.join('\n')}</pre>);

  // Before the first run there is nothing to show, so the preview says so in
  // one line and its frame takes no room (coding-04). The frame mounts once it
  // is wanted (frameWanted above) or the Preview tab opens, and stays.
  useEffect(() => { if (isReact && tab === 'preview') setFrameWanted(true); }, [isReact, tab]);
  const frameOn = isReact && (frameWanted || tab === 'preview');
  const previewIdle = !reactRun && !busy;
  const renderPreview = (): ReactNode => (
    <>
      {reactRun?.previewError && <p className="cd-note cd-note--error">{t('coding.preview.error', { message: reactRun.previewError })}</p>}
      {reactRun?.status === 'timeout' && <p className="cd-note cd-note--warn">{t('coding.preview.timeout')} <Button variant="ghost" size="sm" onClick={harness.reload} label={t('coding.preview.reload')} /></p>}
      {previewIdle ? <p className="cd-console__empty">{workbenchCopy('coding.preview.idle')}</p>
        : !harness.ready && <p className="cd-console__empty">{t('coding.preview.starting')}</p>}
      {frameOn && <iframe key={harness.frameKey} ref={harness.iframeRef} src={HARNESS_URL} sandbox="allow-scripts allow-forms" title={t('coding.preview.title')} className={previewIdle ? 'cd-frame cd-frame--idle' : 'cd-frame'} aria-hidden={previewIdle || undefined} tabIndex={tab === 'preview' && !previewIdle ? undefined : -1} />}
    </>
  );

  // "Passing the visible examples is not enough" is only true when they all
  // passed; with a visible failure on screen it told the learner otherwise.
  const visiblePassed = Boolean(verdict && verdict.results.length > 0 && verdict.results.every((one) => one.pass === true)
    && !(verdict.check && (verdict.check.codeErrors.length > 0 || verdict.check.typeTests.some((one) => !one.pass))));
  // Grading finishes somewhere the learner is not looking, so focus follows the
  // result. The card is not a dialog and does not trap anything: it takes focus
  // once, and Tab carries on from there.
  const verdictCard = verdict && (
    <section className={`cd-verdict cd-verdict--${puzzleAccepted ? 'puzzle' : verdict.verdict}`} ref={verdictRef} tabIndex={-1}>
      <h3 className="cd-verdict__title">
        <span>{verdictLabel}</span>
        {(verdict.xpAwarded > 0 || (isReact && verdict.verdict === 'passed' && !verdictStale)) && <span className="cd-verdict__xp">{t('coding.verdict.xp', { xp: verdict.xpAwarded })}</span>}
      </h3>
      {!(isReact && verdict.verdict === 'passed' && !verdictStale) && <RepeatXpNote verdict={verdict} />}
      {verdict.complexity?.time && <p className="cd-verdict__row">{t('coding.complexity.result', { complexity: verdict.complexity.time })}</p>}
      {verdictStale && <p className="cd-verdict__row">{t('coding.verdict.stale')}</p>}
      {verdict.verdict === 'failed' && verdict.hidden && verdict.hidden.passed < verdict.hidden.total && visiblePassed && <p className="cd-verdict__row">{t('coding.verdict.hiddenFailed')}</p>}
      {verdict.puzzle ? (
        <>
          {/* The title already says whether the order works. */}
          {!verdict.puzzle.accepted && <p className="cd-verdict__row">{t('coding.puzzle.rejected')}</p>}
          {verdict.puzzle.accepted && (
            <p className="cd-verdict__row">{verdict.puzzle.claim}</p>
          )}
        </>
      ) : (
        !isReact && verdict.verdict === 'passed' && verdict.progress && <p className="cd-verdict__row">{verdict.firstPass ? t('coding.verdict.firstPass') : t('coding.verdict.again')}</p>
      )}
      {/* Signed out, a pass says here, where it matters, that it needs an
          account, with the way to get one (UX audit coding-10). */}
      {verdict.verdict === 'passed' && !verdict.progress && !verdict.puzzle && (signedIn
        ? <p className="cd-verdict__row">{t('coding.verdict.notRecorded')}</p>
        : <p className="cd-verdict__row cd-verdict__signin">{t('coding.verdict.signIn')} <Button variant="secondary" aria-haspopup="dialog" onClick={() => openSignIn()} label={workbenchCopy('coding.verdict.signInAction')} /></p>)}
      {verdict.github && verdict.github.status !== 'not_connected' && (
        <p className="cd-verdict__row">
          {verdict.github.status === 'committed' && verdict.github.url ? <a className="cd-link" href={verdict.github.url} target="_blank" rel="noreferrer">{t('coding.github.committed', { repo: verdict.github.url.replace(/^https:\/\/github\.com\//, '').split('/').slice(0, 2).join('/') })}</a>
            : verdict.github.status === 'queued' ? t('coding.github.queued')
            : verdict.github.status === 'skipped' ? t('coding.github.skipped')
            : t('coding.github.failed')}
        </p>
      )}
      {verdict.verdict === 'passed' && !verdict.puzzle && (
        <div className="cd-verdict__actions">
          {mode === 'lesson' && onContinue && <SwimCta dir={1} onClick={onContinue} label={t('coding.lesson.continue')} />}
          {mode === 'section' && nextHref && <Button variant="primary" as={Link} href={nextHref} label={t('coding.verdict.next')} />}
          {mode === 'section' && backHref && <Button variant="secondary" as={Link} href={backHref} label={t('coding.verdict.back')} />}
        </div>
      )}
    </section>
  );

  // Announce what a run or a submission concluded. A live region has to be in
  // the document BEFORE its text changes, so it lives here rather than on the
  // verdict card, which mounts along with its own message.
  // It says what the panel says: a build error, a timeout or type errors are
  // never read out as "N of M passing".
  const runAnnouncement = (): string => {
    if (isReact) {
      if (reactRun?.status === 'compile-error') return t('coding.preview.compileError', { message: reactRun.compileError ?? '' });
      if (reactRun?.status === 'timeout') return t('coding.preview.timeout');
      return reactRun?.status === 'done' ? t('coding.results.passing', { passed: reactRun.passed, total: reactRun.total }) : '';
    }
    if (!run) return '';
    if (run.runnerUnavailable || run.timedOut) return runNote(run);
    if (run.codeError) return t('coding.results.codeError');
    const passing = t('coding.results.passing', { passed: run.results.filter((one) => one.pass === true).length, total: run.results.length });
    return run.check && !typesClean ? `${passing}. ${typesSummary(run.check)}` : passing;
  };
  // Once the code changes, the results on screen are about earlier code. Read
  // out again they would sound like news about the new code (the first
  // keystroke after a failed Submit announced "5 of 5 passing"), so until the
  // next Run or Submit the region keeps what it last said.
  const said = useRef('');
  const fresh = busy
    ? t('coding.status.working')
    : currentVerdict
      ? verdictLabel
      : stale || (verdictStale && !run && !reactRun)
        ? null
        : runAnnouncement();
  if (fresh !== null) said.current = fresh;
  const announcement = fresh ?? said.current;

  const titleId = `${baseId}-title`;
  const Title = mode === 'section' ? 'h1' : 'h2';
  const briefMeta = evolution
    ? t(evolution.challenge.short ? 'coding.evolving.level' : 'coding.evolving.stage', { n: evolution.index + 1, total: evolution.challenge.stages.length })
    : `${trackLabel} · ${tierLabel}${task.topic === 'dsa' ? ` · ${t('category.dsa')}` : ''}${hasLearnLevel(task) ? ` · ${t('coding.level', { n: task.level })}` : ''}`;

  // The whole brief belongs to Description, including the task's metadata,
  // earlier requirements and glossary. Its panel owns scrolling.
  const brief = (
    <BriefZone
      full
      labelledBy={titleId}
      head={(
        <div className="cd-brief__head">
          {!(evolution && mode === 'section') && <p className="cd-brief__meta">{briefMeta}</p>}
          <div className="cd-brief__line">
            <Title id={titleId} className="cd-brief__title">{task.title}</Title>
            <DifficultyBadge difficulty={difficultyOf(task)} />
            {formatOf(task) === 'debug' && <span className="cd-tag cd-tag--format">{t('coding.format.debug')}</span>}
          </div>
        </div>
      )}
      after={locked && <p className="cd-note cd-note--warn">{t('coding.lockedTask')} {t(`coding.lock.${locked}` as never)}</p>}
    >
      <Prompt className="cd-prompt" text={descriptionText(task.prompt)} />
      {complexity.targetTime && <div className="cd-complexity">
        <span>{t('coding.complexity.desired', { complexity: complexity.targetTime })}</span>
        <ComplexityInfo guidance={complexity} />
      </div>}
      {/* Earlier briefs still apply, but they are context now, not the
          task: smaller, lighter, and numbered by the stage that set them. */}
      {Boolean(task.previousRequirements?.length) && <details className="cd-previous">
        <summary>{t('coding.evolving.previous')}</summary>
        <ol className="cd-previous__list">
          {task.previousRequirements!.map((requirement, index) => (
            <li key={index}>
              <span className="cd-previous__stage">{t(evolution?.challenge.short ? 'coding.evolving.levelShort' : 'coding.evolving.stageShort', { n: index + 1 })}</span>
              <Prompt className="cd-prompt cd-prompt--previous" text={descriptionText(requirement)} />
            </li>
          ))}
        </ol>
      </details>}
      {/* Beside the brief, so nothing is injected into code the learner
          is reading or about to run. */}
      <TermsBar texts={[descriptionText(task.prompt), task.title]} domain={glossaryDomainFor(task.track)} />
      {formatOf(task) === 'debug' && <p className="cd-note">{t('coding.format.debugHint')}</p>}
      {task.api && <p className="cd-api"><code>{task.api.method} {task.api.url}</code><br />{task.api.note}</p>}
    </BriefZone>
  );

  // Format and Reset act on the code, so they sit in the editor's own slim
  // toolbar above it: 36px icon buttons with a 44px hit area (.ss-compact)
  // and their names as tooltips (UX audit coding-02).
  const editorBar = (
    <div className="cd-editor-bar ss-compact">
      <Button variant="ghost" isIconOnly icon={<FormatCodeIcon />} tooltip={t('coding.format')} onClick={() => void format()} isDisabled={formatDisabled} label={t('coding.format')} />
      <Button variant="ghost" ref={resetRef} isIconOnly icon={<ResetIcon />} tooltip={t('coding.reset')} onClick={() => setConfirming('reset')} isDisabled={resetDisabled} label={t('coding.reset')} />
    </div>
  );

  // Run, Submit and the rest close the same pane, under the code: one 44px
  // row. Run and Submit lead with their words at every width, and Submit is
  // the screen's one filled primary (SwimCta md). Hint, Solution and Skip are
  // ghost buttons beside them from 1024px, and fold into More actions below
  // that, with Report (UX audit coding-02, coding-13).
  const hintLabel = taken === 0 ? t('coding.hint') : t('coding.hintNext');
  const showReveal = mode !== 'landing' && Boolean(session) && !solution && !solutions;
  const showSkip = signedIn && mode === 'section' && !skipResult;
  const actionBar = (
    <div className="cd-editor-actions" onPointerEnter={reachForRun} onFocus={reachForRun}>
      <div className="cd-actions cd-actions--commands">
        {!puzzleMode && !pendingOnDesktop && <>
        {/* Busy, not disabled: the button that was pressed keeps the focus
            (a disabled one hands it to the page), and a press does nothing. */}
        <Button className="ss-action" variant="secondary" onClick={() => void runLocal()} isDisabled={busy} tooltip={busy ? t('coding.status.working') : undefined} label={phase === 'running' ? (runPhase === 'compiling' ? t('coding.compiling') : t('coding.running')) : t('coding.run')} />
        {mode !== 'landing' && <SwimCta dir={1} onClick={() => { if (!submitDisabled) void submit(); }} unavailable={submitDisabled} label={phase === 'submitting' ? t('coding.submitting') : t('coding.submit')} />}
        </>}

        {!menuCommands && <>
          {/* Unavailable for a reason: focusable, with the reason as its tooltip. */}
          <Button variant="ghost" onClick={takeHint} isDisabled={hintUnavailable !== ''} tooltip={hintUnavailable || undefined} label={hintLabel} />
          {showReveal && (
            <Button variant="ghost" ref={revealRef} onClick={askToReveal} isDisabled={giveUpUnavailable !== '' || busy} tooltip={giveUpUnavailable || undefined} label={t('coding.giveUp')} />
          )}
          {showSkip && <Button variant="ghost" onClick={() => setSkipping((open) => !open)} aria-expanded={skipping} label={t('coding.skip.action')} />}
        </>}
        <div className="cd-actions cd-actions--utility">
          {mode !== 'landing' && !locked && saveAction}
          {menuCommands ? (
            // The menu items keep the reason an action is unavailable, as
            // their description rather than a tooltip.
            <DropdownMenu
              button={{ label: workbenchCopy('coding.moreActions'), icon: <Icon icon="moreHorizontal" />, isIconOnly: true, variant: 'ghost', tooltip: workbenchCopy('coding.moreActions'), ref: moreRef }}
              hasChevron={false}
              placement="above"
            >
              <DropdownMenuItem icon={<HintIcon size={16} />} label={hintLabel} description={hintUnavailable || undefined} isDisabled={hintUnavailable !== ''} onClick={takeHint} />
              {showReveal && <DropdownMenuItem icon={<EyeIcon size={16} />} label={t('coding.giveUp')} description={giveUpUnavailable || undefined} isDisabled={giveUpUnavailable !== '' || busy} onClick={askToReveal} />}
              {showSkip && <DropdownMenuItem icon={<SkipIcon size={16} />} label={t('coding.skip.action')} onClick={() => setSkipping((open) => !open)} />}
              {mode !== 'landing' && <DropdownMenuItem icon={<FlagIcon size={16} />} label={t('coding.reportTask')} onClick={() => setReportOpen(true)} />}
            </DropdownMenu>
          ) : (
            // Not the landing sample: it always takes the menu.
            <Button
              variant="ghost"
              isIconOnly
              icon={<FlagIcon />}
              label={t('coding.reportTask')}
              tooltip={t('coding.reportTask')}
              onClick={() => setReportOpen(true)}
            />
          )}
        </div>
      </div>
    </div>
  );

  // What the actions open: hints, the skip form, confirmations and errors. It
  // follows the pane in reading order and exists only while it holds something.
  const hintsOpen = taken > 0 || skipping || skipResult !== null || confirming === 'reveal' || solution !== null;
  const refreshTask = async () => {
    if (!onRefreshTask || busy) return;
    setPhase('submitting');
    try { await onRefreshTask(code); setTaskChanged(false); setSubmitError(null); setRun(null); }
    catch (error) { setSubmitError(friendlyError(error)); }
    finally { setPhase('idle'); }
  };
  const refreshAction = taskChanged && onRefreshTask && <Button className="cd-brief-refresh" variant="secondary" isDisabled={busy || !online} onClick={() => void refreshTask()} label={t('coding.verdict.reloadBrief')} />;
  const notesOpen = hintsOpen || confirming === 'reset' || !online || draftTooLarge || formatError !== null || (submitError !== null && !puzzleMode);

  const renderTabs = (available: typeof tabs, selected: Tab, select: (key: Tab) => void, label: string) => (
    <div className="cd-tabs" role="tablist" aria-label={label} onKeyDown={(event) => onTabKeyDown(event, available, selected, select)}>
      {available.map((one) => (
        <FinButton key={one.key} type="button" role="tab" id={`${baseId}-tab-${one.key}`}
          aria-selected={selected === one.key} aria-controls={`${baseId}-panel-${one.key}`}
          tabIndex={selected === one.key ? 0 : -1} ref={(node) => { tabRefs.current[one.key] = node; }}
          className="cd-tab" data-tab={one.key} onClick={() => select(one.key)}>
          {one.label}
          {one.badge && <span className={`cd-tab__badge${one.good === true ? ' cd-tab__badge--good' : one.good === false ? ' cd-tab__badge--bad' : ''}`}>{one.badge}</span>}
        </FinButton>
      ))}
    </div>
  );
  const renderPanels = (available: typeof tabs, selected: Tab) => available.map((one) => {
    // A suite's focus checks need a laid-out frame even while Results shows.
    const parked = one.key === 'preview' && selected !== 'preview' && busy;
    return <div key={one.key} role="tabpanel" tabIndex={selected === one.key ? 0 : -1}
      id={`${baseId}-panel-${one.key}`} aria-labelledby={`${baseId}-tab-${one.key}`}
      className={`cd-panel${parked ? ' cd-panel--parked' : ''}`}
      hidden={selected !== one.key && !parked} aria-hidden={parked || undefined}>
      {one.key === 'description' && brief}
      {one.key === 'results' && renderResults()}
      {one.key === 'types' && renderTypes()}
      {one.key === 'console' && renderConsole()}
      {one.key === 'preview' && renderPreview()}
      {one.key === 'resources' && renderResources()}
      {one.key === 'solution' && renderSolution()}
      {one.key === 'approaches' && renderApproaches()}
    </div>;
  });
  const feedbackNotes = <>
    {verdictCard}
    {tab === 'results' && shownHint && <div className="cd-hint cd-hint--failure" role="status">
      <strong className="cd-hint__label">{t(`coding.failure.${shownHint.category}` as never)}</strong>
      <Prompt text={shownHint.body} />
    </div>}
  </>;

  if (completionShown && verdict) {
    return <div className={`cd-workbench cd-workbench--${mode}`}><CodingCompletion
      xp={verdict.xpAwarded} complexity={verdict.complexity} sectionRef={verdictRef}
      signInToRecord={!signedIn && !verdict.progress}
      onNext={mode === 'lesson' ? onContinue : undefined} nextHref={nextHref ?? undefined}
      backHref={backHref ?? (mode === 'lesson' ? '/learn' : `/coding/${task.track}`)} /></div>;
  }

  return (
    <div
      className={`cd-workbench cd-workbench--${mode}`}
      data-feedback-collapsed={sectionLayout ? feedbackCollapsed : undefined}
      onKeyDown={onKeyDown}
    >
      <span className="cd-visually-hidden" role="status" aria-live="polite">{announcement}</span>
      <div className="cd-workbench__grid" style={{ ['--cd-split' as string]: `${layout.split}%`, ['--cd-feedback-height' as string]: `${layout.feedbackHeight}px` }}>
        <section className="cd-pane cd-pane--output" aria-label={workbenchCopy(sectionLayout ? 'coding.reference.label' : 'coding.output.label')}>
          {renderTabs(sectionLayout ? referenceTabs : tabs, sectionLayout ? selectedReference : tab, sectionLayout ? setReferenceTab : selectTab, workbenchCopy(sectionLayout ? 'coding.reference.label' : 'coding.output.label'))}
          <div className="cd-output-scroll">
            {renderPanels(sectionLayout ? referenceTabs : tabs, sectionLayout ? selectedReference : tab)}
            {!sectionLayout && feedbackNotes}
          </div>
        </section>
          {puzzleMode && task.puzzle && (
            <section className="cd-pane cd-pane--editor" aria-labelledby={titleId}>
              {/* Keyed by the session: a re-issued task comes with a fresh
                  shuffle and a fresh translation, so the arrangement starts
                  over rather than being graded under the new one. */}
              <CodePuzzle key={session ?? task.id} puzzle={task.puzzle} busy={busy} onSubmit={(order) => void submitOrder(order)} />
              {submitError && <p className="cd-note cd-note--error" role="alert">{submitError}</p>}
              {puzzleMode && refreshAction}
              <div className="cd-actions">
                <Button variant="secondary" onClick={chooseEditorHere} label={t('coding.pendingDesktopUseEditor')} />
              </div>
              {actionBar}
            </section>
          )}

          {pendingOnDesktop && (
            <section className="cd-pane cd-pane--editor" aria-labelledby={titleId}>
              {/* No editor, no puzzle, and no pass: the task waits. The draft is
                  kept exactly as it is, and nothing about this marks it done.
                  Waiting is the default, never the only way: the editor works
                  here too, just with less room. */}
              {/* One note and its one decision (UX audit coding-14). Hint,
                  Solution and Report wait for the editor: without it they
                  had nothing to act on. */}
              {/* The status is the sentence; the button beside it is not
                  part of what a screen reader announces. */}
              <div className="cd-note cd-note--warn cd-wait">
                <p role="status">{t('coding.pendingDesktop')}</p>
                <Button variant="secondary" onClick={chooseEditorHere} label={t('coding.pendingDesktopUseEditor')} />
              </div>
            </section>
          )}

          {/* Stays mounted while a puzzle or the pending note stands in for it,
              so the code survives a resize; the editor inside it mounts once
              it has shown (editorMounted). */}
          <section className="cd-pane cd-pane--editor" ref={editorPaneRef} tabIndex={-1} hidden={puzzleMode || pendingOnDesktop} aria-labelledby={puzzleMode || pendingOnDesktop ? undefined : titleId}>
            <div className="cd-editor-slot" onPointerEnter={wantCompiler} onFocus={wantCompiler}>
              {!puzzleMode && !pendingOnDesktop && editorBar}
              {/* In the frame (1024px and up) the editor fills the pane above
                  the action bar and scrolls inside; stacked, it
                  starts at --cd-editor-min and grows with the code. */}
              {editorMounted && <EditorPart loadingLabel={t('common.loading')} failedLabel={t('coding.loadError')} fill={mode !== 'landing'} minHeight={mode === 'landing' ? 160 : undefined} maxHeight={mode === 'landing' ? 160 : undefined} value={code} onChange={onCodeChange} track={task.track} ariaLabel={t('coding.editorLabel')} describedBy={`${baseId}-keys`} readOnly={Boolean(solution) && mode === 'lesson'} />}
              {/* The shortcuts are not printed on the page; a screen reader
                  hears them with the editor, Escape then Tab included. */}
              <span id={`${baseId}-keys`} className="cd-visually-hidden">{t(mode === 'landing' ? 'coding.shortcuts.preview' : 'coding.shortcuts')}</span>
            </div>
            {!puzzleMode && !pendingOnDesktop && actionBar}
          </section>

          {sectionLayout && editorShown && <section className="cd-feedback" aria-label={workbenchCopy('coding.feedback.label')}>
            <div className="cd-feedback__toolbar">
              {renderTabs(feedbackTabs, tab, selectTab, workbenchCopy('coding.feedback.label'))}
              <Button variant="ghost" className="cd-feedback__toggle" aria-expanded={!feedbackCollapsed}
                aria-controls={`${baseId}-feedback`} onClick={() => setFeedbackCollapsed((value) => !value)}
                label={workbenchCopy(feedbackCollapsed ? 'coding.feedback.show' : 'coding.feedback.hide')} />
            </div>
            <div id={`${baseId}-feedback`} className="cd-output-scroll" hidden={feedbackCollapsed}>
              {renderPanels(feedbackTabs, tab)}
              {feedbackNotes}
            </div>
          </section>}

          {notesOpen && (
            <div className="cd-pane cd-pane--controls">
              {hintsOpen && <div className="cd-hints" role="group" aria-label={t('coding.hint')}>
                <ol className="cd-hint-list" ref={hintList}>
                  {rungs.slice(0, taken).map((rung, index) => (
                    <li key={index} className="cd-hint" tabIndex={-1}>
                      <span className="cd-hint__label">
                        {rung.kind === 'hint' ? t('coding.hint.hint', { n: rung.index + 1 }) : rung.kind === 'approach' ? t('coding.hint.approach', { n: rung.index + 1 }) : rung.kind === 'skeleton' ? t('coding.hint.skeleton') : t('coding.hint.docs')}
                      </span>
                      {rung.kind === 'skeleton' ? <pre>{rung.body}</pre>
                        : rung.kind === 'docs' ? <><span>{t('coding.hint.docsBody', { tag: rung.title })}</span><br /><a href={rung.url} target="_blank" rel="noreferrer">{t('coding.hint.docsLink', { tag: rung.title })}</a></>
                        : <Prompt text={rung.body} />}
                    </li>
                  ))}
                </ol>
                {/* Skipping records why, and nothing else. It is not a pass: a
                    task the learner's level requires stays required and says so,
                    and nothing here unlocks anything. */}
                {skipping && !skipResult && (
                  <form className="cd-skip-card" onSubmit={(event) => { event.preventDefault(); void confirmSkip(); }}>
                    <h3>{t('coding.skip.title')}</h3>
                    <fieldset className="cd-skip-reasons" disabled={skipSubmitting}>
                      <legend>{t('coding.skip.reasonLabel')}</legend>
                      {SKIP_REASONS.map((reason) => (
                        <label key={reason} className="cd-skip-reason">
                          <input
                            type="radio"
                            name={`${baseId}-skip-reason`}
                            value={reason}
                            checked={skipReason === reason}
                            onChange={() => setSkipReason(reason)}
                          />
                          <span>{t(`coding.skip.${reason}` as never)}</span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="cd-skip-field">
                      <label htmlFor={`${baseId}-skip-note`}>{t('coding.skip.noteLabel')}</label>
                      <textarea
                        id={`${baseId}-skip-note`}
                        className="cd-skip-note"
                        maxLength={280}
                        rows={3}
                        value={skipNote}
                        disabled={skipSubmitting}
                        onChange={(event) => setSkipNote(event.target.value)}
                      />
                    </div>
                    {skipError && <p className="cd-note cd-note--error" role="alert">{skipError}</p>}
                    <div className="cd-actions cd-actions--end">
                      <Button variant="ghost" isDisabled={skipSubmitting} onClick={() => setSkipping(false)} label={t('coding.skip.cancel')} />
                      <Button type="submit" variant="primary" isDisabled={skipSubmitting} label={t('coding.skip.confirm')} />
                    </div>
                  </form>
                )}
                {skipResult && (
                  <div className="cd-note" role="status">
                    <p style={{ margin: '0 0 8px' }}>{t(skipResult.required ? 'coding.skip.required' : 'coding.skip.optional')}</p>
                    {skipResult.next && (
                      <Button variant="secondary" as={Link} href={`/coding/${task.track}/${skipResult.next}`} label={t('coding.skip.next')} />
                    )}
                  </div>
                )}

                {confirming === 'reveal' && (
                  <div className="cd-note cd-note--warn" role="alertdialog" aria-label={t('coding.giveUp')} onKeyDown={onConfirmKeyDown}>
                    <p style={{ margin: '0 0 8px' }}>{revealNote}</p>
                    <div className="cd-actions">
                      <Button variant="primary" onClick={() => void reveal()} label={t('coding.giveUp')} />
                      <Button variant="secondary" onClick={cancelConfirm} ref={focusOnMount} label={t('coding.giveUpCancel')} />
                    </div>
                  </div>
                )}
                {solution && (
                  <div className="cd-hint cd-solution" ref={solutionRef} tabIndex={-1}>
                    <span className="cd-hint__label">{t('coding.solutionTitle')}</span>
                    <pre>{solution}</pre>
                    <p className="cd-shortcuts">{t('coding.solutionNote')}</p>
                  </div>
                )}
              </div>}
              {confirming === 'reset' && (
                <div className="cd-note cd-note--warn" role="alertdialog" aria-label={t('coding.reset')} onKeyDown={onConfirmKeyDown}>
                  <p style={{ margin: '0 0 8px' }}>{t(signedIn && (progress?.status === 'passed' || verdict?.verdict === 'passed') ? 'coding.resetConfirmXp' : 'coding.resetConfirm')}</p>
                  <div className="cd-actions">
                    <Button variant="primary" onClick={reset} label={t('coding.reset')} />
                    <Button variant="secondary" onClick={cancelConfirm} ref={focusOnMount} label={t('coding.resetCancel')} />
                  </div>
                </div>
              )}
              {!online && <p className="cd-note cd-note--warn" role="status">{t('coding.offline')}</p>}
              {draftTooLarge && <p className="cd-note cd-note--warn" role="status">{t('coding.draft.tooLarge')}</p>}
              {formatError && <p className="cd-note cd-note--error" role="status">{formatError}</p>}
              {submitError && !puzzleMode && <p className="cd-note cd-note--error" role="alert">{submitError}</p>}
              {!puzzleMode && refreshAction}
            </div>
          )}

        {/* A real separator: it takes focus, arrows move it, Home and End go to
            the limits and Enter restores the default. It is hidden below the
            two-column breakpoint, where there is nothing to split. */}
        <div
          className="cd-splitter"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t('coding.layout.splitter')}
          aria-valuenow={layout.split}
          aria-valuemin={SPLIT_MIN}
          aria-valuemax={SPLIT_MAX}
          onKeyDown={onSeparatorKeyDown}
          onPointerDown={onSeparatorPointerDown}
        />


      </div>
      {/* The same dialog the quiz uses, carrying the task id and the version of
          the brief that was on screen. Reporting needs no account. */}
      {mode !== 'landing' && <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={async (reason, detail) => {
          await reportQuestion({
            questionId: task.id,
            reason,
            detail,
            contentVersion: task.review?.version,
          });
          setReportOpen(false);
        }}
      />}
    </div>
  );
}
