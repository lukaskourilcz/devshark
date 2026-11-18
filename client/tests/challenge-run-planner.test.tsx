import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ChallengeRunPlanner } from '../src/components/coding/ChallengeRunPlanner';
import { ChallengeRunSection } from '../src/components/coding/ChallengeRunSection';
import type { PracticeSession } from '../../shared/coding-api';
import { clearAccountData } from '../src/lib/accountData';
import { server } from './mocks/server';

// Design audit P1.6: on the Coding home the planner is one row until opened,
// and opening it shows the same form as before.
type Callbacks = { onSuccess: (data: unknown) => void; onError?: (error: unknown) => void; onSettled?: () => void };
const practice = vi.hoisted(() => ({ start: null as null | ((input: unknown, callbacks: Callbacks) => void), pending: false, session: null as PracticeSession | null, advance: vi.fn(), advanceFailed: false }));
const mutate = vi.fn((input: unknown, callbacks: Callbacks) => practice.start?.(input, callbacks));
vi.mock('../src/coding/practice', () => ({
  usePracticeSession: () => (practice.pending
    ? { data: undefined, isPending: true, isError: false, refetch: () => {} }
    : { data: { session: practice.session }, isPending: false, isError: false, refetch: () => {} }),
  useStartSession: () => ({ mutate, isPending: false }),
  useAdvanceSession: () => ({ mutate: practice.advance, isPending: false, isError: practice.advanceFailed }),
}));

beforeEach(() => { mutate.mockClear(); practice.start = null; practice.pending = false; practice.session = null; practice.advance.mockReset(); practice.advanceFailed = false; });

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

it('sends one transition when the run actions are pressed before the request settles', () => {
  practice.session = { sessionId: 'run-1', status: 'scheduled', queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: '2026-12-01T10:00:00Z' };
  let settle: (() => void) | undefined;
  practice.advance.mockImplementation((_input, callbacks) => { settle = callbacks.onSettled; });
  mount();
  const start = screen.getByRole('button', { name: 'Start now' });
  const cancel = screen.getByRole('button', { name: 'Cancel the run' });
  fireEvent.click(start);
  fireEvent.click(start);
  fireEvent.click(cancel);
  expect(practice.advance.mock.calls.map(([input]) => input.status)).toEqual(['active']);
  settle?.();
  fireEvent.click(cancel);
  expect(practice.advance.mock.calls.map(([input]) => input.status)).toEqual(['active', 'abandoned']);
});


// Today's Start for a planned run turned busy only once advance.isPending
// reached React, a task after the press: a double press sent two status
// changes, navigated twice, and could show the refused second one's alert.
it('sends one start from Today for a double press, and can start again once it settled', () => {
  practice.session = { sessionId: 'run-1', status: 'scheduled', queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: '2026-12-01T10:00:00Z' };
  let settle: (() => void) | undefined;
  practice.advance.mockImplementation((_input, callbacks) => { settle = callbacks.onSettled; });
  render(<MemoryRouter><LanguageProvider><ChallengeRunSection /></LanguageProvider></MemoryRouter>);
  const start = screen.getByRole('button', { name: /^Start:/ });
  fireEvent.click(start);
  fireEvent.click(start);
  expect(practice.advance).toHaveBeenCalledTimes(1);
  expect(practice.advance.mock.calls[0][0]).toEqual({ sessionId: 'run-1', status: 'active' });
  act(() => { settle?.(); });
  fireEvent.click(start);
  expect(practice.advance).toHaveBeenCalledTimes(2);
});

it.each([60_000, 60 * 86_400_000])('marks a scheduled run due on both screens after %i ms', (delay) => {
  vi.useFakeTimers();
  try {
    const now = new Date('2026-11-11T10:00:00Z');
    vi.setSystemTime(now);
    practice.session = { sessionId: 'run-1', status: 'scheduled', queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: new Date(now.getTime() + delay).toISOString() };
    mount();
    render(<MemoryRouter><LanguageProvider><ChallengeRunSection /></LanguageProvider></MemoryRouter>);
    expect(screen.queryByText(/Due now/)).toBeNull();
    act(() => { vi.advanceTimersByTime(delay); });
    expect(screen.getByText(/Due now\./)).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: /^Start:/ })).toHaveAttribute('data-start-here');
    expect(practice.advance).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

