// Answers whose verdict is already known (Coding audit C2, 8 October 2026).
//
// KNOWN_WRONG_CODE lists mistakes that once passed every visible and hidden
// check of a task: each is the reference with one mistake put back in, or a
// whole submission when the mistake is the shape of the code. A hidden case
// was added for each, and `npm run test:coding` grades every entry the way
// production does and fails when one passes again. A `from` text missing from
// the reference means the reference moved: rewrite the entry, do not drop it.
//
// KNOWN_RIGHT_CODE lists correct answers a check once refused because it read
// something the statement does not ask for. Each must keep passing.
import { DSA_ADVANCED_WRONG } from './fixtures/dsa-advanced-known-answers';
import { FULLSTACK_APPS } from '../lib/coding/tasks/fullstack';
import { DSA_FOUNDATIONS_RIGHT, DSA_FOUNDATIONS_WRONG } from './fixtures/dsa-known-answers';

export interface KnownAnswer {
  id: string;
  label: string;
  /** Text swaps applied to the reference solution. */
  replace?: readonly (readonly [string, string])[];
  /** A whole submission, used instead of the reference. */
  code?: string;
}

const COLLECTION = { planner: 'tasks', stockroom: 'products', workshops: 'workshops' } as const;

const fullstackWrong = FULLSTACK_APPS.flatMap((app): KnownAnswer[] => {
  const { slug, amount } = app;
  return [
    {
      id: `js-fullstack-${slug}-1`,
      label: 'trimming the name before checking it is a string',
      code: `function normalizeInput(value){if(!value)return null;const name=value.name.trim();if(!name||name.length>80)return null;if(!Number.isInteger(value.${amount})||value.${amount}<0||value.${amount}>1000)return null;return {name,${amount}:value.${amount}};}`,
    },
    { id: `ts-fullstack-${slug}-3`, label: 'a POST that answers 201 and stores nothing', replace: [['rows.push(item);', '']] },
    { id: `ts-fullstack-${slug}-3`, label: `a POST to /api/${COLLECTION[slug]} that answers with the stored row itself`, replace: [['rows.push(item);return {status:201,body:{...item}};', 'rows.push(item);return {status:201,body:item};']] },
    { id: `ts-fullstack-${slug}-3`, label: 'any method but GET on the collection creating a row', replace: [["if(request.method==='POST'){const draft", '{const draft']] },
    { id: `ts-fullstack-${slug}-4`, label: 'a DELETE and a PATCH that answer correctly and change nothing', replace: [["if(request.method==='DELETE'){rows=rows.filter(r=>r.id!==id);", "if(request.method==='DELETE'){"], ['rows[index]=updated;', '']] },
    { id: `ts-fullstack-${slug}-4`, label: 'no DELETE branch at all', replace: [["if(request.method==='DELETE'){rows=rows.filter(r=>r.id!==id);return {status:200,body:{deleted:id}};}", '']] },
    { id: `ts-fullstack-${slug}-4`, label: 'a PATCH that answers with the stored row itself', replace: [['rows[index]=updated;return {status:200,body:{...updated}};', 'rows[index]=updated;return {status:200,body:updated};']] },
    { id: `ts-fullstack-${slug}-4`, label: 'any method but DELETE on an item running the PATCH branch', replace: [["if(request.method==='PATCH'){const p=request.body;", '{const p=request.body;']] },
  ];
});

