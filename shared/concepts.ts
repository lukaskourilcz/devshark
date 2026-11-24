/** Concepts, and the ones worth practising against each other.
 *
 * A category is a shelf: "javascript" says where a question lives, not what it
 * teaches. Scheduling and interleaving both need the smaller unit — the thing
 * being assessed — so this file names it, and names which of them are worth
 * putting side by side.
 *
 * The pedagogical claim is narrow and it is the only one made here: when two
 * ideas are confusable, practising them apart teaches each one and practising
 * them together teaches which one applies. Learners who only ever meet `reduce`
 * in a block of `reduce` questions get very good at reaching for `reduce`.
 *
 * What this file is not: it is not a taxonomy of everything devShark teaches,
 * and it does not try to be. A question that belongs to no concept here is
 * simply scheduled and ordered as an ordinary item. Adding a group is authoring
 * work — the coverage and the gaps are written down in
 * docs/practice-scheduling.md rather than inferred from how full this file
 * looks.
 *
 * Concepts are resolved from tags the question banks already carry, so nothing
 * here duplicates authoring that exists. A tag set that does not distinguish
 * two ideas — linear search from binary search, say — does not get a group
 * pretending it does. */

/** One idea a question can be about. */
export interface Concept {
  id: string;
  /** The category its questions live in. A concept never spans categories:
   * that would let a mix pull in a topic the learner has not unlocked. */
  topic: string;
  label: string;
  /** Tags that identify a question as being about this concept. A question
   * matches when it carries any of them. */
  tags: readonly string[];
}

/** Concepts that are worth practising against each other, and why. */
interface ConceptGroup {
  id: string;
  topic: string;
  label: string;
  /** What choosing between these actually is, in one line. Shown to the
   * learner as the reason a session is mixed. */
  contrast: string;
  concepts: readonly Concept[];
}

const g = (
  id: string,
  topic: string,
  label: string,
  contrast: string,
  concepts: readonly [string, string, readonly string[]][],
): ConceptGroup => ({
  id,
  topic,
  label,
  contrast,
  concepts: concepts.map(([cid, conceptLabel, tags]) => ({
    id: cid,
    topic,
    label: conceptLabel,
    tags,
  })),
});

