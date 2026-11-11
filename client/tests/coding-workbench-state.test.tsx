// What the workbench says after Run and Submit, checked against the coding
// audit of 8 October 2026 (C3, C4, C5). Each case names its finding.
import { readFileSync } from 'node:fs';
import { beforeAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench, type CodingWorkbenchProps } from '../src/coding/CodingWorkbench';
import { revealCoding, submitCoding, useCodingApproaches } from '../src/coding/api';
import { runCodeTests, type RunOutcome } from '../src/coding/runner/run-tests';
import { skipTask } from '../src/coding/practice';
import { openSignIn } from '../src/lib/signInDialog';
import { ApiError } from '../src/lib/api';
import { evaluateCalls, TYPE_CHECK_STOPPED_MESSAGE } from '../../shared/coding-evaluate';
import type { CodingTaskProgress, CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { declared } from './css';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: vi.fn(() => ({ data: undefined })), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/practice', () => ({ skipTask: vi.fn() }));
vi.mock('../src/lib/signInDialog', () => ({ openSignIn: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  runCodeTests: vi.fn(),
}));

const task: PlayableCodingTask = {
  id: 'js-test-state', track: 'javascript', level: 1, tier: 1, difficulty: 'easy',
  focus: ['map'], title: 'Test task',
  prompt: 'Double the numbers.',
  starter: 'const double = (list) => list;\n', hints: ['Use map.'],
  verify: 'tests', estimatedMinutes: 5,
  tests: [{ call: 'double([1])', expected: [2] }, { call: 'double([])', expected: [] }],
};
const progress = (status: CodingTaskProgress['status']): CodingTaskProgress => ({
  status, passes: status === 'passed' ? 1 : 0, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null,
});
const verdict = (extra: Partial<CodingVerdictResponse>): CodingVerdictResponse => ({
  verdict: 'passed', results: [{ pass: true, actual: '[2]', error: null }, { pass: true, actual: '[]', error: null }],
  hidden: null, check: null, logs: [], codeError: null, design: null, designReference: null, failureHint: null, puzzle: null,
  progress: progress('passed'), firstPass: true, xpAwarded: 25, xpForfeited: false, applied: true, github: null, solutions: null, ...extra,
});
const outcome = (extra: Partial<RunOutcome>): RunOutcome => ({ results: [], logs: [], codeError: null, check: null, timedOut: false, ...extra });

const status = () => document.querySelector('.cd-workbench > [role="status"]')!;
const editor = () => screen.getByLabelText('Test editor');

function mount(props: { signedIn?: boolean; subject?: PlayableCodingTask; mode?: 'section' | 'landing'; onRefreshTask?: (code: string) => Promise<void>; onVerdict?: CodingWorkbenchProps['onVerdict'] } = {}) {
  return render(
    <MemoryRouter initialEntries={['/coding/javascript/js-test-state']}>
      <LanguageProvider>
        <Routes>
          <Route path="/coding/javascript/js-test-state" element={(
            <CodingWorkbench task={props.subject ?? task} session="test-session" locked={null} initialCode={null} signedIn={props.signedIn ?? true} mode={props.mode ?? 'section'} onRefreshTask={props.onRefreshTask} onVerdict={props.onVerdict} />
          )} />
          <Route path="/coding/:track/:taskId" element={<h1>Another task</h1>} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(revealCoding).mockReset();
  vi.mocked(runCodeTests).mockReset();
  vi.mocked(runCodeTests).mockResolvedValue(outcome({ results: [{ pass: false, actual: '[1]', error: null }, { pass: true, actual: '[]', error: null }] }));
  vi.mocked(useCodingApproaches).mockClear();
});
afterEach(() => { vi.useRealTimers(); });

// C4-2 / C5-8: a Submit that fails on the network or a rate limit left the
// previous verdict on screen beside the new error.
it('clears the last verdict when a new Submit fails', async () => {
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ verdict: 'failed', progress: progress('in_progress'), firstPass: false, xpAwarded: 0, results: [{ pass: false, actual: '[1]', error: null }, { pass: true, actual: '[]', error: null }] }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Failed' })).toBeVisible();
  vi.mocked(submitCoding).mockRejectedValueOnce(new ApiError('Too many requests. Try again shortly.', 429, 'rate_limited'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  expect(screen.queryByRole('heading', { level: 3, name: 'Failed' })).toBeNull();
});

it('keeps the editor and reports the server pass in the workspace', async () => {
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({}));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  const heading = await screen.findByRole('heading', { level: 3, name: /^Passed/ });
  expect(heading).toBeVisible();
  expect(screen.queryByText(/You changed the code after this check/)).toBeNull();
  expect(screen.getByLabelText('Test editor')).toBeVisible();
  expect(within(heading.closest('section')!).getByRole('link', { name: 'Back to the list' })).toBeVisible();
});

// C3-9 / C4-3: "Passing the visible examples is not enough" appeared when
// visible examples had failed too.
it('blames the hidden checks only when every visible check passed', async () => {
  const hiddenLine = /Some hidden checks failed/;
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({
    verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false, hidden: { passed: 0, total: 3 },
    results: [{ pass: false, actual: '[1]', error: null }, { pass: true, actual: '[]', error: null }],
  }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Failed' })).toBeVisible();
  expect(screen.queryByText(hiddenLine)).toBeNull();

  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false, hidden: { passed: 1, total: 3 } }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByText(hiddenLine)).toBeVisible();
});