// Today's section and the Coding home planner stay mounted while the account
// changes, so a start answered after a Log out or another account's sign-in
// must not move the next learner to the previous learner's run, or tell them
// it failed. clearAccountData is what lib/auth.tsx runs on the change.
describe('a run start answered after the account changed', () => {
  const PLANNED: PracticeSession = { sessionId: 'run-1', status: 'scheduled', queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: '2026-12-01T10:00:00Z' };
  const STARTED = { session: { ...PLANNED, status: 'active', scheduledFor: null } };
  const today = () => (
    <MemoryRouter initialEntries={['/today']}>
      <LanguageProvider>
        <Routes>
          <Route path="/today" element={<ChallengeRunSection />} />
          <Route path="/coding/:track/:taskId" element={<h1>Task page</h1>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>
  );
  const holdAdvance = () => {
    const held: { callbacks?: Callbacks } = {};
    practice.advance.mockImplementation((_input, callbacks: Callbacks) => { held.callbacks = callbacks; });
    return held;
  };
  /** The held request's answer, after the account changed. */
  const answerLate = (callbacks: Callbacks | undefined, outcome: 'started' | 'refused') => {
    clearAccountData();
    if (outcome === 'refused') practice.advanceFailed = true;
    act(() => {
      if (outcome === 'started') callbacks?.onSuccess(STARTED);
      else callbacks?.onError?.(new Error('refused'));
      callbacks?.onSettled?.();
    });
  };
  const expectUntouched = () => {
    expect(screen.queryByRole('heading', { name: 'Task page' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  };

  it.each(['started', 'refused'] as const)('leaves the next learner on Today, told nothing, when the planned run is %s late', (outcome) => {
    practice.session = PLANNED;
    const held = holdAdvance();
    const view = render(today());
    fireEvent.click(screen.getByRole('button', { name: /^Start:/ }));
    answerLate(held.callbacks, outcome);
    // The section reads the mutation's error state as it draws.
    view.rerender(today());
    expectUntouched();
  });

  it.each(['started', 'refused'] as const)('leaves the next learner on the Coding home, told nothing, when the planner\'s run is %s late', (outcome) => {
    let held: Callbacks | undefined;
    practice.start = (_input, callbacks) => { held = callbacks; };
    mount(false);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    answerLate(held, outcome);
    expectUntouched();
  });

  it.each(['started', 'refused'] as const)('leaves the next learner on the Coding home, told nothing, when the planned run card\'s start is %s late', (outcome) => {
    practice.session = PLANNED;
    const held = holdAdvance();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    answerLate(held.callbacks, outcome);
    expectUntouched();
  });

  // The account check must not hide a refusal from the learner who pressed.
  it('still tells the same learner on Today and the Coding home when their start is refused', () => {
    practice.session = PLANNED;
    const held = holdAdvance();
    const view = render(today());
    fireEvent.click(screen.getByRole('button', { name: /^Start:/ }));
    act(() => { held.callbacks?.onError?.(new Error('refused')); held.callbacks?.onSettled?.(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start the run');
    view.unmount();
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    act(() => { held.callbacks?.onError?.(new Error('refused')); held.callbacks?.onSettled?.(); });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start the run');
  });
});

// A start, a step or a save still on the wire when the learner logs out, or
// another account signs in, must not write its answer into the next account's
// cache: ['coding', 'session'] and ['coding', 'bookmarks'] carry no account
// id, and emptying the cache does not stop a mutation already sent. These are
// the real hooks, not the mock the screens above use.
describe('a run or saved list answered after the account changed', () => {
  type Practice = typeof import('../src/coding/practice');
  const RUN: PracticeSession = { sessionId: 'run-1', status: 'active', queue: ['js-digit-sum'], position: 0, minutes: 10, topic: null, estimatedMinutes: 5, order: 'sequential', count: 1, scheduledFor: null };
  const cases = [
    { name: 'a started run', hook: (p: Practice) => p.useStartSession(), input: { count: 3, order: 'sequential' }, key: ['coding', 'session'], answer: { session: RUN } },
    { name: 'a started planned run', hook: (p: Practice) => p.useAdvanceSession(), input: { sessionId: 'run-1', status: 'active' }, key: ['coding', 'session'], answer: { session: RUN } },
    { name: 'a saved challenge', hook: (p: Practice) => p.useSaveChallenge(), input: { op: 'save', taskId: 'js-digit-sum', saved: true }, key: ['coding', 'bookmarks'], answer: { saved: ['js-digit-sum'], collections: [] } },
  ] as const;

  it.each(cases)('leaves $name of the previous account out of the next account\'s cache', async ({ hook, input, key, answer }) => {
    const practiceModule = await vi.importActual<Practice>('../src/coding/practice');
    const held: { answer?: () => void } = {};
    server.use(http.all('*/api/user/*', async ({ request }) => {
      if (request.method === 'GET') return HttpResponse.json({ session: null });
      await new Promise<void>((resolve) => { held.answer = resolve; });
      return HttpResponse.json(answer);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => hook(practiceModule), { wrapper });
    act(() => { (result.current.mutate as (value: unknown) => void)(input); });
    await waitFor(() => expect(held.answer).toBeDefined());

    // What lib/auth.tsx does on a Log out or another account's sign-in.
    clearAccountData();
    client.clear();
    await act(async () => { held.answer!(); });
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(client.getQueryData(key)).toBeUndefined();
  });
});