const CONCEPT_GROUPS: readonly ConceptGroup[] = [
  g('js-array-transform', 'javascript',
    'Transforming an array',
    'Each of these walks the array once. What differs is what you get back.',
    [
      ['js-map', 'map', ['map']],
      ['js-filter', 'filter', ['filter']],
      ['js-reduce', 'reduce', ['reduce']],
    ]),
  g('js-async', 'javascript',
    'Sequencing asynchronous work',
    'Three ways to say "later". They differ in how failure travels.',
    [
      ['js-callbacks', 'Callbacks', ['Callbacks']],
      ['js-promises', 'Promises', ['Promises']],
      ['js-async-await', 'async / await', ['async']],
    ]),
  g('js-equality', 'javascript',
    'Equality and truthiness',
    'Whether two values are equal, and whether one is "true enough", are different questions.',
    [
      ['js-comparison', 'Comparison', ['Comparison']],
      ['js-coercion', 'Coercion', ['Coercion']],
      ['js-truthy', 'Truthiness', ['Truthy', 'Nullish']],
    ]),
  g('ts-shape', 'typescript',
    'Describing a shape',
    'Three ways to name a type. Which one you reach for changes what you can do next.',
    [
      ['ts-interfaces', 'Interfaces', ['Interfaces']],
      ['ts-aliases', 'Type aliases', ['Type aliases']],
      ['ts-unions', 'Unions', ['Unions']],
    ]),
  g('ts-narrowing', 'typescript',
    'Proving a type at runtime',
    'The compiler believes what it can check. These are the two ways of showing it.',
    [
      ['ts-narrowing', 'Narrowing', ['Narrowing']],
      ['ts-guards', 'Type guards', ['Type guards']],
    ]),
  g('react-state', 'react',
    'Holding state',
    'One value or a set of transitions — the choice is about how the updates relate.',
    [
      ['react-usestate', 'useState', ['useState']],
      ['react-usereducer', 'useReducer', ['useReducer']],
      ['react-derived', 'Derived state', ['Derived state']],
    ]),
  g('react-memo', 'react',
    'Memoising',
    'One caches a value, one caches a function. Mixing them up is the classic mistake.',
    [
      ['react-usememo', 'useMemo', ['useMemo']],
      ['react-usecallback', 'useCallback', ['useCallback']],
    ]),
  g('react-effects', 'react',
    'When an effect is the wrong tool',
    'Most of what people put in an effect belongs in an event handler instead.',
    [
      // `Cleanup` is deliberately not a concept of its own: every question
      // carrying it also carries `useEffect`, which resolves first, so a
      // separate concept would match nothing and be practised never.
      ['react-useeffect', 'useEffect', ['useEffect', 'Cleanup']],
      ['react-events', 'Events', ['Events']],
    ]),
  g('css-layout', 'css',
    'Laying out a page',
    'One arranges along a line, one arranges on a plane. Most layouts want both.',
    [
      ['css-flexbox', 'Flexbox', ['Flexbox']],
      ['css-grid', 'Grid', ['Grid']],
    ]),
  g('css-stacking', 'css',
    'Taking an element out of flow',
    'Where it sits and what it sits on top of are decided by different rules.',
    [
      ['css-positioning', 'Positioning', ['Positioning']],
      ['css-stacking', 'Stacking', ['Stacking']],
    ]),
  g('dsa-linear', 'dsa',
    'Which end you take from',
    'Same storage, opposite discipline — and the discipline is the whole point.',
    [
      ['dsa-stacks', 'Stacks', ['Stacks']],
      ['dsa-queues', 'Queues', ['Queues']],
    ]),
  g('dsa-lookup', 'dsa',
    'Finding something again',
    'Index, key or scan — the cost of the lookup is what separates them.',
    [
      ['dsa-arrays', 'Arrays', ['Arrays']],
      ['dsa-hash', 'Hash tables', ['Hash Tables']],
      ['dsa-searching', 'Searching', ['Searching']],
    ]),
  g('dsa-order', 'dsa',
    'Order and what it buys',
    'Sorting has an initial cost; later searches can benefit while the order stays valid.',
    [
      ['dsa-sorting', 'Sorting', ['Sorting']],
      ['dsa-complexity', 'Complexity', ['Complexity', 'Big-O']],
    ]),
  g('dsa-linked', 'dsa',
    'Structures with links in them',
    'A next link or child links — the structure decides how you walk it.',
    [
      ['dsa-lists', 'Linked lists', ['Linked Lists']],
      ['dsa-trees', 'Trees', ['Trees', 'BST']],
    ]),
  g('sec-identity', 'security',
    'Who you are and what you may do',
    'Proving identity and granting permission are separate, and confusing them is a vulnerability.',
    [
      ['sec-authn', 'Authentication', ['AuthN']],
      ['sec-authz', 'Authorization', ['AuthZ']],
    ]),
  g('sec-injection', 'security',
    'Content that came from somewhere else',
    'Three attacks with three different fixes, and they are regularly mistaken for one.',
    [
      ['sec-injection', 'Injection', ['Injection']],
      ['sec-xss', 'XSS', ['XSS']],
      ['sec-csrf', 'CSRF', ['CSRF']],
    ]),
  g('db-model', 'databases',
    'How the data is shaped',
    'The model decides which queries are cheap, which is a design decision and not a preference.',
    [
      ['db-sql', 'SQL', ['SQL']],
      ['db-nosql', 'NoSQL', ['NoSQL']],
    ]),
  g('db-cost', 'databases',
    'Why a query is slow',
    'A missing index and a query in a loop feel identical from the outside.',
    [
      ['db-indexing', 'Indexing', ['Indexing']],
      ['db-nplus1', 'N+1', ['N+1']],
    ]),
  g('node-io', 'nodejs',
    'Moving bytes',
    'One holds bytes, one delivers them over time. The choice is about how much memory you need at once.',
    [
      ['node-buffers', 'Buffers', ['Buffers']],
      ['node-streams', 'Streams', ['Streams']],
    ]),
  g('sd-copies', 'system-design',
    'More than one copy',
    'Copying the same data and splitting different data solve different problems.',
    [
      ['sd-replication', 'Replication', ['Replication']],
      ['sd-sharding', 'Sharding', ['Sharding']],
      ['sd-caching', 'Caching', ['Caching', 'CDN']],
    ]),
];

