import { DEFERRED_SEQUENTIAL_START, RETHROWING_SHARED_PROMISE } from './fixtures/async-contract-variants';
import { DEFERRED_BATCH_START } from './fixtures/deferred-batch-start';
import { runtimePolicyForTask } from '../shared/coding-task-runtime';
// Content contract for the coding catalogue.
//   npm run test:coding
// Local aids while content is being authored (never set in CI):
//   CODING_ALLOW_LEVEL_GAPS=1   allow Learn levels without a task
//   CODING_SKIP_INDEX=1         do not require shared/coding-index.ts to be fresh
//   CODING_COVERAGE_ENFORCED=1  fail on Easy-band technique gaps even while COVERAGE_ENFORCED is off
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CODING_TASKS, DSA_FOUNDATIONS_TASK_IDS, EASY_BAND_TASK_IDS, MEDIUM_HARD_BAND_TASK_IDS, playable } from '../lib/coding/catalog';
import { CODING_SUMMARIES, levelCodingTasks, tasksForLevel } from '../lib/coding/active';
import { solutionFor, solutionIds } from '../lib/coding/solutions';
import { stripComments } from '../lib/coding/solutions/strip-comments';
import { codingBoardContracts } from './coding-board-contract';
import {
  CODING_DIFFICULTIES,
  CODING_SECTION_TRACKS,
  CODING_TRACKS,
  STAGE_DIFFICULTY_BANDS,
  TIER_DIFFICULTY,
  difficultyFitsTier,
  difficultyOf,
  gardenPathFor,
  isCodingTaskId,
  isCodingTechnique,
  isCodingTier,
  isDifficulty,
  stageDifficulty,
  type CodingTier,
  type Difficulty,
} from '../shared/coding-catalog';
import { COVERAGE_ENFORCED, COVERAGE_MIN_EASY, coverageGaps, renderCoverage, techniqueCoverage } from './coding-coverage';
import { KNOWN_RIGHT_CODE, KNOWN_WRONG_CODE, type KnownAnswer } from './coding-known-answers';
import { DSA_CRITICAL_CRITERIA, DSA_FOUNDATIONS_WRONG } from './fixtures/dsa-known-answers';
import { DSA_FOUNDATIONS_TASKS } from '../lib/coding/tasks/dsa';
import { complexityGuidance } from '../shared/coding-complexity';
import { REACT_VARIANTS } from './coding-react-variants';
import { docsFor, taskResources } from '../shared/coding-docs';
import { approachCoverage, approachesFor } from '../lib/coding/approaches';
import { formatOf } from '../shared/coding-catalog';
import { runChecks, runInSandbox } from '../lib/coding/sandbox';
import { buildSandboxWorker } from './build-sandbox-worker.mjs';
import { presentPuzzle, puzzleCoverage, puzzleFor, resolvePuzzleOrder, type AuthoredPuzzle } from '../lib/coding/puzzles';
import { isAcceptedOrder, isCompleteOrder, PUZZLE_MAX_LINES, type PuzzleLine } from '../shared/coding-puzzle';
import { evaluateCalls, allPassed, deepEqual } from '../shared/coding-evaluate';
import { createTypeScript, isCheckerLibFile, typesPassed } from '../shared/coding-ts-check';
import { prepareReactRuntime, runReactSuite } from '../lib/coding/react-runner';
import { lockDownRealm } from '../lib/coding/realm-lockdown';
import { HIDDEN_CASE_PREFIX, splitHiddenCases, suiteCaseCount, withHiddenCases } from '../lib/coding/react-hidden';
import { renderCodingIndex } from './build-coding-index';
import { gradeDesign, prepareDesign } from '../lib/coding/grade';
import type { DesignAnswer } from '../shared/coding-api';
import { EVOLVING_CHALLENGES, evolvingResume, evolvingStage, evolvingUnlocked, evolvingTaskTrack, evolvingPassed, isEvolvingCheckpoint, listedChallenges } from '../shared/evolving';
import { SKELETON_FILLS } from './fixtures/skeleton-fills';
import { isFreeCodingTask } from '../shared/tiers';
import { evaluateInRunRealm } from './run-realm-node';

const ALLOW_GAPS = process.env.CODING_ALLOW_LEVEL_GAPS === '1';
const SKIP_INDEX = process.env.CODING_SKIP_INDEX === '1';
const ENFORCE_COVERAGE = COVERAGE_ENFORCED || process.env.CODING_COVERAGE_ENFORCED === '1';
// Prove only the solutions whose task id matches, e.g. CODING_ONLY='^ts-'
// while one file is being authored. The shape checks still cover everything.
// Never set in CI.
const ONLY = new RegExp(process.env.CODING_ONLY ?? '');
const nodeRequire = createRequire(import.meta.url);

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms))]);

// The cases a React suite declares, counted from its source the way the
// server counts them. The React proofs below check the count against the
// cases each run registered.
const hiddenCaseCount = suiteCaseCount;

// The hosts a hint ladder may end on: official documentation, never a blog.
const OFFICIAL_DOCS = new Set(['developer.mozilla.org', 'www.typescriptlang.org', 'react.dev']);

/* Two cheats the hidden checks must catch, written as solutions. */
type TypeScriptApi = typeof import('typescript');
type Check = { call: string; expected: unknown };

/** JavaScript source that evaluates to a fresh copy of an expected value. */
const literal = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(literal).join(', ')}]`;
  return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${literal(item)}`).join(', ')}}`;
};

/** `name(argument, …)` with a plain name as the callee, or null. */
const plainCall = (ts: TypeScriptApi, call: string): { name: string; args: string } | null => {
  const file = ts.createSourceFile('call.ts', `(${call.trim().replace(/;+$/, '')}\n)`, ts.ScriptTarget.Latest, true);
  const [statement] = file.statements;
  if (file.statements.length !== 1 || !ts.isExpressionStatement(statement)) return null;
  let expression = statement.expression;
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) return null;
  return { name: expression.expression.text, args: expression.arguments.map((arg) => arg.getText(file)).join(', ') };
};

/** A learner who copies the page's examples into a table: every visible
 * call answered with its visible answer, compared by value and key order
 * the way a JSON.stringify key would, and undefined for anything else. Null
 * when a visible check is not a plain call a table could answer. */
const lookupTable = (ts: TypeScriptApi, visible: readonly Check[]): string | null => {
  const rows = visible.map((test) => ({ call: plainCall(ts, test.call), expected: test.expected }));
  if (rows.some((row) => !row.call)) return null;
  const names = [...new Set(rows.map((row) => row.call!.name))];
  return [
    'const __same = (x, y) => { if (Object.is(x, y)) return true; if (typeof x === "function" || typeof y === "function") return typeof x === typeof y && String(x) === String(y); if (!x || !y || typeof x !== "object" || typeof y !== "object" || Array.isArray(x) !== Array.isArray(y)) return false; const kx = Object.keys(x), ky = Object.keys(y); return kx.length === ky.length && kx.every((k, i) => k === ky[i] && __same(x[k], y[k])); };',
    `const __table = {${names.map((name) => `${JSON.stringify(name)}: [${rows.filter((row) => row.call!.name === name).map((row) => `[() => [${row.call!.args}], () => (${literal(row.expected)})]`).join(', ')}]`).join(', ')}};`,
    ...names.map((name) => `function ${name}(...args) { for (const [input, output] of __table[${JSON.stringify(name)}]) if (__same(input(), args)) return output(); return undefined; }`),
  ].join('\n');
};

/** The first line of a skeleton that `filled` does not keep, or null when
 * every one is there, in order. A blank line, a line comment and a comment
 * alone on its line (in JSX braces or not) are holes the filling may replace
 * with any number of lines; inside a line, a comment stands for any text. */
const skeletonLineMissing = (skeleton: string, filled: string): string | null => {
  const literally = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lines = filled.split('\n').map((line) => line.trim());
  let at = 0;
  for (const raw of skeleton.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || /^\{?\/\*.*\*\/\}?$/.test(line)) continue;
    const pattern = new RegExp(`^${line.split(/\/\*.*?\*\//).map(literally).join('.*')}$`);
    while (at < lines.length && !pattern.test(lines[at])) at += 1;
    if (at === lines.length) return line;
    at += 1;
  }
  return null;
};

/** The names a solution declares at its top level. */
const topLevelNames = (ts: TypeScriptApi, source: string): string[] => {
  const names = new Set<string>();
  for (const statement of ts.createSourceFile('solution.ts', source, ts.ScriptTarget.Latest, true).statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
  }
  return [...names];
};

/** A React skeleton pasted into its starter with every placeholder left as
 * it is, the ways a learner would paste it. A skeleton that declares one of
 * the starter's top-level functions or components again stands in for those
 * declarations. Otherwise its statements open App's body and its markup,
 * from the first line that starts with < or {, goes after the starter's
 * heading; or the statements become App's whole body, returning that markup
 * in a <main> (or the starter's own return when the skeleton has no markup).
 * A starter whose App has no body gets the skeleton above App. */
