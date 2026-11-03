import { describe, expect, it } from 'vitest';
import { nextLearnStep } from '../src/components/learn/nextStep';
import { partRanges, type RoadmapProgress } from '../src/lib/roadmap';
import type { StepAvailability } from '../../shared/progression';

const levels = Array.from({ length: 6 }, (_, index) => ({
  level: index + 1, title: `Level ${index + 1}`, difficulty: 1 as const, questionCount: 8,
}));
const passed = (count: number, checkpoints: number[] = []): RoadmapProgress => ({
  html: {
    levels: Object.fromEntries(Array.from({ length: count }, (_, index) => [index + 1, { passed: true, bestPct: 100 }])),
    checkpoints: Object.fromEntries(checkpoints.map((part) => [part, { passed: true, bestPct: 100 }])),
  },
});
const next = (progress: RoadmapProgress, availability: StepAvailability = { levelCount: 6 }, inPlan = true) =>
  nextLearnStep({ topic: 'html', levels, ranges: partRanges(6), progress, availability, inPlan });

describe('the Learn overview’s next step', () => {
  it('starts with the first available level', () => {
    expect(next({})).toEqual({ kind: 'level', ref: 1 });
  });
  it('offers the first part test once that part’s levels are passed', () => {
    expect(next(passed(2))).toEqual({ kind: 'test', ref: 1 });
  });
  it('continues into the next part after its prerequisite test', () => {
    expect(next(passed(2, [1]))).toEqual({ kind: 'level', ref: 3 });
  });
  it('offers the final part test even though every level is passed', () => {
    expect(next(passed(6, [1, 2]))).toEqual({ kind: 'test', ref: 3 });
  });
  it('offers no fictitious next step once the topic is complete', () => {
    expect(next(passed(6, [1, 2, 3]))).toBeNull();
  });
  it('skips an unavailable level without reopening it', () => {
    expect(next({}, { levelCount: 6, unavailableLevels: new Set([1]) })).toEqual({ kind: 'level', ref: 2 });
  });
  it('skips an unavailable test once its available levels are passed', () => {
    expect(next(passed(2), { levelCount: 6, unavailableCheckpoints: new Set([1]) })).toEqual({ kind: 'level', ref: 3 });
  });
  it('never offers a new step in a topic outside the learning plan', () => {
    expect(next(passed(2), { levelCount: 6 }, false)).toBeNull();
  });
});
