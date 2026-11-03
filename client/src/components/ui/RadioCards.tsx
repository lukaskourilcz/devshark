// Exclusive single-choice option cards with real radio semantics.
//
// Astryx's SelectableCard renders a hidden <input type="checkbox"> as its
// accessible control, so screen readers announce "checkbox" and every option
// is its own Tab stop — wrong for one-of-N choices like quiz answers. This
// pair implements the WAI-ARIA radio-group pattern instead: role="radio" +
// aria-checked, a roving tabindex (the group is ONE Tab stop), and arrow-key
// navigation that moves focus and selection together.
//
// Visuals mirror SelectableCard (accent border + inset ring when selected,
// accent focus outline) via the .ss-radio-card rules in astryx-theme.css.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';

type RadioValue = string | number;

interface RadioCtx {
  selected: RadioValue | null;
  select: (value: RadioValue) => void;
  activate: (value: RadioValue) => void;
  register: (index: number, value: RadioValue, el: HTMLButtonElement | null, disabled: boolean, unavailable: boolean) => () => void;
  onKeyNav: (e: KeyboardEvent, index: number) => void;
}

const Ctx = createContext<RadioCtx | null>(null);

interface GroupProps {
  value: RadioValue | null;
  onChange: (value: RadioValue) => void;
  /**
   * Fired when an option is ACTIVATED — a pointer click or Enter/Space on the
   * focused card — as opposed to merely selected by arrow-key browsing. Lets
   * one-tap-commit flows (live Play answers) lock in on click while keyboard
   * users can still arrow through options without committing.
   */
  onActivate?: (value: RadioValue) => void;
  /** Accessible name of the group (or use labelledBy). */
  label?: string;
  labelledBy?: string;
  /**
   * Which arrow axis navigates options. Scoped (not 'both') on purpose: the
   * quiz binds Left/Right to previous/next QUESTION, so a vertical answer
   * list must leave the horizontal axis to the page.
   */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function RadioCardGroup({ value, onChange, onActivate, label, labelledBy, orientation = 'vertical', className, style, children }: GroupProps) {
  // Options register themselves under their `index` prop, so navigation order
  // is explicit and stable even when options render inside wrappers
  // (tooltips, motion items) that would obscure DOM order.
  const items = useRef(new Map<number, { value: RadioValue; el: HTMLButtonElement; disabled: boolean; unavailable: boolean }>());
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onActivateRef = useRef(onActivate);
  onActivateRef.current = onActivate;

  const ctx = useMemo<RadioCtx>(
    () => ({
      selected: value,
      select: (v) => onChangeRef.current(v),
      activate: (v) => onActivateRef.current?.(v),
      register: (index, v, el, disabled, unavailable) => {
        if (el) items.current.set(index, { value: v, el, disabled, unavailable });
        return () => {
          items.current.delete(index);
        };
      },
      onKeyNav: (e, index) => {
        const [nextKey, prevKey] =
          orientation === 'horizontal' ? (['ArrowRight', 'ArrowLeft'] as const) : (['ArrowDown', 'ArrowUp'] as const);
        const order = [...items.current.entries()]
          .filter(([, item]) => !item.disabled)
          .map(([itemIndex]) => itemIndex)
          .sort((a, b) => a - b);
        if (order.length === 0) return;
        const pos = order.indexOf(index);
        let nextPos: number | null = null;
        switch (e.key) {
          case nextKey:
            nextPos = (pos + 1) % order.length;
            break;
          case prevKey:
            nextPos = (pos - 1 + order.length) % order.length;
            break;
          case 'Home':
            nextPos = 0;
            break;
          case 'End':
            nextPos = order.length - 1;
            break;
          default:
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const target = items.current.get(order[nextPos]);
        if (!target) return;
        // Radio pattern: moving focus also selects.
        // A gated item can be browsed to hear its reason, but never selected.
        if (!target.unavailable) onChangeRef.current(target.value);
        target.el.focus();
      },
    }),
    [value, orientation],
  );

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-orientation={orientation}
      className={className}
      style={style}
    >
      <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
    </div>
  );
}

/**
 * Multi-select sibling of RadioCard: same .ss-radio-card visual language,
 * checkbox semantics (individually tabbable, aria-checked). Use it wherever
 * option cards toggle independently (e.g. quiz categories) so single- and
 * multi-select cards read as one system.
 */
export function CheckCard({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  padding = 3,
  className,
  style,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  label?: string;
  /** Ids of the visible name, when only part of the card names it. */
  labelledBy?: string;
  /** Ids of the card's other text, read after the name. */
  describedBy?: string;
  padding?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={className ? `ss-radio-card ${className}` : 'ss-radio-card'}
      data-selected={checked}
      onClick={onChange}
      style={{ padding: padding * 4, ...style }}
    >
      {children}
    </button>
  );
}

interface CardProps {
  value: RadioValue;
  /** Position in the group's navigation order (0-based, unique). */
  index: number;
  /** Accessible name; falls back to the visible children. */
  label?: string;
  /** Ids of the card's other text (a blurb, a Premium mark), read after the
   *  name: `label` replaces the children as the name, so without this a
   *  screen reader hears none of them. */
  describedBy?: string;
  /** Padding in 4px steps, matching Astryx spacing. */
  padding?: number;
  disabled?: boolean;
  /** Keep a gated choice available to arrow-key/focus inspection without
   * allowing selection or activation. Ordinary disabled choices still skip. */
  unavailable?: boolean;
  /** Explain a gated choice on a press without selecting or activating it. */
  onUnavailable?: (event: MouseEvent<HTMLButtonElement>) => void;
  /** 'success' paints the card green — e.g. revealing the correct answer;
   *  'error' marks a graded wrong pick (AnswerOptionList draws it). */
  tone?: 'default' | 'success' | 'error';
  width?: number | string;
  style?: CSSProperties;
  className?: string;
  /** Marks the card as gated content so stylesheets can style it distinctly
   *  from a merely inert `:disabled` card. */
  'data-locked'?: boolean;
  children: ReactNode;
}

export function RadioCard({ value, index, label, describedBy, padding = 3, disabled, unavailable, onUnavailable, tone = 'default', width, style, className, 'data-locked': dataLocked, children }: CardProps) {
  const ctx = useContext(Ctx);
  const ref = useRef<HTMLButtonElement>(null);
  if (!ctx) throw new Error('RadioCard must render inside RadioCardGroup');
  const { selected, select, activate, register, onKeyNav } = ctx;

  useEffect(() => register(index, value, ref.current, !!disabled, !!unavailable), [disabled, unavailable, index, value, register]);

  const isSelected = selected === value;
  // Roving tabindex: the selected option is the group's single Tab stop; with
  // nothing selected yet, the first option takes it.
  const tabbable = isSelected || (selected === null && index === 0);

  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      aria-disabled={unavailable || undefined}
      tabIndex={tabbable ? 0 : -1}
      className={className ? `ss-radio-card ${className}` : 'ss-radio-card'}
      data-selected={isSelected}
      data-tone={tone}
      data-locked={dataLocked || undefined}
      // A pointer click (or Enter/Space on the focused card) both selects and
      // activates; arrow-key browsing in onKeyNav only selects.
      onClick={(event) => {
        if (disabled) return;
        if (unavailable) { onUnavailable?.(event); return; }
        select(value);
        activate(value);
      }}
      onKeyDown={(e) => onKeyNav(e, index)}
      style={{ padding: padding * 4, width, ...style }}
    >
      {children}
    </button>
  );
}
