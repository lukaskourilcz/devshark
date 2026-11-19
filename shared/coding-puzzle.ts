/** Code-ordering puzzles: the practice a phone can actually give.
 *
 * Between quizzes on a narrow screen a code editor is the wrong instrument —
 * there is no room, and typing code on glass is a test of patience rather than
 * of understanding. Where a task has an authored puzzle, the learner arranges
 * its lines instead; where it has none, the task waits for a desktop and says
 * so, with the draft kept. Nothing is auto-passed.
 *
 * Two rules hold this honest:
 *
 *   1. **The viewport is presentation, never authorization.** The server does
 *      not read a screen size and does not care what one says: a puzzle
 *      submission is graded the same from any device, and a puzzle can never
 *      stand in for an implementation the task actually requires.
 *   2. **A puzzle proves what it proves.** Arranging authored lines shows the
 *      learner can order the steps; it does not show they could have written
 *      them. Every puzzle declares its competencies, and the evidence it
 *      produces is recorded as ordering evidence, distinct from a code pass. */


/** One draggable, tappable, keyboard-movable line. */
export interface PuzzleLine {
  /** Stable within the puzzle. Submissions are lists of these. */
  id: string;
  /** The line as the learner sees it, indentation included. */
  code: string;
}

/** What a puzzle establishes. Deliberately narrower than "can implement this":
 * ordering shows the shape of a solution is understood, not that the learner
 * could produce the lines unaided. */
const PUZZLE_COMPETENCIES = ['sequence', 'control-flow', 'api-usage', 'edge-handling'] as const;
export type PuzzleCompetency = (typeof PUZZLE_COMPETENCIES)[number];

/** The public view: the lines in the order the server shuffled them, and what
 * a correct arrangement would demonstrate. The accepted orders are not here. */
export interface PuzzleView {
  taskId: string;
  variantId: string;
  lines: PuzzleLine[];
  competencies: PuzzleCompetency[];
  /** The plain-language claim shown beside the result, so nobody mistakes an
   * ordering pass for having written the code. */
  claim: string;
}

export const PUZZLE_MAX_LINES = 14;

/** True when `order` is a permutation of exactly the puzzle's line ids —
 * checked before any comparison, so a submission cannot smuggle in a duplicate
 * or an unknown id. */
export function isCompleteOrder(order: readonly string[], lines: readonly PuzzleLine[]): boolean {
  if (order.length !== lines.length) return false;
  const known = new Set(lines.map((line) => line.id));
  const seen = new Set<string>();
  for (const id of order) {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

/**
 * Whether an arrangement is one the author accepts.
 *
 * More than one order is often right — two independent declarations can swap,
 * and pretending otherwise teaches a rule that is not real — so an author lists
 * every accepted order rather than one canonical answer.
 */
export function isAcceptedOrder(order: readonly string[], accepted: readonly (readonly string[])[]): boolean {
  return accepted.some((candidate) =>
    candidate.length === order.length && candidate.every((id, index) => id === order[index]));
}
