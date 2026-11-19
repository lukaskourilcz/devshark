/** Authored efficiency targets and conservative server estimates. Correctness
 * is graded separately; only a supported above-target estimate reduces XP. */
export interface ComplexityGuidance {
  targetTime: string | null;
  targetSpace: string | null;
  note: string;
}

export interface ComplexityReport {
  time: string | null;
  assessment: 'within-target' | 'above-target' | 'estimated' | 'unknown';
  explanation: string;
  assumptions: string;
  guidance: ComplexityGuidance;
}

const CODING_PASS_XP = 25;
const CODING_ABOVE_TARGET_XP = 15;

export function codingPassXp(report: ComplexityReport | null | undefined): number {
  return report?.time && report.guidance.targetTime && report.assessment === 'above-target'
    ? CODING_ABOVE_TARGET_XP : CODING_PASS_XP;
}

/** Only explicitly authored targets are presented as targets. */
export function complexityGuidance(task: { track: string; prompt: string; tests?: unknown[] }): ComplexityGuidance {
  const text = task.prompt;
  const authored = task.tests?.length && task.track !== 'react' && task.track !== 'system-design'
    ? /Target:\s*O\(/i.exec(text) : null;
  let target: string | null = null;
  let remainder = '';
  if (authored) {
    const start = authored.index + authored[0].length - 2;
    let depth = 0;
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '(') depth++;
      if (text[i] === ')' && --depth === 0) {
        remainder = text.slice(i + 1);
        // A standalone target, measured calls/checks, and a time target all
        // describe runtime work. Space-only guidance must not become time.
        if (/^\s*(?:time\b|calls\b|checks\b|[.,;]|$)/i.test(remainder)) target = text.slice(start, i + 1);
        break;
      }
    }
  }
  const space = target ? remainder.match(/(O\([^)]+\))\s*(?:extra\s+)?space/i) : null;
  return {
    targetTime: target,
    targetSpace: space?.[1] ?? null,
    note: task.track === 'react'
      ? 'Consider the data processed on each render, repeated work and extra allocations. UI and asynchronous behaviour need a manual complexity review.'
      : !task.tests?.length
        ? 'Big O describes runtime growth. Type-only and design tasks need a manual review; compiler work is not the runtime complexity of your solution.'
        : 'Input size is the amount of data or work requested: array items, string characters, list nodes, or a numeric bound stated in the task. Variables such as n, m or L refer to the sizes described in the brief. Submit to see a code-structure estimate; correctness is checked separately.',
  };
}
