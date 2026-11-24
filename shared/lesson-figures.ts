/** Worked examples and diagrams for Learn lessons.
 *
 * Every figure here is authored, deterministic and checked. There is no
 * generated imagery anywhere in this file and there must never be: a diagram of
 * a box model, an execution order or a join is a claim about behaviour, and a
 * picture that merely looks like one is worse than no picture.
 *
 * Four rules the shapes below exist to enforce.
 *
 * **One objective per figure.** A figure belongs to one level of one topic and
 * illustrates that level's objective. A diagram that explains three things
 * explains none of them.
 *
 * **The text is not a label, it is the figure.** `alt` is the whole content in
 * words — the numbers, the order, the result — not "a diagram showing the box
 * model". Someone reading it instead of looking at it gets the same lesson, and
 * that is what makes the figure safe to lose to a narrow screen, a stylesheet
 * that did not load, or a screen reader.
 *
 * **Assumptions are stated.** A trace of execution order depends on a runtime;
 * a `fr` track depends on a container width. Where the answer would change if
 * the reader assumed something else, the figure says what to assume.
 *
 * **Nothing is decorative.** A figure is added where a relationship or a change
 * over time is clearer shown than told. Where prose is clearer, there is no
 * figure, and the coverage matrix in docs/lesson-figures.md records the
 * omissions rather than hiding them.
 *
 * A figure marked `afterSubmission` is held back until the level is finished,
 * for the case where showing it first would answer the question being asked.
 * None of the figures below is marked today; the flag exists so that an author
 * who needs it does not have to choose between the diagram and the assessment. */

/** A chain of labelled steps with what happens between them. Used for request
 * flows, data flow, and any "A, then B, then C" relationship. */
interface FlowBody {
  kind: 'flow';
  nodes: { id: string; label: string; note?: string }[];
  /** Each edge names what travels along it, so an arrow never means "somehow". */
  edges: { from: string; to: string; label: string }[];
}

/** Boxes inside boxes, outermost first. Box model, landmarks, stacking. */
interface NestedBody {
  kind: 'nested';
  layers: { label: string; value?: string; note?: string }[];
}

/** A small table. Fixture rows for a join, a growth comparison, grid tracks. */
interface TableBody {
  kind: 'table';
  columns: string[];
  rows: string[][];
  /** Rows to mark, and the word that says why — never a colour alone. */
  marks?: { row: number; role: string }[];
}

/** A sequence the learner steps through. Same shape as the learning-path trace
 * player: cells, a note per frame, and an optional running counter. */
interface StepsBody {
  kind: 'steps';
  /** A word above each cell — "index 0", "acc", "top". */
  legend?: string[];
  frames: {
    cells: string[];
    /** Marked cells carry a word, so the mark is never only a colour. */
    marks?: { index: number; role: string }[];
    note: string;
    counter?: { label: string; value: string };
  }[];
}

type FigureBody = FlowBody | NestedBody | TableBody | StepsBody;

export interface LessonFigure {
  id: string;
  topic: string;
  /** The level whose objective this figure serves. */
  level: number;
  title: string;
  /** The figure, in words. The content, not a description of the picture. */
  alt: string;
  /** A runtime, a version, a container width — anything the reader would
   * otherwise have to guess, where guessing differently changes the answer. */
  assumes?: string;
  /** Held until the level is finished. See the note at the top of the file. */
  afterSubmission?: boolean;
  body: FigureBody;
}