// C3-5: the live region said "0 of 0 passing" for a crash and a timeout, and
// "5 of 5 passing" for code with type errors.
for (const [name, run, says] of [
  ['an error', outcome({ codeError: 'ReferenceError: x is not defined' }), 'Your code could not run.'],
  ['a timeout', outcome({ timedOut: true, codeError: 'Timed out. Check for an infinite loop.' }), 'Timed out. Check for an infinite loop.'],
  ['type errors', outcome({ results: [{ pass: true, actual: '[2]', error: null }, { pass: true, actual: '[]', error: null }], check: { codeErrors: [{ line: 1, message: 'Type error' }], typeTests: [{ pass: false, error: 'no' }] } }), '2 of 2 passing. 1 compiler error · 1 of 1 type check fails'],
] as const) {
  it(`announces ${name} as what it is`, async () => {
    vi.mocked(runCodeTests).mockResolvedValueOnce(run);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(status()).toHaveTextContent(says));
    expect(status()).not.toHaveTextContent(name === 'type errors' ? /^2 of 2 passing$/ : /passing/);
  });
}

// V3-5: the first keystroke after a verdict switched the live region from the
// verdict to the old run, so a screen reader announced "2 of 2 passing" about
// code that had just failed and then changed.
it('announces nothing old once the code changes, and the next run as news', async () => {
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({
    verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false, hidden: { passed: 1, total: 3 },
  }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(status()).toHaveTextContent(/^Failed$/));
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list.map((n) => n * 2); ' } });
  expect(status()).toHaveTextContent(/^Failed$/);

  vi.mocked(runCodeTests).mockResolvedValueOnce(outcome({ results: [{ pass: false, actual: '[1]', error: null }, { pass: true, actual: '[]', error: null }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(() => expect(status()).toHaveTextContent(/^1 of 2 passing$/));
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list;' } });
  expect(status()).toHaveTextContent(/^1 of 2 passing$/);
});

// The server's run replaces the browser's preview on Submit. When the server
// answered first, the preview never cleared the "code changed" row left by an
// edit after the last Run, so it stood beside results about this very code.
it('does not call the server’s results about the code just submitted stale', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(() => expect(status()).toHaveTextContent(/^1 of 2 passing$/));
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list.map((n) => n * 2);' } });
  expect(screen.getByText('The code changed since this run.')).toBeVisible();
  // The browser's preview is still compiling when the server answers.
  vi.mocked(runCodeTests).mockImplementationOnce(() => new Promise(() => {}));
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({}));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: /^Passed/ })).toBeVisible();
  expect(screen.queryByText('The code changed since this run.')).toBeNull();
});

