import { beforeAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { submitCoding } from '../src/coding/api';
import { holdCompiler, runCodeTests, warmRunner } from '../src/coding/runner/run-tests';
import { formatCode } from '../src/coding/runner/format';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { readFileSync } from 'node:fs';
import { declared } from './css';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={event => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/runner/format', () => ({ formatCode: vi.fn(async (code: string) => code) }));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  warmRunner: vi.fn(() => () => {}),
  holdCompiler: vi.fn(() => () => {}),
  compilerStarted: () => false,
  runCodeTests: vi.fn(() => new Promise(() => {})),
}));

// A Learn-level task with no puzzle: below 1024 CSS px it opened on "waiting
// for a bigger screen" and nothing else, so a phone could never pass it.
const task: PlayableCodingTask = {
  id: 'js-narrow-editor', track: 'javascript', level: 1, tier: 1, difficulty: 'easy',
  focus: ['functions'], title: 'Narrow task',
  prompt: 'Return one.',
  starter: 'const one = () => 1;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [],
};

function narrowScreen() {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: query === '(max-width: 1023.95px)', media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
}

const mount = (id = task.id) => render(
  <MemoryRouter><LanguageProvider>
    <CodingWorkbench initialCode={null} task={{ ...task, id }} session="test-session" locked={null} signedIn mode="lesson" />
  </LanguageProvider></MemoryRouter>,
);

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => { sessionStorage.clear(); narrowScreen(); });
afterEach(() => { sessionStorage.clear(); });

