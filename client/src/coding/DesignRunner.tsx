// System-design tasks have no editor. A guided walkthrough asks five
// questions in interview order; a drill asks one, in one of four formats.
// Answers are graded on the server against the key sealed in the session. The
// explanations and the correct options arrive with a passing verdict, never
// before and never with a failed one: that says only which answers were wrong.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Kicker } from '../components/landing/LandingKit';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { codingEn } from '../i18n/translations.codingRoute';
import { RadioCard, RadioCardGroup } from '../components/ui/RadioCards';
import { ApiError, friendlyError } from '../lib/api';
import { submitCoding } from './api';
import { difficultyOf, type PlayableCodingTask } from '../../../shared/coding-catalog';
import { DifficultyBadge } from './DifficultyBadge';
import type { CodingLockReason, CodingVerdictResponse, DesignAnswer } from '../../../shared/coding-api';
import './Coding.css';
import { Button } from '@astryxdesign/core/Button';
import { workbenchCopy } from '../i18n/translations.workbench';
import { openSignIn } from '../lib/signInDialog';

export interface DesignRunnerProps {
  task: PlayableCodingTask;
  session: string | null;
  locked: CodingLockReason | null;
  signedIn: boolean;
  mode: 'section' | 'lesson';
  onVerdict?: (verdict: CodingVerdictResponse) => void;
  onRetry?: () => void;
  nextHref?: string | null;
  backHref?: string;
  onContinue?: () => void;
}

/** One attempt per session. Try again opens a new session whose options come
 * back in a new order, so the answers, the verdict and "already checked" of
 * the last one must not carry over: an answer is an option's index, and the
 * same index names another option now. Keyed like the code puzzle. */
export function DesignRunner(props: DesignRunnerProps) {
  return <DesignAttempt key={`${props.task.id}:${props.session ?? ''}`} {...props} />;
}

