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
import { submitCoding } from '../src/coding/api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({ Editor: () => <textarea aria-label="Test editor" /> }));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn(), resetCoding: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', () => ({ warmRunner: () => undefined, holdCompiler: () => () => {}, compilerStarted: () => false, runCodeTests: vi.fn(), runPassed: () => false }));
const harness = vi.hoisted(() => {
  const handle: { ready: boolean; loadFailed: boolean; run: HarnessRun | null; start: ReturnType<typeof vi.fn<() => Promise<HarnessRun>>>; reload: ReturnType<typeof vi.fn>; iframeRef: () => void; frameKey: number } = {
    ready: true, loadFailed: false, run: null, reload: vi.fn(), iframeRef: () => {}, frameKey: 0,
    start: vi.fn(async () => {
      handle.run = { token: 'local', status: 'done', compileError: null, previewError: null, cases: [{ name: 'greets', status: 'pass', error: null, durationMs: 0 }], logs: [], passed: 1, failed: 0, total: 1, ran: true };
      return handle.run;
    }),
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
const workbench = (track: keyof typeof tasks, mode: 'section' | 'lesson' = 'section') => (
  <MemoryRouter><LanguageProvider>
    <CodingWorkbench task={tasks[track]} initialCode={null} session="s" locked={null} signedIn mode={mode} />
  </LanguageProvider></MemoryRouter>
);
const mount = (track: keyof typeof tasks, mode: 'section' | 'lesson' = 'section') => render(workbench(track, mode));
const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+(\/\d+)?$/, '').trim());

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => { harness.run = null; harness.ready = true; harness.loadFailed = false; harness.start.mockClear(); harness.reload.mockClear(); vi.mocked(submitCoding).mockReset(); });