it('marks a Run stale when the editor changes while the result is pending', async () => {
  let finish!: (run: RunOutcome) => void;
  vi.mocked(runCodeTests).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  fireEvent.change(editor(), { target: { value: '// newer code' } });
  await act(async () => { finish(outcome({ codeError: 'Error from the old source' })); });

  const panel = within(screen.getByRole('tabpanel', { name: 'Results' }));
  expect(panel.getByText('The code changed since this run.')).toBeVisible();
  expect(panel.getByText('Error from the old source')).toBeVisible();
  expect(status()).toHaveTextContent('The code changed since this run.');
});

it('marks a slow Submit stale while still reporting the pass for the submitted source', async () => {
  let finish!: (result: CodingVerdictResponse) => void;
  vi.mocked(submitCoding).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const onVerdict = vi.fn();
  const accepted = verdict({});
  mount({ onVerdict });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  editor().focus();
  fireEvent.change(editor(), { target: { value: '// newer code' } });
  await act(async () => { finish(accepted); });

  expect(screen.getByText('You changed the code after this check. Submit again to check the new version.')).toBeVisible();
  expect(screen.getByText('+25 XP')).toBeVisible();
  expect(editor()).toHaveValue('// newer code');
  expect(editor()).toHaveFocus();
  expect(onVerdict).toHaveBeenCalledWith(accepted, task.starter, true);
});

