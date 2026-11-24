// A system-design submission that fails says which answers were wrong and
// nothing of the key: the server sends no correct option and no explanation
// until a pass, and the runner does not invent them. A pass shows the whole
// walkthrough.
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { DesignRunner } from '../src/coding/DesignRunner';
import { submitCoding } from '../src/coding/api';
import { ApiError } from '../src/lib/api';
import type { CodingVerdictResponse, DesignStepVerdict } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';

vi.mock('../src/coding/api', () => ({ submitCoding: vi.fn() }));

const task: PlayableCodingTask = {
  id: 'sd-test-shortener', track: 'system-design', level: 0, tier: 2, difficulty: 'medium',
  focus: ['scoping'], title: 'Test shortener', prompt: 'Design it.', starter: '',
  hints: [], verify: 'guided', estimatedMinutes: 10,
  design: {
    scenario: 'Short links for a newsletter.', brief: 'Keep the read path small.', passMark: 2,
    steps: [
      { key: 'requirements', title: 'What are we building', prompt: 'What matters most?', options: ['Reads dominate', 'Custom aliases'] },
      { key: 'data', title: 'What we store', prompt: 'One row holds?', options: ['Code and destination', 'Only the code'] },
      { key: 'scale', title: 'What breaks first', prompt: 'The first step?', options: ['A cache', 'Sharding'] },
    ],
  },
};
// The body api/quiz/roadmap.ts sends for resource=coding-submit on a design task.
const verdict = (extra: Partial<CodingVerdictResponse>): CodingVerdictResponse => ({
  verdict: 'failed', results: [], hidden: null, check: null, logs: [], codeError: null,
  design: null, designReference: null, failureHint: null, puzzle: null,
  progress: { status: 'in_progress', passes: 0, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null },
  firstPass: false, xpAwarded: 0, xpForfeited: false, applied: true, github: null, solutions: null, ...extra,
});

function mount(onRetry = vi.fn()) {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <DesignRunner task={task} session="design-session" locked={null} signedIn mode="section" onRetry={onRetry} />
      </LanguageProvider>
    </MemoryRouter>,
  );
  return onRetry;
}