it.each(['click', 'shortcut'])('prepares a cold untouched React task on %s without replaying the old Run', async (trigger) => {
  harness.ready = false;
  const view = mount('react');
  expect(view.container.querySelector('iframe')).toBeNull();
  if (trigger === 'click') fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  else fireEvent.keyDown(screen.getByLabelText('Test editor'), { key: 'Enter', ctrlKey: true });
  expect(harness.start).not.toHaveBeenCalled();
  expect(view.container.querySelector('iframe')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Run' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('Preparing the preview. Run your code when it is ready.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  harness.ready = true;
  view.rerender(workbench('react'));
  expect(harness.start).not.toHaveBeenCalled();
  expect(screen.getByText('Preview ready. Run your code.')).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  expect(harness.start).toHaveBeenCalledTimes(1);
});

it('preloads React on editor intent without loading other tracks or exposing the inactive frame to Tab', () => {
  const view = mount('react');
  expect(view.container.querySelector('iframe')).toBeNull();
  fireEvent.focus(screen.getByLabelText('Test editor'));
  const frame = view.container.querySelector('iframe')!;
  expect(frame).not.toBeNull();
  expect(frame).toHaveAttribute('tabindex', '-1');
  expect(frame.closest('[role="tabpanel"]')).not.toHaveAttribute('hidden');
  expect(frame.closest('[role="tabpanel"]')).toHaveAttribute('aria-hidden', 'true');
  view.unmount();
  const javascript = mount('javascript');
  fireEvent.focus(screen.getByLabelText('Test editor'));
  expect(javascript.container.querySelector('iframe')).toBeNull();
});

it('keeps the parked preview outside Tab order after a runtime timeout', () => {
  harness.run = { token: 'timed-out', status: 'timeout', compileError: null, previewError: null, cases: [], logs: [], passed: 0, failed: 0, total: 0, ran: true };
  const view = mount('react');
  fireEvent.pointerEnter(view.container.querySelector('.cd-editor-actions')!);
  const frame = view.container.querySelector('iframe')!;
  const panel = frame.closest('[role="tabpanel"]')!;
  expect(panel).toHaveAttribute('aria-hidden', 'true');
  expect(panel).toHaveAttribute('tabindex', '-1');
  expect(frame).toHaveAttribute('tabindex', '-1');
  expect(panel.querySelector('button')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
  expect(screen.getByRole('button', { name: 'Restart sandbox' })).toBeInTheDocument();
});

it('offers a preview retry without running code while the preview has failed to load', () => {
  harness.ready = false;
  harness.loadFailed = true;
  const view = mount('react');
  fireEvent.pointerEnter(view.container.querySelector('.cd-editor-actions')!);
  expect(screen.getByText('The preview could not load. Your code has not run here.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  const retry = screen.getByRole('button', { name: 'Retry preview' });
  retry.focus();
  fireEvent.click(retry);
  expect(harness.reload).toHaveBeenCalledTimes(1);
  expect(harness.start).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Run' })).toHaveFocus();
});

it.each(['click', 'shortcut'])('sends authoritative React Submit by %s while preview readiness is pending', async (trigger) => {
  harness.ready = false;
  harness.start.mockReturnValueOnce(new Promise<never>(() => {}));
  vi.mocked(submitCoding).mockResolvedValueOnce({ verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null, design: null, designReference: null, failureHint: null, puzzle: null, progress: null, firstPass: false, xpAwarded: 0, xpForfeited: false, applied: false, github: null, solutions: null });
  mount('react');
  await act(async () => {
    if (trigger === 'click') fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    else fireEvent.keyDown(screen.getByLabelText('Test editor'), { key: 'Enter', ctrlKey: true, shiftKey: true });
  });
  expect(submitCoding).toHaveBeenCalledTimes(1);
  expect(harness.start).toHaveBeenCalledTimes(1);
});

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

it('keeps one shared tab order on every track', () => {
  const javascript = mount('javascript');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Resources']);
  javascript.unmount();
  const typescript = mount('typescript');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Types', 'Resources']);
  typescript.unmount();
  mount('react');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Preview', 'Resources']);
});

it('shares the same single-strip layout with embedded Learn', () => {
  const view = mount('javascript', 'lesson');
  expect(tabNames()).toEqual(['Description', 'Results', 'Console', 'Resources']);
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(view.container.querySelector('.cd-feedback')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Hide output' })).toBeNull();
});

it('selects Results after Run while preserving the editor and other panels', async () => {
  vi.mocked(runCodeTests).mockResolvedValueOnce({ results: [{ pass: true, actual: '1', error: null }], logs: [] } as never);
  mount('javascript');
  const editor = screen.getByLabelText('Test editor');
  fireEvent.click(screen.getByRole('tab', { name: /Resources/ }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(screen.getByRole('tabpanel', { name: /Results/ })).toBeVisible();
  expect(screen.queryByRole('tabpanel', { name: /Resources/ })).toBeNull();
  expect(screen.getByLabelText('Test editor')).toBe(editor);
  fireEvent.click(screen.getByRole('tab', { name: 'Description' }));
  expect(screen.getByRole('tabpanel', { name: 'Description' })).toBeVisible();
  expect(screen.queryByRole('tabpanel', { name: /Results/ })).toBeNull();
});

it('preserves bounded keyboard resizing without a second feedback separator', () => {
  mount('javascript');
  const resize = screen.getByRole('separator');
  fireEvent.keyDown(resize, { key: 'Home' });
  expect(resize).toHaveAttribute('aria-valuenow', '35');
  fireEvent.keyDown(resize, { key: 'ArrowRight' });
  expect(resize).toHaveAttribute('aria-valuenow', '40');
  fireEvent.keyDown(resize, { key: 'End' });
  expect(resize).toHaveAttribute('aria-valuenow', '75');
  fireEvent.keyDown(resize, { key: 'Enter' });
  expect(resize).toHaveAttribute('aria-valuenow', '58');
  localStorage.removeItem('devshark:coding:layout:v1');
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

it('previews checks in one list and expands the first failure with its input, expected and received values', async () => {
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
  // Before a run the accessible label explains the arrow.
  expect(within(panel).queryByText(/Expected:/)).toBeNull();
  expect(within(panel).getAllByText('expected')[0]).toHaveClass('cd-visually-hidden');
  vi.mocked(runCodeTests).mockResolvedValueOnce({ results: [{ pass: true, actual: '0', error: null }, { pass: false, actual: 'undefined', error: null }], logs: [] } as never);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run' })); });
  const [, failed] = within(screen.getByRole('tabpanel', { name: /Results/ })).getAllByRole('listitem');
  expect(failed).toHaveClass('cd-result--fail');
  expect(failed.querySelector('.cd-result__status')).toHaveTextContent('Fail');
  expect(failed.querySelector('details')).toHaveAttribute('open');
  expect(within(failed).getAllByRole('term').map(term => term.textContent)).toEqual(['Input', 'Expected', 'Received']);
  expect(within(failed).getAllByRole('definition').map(value => value.textContent)).toEqual(['digitSum(493)', '16', 'undefined']);
  expect(other).toBeDefined();
});

it('draws the pane separator as a quiet 1px line in a 12px column with 2px either side (coding-18)', () => {
  const { container } = mount('javascript');
  const separator = screen.getByRole('separator', { name: 'Resize the editor and task information panes' });
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
