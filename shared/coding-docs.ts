/** Reference documentation for the techniques a coding task practises.
 *
 * Two jobs, deliberately separated:
 *
 *   - `taskResources` backs the Resources panel, which is open from the moment
 *     a task loads. Looking something up is not asking for help, so it costs no
 *     hint rung and needs no failed attempt first. It lists every technique the
 *     task declares, not just the first.
 *   - `docsFor` still backs the hint ladder's last rung before the solution.
 *
 * Nothing here contains a solution or a hidden test. Each entry names a
 * published reference page, the page's own title, which reference it comes
 * from, one authored line on what the learner will find there, and the date the
 * link was last checked. Every blurb is written for this product; none of it is
 * copied from the page it points at. */


const MDN = 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference';
const MDN_DOCS = 'https://developer.mozilla.org/en-US/docs';
const REACT = 'https://react.dev/reference/react';
const REACT_LEARN = 'https://react.dev/learn';
const TS = 'https://www.typescriptlang.org/docs/handbook';

export type DocSource = 'MDN' | 'React' | 'TypeScript';

export interface CodingDocLink {
  /** The technique tag this page documents. */
  tag: string;
  url: string;
  /** The page's own title. Not translated — it is the name of the page. */
  title: string;
  source: DocSource;
  /** One authored line on what is there. */
  blurb: string;
  /** ISO date the link and title were last checked. */
  reviewed: string;
}

const REVIEWED = '2026-09-08';

type Row = [tag: string, url: string, title: string, source: DocSource, blurb: string];

