// The results pane's tabs (UX audit coding-04): one order on every track, so
// the shared tabs keep their place, and every task opens on Description,
// with an empty preview that takes no room until a run draws into it.
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import type { HarnessRun } from '../src/coding/useReactHarness';
import { runCodeTests } from '../src/coding/runner/run-tests';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({ Editor: () => <textarea aria-label="Test editor" /> }));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn(), resetCoding: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', () => ({ warmRunner: () => undefined, holdCompiler: () => () => {}, compilerStarted: () => false, runCodeTests: vi.fn(), runPassed: () => false }));
const harness = vi.hoisted(() => {
  const handle: { ready: boolean; run: HarnessRun | null; start: () => Promise<HarnessRun>; reload: () => void; iframeRef: () => void; frameKey: number } = {
    ready: true, run: null, reload: () => {}, iframeRef: () => {}, frameKey: 0,
    start: async () => {
      handle.run = { token: 'local', status: 'done', compileError: null, previewError: null, cases: [{ name: 'greets', status: 'pass', error: null, durationMs: 0 }], logs: [], passed: 1, failed: 0, total: 1, ran: true };
      return handle.run;
    },
  };
  return handle;
});
vi.mock('../src/coding/useReactHarness', () => ({ HARNESS_URL: '/sandbox/index.html', useReactHarness: () => harness }));

const base = { level: 1, tier: 1, difficulty: 'easy' as const, focus: [] as string[], title: 'Task', prompt: 'Do it.', starter: 'x', hints: [] as string[], verify: 'tests' as const, estimatedMinutes: 5 };
const tasks: Record<'javascript' | 'typescript' | 'react', PlayableCodingTask> = {
  javascript: { ...base, id: 'js-tabs', track: 'javascript', tests: [{ call: 'f()', expected: 1 }] } as PlayableCodingTask,
  typescript: { ...base, id: 'ts-tabs', track: 'typescript', tests: [{ call: 'f()', expected: 1 }], typeTests: [{ code: 'f(1)', rejects: true }] } as PlayableCodingTask,
  react: { ...base, id: 'react-tabs', track: 'react', suite: 'test("greets", () => {});' } as PlayableCodingTask,
};
const mount = (track: keyof typeof tasks) => render(
  <MemoryRouter><LanguageProvider>
    <CodingWorkbench task={tasks[track]} initialCode={null} session="s" locked={null} signedIn mode="section" />
  </LanguageProvider></MemoryRouter>,
);
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+(\/\d+)?$/, '').trim());

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => { harness.run = null; });

it('keeps the complete task in Description, without a second brief above the editor or a Target line', () => {
  const task = {
    ...tasks.javascript, title: 'Digit sum',
    prompt: 'Write `digitSum(n)`. Target: O(log n) time. Zero takes constant work.',
    previousRequirements: ['Keep earlier inputs. Target: O(n) time.'],
  } as PlayableCodingTask;
  const { container } = render(<MemoryRouter><LanguageProvider><CodingWorkbench task={task} initialCode={null} session="s" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
  const description = screen.getByRole('tabpanel', { name: 'Description' });
  expect(within(description).getByRole('heading', { name: 'Digit sum' })).toBeVisible();
  expect(description).toHaveTextContent('Write digitSum(n).');
  expect(description).toHaveTextContent('Desired complexity: O(log n)');
  expect(description).not.toHaveTextContent('Target:');
  expect(container.querySelector('.cd-pane--editor .cd-brief')).toBeNull();
  expect(container.querySelector('.cd-brief__body')).toHaveAttribute('data-capped', 'false');
  expect(screen.queryByRole('button', { name: 'Show full brief' })).toBeNull();
  expect(container.querySelectorAll('.cd-brief')).toHaveLength(1);
  // Keyboard navigation includes Description and preserves its content.
  const tab = screen.getByRole('tab', { name: 'Description' });
  fireEvent.keyDown(tab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Results' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Results' }), { key: 'Home' });
  expect(tab).toHaveFocus();
  expect(description).toBeVisible();
});

