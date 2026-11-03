// Shared primitives for the editorial "Deep End v2" landing: the kicker, fins,
// stat tiles, fade-in / swim-through CTAs and the interactive sample-question
// card all live here and re-skin from var(--brand-accent).
//
// See DESIGN_RULES.md for the fin-baseline, fade-in-only and accent rules these
// implement.

import { forwardRef, useEffect, useRef, useState, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';
import { generateFinHover, finHoverStyle, type FinHoverAnimation } from '../../lib/finHover';
import { useWaveVariant } from '../../lib/waveBank';
import { useT } from '../../i18n/LanguageContext';
import { useReducedMotion } from '../../lib/motion';
import { TrophyIcon } from '../ui/icons';

// The fin glyph path, base at y=18 in a 24-unit box (see DESIGN_RULES §1).
export const FIN_PATH = 'M3 18 Q 6 6 15 3 Q 17 11 21 18 Z';

/** Editorial kicker: uppercase accent label with a waterline tick beneath. */
/**
 * The editorial kicker: a small uppercase label with its waterline tick.
 *
 * Every kicker in the product goes through here, which is what lets each one
 * carry its own wave from the shared bank instead of the same tile repeated
 * down the page. `variant` pins one for a preview or a test; `as` renders a
 * heading where the kicker is one.
 */
export function Kicker({
  children,
  center,
  as: Tag = 'span',
  className,
  variant,
  elementRef,
  ...rest
}: {
  children: ReactNode;
  center?: boolean;
  as?: 'span' | 'h1' | 'h2' | 'h3';
  className?: string;
  variant?: number;
  /** Forwarded to the rendered element — the GitHub garden heading is a scroll
   * anchor, so it needs one. */
  elementRef?: Ref<HTMLElement>;
} & Omit<ComponentPropsWithoutRef<'span'>, 'className' | 'children'>) {
  const wave = useWaveVariant(variant);
  return (
    <Tag
      ref={elementRef as never}
      className={`ss-kicker ${wave}${center ? ' ss-kicker--center' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** The full-width waterline rule, with its own wave from the same bank. */
export function WaterlineRule({ width, variant }: { width?: number | string; variant?: number }) {
  const wave = useWaveVariant(variant);
  return <div aria-hidden className={`ss-waterline-rule ${wave}`} style={width === undefined ? undefined : { width }} />;
}

/** A raw fin SVG (fades/swims as a positioned child). */
export function Fin({ size, color = 'var(--brand-accent)', opacity = 1 }: { size: number; color?: string; opacity?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d={FIN_PATH} fill={color} fillOpacity={opacity} />
    </svg>
  );
}

export interface StatSpec { value: string; label: string; }

/** A hero stat: a figure and what it counts. It is not interactive, so it
 * does not answer hover (design audit P1.4). */
export function StatItem({ value, label }: StatSpec) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontFamily: 'var(--font-family-heading)', fontWeight: 800, fontSize: '1.5rem', letterSpacing: '-0.015em' }}>{value}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-secondary)' }}>{label}</span>
    </div>
  );
}

/** A CTA whose fin fades in on hover (no drift — see DESIGN_RULES §3). */
export function FadeFinCta({
  label, primary, onClick, finLeft, finSize, accent, disabled, ariaLabel,
}: {
  label: string; primary?: boolean; onClick: () => void; finLeft: string; finSize: number; accent: string; disabled?: boolean; ariaLabel?: string;
}) {
  const [hover, setHover] = useState(false);
  const reduce = useReducedMotion();
  return (
    <button
      type="button" className="ss-fin-button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      style={{
        position: 'relative', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        // One longhand only. Pairing the `background` shorthand with a
        // `backgroundColor` longhand in the same object made React clear the
        // shorthand's colour on re-render, so the primary CTA rendered on the
        // UA's default grey under its white label — unreadable.
        backgroundColor: primary
          ? 'var(--brand-accent)'
          : hover ? 'var(--color-background-muted)' : 'var(--color-background-surface)',
        color: primary ? 'var(--brand-on-accent)' : 'var(--color-text-primary)',
        border: primary ? 'none' : '1px solid var(--ss-card-edge)',
        borderRadius: 'var(--radius-element)', padding: '12px 22px', minHeight: 44,
        fontFamily: 'var(--font-family-body)', fontWeight: 600, fontSize: '1rem', cursor: disabled ? 'wait' : 'pointer', opacity: disabled ? 0.62 : 1,
        filter: hover && primary ? 'brightness(0.92)' : 'none',
        transition: reduce ? 'none' : 'filter 0.2s ease, background-color 0.2s ease',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: finLeft, bottom: Math.round(finSize * -0.25) + 'px', lineHeight: 0, opacity: hover ? 1 : 0, transition: reduce ? 'none' : 'opacity 0.35s ease', pointerEvents: 'none' }}>
        <Fin size={finSize} color={primary ? 'var(--brand-on-accent)' : accent} opacity={primary ? 0.35 : 0.22} />
      </span>
      <span style={{ position: 'relative' }}>{label}</span>
    </button>
  );
}

/** Shared decoration: the fin is clipped behind the label and never takes input. */
function FinHover({ animation }: { animation: FinHoverAnimation }) {
  return <span className="ss-fin-hover" aria-hidden="true"><span className="ss-fin-hover__swimmer"><Fin size={animation.size} color="currentColor" opacity={animation.shade} /></span></span>;
}

export const FinButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(function FinButton({children, className = '', style, ...props}, ref) {
  const [animation] = useState(() => generateFinHover());
  return <button {...props} ref={ref} className={`ss-fin-button ${className}`} style={{...finHoverStyle(animation),...style}}>
    <FinHover animation={animation} /><span className="ss-fin-button__label">{children}</span>
  </button>;
});

/**
 * Homepage-style fin effects with a stable randomized profile for each button.
 * `unavailable` looks and reads disabled (aria-disabled) but keeps the button
 * focusable and pressable, so the press can say why (the Quiz start, which
 * names the missing category in `describedBy`). `type="submit"` makes it the
 * submit button of the form around it, which then needs no `onClick`.
 */
export function SwimCta({ label, onClick, type = 'button', dir, disabled, unavailable, describedBy, size = 'md' }: { label: string; onClick?: () => void; type?: 'button' | 'submit'; dir?: 1 | -1; disabled?: boolean; unavailable?: boolean; describedBy?: string; size?: 'sm' | 'md' | 'lg' }) {
  const [animation] = useState(() => generateFinHover(Math.random,dir));
  const off = disabled || unavailable;
  return (
    <button type={type} onClick={onClick} disabled={disabled} aria-disabled={unavailable || undefined} aria-describedby={describedBy}
      className={`ss-fin-button ss-swim-cta ss-swim-cta--${size}`}
      style={{
        ...finHoverStyle(animation),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--brand-accent)', color: 'var(--brand-on-accent)', border: 'none',
        borderRadius: 'var(--radius-element)', padding: size === 'lg' ? '13px 26px' : size === 'sm' ? '5px 8px' : '10px 18px', minHeight: 'var(--swim-cta-height, 44px)',
        fontFamily: 'var(--font-family-body)', fontWeight: 600, fontSize: size === 'lg' ? '1rem' : size === 'sm' ? '0.78rem' : '0.95rem',
        cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.5 : 1,
      }}>
      <FinHover animation={animation} /><span className="ss-fin-button__label">{label}</span>
    </button>
  );
}

export interface SampleQuestion { text: string; code?: string; opts: string[]; a: number; e: string; }

/**
 * The interactive "try one — no signup" sample-question card. `chip` labels it
 * (e.g. "JavaScript · Level 1 — Values & Math"); mount with a `key` so picking
 * resets when the parent swaps the question.
 */
export function SampleCard({ chip, question, onAnswered, showTeaser = true }: { chip: string; question: SampleQuestion; onAnswered?: () => void; showTeaser?: boolean }) {
  const t = useT();
  const [picked, setPicked] = useState<number | null>(null);
  // One answer per card, even when two presses land before React re-renders.
  const pickedRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const answered = picked !== null;
  const correct = question.a;
  const right = answered && picked === correct;
  // Answering disables every option, the pressed one included, which dropped
  // keyboard focus to the page body. The verdict takes it instead, so the
  // next Tab continues from the card and a screen reader reads the verdict.
  useEffect(() => {
    if (answered) feedbackRef.current?.focus();
  }, [answered]);

  return (
    <div className="ss-panel" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14, borderRadius: 'var(--radius-container)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ borderRadius: 999, padding: '3px 10px', background: 'var(--brand-accent-soft)', color: 'var(--brand-accent-on-soft)', fontSize: '0.75rem', fontWeight: 600 }}>{chip}</span>
        {showTeaser && <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginLeft: 'auto' }}>{t('home.tryOne')}</span>}
      </div>
      <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* A <legend> is laid out by the fieldset itself, not as a flex item, so
            the fieldset's `gap` never applies beneath it — the question text sat
            flush against the first answer. Space it explicitly. */}
        <legend style={{ margin: '0 0 14px', padding: 0, fontFamily: 'var(--font-family-heading)', fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-0.01em', lineHeight: 1.35 }}>{question.text}</legend>
        {question.code && (
          <pre aria-label={t('home.codeSample')} style={{ margin: 0, background: 'var(--color-background-muted)', border: '1px solid var(--ss-card-line)', borderRadius: 'var(--radius-inner)', padding: '10px 14px', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '0.9rem', color: 'var(--color-text-primary)', overflowX: 'auto' }}>{question.code}</pre>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {question.opts.map((label, i) => {
          const isCorrect = answered && i === correct;
          const isWrong = answered && i === picked && picked !== correct;
          const dim = answered && !isCorrect && !isWrong;
          return (
            <button
              key={i} type="button" disabled={answered}
              onClick={() => { if (pickedRef.current) return; pickedRef.current = true; setPicked(i); onAnswered?.(); }}
              className="ss-radio-card" data-tone={isCorrect ? 'success' : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', fontSize: '0.95rem', opacity: dim ? 0.6 : 1,
                borderColor: isWrong ? 'var(--ss-error)' : undefined,
                boxShadow: isWrong ? 'inset 0 0 0 1px var(--ss-error)' : undefined,
                background: isWrong ? 'var(--ss-error-soft)' : undefined,
              }}
            >
              <span style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6, background: 'var(--color-background-muted)', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{String.fromCharCode(65 + i)}</span>
              <span>{label}</span>
              {(isCorrect || isWrong) && (
                <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: 700, color: isCorrect ? 'var(--ss-success)' : 'var(--ss-error)' }}>{isCorrect ? '✓' : '✕'}</span>
              )}
            </button>
          );
        })}
        </div>
      </fieldset>
      {answered && (
        <div ref={feedbackRef} tabIndex={-1} role="status" aria-live="polite" style={{
          borderRadius: 'var(--radius-element)', padding: '12px 14px',
          background: right ? 'var(--ss-success-soft)' : 'var(--ss-error-soft)',
          border: `1px solid ${right ? 'var(--ss-success)' : 'var(--ss-error)'}`,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: right ? 'var(--ss-success)' : 'var(--ss-error)' }}>
            {right ? t('home.answerCorrect') : t('home.answerWrong', { answer: question.opts[correct] })}
          </span>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{question.e}</span>
        </div>
      )}
    </div>
  );
}

/** Full-width roadmap that wraps into two rows on narrow screens. */
export function PathStrip({ label, children }: { label: string; children: ReactNode }) {
  return <div className="ss-home-path" role="list" aria-label={label}>{children}</div>;
}

/** Gold "checkpoint" node used at the end of a roadmap-preview path. */
export function CheckpointNode({ label }: { label: string }) {
  return (
    <div role="listitem" className="ss-home-path__node">
      <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: '50%', background: 'var(--ss-warning-soft)', color: 'var(--ss-warning)', border: '2px solid color-mix(in srgb, var(--ss-warning) 50%, transparent)' }}>
        <TrophyIcon size={20} />
      </span>
      <span style={{ fontSize: 'var(--ss-type-meta)', fontWeight: 600, color: 'var(--ss-warning)', textAlign: 'center' }}>{label}</span>
    </div>
  );
}

/** A single wave connector for roadmap-preview paths (varied per index). */
export function pathWave(i: number): string {
  const amp = 1.2 + ((i * 7) % 4) * 0.55;
  const dir = i % 2 === 0 ? -1 : 1;
  const y1 = 4 + dir * amp;
  return i % 3 === 0 ? `M0 4 Q 5 ${y1} 10 4 T 20 4 T 30 4 T 40 4` : `M0 4 Q 7 ${y1} 14 4 T 28 4 T 42 4`;
}
