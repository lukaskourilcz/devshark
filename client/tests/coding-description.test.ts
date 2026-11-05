import { expect, it } from 'vitest';
import { descriptionText, descriptionParagraphs } from '../src/coding/description';
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


it('groups long prose without splitting or changing inline code', () => {
  const text = 'Validate the input before doing any work. Return a fresh record for every successful call. ' + 'Keep every field unchanged and check the complete input before returning a value. '.repeat(4) + 'Use `value.trim().toLowerCase()` for strings.';
  const paragraphs = descriptionParagraphs(text);
  expect(paragraphs.length).toBeGreaterThan(1);
  expect(paragraphs.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  expect(paragraphs.some(p => p.includes('`value.trim().toLowerCase()`'))).toBe(true);
});
