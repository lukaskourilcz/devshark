// The real worker handler/evaluator, with only realm hardening and compiler loading stood in.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOG_LINE_CUT, MAX_LOG_LINE_CHARS } from '../../shared/coding-evaluate';
import { jsonKind } from '../../shared/coding-failure';
import type { RunnerRequest } from '../src/coding/runner/worker';
import type { TypeCheckResult } from '../../shared/coding-ts-check';

const doubles = vi.hoisted(() => ({ compile: vi.fn(), realm: vi.fn() }));
vi.mock('../src/coding/runner/ts-compiler', () => ({ compileTypeScript: doubles.compile }));
vi.mock('../../shared/coding-run-realm', () => ({ prepareRunRealm: doubles.realm }));
const check: TypeCheckResult = { codeErrors: [], typeTests: [] };
beforeEach(() => { vi.resetModules(); doubles.compile.mockReset(); doubles.realm.mockReset(); doubles.realm.mockReturnValue(new Set()); doubles.compile.mockImplementation((code: string) => ({ check, js: code, transpileError: null })); });
afterEach(() => { vi.unstubAllGlobals(); });

async function worker(request: Partial<RunnerRequest>) {
  vi.resetModules();
  const posted: Record<string, unknown>[] = [];
  const realm = { postMessage: (message: Record<string, unknown>) => { posted.push(message); }, onmessage: null as null | ((event: MessageEvent<RunnerRequest>) => Promise<void>) };
  vi.stubGlobal('self', realm);
  await import('../src/coding/runner/worker');
  await realm.onmessage!({ data: { track: 'javascript', code: '', calls: [], expectations: null, ...request } } as MessageEvent<RunnerRequest>);
  return { posted, done: posted[posted.length - 1]! };
}

for (const track of ['javascript', 'typescript'] as const) {
  it(`${track}: cuts only displayed actuals after full equality, retaining first-character hints`, async () => {
    const value = 'x'.repeat(6000), wrong = 'x'.repeat(5999) + 'y';
    const { done } = await worker({ track, code: 'const text = () => "x".repeat(6000); const list = () => [text()]; const record = () => ({ text: text() });', calls: ['text()', 'text()', 'list()', 'record()'], expectations: [value, wrong, [value], { text: value }] });
    const results = done.results as { pass: boolean | null; actual: string; error: string | null }[];
    expect(results.map(result => result.pass)).toEqual([true, false, true, true]);
    expect(results.every(result => result.actual.length <= MAX_LOG_LINE_CHARS + LOG_LINE_CUT.length && result.actual.endsWith(LOG_LINE_CUT))).toBe(true);
    expect(results.map(result => jsonKind(result.actual))).toEqual(['string', 'string', 'array', 'object']);
    expect(results.every(result => result.error === null)).toBe(true); expect(done.codeError).toBeNull(); expect(done.check).toEqual(track === 'typescript' ? check : null);
  });
  it(`${track}: keeps an ungraded null verdict and a whole surrogate at the cut edge`, async () => {
    const code = 'const text = () => "x".repeat(1998) + "\\ud83e\\udd88" + "tail";';
    const { done } = await worker({ track, code, calls: ['text()'], expectations: null });
    expect(done.results).toEqual([{ pass: null, actual: '"' + 'x'.repeat(1998) + LOG_LINE_CUT, error: null }]);
  });
  it(`${track}: cuts evaluated call and top-level errors before posting`, async () => {
    const call = await worker({ track, code: 'const fail = () => { throw "q".repeat(6000); };', calls: ['fail()'], expectations: [null] });
    expect(call.done.results).toEqual([{ pass: false, actual: null, error: 'q'.repeat(2000) + LOG_LINE_CUT }]);
    const top = await worker({ track, code: 'throw "r".repeat(1999) + "\\ud83e\\udd88" + "tail";', calls: ['1'] });
    expect(top.done.results).toEqual([]); expect(top.done.codeError).toBe('r'.repeat(1999) + LOG_LINE_CUT);
  });
}

it('cuts the actual worker outer-catch error without changing its phase/result shape', async () => {
  doubles.realm.mockImplementation(() => { throw new Error('z'.repeat(6000)); });
  const { done } = await worker({ code: '1', calls: ['1'] });
  expect(done).toEqual({ phase: 'done', results: [], logs: [], codeError: 'z'.repeat(2000) + LOG_LINE_CUT, check: null });
});
it('cuts raw TypeScript transpile errors once and preserves a pre-cut surrogate boundary byte-for-byte', async () => {
  for (const [transpileError, expected] of [['e'.repeat(6000), 'e'.repeat(2000) + LOG_LINE_CUT], ['e'.repeat(1999) + LOG_LINE_CUT, 'e'.repeat(1999) + LOG_LINE_CUT]]) {
    doubles.compile.mockReturnValue({ check, js: null, transpileError });
    const { done } = await worker({ track: 'typescript', code: 'invented compiler fixture', calls: ['1'] });
    expect(done).toEqual({ phase: 'done', results: [], logs: [], codeError: expected, check });
  }
});
it('does not cut compileOnly JavaScript or type-check verdicts', async () => {
  const js = 'const text = "' + 'x'.repeat(6000) + '";'; doubles.compile.mockReturnValue({ check, js, transpileError: null });
  const { done } = await worker({ track: 'typescript', code: 'fixture', compileOnly: true });
  expect(done).toEqual({ phase: 'compiled', js, check }); expect(doubles.realm).not.toHaveBeenCalled();
});
