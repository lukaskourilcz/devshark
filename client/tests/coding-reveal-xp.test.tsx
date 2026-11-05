// Revealing a solution before passing costs that task its XP and coins. The
// learner is told before (the confirmation) and after (the verdict card), and
// not told once the task is passed, where a reveal costs nothing.
import { beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { revealCoding, submitCoding } from '../src/coding/api';
import type { CodingRevealResponse, CodingTaskProgress, CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  runCodeTests: vi.fn(async () => ({ results: [{ pass: true, actual: '1', error: null }], logs: [], check: null, timedOut: false })),
}));

const task: PlayableCodingTask = {
  id: 'js-test-reveal', track: 'javascript', level: 1, tier: 2, difficulty: 'easy',
  focus: ['functions'], title: 'Test task',
  prompt: 'Return one.',
  starter: 'const one = () => 0;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [{ call: 'one()', expected: 1 }],
};
const progress = (status: CodingTaskProgress['status']): CodingTaskProgress => ({
  status, passes: status === 'passed' ? 1 : 0, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null,
});
// The bodies the API sends: api/quiz/roadmap.ts, resource=coding-submit and coding-reveal.
const verdict = (extra: Partial<CodingVerdictResponse>): CodingVerdictResponse => ({
  verdict: 'passed', results: [{ pass: true, actual: '1', error: null }], hidden: null, check: null, logs: [], codeError: null,
  design: null, designReference: null, failureHint: null, puzzle: null, progress: progress('passed'),
  firstPass: true, xpAwarded: 25, xpForfeited: false, applied: true, github: null, solutions: null, ...extra,
});
const revealed: CodingRevealResponse = { solution: 'const one = () => 1;', reference: null, progress: progress('revealed') };

const XP_WARNING = /will earn no XP or coins when you pass it/;

function mount(props: { signedIn?: boolean; mode?: 'section' | 'lesson'; progress?: CodingTaskProgress | null } = {}) {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <CodingWorkbench
          task={task} session="test-session" locked={null} initialCode={null}
          signedIn={props.signedIn ?? true} mode={props.mode ?? 'section'} progress={props.progress ?? null}
        />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

/** Takes the two rungs the solution waits for, after a minute of editing. */
function climbTheLadder() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 2;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next hint' }));
  clock.mockRestore();
}

async function submitAndWait() {
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  return screen.findByRole('heading', { name: /^Passed/ });
}

// Reveal remains a server-authorized post-submit action.
async function showSolutionAction() {
  if (screen.queryByRole('button', { name: 'Solution' })) return;
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ verdict: 'failed', xpAwarded: 0, firstPass: false, progress: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Solution' });
}

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('warns a signed-in learner before a pass that revealing costs the XP and coins', async () => {
  vi.mocked(revealCoding).mockResolvedValue(revealed);
  mount();
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Solution' });
  expect(dialog).toHaveTextContent('Showing the solution ends this attempt, and this task will earn no XP or coins when you pass it. Show it?');
  expect(revealCoding).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Solution' }));
  expect(await screen.findByText('const one = () => 1;')).toBeVisible();
  expect(revealCoding).toHaveBeenCalledWith({ session: 'test-session', hintsUsed: 2 });
});

it('keeps the level rule and adds the XP rule inside a Learn level', async () => {
  mount({ mode: 'lesson' });
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  expect(screen.getByRole('alertdialog', { name: 'Solution' })).toHaveTextContent(
    'Showing the solution ends this level attempt, and this task will earn no XP or coins when you pass it. You can retry the level later. Show it?',
  );
});

it('shows the solution without a warning once the task is passed', async () => {
  vi.mocked(revealCoding).mockResolvedValue({ ...revealed, progress: progress('passed') });
  mount({ progress: progress('passed') });
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByText(XP_WARNING)).toBeNull();
  expect(await screen.findByText('const one = () => 1;')).toBeVisible();
  expect(revealCoding).toHaveBeenCalledTimes(1);
});

// After a pass the Solution button asks at once and stays until the answer
// arrives; a second press sent a second reveal.
it('sends one reveal for a double press after a pass', async () => {
  vi.mocked(revealCoding).mockReset();
  let answer!: (response: CodingRevealResponse) => void;
  vi.mocked(revealCoding).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
  mount({ progress: progress('passed') });
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  answer({ ...revealed, progress: progress('passed') });
  expect(await screen.findByText('const one = () => 1;')).toBeVisible();
  expect(revealCoding).toHaveBeenCalledTimes(1);
});

it('drops the XP warning after a pass in this session too, and inside a Learn level keeps only the level rule', async () => {
  vi.mocked(submitCoding).mockResolvedValue(verdict({}));
  mount({ mode: 'lesson' });
  climbTheLadder();
  await submitAndWait();
  expect(screen.queryByRole('button', { name: 'Solution' })).toBeNull();
  expect(screen.getByRole('heading', { name: /^Passed/ })).toHaveTextContent('Passed +25 XP');
});

it('does not tell a signed-out visitor about XP a reveal cannot cost them', async () => {
  mount({ signedIn: false });
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  expect(screen.getByRole('alertdialog', { name: 'Solution' })).not.toHaveTextContent(XP_WARNING);
});

it('says a pass after a reveal earned no XP, instead of reading like any other pass', async () => {
  vi.mocked(submitCoding).mockResolvedValue(verdict({ xpAwarded: 0, xpForfeited: true }));
  mount();
  const heading = await submitAndWait();
  expect(heading).toHaveTextContent('no XP because the solution was revealed');
  expect(heading).toHaveTextContent('+0 XP');
  expect(screen.getByRole('button', { name: 'Solution' })).toBeInTheDocument();
});

it('keeps the plain pass and its XP when nothing was revealed', async () => {
  vi.mocked(submitCoding).mockResolvedValue(verdict({}));
  mount();
  const heading = await submitAndWait();
  expect(heading).toHaveTextContent('Passed');
  expect(heading).toHaveTextContent('+25 XP');
  expect(heading).not.toHaveTextContent('no XP');
});

// CODE-13: Submit is off once the solution is showing, but Ctrl or Cmd with
// Shift and Enter still sent the code.
it('does not submit from the keyboard while Submit is off after a reveal', async () => {
  vi.mocked(revealCoding).mockResolvedValue(revealed);
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockResolvedValue(verdict({}));
  mount({ signedIn: false });
  climbTheLadder();
  await showSolutionAction();
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Solution' })).getByRole('button', { name: 'Solution' }));
  expect(await screen.findByText('const one = () => 1;')).toBeVisible();
  vi.mocked(submitCoding).mockClear();
  // Off but focusable, so a press says nothing happened instead of losing focus.
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  fireEvent.keyDown(screen.getByLabelText('Test editor'), { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(screen.getByLabelText('Test editor'), { key: 'Enter', metaKey: true, shiftKey: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(submitCoding).not.toHaveBeenCalled();
});
