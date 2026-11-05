// A task pays its XP again after a reset, from an hour after it last paid
// (migration 058, owner decision of 9 Oct 2026). Signed in, Reset tells the
// server; the verdict card says when the XP opens again, or why a pass paid
// nothing. Signed out, Reset stays in the browser and nothing is said.
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { resetCoding, submitCoding } from '../src/coding/api';
import type { CodingRepeatXp, CodingTaskProgress, CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({
  useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn(),
  resetCoding: vi.fn(async () => ({ recorded: true, availableAt: null })),
}));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  runCodeTests: vi.fn(async () => ({ results: [{ pass: true, actual: '1', error: null }], logs: [], check: null, timedOut: false })),
}));

const task: PlayableCodingTask = {
  id: 'js-test-repeat', track: 'javascript', level: 1, tier: 1, difficulty: 'easy',
  focus: ['functions'], title: 'Test task',
  prompt: 'Return one.',
  starter: 'const one = () => 0;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [{ call: 'one()', expected: 1 }],
};
const passed: CodingTaskProgress = { status: 'passed', passes: 1, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null };
// 14:32 in the browser's own zone, as the note prints it.
const at = new Date(2026, 9, 9, 14, 32).toISOString();
const verdict = (repeatXp: CodingRepeatXp | null, extra: Partial<CodingVerdictResponse> = {}): CodingVerdictResponse => ({
  verdict: 'passed', results: [{ pass: true, actual: '1', error: null }], hidden: null, check: null, logs: [], codeError: null,
  design: null, designReference: null, failureHint: null, puzzle: null, progress: passed,
  firstPass: false, xpAwarded: 0, xpForfeited: false, repeatXp, applied: true, github: null, solutions: null, ...extra,
});

function mount(signedIn = true, progress: CodingTaskProgress | null = passed) {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <CodingWorkbench task={task} session="test-session" locked={null} initialCode={null} signedIn={signedIn} mode="section" progress={progress} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

async function submitWith(body: CodingVerdictResponse) {
  vi.mocked(submitCoding).mockResolvedValue(body);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  return screen.findByRole('heading', { name: /^Passed/ });
}

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(resetCoding).mockClear();
});

it('says when a paid pass can earn the XP again', async () => {
  mount();
  await submitWith(verdict({ availableAt: at, needsReset: true, withheld: null }, { firstPass: true, xpAwarded: 25 }));
  expect(screen.getByText('+25 XP')).toBeVisible();
  expect(screen.getByText(/Reset the task to earn/)).toBeVisible();
});

it('says a pass without a reset paid nothing, and why', async () => {
  mount();
  await submitWith(verdict({ availableAt: at, needsReset: true, withheld: 'reset' }));
  expect(screen.getByRole('heading', { name: /^Passed/ })).toHaveTextContent('+0 XP');
  expect(screen.getByText(/No XP this time/)).toBeVisible();
});

it('says a pass inside the hour paid nothing, and when to reset', async () => {
  mount();
  await submitWith(verdict({ availableAt: at, needsReset: true, withheld: 'cooldown' }));
  expect(screen.getByRole('heading', { name: /^Passed/ })).toHaveTextContent('+0 XP');
  expect(screen.getByText(/No XP this time/)).toBeVisible();
});

it('leaves a pass after a reveal to its own title', async () => {
  mount();
  await submitWith(verdict({ availableAt: at, needsReset: true, withheld: null }, { xpForfeited: true }));
  expect(screen.getByRole('heading', { name: /^Passed/ })).toHaveTextContent('+0 XP');
  expect(screen.queryByText(/Reset the task/)).toBeNull();
});

it('says nothing about repeat XP when the server sent none', async () => {
  mount();
  await submitWith(verdict(null, { firstPass: true, xpAwarded: 25 }));
  expect(screen.queryByText(/Reset the task|No XP this time/)).toBeNull();
});

it('tells the server about a Reset signed in, and says what it opens', () => {
  mount();
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 1;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Reset' });
  expect(dialog).toHaveTextContent('Replace your code with the starter? Solving it again earns its XP again, an hour after you last earned it.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(resetCoding).toHaveBeenCalledWith({ session: 'test-session' });
  expect(screen.getByLabelText('Test editor')).toHaveValue(task.starter);
});

it('keeps a Reset in the browser signed out, and the plain confirmation', () => {
  mount(false, null);
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 1;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Reset' });
  expect(dialog).toHaveTextContent(/^Replace your code with the starter\?/);
  expect(dialog).not.toHaveTextContent('earns its XP again');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  expect(resetCoding).not.toHaveBeenCalled();
});