export const LESSON_FIGURES: readonly LessonFigure[] = [
  /* ── HTML ────────────────────────────────────────────────────────────── */
  {
    id: 'html-landmarks',
    topic: 'html',
    level: 1,
    title: 'What a screen reader hears',
    alt: 'The page is a body containing five landmarks in order: header (announced as "banner"), nav (announced as "navigation"), main (announced as "main"), aside (announced as "complementary") and footer (announced as "content information"). A div in any of these positions is announced as nothing at all, which is why a landmark cannot be replaced by a class name.',
    body: {
      kind: 'nested',
      layers: [
        { label: 'body', note: 'the document' },
        { label: 'header → “banner”' },
        { label: 'nav → “navigation”' },
        { label: 'main → “main”', note: 'one per page' },
        { label: 'aside → “complementary”' },
        { label: 'footer → “content information”' },
      ],
    },
  },
  {
    id: 'html-label-input',
    topic: 'html',
    level: 3,
    title: 'What connects a label to its field',
    alt: 'A label with for="email" points at an input with id="email". That connection does two things: clicking the label focuses the field, and a screen reader announces "Email" when the field takes focus. The input also carries name="email", which is what the form submits under — an input without a name is not sent at all. Adjacency and a matching class connect nothing.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'label', label: 'label for="email"' },
        { id: 'input', label: 'input id="email"' },
        { id: 'form', label: 'form submission' },
      ],
      edges: [
        { from: 'label', to: 'input', label: 'for → id: focus and accessible name' },
        { from: 'input', to: 'form', label: 'name="email" → the value is sent' },
      ],
    },
  },

  /* ── CSS ─────────────────────────────────────────────────────────────── */
  {
    id: 'css-box-model',
    topic: 'css',
    level: 2,
    title: 'Where the 300 pixels went',
    alt: 'An element with width: 300px, padding: 20px, border: 2px and margin: 16px. Under the default box-sizing: content-box the content box is 300px, so the visible box is 300 + 20 + 20 + 2 + 2 = 344px, and the space it occupies including margins is 376px. Set box-sizing: border-box and the 300px becomes the visible box instead: content shrinks to 256px and nothing else moves.',
    assumes: 'box-sizing: content-box, the browser default.',
    body: {
      kind: 'nested',
      layers: [
        { label: 'margin 16px', value: '376px', note: 'space around it' },
        { label: 'border 2px', value: '344px', note: 'the visible edge' },
        { label: 'padding 20px', value: '340px' },
        { label: 'content', value: '300px', note: 'what width sets' },
      ],
    },
  },
  {
    id: 'css-flex-axes',
    topic: 'css',
    level: 3,
    title: 'The two axes, and which property moves which',
    alt: 'With flex-direction: row the main axis runs left to right and the cross axis runs top to bottom. justify-content moves items along the main axis; align-items moves them along the cross axis. Change flex-direction to column and the axes swap: justify-content now moves items vertically and align-items horizontally. The property names do not change — what they mean does.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'row', label: 'flex-direction: row', note: 'main axis →, cross axis ↓' },
        { id: 'justify', label: 'justify-content', note: 'along the main axis' },
        { id: 'align', label: 'align-items', note: 'along the cross axis' },
        { id: 'column', label: 'flex-direction: column', note: 'main axis ↓, cross axis →' },
      ],
      edges: [
        { from: 'row', to: 'justify', label: 'moves items left/right' },
        { from: 'row', to: 'align', label: 'moves items up/down' },
        { from: 'column', to: 'justify', label: 'now moves items up/down' },
        { from: 'column', to: 'align', label: 'now moves items left/right' },
      ],
    },
  },
  {
    id: 'css-grid-tracks',
    topic: 'css',
    level: 4,
    title: 'What a fraction is a fraction of',
    alt: 'A 900px container with grid-template-columns: 200px 1fr 2fr and no gap. The fixed track takes 200px first. The remaining 700px is then divided into three parts, because 1fr + 2fr is three: the 1fr track gets 233.33px and the 2fr track gets 466.67px. A fraction is a share of what is left after the fixed tracks, never a share of the container.',
    assumes: 'A 900px container with gap: 0.',
    body: {
      kind: 'table',
      columns: ['Track', 'Declared', 'Computed'],
      rows: [
        ['1', '200px', '200px'],
        ['2', '1fr', '233.33px'],
        ['3', '2fr', '466.67px'],
        ['—', '900px', '900px'],
      ],
      marks: [{ row: 3, role: 'total' }],
    },
  },
  {
    id: 'css-stacking',
    topic: 'css',
    level: 5,
    title: 'Why z-index: 9999 lost',
    alt: 'A dialog with z-index: 9999 sits inside a card with opacity: 0.99. The opacity created a stacking context, so the dialog is stacked inside the card and its 9999 only competes with the card\'s other children. The card itself has z-index: 1, and the header beside it has z-index: 2 — so the header covers the whole card, dialog included. Raising 9999 higher changes nothing; removing the opacity does.',
    body: {
      kind: 'nested',
      layers: [
        { label: 'root stacking context' },
        { label: 'header — z-index: 2', note: 'wins' },
        { label: 'card — z-index: 1, opacity: 0.99', note: 'creates a stacking context' },
        { label: 'dialog — z-index: 9999', note: 'trapped inside the card' },
      ],
    },
  },

  /* ── JavaScript ──────────────────────────────────────────────────────── */
  {
    id: 'js-map-trace',
    topic: 'javascript',
    level: 6,
    title: 'map keeps the length',
    alt: 'Running [3, 1, 4].map(n => n * 2). Step 1: 3 becomes 6. Step 2: 1 becomes 2. Step 3: 4 becomes 8. The result is [6, 2, 8] — three in, three out. map always returns an array the same length as the one it walked, whatever the callback returns.',
    body: {
      kind: 'steps',
      legend: ['index 0', 'index 1', 'index 2'],
      frames: [
        { cells: ['3', '1', '4'], note: 'The array before anything runs.' },
        { cells: ['6', '1', '4'], marks: [{ index: 0, role: 'changed' }], note: '3 × 2 = 6.' },
        { cells: ['6', '2', '4'], marks: [{ index: 1, role: 'changed' }], note: '1 × 2 = 2.' },
        { cells: ['6', '2', '8'], marks: [{ index: 2, role: 'changed' }], note: '4 × 2 = 8. Three in, three out.' },
      ],
    },
  },
  {
    id: 'js-filter-trace',
    topic: 'javascript',
    level: 7,
    title: 'filter keeps the values',
    alt: 'Running [3, 1, 4].filter(n => n > 2). 3 is kept because 3 > 2. 1 is dropped because 1 is not greater than 2. 4 is kept. The result is [3, 4]: the values are unchanged and only the length differs. That is the opposite of map, which keeps the length and changes the values.',
    body: {
      kind: 'steps',
      legend: ['index 0', 'index 1', 'index 2'],
      frames: [
        { cells: ['3', '1', '4'], note: 'The array before anything runs.' },
        { cells: ['3', '1', '4'], marks: [{ index: 0, role: 'kept' }], note: '3 > 2 is true.' },
        { cells: ['3', '1', '4'], marks: [{ index: 1, role: 'dropped' }], note: '1 > 2 is false.' },
        { cells: ['3', '4'], marks: [{ index: 1, role: 'kept' }], note: '4 > 2 is true. Result: [3, 4].' },
      ],
    },
  },
  {
    id: 'js-reduce-trace',
    topic: 'javascript',
    level: 8,
    title: 'reduce carries one value along',
    alt: 'Running [3, 1, 4].reduce((acc, n) => acc + n, 0). The accumulator starts at 0, the initial value. After the first element it is 3, after the second 4, after the third 8. The result is the number 8 — not an array. reduce is the one that can change the shape entirely, which is why the initial value decides what shape you get.',
    body: {
      kind: 'steps',
      legend: ['index 0', 'index 1', 'index 2'],
      frames: [
        { cells: ['3', '1', '4'], note: 'The accumulator starts at the initial value.', counter: { label: 'acc', value: '0' } },
        { cells: ['3', '1', '4'], marks: [{ index: 0, role: 'reading' }], note: '0 + 3.', counter: { label: 'acc', value: '3' } },
        { cells: ['3', '1', '4'], marks: [{ index: 1, role: 'reading' }], note: '3 + 1.', counter: { label: 'acc', value: '4' } },
        { cells: ['3', '1', '4'], marks: [{ index: 2, role: 'reading' }], note: '4 + 4. The result is a number, not an array.', counter: { label: 'acc', value: '8' } },
      ],
    },
  },
  {
    id: 'js-reference',
    topic: 'javascript',
    level: 5,
    title: 'Two names, one object',
    alt: 'const a = { n: 1 }; const b = a; b.n = 2. There is one object and two names pointing at it, so a.n is now 2 as well. const stopped the name being reassigned; it did nothing to the object. Copying with { ...a } instead makes a second object, and changing one then leaves the other alone.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'a', label: 'const a' },
        { id: 'b', label: 'const b = a' },
        { id: 'obj', label: '{ n: 2 }', note: 'one object in memory' },
        { id: 'copy', label: 'const c = { ...a }' },
        { id: 'obj2', label: '{ n: 1 }', note: 'a second object' },
      ],
      edges: [
        { from: 'a', to: 'obj', label: 'points at' },
        { from: 'b', to: 'obj', label: 'points at the same one' },
        { from: 'copy', to: 'obj2', label: 'points at its own' },
      ],
    },
  },
  {
    id: 'js-async-order',
    topic: 'javascript',
    level: 22,
    title: 'The order the lines actually run in',
    alt: 'Given: console.log("A"); setTimeout(() => console.log("D"), 0); Promise.resolve().then(() => console.log("C")); console.log("B"). The output is A, B, C, D. A and B are synchronous and run first, in order. C is a promise callback and runs as soon as the synchronous work finishes. D was queued with a timer and runs after that, even at zero milliseconds — zero means "as soon as possible", not "now".',
    assumes: 'One JavaScript runtime, nothing else queued.',
    body: {
      kind: 'steps',
      legend: ['output'],
      frames: [
        { cells: ['A'], note: 'Synchronous. Runs where it is written.' },
        { cells: ['A', 'B'], marks: [{ index: 1, role: 'synchronous' }], note: 'Also synchronous — the two calls above it only queued work.' },
        { cells: ['A', 'B', 'C'], marks: [{ index: 2, role: 'promise callback' }], note: 'The promise callback runs as soon as the synchronous work is done.' },
        { cells: ['A', 'B', 'C', 'D'], marks: [{ index: 3, role: 'timer' }], note: 'The timer callback runs last, even at 0 ms.' },
      ],
    },
  },

  /* ── TypeScript ──────────────────────────────────────────────────────── */
  {
    id: 'ts-narrowing',
    topic: 'typescript',
    level: 11,
    title: 'What the compiler knows in each branch',
    alt: 'A value typed string | number | null. Inside if (value === null) it is null. Inside else if (typeof value === "string") it is string, so .toUpperCase() is allowed. In the final else it is number, because nothing else is left — the compiler narrowed it by elimination, without being told. Outside all three branches it is still string | number | null, and none of those methods are available.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'start', label: 'string | number | null' },
        { id: 'null', label: 'value === null', note: 'here it is null' },
        { id: 'str', label: 'typeof value === "string"', note: 'here it is string' },
        { id: 'num', label: 'else', note: 'here it is number, by elimination' },
      ],
      edges: [
        { from: 'start', to: 'null', label: 'first branch' },
        { from: 'start', to: 'str', label: 'second branch' },
        { from: 'start', to: 'num', label: 'everything left' },
      ],
    },
  },

  /* ── React ───────────────────────────────────────────────────────────── */
  {
    id: 'react-data-flow',
    topic: 'react',
    level: 3,
    title: 'Data goes down, events come up',
    alt: 'A parent holds the state and passes two props to a child: the value, and a function to call. The child renders the value and calls the function when the user acts. The child never changes the value itself — it reports what happened, and the parent decides what the new state is. That is why two children can stay in step: they read from the same place.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'parent', label: 'Parent — holds the state' },
        { id: 'child', label: 'Child — renders it' },
      ],
      edges: [
        { from: 'parent', to: 'child', label: 'props: the value' },
        { from: 'parent', to: 'child', label: 'props: a function to call' },
        { from: 'child', to: 'parent', label: 'calls it — “the user did this”' },
      ],
    },
  },
  {
    id: 'react-state-updates',
    topic: 'react',
    level: 8,
    title: 'Why two increments added one',
    alt: 'count is 0. A handler calls setCount(count + 1) twice. Both calls read the same count for this render, which is 0, so both schedule "set it to 1" and the result is 1. Written as setCount(c => c + 1) twice, each call receives the value the previous one produced, so the result is 2. The difference is whether the update reads a captured value or the latest one.',
    body: {
      kind: 'steps',
      legend: ['count'],
      frames: [
        { cells: ['0'], note: 'Before the handler runs.' },
        { cells: ['0'], marks: [{ index: 0, role: 'read as 0' }], note: 'setCount(count + 1) — count is 0 for this render, so this schedules 1.' },
        { cells: ['0'], marks: [{ index: 0, role: 'read as 0 again' }], note: 'The second call reads the same 0 and schedules 1 as well.' },
        { cells: ['1'], marks: [{ index: 0, role: 'result' }], note: 'One increment took effect. With c => c + 1 both would, giving 2.' },
      ],
    },
  },

  /* ── Databases ───────────────────────────────────────────────────────── */
  {
    id: 'db-join',
    topic: 'databases',
    level: 6,
    title: 'The same query, two joins',
    alt: 'Two fixture tables. users: (1, Ada), (2, Bo), (3, Cy). orders: (10, user 1), (11, user 1), (12, user 2). An INNER JOIN on user id returns three rows — Ada twice and Bo once — and Cy does not appear at all, because Cy has no order. A LEFT JOIN returns four rows: the same three, plus Cy with NULL for every order column. Ada appearing twice is not a bug; it is one row per match.',
    body: {
      kind: 'table',
      columns: ['user', 'order (INNER)', 'order (LEFT)'],
      rows: [
        ['Ada', '10', '10'],
        ['Ada', '11', '11'],
        ['Bo', '12', '12'],
        ['Cy', '—', 'NULL'],
      ],
      marks: [{ row: 3, role: 'only in the LEFT JOIN' }],
    },
  },

  /* ── DSA ─────────────────────────────────────────────────────────────── */
  {
    id: 'dsa-stack',
    topic: 'dsa',
    level: 6,
    title: 'A stack: last in, first out',
    alt: 'Push A, push B, push C, then pop. The stack after each step: [A], [A B], [A B C], then [A B] with C returned. The pop returns C, the most recent thing pushed, because both operations work on the same end. That end is the only one a stack lets you touch, which is what makes both operations constant time.',
    body: {
      kind: 'steps',
      legend: ['bottom'],
      frames: [
        { cells: ['A'], marks: [{ index: 0, role: 'top' }], note: 'push A.' },
        { cells: ['A', 'B'], marks: [{ index: 1, role: 'top' }], note: 'push B.' },
        { cells: ['A', 'B', 'C'], marks: [{ index: 2, role: 'top' }], note: 'push C.' },
        { cells: ['A', 'B'], marks: [{ index: 1, role: 'top' }], note: 'pop returns C — the last one in.' },
      ],
    },
  },
  {
    id: 'dsa-queue',
    topic: 'dsa',
    level: 7,
    title: 'A queue: first in, first out',
    alt: 'Enqueue A, enqueue B, enqueue C, then dequeue. The queue after each step: [A], [A B], [A B C], then [B C] with A returned. The dequeue returns A, the oldest item, because a queue adds at one end and removes at the other. Same storage as a stack, opposite discipline — and the discipline is what the structure is for.',
    body: {
      kind: 'steps',
      legend: ['front'],
      frames: [
        { cells: ['A'], marks: [{ index: 0, role: 'front' }], note: 'enqueue A.' },
        { cells: ['A', 'B'], marks: [{ index: 0, role: 'front' }], note: 'enqueue B — it joins the back.' },
        { cells: ['A', 'B', 'C'], marks: [{ index: 0, role: 'front' }], note: 'enqueue C.' },
        { cells: ['B', 'C'], marks: [{ index: 0, role: 'front' }], note: 'dequeue returns A — the first one in.' },
      ],
    },
  },
  {
    id: 'dsa-binary-search',
    topic: 'dsa',
    level: 10,
    title: 'Halving a sorted array',
    alt: 'Searching for 23 in [2, 5, 8, 12, 16, 23, 38, 56] — eight sorted values, taking the lower middle when the window has an even length. Step 1: the middle is 12 at index 3, which is less than 23, so the whole left half and 12 itself are discarded. Step 2: the window is [16, 23, 38, 56] and its middle is 23 — found, in two comparisons. Scanning from the left would have taken six, because 23 is the sixth value. Sorted order is the precondition: on an unsorted array this finds nothing.',
    assumes: 'The array is sorted ascending; the lower middle is taken when the window has an even length.',
    body: {
      kind: 'steps',
      legend: ['sorted values'],
      frames: [
        { cells: ['2', '5', '8', '12', '16', '23', '38', '56'], marks: [{ index: 3, role: 'middle' }], note: 'The middle is 12, and 12 < 23 — so the left half and 12 itself are gone.' },
        { cells: ['16', '23', '38', '56'], marks: [{ index: 1, role: 'middle' }], note: 'Four values left; the lower middle is 23.' },
        { cells: ['16', '23', '38', '56'], marks: [{ index: 1, role: 'found' }], note: 'Found in two comparisons. Scanning from the left would have taken six.' },
      ],
    },
  },
  {
    id: 'dsa-growth',
    topic: 'dsa',
    level: 2,
    title: 'What the notation is actually saying',
    alt: 'Rough operation counts as the input grows. At n = 10: constant 1, logarithmic 3, linear 10, linearithmic 33, quadratic 100. At n = 1000: constant 1, logarithmic 10, linear 1000, linearithmic 9966, quadratic 1000000. The point is not the exact numbers — it is that the gap between the rows widens with n, which is why the shape of the growth matters more than the speed of any one step.',
    body: {
      kind: 'table',
      columns: ['Growth', 'n = 10', 'n = 1000'],
      rows: [
        ['O(1)', '1', '1'],
        ['O(log n)', '3', '10'],
        ['O(n)', '10', '1 000'],
        ['O(n log n)', '33', '9 966'],
        ['O(n²)', '100', '1 000 000'],
      ],
      marks: [{ row: 4, role: 'grows fastest' }],
    },
  },

  /* ── General ─────────────────────────────────────────────────────────── */
  {
    id: 'general-request',
    topic: 'general',
    level: 2,
    title: 'One click, end to end',
    alt: 'A click becomes a request: the browser resolves the domain to an address, opens a connection, and sends an HTTP request. A server receives it, usually reads or writes a database, and sends back a status and a body. The browser then renders the result. Every step can fail on its own, which is why a status code tells you which one did.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'browser', label: 'Browser' },
        { id: 'dns', label: 'Domain lookup', note: 'name → address' },
        { id: 'server', label: 'Server' },
        { id: 'db', label: 'Database' },
      ],
      edges: [
        { from: 'browser', to: 'dns', label: 'where is example.com?' },
        { from: 'browser', to: 'server', label: 'GET /page — an HTTP request' },
        { from: 'server', to: 'db', label: 'read or write' },
        { from: 'server', to: 'browser', label: '200 and a body, or an error status' },
      ],
    },
  },
  {
    id: 'general-test-scope',
    topic: 'general',
    level: 16,
    title: 'What each kind of test can prove',
    alt: 'Three scopes, and the question each one can answer. A unit test runs one function and answers "does this function do what it says?" — fast, and blind to how the pieces fit together. An integration test runs several pieces together and answers "do these agree on the contract between them?" — slower, and blind to the browser. An end-to-end test drives the real thing and answers "can a person do this?" — slowest, most fragile, and the only one that catches a broken button. None of them proves the change is safe; each proves the checks that ran passed.',
    body: {
      kind: 'table',
      columns: ['Scope', 'Answers', 'Blind to'],
      rows: [
        [
          'Unit',
          'Does this function do what it says?',
          'How the pieces fit together',
        ],
        [
          'Integration',
          'Do these pieces agree on their contract?',
          'The browser and the user',
        ],
        [
          'End-to-end',
          'Can a person actually do this?',
          'Nothing — but it is slow and fragile',
        ],
      ],
    },
  },

  /* ── Node ────────────────────────────────────────────────────────────── */
  {
    id: 'node-streams',
    topic: 'nodejs',
    level: 10,
    title: 'Why a stream reads a 2 GB file on a 512 MB box',
    alt: 'Reading a file whole loads all of it into memory before anything can use it, so a 2 GB file needs 2 GB of memory. Reading it as a stream delivers it in chunks — 64 KB at a time by default — and each chunk can be processed and released before the next arrives, so the memory needed is one chunk rather than one file. The total work is the same; what changes is how much of it exists at once.',
    assumes: 'Default highWaterMark of 64 KB for a file stream.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'file', label: 'A 2 GB file' },
        { id: 'whole', label: 'readFile', note: 'needs 2 GB of memory' },
        { id: 'stream', label: 'createReadStream', note: 'needs one chunk' },
        { id: 'out', label: 'Your code' },
      ],
      edges: [
        { from: 'file', to: 'whole', label: 'all of it, then start' },
        { from: 'file', to: 'stream', label: '64 KB at a time' },
        { from: 'whole', to: 'out', label: 'one very large value' },
        { from: 'stream', to: 'out', label: 'a chunk, released, repeat' },
      ],
    },
  },

  /* ── System design ───────────────────────────────────────────────────── */
  {
    id: 'sd-load-balancing',
    topic: 'system-design',
    level: 4,
    title: 'What a load balancer has to know',
    alt: 'One address in front of three servers. The balancer sends each request to one of them and stops sending to any server that fails its health check. Two things this only works with: the servers must be interchangeable, so a request can go to any of them, and session state must not live in a server\'s memory, or a learner signed in on server 1 is signed out the moment they land on server 2. Sticky routing hides that problem rather than fixing it.',
    body: {
      kind: 'flow',
      nodes: [
        { id: 'client', label: 'Clients' },
        { id: 'lb', label: 'Load balancer', note: 'one address' },
        { id: 's1', label: 'Server 1' },
        { id: 's2', label: 'Server 2' },
        { id: 's3', label: 'Server 3', note: 'failing its health check' },
        { id: 'store', label: 'Shared session store' },
      ],
      edges: [
        { from: 'client', to: 'lb', label: 'every request' },
        { from: 'lb', to: 's1', label: 'forwarded' },
        { from: 'lb', to: 's2', label: 'forwarded' },
        { from: 'lb', to: 's3', label: 'skipped while unhealthy' },
        { from: 's1', to: 'store', label: 'session read from here, not memory' },
        { from: 's2', to: 'store', label: 'so any server can serve anyone' },
      ],
    },
  },
];

