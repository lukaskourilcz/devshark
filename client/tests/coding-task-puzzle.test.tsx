// Audit C3-4: the server answers an accepted order with verdict "passed" and a
// `puzzle` field, and records no progress. The task page took it for a pass:
// it moved the challenge run on and deleted the device draft, so a learner who
// arranged lines on a phone lost the code written on a laptop.
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import { CodingTaskScreen } from '../src/components/coding/CodingSection';
import type { CodingWorkbenchProps } from '../src/coding/CodingWorkbench';
import type { CodingTaskProgress, CodingVerdictResponse } from '../../shared/coding-api';
import type { PlayableCodingTask } from '../../shared/coding-catalog';

const TASK = 'js-sum-array';
const draft = `devshark:coding:draft:${TASK}`;
const mocks = vi.hoisted(() => ({ advance: vi.fn() }));
vi.mock('../src/lib/auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: 'premium', signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }),
}));
vi.mock('../src/coding/api', () => {
  const task = {
    id: 'js-sum-array', track: 'javascript', level: 1, tier: 1, difficulty: 'easy', focus: ['for'],
    title: 'Sum an array', prompt: 'Sum it.',
    starter: 'const sum = () => 0;\n', hints: [], verify: 'tests', estimatedMinutes: 5, tests: [],
  } satisfies PlayableCodingTask;
  return {
    codingKeys: { task: (id: string) => ['task', id], progress: () => ['progress'] },
    saveCodingDraft: vi.fn(() => new Promise(() => {})),
    useCodingProgress: () => ({ data: { tasks: {}, due: [], javascriptLevelsCleared: 0 }, isLoading: false, isError: false, refetch: () => {} }),
    useCodingTask: () => ({ data: { task, session: 'S', locked: null, progress: null, draft: null, signedIn: true }, isLoading: false, isError: false, refetch: () => {} }),
  };
});
vi.mock('../src/coding/practice', () => ({
  bookmarksQuery: { queryKey: ['bookmarks'] },
  practiceSessionQuery: { queryKey: ['session'] },
  useBookmarks: () => ({ data: { saved: [] }, isError: false, isPending: false }),
  useSaveChallenge: () => ({ mutate: vi.fn(), isError: false, isPending: false }),
  usePracticeSession: () => ({
    data: { session: { sessionId: 'run-1', minutes: 10, topic: 'javascript', queue: ['js-sum-array', 'js-digit-sum'], position: 0, order: 'sequential', status: 'active', scheduledFor: null, estimatedMinutes: 10 } },
  }),
  useAdvanceSession: () => ({ mutate: mocks.advance, isPending: false }),
}));
// The workbench stands in as two buttons that report a verdict the way the
// real one does after Submit.
const progress: CodingTaskProgress = { status: 'passed', passes: 1, reviewStage: 0, nextReviewAt: null, revealCount: 0, bestPassedAt: null };
const base: CodingVerdictResponse = {
  verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null, design: null, designReference: null,
  failureHint: null, puzzle: null, progress: null, firstPass: false, xpAwarded: 0, xpForfeited: false, applied: false, github: null, solutions: null,
};
const passed = { ...base, progress, firstPass: true, xpAwarded: 25, applied: true };
const submitted = 'const sum = (list) => list.reduce((a, b) => a + b, 0);';
vi.mock('../src/coding/CodingWorkbench', () => ({
  CodingWorkbench: ({ onVerdict }: Pick<CodingWorkbenchProps, 'onVerdict'>) => (
    <>
      <button type="button" onClick={() => onVerdict?.({ ...base, puzzle: { accepted: true, competencies: ['sequence'], claim: 'Arranged.' } })}>Accepted order</button>
      <button type="button" onClick={() => onVerdict?.(passed, submitted)}>Real pass</button>
      <button type="button" onClick={() => onVerdict?.(passed, submitted, true)}>Pass for earlier code</button>
    </>
  ),
}));

beforeEach(() => { mocks.advance.mockClear(); });

const mount = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[`/coding/javascript/${TASK}`]}>
      <LanguageProvider>
        <Routes><Route path="/coding/:track/:taskId" element={<CodingTaskScreen />} /></Routes>
      </LanguageProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

it('keeps the challenge run and the device draft where they were after an accepted order', async () => {
  localStorage.setItem(draft, 'const sum = (list) => { /* written on the laptop */ };');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Accepted order' }));
  expect(mocks.advance).not.toHaveBeenCalled();
  expect(localStorage.getItem(draft)).toBe('const sum = (list) => { /* written on the laptop */ };');
});

it('moves the run on and lets the device draft go after a real pass', async () => {
  localStorage.setItem(draft, 'const sum = (list) => { /* written on the laptop */ };');
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Real pass' }));
  expect(mocks.advance).toHaveBeenCalledWith({ sessionId: 'run-1', position: 1 });
  expect(localStorage.getItem(draft)).toBeNull();
});

it('moves the run on and keeps the newer device draft after a pass for earlier code', async () => {
  const newer = 'const sum = (list) => { /* still editing */ };';
  localStorage.setItem(draft, newer);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Pass for earlier code' }));
  expect(mocks.advance).toHaveBeenCalledWith({ sessionId: 'run-1', position: 1 });
  expect(localStorage.getItem(draft)).toBe(newer);
});
