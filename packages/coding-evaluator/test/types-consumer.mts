// Check the package's public export conditions as seen by TypeScript.
import {
  evaluateCalls, learnerConsoleFactory,
  type ConsoleClock, type ConsoleEmit, type ConsoleFormat, type EvaluateResult, type LearnerConsole,
} from '@lukaskourilcz/coding-evaluator';
import evaluator = require('@lukaskourilcz/coding-evaluator');

const input = { code: 'function answer() { return 42; }', calls: ['answer()'] };
export const esmRun: Promise<EvaluateResult> = evaluateCalls(input);
export const cjsRun: Promise<evaluator.EvaluateResult> = evaluator.evaluateCalls(input);

// Both export conditions expose the console callbacks and result by name.
const consoleInputs: [ConsoleEmit, ConsoleFormat, ConsoleClock] = [() => {}, String, () => 0];
const cjsInputs: [evaluator.ConsoleEmit, evaluator.ConsoleFormat, evaluator.ConsoleClock] = consoleInputs;
export const esmConsole: LearnerConsole = learnerConsoleFactory()(...consoleInputs);
export const cjsConsole: evaluator.LearnerConsole = evaluator.learnerConsoleFactory()(...cjsInputs);
