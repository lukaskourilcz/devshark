import { expect, it } from 'vitest';
import { descriptionText } from '../src/coding/description';
import { complexityGuidance } from '../../shared/coding-complexity';

it('removes the entire trailing Target line while retaining the task and later paragraphs', () => {
  const prompt = 'Write `digitSum(n)`. Inputs are safe integers. Target: O(log n) time, or O(d) for d digits. Zero takes constant work.\n\nReturn the sum.';
  expect(descriptionText(prompt)).toBe('Write `digitSum(n)`. Inputs are safe integers.\n\nReturn the sum.');
  expect(complexityGuidance({ track: 'javascript', prompt, tests: [{}] }).targetTime).toBe('O(log n)');
});

it('removes separate Target lines, including nested complexity expressions', () => {
  expect(descriptionText('Keep this.\nTarget: O(n log(n)) time.\nKeep this too.')).toBe('Keep this.\n\nKeep this too.');
  expect(descriptionText('Target: O(1) time.')).toBe('');
});

it('leaves prompts without authored Target metadata unchanged', () => {
  expect(descriptionText('Write `target(value)`. Return "Target".')).toBe('Write `target(value)`. Return "Target".');
});
