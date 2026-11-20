/** Conservative, bounded AST inspection; submitted code is never executed here.
 * This reports structural estimates, not a proof or a runtime benchmark. */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as TS from 'typescript';
import { complexityGuidance, type ComplexityReport } from '../../shared/coding-complexity';
import type { CodingTask } from '../../shared/coding-catalog';

/** The compiler, loaded on the first assessment instead of at import. Every
 * function that grades code imports this module, and TypeScript costs about
 * 90 ms and 15 MB of heap to load, which each new instance paid before its
 * first answer even when that was a Learn level or a wallet read (#587,
 * server item 16). The first Submit on an instance pays it instead.
 *
 * @vercel/node compiles this file to CommonJS, where the plain
 * `require('typescript')` below is what its file tracer follows into the
 * function bundle. Scripts bundled as ESM have no real `require` (esbuild's
 * stand-in has no `resolve`), so they load it from the working directory. */
let ts: typeof TS;
function loadTypeScript(): void {
  if (ts) return;
  ts = typeof require === 'function' && typeof require.resolve === 'function'
    ? require('typescript') as typeof TS
    : createRequire(join(process.cwd(), 'package.json'))('typescript') as typeof TS;
}

/** Whether `text` mentions one of `names` as a whole identifier. One scan of
 * the text, not one RegExp per name: a loop condition was matched against a
 * new pattern for every input binding, so a submission with hundreds of
 * bindings and loops spent seconds here. Names are identifiers and are never
 * read as patterns, so `$` in one is a character, not an anchor. */
const IDENTIFIER_TOKEN = /[\w$]+/g;
const inputNames = (text: string, names: ReadonlySet<string>): boolean =>
  names.size > 0 && (text.match(IDENTIFIER_TOKEN) ?? []).some((token) => names.has(token));

type Cost = { power: number; log: number };
const constant: Cost = { power: 0, log: 0 };
const linear: Cost = { power: 1, log: 0 };
const max = (a: Cost, b: Cost): Cost => a.power > b.power || (a.power === b.power && a.log >= b.log) ? a : b;
const multiply = (a: Cost, b: Cost): Cost => ({ power: a.power + b.power, log: a.log + b.log });
const label = (cost: Cost): string => {
  const n = cost.power === 0 ? '' : cost.power === 1 ? 'n' : `n^${cost.power}`;
  const log = cost.log === 0 ? '' : cost.log === 1 ? 'log n' : `(log n)^${cost.log}`;
  return `O(${[n, log].filter(Boolean).join(' ') || '1'})`;
};
const targetCost = (value: string): Cost | null => {
  const simple: Record<string, Cost> = { 'O(1)': constant, 'O(log n)': { power: 0, log: 1 }, 'O(n)': linear, 'O(n log n)': { power: 1, log: 1 }, 'O(n²)': { power: 2, log: 0 } };
  if (simple[value]) return simple[value];
  const power = value.match(/^O\(n\^(\d+)\)$/);
  return power ? { power: Number(power[1]), log: 0 } : null;
};
/** Node visits one assessment may spend outside the cost walk: the deferred-
 * work check and the binding passes run again for every call of a helper, so
 * a helper called a thousand times was inspected a thousand times with no
 * shared limit. The authored solutions use at most a few thousand. */
const ANALYSIS_STEPS = 150_000;
type AnalysisBudget = { left: number };
const ANALYSIS_LIMIT_MESSAGE = 'The analysis limit was reached. Review the code manually.';

const scanMethods = new Set(['map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every', 'find', 'findIndex', 'includes', 'indexOf', 'lastIndexOf', 'slice', 'split', 'join', 'reverse', 'toReversed', 'flat', 'flatMap', 'concat', 'replace', 'replaceAll', 'toLowerCase', 'toUpperCase', 'trim', 'substring', 'substr', 'shift', 'unshift', 'splice']);
const rangeMethods = new Set(['slice', 'substring', 'substr']);
const callbackMethods = new Set(['map', 'filter', 'reduce', 'reduceRight', 'forEach', 'some', 'every', 'find', 'findIndex', 'flatMap', 'sort', 'toSorted']);
const scalarMethods = new Set(['push', 'pop', 'get', 'set', 'has', 'add', 'delete', 'charAt', 'charCodeAt', 'at', 'test', 'isArray', 'isInteger', 'isFinite', 'abs', 'floor', 'ceil', 'round', 'min', 'max', 'log2', 'sqrt']);

