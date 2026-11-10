// The learning-path workspace: one attempt takes one result, a check is
// retried as a new attempt, switching activities starts clean, and a draft
// autosave never argues with itself.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { ApiError } from '../src/lib/api';
import { announceVerifiedQuestXp, syncXpWithServer } from '../src/lib/xp';
import { loadEditor } from '../src/coding/loadEditor';

const A = 'fde-v1-m01-linear-accumulator';
const B = 'fde-v1-m01-halving-counter';
const C = 'fde-v1-m01-checks';
const ENROLLMENT = 'ENROLL0000000000aaaa';
const summary = (id: string, title: string, kind = 'code') => ({
  id, kind, purpose: 'exercise', verification: 'machine_verified', title: title, summary: `${title} summary`,
  competencies: [], estimatedMinutes: 5, ...(kind === 'code' ? { language: 'javascript' } : {}),
});
const manifest = {
  id: 'fde', kind: 'role_specialization', version: 1, title: 'FDE', summary: '', outcomes: [], nonGoals: [],
  entryRequirement: '', competencies: [], bridges: [], rubric: { version: 1, dimensions: [] }, diagnosticActivityId: null,
  estimatedHours: { min: 1, max: 2 }, sources: [], reviewedOn: '2026-01-01', completionLabel: 'done',
  modules: [{
    id: 'fde-v1-m01', title: 'M01', outcomes: [], competencies: [], dependsOn: [], lessons: [],
    activities: [summary(C, 'The check', 'check'), summary(A, 'Activity A'), summary(B, 'Activity B')],
    requires: [{ activityId: C, state: 'verified_pass' }, { activityId: A, state: 'verified_pass' }, { activityId: B, state: 'verified_pass' }],
    estimatedMinutes: 10,
  }, {
    // An optional module: the server never completes it.
    id: 'fde-v1-x01', title: 'Placement', outcomes: [], competencies: [], dependsOn: [], lessons: [], optional: true,
    activities: [summary('fde-v1-x01-check', 'Placement check', 'check')], requires: [], estimatedMinutes: 5,
  }],
};