/* ── resolution ────────────────────────────────────────────────────────── */

const CONCEPTS: readonly Concept[] = CONCEPT_GROUPS.flatMap((group) => group.concepts);

const BY_ID = new Map(CONCEPTS.map((concept) => [concept.id, concept]));
const GROUP_OF = new Map<string, ConceptGroup>(
  CONCEPT_GROUPS.flatMap((group) => group.concepts.map((concept) => [concept.id, group] as const)),
);
// topic → [tag → concept id], so resolution is a lookup rather than a scan.
const BY_TOPIC_TAG = new Map<string, Map<string, string>>();
for (const concept of CONCEPTS) {
  const tags = BY_TOPIC_TAG.get(concept.topic) ?? new Map<string, string>();
  for (const tag of concept.tags) if (!tags.has(tag)) tags.set(tag, concept.id);
  BY_TOPIC_TAG.set(concept.topic, tags);
}

export const conceptById = (id: string): Concept | null => BY_ID.get(id) ?? null;

/**
 * The concept an item is about, or null.
 *
 * Deterministic: the first tag of the item that names a concept wins, in the
 * item's own tag order, so the same item always resolves the same way. Null is
 * an ordinary answer, not a failure — most items belong to no group.
 */
export function conceptOf(item: { category?: string; tags?: readonly string[] }): string | null {
  const tags = BY_TOPIC_TAG.get(item.category ?? '');
  if (!tags) return null;
  for (const tag of item.tags ?? []) {
    const id = tags.get(tag);
    if (id) return id;
  }
  return null;
}

/** Whether two concepts are worth putting side by side. */
export const areContrastable = (a: string, b: string): boolean =>
  a !== b && GROUP_OF.get(a) !== undefined && GROUP_OF.get(a) === GROUP_OF.get(b);

/** Every concept id, for validation and coverage reporting. */
export const CONCEPT_IDS: readonly string[] = CONCEPTS.map((concept) => concept.id);

/** Structural problems an authoring mistake would introduce. Empty is correct. */
export function validateConcepts(): string[] {
  const problems: string[] = [];
  const seenConcept = new Set<string>();
  const seenGroup = new Set<string>();
  for (const group of CONCEPT_GROUPS) {
    if (seenGroup.has(group.id)) problems.push(`duplicate group ${group.id}`);
    seenGroup.add(group.id);
    if (group.concepts.length < 2) problems.push(`group ${group.id} has nothing to contrast`);
    for (const concept of group.concepts) {
      if (seenConcept.has(concept.id)) problems.push(`concept ${concept.id} is in two groups`);
      seenConcept.add(concept.id);
      if (concept.topic !== group.topic) {
        problems.push(`concept ${concept.id} is not in its group's topic`);
      }
      if (concept.tags.length === 0) problems.push(`concept ${concept.id} matches nothing`);
      if (!concept.label.trim()) problems.push(`concept ${concept.id} has no label`);
    }
  }
  // Two concepts in the same topic must not claim the same tag, or resolution
  // would depend on which one this file happens to list first.
  const claimed = new Map<string, string>();
  for (const concept of CONCEPTS) {
    for (const tag of concept.tags) {
      const key = `${concept.topic}:${tag}`;
      const owner = claimed.get(key);
      if (owner && owner !== concept.id) {
        problems.push(`tag ${key} is claimed by both ${owner} and ${concept.id}`);
      }
      claimed.set(key, concept.id);
    }
  }
  return problems;
}