const ROWS: Row[] = [
  // ── loops and traversal ────────────────────────────────────────────────
  ['for', `${MDN}/Statements/for`, 'for', 'MDN', 'The three-part loop, and what each part runs when.'],
  ['while', `${MDN}/Statements/while`, 'while', 'MDN', 'Looping while a condition holds, and how to avoid never ending.'],
  ['do-while', `${MDN}/Statements/do...while`, 'do...while', 'MDN', 'The loop that always runs its body at least once.'],
  ['for-of', `${MDN}/Statements/for...of`, 'for...of', 'MDN', 'Iterating values of arrays, strings, Maps and Sets.'],
  ['for-in', `${MDN}/Statements/for...in`, 'for...in', 'MDN', 'Iterating object keys, including the inherited ones.'],
  ['nested-loops', `${MDN}/Statements/for`, 'for', 'MDN', 'The same loop statement, applied one inside another.'],
  ['two-pointer', `${MDN}/Global_Objects/Array`, 'Array', 'MDN', 'Indexing and length — what a two-pointer walk is built on.'],
  // ── arrays ─────────────────────────────────────────────────────────────
  ['map', `${MDN}/Global_Objects/Array/map`, 'Array.prototype.map()', 'MDN', 'A new array of the same length, one result per element.'],
  ['filter', `${MDN}/Global_Objects/Array/filter`, 'Array.prototype.filter()', 'MDN', 'Keeping the elements a test accepts.'],
  ['reduce', `${MDN}/Global_Objects/Array/reduce`, 'Array.prototype.reduce()', 'MDN', 'Folding an array to one value, and why the initial value matters.'],
  ['find', `${MDN}/Global_Objects/Array/find`, 'Array.prototype.find()', 'MDN', 'The first matching element, or undefined.'],
  ['findIndex', `${MDN}/Global_Objects/Array/findIndex`, 'Array.prototype.findIndex()', 'MDN', 'The first matching index, or -1.'],
  ['some', `${MDN}/Global_Objects/Array/some`, 'Array.prototype.some()', 'MDN', 'Whether at least one element passes, stopping early.'],
  ['every', `${MDN}/Global_Objects/Array/every`, 'Array.prototype.every()', 'MDN', 'Whether all elements pass, including the empty-array answer.'],
  ['includes', `${MDN}/Global_Objects/Array/includes`, 'Array.prototype.includes()', 'MDN', 'Membership by value, and how it treats NaN.'],
  ['indexOf', `${MDN}/Global_Objects/Array/indexOf`, 'Array.prototype.indexOf()', 'MDN', 'Position by strict equality, or -1.'],
  ['push', `${MDN}/Global_Objects/Array/push`, 'Array.prototype.push()', 'MDN', 'Appending in place, and what it returns.'],
  ['pop', `${MDN}/Global_Objects/Array/pop`, 'Array.prototype.pop()', 'MDN', 'Removing the last element in place.'],
  ['shift', `${MDN}/Global_Objects/Array/shift`, 'Array.prototype.shift()', 'MDN', 'Removing the first element — and why everything after it moves.'],
  ['unshift', `${MDN}/Global_Objects/Array/unshift`, 'Array.prototype.unshift()', 'MDN', 'Inserting at the front, with the same shifting cost.'],
  ['splice', `${MDN}/Global_Objects/Array/splice`, 'Array.prototype.splice()', 'MDN', 'Removing and inserting in place; it mutates.'],
  ['slice', `${MDN}/Global_Objects/Array/slice`, 'Array.prototype.slice()', 'MDN', 'A copied range; the original is untouched.'],
  ['sort', `${MDN}/Global_Objects/Array/sort`, 'Array.prototype.sort()', 'MDN', 'Sorting in place, the default string order, and comparators.'],
  ['flat', `${MDN}/Global_Objects/Array/flat`, 'Array.prototype.flat()', 'MDN', 'Flattening nested arrays to a chosen depth.'],
  ['forEach', `${MDN}/Global_Objects/Array/forEach`, 'Array.prototype.forEach()', 'MDN', 'Running a function per element, returning nothing.'],
  ['concat', `${MDN}/Global_Objects/Array/concat`, 'Array.prototype.concat()', 'MDN', 'Joining arrays into a new one.'],
  ['join', `${MDN}/Global_Objects/Array/join`, 'Array.prototype.join()', 'MDN', 'Array to string, and what happens to null and undefined.'],
  ['pagination', `${MDN}/Global_Objects/Array/slice`, 'Array.prototype.slice()', 'MDN', 'Ranges by index — the arithmetic behind a page of results.'],
  // ── strings, objects, structures ───────────────────────────────────────
  ['strings', `${MDN}/Global_Objects/String`, 'String', 'MDN', 'String methods, and the fact that none of them mutate.'],
  ['split', `${MDN}/Global_Objects/String/split`, 'String.prototype.split()', 'MDN', 'Splitting on a separator, including the empty-string case.'],
  ['regex', `${MDN}/Global_Objects/RegExp`, 'RegExp', 'MDN', 'Patterns, flags and the stateful g flag.'],
  ['objects', `${MDN}/Global_Objects/Object`, 'Object', 'MDN', 'Keys, values, entries and copying.'],
  ['destructuring', `${MDN}/Operators/Destructuring`, 'Destructuring', 'MDN', 'Pulling values out of arrays and objects, with defaults.'],
  ['spread', `${MDN}/Operators/Spread_syntax`, 'Spread syntax (...)', 'MDN', 'Copying and combining — and that the copy is shallow.'],
  // One tag covers Map and Set tasks alike, so it links the guide to both.
  ['map-set', `${MDN_DOCS}/Web/JavaScript/Guide/Keyed_collections`, 'Keyed collections', 'MDN', 'Map and Set: lookup by key, membership and insertion order.'],
  ['json', `${MDN}/Global_Objects/JSON`, 'JSON', 'MDN', 'Parsing and stringifying, and what does not survive the trip.'],
  // ── functions and asynchrony ───────────────────────────────────────────
  ['functions', `${MDN}/Functions`, 'Functions', 'MDN', 'Parameters, defaults, rest and return values.'],
  ['closures', `${MDN_DOCS}/Web/JavaScript/Guide/Closures`, 'Closures', 'MDN', 'What a function keeps hold of after it is created.'],
  ['higher-order', `${MDN}/Functions/Arrow_functions`, 'Arrow functions', 'MDN', 'Functions passed as values, and how arrows bind this.'],
  ['recursion', `${MDN_DOCS}/Glossary/Recursion`, 'Recursion', 'MDN', 'Base case and recursive case, and why both are needed.'],
  ['callbacks', `${MDN_DOCS}/Glossary/Callback_function`, 'Callback function', 'MDN', 'Functions called back later, synchronously or not.'],
  ['promises', `${MDN}/Global_Objects/Promise`, 'Promise', 'MDN', 'States, chaining, and handling rejection.'],
  ['async-await', `${MDN}/Statements/async_function`, 'async function', 'MDN', 'Awaiting values, and what an async function really returns.'],
  ['timers', `${MDN_DOCS}/Web/API/Window/setTimeout`, 'setTimeout()', 'MDN', 'Scheduling later work, and clearing it again.'],
  ['fetch', `${MDN_DOCS}/Web/API/Fetch_API/Using_Fetch`, 'Using the Fetch API', 'MDN', 'Requests, responses, and why a 404 does not reject.'],
  ['abort', `${MDN_DOCS}/Web/API/AbortController`, 'AbortController', 'MDN', 'Cancelling in-flight work when it is no longer wanted.'],
  // ── TypeScript ─────────────────────────────────────────────────────────
  ['annotations', `${TS}/2/everyday-types.html`, 'Everyday Types', 'TypeScript', 'The types you annotate with most of the time.'],
  ['interfaces', `${TS}/2/objects.html`, 'Object Types', 'TypeScript', 'Describing the shape of an object.'],
  ['unions', `${TS}/2/everyday-types.html#union-types`, 'Union Types', 'TypeScript', 'A value that may be one of several types.'],
  ['literal-types', `${TS}/2/everyday-types.html#literal-types`, 'Literal Types', 'TypeScript', 'Exact values as types, and where widening happens.'],
  ['tuples', `${TS}/2/objects.html#tuple-types`, 'Tuple Types', 'TypeScript', 'Fixed-length arrays with a type per position.'],
  ['optional', `${TS}/2/objects.html#optional-properties`, 'Optional Properties', 'TypeScript', 'Properties that may be absent, and undefined.'],
  ['readonly', `${TS}/2/objects.html#readonly-properties`, 'readonly Properties', 'TypeScript', 'What readonly does check, and what it does not.'],
  ['narrowing', `${TS}/2/narrowing.html`, 'Narrowing', 'TypeScript', 'How checks in code narrow a union.'],
  ['type-guards', `${TS}/2/narrowing.html#using-type-predicates`, 'Type Predicates', 'TypeScript', 'Writing a function the compiler trusts to narrow.'],
  ['generics', `${TS}/2/generics.html`, 'Generics', 'TypeScript', 'Types that carry a type through.'],
  ['constraints', `${TS}/2/generics.html#generic-constraints`, 'Generic Constraints', 'TypeScript', 'Requiring something of a type parameter.'],
  ['keyof', `${TS}/2/keyof-types.html`, 'keyof Type Operator', 'TypeScript', 'The union of an object type’s keys.'],
  ['utility-types', `${TS}/utility-types.html`, 'Utility Types', 'TypeScript', 'Partial, Pick, Omit and the rest.'],
  ['record', `${TS}/utility-types.html#recordkeys-type`, 'Record<Keys, Type>', 'TypeScript', 'A map type keyed by a known set of keys.'],
  // ── React ──────────────────────────────────────────────────────────────
  ['useState', `${REACT}/useState`, 'useState', 'React', 'State updates, batching, and the updater function.'],
  ['useEffect', `${REACT}/useEffect`, 'useEffect', 'React', 'When effects run, and what the dependency array means.'],
  ['useRef', `${REACT}/useRef`, 'useRef', 'React', 'A value that survives renders without causing one.'],
  ['useReducer', `${REACT}/useReducer`, 'useReducer', 'React', 'State transitions as one function.'],
  ['useContext', `${REACT}/useContext`, 'useContext', 'React', 'Reading context, and what makes consumers re-render.'],
  ['useMemo', `${REACT}/useMemo`, 'useMemo', 'React', 'Caching a computed value between renders.'],
  ['custom-hook', `${REACT_LEARN}/reusing-logic-with-custom-hooks`, 'Reusing Logic with Custom Hooks', 'React', 'Extracting stateful logic without sharing state.'],
  ['effect-cleanup', `${REACT_LEARN}/synchronizing-with-effects#how-to-handle-the-effect-firing-twice-in-development`, 'Synchronizing with Effects', 'React', 'Why cleanup exists and why effects run twice in development.'],
  ['jsx', `${REACT_LEARN}/writing-markup-with-jsx`, 'Writing Markup with JSX', 'React', 'The rules JSX adds on top of HTML.'],
  ['lists-keys', `${REACT_LEARN}/rendering-lists`, 'Rendering Lists', 'React', 'Why keys exist and what makes a stable one.'],
  ['conditional', `${REACT_LEARN}/conditional-rendering`, 'Conditional Rendering', 'React', 'Rendering branches, and the zero that renders.'],
  ['forms', 'https://react.dev/reference/react-dom/components/input', '<input>', 'React', 'Controlled inputs, value and onChange.'],
  ['events', `${REACT_LEARN}/responding-to-events`, 'Responding to Events', 'React', 'Handlers, arguments and propagation.'],
  ['derived-state', `${REACT_LEARN}/choosing-the-state-structure`, 'Choosing the State Structure', 'React', 'What to store, and what to compute during render.'],
  // ── the web around the code ────────────────────────────────────────────
  ['accessibility', `${MDN_DOCS}/Web/Accessibility/ARIA`, 'ARIA', 'MDN', 'Roles, states and properties — and using native elements first.'],
  ['estimation', `${MDN_DOCS}/Learn_web_development/Extensions/Server-side/First_steps/Client-Server_overview`, 'Client-Server overview', 'MDN', 'What a request costs and where the work happens.'],
  ['caching', `${MDN_DOCS}/Web/HTTP/Guides/Caching`, 'HTTP caching', 'MDN', 'Freshness, validation and what may be stored.'],
  ['auth', `${MDN_DOCS}/Web/HTTP/Guides/Authentication`, 'HTTP authentication', 'MDN', 'Proving who is asking, before deciding what they may do.'],
  ['networking', `${MDN_DOCS}/Web/HTTP/Guides/Overview`, 'An overview of HTTP', 'MDN', 'Methods, status codes and headers.'],
  ['request-flow', `${MDN_DOCS}/Web/HTTP/Guides/Overview`, 'An overview of HTTP', 'MDN', 'The path a request takes and where it can fail.'],
  ['data-model', `${MDN_DOCS}/Glossary/Database`, 'Database', 'MDN', 'What a store is for, before choosing which one.'],
];

