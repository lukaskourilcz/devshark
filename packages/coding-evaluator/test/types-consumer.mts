// Check the package's public export conditions as seen by TypeScript.
import { evaluateCalls, type EvaluateResult } from '@lukaskourilcz/coding-evaluator';
import evaluator = require('@lukaskourilcz/coding-evaluator');

const input = { code: 'function answer() { return 42; }', calls: ['answer()'] };
export const esmRun: Promise<EvaluateResult> = evaluateCalls(input);
export const cjsRun: Promise<evaluator.EvaluateResult> = evaluator.evaluateCalls(input);