const calls = vi.hoisted(() => ({
  start: [] as string[],
  startSignals: [] as (AbortSignal | undefined)[],
  startDelay: 0,
  startExpired: false,
  startFailures: [] as unknown[],
  submit: [] as Record<string, unknown>[],
  drafts: [] as { expected: number; code: unknown; activityId: string }[],
  serverRevision: 0,
  draftDelay: 0,
  inFlight: 0,
  mostInFlight: 0,
  serverDraft: null as null | { activityId: string; revision: number; content: Record<string, unknown>; updatedAt: string },
  draftUnavailable: false,
  next: null as string | null,
  submitFailures: [] as unknown[],
  submitDelay: 0,
  codePassed: false,
  replayed: false,
  changedOnRenewal: false,
  scenario: undefined as string | undefined,
  fixtureNote: undefined as string | undefined,
  progress: undefined as undefined | { modules: { moduleId: string; completed: boolean; activities: { activityId: string; state: string }[] }[] },
}));
vi.mock('../src/lib/xp', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/xp')>(), announceVerifiedQuestXp: vi.fn(), syncXpWithServer: vi.fn(async () => {}) }));

vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, isAuthenticated: true, isLoading: false }) }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: 'premium', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }),
}));
vi.mock('../src/coding/Editor', () => ({
  Editor: ({ value, onChange, ariaLabel }: { value: string; onChange: (next: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock('../src/lib/learningPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/learningPaths')>();
  const catalog = { isLoading: false, isError: false, data: { paths: [{ manifest, availability: 'available', inventory: {} }], versions: {} }, refetch: () => {} };
  const enrollments = { data: { enrollments: [{ enrollmentId: ENROLLMENT, pathId: 'fde', curriculumVersion: 1, status: 'active', baseTrackAtEnrollment: null, startedAt: '', updatedAt: '' }] } };
  return {
    ...actual,
    usePathCatalog: () => catalog,
    useEnrollments: () => enrollments,
    usePathProgress: () => ({ data: calls.progress }),
    savePathDraft: vi.fn(async (input: { activityId: string; expectedRevision: number; content: Record<string, unknown> }) => {
      calls.drafts.push({ expected: input.expectedRevision, code: input.content.code, activityId: input.activityId });
      calls.inFlight += 1;
      calls.mostInFlight = Math.max(calls.mostInFlight, calls.inFlight);
      if (calls.draftDelay) await new Promise((resolve) => setTimeout(resolve, calls.draftDelay));
      calls.inFlight -= 1;
      if (input.expectedRevision !== calls.serverRevision) {
        throw new ApiError('A newer draft was saved elsewhere. Reload before saving again.', 409, 'draft_conflict');
      }
      calls.serverRevision += 1;
      return { draft: { activityId: input.activityId, revision: calls.serverRevision, content: input.content, updatedAt: '' } };
    }),
    startActivity: vi.fn(async ({ activityId, previousSession }: { activityId: string; previousSession?: string }, signal?: AbortSignal) => {
      calls.start.push(activityId);
      calls.startSignals.push(signal);
      if (calls.startDelay) await new Promise((resolve) => setTimeout(resolve, calls.startDelay));
      const startFailure = calls.startFailures.shift();
      if (startFailure) throw startFailure;
      const base = {
        attemptId: `attempt-${calls.start.length}`,
        ...(previousSession && calls.changedOnRenewal ? { needsBriefReview: true } : {}),
        session: `SESSION_${activityId}_${calls.start.length}`,
        expiresAt: new Date(Date.now() + (calls.startExpired ? -1000 : 3600e3)).toISOString(),
        activity: {
          ...summary(activityId, activityId, activityId === C ? 'check' : 'code'),
          ...(activityId === C && calls.scenario !== undefined ? { scenario: calls.scenario } : {}),
          ...(activityId === A && calls.fixtureNote !== undefined ? { fixtureNote: calls.fixtureNote } : {}),
        },
        purpose: 'exercise',
        draft: activityId === C ? null : calls.serverDraft,
        ...(calls.draftUnavailable ? { draftUnavailable: true } : {}),
        previous: null,
      };
      if (activityId === C) {
        return { ...base, check: { questions: [{ id: 'q1', prompt: 'Which one?', options: ['Left', 'Right'], competencies: [] }], passThreshold: 0.8 } };
      }
      return { ...base, code: { language: 'javascript', prompt: `prompt ${activityId}`, starter: `STARTER_FOR_${activityId}`, hints: [], tests: [] } };
    }),
    submitActivity: vi.fn(async (input: Record<string, unknown>) => {
      calls.submit.push(input);
      if (calls.submitDelay) await new Promise((resolve) => setTimeout(resolve, calls.submitDelay));
      const failure = calls.submitFailures.shift();
      if (failure) throw failure;
      const check = Array.isArray(input.answers);
      return {
        activityId: check ? C : A, state: calls.codePassed ? 'verified_pass' : 'needs_revision', verification: 'machine_verified', score: 0.5, criteria: [],
        questions: check ? [{ questionId: 'q1', correct: false, correctIndex: 1, explanation: 'Because of the right side.' }] : null,
        code: check ? null : { outcome: calls.codePassed ? 'passed' : 'failed', results: [], hidden: null, check: null, logs: [], codeError: null },
        feedback: [], module: null, guidedComplete: false, nextActivityId: calls.next, replayed: calls.replayed, xpAwarded: calls.codePassed ? 25 : 0,
      };
    }),
  };
});

// The screen's code, compiled once up front rather than inside the first
// test's time budget. Imported here, after the fixtures the mocks read.
beforeAll(() => import('../src/components/paths/LearningPathScreens'), 60_000);

// CodeMirror is its own chunk (perf baseline #587 C12): load it before the
// first render, as the task screen and an intent preload do.
beforeAll(async () => { await loadEditor(); });

beforeEach(() => {
  calls.codePassed = false;
  calls.replayed = false;
  vi.mocked(announceVerifiedQuestXp).mockClear();
  vi.mocked(syncXpWithServer).mockClear();
  calls.changedOnRenewal = false;
  calls.start.length = 0;
  calls.startSignals.length = 0;
  calls.startDelay = 0;
  calls.startExpired = false;
  calls.startFailures.length = 0;
  calls.submit.length = 0;
  calls.drafts.length = 0;
  calls.serverRevision = 0;
  calls.draftDelay = 0;
  calls.inFlight = 0;
  calls.mostInFlight = 0;
  calls.serverDraft = null;
  calls.draftUnavailable = false;
  calls.next = null;
  calls.submitFailures.length = 0;
  calls.submitDelay = 0;
  calls.scenario = undefined;
  calls.fixtureNote = undefined;
  calls.progress = undefined;
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

async function mount(activityId: string | null, moduleId = 'fde-v1-m01') {
  // Imported here, after the fixtures above exist: the mocked module reads them.
  const { FdeModule } = await import('../src/components/paths/LearningPathScreens');
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[`/learn/forward-deployed-engineer/path/${moduleId}${activityId ? `?activity=${activityId}` : ''}`]}>
          <LanguageProvider>
            <Routes><Route path="/learn/forward-deployed-engineer/path/:moduleId" element={<FdeModule />} /></Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
const editor = () => screen.getByRole('textbox', { name: 'Your solution' }) as HTMLTextAreaElement;
const type = async (value: string) => {
  await act(async () => { fireEvent.change(editor(), { target: { value } }); });
};
const press = async (name: string | RegExp) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
};
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const status = () => document.querySelector('.cd-workbench--activity .lp-actions__status')?.textContent;

describe('one attempt takes one result', () => {
  it('finishes code with the shared Passed banner and two actions', async () => {
    calls.codePassed = true;
    calls.next = B;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await press('Submit');
    expect(await screen.findByRole('heading', { name: 'Passed +25 XP' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Next task' })).toHaveAttribute('href', expect.stringContaining(B));
    expect(screen.getByRole('link', { name: 'Back to the list' })).toHaveAttribute('href','/learn/forward-deployed-engineer/path/fde-v1-m01');
    expect(screen.queryByRole('textbox', { name: 'Your solution' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Results' })).toBeNull();
    expect(screen.queryByText('Complexity could not be determined')).toBeNull();
  });
  it('a second submission of a graded code exercise opens a fresh attempt with a key of its own', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('attempt one');
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).not.toBeDisabled());
    await type('attempt two, fixed');
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(2));
    expect(calls.start).toEqual([A, A]);
    expect(calls.submit[1].session).not.toBe(calls.submit[0].session);
    expect(calls.submit[1].idempotencyKey).not.toBe(calls.submit[0].idempotencyKey);
    expect(calls.submit[1].code).toBe('attempt two, fixed');
    expect(editor().value).toBe('attempt two, fixed');
  });

  it('a retry after a network failure reuses the attempt and its key, so the server can replay', async () => {
    calls.submitFailures.push(new ApiError('Network error', 0, 'network'));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('attempt one');
    await press('Submit');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network error. Check your connection and try again.'));
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(2));
    expect(calls.start).toEqual([A]);
    expect(calls.submit[1].session).toBe(calls.submit[0].session);
    expect(calls.submit[1].idempotencyKey).toBe(calls.submit[0].idempotencyKey);
  });

  it('reconciles a replayed code reward without announcing it again', async () => {
    calls.submitFailures.push(new ApiError('Network error', 0, 'network'));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('already graded code');
    await press('Submit');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Network error'));
    calls.codePassed = true;
    calls.replayed = true;
    await press('Submit');
    await screen.findByRole('heading', { name: 'Passed +25 XP' });
    expect(calls.submit[1].idempotencyKey).toBe(calls.submit[0].idempotencyKey);
    expect(syncXpWithServer).toHaveBeenCalledWith({ announceRankUp: false });
    expect(announceVerifiedQuestXp).not.toHaveBeenCalled();
  });

  it('a key the server already spent reads as plain copy, and the next submission opens a new attempt', async () => {
    calls.submitFailures.push(new ApiError('That submission key was already used with different work', 409, 'idempotency_conflict'));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await press('Submit');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This attempt already has a result. Try again to start a new one.'));
    expect(screen.queryByText(/submission key/)).toBeNull();
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(2));
    expect(calls.start).toEqual([A, A]);
    expect(calls.submit[1].idempotencyKey).not.toBe(calls.submit[0].idempotencyKey);
  });

  it('when the next thing to do is this activity again, the result offers another attempt, not a link back', async () => {
    calls.next = A;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await press('Submit');
    await waitFor(() => expect(screen.getByText('Result')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Next activity' })).toBeNull();
    await press('Try again');
    expect(screen.queryByText('Result')).toBeNull();
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(2));
    expect(calls.submit[1].session).not.toBe(calls.submit[0].session);
  });

  it('an expired check says so and keeps the answers until Try again', async () => {
    calls.startExpired = true;
    await mount(C);
    await waitFor(() => expect(screen.getByText(/Which one\?/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Left' })); });
    await press('Submit');
    expect(screen.getByRole('alert')).toHaveTextContent('This attempt expired. Try again to start a new one.');
    expect(screen.getByRole('radio', { name: 'Left' })).toBeChecked();
    expect(calls.start).toEqual([C]);
    expect(calls.submit).toHaveLength(0);
    calls.startExpired = false;
    await press('Try again');
    await waitFor(() => expect(calls.start).toEqual([C, C]));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Left' })).not.toBeChecked());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a graded check offers Try again, which deals the check afresh', async () => {
    await mount(C);
    await waitFor(() => expect(screen.getByText(/Which one\?/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Left' })); });
    await press('Submit');
    await waitFor(() => expect(screen.getByText('Because of the right side.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    await press('Try again');
    await waitFor(() => expect(calls.start).toEqual([C, C]));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Left' })).not.toBeChecked());
    expect(screen.queryByText('Because of the right side.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });
});

describe('switching activities', () => {
  it('opens the next code exercise with its own starter, not the previous one\'s code', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('my solution for A');
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    await waitFor(() => expect(screen.getByText(`prompt ${B}`)).toBeInTheDocument());
    expect(calls.start).toEqual([A, B]);
    expect(editor().value).toBe(`STARTER_FOR_${B}`);
    await wait(1100);
    expect(calls.drafts.filter((one) => one.activityId === B && one.code === 'my solution for A')).toHaveLength(0);
  });

  it('saves the last keystrokes to the activity they were typed in when the learner switches within the debounce', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('typed just before switching');
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    await waitFor(() => expect(screen.getByText(`prompt ${B}`)).toBeInTheDocument());
    await waitFor(() => expect(calls.drafts.map((one) => [one.activityId, one.code])).toEqual([[A, 'typed just before switching']]));
    expect(editor().value).toBe(`STARTER_FOR_${B}`);
    expect(status()).not.toBe('Draft saved');
  });

describe('a submission that lands after the learner moved on', () => {
  it('leaves the next activity\'s attempt and screen alone when it is refused', async () => {
    calls.submitDelay = 300;
    calls.submitFailures.push(new ApiError('That submission key was already used with different work', 409, 'idempotency_conflict'));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await press('Submit');
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    await waitFor(() => expect(screen.getByText(`prompt ${B}`)).toBeInTheDocument());
    await wait(400); // A's refusal arrives while B is open
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(2));
    // B's own attempt takes the submission; nothing opened a third one.
    expect(calls.start).toEqual([A, B]);
    expect(calls.submit[1].session).toBe(`SESSION_${B}_2`);
  });

  it('still announces the XP it earned', async () => {
    const { announceVerifiedQuestXp } = await import('../src/lib/xp');
    vi.mocked(announceVerifiedQuestXp).mockClear();
    calls.codePassed = true;
    calls.submitDelay = 300;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await press('Submit');
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    await waitFor(() => expect(screen.getByText(`prompt ${B}`)).toBeInTheDocument());
    await wait(400);
    expect(announceVerifiedQuestXp).toHaveBeenCalledWith(25);
    // A's verdict never reaches B's screen.
    expect(screen.queryByRole('heading', { name: 'Passed +25 XP' })).toBeNull();
  });
});

  it('stops opening an activity the learner already left', async () => {
    calls.startDelay = 300;
    await mount(A);
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    expect(calls.start).toEqual([A, B]);
    expect(calls.startSignals[0]?.aborted).toBe(true);
    expect(calls.startSignals[1]?.aborted).toBe(false);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${B}`));
  });
});

describe('an activity that fails to open', () => {
  it('offers Try again, which opens it, instead of leaving only Close', async () => {
    calls.startFailures.push(new ApiError('Network error', 0, 'network'));
    await mount(A);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByRole('textbox', { name: 'Your solution' })).toBeNull();
    await press('Try again');
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    expect(calls.start).toEqual([A, A]);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('focus', () => {
  it('moves to the result after grading, to the next activity\'s heading, and back to the list on Close', async () => {
    await mount(C);
    await waitFor(() => expect(screen.getByText(/Which one\?/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Left' })); });
    await press('Submit');
    // The check's Submit is gone; focus lands on the verdict, not on nothing.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Result' })));
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Activity B' }));
    await press('Close');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Activities in this module' }));
    // No live region reads the whole activity aloud.
    expect(document.querySelector('.lp-workspace[aria-live]')).toBeNull();
  });
});

describe('the draft autosave', () => {
  it('sends one save at a time with the revision the last one returned, so typing during a save is not a conflict', async () => {
    calls.draftDelay = 1500;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('a');
    await wait(1000); // the first save left at 900 ms and is still on its way
    await type('ab'); // its debounce fires while the first save is in flight
    await wait(3500);
    expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[0, 'a'], [1, 'ab']]);
    expect(calls.mostInFlight).toBe(1);
    expect(status()).toBe('Draft saved');
  }, 15_000);

  it('serializes a draft save when the learner revisits an activity before the first write returns', async () => {
    calls.draftDelay = 1_500;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('first edit in A');
    await press('Close');
    await waitFor(() => expect(calls.drafts).toHaveLength(1));
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity B/ })); });
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${B}`));
    await press('Close');
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity A/ })); });
    await waitFor(() => expect(editor().value).toBe('first edit in A'));
    await type('second edit in A');
    await act(async () => { window.dispatchEvent(new Event('pagehide')); });
    await waitFor(() => expect(calls.drafts).toHaveLength(2), { timeout: 4_000 });
    expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[0, 'first edit in A'], [1, 'second edit in A']]);
    expect(calls.mostInFlight).toBe(1);
    await waitFor(() => expect(status()).toBe('Draft saved'), { timeout: 4_000 });
    expect(editor().value).toBe('second edit in A');
  }, 12_000);

  it('uses a draft confirmed while the reopening response still carries its old read', async () => {
    calls.draftDelay = 750;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('committed while reopening');
    await press('Close');
    await waitFor(() => expect(calls.inFlight).toBe(1));
    // The opening request already read no saved draft before the write commits.
    calls.startDelay = 1_000;
    await act(async () => { fireEvent.click(screen.getByRole('link', { name: /Activity A/ })); });
    await waitFor(() => expect(editor().value).toBe('committed while reopening'), { timeout: 4_000 });
    expect(status()).toBe('Draft saved');
    expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[0, 'committed while reopening']]);
  });

  it('keeps a draft on this device while offline and saves it when the connection is back', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    await type('written offline');
    await wait(1000);
    expect(status()).toBe('Offline. Kept on this device; it will save when you reconnect.');
    expect(calls.drafts).toHaveLength(0);
    expect(localStorage.getItem(`devshark:path:draft:${ENROLLMENT}:${A}`)).toContain('written offline');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(calls.drafts.map((one) => one.code)).toEqual(['written offline']));
    await waitFor(() => expect(status()).toBe('Draft saved'));
    expect(localStorage.getItem(`devshark:path:draft:${ENROLLMENT}:${A}`)).toBeNull();
  });

  it.each(['visibilitychange', 'pagehide'])('keeps the last keystrokes when the browser sends %s before the debounce', async (event) => {
    const key = `devshark:path:draft:${ENROLLMENT}:${A}`;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    await type('typed just before hiding the document');
    expect(localStorage.getItem(key)).toBeNull();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      await act(async () => {
        (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
      });
      expect(localStorage.getItem(key)).toContain('typed just before hiding the document');
      expect(calls.drafts).toHaveLength(0);
    } finally {
      visibility.mockRestore();
    }
  });

  it('sends the last keystrokes when the learner leaves the page before the debounce', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('typed just before leaving');
    expect(calls.drafts).toHaveLength(0);
    await act(async () => { cleanup(); });
    expect(calls.drafts.map((one) => [one.activityId, one.code])).toEqual([[A, 'typed just before leaving']]);
  });

  it('keeps unsaved writing, last keystrokes included, for the account a session sign-out ended, and only for it', async () => {
    const { clearAccountData, forgetOthersKeptDrafts } = await import('../src/lib/accountData');
    const key = `devshark:path:draft:${ENROLLMENT}:${A}`;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    await type('typed as the session ended');
    // The session ends inside the debounce.
    expect(clearAccountData('user-1')).toBe(true);
    expect(localStorage.getItem(key)).toBeNull();
    // Another account signing in deletes it unread.
    const kept = localStorage.getItem('devshark:path:kept:v1');
    forgetOthersKeptDrafts('user-2');
    expect(localStorage.getItem('devshark:path:kept:v1')).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
    // The same account signing in gets it back in place.
    localStorage.setItem('devshark:path:kept:v1', kept ?? '');
    forgetOthersKeptDrafts('user-1');
    expect(localStorage.getItem('devshark:path:kept:v1')).toBeNull();
    expect(localStorage.getItem(key)).toContain('typed as the session ended');
    // A sign-out the learner chose keeps nothing.
    expect(clearAccountData()).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem('devshark:path:kept:v1')).toBeNull();
  });

  it('writes and sends nothing for the account a chosen sign-out ended, even when a save was in flight', async () => {
    const { clearAccountData } = await import('../src/lib/accountData');
    const key = `devshark:path:draft:${ENROLLMENT}:${A}`;
    calls.draftDelay = 500;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('saved before');
    // The debounce has sent it; the save is still on its way.
    await wait(950);
    expect(calls.inFlight).toBe(1);
    await type('typed as they signed out');
    expect(clearAccountData()).toBe(false);
    expect(localStorage.getItem(key)).toBeNull();
    // The save in flight lands after the sign-out: nothing of that account
    // comes back into this browser, and nothing more goes out for it.
    await wait(700);
    expect(localStorage.getItem(key)).toBeNull();
    await wait(800);
    expect(localStorage.getItem(key)).toBeNull();
    expect(calls.drafts.map((one) => one.code)).toEqual(['saved before']);
  }, 15_000);

  it('asks before Reset replaces the learner\'s code, and saves nothing over the draft until they confirm', async () => {
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await type('my work');
    await wait(1000);
    expect(calls.drafts.map((one) => one.code)).toEqual(['my work']);
    await press('Reset to the starter');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Replace your code with the starter?');
    expect(screen.getByRole('button', { name: 'Keep my code' })).toHaveFocus();
    await press('Keep my code');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset to the starter' })).toHaveFocus();
    expect(editor().value).toBe('my work');
    await press('Reset to the starter');
    await act(async () => { fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' }); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(editor().value).toBe('my work');
    await wait(1000);
    expect(calls.drafts.map((one) => one.code)).toEqual(['my work']);
    await press('Reset to the starter');
    await press('Reset');
    expect(editor().value).toBe(`STARTER_FOR_${A}`);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset to the starter' })).toHaveFocus();
    await wait(1000);
    expect(calls.drafts.map((one) => one.code)).toEqual(['my work', `STARTER_FOR_${A}`]);
  }, 15_000);

  it('opens with the copy kept on this device when the server has nothing newer, and saves it', async () => {
    localStorage.setItem(`devshark:path:draft:${ENROLLMENT}:${A}`, JSON.stringify({ baseRevision: 0, content: { code: 'kept from last time' } }));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe('kept from last time'));
    await waitFor(() => expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[0, 'kept from last time']]));
  });

  it('drops a copy on this device that is not a draft, rather than sending it', async () => {
    localStorage.setItem(`devshark:path:draft:${ENROLLMENT}:${A}`, JSON.stringify({ baseRevision: 0, content: { code: 42 } }));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    await wait(50);
    expect(calls.drafts).toHaveLength(0);
    expect(localStorage.getItem(`devshark:path:draft:${ENROLLMENT}:${A}`)).toBeNull();
  });

  it('keeps the copy on this device when the server could not read its draft', async () => {
    localStorage.setItem(`devshark:path:draft:${ENROLLMENT}:${A}`, JSON.stringify({ baseRevision: 3, content: { code: 'unsaved, from here' } }));
    calls.draftUnavailable = true;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe('unsaved, from here'));
    expect(localStorage.getItem(`devshark:path:draft:${ENROLLMENT}:${A}`)).toContain('unsaved, from here');
    await waitFor(() => expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[3, 'unsaved, from here']]));
  });

  it('keeps newer unsent edits when the preceding save reached the server but its response was lost', async () => {
    const key = `devshark:path:draft:${ENROLLMENT}:${A}`;
    localStorage.setItem(key, JSON.stringify({ baseRevision: 1, content: { code: 'newer unsent work' } }));
    calls.serverRevision = 2;
    calls.serverDraft = { activityId: A, revision: 2, content: { code: 'earlier save from this device' }, updatedAt: '' };
    await mount(A);
    await waitFor(() => expect(editor().value).toBe('newer unsent work'));
    expect(status()).toContain('kept on this device');
    expect(calls.drafts).toHaveLength(0);
    await type('more unsent work');
    await waitFor(() => expect(localStorage.getItem(key)).toContain('more unsent work'));
    expect(calls.drafts).toHaveLength(0);
    await act(async () => { cleanup(); });
    await mount(A);
    await waitFor(() => expect(editor().value).toBe('more unsent work'));
    expect(calls.drafts).toHaveLength(0);
  });

  it('restores an unsent draft when the account no longer holds one', async () => {
    const key = `devshark:path:draft:${ENROLLMENT}:${A}`;
    localStorage.setItem(key, JSON.stringify({ baseRevision: 3, content: { code: 'unsent after retention' } }));
    await mount(A);
    await waitFor(() => expect(editor().value).toBe('unsent after retention'));
    await waitFor(() => expect(calls.drafts.map((one) => [one.expected, one.code])).toEqual([[0, 'unsent after retention']]));
  });
});


