import { forwardRef, type ReactNode } from 'react';
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
  { header, question, questionId, focusable = true, stable = true, children, actions, notice, className, labelledBy },
  ref,
) {
  return (
    <section className={className ? `ss-question ${className}` : 'ss-question'} aria-labelledby={labelledBy}>
      {notice}
      <div className="ss-panel ss-question__panel">
        {header}
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
      </div>
      {actions}
    </section>
  );
});
