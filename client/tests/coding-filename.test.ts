import { expect, it } from 'vitest';
import { codingFilename } from '../src/coding/filename';
it('uses camelCase, the stage number, and the correct extension', () => {
  expect(codingFilename({ id: 'js-digit-sum', title: 'Digit sum', track: 'javascript' })).toBe('digitSum.js');
  expect(codingFilename({ id: 'js-fullstack-links-1', title: 'Link shortener · 1', track: 'javascript' })).toBe('linkShortener1.js');
  expect(codingFilename({ id: 'js-fullstack-links-2', title: 'Link shortener · 2', track: 'javascript' })).toBe('linkShortener2.js');
  expect(codingFilename({ id: 'ts-sample', title: 'URL parser', track: 'typescript' })).toBe('urlParser.ts');
});