function DesignAttempt({ task, session, locked, signedIn, mode, onVerdict, onRetry, nextHref, backHref, onContinue }: DesignRunnerProps) {
  const { t } = useLanguage(codingEn);
  const baseId = useId();
  const design = task.design;
  const drill = task.drill;
  const steps = design?.steps ?? [];
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<(DesignAnswer | null)[]>(() => steps.map(() => null));
  const [choice, setChoice] = useState<number | null>(null);
  const [estimate, setEstimate] = useState('');
  const [order, setOrder] = useState<number[]>(() => (drill?.steps ?? []).map((_, index) => index));
  const [verdict, setVerdict] = useState<CodingVerdictResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server already checked this session: a first check whose answer was
  // lost still used it up. Only a new attempt, opened again, can be checked.
  const [sessionUsed, setSessionUsed] = useState(false);
  const [moved, setMoved] = useState('');
  // A verdict that arrives after this attempt was left (a new session, another
  // task, another page) belongs to nothing on screen: it must not reach
  // `onVerdict`, which would record it against what the learner opened since.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  // Each question is its own keyed block, so Next and Previous are replaced
  // as they are pressed and focus fell to the page. It goes to the question
  // that opened instead, as in a skill check.
  const questionRef = useRef<HTMLHeadingElement>(null);
  const stepped = useRef(false);
  const goToStep = (to: number) => {
    stepped.current = true;
    setStepIndex(Math.max(0, Math.min(steps.length - 1, to)));
  };
  useEffect(() => {
    if (!stepped.current) return;
    stepped.current = false;
    questionRef.current?.focus();
  }, [stepIndex]);
  // The verdict replaces the questions and the Submit button with them, so
  // focus goes to the verdict, as on the code workbench.
  const verdictRef = useRef<HTMLElement>(null);
  useEffect(() => { if (verdict) verdictRef.current?.focus(); }, [verdict]);

  const answered = useMemo(() => answers.filter((one) => one !== null).length, [answers]);
  const drillAnswer = useMemo((): DesignAnswer | null => {
    if (!drill) return null;
    if (drill.format === 'estimate') {
      const value = Number(estimate.replace(/[\s,]/g, ''));
      return estimate.trim() !== '' && Number.isFinite(value) ? value : null;
    }
    if (drill.format === 'sequence') return order;
    return choice;
  }, [drill, estimate, order, choice]);

  const submit = useCallback(async () => {
    if (!session || submitting || sessionUsed) return;
    const payload: DesignAnswer[] = design ? answers.map((one) => (one ?? -1)) : drillAnswer !== null ? [drillAnswer] : [];
    if (design && answered < steps.length) return;
    if (!design && drillAnswer === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitCoding({ session, answers: payload });
      if (!live.current) return;
      setVerdict(result);
      onVerdict?.(result);
    } catch (caught) {
      if (!live.current) return;
      if (caught instanceof ApiError && caught.code === 'design_session_used') {
        setSessionUsed(true);
        setError(t('coding.design.sessionUsed'));
      } else {
        setError(caught instanceof ApiError && caught.code === 'invalid_session' ? t('coding.verdict.sessionExpired') : friendlyError(caught));
      }
    } finally {
      if (live.current) setSubmitting(false);
    }
  }, [session, submitting, sessionUsed, design, answers, answered, steps.length, drillAnswer, onVerdict, t]);

  // Each press is its own event, rendered before the next, so `order` is the
  // arrangement on screen.
  const moveButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusAfterMove = useRef<string | null>(null);
  const move = (from: number, direction: -1 | 1) => {
    const to = from + direction;
    if (!drill?.steps || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[from], next[to]] = [next[to], next[from]];
    setOrder(next);
    // Reordering is silent otherwise: say what moved and where it landed.
    setMoved(t('coding.design.moved', { step: drill.steps[next[to]], n: to + 1, total: next.length }));
    // A step moved down is re-inserted, which drops focus, and one that
    // reaches either end turns its own button off. Focus stays with the step:
    // on the same button while it still moves, on the other one at an end.
    const atEnd = direction === -1 ? to === 0 : to === next.length - 1;
    const way = (direction === -1) === atEnd ? 'down' : 'up';
    focusAfterMove.current = `${next[to]}:${way}`;
  };
  useEffect(() => {
    const key = focusAfterMove.current;
    focusAfterMove.current = null;
    if (key) moveButtons.current[key]?.focus();
  }, [order]);

  // Both views keep this header in the same position, so the learner's
  // first verdict updates the region already used for sequence moves.
  const verdictLabel = verdict && (
    verdict.verdict === 'passed' && verdict.xpForfeited === true ? t('coding.verdict.passedNoXp') : t(`coding.verdict.${verdict.verdict}` as never)
  );
  const header = (
    <div className="cd-pane__head">
      <span className="cd-visually-hidden" role="status" aria-live="polite">{verdictLabel ?? moved}</span>
      <Kicker>{t('coding.track.system-design')} · {design ? t('coding.design.step', { n: Math.min(stepIndex + 1, steps.length), total: steps.length }) : t(`coding.design.format.${drill?.format ?? 'tradeoff'}` as never)}</Kicker>
      <h2>{task.title}</h2>
      <div className="cd-pane__meta">
        <DifficultyBadge difficulty={difficultyOf(task)} />
        <span>{t('coding.minutes', { n: task.estimatedMinutes })}</span>
        {task.focus.map((tag) => <span key={tag} className="cd-tag">{tag}</span>)}
      </div>
    </div>
  );

  const verdictActions = verdict && (
    <div className="cd-verdict__actions">
      {verdict.verdict !== 'passed' && onRetry && <Button variant="secondary" onClick={onRetry} label={t('coding.design.tryAgain')} />}
      {verdict.verdict === 'passed' && mode === 'lesson' && onContinue && <Button variant="primary" onClick={onContinue} label={t('coding.lesson.continue')} />}
      {mode === 'section' && nextHref && <Button variant="primary" as={Link} href={nextHref} label={t('coding.verdict.next')} />}
      {mode === 'section' && backHref && <Button variant="secondary" as={Link} href={backHref} label={t('coding.verdict.back')} />}
    </div>
  );

  /** The learner's own answer to one step or drill, in words. */
  const answerText = (given: DesignAnswer | null, options: readonly string[]): ReactNode => {
    if (typeof given === 'number' && drill?.format === 'estimate') return `${given.toLocaleString('en')}${drill.unit ? ` ${drill.unit}` : ''}`;
    if (typeof given === 'number') return given >= 0 && options[given] ? options[given] : null;
    if (Array.isArray(given) && drill?.steps) {
      return <ol className="cd-review__explanation" style={{ paddingLeft: 20 }}>{given.map((position) => <li key={position}>{drill.steps![position]}</li>)}</ol>;
    }
    return null;
  };

  /* ── review after grading ─────────────────────────────────────────── */
  if (verdict) {
    const correct = verdict.design?.filter((one) => one.correct).length ?? 0;
    const passed = verdict.verdict === 'passed';
    return (
      <div className="cd-design">
        <section className="cd-pane">
          {header}
          <section className={`cd-verdict cd-verdict--${verdict.verdict}`} ref={verdictRef} tabIndex={-1}>
            <h3 className="cd-verdict__title">
              <span>{verdictLabel}</span>
              {verdict.xpAwarded > 0 && <span className="cd-verdict__xp">{t('coding.verdict.xp', { xp: verdict.xpAwarded })}</span>}
            </h3>
            {design && <p className="cd-verdict__row">{t('coding.design.score', { correct, total: steps.length })} · {t('coding.design.passMark', { n: design.passMark, total: steps.length })}</p>}
            {!passed && <p className="cd-verdict__row">{t('coding.design.failedNote')}</p>}
            {/* Signed out, the pass says it needs an account, with the way
                to get one (UX audit coding-10). */}
            {passed && !verdict.progress && (signedIn
              ? <p className="cd-verdict__row">{t('coding.verdict.notRecorded')}</p>
              : <p className="cd-verdict__row cd-verdict__signin">{t('coding.verdict.signIn')} <Button variant="secondary" aria-haspopup="dialog" onClick={() => openSignIn()} label={workbenchCopy('coding.verdict.signInAction')} /></p>)}
            {verdictActions}
          </section>
          <div className="cd-review">
            {(verdict.design ?? []).map((one, index) => {
              const step = steps[index];
              const options = step?.options ?? drill?.options ?? [];
              const given = one.given ?? (design ? answers[index] : drillAnswer);
              // Short of a pass the server sends which steps were right and
              // nothing of the key, so this says no more than that.
              if (!passed) {
                const answer = answerText(given, options);
                return (
                  <div key={index} className={`cd-review__step cd-review__step--${one.correct ? 'correct' : 'incorrect'}`}>
                    {step && <p className="cd-editor-label">{step.title}: {step.prompt}</p>}
                    <p className="cd-review__verdict">{one.correct ? t('coding.design.correct') : t('coding.design.incorrect')}</p>
                    {answer !== null && (Array.isArray(given)
                      ? <><p className="cd-review__explanation"><b>{t('coding.design.yourAnswer')}:</b></p>{answer}</>
                      : <p className="cd-review__explanation"><b>{t('coding.design.yourAnswer')}:</b> {answer}</p>)}
                  </div>
                );
              }
              return (
                <div key={index} className={`cd-review__step cd-review__step--${one.correct ? 'correct' : 'incorrect'}`}>
                  {step && <p className="cd-editor-label">{step.title}: {step.prompt}</p>}
                  <p className="cd-review__verdict">{one.correct ? t('coding.design.correct') : t('coding.design.incorrect')}</p>
                  {typeof one.correctIndex === 'number' && options[one.correctIndex] && (
                    <p className="cd-review__explanation"><b>{t('coding.design.correct')}:</b> {options[one.correctIndex]}{!one.correct && typeof given === 'number' && given >= 0 && options[given] ? <> · <span className="cd-result__label">{options[given]}</span></> : null}</p>
                  )}
                  {one.acceptedRange && <p className="cd-review__explanation">{t('coding.design.estimateRange', { min: one.acceptedRange.min.toLocaleString('en'), max: one.acceptedRange.max.toLocaleString('en'), answer: one.acceptedRange.answer.toLocaleString('en') })}</p>}
                  {one.correctOrder && drill?.steps && (
                    <ol className="cd-review__explanation" style={{ paddingLeft: 20 }}>
                      {one.correctOrder.map((position) => <li key={position}>{drill.steps![position]}</li>)}
                    </ol>
                  )}
                  {one.explanation && <p className="cd-review__explanation">{one.explanation}</p>}
                </div>
              );
            })}
          </div>
          {verdict.designReference && (
            <details>
              <summary className="cd-editor-label" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>{t('coding.design.reference')}</summary>
              <p className="cd-reference">{verdict.designReference}</p>
            </details>
          )}
        </section>
      </div>
    );
  }

  /* ── answering ───────────────────────────────────────────────────── */
  const current = steps[stepIndex];
  return (
    <div className="cd-design">
      <section className="cd-pane">
        {header}
        {locked && <p className="cd-note cd-note--warn">{t('coding.lockedTask')} {t(`coding.lock.${locked}` as never)}</p>}
        {design && (
          <details open={stepIndex === 0}>
            <summary className="cd-editor-label" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>{t('coding.design.brief')}</summary>
            <p className="cd-design__brief">{design.scenario}</p>
            <p className="cd-design__brief">{design.brief}</p>
          </details>
        )}
        {drill && (
          <>
            <p className="cd-design__brief">{drill.scenario}</p>
            <p className="cd-design__brief"><b>{drill.prompt}</b></p>
          </>
        )}

        {design && current && (
          <div className="cd-design__step" key={current.key}>
            <h3 id={`${baseId}-q`} ref={questionRef} tabIndex={-1} style={{ margin: 0 }}>{current.title}</h3>
            <p className="cd-design__brief">{current.prompt}</p>
            <RadioCardGroup value={answers[stepIndex] === null ? null : String(answers[stepIndex])} onChange={(value) => setAnswers((prev) => prev.map((one, i) => (i === stepIndex ? Number(value) : one)))} labelledBy={`${baseId}-q`}>
              {current.options.map((option, index) => (
                <RadioCard key={index} value={String(index)} index={index} label={option}>{option}</RadioCard>
              ))}
            </RadioCardGroup>
            <div className="cd-design__nav">
              <Button variant="secondary" onClick={() => goToStep(stepIndex - 1)} isDisabled={stepIndex === 0} label={t('coding.design.previous')} />
              {stepIndex < steps.length - 1
                ? <Button variant="primary" onClick={() => goToStep(stepIndex + 1)} isDisabled={answers[stepIndex] === null} label={t('coding.design.next')} />
                : <Button variant="primary" onClick={() => void submit()} isDisabled={!session || submitting || sessionUsed || answered < steps.length} label={submitting ? t('coding.submitting') : t('coding.design.submit')} />}
            </div>
          </div>
        )}

        {drill && (
          <div className="cd-design__step">
            {drill.format === 'estimate' && (
              <div className="cd-estimate">
                <label className="cd-editor-label" htmlFor={`${baseId}-estimate`}>{t('coding.design.estimatePlaceholder')}</label>
                <input id={`${baseId}-estimate`} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="0" />
                {drill.unit && <span>{drill.unit}</span>}
              </div>
            )}
            {(drill.format === 'tradeoff' || drill.format === 'bottleneck') && drill.options && (
              <RadioCardGroup value={choice === null ? null : String(choice)} onChange={(value) => setChoice(Number(value))} label={drill.prompt}>
                {drill.options.map((option, index) => (
                  <RadioCard key={index} value={String(index)} index={index} label={option}>{option}</RadioCard>
                ))}
              </RadioCardGroup>
            )}
            {drill.format === 'sequence' && drill.steps && (
              <>
                <p className="cd-editor-label">{t('coding.design.order')}</p>
                <ol className="cd-sequence">
                  {order.map((original, position) => (
                    <li key={original}>
                      <span className="cd-sequence__n">{position + 1}</span>
                      <span>{drill.steps![original]}</span>
                      <Button ref={(node) => { moveButtons.current[`${original}:up`] = node; }} variant="ghost" onClick={() => move(position, -1)} isDisabled={position === 0} label={`${t('coding.design.moveUp')}: ${drill.steps![original]}`}>↑</Button>
                      <Button ref={(node) => { moveButtons.current[`${original}:down`] = node; }} variant="ghost" onClick={() => move(position, 1)} isDisabled={position === order.length - 1} label={`${t('coding.design.moveDown')}: ${drill.steps![original]}`}>↓</Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            <div className="cd-design__nav">
              <Button variant="primary" onClick={() => void submit()} isDisabled={!session || submitting || sessionUsed || drillAnswer === null} label={submitting ? t('coding.submitting') : t('coding.design.submit')} />
            </div>
          </div>
        )}
        {error && <p className="cd-note cd-note--error" role="alert">{error}</p>}
        {sessionUsed && onRetry && (
          <div className="cd-verdict__actions">
            <Button variant="secondary" onClick={onRetry} label={t('coding.design.tryAgain')} />
          </div>
        )}
      </section>
    </div>
  );
}