it('refreshes a changed code brief without submitting or clearing the draft', async () => {
  calls.submitFailures.push(new ApiError('This activity changed while you were working.', 409, 'task_changed'));
  await mount(A);
  await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
  await type('keep this draft');
  await press('Submit');
  await screen.findByRole('button', { name: 'Load latest brief' });
  // Submit is the frame's SwimCta: unavailable (focusable, aria-disabled)
  // until the latest brief is loaded, and a press sends nothing.
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('aria-disabled', 'true');
  await press('Submit');
  expect(calls.submit).toHaveLength(1);
  expect(calls.start).toEqual([A]);
  expect(editor().value).toBe('keep this draft');
  await press('Load latest brief');
  await waitFor(() => expect(calls.start).toEqual([A, A]));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load latest brief' })).toBeNull());
  expect(calls.submit).toHaveLength(1);
  expect(editor().value).toBe('keep this draft');
  await press('Submit');
  await waitFor(() => expect(calls.submit).toHaveLength(2));
  expect(calls.submit[1].session).not.toBe(calls.submit[0].session);
  expect(calls.submit[1].code).toBe('keep this draft');
});


it('shows a renewed changed brief before grading a second code submission', async () => {
  await mount(A);
  await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
  await type('first submission');
  await press('Submit');
  await waitFor(() => expect(calls.submit).toHaveLength(1));
  calls.changedOnRenewal = true;
  await type('keep the correction');
  await press('Submit');
  await screen.findByRole('button', { name: 'Load latest brief' });
  expect(calls.start).toEqual([A, A]);
  expect(calls.submit).toHaveLength(1);
  expect(editor().value).toBe('keep the correction');
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('aria-disabled', 'true');
  await press('Submit');
  expect(calls.submit).toHaveLength(1);
  await press('Load latest brief');
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Load latest brief' })).toBeNull());
  expect(calls.submit).toHaveLength(1);
  await press('Submit');
  await waitFor(() => expect(calls.submit).toHaveLength(2));
  expect(calls.submit[1].code).toBe('keep the correction');
});

