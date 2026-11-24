import assert from 'node:assert/strict';
import { createGradingReadiness } from '../lib/grading-readiness';

export async function gradingReadinessContracts() {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    let attempts = 0;
    let settle!: (passed: boolean) => void;
    const check = createGradingReadiness(() => {
      attempts++;
      return new Promise<boolean>((resolve) => { settle = resolve; });
    });

    assert.equal(await check(false), 'unconfigured');
    assert.equal(attempts, 0);
    const concurrent = [check(true), check(true), check(true)];
    assert.equal(attempts, 1);
    settle(true);
    assert.deepEqual(await Promise.all(concurrent), ['ok', 'ok', 'ok']);
    now += 299_999;
    assert.equal(await check(true), 'ok');
    assert.equal(attempts, 1);
    now++;
    const expired = check(true);
    assert.equal(attempts, 2);
    settle(false);
    assert.equal(await expired, 'unavailable');
    assert.equal(await check(true), 'unavailable');
    assert.equal(attempts, 2);
    now += 300_000;
    const abandoned = check(true);
    const settleAbandoned = settle;
    assert.equal(await check(false), 'unconfigured');
    const restored = check(true);
    assert.equal(attempts, 4);
    settle(true);
    assert.equal(await restored, 'ok');
    settleAbandoned(false);
    assert.equal(await abandoned, 'unavailable');
    assert.equal(await check(true), 'ok', 'the old result cannot replace the restored check');
    assert.equal(attempts, 4);
  } finally {
    Date.now = originalNow;
  }

  const broken = createGradingReadiness(async () => { throw new Error('local fixture'); });
  assert.equal(await broken(true), 'unavailable');
  let release!: (passed: boolean) => void;
  const stalled = createGradingReadiness(() => new Promise<boolean>((resolve) => { release = resolve; }));
  assert.equal(await stalled(true), 'unavailable', 'an unsettled check meets the deadline');
  release(true);
  assert.equal(await stalled(true), 'unavailable', 'a late success cannot replace the timeout');
}
