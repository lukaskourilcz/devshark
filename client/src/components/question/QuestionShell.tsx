import { forwardRef, useLayoutEffect, useRef, type ReactNode } from 'react';
import './question.css';

export interface QuestionShellProps {
  /** The QuestionHeader: h1, progress, status, tags and icon buttons. */
  header?: ReactNode;
  /** The question itself (text, code, notes). It sits in the stable block. */
  question: ReactNode;
  /** Id of the question block, so the answer list can name itself by it. */
  questionId: string;
  /** Focus target when a run starts or moves on: the block takes tabIndex -1. */
  focusable?: boolean;
  /**
   * true (default): the block keeps --ss-question-block-min (128px) and scrolls
   * past --ss-question-block-max (40vh), so the answers start at one y on every
   * question. false for a single question on its own page (Daily), where
   * nothing follows it.
   */
  stable?: boolean;
  /** An active run keeps the header and actions inside a viewport-sized card. */
  compact?: boolean;
  /** Reset the compact card's scroll position when a new item is shown. */
  contentKey?: string | number;
  /** Under the block, inside the panel: AnswerOptionList, QuestionHint, QuestionFeedback. */
  children?: ReactNode;
  /** The QuestionActions row, 16px under the panel. */
  actions?: ReactNode;
  /** Above the panel: a run's error banner. */
  notice?: ReactNode;
  /** Extra class on the root, for a runner's own hooks. */
  className?: string;
  /** Accessible name of the shell's region; defaults to the question block. */
  labelledBy?: string;
}

/**
 * One question screen (UX audit U2, questions-03 and questions-06): the
 * --ss-width-question (880px) column, one `.ss-panel` surface with no accent edge,
 * and a stable question block above the answers. Quiz, Challenge, Daily, the
 * Learn runner and Shark Cards render inside it instead of their own widths.
 * The ref is the question block, for moving focus to it.
 */
export const QuestionShell = forwardRef<HTMLDivElement, QuestionShellProps>(function QuestionShell(
  { header, question, questionId, focusable = true, stable = true, compact = false, contentKey, children, actions, notice, className, labelledBy },
  ref,
) {
  const scrollArea = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0;
  }, [questionId, contentKey]);
  const content = (
    <>
      <div
        id={questionId}
        ref={ref}
        tabIndex={focusable ? -1 : undefined}
        className="ss-question__block"
        data-stable={stable ? 'true' : 'false'}
      >
        {question}
      </div>
      {children != null && <div className="ss-question__body">{children}</div>}
    </>
  );
  return (
    <section className={['ss-question', compact && 'ss-question--compact', className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      {notice}
      <div className="ss-panel ss-question__panel">
        {header}
        {compact ? <div className="ss-question__content" ref={scrollArea}>{content}</div> : content}
        {compact && actions && <div className="ss-question__footer">{actions}</div>}
      </div>
      {!compact && actions}
    </section>
  );
});