/** A factory's construction is not the workload of its returned callable.
 * Follow locally visible value aliases, without interpreting arbitrary calls
 * or mistaking map/Promise callbacks for functions returned to the caller.
 * Unresolved dynamic factories still require manual review; this is not a
 * general interprocedural type or lifetime analysis. */
function returnsDeferredWork(fn: TS.FunctionLikeDeclaration, budget: AnalysisBudget): boolean {
  if (!fn.body) return false;
  const bindings = new Map<string, TS.Node[]>();
  const aliases = new Map<string, Set<string>>();
  const containerWrites: [string, TS.Node][] = [];
  let visited = 0;
  let limited = false;
  const callable = (node: TS.Node): boolean => ts.isArrowFunction(node) || ts.isFunctionExpression(node)
    || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isClassExpression(node) || ts.isClassDeclaration(node);
  const addValue = (name: string, value: TS.Node): void => {
    const values = bindings.get(name);
    if (values) values.push(value);
    else bindings.set(name, [value]);
  };
  const bind = (name: string, value: TS.Node): void => {
    addValue(name, value);
    if (ts.isIdentifier(value)) {
      for (const [left, right] of [[name, value.text], [value.text, name]]) {
        const related = aliases.get(left) ?? new Set<string>();
        related.add(right);
        aliases.set(left, related);
      }
    }
  };
  const collect = (node: TS.Node): void => {
    if (++visited > 12_000 || --budget.left < 0) { limited = true; return; }
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) bind(node.name.text, node);
    if (callable(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bind(node.name.text, node.initializer);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) bind(node.left.text, node.right);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
      && ts.isIdentifier(node.left.expression)) containerWrites.push([node.left.expression.text, node.right]);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression)
      && ['push', 'unshift', 'splice', 'set', 'add'].includes(node.expression.name.text)) {
      for (const value of node.arguments) containerWrites.push([node.expression.expression.text, value]);
    }
    ts.forEachChild(node, collect);
  };
  collect(fn.body);
  // Account for callables added after a container was created, including
  // writes through a possible local alias. This over-approximates flow and
  // therefore withholds a report rather than assuming construction is enough.
  for (const [owner, value] of containerWrites) {
    if (limited) break;
    const pending = [owner];
    const seen = new Set<string>();
    while (pending.length) {
      if (++visited > 12_000 || --budget.left < 0) { limited = true; break; }
      const name = pending.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      addValue(name, value);
      for (const alias of aliases.get(name) ?? []) pending.push(alias);
    }
  }
  const deferred = (node: TS.Node, seen = new Set<TS.Node>()): boolean => {
    if (++visited > 12_000 || --budget.left < 0) return true;
    if (seen.has(node)) return false;
    // Reachability has no per-path type state: visit each value node once,
    // rather than copying a growing Set for a long chain of aliases.
    seen.add(node);
    const next = seen;
    if (callable(node)) return true;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
      || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) return deferred(node.expression, next);
    if (ts.isIdentifier(node)) return (bindings.get(node.text) ?? []).some(value => deferred(value, next));
    if (ts.isConditionalExpression(node)) return deferred(node.whenTrue, next) || deferred(node.whenFalse, next);
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.CommaToken) return deferred(node.right, next);
      if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
        return deferred(node.left, next) || deferred(node.right, next);
      }
    }
    if (ts.isObjectLiteralExpression(node)) return node.properties.some(property => {
      if (callable(property)) return true;
      if (ts.isPropertyAssignment(property)) return deferred(property.initializer, next);
      if (ts.isShorthandPropertyAssignment(property)) return deferred(property.name, next);
      return ts.isSpreadAssignment(property) && deferred(property.expression, next);
    });
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(element =>
      deferred(ts.isSpreadElement(element) ? element.expression : element, next));
    // An eager call's callback is not itself the returned value. Named helper
    // calls are inspected separately by inspectFunction when they execute.
    return false;
  };
  if (!ts.isBlock(fn.body)) return limited || deferred(fn.body);
  let found = limited;
  const returns = (node: TS.Node): void => {
    if (++visited > 12_000 || --budget.left < 0) { found = true; return; }
    if (callable(node)) return;
    if (ts.isReturnStatement(node) && node.expression && deferred(node.expression)) found = true;
    if (!found) ts.forEachChild(node, returns);
  };
  returns(fn.body);
  return found;
}

