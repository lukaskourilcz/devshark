import { forwardRef, type ReactNode, type Ref } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { WaterlineProgress } from '../SharkFin';
import { CloseIcon } from '../ui/icons';
import { questionText as t } from '../../i18n/translations.question';
import './question.css';

/** Glyphs for the header's icon buttons: one stroke drawing, 20px. */
export const HintIcon = () => (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const ReportFlagIcon = () => (
  <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

export const ExitIcon = () => <CloseIcon size={20} />;

export interface QuestionIconButtonProps {
  /** Accessible name and tooltip. */
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  /** A toggle (the hint): aria-pressed. */
  pressed?: boolean;
  /** Leave out the tooltip when a popover already hangs from the button. */
  tooltip?: boolean;
}

/**
 * A 44×44 icon button for the QuestionHeader (hint, report, exit), with a
 * 20px glyph, its aria-label and a tooltip. Refs reach the native button, so
 * an Astryx Popover can hang from it.
 */
export const QuestionIconButton = forwardRef<HTMLButtonElement, QuestionIconButtonProps>(function QuestionIconButton(
  { label, icon, onClick, pressed, tooltip = true },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type="button"
      className="ss-question-icon-button"
      aria-label={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      onClick={onClick}
      style={{ width: 44, height: 44 }}
    >
      {icon}
    </button>
  );
  return tooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
});

export interface QuestionHeaderProps {
  /** The h1's own words, e.g. "Question 3 of 10" or "Level 1 · Values & Math". */
  title: ReactNode;
  /** Accessible heading when the question counter is shown in the footer. */
  titleLabel?: string;
  /** The run's name before the title ("Quiz"), set off by a middle dot. */
  run?: string;
  /** Focus target on the h1 (tabIndex -1), e.g. when a level opens. */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Progress through the run: 0–100 and the bar's accessible name. */
  progress?: { value: number; label: string };
  /** Run status on the right of the first row: timer, fins or hearts. */
  status?: ReactNode;
  /** Exit control beside the status on the first row. */
  exit?: ReactNode;
  /** Tags on the left of the second row: the CategoryTag, a level pill. */
  meta?: ReactNode;
  /** The question's difficulty (1–5); drawn as one neutral badge after the meta. */
  difficulty?: number;
  /** Icon buttons on the right of the second row: QuestionIconButton for hint, report, exit. */
  tools?: ReactNode;
}

/**
 * The one question header (UX audit U2, questions-09 and questions-19), inside
 * the shell's panel. Row 1: the run's h1 and progress on the left, run status
 * on the right. Row 2: tags and difficulty on the left, 44px icon buttons on
 * the right. The question text and code below then span the whole panel.
 */
export function QuestionHeader({ title, titleLabel, run, titleRef, progress, status, exit, meta, difficulty, tools }: QuestionHeaderProps) {
  const hasSecondRow = meta != null || difficulty != null || tools != null;
  return (
    <div className="ss-question-header">
      <div className="ss-question-header__row">
        <h1 className="ss-question-header__title" aria-label={titleLabel} ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
          {run && <span className="ss-question-header__run">{run} · </span>}
          {title}
        </h1>
        {progress && (
          <div className="ss-question-header__progress">
            <WaterlineProgress label={progress.label} value={progress.value} />
          </div>
        )}
        {status != null && <div className="ss-question-header__status">{status}</div>}
        {exit != null && <div className="ss-question-header__exit">{exit}</div>}
      </div>
      {hasSecondRow && (
        // A tag and the difficulty badge can wrap to two lines beside three
        // icon buttons on a phone ("JavaScript" did, "React" did not), which
        // moved the answers 10px from one question to the next; this row then
        // keeps two lines' height on every question (questions-06).
        <div className={meta != null && difficulty != null ? 'ss-question-header__row ss-question-header__row--tags' : 'ss-question-header__row'}>
          <div className="ss-question-header__meta">
            {meta}
            {difficulty != null && <Badge variant="neutral" label={t('question.difficultyLevel', { level: difficulty })} />}
          </div>
          {tools != null && <div className="ss-question-header__tools">{tools}</div>}
        </div>
      )}
    </div>
  );
}