it('waits for a bigger screen by default in one note with its one button, and keeps the code (coding-14)', () => {
  mount();
  const note = screen.getByText('This task works best on a bigger screen. Your code is kept.').closest('.cd-note')!;
  expect(note).toBeVisible();
  expect(note).toHaveClass('cd-note--warn');
  // The sentence is the status; the button is not read out with it.
  expect(screen.getByText('This task works best on a bigger screen. Your code is kept.')).toHaveAttribute('role', 'status');
  expect(within(note as HTMLElement).queryAllByRole('status').every((el) => el.querySelector('button') === null)).toBe(true);
  // The decision sits inside the note; nothing promises an autosave.
  expect(within(note as HTMLElement).getByRole('button', { name: 'Use the editor here' })).toBeVisible();
  expect(screen.queryByText(/anything you have written is saved/)).toBeNull();
  // Not merely hidden: a phone that has not chosen the editor does not mount
  // or download it (perf baseline #587 C12).
  expect(screen.queryByLabelText('Test editor')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  // Hint, Solution and Report wait for the editor.
  expect(screen.queryByRole('button', { name: /Hint|Solution|More actions|Report/ })).toBeNull();
  expect(document.querySelectorAll('.cd-note')).toHaveLength(1);
});

it('opens the editor with Run and Submit on a narrow screen when the learner asks, and keeps that choice for the session', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Use the editor here' }));
  const editor = screen.getByLabelText('Test editor');
  expect(editor).toBeVisible();
  expect(screen.queryByText('This task works best on a bigger screen. Your code is kept.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Run' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
  // The button that was pressed is gone; focus lands on the pane that replaced it.
  expect(document.activeElement).toBe(editor.closest('.cd-pane--editor'));
  expect(screen.getByRole('tabpanel', { name: 'Description' })).toContainElement(screen.getByRole('heading', { level: 2, name: 'Narrow task' }));

  // The next task in the same browser session opens straight in the editor.
  cleanup();
  mount('js-narrow-editor-next');
  expect(screen.getByLabelText('Test editor')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Use the editor here' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
});

// V3-4: a TypeScript task at phone width downloaded the 4 MB compiler and
// started it in a worker, on every visit, with no editor on the screen.
it('loads no runner while the screen waits for a bigger one, and loads it once the editor opens', () => {
  render(
    <MemoryRouter><LanguageProvider>
      <CodingWorkbench initialCode={null} task={{ ...task, track: 'typescript' }} session="test-session" locked={null} signedIn mode="lesson" />
    </LanguageProvider></MemoryRouter>,
  );
  expect(screen.getByText('This task works best on a bigger screen. Your code is kept.')).toBeVisible();
  expect(warmRunner).not.toHaveBeenCalled();
  expect(holdCompiler).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use the editor here' }));
  expect(warmRunner).toHaveBeenCalledWith('typescript');
  // Choosing the editor is reaching for the code: the compiler loads too.
  expect(holdCompiler).toHaveBeenCalledTimes(1);
});

// Perf baseline #587 C01: a TypeScript task downloaded the 1 MB compiler as
// it opened, also for a learner who only read the brief. It loads once the
// learner reaches for the code.
it('loads the TypeScript compiler when the learner reaches for the code, not on open', () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  const typed = { ...task, track: 'typescript' as const };
  const view = (id: string) => render(
    <MemoryRouter><LanguageProvider>
      <CodingWorkbench initialCode={null} task={{ ...typed, id }} session="test-session" locked={null} signedIn mode="section" />
    </LanguageProvider></MemoryRouter>,
  );
  vi.mocked(holdCompiler).mockClear();
  const pointer = view('ts-reach-pointer');
  expect(warmRunner).toHaveBeenCalledWith('typescript');
  expect(holdCompiler).not.toHaveBeenCalled();
  fireEvent.pointerEnter(pointer.container.querySelector('.cd-editor-slot')!);
  expect(holdCompiler).toHaveBeenCalledTimes(1);
  pointer.unmount();

  vi.mocked(holdCompiler).mockClear();
  const typing = view('ts-reach-typing');
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = (): number => 2;' } });
  expect(holdCompiler).toHaveBeenCalledTimes(1);
  typing.unmount();

  vi.mocked(holdCompiler).mockClear();
  const keyboard = view('ts-reach-run');
  act(() => { screen.getByRole('button', { name: 'Run' }).focus(); });
  expect(holdCompiler).toHaveBeenCalledTimes(1);
  keyboard.unmount();

  // A JavaScript task has no compiler to load.
  vi.mocked(holdCompiler).mockClear();
  const plain = render(
    <MemoryRouter><LanguageProvider>
      <CodingWorkbench initialCode={null} task={task} session="test-session" locked={null} signedIn mode="section" />
    </LanguageProvider></MemoryRouter>,
  );
  fireEvent.pointerEnter(plain.container.querySelector('.cd-editor-slot')!);
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 2;' } });
  expect(holdCompiler).not.toHaveBeenCalled();
});

// The display formatter ran 350 ms after the task opened, so a phone waiting
// for a bigger screen downloaded Prettier for a Format button it did not show.
// Since #587 C02 no screen formats in the background: Prettier loads on the
// first Format press, here as on a wide screen.
it('loads no formatter while the screen waits for a bigger one, and formats once the editor opens and Format is pressed', async () => {
  vi.mocked(formatCode).mockClear();
  mount();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(formatCode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use the editor here' }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(formatCode).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one=()=>2' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Format' })); });
  expect(formatCode).toHaveBeenCalledTimes(1);
});

// Perf baseline #587 C02 and C24: Prettier (about 170 KB gzip) loaded 350 ms
// after every task opened and re-formatted the whole program after every
// typing pause, only to set the Format button. It now runs on a press only.
it('formats nothing on open or while the learner types on a wide screen, only when Format is pressed', async () => {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  }) as MediaQueryList);
  vi.mocked(formatCode).mockClear();
  mount();
  const format = screen.getByRole('button', { name: 'Format' });
  // The starter is shown as authored: nothing to format until the code changes.
  expect(format).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one=()=>2' } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one=()=>3' } });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(formatCode).not.toHaveBeenCalled();
  expect(format).not.toHaveAttribute('aria-disabled');
  await act(async () => { fireEvent.click(format); });
  expect(formatCode).toHaveBeenCalledTimes(1);
  expect(formatCode).toHaveBeenCalledWith('const one=()=>3', 'javascript');
  // What Format produced has nothing more to format.
  expect(format).toHaveAttribute('aria-disabled', 'true');
});

// CODE-5: a section task with a puzzle showed only the puzzle on a narrow
// screen. Arranging lines never completes a task, so five free tasks could
// not be passed on a phone.
const puzzle = {
  taskId: 'js-narrow-puzzle', variantId: 'v1',
  lines: [{ id: 'b1', code: '}' }, { id: 'b2', code: 'const one = () => {' }, { id: 'b3', code: '  return 1;' }],
  competencies: ['sequence' as const], claim: 'Arranged correctly.',
};
const mountPuzzle = () => render(
  <MemoryRouter><LanguageProvider>
    <CodingWorkbench initialCode={null} task={{ ...task, id: 'js-narrow-puzzle', puzzle }} session="test-session" locked={null} signedIn mode="section" />
  </LanguageProvider></MemoryRouter>,
);

