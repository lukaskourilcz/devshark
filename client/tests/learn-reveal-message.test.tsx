// Inside a Learn level, Roadmap.tsx tells the learner where the solution they
// asked for is: "open under the hints" (coding.lesson.solutionShown). This
// holds the workbench to that: after a reveal in a level, the reference
// solution is in the hints group, and there is no Solution tab (C3-14).
import { beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { en } from '../src/i18n/translations';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { revealCoding, submitCoding } from '../src/coding/api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn() }));

const task: PlayableCodingTask = {
  id: 'js-test-lesson-reveal', track: 'javascript', level: 1, tier: 2, difficulty: 'easy',
  focus: ['functions'], title: 'Test task',
  prompt: 'Return one.',
  starter: 'const one = () => 0;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [{ call: 'one()', expected: 1 }],
};

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('opens an authorized reveal in the Solution tab and names that location', async () => {
  vi.mocked(revealCoding).mockResolvedValue({ solution: 'const one = () => 1;', reference: null, progress: null });
  render(
    <MemoryRouter>
      <LanguageProvider>
        <CodingWorkbench task={task} session="test-session" locked={null} initialCode={null} signedIn mode="lesson" progress={null} />
      </LanguageProvider>
    </MemoryRouter>,
  );
  // The two rungs the solution waits for, after a minute of editing.
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61_000);
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: 'const one = () => 2;' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next hint' }));
  clock.mockRestore();
  vi.mocked(submitCoding).mockResolvedValueOnce({ verdict: 'failed', results: [], hidden: null, check: null, logs: [], codeError: null, progress: null, firstPass: false, xpAwarded: 0, xpForfeited: false, applied: true, github: null, solutions: null } as never);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  await screen.findByRole('button', { name: 'Solution' });
  fireEvent.click(screen.getByRole('button', { name: 'Solution' }));
  fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Solution' })).getByRole('button', { name: 'Solution' }));

  const solution = await screen.findByText('const one = () => 1;');
  const panel = screen.getByRole('tabpanel', { name: /^Solution/ });
  expect(panel).toContainElement(solution);
  expect(en['coding.lesson.solutionShown']).toContain('shown below');
  expect(screen.getByRole('tab', { name: /^Solution/ })).toHaveAttribute('aria-selected', 'true');
});