const skeletonInStarter = (ts: TypeScriptApi, starter: string, skeleton: string): string[] => {
  const file = ts.createSourceFile('App.jsx', starter, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const functions = new Map<string, { statement: import('typescript').Statement; body: import('typescript').ConciseBody | undefined }>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, { statement, body: statement.body });
    if (!ts.isVariableStatement(statement)) continue;
    for (const one of statement.declarationList.declarations) {
      if (ts.isIdentifier(one.name) && one.initializer && (ts.isArrowFunction(one.initializer) || ts.isFunctionExpression(one.initializer))) functions.set(one.name.text, { statement, body: one.initializer.body });
    }
  }
  const redeclared = new Set([...skeleton.matchAll(/^(?:export\s+)?(?:const|let|function)\s+(\w+)/gm)].flatMap((match) => functions.get(match[1])?.statement ?? []));
  if (redeclared.size > 0) {
    const spans = [...redeclared].sort((a, b) => b.getStart() - a.getStart());
    return [spans.reduce((source, statement, index) => source.slice(0, statement.getStart()) + (index === spans.length - 1 ? skeleton : '') + source.slice(statement.getEnd()), starter)];
  }
  const app = functions.get('App');
  if (!app) return [];
  if (!app.body || !ts.isBlock(app.body)) return [`${starter.slice(0, app.statement.getStart())}${skeleton}\n\n${starter.slice(app.statement.getStart())}`];
  const lines = skeleton.split('\n');
  const markupAt = /^return\b/m.test(skeleton) ? -1 : lines.findIndex((line) => /^\s*[<{]/.test(line) && !/^\s*\{\s*$/.test(line) && !/=>\s*\{\s*$/.test(line));
  const statements = (markupAt === -1 ? lines : lines.slice(0, markupAt)).join('\n');
  const markup = markupAt === -1 ? '' : lines.slice(markupAt).join('\n');
  const open = app.body.getStart() + 1;
  const close = app.body.getEnd() - 1;
  const own = starter.slice(open, close);
  const ownReturn = /^return\b/m.test(skeleton) ? '' : app.body.statements.filter(ts.isReturnStatement).map((statement) => statement.getText(file)).join('\n');
  return [
    `${starter.slice(0, open)}\n${statements}\n${markup ? own.replace(/<\/h\d>/, (heading) => `${heading}\n<>${markup}</>`) : own}${starter.slice(close)}`,
    `${starter.slice(0, open)}\n${statements}\n${markup ? `return <main>${markup}</main>;` : ownReturn}\n${starter.slice(close)}`,
  ];
};

/** Every arrangement of a puzzle's lines whose code passes `checks`, found
 * without trying them all. The function's own first and last lines stay
 * first and last; any body line without a brace may also stand outside the
 * function, before or after it (a loop or a branch out there cannot see the
 * parameters). Arrangements grow line by line, and whenever the lines placed
 * so far close every block they open, they run on their own as the whole
 * body: a check they already throw on or answer wrongly fails every way of
 * finishing them, so that branch stops there. */
const passingArrangements = (puzzle: Pick<AuthoredPuzzle, 'lines'>, checks: readonly Check[]): string[][] => {
  const depthOf = (code: string) => {
    const bare = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '');
    return (bare.match(/\{/g)?.length ?? 0) - (bare.match(/\}/g)?.length ?? 0);
  };
  const header = puzzle.lines[0];
  const footer = puzzle.lines[puzzle.lines.length - 1];
  const body = puzzle.lines.slice(1, -1);
  const name = /^\s*function\s+([A-Za-z_$][\w$]*)\s*\(.*\{\s*$/.exec(header.code)?.[1];
  assert.ok(name && footer.code.trim() === '}', 'a puzzle is one function: its first line opens it and its last line closes it');
  // A body cut short reads as the start of the full one only while nothing
  // later in it is hoisted.
  assert.ok(body.every((line) => !/\b(var|function)\b/.test(line.code)), 'a puzzle body declares nothing with var or function');
  // Every loop gets a step budget, so an arrangement that never leaves one fails instead of hanging.
  const guard = (code: string) => (/^\s*(while|for|do)\b.*\{\s*$/.test(code) ? `${code} __step();` : code);
  const callers = checks.map((check) => new Function(name, `"use strict"; return (${check.call});`) as (fn: unknown) => unknown);
  const END = Symbol('end');
  // Authored checks may wrap a function result in an array/record to verify
  // input preservation. Falling through an unfinished prefix then puts END
  // inside that wrapper; it is still undecided, rather than an incorrect
  // complete result that may prune an otherwise valid puzzle arrangement.
  const containsEnd = (value: unknown, seen = new Set<object>()): boolean => {
    if (value === END) return true;
    if (value === null || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    return Object.values(value).some(item => containsEnd(item, seen));
  };
  // `open`: the body stops early, and falling off its end returns END.
  const run = (top: PuzzleLine[], placed: PuzzleLine[], open: boolean): 'pass' | 'fail' | 'open' => {
    const code = [...top, header, ...placed].map((line) => guard(line.code)).concat(open ? ['return __end;'] : [], footer.code).join('\n');
    let fn: unknown;
    let reset: () => void;
    try {
      [fn, reset] = new Function('__end', `"use strict"; let __steps = 0; const __step = () => { if (++__steps > 10000) throw new Error('steps'); };\n${code}\nreturn [${name}, () => { __steps = 0; }];`)(END);
    } catch { return 'fail'; }
    let undecided = false;
    for (const [index, call] of callers.entries()) {
      reset();
      // A caller can turn END into false, a string, or an arithmetic error.
      // Track the unfinished return before its wrapper consumes the value;
      // such a prefix is undecided, not a failing complete arrangement.
      let returnedEnd = false;
      const tracked = (...args: unknown[]) => {
        const result = (fn as (...args: unknown[]) => unknown)(...args);
        if (containsEnd(result)) returnedEnd = true;
        return result;
      };
      let value: unknown;
      try { value = call(tracked); } catch {
        if (returnedEnd) { undecided = true; continue; }
        return 'fail';
      }
      if (returnedEnd || containsEnd(value)) undecided = true;
      else if (!deepEqual(value, checks[index].expected)) return 'fail';
    }
    return undecided ? 'open' : 'pass';
  };
  const permutations = <T>(items: T[]): T[][] => (items.length <= 1 ? [items] : items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])));
  const flat = body.filter((line) => !/[{}]/.test(line.code));
  const found: string[][] = [];
  for (let mask = 0; mask < 1 << flat.length; mask++) {
    const outside = flat.filter((_, i) => mask & (1 << i));
    const inside = body.filter((line) => !outside.includes(line));
    for (const top of permutations(outside)) {
      const walk = (placed: PuzzleLine[], rest: PuzzleLine[], depth: number): void => {
        if (rest.length === 0) {
          // Function declarations hoist, so the outside lines run the same wherever they split around it.
          if (depth === 1 && run(top, placed, false) === 'pass') {
            for (let split = 0; split <= top.length; split++) found.push([...top.slice(0, split), header, ...placed, footer, ...top.slice(split)].map((line) => line.id));
          }
          return;
        }
        if (placed.length > 0 && depth === 1 && run(top, placed, true) === 'fail') return;
        for (const [i, line] of rest.entries()) {
          const next = depth + depthOf(line.code);
          if (next >= 1) walk([...placed, line], [...rest.slice(0, i), ...rest.slice(i + 1)], next);
        }
      };
      walk([], inside, 1);
    }
  }
  return found;
};

// Every string a suite mentions: quoted literals (minus module names and ARIA
// role names) and the text of simple regular expressions.
const ARIA_ROLE = /^(button|textbox|checkbox|heading|listitem|list|combobox|option|alert|status|link|img|dialog|form|region|navigation|searchbox|spinbutton|radio|tab|tabpanel|table|row|cell|article|main|group|progressbar|separator|switch|menu|menuitem|tooltip|banner|contentinfo|complementary)$/;
const suiteStrings = (suite: string): string[] => {
  const found = new Set<string>();
  for (const match of suite.matchAll(/(['"`])((?:(?!\1)[^\\\n$]|\\.){1,80})\1/g)) {
    if (/^\.\/|^@testing|^react/.test(match[2]) || ARIA_ROLE.test(match[2])) continue;
    found.add(match[2].replace(/\\(.)/g, '$1'));
  }
  for (const match of suite.matchAll(/\/((?:[A-Za-z0-9 ,.'!?:-]|\\s){2,60})\/[gimsuy]*/g)) found.add(match[1].replace(/\\s/g, ' '));
  return [...found];
};

// Components with no state, effect, request or timer: one that renders
// nothing, and static pages that print every string the suite mentions as
// paragraphs, buttons or list items. A suite one of them passes checks that
// some text is on the page, not that the component does what the task asks.
const staticPages = (suite: string): [string, string][] => {
  const text = suiteStrings(suite).map((one) => `{${JSON.stringify(one)}}`);
  return [
    ['a component that renders nothing', 'const App = () => null;'],
    ['one static paragraph of the suite\'s strings', `const App = () => <main><p>${text.join(' ')}</p><button>ok</button><input /></main>;`],
    ['one static paragraph per suite string', `const App = () => <main>${text.map((one) => `<p>${one}</p>`).join('')}<button>ok</button><input /></main>;`],
    ['one static button per suite string', `const App = () => <main>${text.map((one) => `<button>${one}</button>`).join('')}<input /></main>;`],
    ['one static list item per suite string', `const App = () => <main><ul>${text.map((one) => `<li>${one}</li>`).join('')}</ul><button>ok</button><input /></main>;`],
  ];
};

// The Testing Library instance the React runner loaded (the runner loads it
// on its first suite), for its waitFor and findBy settings.
interface AsyncWaitConfig {
  getConfig(): { asyncUtilTimeout: number };
  configure(config: { asyncUtilTimeout: number }): void;
}
const testingLibrary = async (): Promise<AsyncWaitConfig> => {
  const loaded = await import('@testing-library/react');
  return ((loaded as { default?: AsyncWaitConfig }).default ?? loaded) as AsyncWaitConfig;
};

async function main() {
  codingBoardContracts();
  // The solutions are proven on the grader's worker thread, built fresh from
  // the sources under test, as the deployment runs it.
  await buildSandboxWorker();
  const failures: string[] = [];
  const fail = (message: string) => { failures.push(message); };

  // Optional whitespace must be exercised publicly and graded consistently.
  const calculator = CODING_TASKS.find(task => task.id === 'js-evolving-calculator-1')!;
  const calculatorChecks = [...calculator.tests!, ...solutionFor(calculator.id)!.hiddenTests!];
  const calculatorRun = await runInSandbox({code:'function calculate(s) { return s.split("+").reduce((sum, value) => sum + Number(value), 0); }', calls:calculatorChecks.map(test=>test.call), expectations:calculatorChecks.map(test=>test.expected)});
  assert.ok(allPassed(calculatorRun), 'valid addition must pass visible and hidden server checks');
  const spacingBug = await runInSandbox({code:'function calculate(s) { return s.trim().split(/\\s+/).filter(value => value !== "+").reduce((sum, value) => sum + Number(value), 0); }', calls:calculator.tests!.map(test=>test.call), expectations:calculator.tests!.map(test=>test.expected)});
  assert.ok(!allPassed(spacingBug), 'visible tests must expose space-dependent tokenization');

  assert.ok(EVOLVING_CHALLENGES.length >= 10, 'at least ten evolving projects');
  const stageIds = EVOLVING_CHALLENGES.flatMap(project => [...project.stages]);
  assert.equal(new Set(stageIds).size, stageIds.length, 'unique stable stage IDs');
  for (const project of EVOLVING_CHALLENGES) {
    if (project.short) {
      // A short path lives on its section's page: five levels at most, no
      // checkpoints, and a section that exists to list it.
      assert.ok(project.stages.length >= 3 && project.stages.length <= 5, `${project.id}: a short path has three to five levels`);
      assert.ok(project.stages.every(id => !id.endsWith('-start')), `${project.id}: a short path has no checkpoints`);
      assert.ok(project.category === 'fullstack' || CODING_SECTION_TRACKS.includes(project.track), `${project.id}: a short path belongs to a listed section`);
    } else {
      assert.ok(project.stages.length >= (project.category === 'fullstack' ? 6 : 5) && project.stages.length <= 12);
    }
    const passed = new Set<string>();
    for (const [index,id] of project.stages.entries()) {
      const task = CODING_TASKS.find(task => task.id === id);
      assert.ok(task, `${id}: authored task exists`);
      assert.equal(task.track, evolvingTaskTrack(id));
      assert.ok(task.references?.length && task.references.every(ref=>ref.title && ref.url.startsWith('https://')), 'each stage has localized references');
      // A checkpoint is built from its milestone. Its hint ladder has to be
      // its own, or it advises work the checkpoint has not asked for yet.
      if (id.endsWith('-start')) {
        const milestone = CODING_TASKS.find(one => one.id === id.slice(0, -6))!;
        if (!task.hints[0] || task.hints[0] === milestone.hints[0]) fail(`${id}: a checkpoint needs a first hint of its own, not its milestone's`);
        if (milestone.approach && JSON.stringify(task.approach) === JSON.stringify(milestone.approach)) fail(`${id}: a checkpoint needs method steps of its own, not its milestone's`);
      }
      assert.equal(evolvingResume(project, passed), id, 'resume is the first unfinished stage');
      assert.equal(evolvingUnlocked(id, passed), true, 'earlier verified passes unlock the next stage');
      if (index > 0) assert.equal(evolvingUnlocked(id, new Set()), false, 'deep links cannot skip prerequisites');
      assert.ok(!tasksForLevel(task.topic, task.level).some(item => item.id === id), 'optional projects never change Learn quotas');
      if (index > 0) {
        const prior = CODING_TASKS.find(task => task.id === project.stages[index-1])!;
        assert.deepEqual(task.previousRequirements?.[index-1], prior.prompt, 'earlier requirements remain available');
        // The new stage's checks lead, so the first rows in Results show what
        // the brief just asked for; every earlier check follows, unchanged.
        if (task.tests) {
          const introducedCount = task.tests.length - prior.tests!.length;
          assert.deepEqual(task.tests.slice(introducedCount), prior.tests, 'earlier runtime checks remain, after the new ones');
          const introduced = task.tests.slice(0, introducedCount);
          for (const check of introduced) {
            const matches = (other: typeof check) => other.call === check.call && isDeepStrictEqual(check, other);
            if (introduced.filter(matches).length === 1) {
              assert.ok(!prior.tests!.some(matches), `${id}: an unchanged inherited call appears twice: ${check.call}`);
            }
          }
        }
        if (task.suite && prior.suite) {
          // The shared header is whatever both suites open with, cut back to
          // a whole line: the imports, and for FullStack the runtime checks
          // and seed the UI checks depend on.
          let common = 0;
          while (common < prior.suite.length && prior.suite[common] === task.suite[common]) common += 1;
          const header = prior.suite.slice(0, prior.suite.lastIndexOf('\n', common - 1) + 1);
          assert.ok(header.length > 0 && task.suite.startsWith(header), `${id}: the suite keeps its header first`);
          assert.ok(task.suite.endsWith(prior.suite.slice(header.length)), `${id}: earlier UI checks remain, after the new ones`);
        }
      }
      passed.add(id);
    }
    assert.equal(evolvingResume(project, passed), project.stages.at(-1), 'finished projects reopen their final stage');
    assert.equal(evolvingUnlocked(project.stages.at(-1)!, new Set([project.stages.at(-2)!])), false, 'all prerequisites are required');
    const legacy = new Set(project.stages.filter(id => !id.endsWith('-start')));
    assert.ok(project.stages.every(id => evolvingPassed(id, legacy)), 'legacy milestone completion covers new prerequisites');
    assert.equal(evolvingResume(project, legacy), project.stages.at(-1), 'existing finishers remain finished');
  }
  assert.equal(evolvingStage('js-count-multiples'), null, 'ordinary tasks stay ordinary');

  /* ── shape ─────────────────────────────────────────────────────────── */
  const ids = new Set<string>();
  const legacy = new Set<string>();
  for (const task of CODING_TASKS) {
    const where = `${task.id} (${task.title})`;
    if (!isCodingTaskId(task.id)) fail(`${where}: id must be a track-prefixed slug`);
    if (ids.has(task.id)) fail(`${where}: duplicate id`);
    ids.add(task.id);
    if (task.legacyId) {
      if (legacy.has(task.legacyId)) fail(`${where}: duplicate legacy id ${task.legacyId}`);
      legacy.add(task.legacyId);
    }
    if (!CODING_TRACKS.includes(task.track)) fail(`${where}: unknown track ${task.track}`);
    if (task.track === 'system-design') {
      if (task.level !== 0) fail(`${where}: system design tasks carry no Learn level`);
    } else {
      // A DSA Foundations task sits on the algorithms track with a DSA topic,
      // whose levels run 1 to 15; every other task's topic is its track.
      const dsaTopic = task.track === 'algorithms' && (task.topic === 'dsa' || task.topic === 'dsa-advanced');
      if (task.topic !== task.track && !dsaTopic) fail(`${where}: topic must match the track, or be dsa or dsa-advanced on the algorithms track`);
      if (!Number.isInteger(task.level) || task.level < 1 || task.level > (dsaTopic ? 15 : 25)) fail(`${where}: level must be 1–${dsaTopic ? 15 : 25}`);
    }
    if (!isCodingTier(task.tier)) fail(`${where}: bad tier`);
    // An authored label may only move a task within what its tier allows.
    if (task.difficulty !== undefined) {
      if (!isDifficulty(task.difficulty)) fail(`${where}: unknown difficulty ${String(task.difficulty)}`);
      else if (!difficultyFitsTier(task.difficulty, task.tier)) fail(`${where}: ${task.difficulty} contradicts tier ${task.tier}`);
    }
    if (task.focus.length === 0) fail(`${where}: needs at least one technique tag`);
    for (const tag of task.focus) if (!isCodingTechnique(tag)) fail(`${where}: unknown technique tag ${tag}`);
    if (!(task.estimatedMinutes > 0)) fail(`${where}: estimatedMinutes must be positive`);
    if (task.hints.length === 0 && task.verify !== 'drill' && task.verify !== 'guided') fail(`${where}: needs a hint`);
    assert.ok(docsFor(task.focus).url.startsWith('https://'), `${where}: docs link`);
    // A code example in the brief, the hints or the method steps gets copied
    // into the editor, where `repeat(“hi”, 3)` is a SyntaxError.
    for (const text of [task.prompt, ...task.hints, ...(task.approach ?? [])]) {
      for (const span of text.split('`').filter((_, index) => index % 2 === 1)) {
        if (/[“”‘’]/.test(span)) fail(`${where}: the code example \`${span}\` uses curly quotes, which do not run`);
      }
    }
    assert.match(gardenPathFor(task), /^[a-z-]+\/\d{2}-[a-z0-9-]+\.(js|ts|jsx|md)$/, `${where}: garden path`);

    switch (task.verify) {
      case 'tests':
        if (task.track === 'react') {
          if (!task.suite?.includes('test(')) fail(`${where}: React task needs a suite`);
        } else {
          if (!task.tests || task.tests.length < 4) fail(`${where}: needs at least 4 test calls`);
          if (task.tests && !task.tests.some((t) => t.edge)) fail(`${where}: needs at least one edge case`);
          if (task.track === 'typescript' && (!task.typeTests || task.typeTests.length < 2)) fail(`${where}: TypeScript task needs type tests`);
          if (!solutionFor(task.id)) fail(`${where}: missing reference solution`);
        }
        if (task.track === 'react' && !solutionFor(task.id)) fail(`${where}: missing reference solution`);
        break;
      case 'checklist':
        if (!task.checklist || task.checklist.length < 2) fail(`${where}: checklist tasks need at least 2 items`);
        break;
      case 'guided':
        if (!task.design) { fail(`${where}: guided task needs a design`); break; }
        if (task.design.steps.length !== 5) fail(`${where}: a walkthrough has five steps`);
        for (const step of task.design.steps) {
          if (step.options.length < 3) fail(`${where}: step ${step.key} needs at least 3 options`);
          if (step.correct < 0 || step.correct >= step.options.length) fail(`${where}: step ${step.key} answer out of range`);
        }
        if (task.design.passMark < 1 || task.design.passMark > task.design.steps.length) fail(`${where}: bad pass mark`);
        break;
      case 'drill': {
        if (!task.drill) { fail(`${where}: drill task needs a drill`); break; }
        const d = task.drill;
        if (d.format === 'estimate' && !(typeof d.answer === 'number' && typeof d.min === 'number' && typeof d.max === 'number' && d.min <= d.answer && d.answer <= d.max && d.unit)) fail(`${where}: estimate needs answer, band and unit`);
        if ((d.format === 'tradeoff' || d.format === 'bottleneck') && !(d.options && d.options.length >= 3 && typeof d.correct === 'number' && d.correct >= 0 && d.correct < d.options.length)) fail(`${where}: choice drill needs options and a correct index`);
        if (d.format === 'sequence' && !(d.steps && d.steps.length >= 3)) fail(`${where}: sequence needs at least 3 steps`);
        // Another right order is a permutation of the authored steps, and not
        // the authored order itself.
        for (const order of d.acceptedOrders ?? []) {
          const steps = d.steps ?? [];
          const isPermutation = d.format === 'sequence' && order.length === steps.length && [...order].sort((a, b) => a - b).every((step, index) => step === index);
          if (!isPermutation || order.every((step, index) => step === index)) fail(`${where}: an accepted order must be another order of the authored steps`);
        }
        break;
      }
      default:
        fail(`${where}: unknown verify mode ${String(task.verify)}`);
    }

    // The playable projection must never carry an answer.
    const play = JSON.stringify(playable(task));
    if (task.design) {
      if (play.includes('"correct"') || play.includes(task.design.reference.slice(0, 40))) fail(`${where}: playable payload leaks the design answers`);
    }
    if (task.drill) {
      if (play.includes('"correct"') || play.includes('"answer"') || play.includes('"min"')) fail(`${where}: playable payload leaks the drill key`);
      if (task.drill.explanation && play.includes(task.drill.explanation.slice(0, 40))) fail(`${where}: playable payload leaks the drill explanation`);
    }
    const solution = solutionFor(task.id);
    for (const code of [solution?.solution, solution?.junior, solution?.senior]) {
      if (code && code.trim().length > 0 && play.includes(JSON.stringify(code).slice(1, -1))) fail(`${where}: playable payload leaks a solution`);
    }
  }
  for (const id of solutionIds()) if (!ids.has(id)) fail(`solution ${id} has no task`);

  // The junior and senior boards are read as code after a pass, so the notes
  // that explain them in the source must not travel. `solutionFor` strips
  // them except for an explicitly required planning preface; this asserts
  // that the rest of the text that actually ships is clean, and that
  // stripping it again would change nothing — a stripper that ate real code
  // would fail the solution proofs below instead.
  for (const id of solutionIds()) {
    const solution = solutionFor(id)!;
    const plan = solution.boardPlan?.trim();
    if (plan && stripComments(plan).trim() !== '') fail(`${id}: boardPlan must contain comments only`);
    for (const [kind, code] of [['junior', solution.junior], ['senior', solution.senior]] as const) {
      if (!code) continue;
      const prefix = plan ? `${plan}\n` : '';
      if (prefix && !code.startsWith(prefix)) fail(`${id}: the ${kind} board lost its required planning comments`);
      const body = prefix ? code.slice(prefix.length) : code;
      if (stripComments(body) !== body) fail(`${id}: the ${kind} board still carries an authoring comment`);
    }
  }
  for (const id of ['react-user-directory', 'react-posts-dashboard', 'react-comments-viewer', 'react-todo-client', 'react-product-explorer']) {
    if (!solutionFor(id)?.boardPlan?.trim()) fail(`${id}: both boards must retain the plan requested by the task`);
  }

  /* ── difficulty labels ─────────────────────────────────────────────── */
  // Easy, Medium and Hard are derived, so they are proven rather than read.
  // An override that contradicts its tier is refused.
  const refused: [Difficulty, CodingTier][] = [['easy', 3], ['easy', 4], ['easy', 5], ['hard', 1], ['hard', 2]];
  for (const [label, tier] of refused) assert.equal(difficultyFitsTier(label, tier), false, `an ${label} override cannot sit at tier ${tier}`);
  for (const tier of [1, 2, 3, 4, 5] as CodingTier[]) assert.equal(difficultyFitsTier('medium', tier), true, `a Medium override fits tier ${tier}`);
  assert.equal(difficultyOf({ id: 'js-count-multiples', tier: 3, difficulty: 'medium' }), 'medium', 'an authored label wins');
  // Milestones and levels read their position, in the bands the handoff fixed.
  const bandOf = (length: number) => Array.from({ length }, (_, index) => stageDifficulty(index, length)[0].toUpperCase()).join('');
  assert.equal(bandOf(5), 'EEMMH', 'five-level paths: 1–2 Easy, 3–4 Medium, 5 Hard');
  assert.equal(bandOf(10), 'EEEMMMMHHH', 'ten-stage projects: 1–3, 4–7, 8–10');
  assert.equal(bandOf(12), 'EEEEMMMMMHHH', 'twelve-stage FullStack apps: 1–4, 5–9, 10–12');
  // A checkpoint reads its tier, as a standalone task does: it is a
  // five-minute step wherever it sits (owner decision, 9 Oct 2026). The bands
  // used to call the last checkpoint of every project Hard (audit C2-13).
  const byId = new Map(CODING_TASKS.map((task) => [task.id, task]));
  let checkpoints = 0;
  for (const project of EVOLVING_CHALLENGES) {
    const length = project.stages.length;
    if (!STAGE_DIFFICULTY_BANDS[length]) { fail(`${project.id}: no difficulty band for a path of ${length} stages; add one to STAGE_DIFFICULTY_BANDS`); continue; }
    project.stages.forEach((id, index) => {
      const task = byId.get(id);
      if (!task || task.difficulty) return; // missing stages fail above; an authored label is bounded by its tier
      const checkpoint = isEvolvingCheckpoint(id);
      if (checkpoint) {
        checkpoints++;
        if (task.estimatedMinutes !== 5) fail(`${id}: a checkpoint is a five-minute step, not ${task.estimatedMinutes}`);
      }
      const expected = checkpoint ? TIER_DIFFICULTY[task.tier] : stageDifficulty(index, length);
      if (difficultyOf(task) !== expected) fail(`${id}: ${checkpoint ? 'a checkpoint at tier ' + task.tier : `stage ${index + 1} of ${length}`} should be ${expected}, not ${difficultyOf(task)}`);
    });
  }
  const authoredCheckpoints = EVOLVING_CHALLENGES.flatMap((project) => project.stages).filter(isEvolvingCheckpoint);
  if (checkpoints !== authoredCheckpoints.length) fail(`${authoredCheckpoints.length - checkpoints} checkpoint(s) carry an authored label instead of their tier`);
  // Standalone tasks read their tier: 1–2 Easy, 3 Medium, 4–5 Hard.
  for (const task of CODING_TASKS) {
    if (evolvingStage(task.id) || task.difficulty) continue;
    const label = difficultyOf(task);
    if (label !== TIER_DIFFICULTY[task.tier]) fail(`${task.id}: tier ${task.tier} should read ${TIER_DIFFICULTY[task.tier]}, not ${label}`);
    if (label === 'easy' && task.tier > 2) fail(`${task.id}: Easy at tier ${task.tier}`);
    if (label === 'hard' && task.tier < 3) fail(`${task.id}: Hard at tier ${task.tier}`);
  }
  // Every summary the browser reads carries exactly the label the task resolves to.
  const labelCounts = new Map<Difficulty, number>(CODING_DIFFICULTIES.map((label) => [label, 0]));
  for (const summary of CODING_SUMMARIES) {
    const task = byId.get(summary.id);
    if (!isDifficulty(summary.difficulty)) { fail(`${summary.id}: summary has no difficulty`); continue; }
    if (task && summary.difficulty !== difficultyOf(task)) fail(`${summary.id}: summary says ${summary.difficulty}, the task resolves to ${difficultyOf(task)}`);
    labelCounts.set(summary.difficulty, (labelCounts.get(summary.difficulty) ?? 0) + 1);
  }
  const labelTotal = [...labelCounts.values()].reduce((sum, n) => sum + n, 0);
  if (labelTotal !== CODING_SUMMARIES.length) fail(`difficulty labels cover ${labelTotal} of ${CODING_SUMMARIES.length} summaries`);

  /* ── Learn coverage ─────────────────────────────────────────────────── */
  for (const topic of ['javascript', 'typescript', 'react'] as const) {
    for (let level = 1; level <= 25; level++) {
      const tasks = tasksForLevel(topic, level);
      if (tasks.length === 0 && !ALLOW_GAPS) fail(`${topic} level ${level} has no coding task`);
      const chosen = levelCodingTasks(topic, level);
      if (chosen.some((t) => t.verify === 'checklist')) fail(`${topic} level ${level} would gate on a checklist task`);
    }
  }
  // DSA Foundations (#493): every level but the foundation review (15) has
  // aligned coding tasks; the closing foundation review assesses questions only.
  for (let level = 1; level <= 15; level++) {
    const tasks = tasksForLevel('dsa', level);
    if (level < 15 && tasks.length === 0 && !ALLOW_GAPS) fail(`dsa level ${level} has no coding task`);
    if (level === 15 && tasks.length > 0) fail('dsa level 15, the foundation review, has no coding task');
    const chosen = levelCodingTasks('dsa', level);
    const held = level === 15;
    if (held && chosen.length > 0) fail(`dsa level ${level} issues a coding task on the review-only level`);
    if (!held && chosen.length === 0 && !ALLOW_GAPS) fail(`dsa level ${level} issues no coding task`);
    if (chosen.some((t) => t.verify === 'checklist' || formatOf(t) === 'debug')) fail(`dsa level ${level} would gate on a checklist or repair task`);
  }
  // Advanced levels all seal aligned work, including the synthesis task.
  for (let level = 1; level <= 15; level++) {
    const chosen = levelCodingTasks('dsa-advanced', level);
    if (chosen.length === 0 && !ALLOW_GAPS) fail(`dsa-advanced level ${level} issues no coding task`);
    if (chosen.some(task => task.topic !== 'dsa-advanced' || task.level !== level)) fail(`dsa-advanced level ${level} seals misaligned work`);
  }
  if (levelCodingTasks('algorithms', 1).length > 0 || levelCodingTasks('system-design', 0).length > 0) fail('only the Learn coding topics seal coding into a level');

  /* ── DSA Foundations (#493) ─────────────────────────────────────────── */
  // The DSA path's code exercises became one task each (the binary search
  // was reused): on the algorithms track with topic dsa, an authored runtime
  // target, and a known wrong answer for every critical criterion of the path
  // activity it came from (a wrong entry with no criterion breaks the default
  // one, `core`). E5 (#496) retired the path, so those criteria now come from
  // DSA_CRITICAL_CRITERIA, copied from it. Section 5 of the known-answer run
  // grades each wrong answer and requires it to fail a check tagged with its
  // criterion.
  {
    if (DSA_FOUNDATIONS_TASK_IDS.size !== 29) fail(`DSA Foundations has ${DSA_FOUNDATIONS_TASK_IDS.size} tasks, not 29`);
    const recorded = Object.keys(DSA_CRITICAL_CRITERIA);
    if (recorded.length !== 29) fail(`DSA_CRITICAL_CRITERIA records ${recorded.length} retired path exercises, not 29`);
    for (const id of recorded) if (!DSA_FOUNDATIONS_TASK_IDS.has(id)) fail(`${id}: a retired path exercise with no DSA Foundations task`);
    for (const id of DSA_FOUNDATIONS_TASK_IDS) {
      const task = byId.get(id);
      if (!task) { fail(`${id}: a DSA Foundations id with no task`); continue; }
      if (task.track !== 'algorithms' || task.topic !== 'dsa') fail(`${id}: a DSA Foundations task is on the algorithms track with topic dsa`);
      if (complexityGuidance(task).targetTime === null) fail(`${id}: the prompt needs a Target: O(...) time sentence`);
      // The Results row prints `shown ?? call`: no probe source, and no row
      // longer than the catalogue's longest hand-written call (419).
      for (const test of task.tests ?? []) {
        const row = test.shown ?? test.call;
        if (row.length > 420 || row.includes('__probe')) fail(`${id}: the Results row for "${test.label ?? row.slice(0, 40)}" prints ${row.length} characters of probe or fixture source; give the check a short \`shown\` (shownCall in dsa-probes.ts)`);
        if (test.shown && test.shown.length >= test.call.length) fail(`${id}: a \`shown\` form is no shorter than the call it stands for`);
      }
      const wrong = DSA_FOUNDATIONS_WRONG.filter((known) => known.id === id);
      if (wrong.length === 0) fail(`${id}: needs at least one known wrong answer`);
      const source = DSA_CRITICAL_CRITERIA[id];
      if (!source || source.critical.length === 0) { fail(`${id}: no critical criteria recorded from its retired path exercise`); continue; }
      const covered = new Set(wrong.map((known) => known.criterion ?? 'core'));
      for (const criterion of source.critical) {
        if (!covered.has(criterion)) fail(`${id}: no known wrong answer breaks the critical criterion ${criterion} of ${source.from}`);
      }
      // Every critical criterion has at least one visible or hidden check
      // tagged with it, and every tag a check carries is one of the recorded
      // critical criteria, so a renamed tag fails in either direction.
      const authored = DSA_FOUNDATIONS_TASKS.find((one) => one.id === id);
      const tagged = new Set([...(authored?.tests ?? []), ...(solutionFor(id)?.hiddenTests ?? [])].map((test) => test.criterion ?? 'core'));
      for (const criterion of source.critical) {
        if (!tagged.has(criterion)) fail(`${id}: no visible or hidden check is tagged with the critical criterion ${criterion}`);
      }
      for (const criterion of tagged) {
        if (!source.critical.includes(criterion)) fail(`${id}: a check is tagged ${criterion}, which is not a recorded critical criterion of ${source.from}`);
      }
    }
  }

  /* ── hidden tracks ──────────────────────────────────────────────────── */
  // System design is hidden until its tasks are reviewed again (owner
  // decision, 9 Oct 2026). Every one of them is still authored and proven
  // above, and its grader still passes the right answers and fails wrong ones
  // here, but none is issued: not summarised, so not in the browser index,
  // not in a Learn level, and not in any list.
  {
    const hidden = CODING_TASKS.filter((task) => !CODING_SECTION_TRACKS.includes(task.track));
    if (hidden.some((task) => task.track !== 'system-design')) fail('only system design is hidden');
    const issued = new Set(CODING_SUMMARIES.map((summary) => summary.id));
    for (const task of hidden) {
      if (issued.has(task.id)) fail(`${task.id}: a hidden task is issued`);
      const prepared = prepareDesign(task, (list) => [...list].reverse());
      const right = task.design ? prepared.key.steps!
        : prepared.key.band ? [prepared.key.band.answer]
          : prepared.key.order ? [prepared.key.order]
            : [prepared.key.correct!];
      const wrong = task.design ? prepared.key.steps!.map((index, step) => (index + 1) % task.design!.steps[step].options.length)
        : prepared.key.band ? [prepared.key.band.max * 10 + 1]
          : prepared.key.order ? [[...prepared.key.order].reverse()]
            : [(prepared.key.correct! + 1) % task.drill!.options!.length];
      if (gradeDesign(task, prepared.key, right as DesignAnswer[]).outcome !== 'passed') fail(`${task.id}: its grader fails the right answers`);
      if (gradeDesign(task, prepared.key, wrong as DesignAnswer[]).outcome !== 'failed') fail(`${task.id}: its grader passes wrong answers`);
    }

    // The review of 22 Oct 2026 (docs/audit/system-design-review-2026-10-22.md)
    // found answers the grader got wrong. These pin the fixes.
    const hiddenById = (id: string) => {
      const task = hidden.find((one) => one.id === id);
      assert.ok(task, `${id}: the reviewed task is missing`);
      return task;
    };
    const estimateOutcome = (id: string, value: number) => {
      const task = hiddenById(id);
      return gradeDesign(task, prepareDesign(task, (list) => list).key, [value] as DesignAnswer[]).outcome;
    };
    // An estimate band must refuse the answer one skipped factor gives.
    for (const [id, value, mistake] of [
      ['dd-rows-in-two-years', 182_500, 'one year instead of two'],
      ['dd-a-year-of-photos', 365, 'ignoring the 2 MB photo size'],
      ['dd-a-year-of-photos', 1_460, 'counting the 2 MB twice'],
    ] as const) {
      if (estimateOutcome(id, value) !== 'failed') fail(`${id}: its band accepts ${value} (${mistake})`);
    }
    for (const [id, value] of [['dd-rows-in-two-years', 360_000], ['dd-a-year-of-photos', 713]] as const) {
      if (estimateOutcome(id, value) !== 'passed') fail(`${id}: its band refuses the fair rounding ${value}`);
    }
    // Filling the cache and returning the record may come in either order;
    // any other swap is still wrong.
    {
      const task = hiddenById('dd-reading-through-a-cache');
      const prepared = prepareDesign(task, (list) => [...list].reverse());
      const shown = (authored: number[]) => [authored.map((step) => prepared.key.order![step])] as DesignAnswer[];
      if (gradeDesign(task, prepared.key, shown([0, 1, 2, 3, 4])).outcome !== 'passed') fail(`${task.id}: the authored order fails`);
      if (gradeDesign(task, prepared.key, shown([0, 1, 3, 2, 4])).outcome !== 'passed') fail(`${task.id}: returning the record before filling the cache fails`);
      if (gradeDesign(task, prepared.key, shown([1, 0, 2, 3, 4])).outcome !== 'failed') fail(`${task.id}: reading the database before asking the cache passes`);
      if (gradeDesign(task, prepared.key, shown([0, 1, 2, 4, 3])).outcome !== 'failed') fail(`${task.id}: removing the entry before returning the record passes`);
    }
    // The length of an option must not give the answer away: a learner who
    // always picks the longest option (a tie counted in their favour) passes
    // no more than a minority of the choice tasks, and the right option is
    // strictly the longest no more often than chance would make it.
    {
      const choiceTasks = hidden.filter((task) => task.design || task.drill?.options);
      let longestPasses = 0;
      let strictlyLongest = 0;
      let byChance = 0;
      for (const task of choiceTasks) {
        const prepared = prepareDesign(task, (list) => [...list].reverse());
        const items = prepared.design
          ? prepared.design.steps.map((step, index) => ({ options: step.options, correct: prepared.key.steps![index] }))
          : [{ options: prepared.drill!.options!, correct: prepared.key.correct! }];
        const picks = items.map(({ options, correct }) => {
          const longest = Math.max(...options.map((option) => option.length));
          if (options.every((option, index) => index === correct || option.length < options[correct].length)) strictlyLongest += 1;
          byChance += 1 / options.length;
          return options[correct].length === longest ? correct : options.findIndex((option) => option.length === longest);
        });
        if (gradeDesign(task, prepared.key, picks as DesignAnswer[]).outcome === 'passed') longestPasses += 1;
      }
      if (longestPasses * 2 >= choiceTasks.length) fail(`always picking the longest option passes ${longestPasses} of ${choiceTasks.length} system-design choice tasks`);
      if (strictlyLongest > byChance) fail(`the right option is strictly the longest in ${strictlyLongest} system-design choice items; chance is ${byChance.toFixed(1)}`);
    }
    for (const topic of ['javascript', 'typescript', 'react', 'system-design', 'algorithms', 'dsa', 'dsa-advanced'] as const) {
      for (let level = 0; level <= 25; level++) if (tasksForLevel(topic, level).some((task) => !CODING_SECTION_TRACKS.includes(task.track))) fail(`${topic} level ${level} holds a hidden task`);
    }
    if (EVOLVING_CHALLENGES.some((project) => !CODING_SECTION_TRACKS.includes(project.track))) fail('a project sits on a hidden track');
  }

  /* ── index freshness ────────────────────────────────────────────────── */
  const indexPath = path.join(process.cwd(), 'shared', 'coding-index.ts');
  if (!SKIP_INDEX && (!existsSync(indexPath) || readFileSync(indexPath, 'utf8') !== renderCodingIndex(CODING_SUMMARIES))) {
    fail('shared/coding-index.ts is stale: run npm run build:coding-index');
  }

  /* ── technique coverage of the Easy band (#226) ─────────────────────── */
  // The check itself must bite: three Easy challenges cover a Medium tag, and
  // taking one away opens a gap.
  const probe = [
    { id: 'js-probe-medium', track: 'javascript' as const, tier: 3 as const, focus: ['closures'] },
    ...[1, 2, 3].map((n) => ({ id: `js-probe-easy-${n}`, track: 'javascript' as const, tier: 1 as const, focus: ['closures'] })),
  ];
  assert.equal(coverageGaps(techniqueCoverage(probe, ['javascript'])).length, 0, `${COVERAGE_MIN_EASY} Easy challenges cover a Medium tag`);
  assert.deepEqual(
    coverageGaps(techniqueCoverage(probe.slice(0, -1), ['javascript'])).map((row) => [row.tag, row.easy]),
    [['closures', COVERAGE_MIN_EASY - 1]],
    'removing an Easy challenge opens a gap',
  );
  const coverage = techniqueCoverage(CODING_SUMMARIES);
  console.log(renderCoverage(coverage, ENFORCE_COVERAGE));
  if (ENFORCE_COVERAGE) {
    for (const gap of coverageGaps(coverage)) fail(`${gap.track}: ${gap.tag} is on ${gap.medium} Medium challenge(s) and only ${gap.easy} Easy one(s); it needs ${COVERAGE_MIN_EASY}`);
  }

  /* ── the Easy-band waves (#226) ─────────────────────────────────────── */
  // What every wave promises: a standalone Easy challenge on one technique
  // (two focus tags at most) that fits in ten minutes, a hint ladder whose
  // last rung is the documentation page of its first tag, hidden checks
  // beside the visible ones, and no seat in a Learn level's quota. The
  // solution proofs below cover the three solutions and the failing starter.
  assert.ok(EASY_BAND_TASK_IDS.size > 0, 'the Easy-band waves are registered');
  const summarized = new Set(CODING_SUMMARIES.map((summary) => summary.id));
  for (const id of EASY_BAND_TASK_IDS) {
    const task = byId.get(id);
    if (!task) { fail(`${id}: an Easy-band id with no task`); continue; }
    if (!summarized.has(id)) fail(`${id}: an Easy-band task must be issued`);
    if (evolvingStage(id)) fail(`${id}: an Easy-band task is standalone`);
    if (task.difficulty !== undefined || difficultyOf(task) !== 'easy') fail(`${id}: an Easy-band task reads Easy from its tier`);
    if (task.focus.length > 2) fail(`${id}: at most two focus tags, one technique`);
    if (task.estimatedMinutes > 10) fail(`${id}: an Easy-band task fits in ten minutes`);
    if (task.verify !== 'tests') fail(`${id}: an Easy-band task is graded by its tests`);
    const [page] = taskResources(task.focus);
    if (!page || page.tag !== task.focus[0] || docsFor(task.focus).url !== page.url) fail(`${id}: the first focus tag must have a documentation page to end the hint ladder`);
    if (task.hints.length === 0 || (task.approach?.length ?? 0) < 2) fail(`${id}: a hint and at least two method steps before the documentation`);
    const hiddenChecks = task.track === 'react' ? hiddenCaseCount(solutionFor(id)?.hiddenSuite) : (solutionFor(id)?.hiddenTests?.length ?? 0);
    if (hiddenChecks < 3) fail(`${id}: at least three hidden checks`);
    if (tasksForLevel(task.topic, task.level).some((one) => one.id === id)) fail(`${id}: an Easy-band task never enters a Learn level's quota`);
  }

  /* ── the Medium and Hard waves (#226) ───────────────────────────────── */
  // What every Medium and Hard wave promises: a standalone challenge that
  // combines two to four techniques, each one taught by at least
  // COVERAGE_MIN_EASY Easy challenges of the same track. The coverage matrix
  // above holds every Medium challenge to that; this holds the Hard ones of
  // the waves to it too. The label comes from the tier (3 Medium, 4 Hard, 5
  // for a React capstone), the hint ladder has a skeleton and ends in the
  // documentation page of the first tag, the visible checks come with hidden
  // ones, and the challenge takes no seat in a Learn level's quota.
  assert.ok(MEDIUM_HARD_BAND_TASK_IDS.size > 0, 'the Medium and Hard waves are registered');
  const easyPerTag = new Map<string, number>();
  for (const summary of CODING_SUMMARIES) {
    if (evolvingStage(summary.id) || summary.difficulty !== 'easy') continue;
    for (const tag of summary.focus) easyPerTag.set(`${summary.track}:${tag}`, (easyPerTag.get(`${summary.track}:${tag}`) ?? 0) + 1);
  }
  for (const id of MEDIUM_HARD_BAND_TASK_IDS) {
    const task = byId.get(id);
    if (!task) { fail(`${id}: a Medium or Hard band id with no task`); continue; }
    if (!summarized.has(id)) fail(`${id}: a Medium or Hard band task must be issued`);
    if (EASY_BAND_TASK_IDS.has(id)) fail(`${id}: listed in the Easy band as well`);
    if (evolvingStage(id)) fail(`${id}: a Medium or Hard band task is standalone`);
    const label = difficultyOf(task);
    if (task.difficulty !== undefined || (label !== 'medium' && label !== 'hard')) fail(`${id}: a Medium or Hard band task reads its label from its tier`);
    if (task.tier === 5 && task.track !== 'react') fail(`${id}: tier 5 is for React capstones`);
    if (task.focus.length < 2 || task.focus.length > 4) fail(`${id}: combines two to four techniques`);
    for (const tag of task.focus) {
      const easy = easyPerTag.get(`${task.track}:${tag}`) ?? 0;
      if (easy < COVERAGE_MIN_EASY) fail(`${id}: ${tag} is on only ${easy} Easy ${task.track} challenge(s); a Medium or Hard challenge needs ${COVERAGE_MIN_EASY} behind each tag`);
    }
    if (!(task.estimatedMinutes > 10 && task.estimatedMinutes <= 45)) fail(`${id}: takes longer than an Easy challenge and at most 45 minutes`);
    if (task.verify !== 'tests') fail(`${id}: a Medium or Hard band task is graded by its tests`);
    const [page] = taskResources(task.focus);
    if (!page || page.tag !== task.focus[0] || docsFor(task.focus).url !== page.url) fail(`${id}: the first focus tag must have a documentation page to end the hint ladder`);
    if (task.hints.length === 0 || (task.approach?.length ?? 0) < 3 || !task.skeleton) fail(`${id}: a hint, at least three method steps and a skeleton before the documentation`);
    const visibleChecks = task.track === 'react' ? hiddenCaseCount(task.suite) : (task.tests?.length ?? 0);
    const hiddenChecks = task.track === 'react' ? hiddenCaseCount(solutionFor(id)?.hiddenSuite) : (solutionFor(id)?.hiddenTests?.length ?? 0);
    if (visibleChecks < 5) fail(`${id}: at least five visible checks`);
    if (hiddenChecks < 4) fail(`${id}: at least four hidden checks`);
    const inLearnQuota = tasksForLevel(task.topic, task.level).some((one) => one.id === id);
    // E4 admits the nine individually reviewed DSA Advanced placements. Other
    // Medium and Hard band tasks stay outside Learn quotas.
    if (task.topic === 'dsa-advanced') {
      if (!inLearnQuota) fail(`${id}: a DSA Advanced placement must enter its Learn level's quota`);
    } else if (inLearnQuota) fail(`${id}: a Medium or Hard band task never enters a Learn level's quota`);
  }

  /* ── JavaScript and TypeScript solutions ────────────────────────────── */
  const libDir = path.join(path.dirname(nodeRequire.resolve('typescript/package.json')), 'lib');
  const libs = Object.fromEntries(readdirSync(libDir).filter(isCheckerLibFile).map((name) => [name, readFileSync(path.join(libDir, name), 'utf8')]));
  const checker = createTypeScript({ ts: nodeRequire('typescript'), libs });

  // Every graded code task carries three solutions — the reference the
  // learner can give up to, and the junior and senior versions shown after a
  // pass — and all three have to pass the same visible and hidden checks. An
  // evolving project's checkpoint (`…-start`) carries its reference alone.
  const variants = (solution: NonNullable<ReturnType<typeof solutionFor>>, where: string): [string, string][] => {
    const out: [string, string][] = [['reference', solution.solution]];
    const boards = !where.endsWith('-start');
    if (typeof solution.junior === 'string' && solution.junior.trim()) out.push(['junior', solution.junior]);
    else if (boards) fail(`${where}: missing the junior solution`);
    if (typeof solution.senior === 'string' && solution.senior.trim()) out.push(['senior', solution.senior]);
    else if (boards) fail(`${where}: missing the senior solution`);
    if (solution.junior && solution.senior && solution.junior.trim() === solution.senior.trim()) fail(`${where}: the junior and senior solutions are the same code`);
    if (where === 'js-run-tasks-in-order') out.push(['deferred-start', DEFERRED_SEQUENTIAL_START]);
    if (where === 'js-mh-shared-request') out.push(['rethrowing-chain', RETHROWING_SHARED_PROMISE]);
    if (where === 'js-mh-in-batches') out.push(['deferred-start', DEFERRED_BATCH_START]);
    return out;
  };

  for (const task of CODING_TASKS) {
    if (task.verify !== 'tests' || task.track === 'react' || !task.tests) continue;
    if (!ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution) continue;
    const where = `${task.id}`;
    let starterCode = task.starter;
    if (task.track === 'typescript') {
      const starterCheck = checker.check(task.starter, task.typeTests ?? []);
      const starterRun = await withTimeout(evaluateCalls({ code: checker.toJavaScript(task.starter), calls: task.tests.map((t) => t.call), expectations: task.tests.map((t) => t.expected) }), 8_000, where);
      if (typesPassed(starterCheck) && allPassed(starterRun)) fail(`${where}: the untouched starter already passes`);
      starterCode = checker.toJavaScript(task.starter);
      // Code that ends inside an unterminated template literal must not pull
      // the type tests into it: the check reports the code instead.
      if (typesPassed(checker.check(`${solution.solution}\ntype __Unterminated = \``, task.typeTests ?? []))) fail(`${where}: an unterminated template literal at the end of the code passes the type tests`);
    }
    for (const [name, source] of variants(solution, where)) {
      const label = `${where} (${name})`;
      let code = source;
      if (task.track === 'typescript') {
        const check = checker.check(source, task.typeTests ?? []);
        if (!typesPassed(check)) fail(`${label}: solution fails the type tests: ${JSON.stringify(check).slice(0, 300)}`);
        if (solution.hiddenTypeTests?.length) {
          const hidden = checker.check(source, solution.hiddenTypeTests);
          if (!typesPassed(hidden)) fail(`${label}: solution fails the hidden type tests`);
        }
        code = checker.toJavaScript(source);
      }
      // The Run button's realm: UTC, the grader's built-ins and none
      // of the browser's others (scripts/run-realm-node.ts).
      const run = await withTimeout(evaluateInRunRealm({ runtimePolicy: runtimePolicyForTask(task.id), code, calls: task.tests.map((t) => t.call), expectations: task.tests.map((t) => t.expected) }), 8_000, label);
      // The production grader: the hidden checks in a fresh program and, here,
      // in reverse order, so no solution leans on the order they run in or on
      // state the visible calls left behind.
      const server = await runChecks({ runtimePolicy: runtimePolicyForTask(task.id), code, visible: task.tests, hidden: solution.hiddenTests ?? [], shuffle: (list) => [...list].reverse() });
      if (!allPassed(server.visible) || (server.hidden && !allPassed(server.hidden))) fail(`${label}: solution fails the production QuickJS grader: ${JSON.stringify(server).slice(0,500)}`);
      if (!allPassed(run)) {
        const wrong = run.results.map((r, i) => (r.pass ? null : `${task.tests![i].call} → ${r.error ?? r.actual}`)).filter(Boolean);
        fail(`${label}: solution fails visible tests: ${run.codeError ?? wrong.join('; ')}`);
      }
      if (solution.hiddenTests?.length) {
        const hidden = await withTimeout(evaluateInRunRealm({ runtimePolicy: runtimePolicyForTask(task.id), code, calls: solution.hiddenTests.map((t) => t.call), expectations: solution.hiddenTests.map((t) => t.expected) }), 8_000, label);
        if (!allPassed(hidden)) fail(`${label}: solution fails hidden tests: ${hidden.codeError ?? hidden.results.map((r, i) => (r.pass ? null : solution.hiddenTests![i].call)).filter(Boolean).join('; ')}`);
      }
    }
    // Algorithms challenges are plain JavaScript too, so their starters must fail the same way.
    if (task.track === 'javascript' || task.track === 'algorithms') {
      const starterRun = await withTimeout(evaluateCalls({ code: starterCode, calls: task.tests.map((t) => t.call), expectations: task.tests.map((t) => t.expected) }), 8_000, where);
      if (allPassed(starterRun)) fail(`${where}: the untouched starter already passes`);
    }
  }

  /* ── no check depends on the time zone ──────────────────────────────── */
  // Learner code reads UTC in every runner (owner decision, 9 October 2026,
  // afternoon), so a check could pass only because the zone is UTC. None
  // may: every board of a task that works with calendar dates passes its
  // visible and hidden checks as plain JavaScript in zones with summer time,
  // without it, and with a half-hour change.
  const CALENDAR = /new Date\(|Date\.(?:parse|UTC)\(|\.(?:get|set)(?:UTC)?(?:FullYear|Month|Date|Day|Hours|Minutes|Seconds)\(|toISOString\(|getTimezoneOffset\(|to(?:Locale)?(?:Date|Time)String\(/;
  const calendarTasks: string[] = [];
  const hostZone = process.env.TZ;
  try {
    for (const task of CODING_TASKS) {
      if (task.verify !== 'tests' || task.track === 'react' || !task.tests || !ONLY.test(task.id)) continue;
      const solution = solutionFor(task.id);
      if (!solution) continue;
      const boards = variants(solution, task.id);
      const checks = [...task.tests, ...(solution.hiddenTests ?? [])];
      if (!boards.some(([, source]) => CALENDAR.test(source)) && !checks.some((one) => CALENDAR.test(one.call))) continue;
      calendarTasks.push(task.id);
      for (const zone of ['America/Los_Angeles', 'Asia/Tokyo', 'Australia/Lord_Howe', 'Europe/Prague']) {
        process.env.TZ = zone;
        for (const [name, source] of boards) {
          const code = task.track === 'typescript' ? checker.toJavaScript(source) : source;
          const run = await withTimeout(evaluateCalls({ code, calls: checks.map((one) => one.call), expectations: checks.map((one) => one.expected) }), 8_000, task.id);
          if (!allPassed(run)) fail(`${task.id} (${name}): a check passes only in UTC; in ${zone}: ${run.codeError ?? run.results.map((one, i) => (one.pass ? null : checks[i].call)).filter(Boolean).join('; ')}`);
        }
      }
    }
  } finally {
    if (hostZone === undefined) delete process.env.TZ;
    else process.env.TZ = hostZone;
  }
  for (const id of ['js-path-edges-5', 'ts-mh-fill-missing-days']) {
    if (ONLY.test(id) && !calendarTasks.includes(id)) fail(`${id}: the time-zone check no longer finds this calendar task`);
  }
  console.log(`Time zones: ${calendarTasks.length} calendar tasks checked in four zones besides UTC (${calendarTasks.join(', ')}).`);

  /* ── hidden checks that catch the cheap passes ──────────────────────── */
  // The checks a learner can see are examples; the hidden ones are what make
  // a pass mean the task was done. Every standalone task and every milestone
  // carries hidden checks (a checkpoint is graded on its visible contract
  // alone, by design), and they have to reject two solutions that do not do
  // the task: a table of the visible answers, and a function that returns
  // one constant. A skeleton hint rung must not already be a passing answer.
  const ts = nodeRequire('typescript') as TypeScriptApi;
  const cheatsStarted = Date.now();
  let cheatTasks = 0;
  let tables = 0;
  for (const task of CODING_TASKS) {
    if (task.verify !== 'tests' || task.track === 'react' || !task.tests || task.id.endsWith('-start')) continue;
    if (!ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution) continue;
    const where = `${task.id}`;
    const visible = task.tests;
    const hidden = solution.hiddenTests ?? [];
    if (hidden.length === 0) { fail(`${where}: needs hidden checks beside the visible ones`); continue; }
    cheatTasks += 1;
    const every = [...visible, ...hidden];
    // None of these is a real answer, so a short deadline is enough: running
    // out of time counts as failing, never as passing, and a skeleton whose
    // loop has no condition yet would otherwise spin for the full deadline.
    const passes = async (code: string, checks: readonly Check[] = every, deadlineMs = 1_000): Promise<boolean> =>
      allPassed(await runInSandbox({ code, calls: checks.map((one) => one.call), expectations: checks.map((one) => one.expected), shownCalls: visible.length, deadlineMs }));
    // A table only proves something when it really answers every visible call.
    const table = lookupTable(ts, visible);
    if (table && await passes(table, visible)) {
      tables += 1;
      if (await passes(table)) fail(`${where}: a table of the visible answers passes the hidden checks too`);
    }
    const names = topLevelNames(ts, solution.solution);
    const callees = every.map((one) => plainCall(ts, one.call)?.name);
    const constants = new Map(every.map((one) => [literal(one.expected), one.expected]));
    for (const [shown, value] of constants) {
      // A plain call to a replaced function returns the constant itself, so a
      // single such check that expects something else already sinks it; only
      // the constants no plain check rules out need a run.
      if (every.some((one, index) => names.includes(callees[index] ?? '') && !deepEqual(value, one.expected))) continue;
      if (await passes(names.map((name) => `function ${name}() { return (${literal(value)}); }`).join('\n'))) fail(`${where}: a solution that always returns ${shown.slice(0, 60)} passes every check`);
    }
    if (task.skeleton) {
      const skeleton = task.skeleton;
      const code = task.track === 'typescript' ? checker.toJavaScript(skeleton) : skeleton;
      const typed = () => task.track !== 'typescript' || (typesPassed(checker.check(skeleton, task.typeTests ?? [])) && typesPassed(checker.check(skeleton, solution.hiddenTypeTests ?? [])));
      if (await passes(code, every, 250) && typed()) fail(`${where}: the skeleton hint rung already passes every check`);
    }
  }
  console.log(`Hidden checks: ${cheatTasks} tasks reject a constant answer, ${tables} of them a table of the visible answers too (${((Date.now() - cheatsStarted) / 1000).toFixed(1)} s).`);

  await stagesPromisesAndSignatures({ fail, checker, ts, byId });

  /* ── the last hint rung ─────────────────────────────────────────────── */
  // The ladder ends on the task's first reference, or on the documentation
  // page of its first focus tag: official documentation either way.
  // A page about one array or string method, or about Map or Set, is the
  // right last rung only when a solution of the task uses it: Set tasks
  // ended on the Map page, and a page the server cuts ended on Array.slice.
  for (const task of CODING_TASKS) {
    const url = task.references?.[0]?.url ?? docsFor(task.focus).url;
    if (!OFFICIAL_DOCS.has(new URL(url).host)) fail(`${task.id}: the hint ladder ends on ${url}, not on official documentation`);
    const solution = solutionFor(task.id);
    const api = /\/Global_Objects\/(?:(?:Array|String)\/([a-z]\w*)|(Map|Set))$/.exec(url);
    if (!solution || !api) continue;
    const code = [solution.solution, solution.junior ?? '', solution.senior ?? ''].join('\n');
    if (!new RegExp(api[1] ? `\\.${api[1]}\\(` : `\\b${api[2]}\\b`).test(code)) fail(`${task.id}: the hint ladder ends on ${url}, which none of the task's solutions uses`);
  }

  /* ── React solutions ────────────────────────────────────────────────── */
  // The React guest freezes its realm's built-ins after loading jsdom, React
  // and Testing Library and before any learner code runs
  // (lib/coding/realm-lockdown.ts). The solutions and probes run the same way
  // here, so a suite or a library path that needs a writable built-in fails
  // this test instead of every Submit.
  await prepareReactRuntime();
  lockDownRealm();
  let skeletonPages = 0;
  let skeletonMs = 0;
  for (const task of CODING_TASKS) {
    if (task.track !== 'react' || task.verify !== 'tests' || !task.suite) continue;
    if (!ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution) continue;
    const where = `${task.id}`;
    // Hidden cases are test blocks appended to the visible suite; the server
    // runs both, and every solution has to pass both.
    if (task.suite.includes(HIDDEN_CASE_PREFIX)) fail(`${where}: a visible suite never uses the hidden case prefix`);
    if (solution.hiddenSuite !== undefined && /^\s*import\s/m.test(solution.hiddenSuite)) fail(`${where}: a hidden suite shares the visible suite's imports and declares none`);
    const suite = withHiddenCases(task.suite, solution.hiddenSuite);
    for (const [name, source] of variants(solution, where)) {
      const run = await withTimeout(runReactSuite({ suite, appSource: source }), 20_000, `${where} (${name})`);
      if (run.compileError || run.failed > 0) {
        fail(`${where} (${name}): solution fails its suite: ${run.compileError ?? run.cases.filter((c) => c.status === 'fail').map((c) => `${c.name}: ${c.error}`).join('; ')}`);
      }
      const { hidden } = splitHiddenCases(run.cases);
      if (hidden.length !== hiddenCaseCount(solution.hiddenSuite)) fail(`${where} (${name}): the hidden suite declares ${hiddenCaseCount(solution.hiddenSuite)} case(s) and ran ${hidden.length}`);
      // The server refuses a run whose case count differs from the suite's.
      if (run.cases.length !== suiteCaseCount(suite)) fail(`${where} (${name}): the suite declares ${suiteCaseCount(suite)} case(s) and ran ${run.cases.length}`);
    }
    const starter = await withTimeout(runReactSuite({ suite: task.suite, appSource: task.starter }), 20_000, where);
    if (!starter.compileError && starter.failed === 0) fail(`${where}: the untouched starter already passes its suite`);
    // A learning path runs the visible suite alone, and the server counts it too.
    if (!starter.compileError && starter.cases.length !== suiteCaseCount(task.suite)) fail(`${where}: the visible suite declares ${suiteCaseCount(task.suite)} case(s) and ran ${starter.cases.length}`);
    // The server's suite (visible and hidden cases) has to check behaviour:
    // no page without state, effects, requests or timers may pass it. A
    // static page never changes after its first render, so what a waitFor or
    // findBy waits for cannot arrive later: the probes run with Testing
    // Library's default wait cut short, which only makes them fail sooner.
    // Every case stops at the runner's own time limit, so a probe run always
    // ends; it gets no outer timer, which would keep the process alive long
    // after the last probe.
    const testing = await testingLibrary();
    const fullWait = testing.getConfig().asyncUtilTimeout;
    testing.configure({ asyncUtilTimeout: 150 });
    try {
      for (const [page, source] of staticPages(suite)) {
        const run = await runReactSuite({ suite, appSource: source });
        if (run.compileError) fail(`${where}: the probe "${page}" did not run: ${run.compileError}`);
        else if (run.failed === 0 && run.total > 0) fail(`${where}: ${page} passes the suite, so it checks text instead of behaviour`);
      }
    } finally {
      testing.configure({ asyncUtilTimeout: fullWait });
    }
    // The skeleton hint rung, pasted into the starter with its placeholders
    // left as they are, must not pass either: hints cost no XP. A page that
    // fails a visible case fails the server's run too, so only one that
    // passes them all runs again with the hidden cases.
    const skeletonStarted = Date.now();
    for (const source of task.skeleton ? skeletonInStarter(ts, task.starter, task.skeleton) : []) {
      skeletonPages += 1;
      const shown = await runReactSuite({ suite: task.suite, appSource: source });
      if (shown.compileError || shown.failed > 0 || shown.total === 0) continue;
      const run = await runReactSuite({ suite, appSource: source });
      if (!run.compileError && run.failed === 0 && run.total > 0) {
        fail(`${where}: the skeleton hint rung, pasted into the starter, already passes every case`);
        break;
      }
    }
    skeletonMs += Date.now() - skeletonStarted;
  }
  console.log(`React skeletons: ${skeletonPages} pages of a skeleton pasted into its starter fail their suites (${(skeletonMs / 1000).toFixed(1)} s).`);

  /* ── skeletons a learner can follow to a pass ───────────────────────── */
  // The skeleton is the last rung before the documentation, so it has to
  // lead somewhere a pass can follow. Each entry of SKELETON_FILLS is one
  // skeleton filled in: it has to keep every line of the skeleton and pass
  // every visible and hidden check. A skeleton that declares a const the task
  // has to reassign, loops over a number, or renders rows the suite does not
  // count has no such filling.
  for (const [id, filled] of Object.entries(SKELETON_FILLS)) {
    if (!ONLY.test(id)) continue;
    const task = byId.get(id);
    const solution = solutionFor(id);
    if (!task?.skeleton || !solution) { fail(`${id}: a skeleton filling names a task with no skeleton`); continue; }
    const missing = skeletonLineMissing(task.skeleton, filled);
    if (missing !== null) fail(`${id}: the skeleton filling does not keep the skeleton's line "${missing}"`);
    if (task.track === 'react') {
      const run = await withTimeout(runReactSuite({ suite: withHiddenCases(task.suite!, solution.hiddenSuite), appSource: filled }), 20_000, id);
      if (run.compileError || run.failed > 0 || run.total === 0) fail(`${id}: the filled-in skeleton fails its suite: ${run.compileError ?? run.cases.filter((c) => c.status === 'fail').map((c) => `${c.name}: ${c.error}`).join('; ')}`);
    } else {
      const typed = task.track !== 'typescript' || (typesPassed(checker.check(filled, task.typeTests ?? [])) && typesPassed(checker.check(filled, solution.hiddenTypeTests ?? [])));
      const code = task.track === 'typescript' ? checker.toJavaScript(filled) : filled;
      const server = await runChecks({ runtimePolicy: runtimePolicyForTask(task.id), code, visible: task.tests ?? [], hidden: solution.hiddenTests ?? [], shuffle: (list) => [...list].reverse() });
      if (!typed || !allPassed(server.visible) || (server.hidden && !allPassed(server.hidden))) fail(`${id}: the filled-in skeleton fails its checks: ${JSON.stringify(server).slice(0, 400)}`);
    }
  }

  /* ── React suites inside the grader's time limit ────────────────────── */
  // The isolated grader stops a React run after 10 s, node start-up and the
  // page runtime included (lib/coding/react-isolated.ts), and a run it stops
  // reports no case at all: the learner reads a timeout instead of the checks
  // that failed. So a whole suite, visible and hidden cases together, has to
  // stay well inside that for the pages learners submit on the way to a pass:
  // one that renders nothing, the untouched starter, and for a task with an
  // API one that asks for its data and shows none of it. These run with
  // Testing Library's own wait, not the shortened wait of the probes above,
  // and add up the time the cases take.
  const REACT_CASE_BUDGET_MS = 6_000;
  for (const task of CODING_TASKS) {
    if (task.track !== 'react' || task.verify !== 'tests' || !task.suite || !ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution) continue;
    const suite = withHiddenCases(task.suite, solution.hiddenSuite);
    const url = task.api?.url;
    const pages: [string, string][] = [
      ['a page that renders nothing', 'const App = () => null;'],
      ['the untouched starter', task.starter],
    ];
    if (url) pages.push(['a page that asks for its data and shows none of it', `import React, { useEffect } from 'react';\nexport default function App() {\n  useEffect(() => { fetch(${JSON.stringify(url)}).catch(() => {}); }, []);\n  return null;\n}\n`]);
    for (const [page, source] of pages) {
      const run = await runReactSuite({ suite, appSource: source });
      const spent = run.cases.reduce((sum, one) => sum + one.durationMs, 0);
      if (spent > REACT_CASE_BUDGET_MS) fail(`${task.id}: ${page} spends ${spent} ms in the suite's cases; the grader stops a run at 10 s with start-up, so keep it under ${REACT_CASE_BUDGET_MS} ms`);
    }
  }

  /* ── React forms cancel their submit ────────────────────────────────── */
  // In the preview a form the component lets submit reloads the frame and
  // loses what it showed, so the runner fails the case
  // (watchFormSubmits in shared/coding-react-support.ts). Every task whose
  // reference handles a submit proves that its checks submit the form: the
  // reference with each preventDefault() call taken out fails, and says why.
  const { FORM_SUBMIT_NOT_PREVENTED } = await import('../shared/coding-react-support');
  for (const task of CODING_TASKS) {
    if (task.track !== 'react' || task.verify !== 'tests' || !task.suite || !ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution || !solution.solution.includes('onSubmit')) continue;
    const careless = solution.solution.replace(/[\w$]+\??\.preventDefault\(\)/g, 'void 0');
    if (careless === solution.solution) {
      fail(`${task.id}: the reference handles a submit without preventDefault()`);
      continue;
    }
    const run = await runReactSuite({ suite: withHiddenCases(task.suite, solution.hiddenSuite), appSource: careless });
    if (run.compileError) fail(`${task.id}: the reference without preventDefault() did not run: ${run.compileError}`);
    else if (!run.cases.some((one) => one.error === FORM_SUBMIT_NOT_PREVENTED)) fail(`${task.id}: the reference without preventDefault() trips no check, so no check submits its form`);
  }

  /* ── React suites judge what the prompt says ────────────────────────── */
  // A page the prompt allows passes the server's suite and a wrong one fails
  // it. Each variant is the task's reference with a few exact edits
  // (scripts/coding-react-variants.ts).
  for (const variant of REACT_VARIANTS) {
    if (!ONLY.test(variant.id)) continue;
    const task = CODING_TASKS.find((one) => one.id === variant.id);
    const solution = solutionFor(variant.id);
    if (task?.track !== 'react' || !task.suite || !solution) {
      fail(`${variant.id}: a React variant names a task with no suite or reference`);
      continue;
    }
    let source = solution.solution;
    let lost: string | null = null;
    for (const [from, to] of variant.edits) {
      if (!source.includes(from)) {
        lost = from;
        break;
      }
      source = source.split(from).join(to);
    }
    if (lost !== null) {
      fail(`${variant.id} (${variant.note}): the reference no longer contains ${JSON.stringify(lost.slice(0, 60))}`);
      continue;
    }
    const run = await runReactSuite({ suite: withHiddenCases(task.suite, solution.hiddenSuite), appSource: source });
    const passed = !run.compileError && run.failed === 0 && run.total > 0;
    if (variant.correct && !passed) fail(`${variant.id}: a correct page that ${variant.note} fails the suite: ${run.compileError ?? run.cases.filter((one) => one.status === 'fail').map((one) => `${one.name}: ${one.error}`).join('; ')}`);
    if (!variant.correct && passed) fail(`${variant.id}: a wrong page that ${variant.note} passes the suite`);
  }

  if (failures.length > 0) {
    console.error(`Coding content contract: ${failures.length} problem(s)\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  const byTrack = CODING_TRACKS.map((track) => `${track} ${CODING_TASKS.filter((t) => t.track === track).length}${CODING_SECTION_TRACKS.includes(track) ? '' : ' hidden'}`).join(', ');
  // ── approach comparisons (#158) ────────────────────────────────────────
  // Every covered id is a real task; every comparison has at least two
  // approaches and a stated cost. Nothing here
  // reaches the browser before the server sees a recorded pass.
  const coveredIds = approachCoverage();
  assert.ok(coveredIds.length > 0, 'the approach manifest must cover something');
  for (const id of coveredIds) {
    const task = CODING_TASKS.find((one) => one.id === id);
    assert.ok(task, `approach comparison ${id} must name a real task`);
    const approaches = approachesFor(id);
    assert.ok(approaches.length >= 2, `${id} needs at least two approaches to compare`);
    for (const approach of approaches) {
      for (const field of [approach.name, approach.readability, approach.assumptions, approach.tradeoffs]) {
        assert.ok(field.length > 0, `${id}: every approach field needs copy`);
      }
      assert.ok(approach.code.trim().length > 0, `${id}: an approach needs code`);
      assert.ok(approach.time.length > 0 && approach.space.length > 0, `${id}: an approach must state its cost`);
    }
  }

  // ── code-ordering puzzles (#154) ───────────────────────────────────────
  // Every covered id is a real task; every accepted order is a permutation of
  // that puzzle's own lines; no puzzle is short enough to be guessed; and each
  // one declares what arranging it demonstrates.
  const prefixProbe = { lines: [
    { id: 'a', code: 'function twice(n) {' },
    { id: 'b', code: '  const value = n * 2;' },
    { id: 'c', code: '  const copy = value;' },
    { id: 'd', code: '  return copy;' },
    { id: 'e', code: '}' },
  ] };
  for (const call of ['twice(3) === 6', 'twice(3) + 1 === 7', 'String(twice(3)) === "6"']) {
    assert.deepEqual(passingArrangements(prefixProbe, [{ call, expected: true }]),
      [['a', 'b', 'c', 'd', 'e']], `puzzle prefix tracking survives ${call}`);
  }
  assert.deepEqual(passingArrangements(prefixProbe, [{ call: '[twice(3)]', expected: [6] }]),
    [['a', 'b', 'c', 'd', 'e']], 'puzzle prefix tracking preserves nested sentinels');
  assert.deepEqual(passingArrangements(prefixProbe, [{ call: 'twice(3) === 5', expected: true }]),
    [], 'puzzle prefix tracking still rejects incorrect complete code');
  const puzzleIds = puzzleCoverage();
  const puzzlesStarted = Date.now();
  let puzzleOrders = 0;
  assert.ok(puzzleIds.length > 0, 'the puzzle manifest must cover something');
  for (const inherited of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(puzzleFor(inherited), undefined, `puzzleFor(${inherited}) must not answer an Object prototype member`);
  }
  for (const id of puzzleIds) {
    const task = CODING_TASKS.find((one) => one.id === id);
    assert.ok(task, `puzzle ${id} must name a real task`);
    const puzzle = puzzleFor(id)!;
    assert.ok(puzzle.lines.length >= 5, `${id}: a puzzle of fewer than five lines is guesswork`);
    assert.ok(puzzle.lines.length <= PUZZLE_MAX_LINES, `${id}: a puzzle over ${PUZZLE_MAX_LINES} lines is unusable on a phone`);
    assert.equal(new Set(puzzle.lines.map((line) => line.id)).size, puzzle.lines.length, `${id}: line ids must be unique`);
    assert.ok(puzzle.accepted.length > 0, `${id}: a puzzle needs at least one accepted order`);
    for (const order of puzzle.accepted) {
      assert.ok(isCompleteOrder(order, puzzle.lines), `${id}: every accepted order must use each line exactly once`);
    }
    assert.ok(isAcceptedOrder(puzzle.accepted[0], puzzle.accepted), `${id}: its own order must be accepted`);
    // A wrong order is rejected — the check is not vacuous.
    const wrong = [...puzzle.accepted[0]].reverse();
    if (puzzle.lines.length > 1) {
      assert.equal(isAcceptedOrder(wrong, puzzle.accepted), false, `${id}: a reversed order must not pass`);
    }
    assert.ok(puzzle.competencies.length > 0, `${id}: a puzzle must declare what it demonstrates`);
    assert.ok(puzzle.claim.length > 0, `${id}: the claim needs copy`);
    // Every accepted order is a working solution: put together, it passes
    // the task's own visible and hidden checks. js-word-count's puzzle was a
    // word-frequency Map that failed all of them.
    const checks = [...(task!.tests ?? []), ...(solutionFor(id)?.hiddenTests ?? [])];
    for (const order of puzzle.accepted) {
      const code = order.map((lineId) => puzzle.lines.find((line) => line.id === lineId)!.code).join('\n');
      const run = await runInSandbox({ code, calls: checks.map((one) => one.call), expectations: checks.map((one) => one.expected) });
      assert.ok(allPassed(run), `${id}: the accepted order ${order.join('')} fails the task's checks: ${run.codeError ?? JSON.stringify(run.results.filter((one) => one.pass !== true))}`);
    }
    // ...and every order that passes them is accepted: a learner who arranged
    // working code is not told it is wrong. js-largest-number accepted one of
    // the six that pass. The enumeration must also find each accepted order,
    // or it no longer covers the arrangements a puzzle allows.
    const passing = passingArrangements(puzzle, checks).map((order) => order.join(''));
    const acceptedOrders = new Set(puzzle.accepted.map((order) => order.join('')));
    for (const order of passing) assert.ok(acceptedOrders.has(order), `${id}: the order ${order} passes the task's checks and is not accepted`);
    for (const order of acceptedOrders) assert.ok(passing.includes(order), `${id}: the enumeration does not reach the accepted order ${order}`);
    puzzleOrders += passing.length;
    // What the browser sees carries no authored id, and sorting what it sees
    // never produces an accepted order — the ids say nothing about the answer.
    const reversed = <T>(list: T[]) => [...list].reverse();
    // The identity is a shuffle a fair one can return: it deals the authored
    // order, so the puzzle would start solved.
    const unchanged = <T>(list: T[]) => [...list];
    for (const shuffle of [reversed, <T>(list: T[]) => [...list.slice(1), ...list.slice(0, 1)], unchanged]) {
      const presented = presentPuzzle(puzzle, shuffle);
      assert.equal(isAcceptedOrder(presented.map, puzzle.accepted), false, `${id}: the puzzle is never dealt already solved`);
      assert.deepEqual([...presented.map].sort(), puzzle.lines.map((line) => line.id).sort(), `${id}: every line is dealt exactly once`);
      const authored = new Set(puzzle.lines.map((line) => line.id));
      assert.ok(presented.lines.every((line) => !authored.has(line.id)), `${id}: presented ids must not be the authored ids`);
      const sorted = [...presented.lines.map((line) => line.id)].sort();
      const resolved = resolvePuzzleOrder(sorted, presented.map).filter((one): one is string => one !== null);
      assert.equal(isAcceptedOrder(resolved, puzzle.accepted), false, `${id}: sorting the presented ids must not solve the puzzle`);
      const back = resolvePuzzleOrder(presented.lines.map((line) => line.id), presented.map);
      assert.deepEqual(back, presented.map, `${id}: presentation ids resolve to the authored ids`);
      assert.deepEqual(resolvePuzzleOrder(['zz', 'b0', 'b99'], presented.map), [null, null, null], `${id}: ids never issued resolve to nothing`);
    }
  }
  console.log(`Puzzles: ${puzzleIds.length} accept exactly the ${puzzleOrders} arrangements that pass their checks (${((Date.now() - puzzlesStarted) / 1000).toFixed(1)} s).`);

  // ── the debugging format (#163) ────────────────────────────────────────
  // A debugging task must actually start from broken code: its starter has to
  // fail its own visible tests, or the format is a label rather than an
  // exercise. Each one also declares the misconception it is built around.
  const debugTasks = CODING_TASKS.filter((task) => formatOf(task) === 'debug');
  assert.ok(debugTasks.filter((task) => !evolvingStage(task.id)).length >= 4, 'the four standalone repair tasks stay beside the debugging paths');
  for (const task of debugTasks) {
    assert.ok(task.track === 'javascript' || task.track === 'algorithms', `${task.id}: repair tasks are JavaScript or Algorithms; extend this check when others land`);
    assert.ok((task.tests?.length ?? 0) >= 3, `${task.id}: a debugging task needs tests that pin the behaviour down`);
    assert.ok(task.failureHints || task.pitfall, `${task.id}: a debugging task must name the misconception it teaches`);
    for (const hint of Object.values(task.failureHints ?? {})) {
      assert.ok(hint.length > 0, `${task.id}: failure hints need copy`);
    }
    const solution = solutionFor(task.id);
    assert.ok(solution, `${task.id}: a debugging task needs its reference repair`);
    // The starter is wrong on purpose: running it against the task's own tests
    // must fail. This is what separates a debugging task from a filled-in one.
    const starterRun = await runInSandbox({
      code: task.starter,
      calls: (task.tests ?? []).map((one) => one.call),
      expectations: (task.tests ?? []).map((one) => one.expected),
    });
    const starterPasses = !starterRun.codeError
      && starterRun.results.length > 0
      && starterRun.results.every((one) => one.pass === true);
    assert.equal(starterPasses, false, `${task.id}: the broken starter must fail its own tests`);
  }

  // ── the debugging paths (#225) ─────────────────────────────────────────
  // Three short paths replace the café-orders project on the Coding home.
  // Every level starts from code that runs and is wrong: the starter for the
  // first level, then the previous level's repair, which is what a learner
  // carries forward. The first hint rung names the logging technique and the
  // ladder ends in documentation before the solution.
  const debugPaths = listedChallenges({ category: 'debugging' });
  assert.deepEqual(debugPaths.map((project) => project.id), ['js-path-logging', 'js-path-tracing', 'js-path-edges'], 'the Coding home lists the three debugging paths');
  const promised: Record<string, string> = { 'js-path-logging': 'EEEEE', 'js-path-tracing': 'MMMMM', 'js-path-edges': 'MMMMH' };
  for (const project of debugPaths) {
    assert.ok(project.short && project.track === 'javascript' && project.stages.length === 5, `${project.id}: a JavaScript path of five levels`);
    assert.equal(project.stages.map((id) => difficultyOf(byId.get(id)!)[0].toUpperCase()).join(''), promised[project.id], `${project.id}: the difficulty the path promises`);
    for (const [index, id] of project.stages.entries()) {
      const task = byId.get(id)!;
      assert.equal(formatOf(task), 'debug', `${id}: a debugging level`);
      assert.match(task.hints[0] ?? '', /console\.[a-zA-Z]+\(|structuredClone\(/, `${id}: the first hint rung names the logging technique`);
      assert.ok(task.approach && task.approach.length >= 3, `${id}: method steps between the hint and the documentation`);
      assert.ok(task.references?.[0]?.url.startsWith('https://developer.mozilla.org/'), `${id}: the ladder ends in documentation`);
      const earlier = index > 0 ? byId.get(project.stages[index - 1])!.tests!.length : 0;
      const own = task.tests!.slice(0, task.tests!.length - earlier);
      const startingCode = index === 0 ? task.starter : solutionFor(project.stages[index - 1])!.solution;
      const start = await runInSandbox({ code: startingCode, calls: own.map((one) => one.call), expectations: own.map((one) => one.expected) });
      assert.equal(start.codeError, null, `${id}: the code this level starts from runs`);
      assert.ok(start.results.some((one) => one.pass !== true), `${id}: the code this level starts from fails the level's own checks`);
    }
  }
  // The debug helper's hidden check reads what the call printed, so it tells
  // a helper that logs and returns from one that only does half the job.
  const printed = solutionFor('js-path-logging-5')!.hiddenTests!.find((one) => one.call.includes('printed'))!;
  const helper = async (code: string) => allPassed(await runInSandbox({ code, calls: [printed.call], expectations: [printed.expected] }));
  assert.equal(await helper('function debug(label, value) { console.log(label, value); return value; }'), true, 'console.log(label, value) and a return pass');
  assert.equal(await helper('function debug(label, value) { console.log({ [label]: value }); return value; }'), true, 'the object shorthand passes too');
  assert.equal(await helper('function debug(label, value) { console.debug(label, value); return value; }'), true, 'console.debug passes too');
  assert.equal(await helper('function debug(label, value) { return value; }'), false, 'returning without logging fails');
  assert.equal(await helper('function debug(label, value) { console.log(label, value); }'), false, 'logging without returning fails');
  assert.equal(await helper('function debug(label, value) { console.log(label); console.log(value); return value; }'), false, 'two lines for one value fail');
  // The older rendered-text probe above is deliberately broad. The actual
  // task also requires one two-argument console.log and exact value identity.
  const exactDebug = solutionFor('js-path-logging-5')!.hiddenTests!.find((one) => one.call.includes('values=[box'))!;
  assert.ok(exactDebug, 'the exact debug contract remains authored');
  const exactHelper = async (code: string) => allPassed(await runInSandbox({ code, calls: [exactDebug.call], expectations: [exactDebug.expected] }));
  assert.equal(await exactHelper('function debug(label,value){console.log(label,value);return value;}'), true, 'the exact two-argument helper passes');
  assert.equal(await exactHelper('function debug(label,value){console.info(label,value);return value;}'), false, 'another console method fails the exact task contract');
  assert.equal(await exactHelper('function debug(label,value){console.log({[label]:value});return value;}'), false, 'one wrapped object fails the exact argument contract');
  // The café-orders project leaves every list and nothing else: its ten
  // stages still open, grade and keep their drafts and passes (#225).
  const retiredProject = EVOLVING_CHALLENGES.find((project) => project.id === 'js-evolving-debug')!;
  assert.equal(retiredProject.unlisted, true, 'js-evolving-debug is unlisted');
  const everyList = [undefined, 'fullstack', 'debugging'].map((category) => listedChallenges({ category: category as 'fullstack' | 'debugging' | undefined }))
    .concat(CODING_SECTION_TRACKS.map((track) => listedChallenges({ track })));
  assert.ok(everyList.every((list) => !list.includes(retiredProject)), 'no list shows js-evolving-debug');
  const issued = new Set(CODING_SUMMARIES.map((summary) => summary.id));
  assert.equal(retiredProject.stages.length, 10, 'the retired project keeps its ten stages');
  for (const id of retiredProject.stages) {
    assert.ok(issued.has(id), `${id}: still issued, so a draft, a pass or a bookmark still opens`);
    assert.ok(solutionFor(id), `${id}: still graded`);
    assert.ok(evolvingStage(id)?.challenge === retiredProject, `${id}: still unlocks in order`);
  }

  // ── the learner console ────────────────────────────────────────────────
  // The Run button's worker and the grading sandbox print the same lines for
  // every console method the debugging paths teach. Timings differ (the
  // sandbox clock is virtual), so they are checked on their own.
  const consoleProgram = [
    'console.log({ total: 12 }, "label", [1, 2], undefined);',
    'console.table([{ name: "tea", price: 3 }, { name: "cake", price: 2.5, qty: 1 }]);',
    'console.table([1, "two"]);',
    'console.group("checkout"); console.count("addPoints"); console.count("addPoints"); console.table({ a: { x: 1 } }); console.groupEnd();',
    'console.countReset("addPoints"); console.count("addPoints"); console.count();',
    'console.assert(false, "broken", 3); console.assert(true, "fine");',
    'console.dir({ deep: { er: 1 } }); console.trace("here"); console.info("i"); console.warn("w"); console.error("e"); console.debug("d");',
    'console.timeEnd("never"); console.time("t"); console.time("t"); console.groupCollapsed(); console.log("inside"); console.groupEnd();',
  ].join('\n');
  const inSandbox = await runInSandbox({ code: consoleProgram, calls: [], expectations: null });
  const inWorker = await evaluateCalls({ code: consoleProgram, calls: [], expectations: null });
  assert.equal(inSandbox.codeError, null, 'every taught console method exists in the sandbox');
  assert.equal(inWorker.codeError, null, 'every taught console method exists in the worker');
  assert.deepEqual(inWorker.logs, inSandbox.logs, 'both runners print the same lines');
  assert.deepEqual(inSandbox.logs.slice(0, 5), [
    '{"total":12} label [1,2] undefined',
    '(index) | name   | price | qty\n--------+--------+-------+----\n0       | "tea"  | 3     |\n1       | "cake" | 2.5   | 1',
    '(index) | Values\n--------+-------\n0       | 1\n1       | "two"',
    'checkout',
    '  addPoints: 1',
  ], 'console.table draws rows under their index, and a group indents');
  const timed = await runInSandbox({ code: 'console.time("wait"); setTimeout(() => console.timeEnd("wait"), 100);', calls: ['new Promise((done) => setTimeout(done, 150))'], expectations: null });
  assert.deepEqual(timed.logs, ['wait: 100ms'], 'console.time reads the sandbox\'s virtual clock');

  const byLabel = CODING_DIFFICULTIES.map((label) => `${label} ${labelCounts.get(label) ?? 0}`).join(', ');
  console.log(`Coding content contract passed: ${CODING_TASKS.length} tasks (${byTrack}), ${CODING_SUMMARIES.length} issued (${byLabel}), solutions proven, payloads answer-free${ALLOW_GAPS ? ', level gaps allowed' : ''}.`);
}

/* ── staged levels, new-array promises and typed parameters ─────────── */
// Three ways to pass a task without doing what its statement asks.
//  1. A staged family (an evolving project, a short path, a FullStack app)
//     shows the reference, junior and senior boards once a level is passed.
//     None of them may pass the next level or its checkpoint as they stand,
//     or pasting one back earns that level for nothing. React levels prove
//     the reference only, because their suites take far longer to run.
//  2. A statement that promises a new array is held to it: the reference
//     changed to write its result into the array it was given, and hand that
//     same array back, has to fail a check.
//  3. A TypeScript signature is held by the type tests: the reference with
//     every parameter typed `any` has to fail one. A checkpoint is graded on
//     its smaller contract alone, so only the milestones are held to this.
type ContentTask = (typeof CODING_TASKS)[number];

/** How many parameters of the top-level functions are typed as something
 * other than `unknown` or `any`: loosening those shows at the call site. */
const typedParameterCount = (ts: TypeScriptApi, source: string): number => {
  let count = 0;
  const typed = (fn: import('typescript').SignatureDeclarationBase) => {
    for (const parameter of fn.parameters) {
      const kind = parameter.type?.kind;
      if (kind !== undefined && kind !== ts.SyntaxKind.UnknownKeyword && kind !== ts.SyntaxKind.AnyKeyword) count += 1;
    }
  };
  for (const statement of ts.createSourceFile('solution.ts', source, ts.ScriptTarget.Latest, true).statements) {
    if (ts.isFunctionDeclaration(statement)) typed(statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const value = declaration.initializer;
        if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) typed(value);
      }
    }
  }
  return count;
};

/** The solution with every function parameter typed `any`, callbacks too so
 * the loosened code still compiles. Type parameters and return types stay,
 * and so does every type written inside an annotation. */
const everyParameterAny = (ts: TypeScriptApi, source: string): string => {
  const file = ts.createSourceFile('solution.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const any = (rest: boolean) => {
    const one = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    return rest ? ts.factory.createArrayTypeNode(one) : one;
  };
  const loosen = (parameters: import('typescript').NodeArray<import('typescript').ParameterDeclaration>) => ts.factory.createNodeArray(parameters.map((one) =>
    ts.factory.updateParameterDeclaration(one, one.modifiers, one.dotDotDotToken, one.name, one.questionToken, any(Boolean(one.dotDotDotToken)), one.initializer)));
  const transformer: import('typescript').TransformerFactory<import('typescript').SourceFile> = (context) => {
    const visit = (node: import('typescript').Node): import('typescript').Node => {
      // A function type inside an annotation is a type, not a function.
      if (ts.isTypeNode(node)) return node;
      const next = ts.visitEachChild(node, visit, context);
      if (ts.isArrowFunction(next)) return ts.factory.updateArrowFunction(next, next.modifiers, next.typeParameters, loosen(next.parameters), next.type, next.equalsGreaterThanToken, next.body);
      if (ts.isFunctionExpression(next)) return ts.factory.updateFunctionExpression(next, next.modifiers, next.asteriskToken, next.name, next.typeParameters, loosen(next.parameters), next.type, next.body);
      if (ts.isFunctionDeclaration(next)) return ts.factory.updateFunctionDeclaration(next, next.modifiers, next.asteriskToken, next.name, next.typeParameters, loosen(next.parameters), next.type, next.body);
      if (ts.isMethodDeclaration(next)) return ts.factory.updateMethodDeclaration(next, next.modifiers, next.asteriskToken, next.name, next.questionToken, next.typeParameters, loosen(next.parameters), next.type, next.body);
      return next;
    };
    return (sourceFile) => ts.visitNode(sourceFile, visit) as import('typescript').SourceFile;
  };
  const result = ts.transform(file, [transformer]);
  try {
    return ts.createPrinter().printFile(result.transformed[0]);
  } finally {
    result.dispose();
  }
};

/** Statements that promise the result is a new array. */
const NEW_ARRAY = /\bnew (?:array|list)\b/i;

/** The solution changed to work in place: every top-level function that a
 * check calls with an array literal first writes its result into that array
 * and hands the same array back, so the values still match. As a `probe` it
 * throws there instead, which shows whether any check reaches the rewrite; as
 * a `control` it changes nothing, which shows the wrapping itself is sound.
 * Null when no check passes a top-level function an array literal first. */
const inPlaceVariant = (ts: TypeScriptApi, js: string, checks: readonly Check[], mode: 'write' | 'probe' | 'control'): string | null => {
  const names = topLevelNames(ts, js);
  const wrapped = new Set<string>();
  for (const check of checks) {
    const visit = (node: import('typescript').Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.includes(node.expression.text) && node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) wrapped.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(ts.createSourceFile('call.ts', `(${check.call.trim().replace(/;+$/, '')}\n)`, ts.ScriptTarget.Latest, true));
  }
  if (wrapped.size === 0) return null;
  const write = { write: 'args[0].length = 0; args[0].push(...out); return args[0];', probe: 'throw new Error("in place");', control: '' }[mode];
  return [
    `const __original = (() => {\n${js}\n;return { ${names.join(', ')} };\n})();`,
    ...names.map((name) => wrapped.has(name)
      ? `function ${name}(...args) { const out = __original.${name}(...args); if (Array.isArray(args[0]) && Array.isArray(out) && out !== args[0]) { ${write} } return out; }`
      : `const ${name} = __original.${name};`),
  ].join('\n');
};

async function stagesPromisesAndSignatures({ fail, checker, ts, byId }: {
  fail: (message: string) => void;
  checker: ReturnType<typeof createTypeScript>;
  ts: TypeScriptApi;
  byId: ReadonlyMap<string, ContentTask>;
}): Promise<void> {
  const started = Date.now();
  // The production grader's verdict: the visible checks and, in a fresh
  // program, the hidden ones.
  const passesChecks = async (task: ContentTask, code: string): Promise<boolean> => {
    const run = await withTimeout(runChecks({ runtimePolicy: runtimePolicyForTask(task.id), code, visible: task.tests ?? [], hidden: solutionFor(task.id)?.hiddenTests ?? [], shuffle: (list) => list }), 8_000, task.id);
    return allPassed(run.visible) && (!run.hidden || allPassed(run.hidden));
  };
  // The same with the type tests (visible and hidden) first for TypeScript,
  // and the suite with its hidden cases for React.
  const passesTask = async (task: ContentTask, source: string): Promise<boolean> => {
    const solution = solutionFor(task.id);
    if (task.track === 'react') {
      const run = await withTimeout(runReactSuite({ suite: withHiddenCases(task.suite!, solution?.hiddenSuite), appSource: source }), 20_000, task.id);
      return !run.compileError && run.failed === 0 && run.total > 0;
    }
    if (task.track !== 'typescript') return passesChecks(task, source);
    if (!typesPassed(checker.check(source, task.typeTests ?? []))) return false;
    if (solution?.hiddenTypeTests?.length && !typesPassed(checker.check(source, solution.hiddenTypeTests))) return false;
    return passesChecks(task, checker.toJavaScript(source));
  };

  // 1. What a pass shows must not pass the next level.
  let staged = 0;
  for (const project of EVOLVING_CHALLENGES) {
    const milestones = project.stages.filter((id) => !id.endsWith('-start'));
    for (const id of project.stages) {
      if (!ONLY.test(id)) continue;
      const earlier = milestones[milestones.indexOf(id.endsWith('-start') ? id.slice(0, -6) : id) - 1];
      const task = byId.get(id);
      const before = earlier ? byId.get(earlier) : undefined;
      const shown = earlier ? solutionFor(earlier) : undefined;
      if (!task || !before || !shown || task.verify !== 'tests' || task.track !== before.track) continue;
      const boards: [string, string | undefined][] = task.track === 'react'
        ? [['reference', shown.solution]]
        : [['reference', shown.solution], ['junior', shown.junior], ['senior', shown.senior]];
      for (const [name, source] of boards) {
        if (!source?.trim()) continue;
        staged += 1;
        if (await passesTask(task, source)) fail(`${id}: the ${name} solution of ${earlier}, shown once that level is passed, already passes this one`);
      }
    }
  }

  // 1b. What a checkpoint shows must not pass the milestone it leads to. Its
  // reference opens on giving up there, and for free once it is passed (any
  // boards with the pass), while the milestone is still to do: pasted into
  // the milestone, with its hidden checks, it has to fail. The proofs above
  // show it passes the checkpoint itself.
  // The store's first checkpoint asks for get and set, and its milestone only
  // adds false, 0 and null, which any closure that stores the value already
  // keeps. An honest reference passes both; only reshaping the two stages can
  // change that, which is the owner's call. Its reference is still proven to
  // pass the milestone, so this entry goes stale once the stages differ.
  // The result project's first and fourth checkpoints ask for successes only,
  // and their milestones add failures. Reading value without narrowing on ok
  // was the only way to stay short of them, and it turned a failure into a
  // success; the narrowing their hints ask for already keeps a failure apart,
  // which is all the milestones add. The same owner's call applies.
  // Such a checkpoint's reference opens wherever the checkpoint does, so it
  // may be free only when its milestone is: the first two lead to a free
  // milestone, and the fourth is Premium with its milestone. A free
  // checkpoint whose reference passes a Premium milestone fails here.
  const SAME_AS_MILESTONE = new Set(['ts-evolving-store-1-start', 'ts-evolving-result-1-start', 'ts-evolving-result-4-start']);
  let checkpoints = 0;
  for (const project of EVOLVING_CHALLENGES) {
    for (const id of project.stages) {
      if (!id.endsWith('-start') || !ONLY.test(id)) continue;
      if (SAME_AS_MILESTONE.has(id)) {
        const milestone = byId.get(id.slice(0, -6));
        const shown = solutionFor(id);
        if (!milestone || !shown || !await passesTask(milestone, shown.solution)) fail(`${id}: no longer matches its milestone; drop it from SAME_AS_MILESTONE`);
        else if (isFreeCodingTask(id) && !isFreeCodingTask(milestone.id)) fail(`${id}: free, and its reference passes ${milestone.id}, which is Premium`);
        continue;
      }
      const milestone = byId.get(id.slice(0, -6));
      const shown = solutionFor(id);
      if (!milestone || !shown || milestone.verify !== 'tests') continue;
      for (const [name, source] of [['reference', shown.solution], ['junior', shown.junior], ['senior', shown.senior]] as const) {
        if (!source?.trim()) continue;
        checkpoints += 1;
        if (await passesTask(milestone, source)) fail(`${id}: its ${name} solution, shown on giving up or after a pass, already passes ${milestone.id}`);
      }
    }
  }

  // 2. A promised new array: an in-place version of the reference must fail.
  let promises = 0;
  for (const task of CODING_TASKS) {
    if (task.verify !== 'tests' || task.track === 'react' || !task.tests || !ONLY.test(task.id) || !NEW_ARRAY.test(task.prompt)) continue;
    const solution = solutionFor(task.id);
    if (!solution) continue;
    const js = task.track === 'typescript' ? checker.toJavaScript(solution.solution) : solution.solution;
    const checks = [...task.tests, ...(solution.hiddenTests ?? [])];
    const control = inPlaceVariant(ts, js, checks, 'control');
    if (!control) continue;
    if (!await passesChecks(task, control)) { fail(`${task.id}: the reference wrapped for the in-place check no longer passes, so that check proves nothing`); continue; }
    // No call hands back a different array from the one it was given: the
    // promise is about something the rewrite cannot reach.
    if (await passesChecks(task, inPlaceVariant(ts, js, checks, 'probe')!)) continue;
    promises += 1;
    if (await passesChecks(task, inPlaceVariant(ts, js, checks, 'write')!)) fail(`${task.id}: the statement promises a new array, and a version that changes the array it was given and returns it passes every check`);
  }

  // 3. A TypeScript signature: every parameter typed any must fail a type test.
  let signatures = 0;
  for (const task of CODING_TASKS) {
    if (task.track !== 'typescript' || task.verify !== 'tests' || !task.tests || task.id.endsWith('-start') || !ONLY.test(task.id)) continue;
    const solution = solutionFor(task.id);
    if (!solution || typedParameterCount(ts, solution.solution) === 0) continue;
    signatures += 1;
    const loose = everyParameterAny(ts, solution.solution);
    if (typesPassed(checker.check(loose, task.typeTests ?? [])) && typesPassed(checker.check(loose, solution.hiddenTypeTests ?? []))) {
      fail(`${task.id}: the reference with every parameter typed any still passes the type tests, so they do not hold the signature the statement gives`);
    }
  }
  // 4. Known answers: a mistake a hidden case was added for still fails, and
  // a correct answer a check once refused still passes.
  const knownSource = (known: KnownAnswer): string | null => {
    let source = known.code ?? solutionFor(known.id)?.solution ?? '';
    for (const [from, to] of known.replace ?? []) {
      if (!source.includes(from)) return null;
      source = source.split(from).join(to);
    }
    return source || null;
  };
  let knownAnswers = 0;
  for (const [list, expected] of [[KNOWN_WRONG_CODE, false], [KNOWN_RIGHT_CODE, true]] as const) {
    for (const known of list) {
      if (!ONLY.test(known.id)) continue;
      const task = byId.get(known.id);
      const source = knownSource(known);
      if (!task || source === null) { fail(`${known.id}: the known answer "${known.label}" no longer applies to the reference; rewrite it in scripts/coding-known-answers.ts`); continue; }
      knownAnswers += 1;
      if (await passesTask(task, source) !== expected) fail(`${known.id}: ${known.label} ${expected ? 'fails a check the statement does not ask for' : 'passes every check'}`);
    }
  }
  // 5. DSA Foundations (#493): a wrong answer tagged with a criterion must
  // fail a check tagged with that criterion (an untagged check holds `core`),
  // so a variant that only trips a value check cannot stand in for the read,
  // write, call or comparison probe its criterion names.
  let attributed = 0;
  const dsaSources = new Map(DSA_FOUNDATIONS_TASKS.map((task) => [task.id, task]));
  for (const known of DSA_FOUNDATIONS_WRONG) {
    if (!ONLY.test(known.id)) continue;
    const task = dsaSources.get(known.id);
    const source = knownSource(known);
    if (!task || source === null) continue;
    const visible = task.tests ?? [];
    const hidden = solutionFor(known.id)?.hiddenTests ?? [];
    const run = await withTimeout(runChecks({ runtimePolicy: runtimePolicyForTask(known.id), code: source, visible, hidden, shuffle: (list) => list }), 8_000, known.id);
    const failed = new Set<string>();
    for (const [checks, result] of [[visible, run.visible], [hidden, run.hidden]] as const) {
      if (!result || result.codeError || result.timedOut) continue;
      checks.forEach((check, index) => { if (result.results[index]?.pass !== true) failed.add(check.criterion ?? 'core'); });
    }
    const criterion = known.criterion ?? 'core';
    attributed += 1;
    if (!failed.has(criterion)) fail(`${known.id}: ${known.label} is tagged ${criterion}, but fails no check tagged ${criterion} (it fails: ${[...failed].join(', ') || 'only by not loading or timing out'})`);
  }
  console.log(`DSA Foundations: ${attributed} criterion-tagged wrong answers graded against the checks of their criterion.`);
  console.log(`Staged levels, promises and signatures: ${staged} earlier solutions fail the next level, ${checkpoints} checkpoint solutions fail their milestone, ${promises} new-array promises and ${signatures} TypeScript signatures are held by a check, and ${knownAnswers} known answers keep their verdict (${((Date.now() - started) / 1000).toFixed(1)} s).`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
