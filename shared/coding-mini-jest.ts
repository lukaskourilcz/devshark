/** A small jest-shaped test runner for React suites. Used by the node content
 * test (jsdom) and by the browser harness page (a real DOM), so a suite passes
 * or fails the same way in both. Matchers cover what the suites use; an
 * unknown matcher throws, so a gap shows up as a failing case, never as a
 * silent pass. */

export interface MiniJestCase {
  name: string;
  status: 'pass' | 'fail';
  error: string | null;
  durationMs: number;
}

export interface MiniJestRun {
  cases: MiniJestCase[];
  passed: number;
  failed: number;
  total: number;
}

type Body = () => unknown | Promise<unknown>;

const show = (value: unknown): string => {
  if (value && typeof value === 'object' && 'nodeType' in (value as object)) {
    const node = value as { tagName?: string; textContent?: string | null };
    return `<${(node.tagName ?? 'node').toLowerCase()}>${(node.textContent ?? '').slice(0, 60)}`;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const isNode = (value: unknown): value is { textContent: string | null; ownerDocument?: { contains(n: unknown): boolean }; getAttribute?: (n: string) => string | null; isEqualNode?: (other: unknown) => boolean } =>
  Boolean(value && typeof value === 'object' && 'nodeType' in (value as object));

/** The built-in kind of an object. Read from its tag rather than `instanceof`,
 * so a value made in the suite's realm compares the same as one made here. */
const kindOf = (value: object): string => Object.prototype.toString.call(value);

const ownKeys = (value: object, strict: boolean): (string | symbol)[] => {
  const keys: (string | symbol)[] = [
    ...Object.keys(value),
    ...Object.getOwnPropertySymbols(value).filter((symbol) => Object.prototype.propertyIsEnumerable.call(value, symbol)),
  ];
  // toEqual reads a property set to undefined as a property that is not there.
  return strict ? keys : keys.filter((key) => (value as Record<string | symbol, unknown>)[key] !== undefined);
};

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value) as { constructor?: { name?: string } } | null;
  return proto === null || (Object.getPrototypeOf(proto) === null && proto.constructor?.name === 'Object');
};

/**
 * Structural equality with Jest's rules: key order never matters, `NaN`
 * equals `NaN`, `0` and `-0` differ, Dates compare by time, RegExps by source
 * and flags, Maps and Sets by their entries in any order, DOM nodes by
 * `isEqualNode`, and cycles are followed once. `toEqual` ignores properties
 * set to `undefined`, array holes and class identity; `toStrictEqual` does
 * not.
 */
function structurallyEqual(a: unknown, b: unknown, strict: boolean, seen: [object, object][] = []): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  for (const [left, right] of seen) if (left === a || right === b) return left === a && right === b;
  const kind = kindOf(a);
  if (kind !== kindOf(b)) return false;
  if (isNode(a) && isNode(b)) return typeof a.isEqualNode === 'function' && a.isEqualNode(b);
  const pairs: [object, object][] = [...seen, [a, b]];
  const same = (x: unknown, y: unknown) => structurallyEqual(x, y, strict, pairs);
  switch (kind) {
    case '[object Date]':
      return Object.is((a as Date).getTime(), (b as Date).getTime());
    case '[object RegExp]':
      return String(a) === String(b);
    case '[object Number]':
    case '[object String]':
    case '[object Boolean]':
      return Object.is((a as { valueOf(): unknown }).valueOf(), (b as { valueOf(): unknown }).valueOf());
    case '[object Error]':
      return (a as Error).name === (b as Error).name && (a as Error).message === (b as Error).message;
    case '[object Map]': {
      const left = a as Map<unknown, unknown>;
      const right = b as Map<unknown, unknown>;
      if (left.size !== right.size) return false;
      const rightEntries = [...right.entries()];
      return [...left.entries()].every(([key, value]) => (right.has(key)
        ? same(value, right.get(key))
        : rightEntries.some(([otherKey, otherValue]) => same(key, otherKey) && same(value, otherValue))));
    }
    case '[object Set]': {
      const left = a as Set<unknown>;
      const right = b as Set<unknown>;
      if (left.size !== right.size) return false;
      const rightValues = [...right.values()];
      return [...left.values()].every((value) => right.has(value) || rightValues.some((other) => same(value, other)));
    }
  }
  if (strict && !(isPlainObject(a) && isPlainObject(b)) && (a as { constructor?: unknown }).constructor !== (b as { constructor?: unknown }).constructor) return false;
  if (kind === '[object Array]') {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (strict && (index in left) !== (index in right)) return false;
      if (!same(left[index], right[index])) return false;
    }
  }
  const index = (key: string | symbol) => kind === '[object Array]' && typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key);
  const leftKeys = ownKeys(a, strict).filter((key) => !index(key));
  const rightKeys = ownKeys(b, strict).filter((key) => !index(key));
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) &&
      same((a as Record<string | symbol, unknown>)[key], (b as Record<string | symbol, unknown>)[key]));
}

