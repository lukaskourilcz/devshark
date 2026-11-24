/** Authored task shapes. The English source is the only copy; `mergeTask`
 * normalizes it into the shared `CodingTask` shape the API serves. */

import type {
  CodingTask,
  CodingTier,
  CodingTrack,
  CodingFormat,
  CodingVerify,
  Difficulty,
  DesignDrillFormat,
} from '../../shared/coding-catalog';
import type { FailureCategory } from '../../shared/coding-failure';

export interface SourceCallTest {
  call: string;
  expected: unknown;
  label?: string;
  edge?: boolean;
  async?: boolean;
  /** A short form of `call` for the Results row, when `call` builds its own
   * fixtures or probes inline (`CallTest.shown`). */
  shown?: string;
  /** The critical criterion of the source path activity this check holds,
   * when it is not the default `core` (DSA Foundations, #493). Authoring
   * only: `mergeTask` does not copy it, so it never reaches the browser.
   * `npm run test:coding` requires every wrong answer tagged with a criterion
   * to fail at least one check tagged with that criterion. */
  criterion?: string;
}

export interface SourceTypeTest {
  code: string;
  label?: string;
  rejects?: boolean;
}

interface SourceDesign {
  scenario: string;
  brief: string;
  steps: { key: string; title: string; prompt: string; options: string[]; correct: number; explanation: string }[];
  reference: string;
  passMark: number;
}

interface SourceDrill {
  format: DesignDrillFormat;
  scenario: string;
  prompt: string;
  explanation: string;
  unit?: string;
  answer?: number;
  min?: number;
  max?: number;
  options?: string[];
  correct?: number;
  steps?: string[];
  acceptedOrders?: number[][];
}

export interface CodingTaskSource {
  id: string;
  legacyId?: string;
  track: CodingTrack;
  topic: CodingTask['topic'];
  level: number;
  tier: CodingTier;
  /** Only where the label derived from the tier would mislead; it must fit the tier. */
  difficulty?: Difficulty;
  focus: string[];
  title: string;
  prompt: string;
  starter: string;
  skeleton?: string;
  hints: string[];
  approach?: string[];
  verify: CodingVerify;
  /** What the learner does. Absent means `implement`. */
  format?: CodingFormat;
  /** Authored hints for the way this task is usually got wrong. */
  failureHints?: Partial<Record<FailureCategory, string>>;
  /** The mistake this task is built around, used only when a run proves
   * nothing more specific. */
  pitfall?: FailureCategory;
  tests?: SourceCallTest[];
  typeTests?: SourceTypeTest[];
  suite?: string;
  checklist?: string[];
  api?: { method: string; url: string; note: string };
  design?: SourceDesign;
  drill?: SourceDrill;
  estimatedMinutes: number;
}

/** Reference solution and server-only hidden tests for one task. */
export interface CodingSolution {
  solution: string;
  /** Two more ways to solve the same task, shown side by side only after the
   * server has verified a pass. `junior` is the way someone new to the
   * language would write it: explicit loops, named intermediate values, one
   * step per line. `senior` is the way an experienced engineer would: the
   * idiomatic built-in, the edge case handled where it arises, nothing that
   * does not earn its place. Both pass every visible and hidden test, which
   * the content contract proves, and neither leaves the server before a pass. */
  junior?: string;
  senior?: string;
  /** A learner-required comment preface for both boards. Other authoring
   * commentary is still removed before a board is served. */
  boardPlan?: string;
  hiddenTests?: SourceCallTest[];
  hiddenTypeTests?: SourceTypeTest[];
  /** React only: more Testing Library cases, test blocks with no imports,
   * which the server runs after the visible suite (`./react-hidden`). */
  hiddenSuite?: string;
}

/** Normalize an authored task into the shape the API serves. */
export function mergeTask(source: CodingTaskSource): CodingTask {
  const task: CodingTask = {
    id: source.id,
    ...(source.legacyId ? { legacyId: source.legacyId } : {}),
    track: source.track,
    topic: source.topic,
    level: source.level,
    tier: source.tier,
    ...(source.difficulty ? { difficulty: source.difficulty } : {}),
    focus: source.focus,
    title: source.title,
    prompt: source.prompt,
    starter: source.starter,
    ...(source.skeleton ? { skeleton: source.skeleton } : {}),
    hints: source.hints,
    ...(source.approach ? { approach: source.approach } : {}),
    verify: source.verify,
    ...(source.format ? { format: source.format } : {}),
    ...(source.failureHints ? { failureHints: source.failureHints } : {}),
    ...(source.pitfall ? { pitfall: source.pitfall } : {}),
    estimatedMinutes: source.estimatedMinutes,
  };
  if (source.tests) {
    task.tests = source.tests.map((test) => ({
      call: test.call,
      expected: test.expected,
      ...(test.label ? { label: test.label } : {}),
      ...(test.edge ? { edge: true } : {}),
      ...(test.async ? { async: true } : {}),
      ...(test.shown ? { shown: test.shown } : {}),
    }));
  }
  if (source.typeTests) {
    task.typeTests = source.typeTests.map((test) => ({
      code: test.code,
      ...(test.label ? { label: test.label } : {}),
      ...(test.rejects ? { rejects: true } : {}),
    }));
  }
  if (source.suite) task.suite = source.suite;
  if (source.checklist) task.checklist = source.checklist;
  if (source.api) task.api = { method: source.api.method, url: source.api.url, note: source.api.note };
  if (source.design) {
    task.design = {
      scenario: source.design.scenario,
      brief: source.design.brief,
      reference: source.design.reference,
      passMark: source.design.passMark,
      steps: source.design.steps.map((step) => ({
        key: step.key,
        title: step.title,
        prompt: step.prompt,
        options: [...step.options],
        correct: step.correct,
        explanation: step.explanation,
      })),
    };
  }
  if (source.drill) {
    const d = source.drill;
    task.drill = {
      format: d.format,
      scenario: d.scenario,
      prompt: d.prompt,
      explanation: d.explanation,
      ...(d.unit !== undefined ? { unit: d.unit } : {}),
      ...(d.answer !== undefined ? { answer: d.answer } : {}),
      ...(d.min !== undefined ? { min: d.min } : {}),
      ...(d.max !== undefined ? { max: d.max } : {}),
      ...(d.options ? { options: [...d.options] } : {}),
      ...(d.correct !== undefined ? { correct: d.correct } : {}),
      ...(d.steps ? { steps: [...d.steps] } : {}),
      ...(d.acceptedOrders ? { acceptedOrders: d.acceptedOrders.map((order) => [...order]) } : {}),
    };
  }
  return task;
}
