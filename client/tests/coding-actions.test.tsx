import { beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import LoadingScreen from '../src/components/LoadingScreen';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { FULLSTACK_REACT_SCAFFOLD, LINKS_REACT_SCAFFOLD, prepareEvolvingDraft } from '../../shared/coding-fullstack-support';
import { EVOLVING_CHALLENGES, evolvingTaskTrack } from '../../shared/evolving';
import { formatCode } from '../src/coding/runner/format';
import { FinButton } from '../src/components/landing/LandingKit';
import { generateFinHover } from '../src/lib/finHover';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={event => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  runCodeTests: vi.fn(async () => ({ results: [], logs: [], check: null, timedOut: false })),
}));

const task: PlayableCodingTask = {
  id: 'js-test-editor', track: 'javascript', level: 1, tier: 1, difficulty: 'easy',
  focus: ['functions'], title: 'Test task',
  prompt: 'Return one.',
  starter: 'const one = () => 1;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [],
};
function mount(onDraft = vi.fn()) {
  return { onDraft, ...render(<MemoryRouter><LanguageProvider><CodingWorkbench initialCode={null} task={task} session={null} locked={null} signedIn={false} mode="section" onDraft={onDraft} /></LanguageProvider></MemoryRouter>) };
}

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('disables idle/empty formatting and enables it only for a real formatting change', async () => {
  mount();
  expect(screen.getByRole('button', {name:'Hint'})).toBeInTheDocument();
  // Format and Reset are the editor toolbar's icon buttons (coding-02): off,
  // they stay focusable for their tooltip and say so with aria-disabled.
  const format = screen.getByRole('button', { name: 'Format' });
  expect(screen.getByRole('button', { name: 'Reset' })).toHaveAttribute('aria-disabled', 'true');
  expect(format).toHaveAttribute('aria-disabled', 'true');
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one=()=>2' } });
  await waitFor(() => expect(format).not.toHaveAttribute('aria-disabled'), { timeout: 5000 });
  fireEvent.click(format);
  await waitFor(() => expect(screen.getByLabelText('Test editor')).toHaveValue('const one = () => 2;\n'));
  await waitFor(() => expect(format).toHaveAttribute('aria-disabled', 'true'));
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: '   ' } });
  expect(format).toHaveAttribute('aria-disabled', 'true');
});

it('Reset clears exhausted hints even when the code is unchanged', async () => {
  localStorage.setItem('devshark:coding:hints:js-test-editor', '20');
  mount();
  expect(screen.queryByText('Use a function.')).toBeNull();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(screen.getByLabelText('Test editor'), {target:{value:'const one = () => 2;'}});
  fireEvent.click(screen.getByRole('button',{name:'Hint'}));
  expect(screen.getByText('Use a function.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Next hint'}));
  clock.mockRestore();
  fireEvent.change(screen.getByLabelText('Test editor'), {target:{value:task.starter}});
  const reset = screen.getByRole('button', { name: 'Reset' });
  expect(reset).toBeEnabled();
  fireEvent.click(reset);
  const dialog = screen.getByRole('alertdialog', { name: 'Reset' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(screen.queryByText('Use a function.')).toBeNull());
  expect(screen.getByRole('button',{name:'Hint'})).toBeInTheDocument();
  expect(reset).toHaveAttribute('aria-disabled', 'true');
});

it('saves the draft on Run and Submit, never while typing or on leaving', async () => {
  const { unmount, onDraft } = mount();
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 3;' } });
  unmount();
  expect(onDraft).not.toHaveBeenCalled();

  const { onDraft: onRunDraft } = mount();
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 4;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  expect(onRunDraft).toHaveBeenCalledWith('const one = () => 4;');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).not.toHaveAttribute('aria-disabled'));
  cleanup();

  const onSubmitDraft = vi.fn();
  render(<MemoryRouter><LanguageProvider><CodingWorkbench initialCode={null} task={task} session="test-session" locked={null} signedIn mode="section" onDraft={onSubmitDraft} /></LanguageProvider></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 5;' } });
  expect(onSubmitDraft).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(onSubmitDraft).toHaveBeenCalledWith('const one = () => 5;');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).not.toHaveAttribute('aria-disabled'));
});

