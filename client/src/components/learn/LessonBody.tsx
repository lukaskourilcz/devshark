// Rendering for a learning-path lesson: prose, code, tables, callouts and the
// deterministic trace player.
//
// The trace is an affordance, never the only way to read the material. Every
// frame carries a sentence describing it, the whole sequence is also rendered
// as an ordered list of those sentences, and the marks that highlight cells
// carry a word as well as a border. Autoplay is opt-in and never starts under
// a reduced-motion preference.

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { runCodeTests } from '../../coding/runner/run-tests';
import { TermsBar } from '../ui/Terms';
import { useIsNarrowForEditor } from '../../lib/useMediaQuery';
import { useT } from '../../i18n/LanguageContext';
import type { LessonBody as LessonBodyDto, LessonSection, TraceSpec } from '../../../../shared/learning-path-api';
import { Button } from '@astryxdesign/core/Button';

function allowedLessonHref(href: string): boolean {
  try {
    const url = new URL(href, 'https://devshark.invalid');
    if (href.startsWith('https://')) return url.protocol === 'https:';
    const path = href.split(/[?#]/, 1)[0];
    // Learn routes use literal lowercase slug segments. Refuse normalization,
    // encoded path separators and dot segments instead of changing the route.
    return url.origin === 'https://devshark.invalid' && path === url.pathname
      && /^\/learn\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*\/?$/.test(path);
  } catch { return false; }
}

/** Authored lesson links use HTTPS or a Learn address; HTML remains plain text. */
function lessonLinks(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]\n]{1,160})\]\((https:\/\/[^\s)]+|\/learn\/[a-z0-9/?=&%#.-]+)\)/g;
  let from = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index!;
    nodes.push(text.slice(from, index));
    const external = match[2].startsWith('https://');
    nodes.push(match[1].trim() && allowedLessonHref(match[2]) ? <span className="ss-text-links" key={index}><a href={match[2]} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{match[1]}</a></span> : match[0]);
    from = index + match[0].length;
  }
  nodes.push(text.slice(from));
  return nodes;
}

// Authored *emphasis* (UX audit learn-21): one word or phrase between single
// asterisks that open after a space or an opening mark and close before a
// non-word character, so `2 * n * 3`, `a*b` and a glob such as `s3:*` stay as
// written. Only text outside code spans reaches this.
const EMPHASIS = /(^|[\s([{"'“‘—–-])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![\w*])/g;

function lessonEmphasis(text: string, segment: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(EMPHASIS)) {
    const start = match.index! + match[1].length;
    nodes.push(text.slice(from, start));
    nodes.push(<em key={`em-${segment}-${start}`}>{match[2]}</em>);
    from = match.index! + match[0].length;
  }
  if (from === 0) return [text];
  nodes.push(text.slice(from));
  return nodes;
}

/** Links first, then emphasis in the plain text between them. */
function lessonInline(text: string): ReactNode[] {
  return lessonLinks(text).flatMap((node, index) => (typeof node === 'string' ? lessonEmphasis(node, index) : [node]));
}

/** Match whole backtick runs so link examples stay literal in every text cell. */
function InlineText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let from = 0;
  while (from < text.length) {
    const open = text.indexOf('`', from);
    if (open < 0) break;
    let start = open;
    while (text[start] === '`') start += 1;
    const width = start - open;
    let close = start;
    let end = start;
    while ((close = text.indexOf('`', end)) >= 0) {
      end = close;
      while (text[end] === '`') end += 1;
      if (end - close === width) break;
    }
    if (close < 0) break;
    nodes.push(<span key={`text-${from}`}>{lessonInline(text.slice(from, open))}</span>);
    nodes.push(<code key={`code-${open}`}>{text.slice(start, close)}</code>);
    from = end;
  }
  nodes.push(<span key={`text-${from}`}>{lessonInline(text.slice(from))}</span>);
  return <>{nodes}</>;
}

/** Inline code, bounded authored links and *emphasis*; text inside code is
 * never parsed.
 * Memoised on the text: a code or artifact brief sits beside the editor, which
 * re-renders on every keystroke, and re-parsing an unchanged brief each time
 * was wasted work. */
export const RichText = memo(function RichText({ text }: { text: string }) {
  const paragraphs = text.split('\n\n');
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          <InlineText text={paragraph} />
        </p>
      ))}
    </>
  );
});

const STEP_MS = 1400;

/**
 * A deterministic trace the learner steps through. Play/pause/step/reset, plus
 * the same sequence written out underneath so the whole thing is readable with
 * the player untouched.
 */