/** Answers the three questions: the first option, then the second, then the first. */
async function answerAndSubmit() {
  fireEvent.click(screen.getByRole('radio', { name: 'Reads dominate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Only the code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'A cache' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  // The verdict's heading; each question has one of its own until then.
  return screen.findByRole('heading', { level: 3, name: /^(Passed|Failed)/ });
}

it('after a failed submit shows which answers were wrong and the learner\'s own answers, and offers another try', async () => {
  const failed: DesignStepVerdict[] = [{ correct: true, given: 0 }, { correct: false, given: 1 }, { correct: false, given: 0 }];
  vi.mocked(submitCoding).mockResolvedValue(verdict({ design: failed }));
  const onRetry = mount();
  expect(await answerAndSubmit()).toHaveTextContent('Failed');
  expect(submitCoding).toHaveBeenCalledWith({ session: 'design-session', answers: [0, 1, 0] });
  expect(screen.getByText('1 of 3 correct · Pass mark: 2 of 3')).toBeVisible();
  expect(screen.getByText('The correct answers and explanations appear once you pass. Try again: the options come back in a new order.')).toBeVisible();
  const steps = document.querySelectorAll('.cd-review__step');
  expect(steps).toHaveLength(3);
  expect(steps[0]).toHaveTextContent('Correct');
  expect(steps[0]).toHaveTextContent('Your answer: Reads dominate');
  expect(steps[1]).toHaveTextContent('Not this one');
  expect(steps[1]).toHaveTextContent('Your answer: Only the code');
  expect(steps[2]).toHaveTextContent('Your answer: A cache');
  // Nothing names the right option for a wrong step, and no reference opens.
  expect(screen.queryByText('Code and destination')).toBeNull();
  expect(screen.queryByText('Sharding')).toBeNull();
  expect(screen.queryByText('How the whole answer sounds')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('after a pass shows the whole walkthrough: the right options, the explanations and the reference', async () => {
  const passed: DesignStepVerdict[] = [
    { correct: true, given: 0, correctIndex: 0, explanation: 'Redirects outnumber creations.' },
    { correct: false, given: 1, correctIndex: 0, explanation: 'The redirect needs the destination.' },
    { correct: true, given: 0, correctIndex: 0, explanation: 'A cache absorbs a hotspot.' },
  ];
  vi.mocked(submitCoding).mockResolvedValue(verdict({
    verdict: 'passed', design: passed, designReference: 'Two operations, one table.', firstPass: true, xpAwarded: 35,
    progress: { status: 'passed', passes: 1, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: '2026-09-29T09:00:00Z' },
  }));
  mount();
  const heading = await answerAndSubmit();
  expect(heading).toHaveTextContent('Passed');
  expect(heading).toHaveTextContent('+35 XP');
  expect(screen.queryByText(/appear once you pass/)).toBeNull();
  const steps = document.querySelectorAll('.cd-review__step');
  expect(steps[1]).toHaveTextContent('Correct: Code and destination');
  expect(steps[1]).toHaveTextContent('Only the code');
  expect(screen.getByText('The redirect needs the destination.')).toBeInTheDocument();
  expect(screen.getByText('How the whole answer sounds')).toBeInTheDocument();
  expect(screen.getByText('Two operations, one table.')).toBeInTheDocument();
});

it('after a missed estimate shows the learner\'s figure and no accepted range', async () => {
  const drill: PlayableCodingTask = {
    ...task, id: 'dd-test-estimate', verify: 'drill', design: undefined,
    drill: { format: 'estimate', scenario: 'A launch day.', prompt: 'Requests per second at the peak?', unit: 'requests per second' },
  };
  vi.mocked(submitCoding).mockResolvedValue(verdict({ design: [{ correct: false, given: 90000 }] }));
  render(<MemoryRouter><LanguageProvider><DesignRunner task={drill} session="drill-session" locked={null} signedIn mode="section" onRetry={vi.fn()} /></LanguageProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Your estimate'), { target: { value: '90000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Failed' })).toBeVisible();
  expect(submitCoding).toHaveBeenCalledWith({ session: 'drill-session', answers: [90000] });
  expect(document.querySelector('.cd-review__step')).toHaveTextContent('Your answer: 90,000 requests per second');
  expect(screen.queryByText(/counts; the worked figure/)).toBeNull();
});

it('says a pass after a revealed solution earned no XP', async () => {
  vi.mocked(submitCoding).mockResolvedValue(verdict({
    verdict: 'passed', firstPass: true, xpAwarded: 0, xpForfeited: true,
    design: [0, 1, 2].map((index) => ({ correct: true, given: 0, correctIndex: 0, explanation: `Because ${index}.` })),
  }));
  mount();
  const heading = await answerAndSubmit();
  expect(heading).toHaveTextContent('Passed — no XP because the solution was revealed');
  expect(heading).not.toHaveTextContent('+');
});

// TEST-1: the server claims a design session before it grades and records.
// When that first check failed after the claim (a 500, or an answer lost on
// the way), every retry of the session met 409 design_session_used, and the
// runner kept saying "check your connection" with Submit still on.
it('says a used walkthrough must be opened again, offers Try again, and stops resending it', async () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding)
    .mockRejectedValueOnce(new ApiError('Could not record the verdict', 500, 'db_error'))
    .mockRejectedValue(new ApiError('This walkthrough was already checked. Open it again for a new attempt.', 409, 'design_session_used'));
  const onRetry = mount();
  fireEvent.click(screen.getByRole('radio', { name: 'Reads dominate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Only the code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'A cache' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Server error. Try again in a moment.');
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This walkthrough was already checked. Open it again for a new attempt.'));
  expect(screen.getByRole('button', { name: 'Submit answers' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  expect(submitCoding).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

// Try again opens a new session with the options in a new order. The runner
// kept the last attempt's verdict and answers, so the new session showed the
// old verdict, and a resubmit would have sent indexes that now name other
// options.
it('starts a new attempt clean when the session changes', async () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockResolvedValue(verdict({ design: [{ correct: true, given: 0 }, { correct: false, given: 1 }, { correct: false, given: 0 }] }));
  const view = (session: string) => (
    <MemoryRouter><LanguageProvider>
      <DesignRunner task={task} session={session} locked={null} signedIn mode="section" onRetry={vi.fn()} />
    </LanguageProvider></MemoryRouter>
  );
  const { rerender } = render(view('first-session'));
  expect(await answerAndSubmit()).toHaveTextContent('Failed');
  rerender(view('second-session'));
  expect(screen.queryByRole('heading', { level: 3, name: /^Failed/ })).toBeNull();
  expect(screen.getByRole('heading', { level: 3, name: 'What are we building' })).toBeVisible();
  expect(screen.getByRole('radio', { name: 'Reads dominate' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Next question' })).toBeDisabled();
});

// A verdict for an attempt the learner had already left still reached
// onVerdict, which records it against whatever was opened since.
it('reports no verdict for an attempt that was left before it arrived', async () => {
  vi.mocked(submitCoding).mockReset();
  let answer: (value: CodingVerdictResponse) => void = () => {};
  vi.mocked(submitCoding).mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const onVerdict = vi.fn();
  const view = (session: string) => (
    <MemoryRouter><LanguageProvider>
      <DesignRunner task={task} session={session} locked={null} signedIn mode="section" onVerdict={onVerdict} />
    </LanguageProvider></MemoryRouter>
  );
  const { rerender } = render(view('left-session'));
  fireEvent.click(screen.getByRole('radio', { name: 'Reads dominate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Only the code' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  fireEvent.click(screen.getByRole('radio', { name: 'A cache' }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }));
  expect(submitCoding).toHaveBeenCalledWith({ session: 'left-session', answers: [0, 1, 0] });
  rerender(view('new-session'));
  await act(async () => { answer(verdict({ verdict: 'passed', design: [] })); });
  expect(onVerdict).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { level: 3, name: /^Passed/ })).toBeNull();
});

// Each question is a keyed block, so the Next and Previous buttons were
// replaced as they were pressed and keyboard focus fell to the page.
it('moves focus to the question that opens on Next and Previous', () => {
  mount();
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(screen.getByRole('radio', { name: 'Reads dominate' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'What we store' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous question' }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: 'What are we building' }));
});

// The verdict replaced the questions and the Submit button with them, and
// keyboard focus fell to the page.
it('moves focus to the verdict when it arrives', async () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockResolvedValue(verdict({ design: [{ correct: true, given: 0 }, { correct: false, given: 1 }, { correct: false, given: 0 }] }));
  mount();
  const liveRegion = () => document.querySelector('.cd-pane__head [role="status"]');
  const announcement = liveRegion();
  expect(announcement).toBeEmptyDOMElement();
  const heading = await answerAndSubmit();
  expect(liveRegion()).toBe(announcement);
  expect(announcement).toHaveTextContent('Failed');
  expect(document.activeElement).toBe(heading.closest('.cd-verdict'));
});

// A sequence step moved down is re-inserted, which drops focus, and one moved
// to either end turned its own button off: focus fell to the page.
it('keeps focus with a sequence step as it moves', () => {
  const drill: PlayableCodingTask = {
    ...task, id: 'dd-test-sequence', verify: 'drill', design: undefined,
    drill: { format: 'sequence', scenario: 'A deploy.', prompt: 'In what order?', steps: ['Build', 'Test', 'Ship'] },
  };
  render(<MemoryRouter><LanguageProvider><DesignRunner task={drill} session="drill-session" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
  const down = screen.getByRole('button', { name: 'Move down: Build' });
  const liveRegion = () => document.querySelector('.cd-pane__head [role="status"]');
  const announcement = liveRegion();
  expect(announcement).toBeEmptyDOMElement();
  down.focus();
  fireEvent.click(down);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move down: Build' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move down: Build' }));
  expect(screen.getByRole('button', { name: 'Move down: Build' })).toBeDisabled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move up: Build' }));
  expect(liveRegion()).toBe(announcement);
  expect(announcement).toHaveTextContent('Build moved to position 3 of 3');
});

// UX audit coding-10: signed out, the walkthrough opens with no sign-in note;
// a pass says it was not recorded and offers Sign in, the moment it matters.
it('tells a signed-out visitor at the pass, with Sign in, that it needs an account', async () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockResolvedValue(verdict({
    verdict: 'passed', design: [{ correct: true, given: 0 }, { correct: true, given: 0 }, { correct: true, given: 0 }], firstPass: false, xpAwarded: 0, progress: null,
  }));
  render(<MemoryRouter><LanguageProvider><DesignRunner task={task} session="design-session" locked={null} signedIn={false} mode="section" onRetry={vi.fn()} /></LanguageProvider></MemoryRouter>);
  expect(screen.queryByText(/Sign in to keep your progress/)).toBeNull();
  await answerAndSubmit();
  const line = screen.getByText(/^Sign in to record this pass\./);
  expect(within(line).getByRole('button', { name: 'Sign in' })).toHaveAttribute('aria-haspopup', 'dialog');
});