describe('the content shapes of #497', () => {
  const scenarioRegion = () => screen.queryAllByRole('region', { name: 'The scenario' });
  const NOTE_FIRST = 'The starter is a trimmed copy of a customer script.';

  it('shows a check\'s scenario once while answering, after Submit and after Try again', async () => {
    calls.scenario = 'A support lead says the export is wrong.\n\nAnswer in order.';
    await mount(C);
    await waitFor(() => expect(screen.getByText(/Which one\?/)).toBeInTheDocument());
    expect(scenarioRegion()).toHaveLength(1);
    expect(screen.getAllByText('A support lead says the export is wrong.')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Left' })); });
    await press('Submit');
    await waitFor(() => expect(screen.getByText('Because of the right side.')).toBeInTheDocument());
    expect(scenarioRegion()).toHaveLength(1);
    await press('Try again');
    await waitFor(() => expect(calls.start).toEqual([C, C]));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Left' })).not.toBeChecked());
    expect(scenarioRegion()).toHaveLength(1);
  });

  it('shows the fixture note above the editor, and keeps it after a failed submit', async () => {
    calls.fixtureNote = `${NOTE_FIRST}\n\nYou are done when the visible tests pass.`;
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    const label = screen.getByText('Before you start');
    const note = screen.getByText(NOTE_FIRST);
    expect(screen.getByRole('tabpanel', { name: 'Description' })).toContainElement(label);
    expect(screen.getByRole('tabpanel', { name: 'Description' })).toContainElement(note);
    await type('an attempt');
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled());
    expect(screen.getByText(NOTE_FIRST)).toBeInTheDocument();
  });

  it('shows the changed note after Load latest brief', async () => {
    calls.fixtureNote = 'The first note.';
    await mount(A);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${A}`));
    expect(screen.getByText('The first note.')).toBeInTheDocument();
    await type('first submission');
    await press('Submit');
    await waitFor(() => expect(calls.submit).toHaveLength(1));
    calls.changedOnRenewal = true;
    calls.fixtureNote = 'The revised note.';
    await type('keep the correction');
    await press('Submit');
    await screen.findByRole('button', { name: 'Load latest brief' });
    await press('Load latest brief');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load latest brief' })).toBeNull());
    expect(screen.getByText('The revised note.')).toBeInTheDocument();
    expect(screen.queryByText('The first note.')).toBeNull();
  });

  it('shows no note on a code activity without one', async () => {
    await mount(B);
    await waitFor(() => expect(editor().value).toBe(`STARTER_FOR_${B}`));
    expect(screen.queryByText('Before you start')).toBeNull();
  });

  it('labels an optional module Optional in its header, and a loop module In progress', async () => {
    await mount(null, 'fde-v1-x01');
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Placement' })).toBeInTheDocument());
    expect(document.querySelector('.lp-head__kicker-row .lp-head__status')?.textContent).toBe('Optional');
  });

  it('labels a loop module by its evidence, never Optional: Not started before any (B14, #510)', async () => {
    await mount(null);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'M01' })).toBeInTheDocument());
    expect(document.querySelector('.lp-head__kicker-row .lp-head__status')?.textContent).toBe('Not started');
  });
});

// UX audit learn-13: the module page's one primary opens the first activity
// that is neither passed nor self-reviewed, and its row carries the accent edge.
describe('the module page primary', () => {
  const recorded = (states: Record<string, string>) => {
    calls.progress = { modules: [{ moduleId: 'fde-v1-m01', completed: false, activities: Object.entries(states).map(([activityId, state]) => ({ activityId, state })) }] };
  };
  const cta = () => document.querySelector('.lp-head__actions .ss-swim-cta') as HTMLButtonElement | null;

  it('waits for recorded progress, holding the row, before it names a target', async () => {
    await mount(null);
    await screen.findByRole('heading', { level: 1, name: 'M01' });
    // Without progress a learner part-way through would read 'Start module'
    // aimed at the first row; the empty row keeps its place instead.
    expect(cta()).toBeNull();
    expect(document.querySelector('.lp-head__actions')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.lp-activity--next')).toBeNull();
  });

  it('says Start module before anything is recorded, marks the first row and opens it', async () => {
    recorded({});
    await mount(null);
    await waitFor(() => expect(cta()).not.toBeNull());
    expect(document.querySelector('.lp-head__actions')).not.toHaveAttribute('aria-busy');
    expect(cta()).not.toHaveAttribute('aria-describedby');
    expect(cta()).toHaveAccessibleName('Start module');
    expect(document.querySelectorAll('.lp-page .ss-swim-cta')).toHaveLength(1);
    const next = document.querySelector('.lp-activity--next') as HTMLElement;
    expect(next).toHaveTextContent('The check');
    expect(document.querySelectorAll('.lp-activity--next')).toHaveLength(1);
    await act(async () => { fireEvent.click(cta()!); });
    await waitFor(() => expect(calls.start).toEqual([C]));
    // The open activity carries its own primary; the header's goes.
    expect(cta()).toBeNull();
  });

  it('continues at the first activity not yet passed or self-reviewed', async () => {
    recorded({ [C]: 'verified_pass', [A]: 'needs_revision' });
    await mount(null);
    await waitFor(() => expect(cta()).toHaveAccessibleName('Continue: Activity A'));
    expect(document.querySelector('.lp-activity--next')).toHaveTextContent('Activity A');
    expect(document.querySelector('.lp-head__status')).toHaveTextContent('In progress');
  });

  it('cuts a long next title at 32 characters', async () => {
    const activity = manifest.modules[0].activities[2];
    const title = activity.title;
    activity.title = 'Write the incident handoff for the on-call engineer';
    try {
      recorded({ [C]: 'verified_pass', [A]: 'self_reviewed' });
      await mount(null);
      await waitFor(() => expect(cta()).not.toBeNull());
      const label = cta()!.textContent!.replace(/^Continue: /, '');
      expect(label).toBe('Write the incident handoff for…');
      expect(label.length).toBeLessThanOrEqual(32);
      // The whole title is read from the marked row it describes.
      expect(cta()).toHaveAccessibleDescription('Write the incident handoff for the on-call engineer');
    } finally {
      activity.title = title;
    }
  });

  it('offers no primary once every activity is passed or self-reviewed', async () => {
    recorded({ [C]: 'verified_pass', [A]: 'verified_pass', [B]: 'self_reviewed' });
    await mount(null);
    await screen.findByRole('heading', { level: 1, name: 'M01' });
    expect(cta()).toBeNull();
    expect(document.querySelector('.lp-head__actions')).toBeNull();
    expect(document.querySelector('.lp-activity--next')).toBeNull();
  });
});

describe('the hint ladder', () => {
  it('moves focus to each revealed hint, so the last press does not drop it', async () => {
    const { CodeActivity } = await import('../src/components/paths/ActivityViews');
    render(
      <LanguageProvider>
        <CodeActivity code={{ language: 'javascript', prompt: 'Sum it.', starter: '', hints: ['Start at zero.'], approach: ['Add each value.'], tests: [] } as never}
          draft={null} result={null} onSubmit={() => {}} onDraft={() => {}} draftStatus="idle" busy={false} />
      </LanguageProvider>,
    );
    await press('Hint');
    expect(document.activeElement?.tagName).toBe('LI');
    expect(document.activeElement).toHaveTextContent('Start at zero.');
    await press('Hint');
    expect(screen.getByRole('button', { name: 'Hint' })).toBeVisible();
    expect(document.activeElement?.tagName).toBe('LI');
    expect(document.activeElement).toHaveTextContent('Add each value.');
  });
});
