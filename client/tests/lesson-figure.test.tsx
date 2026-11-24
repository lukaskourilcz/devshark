// The authored lesson figures: the stepped trace and its controls.
import { trackAnnouncement } from './announcement';
import { expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { LessonFigureView } from '../src/components/ui/LessonFigure';
import type { LessonFigure } from '../../shared/lesson-figures';

const steps = (frames: Extract<LessonFigure['body'], { kind: 'steps' }>['frames']): LessonFigure => ({
  id: 'test-trace', topic: 'dsa', level: 1, title: 'A test trace',
  alt: 'Three cells, 1, 2 and 3. The first frame marks the first cell, the second frame the second, and the third frame the third.',
  body: { kind: 'steps', frames },
});
const mount = (figure: LessonFigure) => render(<LanguageProvider><LessonFigureView figure={figure} /></LanguageProvider>);

// A trace with no frames read `frame.cells` of undefined, and the error
// replaced the whole lesson.
it('shows a trace with no frames as its words, without throwing', () => {
  mount(steps([]));
  expect(screen.getByText('A test trace')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'This figure in words' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

// Reset always turned itself off, as did Next on the last step and Previous
// on the first, and keyboard focus fell to the page each time.
it('keeps keyboard focus on a stepper control that still does something', () => {
  mount(steps([1, 2, 3].map((n) => ({ cells: ['1', '2', '3'], marks: [{ index: n - 1, role: 'here' }], note: `Frame ${n}.` }))));
  const previous = screen.getByRole('button', { name: 'Previous' });
  const next = screen.getByRole('button', { name: 'Next' });
  const reset = screen.getByRole('button', { name: 'Reset' });
  const verifyAnnouncement = trackAnnouncement('.ss-figure__note');
  next.focus();
  fireEvent.click(next);
  expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  verifyAnnouncement('Frame 2.');
  expect(document.activeElement).toBe(next);
  fireEvent.click(next);
  expect(next).toBeDisabled();
  expect(document.activeElement).toBe(previous);
  fireEvent.click(previous);
  fireEvent.click(previous);
  expect(previous).toBeDisabled();
  expect(document.activeElement).toBe(next);
  fireEvent.click(next);
  reset.focus();
  fireEvent.click(reset);
  expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  expect(document.activeElement).toBe(next);
});
