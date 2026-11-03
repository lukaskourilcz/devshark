import type { RoadmapLevelMeta, RoadmapTopic } from '../../types/quiz';
import {
  isLevelPassed,
  isPartLevelUnlocked,
  isPartTestPassed,
  isPartTestUnlocked,
  type PartRange,
  type RoadmapProgress,
} from '../../lib/roadmap';
import type { StepAvailability } from '../../../../shared/progression';

export type LearnStep = { kind: 'level' | 'test'; ref: number };

/** The overview follows the same level → part test order as the map.
 * Access remains the server's decision; this only picks an existing open step. */
export function nextLearnStep({ topic, levels, ranges, progress, availability, inPlan }: {
  topic: RoadmapTopic;
  levels: readonly RoadmapLevelMeta[];
  ranges: readonly PartRange[];
  progress: RoadmapProgress;
  availability: StepAvailability;
  inPlan: boolean;
}): LearnStep | null {
  if (!inPlan) return null;
  for (const range of ranges) {
    const level = levels.find((meta) => meta.level >= range.startLevel && meta.level <= range.endLevel
      && !isLevelPassed(progress, topic, meta.level)
      && isPartLevelUnlocked(progress, topic, range, meta.level, availability));
    if (level) return { kind: 'level', ref: level.level };
    if (!isPartTestPassed(progress, topic, range.part)
      && isPartTestUnlocked(progress, topic, range, availability)) {
      return { kind: 'test', ref: range.part };
    }
  }
  return null;
}