it('opens Results after a JavaScript Run and keeps Description available', async () => {
  vi.mocked(runCodeTests).mockResolvedValueOnce({ results: [{ pass: true, actual: '1', error: null }], logs: [] } as never);
  mount('javascript');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  expect(screen.getByRole('tab', { name: /Results/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Description' }));
  expect(screen.getByRole('tabpanel', { name: 'Description' })).toHaveTextContent('Do it.');
});

it('keeps Description, Results, Console, the track tab, then Resources on every track', () => {
  const javascript = mount('javascript');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Resources']);
  javascript.unmount();
  const typescript = mount('typescript');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Types', 'Resources']);
  typescript.unmount();
  mount('react');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Preview', 'Resources']);
});

it('opens React on Description, keeps the empty preview to one line, and shows the preview after the first Run that renders', async () => {
  const { container } = mount('react');
  expect(screen.getByRole('tab', { name: 'Description' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  const panel = screen.getByRole('tabpanel', { name: 'Preview' });
  expect(within(panel).getByText('Run to see the component.')).toBeInTheDocument();
  const frame = container.querySelector('iframe')!;
  expect(frame).toHaveClass('cd-frame--idle');
  expect(frame).toHaveAttribute('aria-hidden', 'true');
  fireEvent.click(screen.getByRole('tab', { name: 'Results' }));

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  expect(frame).not.toHaveClass('cd-frame--idle');
  expect(screen.queryByText('Run to see the component.')).toBeNull();

  // Later runs go back to the checks the learner has to pass.
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  expect(screen.getByRole('tab', { name: /Results/ })).toHaveAttribute('aria-selected', 'true');
});

// Perf baseline #587 C13: a React task booted the sandbox frame (216 KB gzip
// and a 280 ms long task at 4x CPU) as it opened, before any Run or Preview.
it('loads the sandbox frame on the first Run, not while the brief is read', async () => {
  const { container } = mount('react');
  expect(container.querySelector('iframe')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  const frame = container.querySelector('iframe');
  expect(frame).toHaveAttribute('src', '/sandbox/index.html');
  // It stays for the visit: Results again does not unload it.
  fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
  expect(container.querySelector('iframe')).toBe(frame);
});

it('starts the sandbox frame when a pointer or the focus reaches Run and Submit', () => {
  const pointer = mount('react');
  expect(pointer.container.querySelector('iframe')).toBeNull();
  fireEvent.pointerEnter(pointer.container.querySelector('.cd-editor-actions')!);
  expect(pointer.container.querySelector('iframe')).not.toBeNull();
  pointer.unmount();
  const keyboard = mount('react');
  act(() => { screen.getByRole('button', { name: 'Run' }).focus(); });
  expect(keyboard.container.querySelector('iframe')).not.toBeNull();
  keyboard.unmount();
  // No other track has a frame to load.
  const javascript = mount('javascript');
  fireEvent.pointerEnter(javascript.container.querySelector('.cd-editor-actions')!);
  expect(javascript.container.querySelector('iframe')).toBeNull();
});

it('scrolls the tab strip instead of squeezing its tabs, and drops the Resources count on a phone (coding-12)', () => {
  mount('javascript');
  expect(screen.getByRole('tab', { name: /Resources/ })).toHaveAttribute('data-tab', 'resources');
  const css = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8');
  const tab = css.slice(css.indexOf('.cd-tab {'), css.indexOf('}', css.indexOf('.cd-tab {')));
  expect(tab).toContain('flex: none;');
  expect(css).toMatch(/\.cd-tabs \{[^}]*overflow-x: auto;[^}]*mask-image: linear-gradient\(to right, #000 calc\(100% - 16px\), transparent\);/);
  const phone = css.slice(css.indexOf('@media (max-width: 599px)'));
  expect(phone).toMatch(/\.cd-tab \{ padding: 8px; font-size: 0\.9rem; \}/);
  expect(phone).toMatch(/\.cd-tab\[data-tab='resources'\] \.cd-tab__badge \{ display: none; \}/);
  // From 600px the tabs sit closer, so four tabs with their run badges fit a
  // 1280px frame's results pane instead of scrolling the last one away.
  const wider = css.slice(css.indexOf('@media (min-width: 600px) {\n  .cd-tabs'));
  expect(wider).toMatch(/^@media \(min-width: 600px\) \{\s*\.cd-tabs \{ gap: 2px; \}\s*\.cd-tab \{ gap: 6px; padding-inline: 10px; font-size: 0\.95rem; \}\s*\.cd-tab__badge \{ padding-inline: 6px; \}/);
});

it('lists checks as one divided list: the call, the expected value after an arrow, then what came back (coding-15)', async () => {
  const task = { ...tasks.javascript, tests: [{ call: 'digitSum(0)', expected: 0, edge: true, label: 'zero has a digit sum of zero' }, { call: 'digitSum(493)', expected: 16 }] } as PlayableCodingTask;
  render(<MemoryRouter><LanguageProvider><CodingWorkbench task={task} initialCode={null} session="s" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: 'Results' }));
  const panel = screen.getByRole('tabpanel', { name: 'Results' });
  const [zero, other] = within(panel).getAllByRole('listitem');
  expect(zero).toHaveTextContent('digitSum(0) → expected 0edge');
  // The call is its own element, so it is the short form and nothing else.
  expect(zero.querySelector('.cd-result__call')).toHaveTextContent(/^digitSum\(0\)$/);
  expect(zero.querySelector('.cd-result__line > .cd-result__expect')).toHaveTextContent('→ expected 0');
  expect(zero.querySelector('.cd-tag.cd-result__edge')).toHaveTextContent('edge');
  expect(zero.querySelector('.cd-result__label')).toHaveTextContent('zero has a digit sum of zero');
  // "Expected" is never printed: it is read in place of the arrow.
  expect(within(panel).queryByText(/Expected:/)).toBeNull();
  expect(within(panel).getAllByText('expected')[0]).toHaveClass('cd-visually-hidden');
  vi.mocked(runCodeTests).mockResolvedValueOnce({ results: [{ pass: true, actual: '0', error: null }, { pass: false, actual: 'undefined', error: null }], logs: [] } as never);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  const [, failed] = within(screen.getByRole('tabpanel', { name: /Results/ })).getAllByRole('listitem');
  expect(failed).toHaveClass('cd-result--fail');
  expect(failed.querySelector('.cd-result__status')).toHaveTextContent('Fail');
  expect(failed).toHaveTextContent('digitSum(493) → expected 16 · got undefined');
  expect(other).toBeDefined();
});

it('draws the pane separator as a quiet 1px line in a 12px column with 2px either side (coding-18)', () => {
  const { container } = mount('javascript');
  const separator = screen.getByRole('separator', { name: 'Resize the editor and results panes' });
  expect(separator).toHaveAttribute('tabindex', '0');
  expect(container.querySelector('.cd-workbench__grid')).toContainElement(separator);
  const css = readFileSync(new URL('../src/coding/Coding.css', import.meta.url), 'utf8');
  expect(css).toMatch(/grid-template-columns: minmax\(0, var\(--cd-split, 58%\)\) 12px minmax\(0, 1fr\);\s*column-gap: 2px;/);
  const rest = css.slice(css.indexOf('  .cd-splitter {'), css.indexOf('}', css.indexOf('  .cd-splitter {')));
  expect(rest).toContain('var(--ss-card-line)');
  expect(rest).not.toContain('border-radius: 999px');
  expect(css).toMatch(/\.cd-splitter:hover,\s*\.cd-splitter:focus-visible \{ background: linear-gradient.*var\(--brand-accent\)/);
});

it('counts compiler errors and failing type checks apart, and says each count once (coding-19)', async () => {
  vi.mocked(runCodeTests).mockResolvedValueOnce({
    results: [{ pass: false, actual: '0', error: null }],
    logs: [],
    check: { codeErrors: [{ line: 1, message: "Parameter 'title' implicitly has an 'any' type." }], typeTests: [{ pass: false, error: 'no' }, { pass: false, error: 'no' }, { pass: false, error: 'no' }, { pass: false, error: 'no' }, { pass: true, error: null }] },
  } as never);
  const typescript = { ...tasks.typescript, typeTests: [1, 2, 3, 4, 5].map((n) => ({ code: `f(${n})`, rejects: false })) } as PlayableCodingTask;
  render(<MemoryRouter><LanguageProvider><CodingWorkbench task={typescript} initialCode={null} session="s" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  const types = screen.getByRole('tab', { name: /Types/ });
  expect(types).toHaveAttribute('aria-selected', 'true');
  // The badge reads like Results: checks passed of checks, in the failing colour.
  expect(types.querySelector('.cd-tab__badge')).toHaveTextContent('1/5');
  expect(types.querySelector('.cd-tab__badge')).toHaveClass('cd-tab__badge--bad');
  expect(within(screen.getByRole('tabpanel', { name: /Types/ })).getByText('1 compiler error · 4 of 5 type checks fail')).toHaveClass('cd-summary');
  fireEvent.click(screen.getByRole('tab', { name: /Results/ }));
  expect(screen.getByRole('tab', { name: /Results/ }).querySelector('.cd-tab__badge')).toHaveTextContent('0/1');
  expect(screen.queryByText(/of 1 passing/, { selector: '.cd-summary' })).toBeNull();
});
