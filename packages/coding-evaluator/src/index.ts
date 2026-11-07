// Public surface of @lukaskourilcz/coding-evaluator. The sources live in the
// app's shared/ folder and are bundled from there, so the package and devShark
// can never drift apart.
export {
  evaluateCalls,
  allPassed,
  deepEqual,
  displayValue,
  hiddenGlobalMessage,
  RUN_TIMEOUT_MS,
  ASYNC_TIMEOUT_MS,
  TIMEOUT_MESSAGE,
  MAX_LOGS,
  MAX_LOG_LINE_CHARS,
  MAX_LOG_CHARS,
  LOG_LINE_CUT,
  LOG_OUTPUT_CUT,
  PROBE_LINE,
} from '../../../shared/coding-evaluate';
export type { CallOutcome, EvaluateResult } from '../../../shared/coding-evaluate';
export { learnerConsoleFactory, CONSOLE_TABLE_ROWS } from '../../../shared/coding-console';
export type { LearnerConsole, LearnerConsoleFactory, ConsoleEmit, ConsoleFormat, ConsoleClock } from '../../../shared/coding-console';
export {
  classifyFailure,
  failureHint,
  isSyntaxError,
  jsonKind,
  FAILURE_CATEGORIES,
  DEFAULT_FAILURE_HINTS,
} from '../../../shared/coding-failure';
export type { FailureCategory, FailureSignals } from '../../../shared/coding-failure';
export { createMiniJest } from '../../../shared/coding-mini-jest';
export type { MiniJestCase, MiniJestRun } from '../../../shared/coding-mini-jest';
