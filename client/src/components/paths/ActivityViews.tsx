// The four activity views a learning-path workspace can show: a lesson, an
// objective check, a code exercise and a written artifact.
//
// They are path-neutral on purpose — any published path renders the same
// components — and none of them decides anything. Each collects a submission, hands it to the server, and renders
// the verdict the server sent back.

import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ComplexityInfo } from '../../coding/CodingCompletion';
import { Breadcrumb, type BreadcrumbItem } from '../ui/Breadcrumb';
import { codingFilename } from '../../coding/filename';
import { waveVariantClass, waveVariantFor } from '../../lib/waveBank';
import { descriptionText } from '../../coding/description';
import { workbenchCopy } from '../../i18n/translations.workbench';
import { useT } from '../../i18n/LanguageContext';
import { beforeAccountChange } from '../../lib/accountData';
import { lazyShellPart } from '../../lib/routeRecovery';
import { loadEditor, loadedEditor } from '../../coding/loadEditor';
import ErrorRetry from '../ErrorRetry';
import { ShellPartBoundary } from '../ShellPartBoundary';
import { pathsEn as pathCopy } from '../../i18n/translations.paths';
import { LessonView, RichText } from '../learn/LessonBody';
import type {
  CheckQuestionPayload,
  CheckQuestionVerdict,
  CriterionResult,
  PathArtifactPayload,
  PathCodePayload,
  PathDraft,
  StartActivityResponse,
  SubmitActivityResponse,
} from '../../../../shared/learning-path-api';
import type { EvidenceState } from '../../../../shared/learning-paths';
import { Button } from '@astryxdesign/core/Button';
import { SwimCta } from '../landing/LandingKit';

/* ── shared bits ───────────────────────────────────────────────────────── */

export const STATE_GLYPH: Record<EvidenceState, string> = {
  not_started: '○',
  in_progress: '◐',
  verified_pass: '✓',
  self_reviewed: '✎',
  needs_revision: '↻',
};

/** The evidence state, always as a glyph plus words — never colour alone. */
export function StateBadge({ state }: { state: EvidenceState }) {
  const t = useT();
  return (
    <span className={`lp-state lp-state--${state}`}>
      <span className="lp-state__glyph" aria-hidden="true">
        {STATE_GLYPH[state]}
      </span>
      {t(`paths.state.${state}` as never)}
    </span>
  );
}