/* ── lookup and validation ─────────────────────────────────────────────── */

const BY_LEVEL = new Map<string, LessonFigure[]>();
for (const figure of LESSON_FIGURES) {
  const key = `${figure.topic}:${figure.level}`;
  BY_LEVEL.set(key, [...(BY_LEVEL.get(key) ?? []), figure]);
}

/**
 * The figures for one level.
 *
 * `phase` decides whether the ones held back until after the assessment are
 * included. Before submission the learner sees neutral context only; a figure
 * that would answer the question is not shown early and then apologised for.
 */
export function figuresFor(
  topic: string,
  level: number,
  phase: 'before' | 'after' = 'before',
): LessonFigure[] {
  return visibleFigures(BY_LEVEL.get(`${topic}:${level}`) ?? [], phase);
}

/** The phase filter on its own, so the rule can be checked against a figure
 * that is marked — none of the authored ones is today, and the mechanism has to
 * work the first time an author needs it. */
export const visibleFigures = (
  figures: readonly LessonFigure[],
  phase: 'before' | 'after',
): LessonFigure[] =>
  phase === 'after' ? [...figures] : figures.filter((figure) => !figure.afterSubmission);

/** A plain `value` is a measurement, a count or a literal, and every real one
 * is a single token. Prose belongs in a note: whitespace is the cheap tell,
 * and it costs nothing to refuse. */