export const KNOWN_WRONG_CODE: readonly KnownAnswer[] = [
  { id: 'js-mh-deep-equal', label: 'counts a hidden own key as an enumerable match',
    replace: [['Object.prototype.propertyIsEnumerable.call(b, key)', 'Object.hasOwn(b, key)']] },
  { id: 'js-mh-settings-diff', label: 'treats a hidden leaf as still present',
    replace: [['Object.prototype.propertyIsEnumerable.call(b, key)', 'Object.hasOwn(b, key)']] },
  ...fullstackWrong,
  ...DSA_FOUNDATIONS_WRONG,
  ...DSA_ADVANCED_WRONG,
  { id: 'ts-fullstack-links-2', label: 'a POST that answers with the stored link itself', replace: [['return reply(201, { ...link });', 'return reply(201, link);']] },
  { id: 'ts-fullstack-links-3', label: 'a POST and a visit that answer with the stored link itself', replace: [['return reply(201, { ...link });', 'return reply(201, link);'], ['return reply(200, { ...link });', 'return reply(200, link);']] },
  { id: 'ts-fullstack-links-3', label: 'any method on /api/links/SLUG deleting the link', replace: [['if (link && parts.length === 4 && method === "DELETE") {', 'if (link && parts.length === 4) {']] },
  { id: 'ts-fullstack-links-2', label: 'a POST with no body reading the fields of undefined', replace: [['if (typeof value !== "object" || value === null || Array.isArray(value)) return null;', 'if (value === null || Array.isArray(value)) return null;']] },
  { id: 'ts-fullstack-links-3', label: 'any last path segment counting a visit', replace: [['if (link && parts.length === 5 && parts[4] === "visit" && method === "POST") {', 'if (link && parts.length === 5 && method === "POST") {']] },
  { id: 'js-mh-match-route', label: 'never comparing literal segments', replace: [['if (!fits) return null;', '']] },
  { id: 'js-mh-match-route', label: 'a comparator that adds the ranks', replace: [['return left[i] - right[i];', 'return left[i] + right[i];']] },
  { id: 'alg-retry-backoff', label: 'a linear backoff', replace: [['await wait(100 * Math.pow(2, attempt - 1));', 'await wait(100 * attempt);']] },
  { id: 'js-evolving-query-2', label: 'an offset with no default', replace: [['const offset=options.offset??0;', 'const offset=options.offset;']] },
  ...['3', '4', '5'].map((stage): KnownAnswer => ({ id: `js-evolving-query-${stage}`, label: 'deduplicating without distinct', replace: [['if(options.distinct){', 'if(true){']] })),
  { id: 'js-evolving-events-5', label: 'replaying history to a plain subscription', replace: [['if(replay&&record)', 'if(record)']] },
  { id: 'alg-easy2-meetings-clash', label: 'flagging only a meeting inside the one before it', replace: [['if (sorted[i][0] < sorted[i - 1][1]) return true;', 'if (sorted[i][1] <= sorted[i - 1][1]) return true;']] },
  { id: 'alg-easy2-hand-out-snacks', label: 'sorting the appetites but not the snacks', replace: [['const sizes = [...snacks].sort((a, b) => a - b);', 'const sizes = [...snacks];']] },
  { id: 'js-mh2-folder-tree', label: 'sibling folders in insertion order', replace: [['const folders = names.filter(name => folder[name] !== null).sort();', 'const folders = names.filter(name => folder[name] !== null);']] },
  { id: 'js-path-logging-5', label: 'ranking by name with a bare sort()', replace: [['.sort((a, b) => b[1] - a[1])', '.sort()']] },
  { id: 'ts-path-generics-5', label: 'a comparator with no "less than" branch', replace: [['      if (left < right) return -1;\n', '']] },
  { id: 'ts-mh-apply-edits', label: 'reporting the last out-of-range edit', replace: [['edits.findIndex((edit) => !(Number.isInteger', 'edits.findLastIndex((edit) => !(Number.isInteger']] },
  { id: 'ts-mh-pick-from-warehouses', label: "working on the caller's east counts", replace: [['east: Object.assign(Object.create(null), stock.east),', 'east: stock.east as Partial<Record<string, number>>,']] },
  { id: 'ts-evolving-schema-2', label: 'taking any non-null non-array value for an object', replace: [["if(v===null||typeof v!=='object'||Array.isArray(v))", 'if(v===null||Array.isArray(v))']] },
  { id: 'alg-max-sum-subarray', label: 'accepting a fractional k', replace: [['!Number.isInteger(k) || k < 1', 'k < 1']] },
  { id: 'js-mh2-top-scores', label: 'taking the entry below an improving player off the board', replace: [['board.splice(old, 1);', 'board.splice(old, 2);']] },
  { id: 'js-remove-by-id', label: 'removing the last match', code: 'const removeById = (items, id) => { const index = items.findLastIndex(item => item.id === id); if (index === -1) return null; return items.splice(index, 1)[0]; };' },
  { id: 'ts-path-unions-5', label: 'flooring the total instead of rounding it', replace: [['Math.round(total * 100) / 100', 'Math.floor(total * 100) / 100']] },
  { id: 'ts-evolving-result-4', label: 'errors collected newest first', replace: [['errors.push(', 'errors.unshift(']] },
  { id: 'js-easy3-list-in-words', label: "taking the last word off the caller's list with pop()", code: 'function inWords(items) {\n  if (items.length < 2) return items.join("");\n  const last = items.pop();\n  return items.join(", ") + " and " + last;\n}\n' },
];

export const KNOWN_RIGHT_CODE: readonly KnownAnswer[] = [
  ...DSA_FOUNDATIONS_RIGHT,
  { id: "ts-only-the-strings", label: "a simple typeof guard with its predicate inferred by current TypeScript", code: "const isString=(value:unknown)=>typeof value === \"string\"; const onlyStrings=(values:unknown[]):string[]=>values.filter(isString);" },
  { id: 'ts-easy2-article-previews', label: 'a preview written title first', replace: [['({ id, title }));', '({ title, id }));']] },
  { id: 'ts-easy2-fields-from-the-api', label: 'a profile written avatar first', code: 'type ApiUser = { user_name: string; avatar_url?: string };\ntype Profile = { avatar: string | null; name: string };\n\nfunction toProfile(raw: ApiUser): Profile {\n  const { avatar_url: avatar = null, user_name: name } = raw;\n  return { avatar, name };\n}\n' },
];