// C3-7: offline, a runner that never loaded read "Your code could not run.
// The runner crashed." with the hint "Your code threw".
it('says the runner did not load instead of blaming the code, and opens no hint for it', async () => {
  vi.mocked(runCodeTests).mockResolvedValueOnce(outcome({ runnerUnavailable: true }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  const note = 'The runner did not load, so your code did not run. Check your connection and run again.';
  expect(await screen.findByText(note, { selector: 'p' })).toBeVisible();
  expect(status()).toHaveTextContent(note);
  expect(screen.queryByText(/could not run|Your code threw/)).toBeNull();
  // Nothing ran, so it is not the failed attempt that opens the hints.
  expect(screen.getByRole('button', { name: 'Hint' })).toHaveAttribute('aria-disabled', 'true');
});

// V4-3: `return n +;` showed "Unexpected token ';'" under the runtime hint,
// "Check the values you index into", about code that never ran. The browser
// now names it as the grading sandbox does, and no hint follows it.
it('gives code that does not parse no hint, and a throw still its runtime hint', async () => {
  const unparsed = await evaluateCalls({ code: 'const double = (list) => list +;', calls: ['double([1])'], expectations: [[2]] });
  expect(unparsed.codeError).toMatch(/^SyntaxError: /);
  vi.mocked(runCodeTests).mockResolvedValueOnce(outcome({ codeError: unparsed.codeError }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText(unparsed.codeError!)).toBeVisible();
  expect(document.querySelector('.cd-hint--failure')).toBeNull();

  const threw = await evaluateCalls({ code: 'const double = (list) => list;\nnull.x;', calls: ['double([1])'], expectations: [[2]] });
  expect(threw.codeError).not.toMatch(/^SyntaxError/);
  vi.mocked(runCodeTests).mockResolvedValueOnce(outcome({ codeError: threw.codeError }));
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText(/^Your code threw before it could answer/)).toBeVisible();
});

// C5-2: a runaway type is the types' doing, not a loop's.
it('names a stopped type check as a type problem, with no loop hint', async () => {
  vi.mocked(runCodeTests).mockResolvedValueOnce(outcome({ timedOut: true, codeError: TYPE_CHECK_STOPPED_MESSAGE }));
  mount({ subject: { ...task, track: 'typescript' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(await screen.findByText(/^Type checking stopped before it finished/, { selector: 'p' })).toBeVisible();
  expect(screen.queryByText(/infinite loop|did not finish|loop whose condition/)).toBeNull();
});

// C5-2: Submit waited for the browser's own type check (up to 45 s) before
// the request left. The server grades anyway, so it goes at once.
it('sends Submit without waiting for the browser run, and shows the server run', async () => {
  let finishLocal!: (run: RunOutcome) => void;
  vi.mocked(runCodeTests).mockImplementationOnce(() => new Promise((resolve) => { finishLocal = resolve; }));
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({}));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await waitFor(() => expect(submitCoding).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole('heading', { level: 3, name: /^Passed/ })).toBeVisible();
  // The browser run finishing late does not replace what the server saw.
  await act(async () => { finishLocal(outcome({ codeError: 'late local run' })); });
  expect(screen.queryByText('late local run')).toBeNull();
  expect(screen.getByRole('tab', { name: /Results/ })).toHaveAttribute('aria-selected', 'true');
});

// C3-8: the gate was checked at render time only, so a learner who edited
// and then waited a minute still saw Hint locked until the next keystroke.
it('opens the hint a minute after the first edit without another keystroke', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  mount();
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list.map((n) => n);' } });
  const hint = screen.getByRole('button', { name: 'Hint' });
  // Let the display formatter (350 ms after a pause) settle first: its render
  // would otherwise land after the jump and open the gate by accident.
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Format' })).toBeEnabled());
  expect(hint).toHaveAttribute('aria-disabled', 'true');
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
  expect(hint).not.toHaveAttribute('aria-disabled');
  fireEvent.click(hint);
  expect(screen.getByText('Use map.')).toBeVisible();
});

// C3-6: Run went natively disabled while it ran, which drops the focus to
// the page; and the confirmations ignored Escape and left focus nowhere.
it('keeps Run focusable while it runs', async () => {
  let finish!: (run: RunOutcome) => void;
  vi.mocked(runCodeTests).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  mount();
  const run = screen.getByRole('button', { name: 'Run' });
  run.focus();
  fireEvent.click(run);
  const busy = screen.getByRole('button', { name: 'Running…' });
  expect(busy).toBe(run);
  expect(busy).not.toBeDisabled();
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  expect(document.activeElement).toBe(run);
  await act(async () => { finish(outcome({ results: [{ pass: true, actual: '[2]', error: null }, { pass: true, actual: '[]', error: null }] })); });
  expect(screen.getByRole('button', { name: 'Run' })).not.toHaveAttribute('aria-disabled');
});

// A Run kept its worker going after the learner left the task: a loop ran on
// to its budget, a first TypeScript compile for up to 45 s.
it('stops a Run in progress when the task is left', async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(runCodeTests).mockImplementationOnce((input) => { signal = input.signal; return new Promise(() => {}); });
  const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(() => expect(runCodeTests).toHaveBeenCalledTimes(1));
  expect(signal?.aborted).toBe(false);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});

// A drag the browser cancelled (a touch turned into a scroll) never sent
// pointerup, and the split went on following the pointer afterwards.
it('ends a splitter drag the browser cancels', () => {
  // jsdom has no pointer capture.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, configurable: true });
  mount();
  const separator = screen.getByRole('separator', { name: 'Resize the editor and task information panes' });
  vi.spyOn(separator.parentElement!, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000 } as DOMRect);
  fireEvent.pointerDown(separator, { pointerId: 1 });
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 400 })); });
  expect(separator).toHaveAttribute('aria-valuenow', '40');
  act(() => { window.dispatchEvent(new MouseEvent('pointercancel')); });
  act(() => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 700 })); });
  expect(separator).toHaveAttribute('aria-valuenow', '40');
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  localStorage.removeItem('devshark:coding:layout:v1');
});

