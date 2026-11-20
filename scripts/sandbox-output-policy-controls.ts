import assert from 'node:assert/strict';
import { runInSandbox } from '../lib/coding/sandbox';
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS } from '../shared/coding-evaluate';

/** Independent policy boundary: do not import the implementation's budget. */
export async function runSandboxOutputPolicyControls(): Promise<void> {
  const policyChars = 900_000;
  const frameChars = JSON.stringify([['value', ['string', '']]]).length;
  const fitting = policyChars - frameChars;
  for (const extra of [0, 1]) {
    const expected = 'a'.repeat(fitting + extra);
    assert.equal(JSON.stringify([['value', ['string', expected]]]).length, policyChars + extra);
    const run = await runInSandbox({
      code: `const value=()=>"a".repeat(${fitting + extra});`,
      calls: ['value()'], expectations: [expected],
    });
    assert.equal(run.codeError, null);
    assert.equal(run.timedOut, false);
    assert.equal(run.results.length, 1);
    if (extra === 0) {
      assert.equal(run.results[0].pass, true, 'a complete packet exactly at the independently chosen 900000 policy grades');
      assert.equal(run.results[0].error, null);
      assert.equal(run.results[0].actual, '"' + 'a'.repeat(MAX_LOG_LINE_CHARS - 1) + LOG_LINE_CUT);
    } else {
      assert.deepEqual(run.results[0], { pass: false, actual: null, error: 'Result size limit exceeded' }, 'one extra encoded unit fails that call');
    }
  }
  const next = await runInSandbox({ code: 'const value=()=>3;', calls: ['value()'], expectations: [3] });
  assert.deepEqual(next.results, [{ pass: true, actual: '3', error: null }]);
  console.log('PASS sandbox output policy: exact 900000-unit packet, one-unit overflow, full-value grade/display cut and next-run recovery');
}
