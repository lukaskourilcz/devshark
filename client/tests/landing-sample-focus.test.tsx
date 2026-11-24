import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { SampleCard } from '../src/components/landing/LandingKit';
import { LanguageProvider } from '../src/i18n/LanguageContext';

it.each([
  ['Blue', 'Correct.'],
  ['Red', 'Incorrect. The answer is Blue.'],
])('announces and focuses the existing feedback region after choosing %s', (choice, message) => {
  render(<LanguageProvider><SampleCard chip="Practice" question={{
    text: 'Choose blue.', opts: ['Blue', 'Red'], a: 0, e: 'Blue is the first option.',
  }} /></LanguageProvider>);
  const status = screen.getByRole('status');
  expect(status).toBeEmptyDOMElement();
  const button = screen.getByRole('button', { name: new RegExp(choice) });
  button.focus();
  fireEvent.click(button);
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toHaveFocus();
  expect(status).toHaveTextContent(message);
  expect(status).toHaveTextContent('Blue is the first option.');
});