function buildExpect(actual: unknown, negated: boolean): Record<string, unknown> {
  const check = (condition: boolean, message: string) => {
    if (negated === condition) throw new Error(negated ? `not: ${message}` : message);
  };
  const matchers: Record<string, (...args: unknown[]) => void> = {
    toBe: (expected) => check(Object.is(actual, expected), `expected ${show(actual)} to be ${show(expected)}`),
    toEqual: (expected) => check(structurallyEqual(actual, expected, false), `expected ${show(actual)} to equal ${show(expected)}`),
    toStrictEqual: (expected) => check(structurallyEqual(actual, expected, true), `expected ${show(actual)} to strictly equal ${show(expected)}`),
    toBeTruthy: () => check(Boolean(actual), `expected ${show(actual)} to be truthy`),
    toBeFalsy: () => check(!actual, `expected ${show(actual)} to be falsy`),
    toBeNull: () => check(actual === null, `expected ${show(actual)} to be null`),
    toBeUndefined: () => check(actual === undefined, `expected ${show(actual)} to be undefined`),
    toBeDefined: () => check(actual !== undefined, `expected a defined value`),
    toContain: (expected) => check(
      Boolean(actual && typeof (actual as { includes?: unknown }).includes === 'function' && (actual as { includes: (v: unknown) => boolean }).includes(expected)),
      `expected ${show(actual)} to contain ${show(expected)}`,
    ),
    toHaveLength: (expected) => check((actual as { length?: number })?.length === expected, `expected length ${(actual as { length?: number })?.length} to be ${show(expected)}`),
    toHaveTextContent: (expected) => {
      const text = isNode(actual) ? actual.textContent ?? '' : String(actual ?? '');
      const ok = expected instanceof RegExp ? expected.test(text) : text.includes(String(expected));
      check(ok, `expected ${show(text)} to contain ${show(expected)}`);
    },
    toBeGreaterThan: (expected) => check(Number(actual) > Number(expected), `expected ${show(actual)} > ${show(expected)}`),
    toBeGreaterThanOrEqual: (expected) => check(Number(actual) >= Number(expected), `expected ${show(actual)} >= ${show(expected)}`),
    toBeLessThan: (expected) => check(Number(actual) < Number(expected), `expected ${show(actual)} < ${show(expected)}`),
    toBeLessThanOrEqual: (expected) => check(Number(actual) <= Number(expected), `expected ${show(actual)} <= ${show(expected)}`),
    toMatch: (expected) => {
      const text = String(actual);
      check(expected instanceof RegExp ? expected.test(text) : text.includes(String(expected)), `expected ${show(text)} to match ${show(expected)}`);
    },
    toBeInTheDocument: () => check(
      isNode(actual) && Boolean(actual.ownerDocument?.contains(actual)),
      `expected ${show(actual)} to be in the document`,
    ),
    toHaveAttribute: (name, value) => {
      const attr = isNode(actual) && actual.getAttribute ? actual.getAttribute(String(name)) : null;
      check(value === undefined ? attr !== null : attr === String(value), `expected attribute ${show(name)} to be ${show(value ?? 'present')}, was ${show(attr)}`);
    },
    toHaveValue: (expected) => check((actual as { value?: unknown })?.value === expected, `expected value ${show((actual as { value?: unknown })?.value)} to be ${show(expected)}`),
    toBeDisabled: () => check(Boolean((actual as { disabled?: boolean })?.disabled), `expected ${show(actual)} to be disabled`),
    toBeEnabled: () => check(!(actual as { disabled?: boolean })?.disabled, `expected ${show(actual)} to be enabled`),
    toBeChecked: () => check(Boolean((actual as { checked?: boolean })?.checked), `expected ${show(actual)} to be checked`),
    toHaveBeenCalled: () => check(((actual as { calls?: unknown[] })?.calls?.length ?? 0) > 0, 'expected the function to have been called'),
  };
  return new Proxy(matchers, {
    get(target, prop) {
      if (prop === 'not') return buildExpect(actual, !negated);
      if (prop in target) return target[prop as string];
      return () => { throw new Error(`Unsupported matcher: ${String(prop)}`); };
    },
  });
}

