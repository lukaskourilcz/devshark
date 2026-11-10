// A Submit or a reveal that the server refuses says why (CODE-9). Every
// failure used to read "Could not submit. Check your connection", so code
// over the size limit, a rate limit, a locked stage and a plan check that
// could not run all sent the learner to look at their network. A React
// grader outage read as a build error in their code.
import { beforeAll, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingWorkbench } from '../src/coding/CodingWorkbench';
import { submitCoding } from '../src/coding/api';
import { ApiError } from '../src/lib/api';
import type { CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';
import { loadEditor } from '../src/coding/loadEditor';

vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Test editor" value={value} onChange={(event) => onChange(event.target.value)} />,
}));
vi.mock('../src/coding/api', () => ({ useCodingApproaches: () => ({ data: undefined }), submitCoding: vi.fn(), revealCoding: vi.fn() }));
vi.mock('../src/coding/runner/run-tests', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/coding/runner/run-tests')>(),
  runCodeTests: vi.fn(async () => ({ results: [{ pass: true, actual: '1', error: null }], logs: [], codeError: null, check: null, timedOut: false })),
}));
const reactPreview = vi.hoisted(() => ({ stuck: false }));
vi.mock('../src/coding/useReactHarness', () => {
  const run = { token: 'local', status: 'done', compileError: null, previewError: null, cases: [{ name: 'renders', status: 'pass', error: null, durationMs: 0 }], logs: [], passed: 1, failed: 0, total: 1, ran: true };
  const handle = { ready: true, run, start: async () => {
    if (reactPreview.stuck) await new Promise<never>(() => {});
    return run;
  }, reload: () => {}, iframeRef: () => {}, frameKey: 0 };
  return { HARNESS_URL: '/sandbox/index.html', useReactHarness: () => handle };
});

const task: PlayableCodingTask = {
  id: 'js-test-submit', track: 'javascript', level: 1, tier: 1, difficulty: 'easy',
  focus: ['functions'], title: 'Test task',
  prompt: 'Return one.',
  starter: 'const one = () => 0;\n', hints: ['Use a function.'],
  verify: 'tests', estimatedMinutes: 5, tests: [{ call: 'one()', expected: 1 }],
};
const reactTask: PlayableCodingTask = {
  id: 'react-test-submit', track: 'react', level: 1, tier: 1, difficulty: 'easy', focus: ['state'],
  title: 'Test component', prompt: 'Render.',
  starter: 'export default function App() { return null; }', hints: [],
  verify: 'tests', estimatedMinutes: 5, suite: 'test("renders", () => {});',
};

function mount(subject: PlayableCodingTask = task) {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <CodingWorkbench task={subject} session="test-session" locked={null} initialCode={null} signedIn mode="section" />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

// The error bodies api/quiz/roadmap.ts sends, as apiFetch raises them.
for (const [status, code, message, reads] of [
  [413, 'too_large', 'Code is limited to 20 kB', 'Your code is over 20 kB, the most one Submit takes. Shorten it and submit again.'],
  [429, 'rate_limited', 'Too many requests. Try again shortly.', 'Too many requests. Wait a moment and try again.'],
  [403, 'stage_locked', 'Complete earlier stages first', 'Pass the earlier stages of this challenge first.'],
  [503, 'service_unavailable', 'The service is busy.', 'Server error. Try again in a moment.'],
  // The grader's threads could not take the Submit (C1-1): a retry, not a
  // server error, and the learner's own limit, not a rate limit.
  [503, 'grader_busy', 'The checker is busy right now, so this Submit was not recorded. Try again in a few seconds.', 'The checker could not run just now, so this Submit was not recorded. Try again in a moment.'],
  [429, 'grader_busy', 'The checker is busy right now, so this Submit was not recorded. Try again in a few seconds.', 'The checker could not run just now, so this Submit was not recorded. Try again in a moment.'],
  [0, 'network', 'Failed to fetch', 'Network error. Check your connection and try again.'],
] as const) {
  it(`says what a ${status} ${code} on Submit means`, async () => {
    vi.mocked(submitCoding).mockReset();
    vi.mocked(submitCoding).mockRejectedValue(new ApiError(message, status, code));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(reads);
  });
}

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

it('refuses code over 20 kB before sending it', async () => {
  vi.mocked(submitCoding).mockReset();
  mount();
  fireEvent.change(screen.getByLabelText('Test editor'), { target: { value: `const one = () => 1;\n// ${'x'.repeat(21 * 1024)}` } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your code is over 20 kB, the most one Submit takes.');
  expect(submitCoding).not.toHaveBeenCalled();
});

it('shows a React grader outage as a problem to retry, not as a build error or a verdict', async () => {
  vi.mocked(submitCoding).mockReset();
  const outage: CodingVerdictResponse = {
    verdict: 'error', results: [], hidden: null, check: null, logs: [],
    codeError: 'The React runner could not start, so this Submit was not recorded. Try again in a moment.',
    design: null, designReference: null, failureHint: null, puzzle: null, progress: null, firstPass: false,
    xpAwarded: 0, xpForfeited: false, applied: false, github: null, solutions: null, graderUnavailable: true,
  };
  vi.mocked(submitCoding).mockResolvedValue(outage);
  mount(reactTask);
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The checker could not run just now, so this Submit was not recorded. Try again in a moment.');
  expect(screen.queryByText(/Build error/)).toBeNull();
  expect(screen.queryByRole('heading', { level: 3, name: 'Error' })).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).not.toHaveAttribute('aria-disabled'));
});

it('submits React code even when the browser preview never becomes ready', async () => {
  vi.mocked(submitCoding).mockReset();
  vi.mocked(submitCoding).mockResolvedValue({
    verdict: 'passed', results: [{ pass: true, actual: '1', error: null }], hidden: null, check: null, logs: [],
    codeError: null, design: null, designReference: null, failureHint: null, puzzle: null, progress: null,
    firstPass: true, xpAwarded: 0, xpForfeited: false, applied: true, github: null, solutions: null,
  });
  reactPreview.stuck = true;
  try {
    mount(reactTask);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(submitCoding).toHaveBeenCalledWith(expect.objectContaining({ code: reactTask.starter, session: 'test-session' }));
    expect(await screen.findByRole('heading', { level: 3, name: /^Passed/ })).toBeVisible();
  } finally {
    reactPreview.stuck = false;
  }
});