export function TracePlayer({ trace, caption }: { trace: TraceSpec; caption: string }) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const labelId = useId();

  const frames = trace.frames;
  const legend = trace.legend ?? [];
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (!playing) return;
    if (index >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    timer.current = window.setTimeout(() => setIndex((current) => Math.min(current + 1, frames.length - 1)), STEP_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [playing, index, frames.length]);

  const frame = frames[Math.min(index, frames.length - 1)];
  const roleWord = (role: string) => t(`paths.trace.role.${role}` as never);
  // Nothing validates that a trace has a frame; one without would otherwise
  // throw and take the whole lesson down with it.
  if (!frame) return null;

  return (
    <figure className="lp-figure lp-trace" aria-labelledby={labelId}>
      <figcaption id={labelId}>{caption}</figcaption>

      <div className="lp-trace__cells" role="group" aria-label={caption}>
        {frame.cells.map((cell, cellIndex) => {
          const mark = frame.marks?.find((one) => one.index === cellIndex);
          return (
            <span
              key={cellIndex}
              className={`lp-trace__cell${mark ? ` lp-trace__cell--${mark.role}` : ''}`}
            >
              {legend[cellIndex] ? <span className="lp-trace__role">{legend[cellIndex]}</span> : null}
              {cell}
              {mark ? <span className="lp-trace__role">{roleWord(mark.role)}</span> : null}
            </span>
          );
        })}
      </div>

      {/* The live region carries the step description, so stepping through with
          the keyboard announces what changed rather than leaving it to sight. */}
      <p className="lp-trace__note" aria-live="polite">
        {frame.note}
        {frame.counter ? (
          <>
            {' '}
            <span className="lp-trace__counter">
              {frame.counter.label}: {frame.counter.value}
            </span>
          </>
        ) : null}
      </p>

      <div className="lp-trace__controls">
        <Button variant="ghost" onClick={() => setIndex((current) => Math.max(0, current - 1))} isDisabled={index === 0} label={t('paths.trace.back')} />
        <Button variant="ghost" onClick={() => setIndex((current) => Math.min(frames.length - 1, current + 1))} isDisabled={index >= frames.length - 1} label={t('paths.trace.step')} />
        {!reduceMotion && (
          <Button variant="ghost" onClick={() => setPlaying((current) => !current)} isDisabled={index >= frames.length - 1 && !playing} label={playing ? t('paths.trace.pause') : t('paths.trace.play')} />
        )}
        <Button variant="ghost" onClick={() => {
            setPlaying(false);
            setIndex(0);
          }} isDisabled={index === 0 && !playing} label={t('paths.trace.reset')} />
        <span className="lp-trace__step">
          {t('paths.trace.position', { current: index + 1, total: frames.length })}
        </span>
      </div>

      <details>
        <summary>{t('paths.trace.allSteps')}</summary>
        <ol className="lp-trace__steps">
          {frames.map((one, frameIndex) => (
            <li key={frameIndex}>
              {one.note}
              {one.counter ? ` (${one.counter.label}: ${one.counter.value})` : ''}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}

function Section({ section }: { section: LessonSection }) {
  const t = useT();
  // A code block or table wider than a phone scrolls sideways; keyboard users
  // reach that scroll by focusing the region, which its caption names.
  const captionId = useId();

  switch (section.kind) {
    case 'prose':
      return <RichText text={section.body} />;
    case 'callout':
      return (
        <div className={`lp-callout${section.tone === 'warning' ? ' lp-callout--warning' : ''}`}>
          <span className="lp-callout__label">
            {section.tone === 'warning' ? t('paths.callout.warning') : t('paths.callout.note')}
          </span>
          <div>
            <RichText text={section.body} />
          </div>
        </div>
      );
    case 'code':
      return (
        <figure className="lp-figure">
          <pre className="lp-scroll-region" tabIndex={0} role="region" aria-labelledby={captionId}>
            <code>{section.code}</code>
          </pre>
          <figcaption id={captionId}>{section.caption}</figcaption>
        </figure>
      );
    case 'table': {
      const headers = section.headers;
      return (
        <figure className="lp-figure">
          <div className="lp-table-wrap lp-scroll-region" tabIndex={0} role="region" aria-labelledby={captionId}>
            <table className="lp-table">
              <caption className="ss-sr-only">{section.caption}</caption>
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th key={index} scope="col">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, rowIndex) => {
                  const cells = row;
                  return (
                    <tr key={rowIndex}>
                      {cells.map((cell, cellIndex) =>
                        cellIndex === 0 ? (
                          <th key={cellIndex} scope="row">
                            <InlineText text={cell} />
                          </th>
                        ) : (
                          <td key={cellIndex}><InlineText text={cell} /></td>
                        ),
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <figcaption id={captionId}>{section.caption}</figcaption>
        </figure>
      );
    }
    case 'trace':
      return <TracePlayer trace={section.trace} caption={section.caption} />;
    case 'example':
      return <InteractiveExample section={section} />;
  }
}

/**
 * A snippet the learner can change and run.
 *
 * Exploration, and it says so: nothing is graded, nothing is recorded, and
 * running it proves nothing about mastery. It exists because changing a loop
 * and watching the output change teaches more than a paragraph about loops.
 *
 * The code runs in the same bounded, isolated worker the Run button uses —
 * never in the page itself and never on the server. On a narrow screen the
 * editor is not offered at all: the snippet stays readable and runnable, and
 * the typing waits for a keyboard, the same policy a coding task follows.
 */
function InteractiveExample({ section }: { section: Extract<LessonSection, { kind: 'example' }> }) {
  const t = useT();
  const narrow = useIsNarrowForEditor();
  const [code, setCode] = useState(section.code);
  const [output, setOutput] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const labelId = useId();
  // Leaving the lesson mid-run stops the worker; an endless loop otherwise
  // kept a thread busy until the run's own time limit.
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const run = useCallback(async () => {
    // Two presses in one task both pass the disabled button (the state has
    // not reached the DOM yet): the newer run stops the older one, and only
    // the run held in the ref may paint, so an older result never covers a
    // newer one.
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setOutput(null);
    setError(null);
    try {
      const outcome = await runCodeTests({ track: 'javascript', code, tests: [], grade: false, signal: controller.signal });
      if (controller.signal.aborted || active.current !== controller) return;
      setOutput(outcome.logs);
      // A runner that never loaded is not the snippet's error.
      setError(outcome.runnerUnavailable ? t('coding.results.runnerUnavailable') : outcome.codeError);
    } finally {
      if (active.current === controller) {
        active.current = null;
        setRunning(false);
      }
    }
  }, [code, t]);

  return (
    <figure className="lp-figure lp-example">
      <figcaption id={labelId}>{section.caption}</figcaption>
      {narrow ? (
        <pre className="lp-code lp-scroll-region" tabIndex={0} role="region" aria-labelledby={labelId}><code>{code}</code></pre>
      ) : (
        <>
          <label className="ss-sr-only" htmlFor={`${labelId}-editor`}>{section.caption}</label>
          <textarea
            id={`${labelId}-editor`}
            className="lp-example__editor"
            spellCheck={false}
            rows={Math.min(16, code.split('\n').length + 1)}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </>
      )}
      <div className="lp-example__actions">
        <Button variant="secondary" isDisabled={running} onClick={() => void run()} label={running ? t('paths.example.running') : t('paths.example.run')} />
        <Button variant="ghost" isDisabled={running || code === section.code} onClick={() => { setCode(section.code); setOutput(null); setError(null); }} label={t('paths.example.reset')} />
      </div>
      {error && <p className="lp-notice lp-notice--error" role="alert">{error}</p>}
      <pre role="status" aria-live="polite" className={output !== null && !error ? 'lp-example__output' : 'ss-sr-only'}>
        {output !== null && !error && (output.length > 0 ? output.join('\n') : t('paths.example.noOutput'))}
      </pre>
      <p className="lp-example__note">{section.note}</p>
    </figure>
  );
}

/** Memoised: a lesson is the largest thing a workspace renders, and the
 * workspace re-renders on every busy, draft and result change while the lesson
 * object itself stays the same. Each render also rescanned all its prose for
 * glossary terms. */
export const LessonView = memo(function LessonView({ lesson, headingLevel = 2 }: { lesson: LessonBodyDto; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const t = useT();
  return (
    <article className="lp-lesson">
      <Heading>{lesson.title}</Heading>
      {/* Keyed by lesson as well: a view reused for the next lesson otherwise
          kept an example's edited code and a trace's step from the last one. */}
      {lesson.sections.map((section, index) => (
        <Section key={`${lesson.id}:${index}`} section={section} />
      ))}
      {/* One control for the page: the abbreviations its prose actually uses,
          explained where the learner meets them. */}
      <TermsBar
        texts={lesson.sections.flatMap((section) =>
          section.kind === 'prose' || section.kind === 'callout'
            ? [section.body]
            : section.kind === 'code' || section.kind === 'example'
              ? [section.caption]
              : [])}
      />
      {lesson.sources.length > 0 && (
        <section className="lp-section">
          <h3>{t('paths.lesson.sources')}</h3>
          <ul className="lp-sources">
            {lesson.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.label}
                </a>{' '}
                {t('paths.lesson.checkedOn', { date: source.reviewedOn })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
});
