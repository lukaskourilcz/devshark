import { parser } from '@lezer/javascript';

const MAX_CONTINUOUS_MS = 2_000;
const LOOP_ERROR = 'A loop ran for two seconds without yielding. Check its condition and run the preview again.';

/** Each new Run gets its own budget. Synchronous loops share the deadline,
 * including loops in helpers they call. A new browser task renews the
 * budget; a chain of resolved promises still shares the current deadline. */
export function createPreviewLoopCheck(report: (error: Error) => void, now = performance.now.bind(performance)) {
  let deadline: number | undefined;
  let expired: Error | undefined;
  return () => {
    if (expired) throw expired;
    const time = now();
    if (deadline === undefined) {
      deadline = time + MAX_CONTINUOUS_MS;
      setTimeout(() => { deadline = undefined; }, 0);
    } else if (time >= deadline) {
      expired = new Error(LOOP_ERROR);
      expired.name = 'PreviewLoopTimeoutError';
      report(expired);
      throw expired;
    }
  };
}

/** Instrument the plain JS emitted by Sucrase, so TS, JSX, labels, comments
 * and strings keep their language-defined meaning. The guard is a function
 * argument private to this compiled module. */
export function guardPreviewLoops(js: string): { code: string; parameter: string } {
  const edits: { at: number; text: string }[] = [];
  let parameter = '__devSharkCheckLoop';
  // JS permits Unicode escapes in identifier names. Reserve an unused
  // parameter even when a learner wrote the same identifier using escapes.
  const spellings = js.replace(/\\u(?:\{([0-9a-f]+)\}|([0-9a-f]{4}))/gi, (raw, braced, fixed) => {
    const value = Number.parseInt(braced ?? fixed, 16);
    return value <= 0x10ffff ? String.fromCodePoint(value) : raw;
  });
  while (spellings.includes(parameter)) parameter += '$';
  parser.parse(js).iterate({ enter(ref) {
    if (ref.name !== 'WhileStatement' && ref.name !== 'ForStatement' && ref.name !== 'DoStatement') return;
    // Lezer puts the body immediately after do, the (condition), or the
    // for specification. Comments are children in their own right.
    const node = ref.node;
    let before = node.firstChild;
    if (ref.name !== 'DoStatement') {
      while (before && !['ParenthesizedExpression', 'ForSpec', 'ForInSpec', 'ForOfSpec'].includes(before.name)) before = before.nextSibling;
    }
    let body = before?.nextSibling;
    while (body?.name === 'LineComment' || body?.name === 'BlockComment') body = body.nextSibling;
    if (!body || body.type.isError) throw new SyntaxError('Cannot read a loop body in this preview.');
    if (body.name === 'Block') {
      edits.push({ at: body.from + 1, text: parameter + '();' });
    } else {
      edits.push({ at: body.from, text: '{' + parameter + '();' }, { at: body.to, text: '}' });
    }
  } });
  let last = 0;
  const parts: string[] = [];
  for (const { at, text } of edits.sort((left, right) => left.at - right.at)) {
    parts.push(js.slice(last, at), text);
    last = at;
  }
  return { parameter, code: parts.length ? parts.join('') + js.slice(last) : js };
}
