// Runs against the built bundle (npm run build first), the way a consumer would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as esm from '@lukaskourilcz/coding-evaluator';

const cjs = createRequire(import.meta.url)('@lukaskourilcz/coding-evaluator');

for (const [label, lib] of [['esm', esm], ['cjs', cjs]]) {
  test(`${label}: grades passing and failing calls`, async () => {
    const run = await lib.evaluateCalls({
      code: 'function add(a, b) { return a + b; }',
      calls: ['add(1, 2)', 'add(2, 2)'],
      expectations: [3, 5],
    });
    assert.equal(run.codeError, null);
    assert.deepEqual(run.results.map((r) => r.pass), [true, false]);
    assert.equal(run.results[1].actual, '4');
    assert.equal(lib.allPassed(run), false);
  });

  test(`${label}: awaits promises and captures console output`, async () => {
    const run = await lib.evaluateCalls({
      code: 'async function later(x) { console.log("got", x); return [x, x]; }',
      calls: ['later(2)'],
      expectations: [[2, 2]],
    });
    assert.equal(lib.allPassed(run), true);
    assert.deepEqual(run.logs, ['got 2']);
  });

  test(`${label}: reports syntax errors without running`, async () => {
    const run = await lib.evaluateCalls({ code: 'function (', calls: ['1'], expectations: [1] });
    assert.ok(lib.isSyntaxError(run.codeError));
    assert.deepEqual(run.results, []);
  });

  test(`${label}: deepEqual treats NaN as NaN and 0 as -0`, () => {
    assert.ok(lib.deepEqual({ a: [NaN, 0] }, { a: [NaN, -0] }));
    assert.ok(!lib.deepEqual({ a: 1 }, { a: 1, b: undefined }));
    assert.equal(lib.displayValue(-0), '-0');
  });

  test(`${label}: classifies failures into the fixed vocabulary`, () => {
    assert.equal(lib.classifyFailure({ results: [{ pass: false, actual: 'undefined' }] }), 'missing-return');
    assert.equal(lib.classifyFailure({ timedOut: true }), 'timeout');
    assert.equal(lib.failureHint('timeout', undefined)?.category, 'timeout');
    assert.equal(lib.failureHint('tests', undefined), null);
  });

  test(`${label}: mini-jest runs describe/test blocks`, async () => {
    const jest = lib.createMiniJest();
    const { describe, test: it, expect } = jest.globals;
    describe('math', () => {
      it('adds', () => expect(1 + 1).toBe(2));
      it('fails', () => expect(1).toBe(2));
    });
    const result = await jest.run();
    assert.equal(result.total, 2);
    assert.equal(result.passed, 1);
    assert.equal(result.cases[0].name, 'math adds');
  });
}