const BY_TAG = new Map<string, CodingDocLink>(
  ROWS.map(([tag, url, title, source, blurb]) => [tag, { tag, url, title, source, blurb, reviewed: REVIEWED }]),
);

/** Every documentation entry, for the readiness report and the tests. */
export const CODING_DOC_LINKS: readonly CodingDocLink[] = [...BY_TAG.values()];

/** The JavaScript reference, used when a task declares nothing we document. */
const CODING_DOCS_FALLBACK: CodingDocLink = {
  tag: 'javascript',
  url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  title: 'JavaScript',
  source: 'MDN',
  blurb: 'The language reference, from the top.',
  reviewed: REVIEWED,
};

/**
 * Every documented technique a task practises, in the order the task declares
 * them. Empty when nothing it declares is documented — the panel then says so
 * rather than padding the list with a link that is not about this task.
 */
export function taskResources(focus: readonly string[]): CodingDocLink[] {
  const seen = new Set<string>();
  const out: CodingDocLink[] = [];
  for (const tag of focus) {
    const entry = BY_TAG.get(tag);
    if (!entry || seen.has(entry.url)) continue;
    seen.add(entry.url);
    out.push(entry);
  }
  return out;
}

/** The first documented technique of a task, or the JavaScript reference.
 * Still the hint ladder's last rung before the solution. */
export function docsFor(focus: readonly string[]): { tag: string; url: string; title: string } {
  const [first] = taskResources(focus);
  const page = first ?? CODING_DOCS_FALLBACK;
  return { tag: page.tag, url: page.url, title: page.title };
}