// The shortcuts belong to the editor. Ctrl+Enter, which many forms take for
// "send", in the report dialog or the skip note ran the code, and
// Ctrl+Shift+Enter submitted it.
it('leaves Ctrl+Enter in the report dialog and the skip note to them', async () => {
  // jsdom has no modal dialogs.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  vi.mocked(submitCoding).mockResolvedValue(verdict({ verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  const note = screen.getByLabelText(/Anything you want to add/);
  fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Report a problem with this task' }));
  const detail = await screen.findByRole('textbox', { name: /Additional details/ });
  fireEvent.keyDown(detail, { key: 'Enter', metaKey: true });
  fireEvent.keyDown(detail, { key: 'Enter', metaKey: true, shiftKey: true });
  await act(async () => {});
  expect(runCodeTests).not.toHaveBeenCalled();
  expect(submitCoding).not.toHaveBeenCalled();
  // From the editor they still run and submit.
  fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(runCodeTests).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).not.toHaveAttribute('aria-disabled'));
  fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true, shiftKey: true });
  await waitFor(() => expect(submitCoding).toHaveBeenCalledTimes(1));
});

it('closes the Reset confirmation on Escape, keeps the code and gives focus back to Reset', () => {
  mount();
  fireEvent.change(editor(), { target: { value: 'const double = () => [];' } });
  const reset = screen.getByRole('button', { name: 'Reset' });
  fireEvent.click(reset);
  const dialog = screen.getByRole('alertdialog', { name: 'Reset' });
  // C3-15: the way out said "Try again", which is not what it does.
  expect(within(dialog).getByRole('button', { name: 'Keep my code' })).toHaveFocus();
  fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Keep my code' }), { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(editor()).toHaveValue('const double = () => [];');
  expect(document.activeElement).toBe(reset);
});

function climbTheLadder() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list.map((n) => n);' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next hint' }));
  clock.mockRestore();
}