it('offers the editor beside a puzzle, and an earlier choice of the editor opens it straight away', () => {
  mountPuzzle();
  expect(screen.getByRole('button', { name: /Check the order/ })).toBeVisible();
  // Not merely hidden: a phone that has not chosen the editor does not mount
  // or download it (perf baseline #587 C12).
  expect(screen.queryByLabelText('Test editor')).toBeNull();
  // The puzzle needs no runner (V3-4).
  expect(warmRunner).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use the editor here' }));
  expect(warmRunner).toHaveBeenCalledWith('javascript');
  const editor = screen.getByLabelText('Test editor');
  expect(editor).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Check the order/ })).toBeNull();
  expect(document.activeElement).toBe(editor.closest('.cd-pane--editor'));

  cleanup();
  mountPuzzle();
  expect(screen.getByLabelText('Test editor')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Submit' })).toBeVisible();
});

// Ctrl+Shift+Enter on a puzzle submitted the code under it, which the
// learner could not see, as a failed attempt; Ctrl+Enter ran it.
it('lets no shortcut run or submit the hidden code while a puzzle or the wait stands in for the editor', () => {
  vi.mocked(submitCoding).mockClear();
  mountPuzzle();
  const check = screen.getByRole('button', { name: /Check the order/ });
  fireEvent.keyDown(check, { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(check, { key: 'Enter', metaKey: true });
  cleanup();
  mount();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Use the editor here' }), { key: 'Enter', ctrlKey: true, shiftKey: true });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Use the editor here' }), { key: 'Enter', ctrlKey: true });
  expect(submitCoding).not.toHaveBeenCalled();
  expect(runCodeTests).not.toHaveBeenCalled();
});

// CODE-11: an accepted order is never recorded, for anyone, so a signed-in
// learner was wrongly told to sign in to keep it.
it('does not tell a signed-in learner to sign in after an accepted order', async () => {
  vi.mocked(submitCoding).mockResolvedValue({
    verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null, design: null, designReference: null,
    failureHint: null, puzzle: { accepted: true, competencies: ['sequence'], claim: 'Arranged correctly.' },
    progress: null, firstPass: false, xpAwarded: 0, xpForfeited: false, applied: false, github: null, solutions: null,
  });
  mountPuzzle();
  fireEvent.click(screen.getByRole('button', { name: /Check the order/ }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Passed +0 XP' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to the list' })).toBeVisible();
  expect(screen.queryByText('Checked, not recorded: sign in to keep passes.')).toBeNull();
});

// A long puzzle line keeps its indentation and scrolls inside its own box at
// 360 px and 200 % text. The line's code is a scroll container, so as a flex
// item its automatic minimum width is already zero, and the pane around the
// puzzle may shrink below its content: the stylesheet is what keeps the page
// from widening, so the test reads it.
it('lets a long puzzle line scroll inside its own box instead of widening the page', () => {
  const style = document.createElement('style');
  style.textContent = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8');
  document.head.append(style);
  const rules = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule);
  expect(declared(rules, '.cd-puzzle__line code', 'white-space')).toBe('pre');
  expect(declared(rules, '.cd-puzzle__line code', 'overflow-x')).toBe('auto');
  expect(declared(rules, '.cd-pane', 'min-width')).toBe('0px');
  style.remove();
});

// A line moved up keeps focus, so a screen reader heard nothing of where it
// landed; the puzzle now says it in its own status line.
it('says where a moved puzzle line landed', () => {
  mountPuzzle();
  const status = document.querySelector<HTMLElement>('.cd-puzzle > [role="status"]')!;
  expect(status).toHaveTextContent('');
  const second = screen.getAllByRole('option')[1];
  fireEvent.click(second);
  fireEvent.keyDown(second, { key: 'ArrowUp', shiftKey: true });
  expect(screen.getAllByRole('option')[0]).toHaveTextContent('const one = () => {');
  expect(status).toHaveTextContent('const one = () => { moved to position 1 of 3');
  fireEvent.click(screen.getByRole('button', { name: 'Move down' }));
  expect(status).toHaveTextContent('const one = () => { moved to position 2 of 3');
});

// While an order was being checked the Up and Down buttons were off but Shift
// and an arrow still moved lines, so the verdict described an arrangement no
// longer on screen.
it('moves no puzzle line from the keyboard while the order is being checked', () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockReturnValue(new Promise(() => {}));
  mountPuzzle();
  fireEvent.click(screen.getByRole('button', { name: /Check the order/ }));
  expect(submitCoding).toHaveBeenCalledWith(expect.objectContaining({ order: ['b1', 'b2', 'b3'] }));
  const first = screen.getAllByRole('option')[0];
  fireEvent.keyDown(first, { key: 'ArrowDown', shiftKey: true });
  expect(screen.getAllByRole('option').map((option) => option.querySelector('code')?.textContent)).toEqual(['}', 'const one = () => {', '  return 1;']);
});