function inspectComplexity(task: Pick<CodingTask, 'track' | 'prompt' | 'tests'>, code: string): ComplexityReport {
  const guidance = complexityGuidance(task);
  const assumptions = 'Static estimate, not a proof. Assumes input-sized collections, bounded callbacks, constant-time indexing and average constant-time Map/Set operations. Numeric loop bounds are treated as magnitudes, not bit lengths. Sort is modelled as n log n; actual engine behaviour can differ. Timing and extra space are not measured.';
  const unknown = (explanation: string): ComplexityReport => ({ time: null, assessment: 'unknown', explanation, assumptions, guidance });
  if (task.track === 'react' || task.track === 'system-design' || !task.tests?.length) return unknown(guidance.note);
  // The cost model collapses input traversals into a single n. It cannot
  // label independently sized inputs or output-sensitive authored targets.
  if (guidance.targetTime && !targetCost(guidance.targetTime)) return unknown('The authored input-size model needs manual complexity review.');
  if (code.length > 20_000) return unknown('This submission is too large for the structural estimate.');
  const file = ts.createSourceFile('solution.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((file as TS.SourceFile & { parseDiagnostics: unknown[] }).parseDiagnostics.length) return unknown('Fix the syntax before assessing complexity.');
  const functions = new Map<string, TS.FunctionLikeDeclaration>();
  // Name top-level helpers. Unresolved or recursive calls fail closed below.
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) functions.set(declaration.name.text, declaration.initializer);
    }
  }
  const entries = new Set<string>();
  const testedStrings = new Map<TS.FunctionLikeDeclaration, Set<string>>();
  for (const test of task.tests) {
    const expression = ts.createSourceFile('test.ts', test.call, ts.ScriptTarget.Latest, true);
    const visit = (node: TS.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && functions.has(node.expression.text)) {
        entries.add(node.expression.text);
        const fn = functions.get(node.expression.text)!;
        const names = testedStrings.get(fn) ?? new Set<string>();
        node.arguments.forEach((argument, index) => {
          const parameter = fn.parameters[index];
          if (parameter && ts.isIdentifier(parameter.name) && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) names.add(parameter.name.text);
        });
        testedStrings.set(fn, names);
      }
      ts.forEachChild(node, visit);
    };
    visit(expression);
  }
  if (!entries.size) return unknown('The tested entry point cannot be resolved statically. Review this implementation manually.');
  let uncertainty: string | null = null;
  let loopReturns = false;
  let shortCircuitScans = false;
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (init && !ts.isArrowFunction(init) && !ts.isFunctionExpression(init) && !ts.isStringLiteral(init) && !ts.isNumericLiteral(init) && !ts.isRegularExpressionLiteral(init) && ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(init.kind)) uncertainty = 'Setup outside the tested function needs a manual input-size review.';
    }
  }
  const evidence = new Set<string>();
  let visited = 0;
  const budget: AnalysisBudget = { left: ANALYSIS_STEPS };
  // Whether a function returns deferred work depends on its source alone.
  const deferredWork = new Map<TS.FunctionLikeDeclaration, boolean>();
  const inspectFunction = (fn: TS.FunctionLikeDeclaration, stack: Set<string>, inherited: Set<string> = new Set(), inputParameters?: Set<string>): Cost => {
    let deferred = deferredWork.get(fn);
    if (deferred === undefined) deferredWork.set(fn, deferred = returnsDeferredWork(fn, budget));
    if (deferred) {
      uncertainty = 'Construction and the returned callable workload need separate complexity scopes.';
      return constant;
    }
    const parameters = inputParameters ?? new Set(fn.parameters.flatMap((parameter) => ts.isIdentifier(parameter.name) ? [parameter.name.text] : []));
    const bounds = new Set(inherited);
    // A callback's item is not automatically a whole input-sized collection.
    for (const parameter of fn.parameters) if (ts.isIdentifier(parameter.name)) bounds.delete(parameter.name.text);
    for (const parameter of parameters) bounds.add(parameter);
    const fixedCollections = new Set<string>();
    const numericLiteral = (node: TS.Node): number | null => ts.isNumericLiteral(node) ? Number(node.text)
      : ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand) ? -Number(node.operand.text) : null;
    const collectionKind = (node: TS.Node): 'input' | 'fixed' | 'unknown' => {
      if (ts.isParenthesizedExpression(node)) return collectionKind(node.expression);
      if (ts.isIdentifier(node)) return fixedCollections.has(node.text) ? 'fixed' : bounds.has(node.text) ? 'input' : 'unknown';
      if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return 'fixed';
      if (ts.isArrayLiteralExpression(node)) return node.elements.some(ts.isSpreadElement) ? 'unknown' : 'fixed';
      if (ts.isPropertyAccessExpression(node) && node.name.text === 'length') return collectionKind(node.expression);
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operatorToken.kind)
        && numericLiteral(node.right) !== null && collectionKind(node.left) === 'input') return 'input';
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        if (rangeMethods.has(method)) {
          // A range copy costs the copied width, not necessarily the whole
          // receiver. Dynamic endpoints need flow/clamping analysis that this
          // model does not provide (e.g. slice(i, i + 2) in a linear scan).
          const endpoints = node.arguments.map(argument => {
            const value = numericLiteral(argument);
            return value !== null && Number.isSafeInteger(Math.trunc(value)) ? Math.trunc(value) : null;
          });
          if (endpoints.some(value => value === null)) return 'unknown';
          if (endpoints.length >= 2) {
            // slice(1, -1) can span input data; substring clamps negatives
            // and substr's second argument is a length. Do not call every
            // pair of literals a fixed window merely because both are known.
            if (method === 'slice' && endpoints[0]! >= 0 && endpoints[1]! < 0) return 'unknown';
            return 'fixed';
          }
          if (endpoints.length === 1 && ['slice', 'substr'].includes(method) && endpoints[0]! < 0) return 'fixed';
          return collectionKind(node.expression.expression);
        }
        if (scanMethods.has(method) || method === 'sort' || method === 'toSorted') return collectionKind(node.expression.expression);
        if (['Object', 'Array'].includes(node.expression.expression.getText(file)) && ['keys', 'values', 'entries', 'from'].includes(method)) return node.arguments[0] ? collectionKind(node.arguments[0]) : 'unknown';
      }
      return 'unknown';
    };
    const strings = new Set<string>(fn.parameters.flatMap(parameter =>
      ts.isIdentifier(parameter.name) && parameter.type?.kind === ts.SyntaxKind.StringKeyword ? [parameter.name.text] : []));
    for (const name of testedStrings.get(fn) ?? []) strings.add(name);
    const regexes = new Map<string, string>();
    const collect = (node: TS.Node) => {
      if (--budget.left < 0) return;
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.type?.kind === ts.SyntaxKind.StringKeyword) strings.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const kind = collectionKind(node.initializer);
        if (bounds.has(node.name.text)) uncertainty = 'A shadowed input binding needs manual review.';
        if (kind === 'input') bounds.add(node.name.text);
        if (kind === 'fixed') fixedCollections.add(node.name.text);
      }
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && bounds.has(node.left.text)
        && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) uncertainty = 'An input-size binding changes during the algorithm.';
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) strings.add(node.name.text);
        if (ts.isRegularExpressionLiteral(node.initializer)) regexes.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, collect);
    };
    if (fn.body) collect(fn.body);
    // Input sizes, before loop indices join `bounds`. A `var` index outlives
    // its loop, so it joins these too.
    const sizes = new Set(bounds);
    // A loop index can bound a nested scan (for j < i).
    if (fn.body) {
      const indices = (node: TS.Node) => {
        if (--budget.left < 0) return;
        if (ts.isForStatement(node) && node.condition && inputNames(node.condition.getText(file), bounds) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
          const blockScoped = (node.initializer.flags & ts.NodeFlags.BlockScoped) !== 0;
          for (const declaration of node.initializer.declarations) if (ts.isIdentifier(declaration.name)) {
            bounds.add(declaration.name.text);
            if (!blockScoped) sizes.add(declaration.name.text);
          }
        }
        ts.forEachChild(node, indices);
      };
      indices(fn.body);
    }
    const inputBound = (node: TS.Node): boolean => inputNames(node.getText(file), bounds);
    // A `let` index bounds a loop only inside the loop that declares it. Read
    // from `bounds`, which holds every index of the function, a later loop
    // that reuses the name (for (let i = 0; i < 26; i++)) counted as input-
    // sized, so an O(n) solution read as O(n^2), above target, with less XP.
    const declaresIndex = (loop: TS.ForStatement, name: string): boolean => !!loop.initializer
      && ts.isVariableDeclarationList(loop.initializer)
      && loop.initializer.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name);
    const indexLoops = new Map<TS.ForStatement, boolean>();
    const indexBounded = (loop: TS.ForStatement): boolean => {
      let known = indexLoops.get(loop);
      if (known === undefined) indexLoops.set(loop, known = !!loop.condition && loopInputBound(loop, loop.condition));
      return known;
    };
    const loopInputBound = (loop: TS.Node, condition: TS.Expression): boolean => {
      const names = condition.getText(file).match(IDENTIFIER_TOKEN) ?? [];
      if (names.some((name) => sizes.has(name))) return true;
      return names.some((name) => {
        if (!bounds.has(name)) return false;
        for (let scope: TS.Node | undefined = loop; scope; scope = scope.parent) {
          if (--budget.left < 0) return false;
          // A loop's own index is not its bound.
          if (ts.isForStatement(scope) && declaresIndex(scope, name)) return scope !== loop && indexBounded(scope);
        }
        return false;
      });
    };
    const fixedBound = (operand: TS.Expression): boolean => {
      if (ts.isParenthesizedExpression(operand)) return fixedBound(operand.expression);
      if (numericLiteral(operand) !== null) return true;
      if (ts.isIdentifier(operand)) return fixedCollections.has(operand.text);
      if (ts.isPropertyAccessExpression(operand) && operand.name.text === 'length') return collectionKind(operand.expression) === 'fixed';
      return ts.isBinaryExpression(operand) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(operand.operatorToken.kind)
        && numericLiteral(operand.right) !== null && fixedBound(operand.left);
    };
    const walk = (node: TS.Node): Cost => {
      visited += 1;
      if (visited > 12_000 || budget.left < 0) { uncertainty = ANALYSIS_LIMIT_MESSAGE; return constant; }
      if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && strings.has(node.left.text) && [ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.EqualsToken].includes(node.operatorToken.kind)) uncertainty = 'Growing immutable strings need a manual review of copying costs.';
      if (ts.isTemplateExpression(node) && node.templateSpans.some(span => collectionKind(span.expression) !== 'fixed')) {
        uncertainty = 'Input-dependent string construction needs a manual review of output costs.';
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const stringOperand = (operand: TS.Expression): boolean => ts.isStringLiteral(operand)
          || ts.isNoSubstitutionTemplateLiteral(operand) || ts.isTemplateExpression(operand)
          || (ts.isIdentifier(operand) && strings.has(operand.text));
        if ((stringOperand(node.left) || stringOperand(node.right))
          && (collectionKind(node.left) !== 'fixed' || collectionKind(node.right) !== 'fixed')) {
          uncertainty = 'Input-dependent string construction needs a manual review of output costs.';
        }
      }
      if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return constant;
      if (ts.isForInStatement(node)) { uncertainty = 'Object enumeration needs a manual review of the input model.'; return constant; }
      if (ts.isForOfStatement(node)) {
        evidence.add('Input traversal');
        const kind = collectionKind(node.expression);
        if (kind === 'unknown') uncertainty = 'The traversed collection cannot be related to the input size.';
        return max(walk(node.expression), multiply(kind === 'input' ? linear : constant, walk(node.statement)));
      }
      if (ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        const condition = ts.isForStatement(node) ? node.condition : node.expression;
        if (!condition) { uncertainty = 'An unbounded loop cannot be assessed statically.'; return constant; }
        const increment = ts.isForStatement(node) ? node.incrementor?.getText(file) ?? '' : node.statement.getText(file);
        if (!/\+\+|--|\+=\s*\d+|-=\s*\d+|\/=\s*2|\*=\s*2|>>=\s*1/.test(increment)) {
          uncertainty = 'A loop has no recognised monotonic step. Its iteration count needs manual review.';
        }
        let loop: Cost = constant;
        // Input mentioned somewhere in a condition is not a proof that the
        // induction variable traverses it. Capped/chunked bounds and shared
        // pointers need accounting beyond this local structural estimate.
        if (!ts.isBinaryExpression(condition) || ![ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
          ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken].includes(condition.operatorToken.kind)) {
          uncertainty = 'A compound loop bound needs manual iteration-count review.';
        }
        if (ts.isBinaryExpression(condition) && (ts.isCallExpression(condition.left) || ts.isCallExpression(condition.right))) uncertainty = 'A computed loop bound needs manual iteration-count review.';
        if (ts.isBinaryExpression(condition)) {
          const canonical = (operand: TS.Expression): boolean => ts.isIdentifier(operand) || numericLiteral(operand) !== null
            || (ts.isPropertyAccessExpression(operand) && operand.name.text === 'length')
            || (ts.isBinaryExpression(operand) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(operand.operatorToken.kind)
              && canonical(operand.left) && numericLiteral(operand.right) !== null);
          if (!canonical(condition.left) || !canonical(condition.right)) uncertainty = 'A computed loop bound needs manual iteration-count review.';
        }
        if (ts.isForStatement(node) && !node.initializer) uncertainty = 'A persistent induction variable needs an amortized complexity review.';
        if (ts.isForStatement(node) && node.initializer) {
          const starts = ts.isVariableDeclarationList(node.initializer) ? node.initializer.declarations.map(declaration => declaration.initializer)
            : ts.isBinaryExpression(node.initializer) ? [node.initializer.right] : [node.initializer];
          if (starts.some(start => start && inputBound(start))) uncertainty = 'A loop starts from an input-dependent or shared position.';
        }
        const inspectControl = (child: TS.Node) => {
          if (ts.isFunctionDeclaration(child) || ts.isArrowFunction(child) || ts.isFunctionExpression(child)) return;
          if (ts.isBreakStatement(child)) uncertainty = 'Early loop termination needs manual iteration-count review.';
          if (ts.isReturnStatement(child)) loopReturns = true;
          if (ts.isWhileStatement(child) || ts.isDoStatement(child)) uncertainty = 'Nested persistent pointers need an amortized complexity review.';
          ts.forEachChild(child, inspectControl);
        };
        inspectControl(node.statement);
        if (loopInputBound(node, condition)) {
          loop = /\/=\s*2|\*=\s*2|>>=\s*1/.test(increment) ? { power: 0, log: 1 } : linear;
          evidence.add(loop.log ? 'Halving or doubling loop' : 'Input-bounded loop');
        } else if (!(ts.isBinaryExpression(condition) && fixedBound(condition.left) && fixedBound(condition.right))) {
          // Both sides must be fixed. A counter started at a literal is fixed
          // itself, so mentioning one fixed name let i < unknown.length pass as
          // constant work, and a quadratic walk over a destructured input read
          // as O(1).
          uncertainty = 'A loop bound cannot be related to the input size.';
        }
        // Conditions and increment expressions run on every iteration; the
        // initializer runs once. Their scans/calls are part of the algorithm.
        let repeated = max(walk(node.statement), walk(condition));
        if (ts.isForStatement(node) && node.incrementor) repeated = max(repeated, walk(node.incrementor));
        const total = multiply(loop, repeated);
        return ts.isForStatement(node) && node.initializer ? max(total, walk(node.initializer)) : total;
      }
      if (ts.isNewExpression(node)) {
        if (!ts.isIdentifier(node.expression) || !['Map', 'Set', 'Array', 'Date'].includes(node.expression.text)) uncertainty = 'An external constructor needs manual review.';
        const kind = node.arguments?.[0] ? collectionKind(node.arguments[0]) : 'fixed';
        if (kind === 'unknown' && node.expression.getText(file) !== 'Date') uncertainty = 'The constructor input size needs manual review.';
        let cost = kind === 'input' && node.expression.getText(file) !== 'Date' ? linear : constant;
        for (const argument of node.arguments ?? []) cost = max(cost, walk(argument));
        return cost;
      }
      if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
        const kind = collectionKind(node.expression);
        if (kind === 'unknown') uncertainty = 'The copied collection needs manual input-size review.';
        evidence.add('Copying input data'); return max(kind === 'input' ? linear : constant, walk(node.expression));
      }
      if (ts.isCallExpression(node)) {
        let call: Cost = constant;
        if (ts.isIdentifier(node.expression)) {
          const name = node.expression.text;
          const helper = functions.get(name);
          if (helper) {
            if (stack.has(name)) { uncertainty = 'Recursion needs a recurrence and input-size review; it is not inferred automatically.'; return constant; }
            const inputParams = new Set(helper.parameters.flatMap((parameter, i) => ts.isIdentifier(parameter.name) && node.arguments[i] && collectionKind(node.arguments[i]) === 'input' ? [parameter.name.text] : []));
            call = inspectFunction(helper, new Set([...stack, name]), bounds, inputParams);
          } else if (!['Number', 'Boolean', 'parseInt', 'parseFloat', 'isNaN', 'isFinite'].includes(name)) uncertainty = 'An indirect or external function call needs manual review.';
        } else if (ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          if (['some', 'every', 'find', 'findIndex', 'includes', 'indexOf', 'lastIndexOf'].includes(method)) shortCircuitScans = true;
          const receiver = node.expression.expression.getText(file);
          if (receiver === 'console') return constant;
          if (fixedCollections.has(receiver) && ['push', 'unshift', 'splice'].includes(method)) uncertainty = 'A growing local collection needs manual input-size review.';
          if (method === 'test' || method === 'replace' || method === 'replaceAll') {
            const pattern = method === 'test' ? regexes.get(receiver) ?? receiver : node.arguments[0]?.getText(file) ?? '';
            if (pattern.startsWith('/') && !/^\/\[\^?[a-zA-Z0-9\-]+\]\/[gimyus]*$/.test(pattern)) uncertainty = 'Regular-expression backtracking needs a manual worst-case review.';
            if (method === 'test' && !pattern.startsWith('/')) uncertainty = 'The regular expression cannot be resolved statically.';
          } // Scratch-pad logging is not the solution's algorithm.
          const collection = collectionKind(node.expression.expression);
          if (method === 'sort' || method === 'toSorted') {
            if (collection === 'unknown') uncertainty = 'The sorted collection needs manual input-size review.';
            call = collection === 'input' ? { power: 1, log: 1 } : constant; evidence.add('Sorting input data');
          }
          else if (['toLowerCase', 'toUpperCase', 'trim'].includes(method) && ts.isElementAccessExpression(node.expression.expression)) { call = constant; }
          else if (scanMethods.has(method) || (receiver === 'Object' && ['keys', 'values', 'entries'].includes(method)) || method === 'from') {
            const kind = rangeMethods.has(method) ? collectionKind(node)
              : receiver === 'Object' || (receiver === 'Array' && method === 'from') ? node.arguments[0] ? collectionKind(node.arguments[0]) : 'unknown' : collection;
            if (kind === 'unknown') uncertainty = 'A scan cannot be related to the input size.';
            call = kind === 'input' ? linear : constant; evidence.add('Collection/string scan');
          }
          else if (method === 'test' && node.arguments[0] && !ts.isElementAccessExpression(node.arguments[0])) {
            const kind = collectionKind(node.arguments[0]);
            if (kind === 'unknown') uncertainty = 'The tested string size needs manual review.';
            call = kind === 'input' ? linear : constant; evidence.add('String scan');
          }
          else if (!scalarMethods.has(method)) uncertainty = 'A method with unknown cost needs manual review.';
          // Receiver chains run sequentially. Callback work is repeated per item.
          let callback = constant;
          for (const argument of node.arguments) if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && argument.body) callback = max(callback, inspectFunction(argument, stack, bounds, new Set()));
          if (callbackMethods.has(method) && node.arguments[0] && !ts.isArrowFunction(node.arguments[0]) && !ts.isFunctionExpression(node.arguments[0])) {
            uncertainty = 'A named or indirect callback needs manual review of its repeated work.';
          }
          call = multiply(call, callback);
          call = max(call, walk(node.expression.expression));
        } else uncertainty = 'A dynamic call needs manual review.';
        for (const argument of node.arguments) if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) call = max(call, walk(argument));
        return call;
      }
      let cost = constant;
      ts.forEachChild(node, (child) => { cost = max(cost, walk(child)); });
      return cost;
    };
    return fn.body ? walk(fn.body) : constant;
  };
  let cost = constant;
  for (const name of entries) cost = max(cost, inspectFunction(functions.get(name)!, new Set([name])));
  if (budget.left < 0) return unknown(ANALYSIS_LIMIT_MESSAGE);
  if (uncertainty) return unknown(uncertainty);
  const time = label(cost);
  const target = guidance.targetTime ? targetCost(guidance.targetTime) : null;
  const above = target && (cost.power > target.power || (cost.power === target.power && cost.log > target.log));
  if (above && loopReturns) return unknown('Early returns inside a traversal need a manual worst-case review.');
  if (above && shortCircuitScans) return unknown('Early-exit scans need a manual worst-case review before reducing XP.');
  const assessment = target ? above ? 'above-target' : 'within-target' : 'estimated';
  return { time, assessment, explanation: [...evidence].join(' · ') || 'No input-growing traversal recognised in the tested function.', assumptions, guidance };
}

/** Parsing/inspection failures must never replace a grader verdict. Deeply
 * nested adversarial submissions can exhaust a parser's call stack even while
 * remaining under the submission byte limit. */
export function assessComplexity(task: Pick<CodingTask, 'track' | 'prompt' | 'tests'>, code: string): ComplexityReport {
  // Outside the catch: a compiler that cannot load is a broken deployment,
  // which fails as loudly as the import it replaces, never an "unknown".
  if (task.track !== 'react' && task.track !== 'system-design') loadTypeScript();
  try {
    return inspectComplexity(task, code);
  } catch {
    return {
      time: null,
      assessment: 'unknown',
      explanation: 'The structural analyser could not safely inspect this code. Review its complexity manually.',
      assumptions: 'An unavailable estimate never changes the correctness verdict or reduces the base reward.',
      guidance: complexityGuidance(task),
    };
  }
}
