import { describe, expect, it } from 'vitest';
import { createPreviewLoopCheck, guardPreviewLoops } from '../sandbox/loop-budget';

const evaluate = (source: string, check: () => void) => {
  const program = guardPreviewLoops(source);
  return new Function(program.parameter, program.code)(check);
};

describe('learner-authored loops in the local React frame', () => {
  it('checks every iteration and preserves labels, nested unbraced statements and comments', () => {
    let visits = 0;
    const result = evaluate(`
      let sum = 0, count = 0;
      outer: for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) if (j === 1) continue outer; else sum += i;
      while (count < 2) /* ordinary comment */ count++;
      do count--; while (count > 0);
      for (const n of [2, 3]) sum += n;
      for (const k in {a: 4}) {sum += k.length;}
      for (let n = 0; n < 2; n++);
      return [sum, count, 'while (inside a string)'];
    `, () => { visits++; });
    expect(result).toEqual([9, 0, 'while (inside a string)']);
    expect(visits).toBe(18);
  });

  it('keeps a learner identifier separate from the injected parameter', () => {
    let checks = 0;
    const result = evaluate(String.raw`let __devSharkCheckL\u006fop = 0; for (const n of [1,2]) __devSharkCheckLoop += n; return __devSharkCheckLoop;`, () => { checks++; });
    expect([result, checks]).toEqual([3, 2]);
  });

  it('uses elapsed time, reports once, and a fresh run can finish normally', () => {
    let time = 100;
    const errors: Error[] = [];
    const check = createPreviewLoopCheck(error => errors.push(error), () => time);
    check();
    time += 1_999;
    check();
    time++;
    expect(check).toThrow(/two seconds/);
    expect(check).toThrow(/two seconds/);
    expect(errors.map(error => error.name)).toEqual(['PreviewLoopTimeoutError']);
    const next = createPreviewLoopCheck(error => errors.push(error), () => time);
    expect(evaluate('let n=0; while(n<3) n++; return n;', next)).toBe(3);
    expect(errors).toHaveLength(1);
  });

  it('renews the budget after the frame has yielded to a subsequent task', async () => {
    let time = 0;
    const check = createPreviewLoopCheck(error => { throw error; }, () => time);
    check();
    await new Promise(resolve => setTimeout(resolve, 0));
    time += 15_000;
    expect(check).not.toThrow();
  });
});
