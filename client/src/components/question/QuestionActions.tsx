import { useEffect, useRef, type ReactNode } from 'react';
import { SwimCta } from '../landing/LandingKit';
import './question.css';

export interface QuestionPrimaryAction {
  label: string;
  onClick: () => void;
  /** Native disabled: busy, or nothing to act on. */
  disabled?: boolean;
  /** aria-disabled: stays focusable and pressable, and says why through describedBy. */
  unavailable?: boolean;
  describedBy?: string;
}

export interface QuestionActionsProps {
  /** The one filled primary on the screen, drawn as SwimCta md (44px) on the right. */
  primary?: QuestionPrimaryAction;
  /**
   * Secondary actions on the left (Previous, Exit, Share, Review answers):
   * Astryx `variant="secondary"` or `"ghost"` buttons at the default 44px.
   */
  secondary?: ReactNode;
  /** The current position, centred between the secondary and primary actions. */
  counter?: string;
  /**
   * When this turns true, focus moves to the primary: after grading, so the
   * next Tab or Enter continues (the Learn runner's Continue). The page
   * scrolls only as far as it takes to show the button, never to centre it,
   * and back up if that hid the shell's answer list.
   */
  focusPrimary?: boolean;
  /** Accessible name of the row, when a screen has more than one group of actions. */
  label?: string;
  className?: string;
}

/**
 * The one action row (UX audit U2, questions-05 and questions-18). 44px
 * controls: secondaries on the left, the one primary on the right. Under
 * 560px the primary is the last row at full width, in the thumb zone, and the
 * secondaries share a two-column row above it.
 */
export function QuestionActions({ primary, secondary, counter, focusPrimary, label, className }: QuestionActionsProps) {
  const primaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusPrimary) return;
    const button = primaryRef.current?.querySelector('button');
    // The least scroll that shows it, and never so far that the answers it
    // follows leave the screen: the pick and the right answer stay in sight
    // with the verdict. A plain focus() centred an off-screen button in
    // Chrome, which pushed every answer under the site header, at 1280 too
    // (UX audit learn-02).
    button?.focus({ preventScroll: true });
    button?.scrollIntoView?.({ block: 'nearest' });
    const shell = primaryRef.current?.closest('.ss-question');
    if (!shell?.classList.contains('ss-question--compact')) {
      shell?.querySelector<HTMLElement>('.ss-answer-list')?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [focusPrimary]);
  return (
    <div
      className={['ss-question-actions', counter && 'ss-question-actions--counted', className].filter(Boolean).join(' ')}
      role={label ? 'group' : undefined}
      aria-label={label}
    >
      <div className="ss-question-actions__secondary">{secondary}</div>
      {counter && <p className="ss-question-actions__counter">{counter}</p>}
      {primary && (
        <div className="ss-question-actions__primary" ref={primaryRef}>
          <SwimCta
            label={primary.label}
            onClick={primary.onClick}
            disabled={primary.disabled}
            unavailable={primary.unavailable}
            describedBy={primary.describedBy}
            size="md"
            dir={1}
          />
        </div>
      )}
    </div>
  );
}