it('uses a visible, accessible branded loading status', () => {
  render(<LoadingScreen label="Loading task…" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading task…');
  expect(screen.getByText('Loading task…')).toBeVisible();
});

it('leaves section stage context to the route while keeping it for an embedded lesson', () => {
  const project = EVOLVING_CHALLENGES.find(item => item.id === 'js-evolving-calculator')!;
  const stageTask = { ...task, id: project.stages[2] };
  const tree = (mode: 'section' | 'lesson') => <MemoryRouter><LanguageProvider><CodingWorkbench task={stageTask} session={null} locked={null} signedIn={false} initialCode="" mode={mode} /></LanguageProvider></MemoryRouter>;
  const section = render(tree('section'));
  expect(section.container.querySelector('.cd-brief__meta')).toBeNull();
  section.unmount();
  const lesson = render(tree('lesson'));
  expect(lesson.container.querySelector('.cd-brief__meta')).toHaveTextContent('Evolving · Stage 3 of 10');
});

it('keeps the brief in Description and the editor with its actions, with revealed hints after it', () => {
  localStorage.setItem('devshark:coding:hints:js-test-editor', '1');
  render(<MemoryRouter><LanguageProvider><CodingWorkbench initialCode={null} task={task} session="test-session" locked={null} signedIn mode="section" /></LanguageProvider></MemoryRouter>);
  expect(screen.queryByText('Use a function.')).toBeNull();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(screen.getByLabelText('Test editor'), {target:{value:'const one = () => 2;'}});
  fireEvent.click(screen.getByRole('button',{name:'Hint'}));
  clock.mockRestore();
  const run = screen.getByRole('button',{name:'Run'});
  const bar = run.closest('.cd-editor-actions')!;
  expect(within(bar as HTMLElement).getByRole('button',{name:'Solution'})).toBeInTheDocument();
  expect(within(bar as HTMLElement).getByRole('button',{name:'Next hint'})).toBeInTheDocument();
  // Focus mode is gone: nothing in the bar toggles the layout.
  expect(within(bar as HTMLElement).queryByRole('button',{name:'Focus'})).toBeNull();
  expect(within(bar as HTMLElement).getByRole('button',{name:/Skip/i})).toBeInTheDocument();
  // Description owns the complete brief; code actions stay beside the editor.
  const pane = bar.closest('.cd-pane--editor')!;
  const title = screen.getByRole('heading',{level:1,name:'Test task'});
  const description = screen.getByRole('tabpanel', { name: 'Description' });
  expect(description).toContainElement(title);
  expect(title.closest('.cd-pane--editor')).toBeNull();
  // Two lines (coding-11): the eyebrow says where the task sits, the heading under it names it.
  const head = title.closest('.cd-brief__head')!;
  expect(head.firstElementChild).toHaveClass('cd-brief__meta');
  expect(head.firstElementChild).toHaveTextContent('JavaScript · Foundations · Level 1');
  expect(title.closest('.cd-brief__line')?.querySelector('.cd-brief__meta')).toBeNull();
  expect(within(description).getByText('Return one.')).toBeInTheDocument();
  expect(pane.firstElementChild).toHaveClass('cd-editor-slot');
  expect(pane.lastElementChild).toBe(bar);
  expect(bar.compareDocumentPosition(screen.getByLabelText('Test editor')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  // No visible editor label and no printed shortcuts; the editor still describes them.
  expect(screen.queryByText('Your code')).toBeNull();
  expect(screen.queryByText('Leave the editor')).toBeNull();
  expect(screen.getByText(/Escape then Tab leaves the editor/)).toHaveClass('cd-visually-hidden');
  const hint = screen.getByText('Use a function.');
  expect(hint.closest('li')).toBeInTheDocument();
  expect(bar.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(hint.closest('.cd-pane--editor')).toBeNull();
  const grid = bar.closest('.cd-workbench__grid')!;
  expect(pane.parentElement).toBe(grid);
  expect(grid.querySelector('.cd-pane--output')?.parentElement).toBe(grid);
  expect(screen.getByRole('button',{name:/Report a problem/}).closest('.cd-actions--utility')).toBeInTheDocument();
});

it('keeps FullStack routes on real graders and preserves code across the React transition', () => {
  const apps = EVOLVING_CHALLENGES.filter(p=>p.category==='fullstack' && !p.short);
  expect(apps).toHaveLength(3);
  for (const project of apps) {
    expect(project.stages).toHaveLength(12);
    expect(project.stages.map(evolvingTaskTrack)).toEqual(['javascript','typescript','typescript','typescript','typescript','react','react','react','react','react','react','react']);
  }
  const links = EVOLVING_CHALLENGES.find(p=>p.id==='fullstack-links')!;
  expect(links.stages.map(evolvingTaskTrack)).toEqual(['javascript','typescript','typescript','react','react']);
  const saved = 'function normalizeInput(value) { return null; }';
  expect(prepareEvolvingDraft(saved,apps[0],5)).toBe(saved+FULLSTACK_REACT_SCAFFOLD);
  expect(prepareEvolvingDraft(saved,apps[0],6)).toBe(saved);
  // The short path's first React level is its fourth, and it brings its own exports.
  expect(prepareEvolvingDraft(saved,links,3)).toBe(saved+LINKS_REACT_SCAFFOLD);
  expect(prepareEvolvingDraft(saved,links,4)).toBe(saved);
  expect(prepareEvolvingDraft(saved,undefined,4)).toBe(saved);
  expect(prepareEvolvingDraft(saved,EVOLVING_CHALLENGES.find(p=>p.id==='js-path-map'),3)).toBe(saved);
});

it('formats TSX without discarding TypeScript annotations', async () => {
  const formatted=await formatCode('type Item={name:string};export default function App(){return <p>Hello</p>}', 'react');
  expect(formatted).toContain('type Item = { name: string };');
  expect(formatted).toContain('<p>Hello</p>');
});

it('places authored stage links inside Resources, away from the task brief', () => {
  const reference={title:'Addition and numeric operators',url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Expressions_and_operators#arithmetic_operators'};
  render(<MemoryRouter><LanguageProvider><CodingWorkbench initialCode={null} task={{...task,references:[reference]}} session={null} locked={null} signedIn={false} mode="section" /></LanguageProvider></MemoryRouter>);
  expect(screen.queryByRole('heading',{name:'Stage references'})).toBeNull();
  fireEvent.click(screen.getByRole('tab',{name:/Resources/}));
  const link=screen.getByRole('link',{name:reference.title});
  expect(link).toHaveAttribute('href',reference.url);
  expect(link.closest('[role="tabpanel"]')).toBeInTheDocument();
  expect(link.closest('.cd-brief')).toBeNull();
});

it('keeps a randomized fin stable across button updates without changing its accessible name', () => {
  const {rerender}=render(<FinButton onClick={()=>{}}>Continue</FinButton>);
  const button=screen.getByRole('button',{name:'Continue'});
  const profile=button.getAttribute('style');
  rerender(<FinButton disabled>Continue</FinButton>);
  expect(button).toHaveAttribute('style',profile);
  expect(button).toBeDisabled();
  expect(button.querySelector('.ss-fin-hover')).toHaveAttribute('aria-hidden','true');
  const gentle=generateFinHover(()=>0);
  const fast=generateFinHover(()=>0.99);
  expect(gentle.direction).not.toBe(fast.direction);
  expect(gentle.motion).not.toBe(fast.motion);
  expect(gentle.shade).not.toBe(fast.shade);
  expect(gentle.duration).not.toBe(fast.duration);
});

it('names the difficulty in the code pane’s first line, beside the title', () => {
  mount();
  const title = screen.getByRole('heading', { level: 1, name: 'Test task' });
  const line = title.closest('.cd-brief__line')!;
  expect(line).not.toBeNull();
  expect(within(line as HTMLElement).getByText('Easy').closest('.cd-difficulty')).toHaveAttribute('data-difficulty', 'easy');
});
