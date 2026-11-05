// One code shell wherever a task opens (UX audit coding-03): a Learn level's
// coding phase and a path's code activity widen the route box while their
// editor is mounted, and the code activity sits in the workbench's frame with
// the shared editor floor.
import { beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ ariaLabel, fill, minHeight, value, onChange }: { ariaLabel: string; fill?: boolean; minHeight?: number; value?: string; onChange?: (next: string) => void }) =>
    <textarea aria-label={ariaLabel} data-fill={String(Boolean(fill))} data-min={minHeight ?? 'token'} value={value ?? ''} onChange={(event) => onChange?.(event.target.value)} />,
}));

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('puts a path code activity in the workbench frame, on the wide page, with the shared editor floor', async () => {
  const { CodeActivity } = await import('../src/components/paths/ActivityViews');
  const { container } = render(
    <LanguageProvider>
      <CodeActivity code={{ language: 'javascript', prompt: 'Sum it.', starter: '', hints: ['Start at zero.'], approach: [], tests: [{ call: 'sum([1])', label: 'one value' }] } as never}
        draft={null} result={null} onSubmit={() => {}} onDraft={() => {}} draftStatus="idle" busy={false} />
    </LanguageProvider>,
  );
  const root = container.firstElementChild!;
  expect(root).toHaveClass('ss-wide-page', 'cd-workbench', 'cd-workbench--activity');
  const grid = root.querySelector(':scope > .cd-workbench__grid')!;
  const code = grid.querySelector(':scope > .cd-pane--editor')!;
  const beside = grid.querySelector(':scope > .cd-pane--output')!;
  // The code pane: the capped brief, the editor, the actions at its foot.
  expect(code.firstElementChild).toHaveClass('cd-editor-bar');
  expect(screen.getByRole('tabpanel', { name: 'Description' })).toHaveTextContent('Sum it.');
  expect(code.lastElementChild).toHaveClass('cd-editor-actions');
  const editor = await screen.findByRole('textbox', { name: 'Your solution' });
  expect(code).toContainElement(editor);
  expect(editor).toHaveAttribute('data-fill', 'true');
  expect(editor).toHaveAttribute('data-min', 'token');
  expect(code.querySelector('.cd-editor-actions')).toContainElement(screen.getByRole('button', { name: 'Submit' }));
  // Submit is the frame's one filled primary, SwimCta md as on /coding, and
  // nothing else in the activity is filled.
  const submit = screen.getByRole('button', { name: 'Submit' });
  expect(submit).toHaveClass('ss-swim-cta', 'ss-swim-cta--md');
  expect(root.querySelectorAll('.ss-swim-cta, .astryx-button.primary')).toHaveLength(1);
  // Hints and the visible tests sit beside it.
  expect(beside).toContainElement(screen.getByRole('heading', { name: 'Hints' }));
  expect(beside).toContainElement(screen.getByRole('heading', { name: 'Tests you can see' }));
});

it('widens the Learn level runner only for its coding phase', () => {
  const runner = source('components/learn/LessonRunner.tsx');
  const phase = runner.slice(runner.indexOf('if (codingPhase && codingTasks[codingIndex])'));
  expect(phase.slice(0, 1200)).toContain('className="cd-page ss-wide-page"');
  expect(runner.match(/ss-wide-page/g)?.filter(Boolean)).toHaveLength(2);
});

it('gives every editor call site the shared floor instead of a number of its own', () => {
  expect(source('coding/Editor.tsx')).toContain("const EDITOR_MIN = 'var(--cd-editor-min, 280px)';");
  expect(source('components/paths/ActivityViews.tsx')).not.toMatch(/minHeight=\{\d+\}/);
  expect(source('coding/CodingWorkbench.tsx')).not.toMatch(/narrow \? 280 : 480/);
  const css = source('coding/Coding.css');
  expect(css).toContain('--cd-editor-min: 280px;');
  expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{ --cd-editor-min: 200px; \}/);
});

it('keeps a path code activity Submit focusable while it cannot submit, and a press then sends nothing', async () => {
  const { CodeActivity } = await import('../src/components/paths/ActivityViews');
  const onSubmit = vi.fn();
  const view = (busy: boolean, starter: string) => (
    <LanguageProvider>
      <CodeActivity code={{ language: 'javascript', prompt: 'Sum it.', starter, hints: [], approach: [], tests: [] } as never}
        draft={null} result={null} onSubmit={onSubmit} onDraft={() => {}} draftStatus="idle" busy={busy} />
    </LanguageProvider>
  );
  const { rerender } = render(view(false, ''));
  // Empty code: unavailable, not disabled, and a press does nothing.
  const submit = screen.getByRole('button', { name: 'Submit' });
  expect(submit).not.toBeDisabled();
  expect(submit).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(submit);
  expect(onSubmit).not.toHaveBeenCalled();
  // The starter only seeds the first render, so type into the editor.
  fireEvent.change(await screen.findByRole('textbox', { name: 'Your solution' }), { target: { value: 'const sum = () => 1;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(onSubmit).toHaveBeenCalledWith('const sum = () => 1;');
  // Busy, the button that was pressed keeps focus and says what is happening.
  screen.getByRole('button', { name: 'Submit' }).focus();
  rerender(view(true, 'const sum = () => 0;'));
  const busy = screen.getByRole('button', { name: 'Submitting…' });
  expect(busy).toHaveFocus();
  fireEvent.click(busy);
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('keeps the module above an open code activity in the narrow column, so only the frame widens', () => {
  const css = source('components/paths/LearningPaths.css');
  expect(css).toContain('.lp-page:has(.ss-wide-page) > :not(.lp-workspace),\n.lp-workspace:has(> .ss-wide-page) > :not(.ss-wide-page) { width: 100%; max-width: var(--ss-width-narrow); margin-inline: auto; }');
});
