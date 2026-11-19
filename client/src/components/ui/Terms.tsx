// Contextual abbreviation help.
//
// One visible control per block of learner-facing content, listing the
// abbreviations that block actually contains. Activating a term opens its
// expansion and one plain sentence about what it means there.
//
// Why one control per block rather than an icon inside the prose:
//
//   * Answer options are buttons. An info button inside one would be a nested
//     interactive control, and pressing it would select the answer — the exact
//     failure the requirement names. A control beside the block never does.
//   * Code must not be touched. Injecting anything into a snippet changes what
//     the learner is reading and, in an editor, what they would run. The terms
//     bar sits next to the code and leaves it alone.
//   * Nothing here rewrites content. The terms are found by matching the
//     reviewed glossary against the text with word boundaries and exact case;
//     no string in the page is replaced, no HTML is generated from content.
//
// The help is neutral by construction: it is the same list for every option, so
// it can never coach one of them. If explaining an abbreviation would give a
// question away, the question is the thing to fix.

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { termsInAll, type GlossaryDomain, type GlossaryEntry } from '../../../../shared/glossary';
import './Terms.css';

/**
 * The abbreviations in one block of content, with an info button each.
 *
 * Pass every string the learner can see in that block — a question, all of its
 * options, its explanation — so one control covers the item.
 */
export function TermsBar({
  texts,
  domain,
  className,
}: {
  texts: readonly (string | undefined)[];
  /** The content's own topic, used to pick between senses of a term that has
   * more than one. Without it, an ambiguous term shows every sense. */
  domain?: GlossaryDomain;
  className?: string;
}) {
  const t = useT();
  const terms = termsInAll(texts, domain);
  if (terms.length === 0) return null;
  return (
    <div className={`ss-terms${className ? ` ${className}` : ''}`}>
      <span className="ss-terms__label">{t('terms.label')}</span>
      <ul className="ss-terms__list">
        {terms.map((entry) => (
          <li key={`${entry.term}-${entry.domains.join(',')}`}>
            <TermButton entry={entry} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One term: a real button with an accessible name, and a popover that closes
 * on Escape and returns focus where it came from. */
function TermButton({ entry }: { entry: GlossaryEntry }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    // A click anywhere else closes it. Pointerdown rather than click so a press
    // that starts outside does not first activate something inside.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const expansion = entry.expansion ? entry.expansion : null;
  const meaning = entry.meaning;

  return (
    <span className="ss-term">
      <button
        ref={buttonRef}
        type="button"
        className="ss-term__button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        // "Explain API" — the term is in the name, so a screen-reader user
        // browsing by button knows which one this is without reading around it.
        aria-label={t('terms.explain', { term: entry.term })}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden>{entry.term}</span>
        <span aria-hidden className="ss-term__glyph">i</span>
      </button>
      {open && (
        <div ref={popoverRef} id={id} role="note" className="ss-term__popover">
          <p className="ss-term__title">
            {entry.term}
            {expansion && <span className="ss-term__expansion"> · {expansion}</span>}
          </p>
          <p className="ss-term__meaning">{meaning}</p>
          {!entry.expansion && <p className="ss-term__note">{t('terms.notAnAcronym')}</p>}
        </div>
      )}
    </span>
  );
}
