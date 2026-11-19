/** How the short paths' solutions are assembled. */

import type { CodingSolution } from '../types';

/** One path's code on three boards, one entry per level. */
export interface Boards { reference: string[]; junior: string[]; senior: string[] }

/** Hidden checks per level, as `[call, expected]` pairs. */
export type Hidden = [string, unknown][][];

/** A path whose every level adds functions to the same file: each board entry
 * is only that level's new code, so a level's solution is every earlier
 * entry plus its own, and its hidden checks are every earlier level's too. */
export function cumulativeLevels(id: string, boards: Boards, hidden: Hidden): [string, CodingSolution][] {
  return boards.reference.map((_, index) => {
    const level = index + 1;
    return [`${id}-${level}`, {
      solution: boards.reference.slice(0, level).join('\n\n'),
      junior: boards.junior.slice(0, level).join('\n\n'),
      senior: boards.senior.slice(0, level).join('\n\n'),
      hiddenTests: hidden.slice(0, level).flat().map(([call, expected]) => ({ call, expected, edge: true })),
    }];
  });
}

/** A debugging path's starter, cut into its levels: the code under each
 * `// Level N` heading, without the headings, the file comment at the top or
 * the scratch pad at the bottom. */
function starterLevels(starter: string): string[] {
  const [, ...levels] = starter.split(/^\/\/ Level \d+\n/m);
  return levels.map((code) => code.split(/^\/\/ Scratch pad/m)[0].trim());
}

/** A debugging path, whose starter already holds every level's function in
 * a broken form. A level's solution repairs that level and every earlier one
 * and keeps the later ones exactly as the starter has them, so a revealed
 * solution never hands over a later level's answer. Hidden checks add up as
 * in `cumulativeLevels`. */
export function repairLevels(id: string, starter: string, boards: Boards, hidden: Hidden): [string, CodingSolution][] {
  const broken = starterLevels(starter);
  const board = (fixed: string[], level: number) => [...fixed.slice(0, level), ...broken.slice(level)].join('\n\n');
  return boards.reference.map((_, index) => {
    const level = index + 1;
    return [`${id}-${level}`, {
      solution: board(boards.reference, level),
      junior: board(boards.junior, level),
      senior: board(boards.senior, level),
      hiddenTests: hidden.slice(0, level).flat().map(([call, expected]) => ({ call, expected, edge: true })),
    }];
  });
}

/** A path whose every level is a whole module (a React `App`): each board
 * entry is already the complete file for its level. */
export function wholeLevels(id: string, boards: Boards): [string, CodingSolution][] {
  return boards.reference.map((solution, index) => [`${id}-${index + 1}`, {
    solution,
    junior: boards.junior[index],
    senior: boards.senior[index],
  }]);
}
