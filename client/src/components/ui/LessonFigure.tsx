// Rendering for the authored lesson figures.
//
// Everything here is HTML and CSS. No canvas, no image, no generated picture:
// a diagram of a box model or an execution order is a claim about behaviour,
// and the browser laying out real boxes is both the most accurate way to show
// one and the only way it stays readable at 200% zoom.
//
// Four properties the markup is written to keep:
//
//   * The text alternative is always present, not an attribute. It sits in a
//     disclosure under every figure, so it is available to everyone rather than
//     only to a screen reader, and the figure is complete without the picture.
//   * No meaning is carried by colour. Every marked cell, row and layer also
//     carries the word that says why it is marked.
//   * Stepping is manual. Previous, Next and Reset, no autoplay, nothing that
//     requires a drag, and the step description lives in a live region so a
//     keyboard user hears what changed.
//   * Nothing moves under a reduced-motion preference, because nothing moves at
//     all — the frames are states, not an animation.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../../i18n/LanguageContext';
import { TermsBar } from './Terms';
import { glossaryDomainFor } from '../../lib/glossaryDomain';
import type { LessonFigure as Figure } from '../../../../shared/lesson-figures';
import './LessonFigure.css';

export function LessonFigures({ figures }: { figures: readonly Figure[] }) {
  if (figures.length === 0) return null;
  return (
    <>
      {figures.map((figure) => (
        <LessonFigureView key={figure.id} figure={figure} />
      ))}
    </>
  );
}

export function LessonFigureView({ figure }: { figure: Figure }) {
  const t = useT();
  const captionId = useId();
  const [showText, setShowText] = useState(false);

  return (
    <figure className="ss-figure" aria-labelledby={captionId}>
      <figcaption id={captionId} className="ss-figure__caption">
        {figure.title}
      </figcaption>

      {figure.body.kind === 'flow' && <FlowView body={figure.body} />}
      {figure.body.kind === 'nested' && <NestedView body={figure.body} />}
      {figure.body.kind === 'table' && <TableView body={figure.body} />}
      {figure.body.kind === 'steps' && <StepsView body={figure.body} />}

      {figure.assumes && (
        <p className="ss-figure__assumes">
          <span className="ss-figure__assumes-label">{t('figure.assumes')}</span> {figure.assumes}
        </p>
      )}

      {/* The whole figure in words. Open it and the picture is redundant, which
          is the test of whether it was written properly. */}
      <div className="ss-figure__text">
        <button
          type="button"
          className="ss-figure__toggle"
          aria-expanded={showText}
          onClick={() => setShowText((current) => !current)}
        >
          {t('figure.inWords')}
        </button>
        {showText && <p className="ss-figure__alt">{figure.alt}</p>}
      </div>

      {/* Abbreviation help beside the figure, never injected into its labels. */}
      <TermsBar
        texts={[figure.title, figure.alt]}
        domain={glossaryDomainFor(figure.topic)}
      />
    </figure>
  );
}