/** The first line of what a case threw. Reading it runs the thrown value's
 * own code (a `message` getter, a `toString`), and a value with no way to
 * become a string, such as `Object.create(null)`, makes that throw too. Out
 * of the catch it ended the whole run, and the learner read a runner outage;
 * the case has failed either way. */
const thrownMessage = (caught: unknown): string => {
  try {
    return String((caught as { message?: unknown })?.message ?? caught).split('\n')[0];
  } catch {
    return 'threw a value that cannot be read as a message';
  }
};

export function createMiniJest() {
  const cases: { name: string; body: Body }[] = [];
  const before: Body[] = [];
  const after: Body[] = [];
  let prefix = '';

  const test = (name: string, body: Body) => { cases.push({ name: prefix ? `${prefix} ${name}` : name, body }); };
  const describe = (name: string, body: () => void) => {
    const previous = prefix;
    prefix = prefix ? `${prefix} ${name}` : name;
    try { body(); } finally { prefix = previous; }
  };
  const expect = (actual: unknown) => buildExpect(actual, false);

  /**
   * `follow` says how to wait for what a case body or hook returned. By
   * default the value is awaited, which calls its `then`. The React runner
   * passes one built on the page realm's own `then`, captured before any
   * suite or component code ran: a component that replaced
   * `Promise.prototype.then` in that realm otherwise settled every async case
   * at once, as a pass, whatever the case went on to do.
   */
  const run = async (options: { afterEach?: () => void | Promise<void>; timeoutMs?: number; follow?: (value: unknown) => unknown } = {}): Promise<MiniJestRun> => {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const follow = options.follow ?? ((value: unknown) => value);
    const results: MiniJestCase[] = [];
    for (const one of cases) {
      const started = performance.now();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let error: string | null = null;
      try {
        for (const hook of before) await follow(hook());
        await Promise.race([
          Promise.resolve().then(() => follow(one.body())),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
          }),
        ]);
        for (const hook of after) await follow(hook());
      } catch (caught) {
        error = thrownMessage(caught);
      } finally {
        clearTimeout(deadline);
      }
      try { await options.afterEach?.(); } catch { /* cleanup never fails a case */ }
      results.push({ name: one.name, status: error ? 'fail' : 'pass', error, durationMs: Math.round(performance.now() - started) });
    }
    const passed = results.filter((r) => r.status === 'pass').length;
    return { cases: results, passed, failed: results.length - passed, total: results.length };
  };

  return {
    globals: {
      test, it: test, describe, expect,
      beforeEach: (body: Body) => { before.push(body); },
      afterEach: (body: Body) => { after.push(body); },
    },
    run,
    caseCount: () => cases.length,
  };
}
