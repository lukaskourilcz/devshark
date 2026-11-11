// From migration 048 a finished Learn level and a recorded coding pass are
// streak days too, so both mark the Profile's cached stats stale. Challenge
// applies this after account reconciliation, covered in challenge-run.test.tsx.
import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { queryClient } from '../src/lib/queryClient';
import { profileStatsQueryKey } from '../src/lib/queries';
import { completeRoadmapAttempt } from '../src/lib/roadmap';
import { submitCoding } from '../src/coding/api';
import type { CodingVerdictResponse } from '../../shared/coding-api';
import { server } from './mocks/server';

const KEY = profileStatsQueryKey('user-streak-sources-1');
const stale = () => queryClient.getQueryState(KEY)?.isInvalidated === true;

const verdict = (over: Partial<CodingVerdictResponse>): CodingVerdictResponse => ({
  verdict: 'passed', results: [], hidden: null, check: null, logs: [], codeError: null,
  design: null, designReference: null, failureHint: null, puzzle: null, progress: null,
  firstPass: false, xpAwarded: 0, xpForfeited: false, applied: true, github: null, solutions: null, ...over,
});

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(KEY, { current_streak: 5, last_quiz_date: '2026-09-28' });
});

describe('a streak day outside the quiz', () => {
  it('a finished Learn level, passed or not', async () => {
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json({ correctAnswers: 1, totalQuestions: 2, percentage: 50, passed: false, applied: true })));
    await completeRoadmapAttempt('learn-session');
    expect(stale()).toBe(true);
  });

  it('not a Learn completion that was already recorded', async () => {
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json({ correctAnswers: 2, totalQuestions: 2, percentage: 100, passed: true, applied: false })));
    await completeRoadmapAttempt('learn-session');
    expect(stale()).toBe(false);
  });

  it('a recorded coding pass, and not a failed run or a replay', async () => {
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json(verdict({ verdict: 'failed' }))));
    await submitCoding({ session: 'coding-session', code: 'x' });
    expect(stale()).toBe(false);
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json(verdict({ applied: false }))));
    await submitCoding({ session: 'coding-session', code: 'x' });
    expect(stale()).toBe(false);
    server.use(http.post('*/api/quiz/roadmap', () => HttpResponse.json(verdict({}))));
    await submitCoding({ session: 'coding-session', code: 'x' });
    expect(stale()).toBe(true);
  });

});