export function CriteriaList({ criteria }: { criteria: CriterionResult[] }) {
  const t = useT();
  if (criteria.length === 0) return null;
  return (
    <ul className="lp-criteria">
      {criteria.map((criterion) => (
        <li key={criterion.id} className={`lp-criterion lp-criterion--${criterion.passed ? 'passed' : 'failed'}`}>
          <span className="lp-criterion__mark" aria-hidden="true">
            {criterion.passed ? '✓' : '✗'}
          </span>
          <div className="lp-criterion__body">
            <span className="lp-criterion__label">
              {criterion.label}
              <span className="ss-sr-only">
                {' '}
                — {criterion.passed ? t('paths.criterion.passed') : t('paths.criterion.failed')}
              </span>
            </span>
            {criterion.critical && <span className="lp-criterion__critical">{t('paths.criterion.critical')}</span>}
            {!criterion.passed && criterion.detail && <p className="lp-criterion__detail">{criterion.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Feedback({ feedback }: { feedback: string[] }) {
  if (feedback.length === 0) return null;
  return (
    <div className="lp-notice lp-notice--info">
      <span className="lp-notice__glyph" aria-hidden="true">
        ℹ
      </span>
      <div>
        {feedback.map((entry, index) => (
          <p key={index} style={{ margin: index === 0 ? 0 : '8px 0 0' }}>
            {entry}
          </p>
        ))}
      </div>
    </div>
  );
}

/* ── lesson ────────────────────────────────────────────────────────────── */

export function LessonActivity({
  activity,
  onAcknowledge,
  busy,
  acknowledged,
}: {
  activity: StartActivityResponse;
  onAcknowledge: () => void;
  busy: boolean;
  acknowledged: boolean;
}) {
  const t = useT();
  if (!activity.lesson) return null;
  return (
    <div className="lp-workspace">
      <LessonView lesson={activity.lesson} />
      <div className="lp-actions">
        <span className="lp-actions__status">{t('paths.lesson.notGated')}</span>
        <Button variant="primary" onClick={onAcknowledge} isDisabled={busy || acknowledged} label={acknowledged ? t('paths.lesson.marked') : t('paths.lesson.markRead')} />
      </div>
    </div>
  );
}

/* ── objective check ───────────────────────────────────────────────────── */

export function CheckActivity({
  questions,
  scenario,
  passThreshold,
  domains,
  domainThreshold,
  result,
  onSubmit,
  onRetry,
  retryNeeded = false,
  busy,
}: {
  questions: CheckQuestionPayload[];
  /** A shared case the questions work through in order. Shown once, above
   * them, while answering and in the review alike. */
  scenario?: string;
  passThreshold: number;
  domains: string[] | undefined;
  /** The share each domain needs on its own, which the server lowers for a
   * domain with only a few questions. */
  domainThreshold?: number;
  result: SubmitActivityResponse | null;
  onSubmit: (answers: number[]) => void;
  /** Starts the check again: a new attempt deals the questions afresh. */
  onRetry: () => void;
  /** The attempt cannot take this submission (expired, or already graded), so
   * the way on is a new one rather than Submit. */
  retryNeeded?: boolean;
  busy: boolean;
}) {
  const t = useT();
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const groupName = useId();
  const scenarioId = useId();

  useEffect(() => {
    setAnswers(questions.map(() => null));
  }, [questions]);

  const verdicts = useMemo(() => {
    const map = new Map<string, CheckQuestionVerdict>();
    for (const verdict of result?.questions ?? []) map.set(verdict.questionId, verdict);
    return map;
  }, [result]);

  const answered = answers.filter((one) => one !== null).length;
  const graded = verdicts.size > 0;

  return (
    // Its own class: sharing the picker's checkbox-label class dimmed the
    // whole check once its radios were disabled.
    <div className="lp-check-view" data-activity="active">
      <div className="lp-notice">
        <span className="lp-notice__glyph" aria-hidden="true">
          ◉
        </span>
        <span>
          {t('paths.check.threshold', { percent: Math.round(passThreshold * 100) })}
          {domains?.length ? ` ${t('paths.check.domainGate', { percent: Math.round((domainThreshold ?? passThreshold) * 100) })}` : ''}
        </span>
      </div>

      {/* One named region, not a description on every question, so a screen
          reader reads the case once and the learner can return to it. */}
      {scenario !== undefined && (
        <section className="lp-brief lp-card" aria-labelledby={scenarioId}>
          <h3 id={scenarioId}>{pathCopy['paths.check.scenarioTitle']}</h3>
          <RichText text={scenario} />
        </section>
      )}

      {questions.map((question, index) => {
        const verdict = verdicts.get(question.id);
        return (
          <fieldset key={question.id} className="lp-question" style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="lp-question__prompt">
              {t('paths.check.questionNumber', { current: index + 1, total: questions.length })} — {question.prompt}
            </legend>
            {question.context && (
              <pre className="lp-question__context">
                <code>{question.context.code}</code>
              </pre>
            )}
            <div className="lp-options">
              {question.options.map((option, optionIndex) => {
                const chosen = answers[index] === optionIndex;
                // After a failed project check the server names only the
                // questions that were wrong, so the one option known to be
                // right is the learner's own right answer.
                const isCorrect = verdict && (verdict.correctIndex === undefined
                  ? chosen && verdict.correct
                  : verdict.correctIndex === optionIndex);
                const isWrongChoice = verdict && chosen && !verdict.correct;
                const className = [
                  'lp-option',
                  chosen && !graded ? 'lp-option--chosen' : '',
                  isCorrect ? 'lp-option--correct' : '',
                  isWrongChoice ? 'lp-option--wrong' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <label key={optionIndex} className={className}>
                    <input
                      type="radio"
                      name={`${groupName}-${index}`}
                      checked={chosen}
                      disabled={graded || busy}
                      onChange={() =>
                        setAnswers((current) => current.map((one, position) => (position === index ? optionIndex : one)))
                      }
                    />
                    <span>
                      {graded && (isCorrect || isWrongChoice) ? (
                        <span className="lp-option__mark" aria-hidden="true">
                          {isCorrect ? '✓ ' : '✗ '}
                        </span>
                      ) : null}
                      {option}
                      {graded && isCorrect && <span className="ss-sr-only"> — {t('paths.check.correctAnswer')}</span>}
                      {graded && isWrongChoice && <span className="ss-sr-only"> — {t('paths.check.yourAnswer')}</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            {verdict?.explanation && <p className="lp-explanation">{verdict.explanation}</p>}
            {verdict && !verdict.explanation && !verdict.correct && (
              <p className="lp-explanation">{t('paths.check.answerWithheld')}</p>
            )}
          </fieldset>
        );
      })}

      {graded || retryNeeded ? (
        // A graded check is retried as a new attempt, as often as the learner
        // likes; the threshold note above says so.
        <div className="lp-actions">
          <Button variant={graded ? 'secondary' : 'primary'} isDisabled={busy} onClick={onRetry} label={t('error.tryAgain')} />
        </div>
      ) : (
        <div className="lp-actions">
          <span className="lp-actions__status">
            {t('paths.check.answered', { answered, total: questions.length })}
          </span>
          <Button variant="primary" isDisabled={busy || answered < questions.length} onClick={() => onSubmit(answers.map((one) => one ?? 0))} label={busy ? t('paths.action.submitting') : t('paths.action.submit')} />
        </div>
      )}
    </div>
  );
}

/* ── code exercise ─────────────────────────────────────────────────────── */

// The editor (CodeMirror) loads when a code exercise opens, not with the
// path overview and module pages, which never show it. Its own boundary keeps
// the activity standing when its code does not load. The workspace starts the
// load as soon as the catalogue says the open activity is code, beside the
// activity's start (#587 paths walk), and an editor already in is drawn at
// once rather than through Suspense, whose reveal React holds back for up to
// 300 ms after the brief (as the workbench's EditorPart does).
const LazyEditor = lazyShellPart(() => loadEditor().then((Editor) => ({ default: Editor })));

const DRAFT_DEBOUNCE_MS = 900;
const focusOnMount = (node: HTMLButtonElement | null) => { node?.focus(); };
export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict' | 'offline';

/**
 * The autosave debounce. What is still waiting when the view unmounts is sent
 * rather than dropped: typing and then following a link within the debounce
 * used to lose those last keystrokes. The workspace forgets an activity's
 * draft channel before it swaps the view, so a late send never lands on the
 * next activity.
 */
function useDraftQueue<T>(send: (value: T) => void): (value: T) => void {
  const timer = useRef<number | null>(null);
  const pending = useRef<{ value: T } | null>(null);
  const latest = useRef(send);
  useEffect(() => {
    latest.current = send;
  });
  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const waiting = pending.current;
    pending.current = null;
    if (waiting) latest.current(waiting.value);
  }, []);
  useEffect(() => flush, [flush]);
  // A sign-out writes what waits first, so the device copy it keeps for the
  // account (lib/accountData.ts) holds the last keystrokes too.
  useEffect(() => beforeAccountChange(flush), [flush]);
  return useCallback(
    (value: T) => {
      pending.current = { value };
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, DRAFT_DEBOUNCE_MS);
    },
    [flush],
  );
}

export function CodeActivity({
  code,
  title = 'Code exercise',
  ancestry = [],
  onClose,
  titleRef,
  fixtureNote,
  draft,
  result,
  onSubmit,
  onDraft,
  draftStatus,
  busy,
  submitBlocked = false,
}: {
  code: PathCodePayload;
  title?: string;
  ancestry?: BreadcrumbItem[];
  onClose?: () => void;
  titleRef?: React.Ref<HTMLHeadingElement>;
  /** Says the fixture is deliberately unfamiliar and what "done" means.
   * Shown above the editor. */
  fixtureNote?: string;
  draft: PathDraft | null;
  result: SubmitActivityResponse | null;
  onSubmit: (source: string) => void;
  onDraft: (source: string) => void;
  draftStatus: DraftStatus;
  busy: boolean;
  submitBlocked?: boolean;
}) {
  const t = useT();
  // Decided once per mount, so the editor never swaps one tree for the other.
  const [Editor] = useState(() => loadedEditor() ?? LazyEditor);
  const [source, setSource] = useState<string>(() => (typeof draft?.content.code === 'string' ? draft.content.code : code.starter));
  const [hintsShown, setHintsShown] = useState(0);
  const queueDraft = useDraftQueue(onDraft);
  // Reset replaces the learner's code, and the autosave then writes the
  // starter over their draft, so it asks first, as the coding workbench does.
  const [confirmingReset, setConfirmingReset] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  // The confirmed Reset leaves with its question, so focus goes back to the
  // Reset that asked rather than to the page.
  const reset = () => {
    setConfirmingReset(false);
    setSource(code.starter);
    queueDraft(code.starter);
    resetButton.current?.focus();
  };
  // Keeping the code, by the button or by Escape, hands focus back to Reset.
  const keepCode = () => {
    setConfirmingReset(false);
    resetButton.current?.focus();
  };
  const onConfirmKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    keepCode();
  };
  // A revealed rung takes focus, so a screen reader reads it and the last
  // press, whose button then disappears, does not drop focus to the page.
  const ladderList = useRef<HTMLOListElement>(null);
  const revealed = useRef(false);
  useEffect(() => {
    if (!revealed.current) return;
    revealed.current = false;
    (ladderList.current?.lastElementChild as HTMLElement | null)?.focus();
  }, [hintsShown]);

  const hints = code.hints;
  const approach = code.approach ?? [];
  const contract = code.contract ?? [];
  // The ladder is hints, then the approach steps, then the skeleton. The
  // reference implementation is not part of it: a path exercise has no reveal.
  const ladder = useMemo(
    () => [...hints.map((text) => ({ kind: 'hint' as const, text })), ...approach.map((text) => ({ kind: 'approach' as const, text }))],
    [hints, approach],
  );

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (titleRef) headingRef.current?.focus(); }, [titleRef]);
  const [tab, setTab] = useState<'description' | 'results' | 'console'>('description');
  const tabId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = ['description', 'results', 'console'] as const;
  useEffect(() => { if (result) setTab('results'); }, [result]);
  const verdict = result?.code ?? null;
  const submitUnavailable = busy || submitBlocked || source.trim().length === 0;

  // The same frame as the coding workbench (UX audit coding-03): from 1024px
  // the code pane (a capped brief, the editor filling the rest, the actions
  // at its foot) and the pane beside it share the workbench's columns and its
  // viewport-tall row, and the editor starts at the shared --cd-editor-min.
  // ss-wide-page widens the route box to the wide page while it is mounted.
  return (
    <div className="cd-page cd-workbench cd-workbench--activity ss-wide-page">
      <h1 className="ss-sr-only" ref={node => { headingRef.current = node; if (typeof titleRef === 'function') titleRef(node); else if (titleRef) titleRef.current = node; }} tabIndex={-1}>{title}</h1>
      <div className="cd-workbench__grid">
        <div className="cd-pane cd-pane--editor">
          <div className="cd-editor-bar ss-compact">
            <Breadcrumb className="cd-editor-bar__path" items={[...ancestry, { label: codingFilename({ id: 'path-activity', title, track: code.language === 'typescript' ? 'typescript' : 'javascript' }) }]} />
            {onClose && <Button variant="ghost" onClick={onClose} label={t('paths.action.close')} />}
            <Button variant="ghost" ref={resetButton} onClick={() => (source === code.starter ? reset() : setConfirmingReset(true))} isDisabled={busy} label={t('paths.code.reset')} />
          </div>

          <div className="cd-editor-slot">
            <Suspense fallback={<div className="cd-note" role="status" style={{ minHeight: 'var(--cd-editor-min, 280px)' }}>{t('common.loading')}</div>}>
              <ShellPartBoundary fallback={(retry, retrying) => <ErrorRetry message={t('coding.loadError')} onRetry={retry} busy={retrying} />}>
                <Editor
                  value={source}
                  onChange={(next) => {
                    setSource(next);
                    queueDraft(next);
                  }}
                  track={code.language === 'typescript' ? 'typescript' : code.language === 'react' ? 'react' : 'javascript'}
                  ariaLabel={t('paths.code.editorLabel')}
                  readOnly={busy}
                  fill
                />
              </ShellPartBoundary>
            </Suspense>
          </div>

          <div className="cd-editor-actions">
            <div className="cd-actions cd-actions--commands">
              {/* Submit is the coding frame's one filled primary, SwimCta md,
                  as in the coding workbench (UX audit coding-02, coding-03).
                  Unavailable, not disabled: the pressed button keeps focus
                  while the submission is busy, and a press then does nothing. */}
              <SwimCta dir={1} onClick={() => { if (!submitUnavailable) onSubmit(source); }} unavailable={submitUnavailable} label={busy ? t('paths.action.submitting') : t('paths.action.submit')} />
              {ladder.length > 0 && <Button variant="ghost" label={t('coding.hint')} onClick={() => { setTab('description'); revealed.current = true; setHintsShown(n => Math.min(n + 1, ladder.length)); }} /> }
              <span className="lp-actions__status cd-actions--utility" aria-live="polite">
                {t(`paths.draft.${draftStatus}` as never)}
              </span>
            </div>
          </div>
        </div>

        {confirmingReset && (
          <div className="cd-pane cd-pane--controls">
            <div className="cd-note cd-note--warn" role="alertdialog" aria-label={t('paths.code.reset')} onKeyDown={onConfirmKeyDown}>
              <p style={{ margin: '0 0 8px' }}>{t('coding.resetConfirm')}</p>
              <div className="cd-actions">
                <Button variant="primary" onClick={reset} label={t('coding.reset')} />
                <Button variant="secondary" onClick={keepCode} ref={focusOnMount} label={t('coding.resetCancel')} />
              </div>
            </div>
          </div>
        )}

        {/* What the brief allows, the hint ladder and what a submission
            showed, beside the code; it scrolls inside the frame. */}
        <div className="cd-pane cd-pane--output">
          <div className="cd-tabs" role="tablist" aria-label={workbenchCopy('coding.output.label')} onKeyDown={event => {
            const index = tabs.indexOf(tab);
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); setTab(tabs[next]); tabRefs.current[next]?.focus();
          }}>
            {tabs.map((key, index) => <button key={key} type="button" role="tab" id={`${tabId}-tab-${key}`} aria-controls={`${tabId}-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} ref={node => { tabRefs.current[index] = node; }} className={`cd-tab ${waveVariantClass(waveVariantFor(`${tabId}-${index}`))}`} onClick={() => setTab(key)}>{key === 'description' ? workbenchCopy('coding.tab.description') : t(key === 'results' ? 'coding.tab.results' : 'coding.tab.console')}</button>)}
          </div>
          <div className="cd-output-scroll">
            <section role="tabpanel" id={`${tabId}-panel-description`} aria-labelledby={`${tabId}-tab-description`} tabIndex={0} hidden={tab !== 'description'}>
              <h2 className="cd-brief__title">{title}</h2>
              <div className="lp-brief cd-prompt"><RichText text={descriptionText(code.prompt)} /></div>
              {fixtureNote && <div className="lp-notice lp-notice--info"><div><strong>{pathCopy['paths.code.fixtureNoteTitle']}</strong><RichText text={fixtureNote} /></div></div>}
            {contract.length > 0 && (
              <section className="lp-section">
                <h3>{t('paths.code.contract')}</h3>
                <ul className="lp-list">
                  {contract.map((entry, index) => (
                    <li key={index}>{entry}</li>
                  ))}
                </ul>
              </section>
            )}
            {ladder.length > 0 && (
              <section className="lp-section">
                <h3>{t('paths.code.hints')}</h3>
                <ol className="lp-list" ref={ladderList}>
                  {ladder.slice(0, hintsShown).map((rung, index) => (
                    <li key={index} tabIndex={-1}>{rung.text}</li>
                  ))}
                </ol>
                {code.skeleton && hintsShown >= ladder.length && (
                  <details>
                    <summary>{t('paths.code.skeleton')}</summary>
                    <pre className="lp-question__context">
                      <code>{code.skeleton}</code>
                    </pre>
                  </details>
                )}
              </section>
            )}

            {code.tests && code.tests.length > 0 && (
              <section className="lp-section">
                <h3>{t('paths.code.visibleTests')}</h3>
                <ul className="lp-results">
                  {code.tests.map((test, index) => {
                    const outcome = verdict?.results[index];
                    return (
                      <li key={index} className="lp-result">
                        <span className="lp-result__mark" aria-hidden="true">
                          {outcome ? (outcome.pass ? '✓' : '✗') : '·'}
                        </span>
                        <code>{test.call}</code>
                        {test.label && <span>— {test.label}</span>}
                        {outcome && (
                          <span className="ss-sr-only">
                            {outcome.pass ? t('paths.code.testPassed') : t('paths.code.testFailed')}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {verdict?.hidden && (
                  <p className="lp-field__help">
                    {t('paths.code.hiddenTests', { passed: verdict.hidden.passed, total: verdict.hidden.total })}
                  </p>
                )}
              </section>
            )}

              {code.complexityGuidance?.targetTime && <div className="cd-complexity"><span>{t('coding.complexity.desired', { complexity: code.complexityGuidance.targetTime })}</span><ComplexityInfo guidance={code.complexityGuidance} /></div>}
            </section>
            <section role="tabpanel" id={`${tabId}-panel-results`} aria-labelledby={`${tabId}-tab-results`} tabIndex={0} hidden={tab !== 'results'}>
              {result ? <><StateBadge state={result.state} />{result.code && <CriteriaList criteria={result.criteria} />}</> : <p className="cd-note">{pathCopy['paths.code.submitToSee']}</p>}
            {verdict?.codeError && (
              <div className="lp-notice lp-notice--error">
                <span className="lp-notice__glyph" aria-hidden="true">
                  !
                </span>
                <span>{verdict.codeError}</span>
              </div>
            )}
            </section>
            <section role="tabpanel" id={`${tabId}-panel-console`} aria-labelledby={`${tabId}-tab-console`} tabIndex={0} hidden={tab !== 'console'}>
              <pre className="lp-console">{verdict?.logs.join('\n') || pathCopy['paths.code.submitToSee']}</pre>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── written artifact ──────────────────────────────────────────────────── */

/** A field's length as the server measures it against `maxLength`
 * (the server artifact grader, grade.ts): the trimmed text, or a list's trimmed,
 * non-empty lines joined by newlines. Counting the raw box instead flagged
 * blank lines and trailing spaces the server never sees. */
function artifactFieldLength(kind: PathArtifactPayload['fields'][number]['kind'], raw: string): number {
  if (kind !== 'list') return raw.trim().length;
  return raw.split('\n').map((one) => one.trim()).filter(Boolean).join('\n').length;
}

export function ArtifactActivity({
  artifact,
  rubric,
  draft,
  result,
  onSubmit,
  onDraft,
  draftStatus,
  busy,
}: {
  artifact: PathArtifactPayload;
  rubric: { id: string; title: string; levels: Record<string, string> }[];
  draft: PathDraft | null;
  result: SubmitActivityResponse | null;
  onSubmit: (values: Record<string, string | string[]>) => void;
  onDraft: (values: Record<string, string | string[]>) => void;
  draftStatus: DraftStatus;
  busy: boolean;
}) {
  const t = useT();
  // Read once: every autosave hands down a new draft, and the boxes keep what
  // the learner is typing rather than the copy the server echoes back.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const saved = (draft?.content.artifact ?? {}) as Record<string, string | string[]>;
    const out: Record<string, string> = {};
    for (const field of artifact.fields) {
      const value = saved[field.id];
      out[field.id] = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
    }
    return out;
  });

  const shaped = useCallback(
    (next: Record<string, string>): Record<string, string | string[]> => {
      const out: Record<string, string | string[]> = {};
      for (const field of artifact.fields) {
        const raw = next[field.id] ?? '';
        out[field.id] = field.kind === 'list' ? raw.split('\n').map((one) => one.trim()).filter(Boolean) : raw;
      }
      return out;
    },
    [artifact.fields],
  );

  // Shaped when it is sent, not on every keystroke.
  const queueDraft = useDraftQueue((next: Record<string, string>) => onDraft(shaped(next)));
  const change = (id: string, value: string) => {
    const next = { ...values, [id]: value };
    setValues(next);
    queueDraft(next);
  };

  // A field over its cap fails the server's check and records the attempt as
  // needing revision, so it is not sent: focus goes to the first such field,
  // whose description carries the count that says why.
  const submit = () => {
    const over = artifact.fields.find((field) => artifactFieldLength(field.kind, values[field.id] ?? '') > field.maxLength);
    if (over) {
      document.getElementById(`lp-field-${over.id}`)?.focus();
      return;
    }
    onSubmit(shaped(values));
  };

  return (
    <div className="lp-split" data-activity="active">
      <div className="lp-split__brief">
        <div className="lp-brief lp-card">
          <RichText text={artifact.brief} />
          <div className="lp-notice lp-notice--info">
            <span className="lp-notice__glyph" aria-hidden="true">
              ✎
            </span>
            <span>{t('paths.artifact.selfReviewed')}</span>
          </div>
          {rubric.length > 0 && (
            <section className="lp-section">
              <h3>{t('paths.artifact.rubric')}</h3>
              <div className="lp-rubric">
                {rubric.map((dimension) => (
                  <div key={dimension.id} className="lp-rubric__dimension">
                    <strong>{dimension.title}</strong>
                    <dl className="lp-rubric__levels">
                      {(['missing', 'partial', 'adequate', 'strong'] as const).map((level) => (
                        <div key={level} style={{ display: 'contents' }}>
                          <dt>{t(`paths.rubric.${level}` as never)}</dt>
                          <dd>{dimension.levels[level]}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <div className="lp-work">
        <div className="lp-actions">
          <span className="lp-actions__status" aria-live="polite">
            {t(`paths.draft.${draftStatus}` as never)}
          </span>
          <Button variant="primary" onClick={submit} isDisabled={busy} label={busy ? t('paths.action.submitting') : t('paths.action.submit')} />
        </div>

        <div className="lp-fields">
          {artifact.fields.map((field) => {
            const value = values[field.id] ?? '';
            const used = artifactFieldLength(field.kind, value);
            const over = used > field.maxLength;
            const describedBy = `lp-help-${field.id} lp-count-${field.id}`;
            const failed = result?.criteria.find((one) => one.id === `field:${field.id}` && !one.passed);
            return (
              <div key={field.id} className="lp-field">
                <label className="lp-field__label" htmlFor={`lp-field-${field.id}`}>
                  {field.label}
                  {!field.required && <span className="lp-criterion__critical">{t('paths.artifact.optional')}</span>}
                </label>
                <p className="lp-field__help" id={`lp-help-${field.id}`}>
                  {field.help}
                </p>
                {field.kind === 'long-text' || field.kind === 'list' ? (
                  <textarea
                    id={`lp-field-${field.id}`}
                    aria-describedby={describedBy}
                    aria-invalid={over || undefined}
                    value={value}
                    onChange={(event) => change(field.id, event.target.value)}
                    rows={field.kind === 'list' ? 6 : 10}
                    disabled={busy}
                  />
                ) : (
                  <input
                    id={`lp-field-${field.id}`}
                    aria-describedby={describedBy}
                    aria-invalid={over || undefined}
                    type={field.kind === 'url' ? 'url' : 'text'}
                    value={value}
                    onChange={(event) => change(field.id, event.target.value)}
                    disabled={busy}
                  />
                )}
                <span id={`lp-count-${field.id}`} className={`lp-field__count${over ? ' lp-field__count--over' : ''}`}>
                  {t('paths.artifact.count', { used, max: field.maxLength })}
                </span>
                {failed?.detail && <p className="lp-field__help">{failed.detail}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