function FlowView({ body }: { body: Extract<Figure['body'], { kind: 'flow' }> }) {
  const label = (id: string) => body.nodes.find((node) => node.id === id);
  return (
    <div className="ss-figure__flow">
      <ol className="ss-figure__nodes">
        {body.nodes.map((node) => (
          <li key={node.id} className="ss-figure__node">
            <span className="ss-figure__node-label">{node.label}</span>
            {node.note && <span className="ss-figure__node-note">{node.note}</span>}
          </li>
        ))}
      </ol>
      <ul className="ss-figure__edges">
        {body.edges.map((edge, index) => (
          <li key={index}>
            <span className="ss-figure__edge-ends">
              {label(edge.from)?.label ?? edge.from}
              <span aria-hidden="true"> → </span>
              {label(edge.to)?.label ?? edge.to}
            </span>
            <span className="ss-figure__edge-label">{edge.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NestedView({ body }: { body: Extract<Figure['body'], { kind: 'nested' }> }) {
  // Rendered by real nesting, so the containment the figure is about is the
  // containment the browser lays out.
  const render = (index: number): ReactNode => {
    const layer = body.layers[index];
    if (!layer) return null;
    return (
      <div className="ss-figure__layer">
        <span className="ss-figure__layer-head">
          <span className="ss-figure__layer-label">{layer.label}</span>
          {layer.value && <span className="ss-figure__layer-value">{layer.value}</span>}
          {layer.note && <span className="ss-figure__layer-note">{layer.note}</span>}
        </span>
        {render(index + 1)}
      </div>
    );
  };
  return <div className="ss-figure__nested">{render(0)}</div>;
}

function TableView({ body }: { body: Extract<Figure['body'], { kind: 'table' }> }) {
  return (
    <div className="ss-figure__scroll">
      <table className="ss-figure__table">
        <thead>
          <tr>
            {body.columns.map((column, index) => (
              <th key={index} scope="col">{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.rows.map((row, rowIndex) => {
            const mark = body.marks?.find((one) => one.row === rowIndex);
            return (
              <tr key={rowIndex} className={mark ? 'ss-figure__row--marked' : undefined}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    {cell}
                    {/* The word is the mark; the background is decoration. */}
                    {mark && cellIndex === row.length - 1 && (
                      <span className="ss-figure__role"> {mark.role}</span>
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StepsView({ body }: { body: Extract<Figure['body'], { kind: 'steps' }> }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // A control that turns itself off drops keyboard focus to the page: Reset
  // always does, Next on the last step and Previous on the first. Focus goes
  // to the control that still has something to do, once it is on again.
  const focusAfter = useRef<'previous' | 'next' | null>(null);
  useEffect(() => {
    const target = focusAfter.current === 'previous' ? previousRef.current : focusAfter.current === 'next' ? nextRef.current : null;
    focusAfter.current = null;
    target?.focus();
  }, [index]);
  const last = body.frames.length - 1;
  const go = (to: number) => {
    const clamped = Math.max(0, Math.min(last, to));
    if (clamped === 0) focusAfter.current = 'next';
    else if (clamped === last) focusAfter.current = 'previous';
    setIndex(clamped);
  };
  const frame = body.frames[Math.min(index, last)];
  // A sequence with no frames has nothing to step through; the figure's words
  // still carry it. Reading `frame.cells` threw and took the lesson with it.
  if (!frame) return null;

  return (
    <div className="ss-figure__steps">
      <div className="ss-figure__scroll">
        <ol className="ss-figure__cells">
          {frame.cells.map((cell, cellIndex) => {
            const mark = frame.marks?.find((one) => one.index === cellIndex);
            return (
              <li key={cellIndex} className={`ss-figure__cell${mark ? ' ss-figure__cell--marked' : ''}`}>
                {body.legend?.[cellIndex] && (
                  <span className="ss-figure__role">{body.legend[cellIndex]}</span>
                )}
                <span className="ss-figure__cell-value">{cell}</span>
                {mark && <span className="ss-figure__role">{mark.role}</span>}
              </li>
            );
          })}
        </ol>
      </div>

      {/* What changed, announced rather than left to sight. */}
      <p className="ss-figure__note" aria-live="polite">
        {frame.note}
        {frame.counter && (
          <span className="ss-figure__counter">
            {' '}
            {frame.counter.label}: {frame.counter.value}
          </span>
        )}
      </p>

      <div className="ss-figure__controls">
        <button
          ref={previousRef}
          type="button"
          className="ss-figure__button"
          onClick={() => go(index - 1)}
          disabled={index === 0}
        >
          {t('figure.previous')}
        </button>
        <span className="ss-figure__position">
          {t('figure.step', { current: Math.min(index, last) + 1, total: body.frames.length })}
        </span>
        <button
          ref={nextRef}
          type="button"
          className="ss-figure__button"
          onClick={() => go(index + 1)}
          disabled={index >= last}
        >
          {t('figure.next')}
        </button>
        <button
          type="button"
          className="ss-figure__button ss-figure__button--quiet"
          onClick={() => go(0)}
          disabled={index === 0}
        >
          {t('figure.reset')}
        </button>
      </div>

      {/* Every frame, written out, so the sequence is readable without touching
          the controls at all. */}
      <ol className="ss-figure__frames">
        {body.frames.map((one, frameIndex) => (
          <li key={frameIndex}>{one.note}</li>
        ))}
      </ol>
    </div>
  );
}