const neutral = (id: string, value: string): string[] =>
  /\s/.test(value) || !value.trim()
    ? [`${id} has prose in a value "${value}"; use a note instead`]
    : [];

/** A position or level is a whole number in range. `NaN` fails no comparison
 * and 1.5 passes both, and either one matches nothing, so the figure or its
 * mark would quietly never show. */
const isIndex = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

/** Structural problems an authoring mistake would introduce. Empty is correct.
 * `figures` defaults to the authored set; the contract also passes broken ones. */
export function validateFigures(
  levelCount: (topic: string) => number,
  figures: readonly LessonFigure[] = LESSON_FIGURES,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const figure of figures) {
    if (seen.has(figure.id)) problems.push(`duplicate figure ${figure.id}`);
    seen.add(figure.id);

    const levels = levelCount(figure.topic);
    if (levels === 0) problems.push(`${figure.id} names an unknown topic ${figure.topic}`);
    else if (!isIndex(figure.level, 1, levels)) {
      problems.push(`${figure.id} names level ${figure.level}, outside ${figure.topic}'s 1-${levels}`);
    }

    for (const [field, text] of [['title', figure.title], ['alt', figure.alt]] as const) {
      if (!text.trim()) problems.push(`${figure.id} has no ${field}`);
    }
    // The alt text is the figure, not a caption for it. A short one is a label
    // that has been mistaken for content.
    if (figure.alt.length < 120) problems.push(`${figure.id}'s alt text is too short to replace the figure`);
    if (/^(a |an |the )?(diagram|image|illustration|picture|figure)\b/i.test(figure.alt)) {
      problems.push(`${figure.id}'s alt text describes the picture instead of carrying its content`);
    }

    const body = figure.body;
    if (body.kind === 'flow') {
      const ids = new Set(body.nodes.map((node) => node.id));
      if (body.nodes.length === 0) problems.push(`${figure.id} has no nodes`);
      for (const edge of body.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) {
          problems.push(`${figure.id} has an edge between nodes that do not exist`);
        }
        // An unlabelled arrow means "somehow", which is the thing a diagram is
        // supposed to replace.
        if (!edge.label.trim()) {
          problems.push(`${figure.id} has an unlabelled arrow`);
        }
      }
    } else if (body.kind === 'nested') {
      if (body.layers.length < 2) problems.push(`${figure.id} has nothing nested`);
      for (const layer of body.layers) {
        if (!layer.label.trim()) problems.push(`${figure.id} has an empty layer label`);
        if (layer.note !== undefined && !layer.note.trim()) problems.push(`${figure.id} has an empty layer note`);
        if (layer.value !== undefined) problems.push(...neutral(figure.id, layer.value));
      }
    } else if (body.kind === 'table') {
      for (const row of body.rows) {
        if (row.length !== body.columns.length) problems.push(`${figure.id} has a row of the wrong width`);
      }
      for (const mark of body.marks ?? []) {
        if (!isIndex(mark.row, 0, body.rows.length - 1)) problems.push(`${figure.id} marks a row that is not there`);
        // A mark carries a word, so it is never colour alone.
        if (!mark.role.trim()) problems.push(`${figure.id} has a wordless mark`);
      }
    } else {
      if (body.frames.length < 2) problems.push(`${figure.id} is a sequence with nothing happening`);
      for (const frame of body.frames) {
        if (!frame.note.trim()) problems.push(`${figure.id} has a frame with no description`);
        if (frame.counter) problems.push(...neutral(figure.id, frame.counter.value));
        for (const mark of frame.marks ?? []) {
          if (!isIndex(mark.index, 0, frame.cells.length - 1)) {
            problems.push(`${figure.id} marks a cell that is not in the frame`);
          }
          if (!mark.role.trim()) problems.push(`${figure.id} has a wordless mark`);
        }
      }
    }
  }
  return problems;
}
