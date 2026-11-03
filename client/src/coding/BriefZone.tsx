// The brief at the top of a coding frame (UX audit coding-01). Its body is
// capped at about five lines, so the editor under it and the action bar at the
// pane's foot sit at the same place on every task, however long the prompt.
// A longer body scrolls inside the cap (a focusable region named by the task's
// title, with a fade at the bottom edge), and one text toggle lifts the cap.
// The coding workbench and a path's code activity both open with it, so a
// task looks the same wherever it opens.
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { workbenchCopy } from '../i18n/translations.workbench';
import './Coding.css';

export interface BriefZoneProps {
  /** The id of the task's heading, which names the scrolling body. */
  labelledBy?: string;
  /** The body's name where the task's heading is not part of the frame. */
  label?: string;
  /** The heading block: shown in full above the capped body. */
  head?: ReactNode;
  /** The prompt and what belongs with it: the part that is capped. */
  children: ReactNode;
  /** Shown under the body and never capped (a lock note, for one). */
  after?: ReactNode;
  /** A dedicated Description panel owns scrolling, so its brief needs no cap. */
  full?: boolean;
}

export function BriefZone({ labelledBy, label, head, children, after, full = false }: BriefZoneProps) {
  const bodyId = useId();
  const body = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measured, not guessed: a short brief gets no toggle and no fade, and a
  // brief that grows (a glossary term opened, earlier stages unfolded) gets
  // them as soon as it no longer fits. The full brief is measured too: inside
  // the frame it still stops where the editor's floor begins.
  // Subscribed once per cap state, not on every render: the workbench renders
  // on every keystroke, and re-measuring then would force a layout per key.
  // A child added or removed (a note appearing) is seen by the mutation
  // observer, a child growing (a term opened) by the resize observer.
  useLayoutEffect(() => {
    if (full) return;
    const node = body.current;
    if (!node) return;
    const measure = () => setOverflows(node.scrollHeight > node.clientHeight + 1);
    measure();
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const observeAll = () => {
      if (!resize) return;
      resize.disconnect();
      resize.observe(node);
      Array.from(node.children).forEach((child) => resize.observe(child));
    };
    observeAll();
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { observeAll(); measure(); });
    mutation?.observe(node, { childList: true });
    return () => { resize?.disconnect(); mutation?.disconnect(); };
  }, [expanded, full]);

  const capped = !full && !expanded;
  const scrolls = !full && overflows;
  const toggle = () => {
    if (expanded) {
      if (body.current) body.current.scrollTop = 0;
      // It overflowed the cap before it was lifted, so the toggle stays where
      // it is (and keeps focus) while the capped body is measured again.
      setOverflows(true);
    }
    setExpanded(!expanded);
  };

  return (
    <div className="cd-brief">
      {head}
      <div
        id={bodyId}
        ref={body}
        className="cd-brief__body"
        data-capped={capped}
        data-fade={scrolls || undefined}
        // Only a body that scrolls is a stop for the keyboard: it is the one
        // way to scroll it without a pointer.
        role={scrolls ? 'region' : undefined}
        aria-labelledby={scrolls ? labelledBy : undefined}
        aria-label={scrolls && !labelledBy ? label : undefined}
        tabIndex={scrolls ? 0 : undefined}
      >
        {children}
      </div>
      {!full && (overflows || expanded) && (
        <Button
          className="cd-brief__toggle"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={toggle}
          label={workbenchCopy(expanded ? 'coding.brief.showLess' : 'coding.brief.showFull')}
        />
      )}
      {after}
    </div>
  );
}