// C4-5 and C3-15: a signed-out reveal promised the task would "come back
// later", which nothing does; and its way out said "Try again".
it('tells a signed-out visitor what a reveal really does after Submit, and Keep trying returns focus', async () => {
  mount({ signedIn: false });
  // UX audit coding-10: the brief carries no sign-in note; a pass says it
  // needs an account, where it matters (the next test).
  expect(screen.queryByText(/Sign in to keep your progress/)).toBeNull();
  climbTheLadder();
  expect(screen.queryByRole('button', { name: 'Solution' })).toBeNull();
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('heading', { level: 3, name: 'Failed' });
  const solution = screen.getByRole('button', { name: 'Solution' });
  fireEvent.click(solution);
  const dialog = screen.getByRole('alertdialog', { name: 'Solution' });
  expect(dialog).toHaveTextContent('Showing the solution ends this attempt, and Submit stays off until you open the task again. Show it?');
  expect(dialog).not.toHaveTextContent(/comes back later/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep trying' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(document.activeElement).toBe(solution);
});

// A rung appeared in the pane beside the editor while focus stayed on Hint,
// so a screen reader never read it.
it('moves focus to each hint as it is revealed', () => {
  mount();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(editor(), { target: { value: 'const double = (list) => list.map((n) => n);' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  expect(document.activeElement).toHaveTextContent('Use map.');
  fireEvent.click(screen.getByRole('button', { name: 'Next hint' }));
  expect(document.activeElement).toHaveTextContent('Array.prototype.map()');
  clock.mockRestore();
});

// C3-15: the documentation rung printed the task's tag slug ("map-set").
it('names the documentation page by its title on the last rung', () => {
  mount();
  climbTheLadder();
  expect(screen.getByRole('link', { name: 'Open the page “Array.prototype.map()”' })).toHaveAttribute('href', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map');
});

// C3-16: 79 reference solutions are one long line and read as a run-on line.
it('lays out a one-line reference solution for reading, and focuses it', async () => {
  vi.mocked(revealCoding).mockResolvedValueOnce({
    solution: 'const countMultiples = (n, from, to) => { let count = 0; for (let value = from; value <= to; value += 1) { if (value % n === 0) count += 1; } return count; };',
    reference: null, progress: progress('revealed'),
  });
  mount();
  climbTheLadder();
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ verdict: 'failed', progress: progress('in_progress'), xpAwarded: 0, firstPass: false }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('heading', { level: 3, name: 'Failed' });
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Solution' })).getByRole('button', { name: 'Solution' }));
  const shown = await screen.findByText(/const countMultiples/, { selector: 'pre' }, { timeout: 10_000 });
  expect(shown.textContent!.split('\n').length).toBeGreaterThan(4);
  expect(shown.textContent).toContain('    if (value % n === 0) count += 1;');
  await waitFor(() => expect(document.activeElement).toBe(shown.closest('.cd-solution')));
});

// C3-18: Next challenge after a skip was a plain link, so the whole app
// loaded again.
it('opens the challenge offered after a skip inside the app', async () => {
  vi.mocked(skipTask).mockResolvedValueOnce({ recorded: true, next: 'js-digit-sum', required: false });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  fireEvent.click(screen.getByRole('button', { name: 'Skip and continue' }));
  const next = await screen.findByRole('link', { name: 'Next challenge' });
  fireEvent.click(next);
  expect(await screen.findByRole('heading', { level: 1, name: 'Another task' })).toBeVisible();
});

// An accepted arrangement uses the same minimal completion, with its actual
// zero XP. It still never requests verified-code approach comparisons.
it('keeps an accepted puzzle order distinct from a code pass and requests no approaches', async () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(max-width: 1023.95px)', media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  const puzzle = {
    taskId: 'js-test-state', variantId: 'v1',
    lines: [{ id: 'b1', code: '}' }, { id: 'b2', code: 'const one = () => {' }, { id: 'b3', code: '  return 1;' }],
    competencies: ['sequence' as const], claim: 'Arranged correctly.',
  };
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({
    results: [], progress: null, firstPass: false, xpAwarded: 0, applied: false,
    puzzle: { accepted: true, competencies: ['sequence'], claim: 'Arranged correctly.' },
  }));
  mount({ subject: { ...task, puzzle } });
  fireEvent.click(screen.getByRole('button', { name: /Check the order/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Passed +0 XP' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Check the order/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Next task' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to the list' })).toBeVisible();
  expect(vi.mocked(useCodingApproaches).mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
});

// The paths walk (#587): a pass made on the screen shows the completion,
// which never returns to the tabs, so the approach comparisons it would open
// are not read; a task passed before still opens them.
it('defers approach comparisons after a pass until requested, and reads them for a task passed before', async () => {
  // A wide screen: the editor shows (the case above left a narrow one).
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  vi.mocked(useCodingApproaches).mockClear();
  vi.mocked(runCodeTests).mockResolvedValue(outcome({ results: [{ pass: true, actual: '[2]', error: null }, { pass: true, actual: '[]', error: null }] }));
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({}));
  const { unmount } = mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: 'Passed +25 XP' })).toBeVisible();
  expect(vi.mocked(useCodingApproaches).mock.calls.every(([, enabled]) => enabled === false)).toBe(true);
  unmount();

  vi.mocked(useCodingApproaches).mockClear();
  render(
    <MemoryRouter>
      <LanguageProvider>
        <CodingWorkbench task={task} session="test-session" locked={null} initialCode={null} signedIn progress={progress('passed')} mode="section" />
      </LanguageProvider>
    </MemoryRouter>,
  );
  expect(vi.mocked(useCodingApproaches).mock.calls.some(([, enabled]) => enabled === true)).toBe(true);
});

it('shows three landing examples while Run still checks every test', async () => {
  const subject = { ...task, tests: [1, 2, 3, 4, 5].map(n => ({ call: `double([${n}])`, expected: [n * 2] })) };
  vi.mocked(runCodeTests).mockResolvedValue(outcome({ results: subject.tests.map(test => ({ pass: true, actual: JSON.stringify(test.expected), error: null })) }));
  mount({ subject, mode: 'landing' });
  fireEvent.click(screen.getByRole('tab', { name: 'Results' }));
  const results = screen.getByRole('tabpanel', { name: 'Results' });
  expect(within(results).getAllByRole('listitem')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  // The count of every check run is the Results badge, said once (coding-19).
  await waitFor(() => expect(screen.getByRole('tab', { name: /Results/ })).toHaveTextContent('Results5/5'));
  expect(within(results).queryByText('5 of 5 passing')).toBeNull();
  expect(within(results).getAllByRole('listitem')).toHaveLength(3);
  expect(vi.mocked(runCodeTests).mock.calls[0][0].tests).toHaveLength(5);
});

it('keeps Big O space targets and guidance exclusively inside its named tooltip', () => {
  mount({ subject: { ...task, prompt: 'Target: O(n) time, and O(1) extra space.' } });
  expect(screen.getByText('Desired complexity: O(n)')).toBeVisible();
  const info = screen.getByRole('link', { name: 'About Big O complexity' });
  const tooltip = document.getElementById(info.getAttribute('aria-describedby')!)!;
  expect(tooltip).toHaveAttribute('role', 'tooltip');
  expect(info).toHaveAttribute('href', '/big-o');
  expect(tooltip).toHaveTextContent('array items, string characters, list nodes');
  expect(tooltip).toHaveTextContent('Variables such as n, m or L refer to the sizes described in the brief.');
  expect(document.querySelector('.cd-complexity details')).toBeNull();
  expect(document.querySelector('.cd-complexity > span')).not.toHaveTextContent('Target extra space');
});

it('labels Run and Submit at every width and keeps icons with tooltips for the editor\'s own toolbar (coding-02, coding-13)', () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  const landing = mount({ mode: 'landing' });
  // Run keeps its word; Format and Reset are the editor toolbar's named icons.
  expect(screen.getByRole('button', { name: 'Run' })).toHaveTextContent('Run');
  for (const name of ['Format', 'Reset']) {
    const button = screen.getByRole('button', { name });
    expect(button.closest('.cd-editor-bar')).toHaveClass('ss-compact');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button).not.toHaveTextContent(name);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)).toHaveTextContent(name);
  }
  expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Solution' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Report a problem with this task' })).toBeNull();
  fireEvent.keyDown(editor(), { key: 'Enter', ctrlKey: true, shiftKey: true });
  expect(submitCoding).not.toHaveBeenCalled();
  landing.unmount();
  mount();
  for (const name of ['Run', 'Hint', 'Submit']) {
    expect(screen.getByRole('button', { name })).toHaveTextContent(name);
  }
  // Submit is the row's one filled primary, SwimCta md.
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveClass('ss-swim-cta--md');
  expect(screen.getByRole('button', { name: 'Run' }).closest('.cd-editor-actions')!.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Format' }).closest('.cd-editor-actions')).toBeNull();
  expect(screen.getByRole('button', { name: 'Report a problem with this task' })).toBeVisible();
});

