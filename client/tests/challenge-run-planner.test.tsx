import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ChallengeRunPlanner } from '../src/components/coding/ChallengeRunPlanner';
import type { PracticeSession } from '../../shared/coding-api';

// Design audit P1.6: on the Coding home the planner is one row until opened,
// and opening it shows the same form as before.
const practice = vi.hoisted(() => ({ start: null as null | ((input: unknown, callbacks: { onSuccess: (data: unknown) => void; onSettled?: () => void }) => void), pending: false, session: null as PracticeSession | null, advance: vi.fn() }));
const mutate = vi.fn((input: unknown, callbacks: { onSuccess: (data: unknown) => void; onSettled?: () => void }) => practice.start?.(input, callbacks));
vi.mock('../src/coding/practice', () => ({
  usePracticeSession: () => (practice.pending
    ? { data: undefined, isPending: true, isError: false, refetch: () => {} }
    : { data: { session: practice.session }, isPending: false, isError: false, refetch: () => {} }),
  useStartSession: () => ({ mutate, isPending: false }),
  useAdvanceSession: () => ({ mutate: practice.advance, isPending: false }),
}));

beforeEach(() => { mutate.mockClear(); practice.start = null; practice.pending = false; practice.session = null; practice.advance.mockClear(); });

const mount = (collapsible = true, resumeInPrimary = false) => render(
  <MemoryRouter initialEntries={['/coding']}>
    <LanguageProvider>
      <Routes>
        <Route path="/coding" element={<ChallengeRunPlanner signedIn collapsible={collapsible} resumeInPrimary={resumeInPrimary} />} />
        <Route path="/coding/:track/:taskId" element={<h1>Task page</h1>} />
      </Routes>
    </LanguageProvider>
  </MemoryRouter>,
);

// UX audit coding-08: the collapsed planner is a hairline row, not a card,
// that says what a run is and ends in a "Plan a run" button.
it('starts collapsed to one row and opens the form on click', () => {
  const { container } = mount();
  const section = container.querySelector('section')!;
  expect(section).not.toHaveClass('cd-pane');
  expect(screen.getByRole('heading', { level: 2, name: 'Challenge run' })).toBeInTheDocument();
  expect(section).toHaveTextContent('Pick a track and a time, and we line up the tasks.');
  const toggle = screen.getByRole('button', { name: 'Plan a run' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('group', { name: 'Track' })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(toggle).toHaveAccessibleName('Hide the planner');
  expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.querySelector('form')).not.toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('group', { name: 'Track' })).toBeNull();
});

// Audit C3-1: the button was a type="button" with an empty onClick, so a
// press sent nothing and the run never started.
it('Start the run sends the chosen options and opens the first task', async () => {
  practice.start = (_input, { onSuccess }) => onSuccess({
    session: { sessionId: 's1', minutes: 10, topic: 'javascript', queue: ['js-sum-array'], position: 0, order: 'random', status: 'active', scheduledFor: null, estimatedMinutes: 5 },
  });
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: 'JavaScript', pressed: false }));
  fireEvent.click(screen.getByRole('button', { name: '5 challenges' }));
  fireEvent.click(screen.getByRole('radio', { name: /Shuffled/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(mutate.mock.calls[0][0]).toEqual({ count: 5, order: 'random', topic: 'javascript' });
  expect(await screen.findByRole('heading', { level: 1, name: 'Task page' })).toBeInTheDocument();
});

// A second press before the button turned busy started a second run, which
// replaced the first.
it('starts one run for a double press, and can start again once it settled', () => {
  let settle: (() => void) | undefined;
  practice.start = (_input, { onSettled }) => { settle = onSettled; };
  mount(false);
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(mutate).toHaveBeenCalledTimes(1);
  settle?.();
  fireEvent.click(screen.getByRole('button', { name: 'Start' }));
  expect(mutate).toHaveBeenCalledTimes(2);
});

// While the open run was still loading the form offered Start, and a run
// started then replaced the one the learner already had.
it('offers no Start while the open run is loading', () => {
  practice.pending = true;
  mount(false);
  expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
});

// One filled primary per screen: the planner sits on the Coding home, whose
// SwimCta is the next challenge, so its own actions are secondary.
it('draws no SwimCta of its own', () => {
  const { container } = mount(false);
  expect(screen.getByRole('button', { name: 'Start' })).not.toHaveClass('ss-swim-cta');
  expect(container.querySelector('.ss-swim-cta')).toBeNull();
});

it.each(['active', 'scheduled'] as const)('keeps %s run ending and its reassurance in one row, without a confirmation step', status => {
  practice.session = { sessionId: 'run-1', status, queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: status === 'scheduled' ? '2026-12-01T10:00:00Z' : null };
  mount(true, true);
  expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull();
  const end = screen.getByRole('button', { name: status === 'active' ? 'End the run' : 'Cancel the run' });
  expect(end.parentElement).toContainElement(screen.getByText('Completed challenges stay saved.'));
  fireEvent.click(end);
  expect(practice.advance.mock.calls[0][0]).toEqual({ sessionId: 'run-1', status: 'abandoned' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  if (status === 'scheduled') expect(screen.getByRole('button', { name: 'Start now' })).toBeInTheDocument();
});