it('keeps Hint below the editor and Report in its toolbar on narrow screens', async () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query.includes('1023.95'), media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Use the editor here' }));
  expect(screen.getByRole('button', { name: 'Run' })).toHaveTextContent('Run');
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveTextContent('Submit');
  expect(screen.getByRole('button', { name: 'Hint' }).closest('.cd-editor-actions')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Report a problem with this task' }).closest('.cd-editor-bar')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  expect(screen.queryByRole('tab', { name: /Solution/ })).toBeNull();
});

it('keeps the draft and requires the latest brief after a stale Submit', async () => {
  vi.mocked(submitCoding).mockRejectedValueOnce(new ApiError('Task changed', 409, 'task_changed'));
  const refresh = vi.fn().mockResolvedValue(undefined);
  mount({ onRefreshTask: refresh });
  const source = 'const double = ns => ns.map(n => n * 2);';
  fireEvent.change(editor(), { target: { value: source } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByText(/Review the latest brief/);
  expect(editor()).toHaveValue(source);
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(submitCoding).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.cd-completion')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Load latest brief' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledWith(source));
  await waitFor(() => expect(screen.queryByText(/Review the latest brief/)).toBeNull());
  expect(editor()).toHaveValue(source);
  expect(screen.getByRole('button', { name: 'Submit' })).not.toHaveAttribute('aria-disabled', 'true');
});

it('keeps the stale draft when loading the latest brief fails', async () => {
  vi.mocked(submitCoding).mockRejectedValueOnce(new ApiError('Task changed', 409, 'task_changed'));
  const refresh = vi.fn().mockRejectedValue(new ApiError('Connection lost', 0));
  mount({ onRefreshTask: refresh });
  fireEvent.change(editor(), { target: { value: 'const kept = 1;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Load latest brief' });
  fireEvent.click(screen.getByRole('button', { name: 'Load latest brief' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load latest brief' })).not.toBeDisabled());
  expect(editor()).toHaveValue('const kept = 1;');
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(submitCoding).toHaveBeenCalledTimes(1);
});

// A long token in a brief, a hint or an error note (a member chain, a
// minified line) pushed the page sideways at 360 px and 200 % text.
it('lets long code tokens in the brief, the hints and the notes wrap', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8');
  document.head.append(style);
  const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  for (const selector of ['.cd-prompt', '.cd-prompt code', '.cd-inline-code', '.cd-hint', '.cd-note']) {
    expect(declared(rules, selector, 'overflow-wrap'), selector).toBe('anywhere');
  }
  style.remove();
});

// UX audit coding-10: signed out, the brief says nothing about an account; the
// pass says it was not recorded and offers Sign in, the moment it matters.
it('tells a signed-out visitor at the pass, with Sign in, that it needs an account', async () => {
  vi.mocked(openSignIn).mockClear();
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ progress: null, firstPass: false, xpAwarded: 0 }));
  mount({ signedIn: false });
  expect(screen.queryByText(/Sign in to keep your progress/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: /^Passed/ })).toBeVisible();
  const line = screen.getByText(/^Sign in to record this pass\./);
  const signIn = within(line).getByRole('button', { name: 'Sign in' });
  expect(signIn).toHaveAttribute('aria-haspopup', 'dialog');
  fireEvent.click(signIn);
  expect(openSignIn).toHaveBeenCalledTimes(1);
});

it('says a signed-in pass that was not recorded without offering Sign in', async () => {
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ progress: null, firstPass: false, xpAwarded: 0 }));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('heading', { level: 3, name: /^Passed/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
});

it('opens Solution only from an authorized server pass, preserving the editor', async () => {
  const solutions = { junior: 'const double = list => list.map(n => n * 2);', senior: 'const double = list => Array.from(list, n => n * 2);' };
  vi.mocked(submitCoding).mockResolvedValueOnce(verdict({ solutions }));
  mount();
  const mountedEditor = editor();
  expect(screen.queryByRole('tab', { name: /Solution/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  await waitFor(() => expect(status()).toHaveTextContent(/passing/));
  expect(screen.queryByRole('tab', { name: /Solution/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  const solutionTab = await screen.findByRole('tab', { name: /Solution/ });
  fireEvent.click(solutionTab);
  expect(screen.getByRole('tabpanel', { name: /Solution/ })).toHaveTextContent(solutions.junior);
  expect(editor()).toBe(mountedEditor);
});
