// Learn and Today follow what the server enforces: the learner's plan, the
// account's verified record and unlocks, and the life of a level's session.
// Each screen is rendered with invented fixtures in the real response shapes.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import Today from '../src/components/Today';
import Roadmap from '../src/components/Roadmap';
import RoadmapTree from '../src/components/RoadmapTree';
import CareerRoadmap from '../src/components/CareerRoadmap';
import {
  completeRoadmapAttempt,
  getExtraUnlocks,
  getRoadmapProgress,
  recordLevelResult,
  syncProgressWithServer,
  unlockExtraTopics,
} from '../src/lib/roadmap';
import { closeUpgradeSheet, useUpgradeRequest } from '../src/lib/upgradeSheet';
import { clearAccountData } from '../src/lib/accountData';
import { setTrackValue } from '../src/lib/tracks';
import { masteryDayKey } from '../../shared/mastery';
import type { RoadmapStructure } from '../src/types/quiz';
import { server } from './mocks/server';

const auth = vi.hoisted(() => ({
  value: { user: null as null | Record<string, unknown>, isAuthenticated: false, isLoading: false, signInWithGoogle: async () => {} },
}));
vi.mock('../src/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/auth')>()), useAuth: () => auth.value }));

// The /roadmap track switch saves the plan through this one writer.
const saves = vi.hoisted(() => ({ calls: [] as unknown[][], hold: null as null | Promise<void> }));
vi.mock('../src/lib/trackPref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/trackPref')>()),
  saveLearningPreference: async (...args: unknown[]) => {
    saves.calls.push(args);
    if (saves.hold) await saves.hold;
    return { ok: true, preference: args[1] };
  },
}));

// The editor is not what these tests are about: a stand-in that finishes the
// task the way the real workbench's Continue does, shows the solution the
// way its reveal does, says which code it opened with, and saves code the way
// Run does.
vi.mock('../src/coding/CodingWorkbench', async () => {
  const { createElement, useState } = await import('react');
  return {
    CodingWorkbench: ({ onContinue, onRevealed, initialCode, onDraft, onEdit }: { onContinue: () => void; onRevealed?: () => void; initialCode?: string | null; onDraft?: (code: string) => void; onEdit?: (code: string) => void }) => {
      const [solution, setSolution] = useState<string | null>(null);
      return createElement('div', null,
        createElement('output', { 'aria-label': 'Opened with' }, initialCode ?? 'the starter'),
        createElement('button', { type: 'button', onClick: () => onEdit?.('// typed in the level, not run') }, 'Type in the editor'),
        createElement('button', { type: 'button', onClick: () => onDraft?.('// written in the level') }, 'Run the code'),
        createElement('button', { type: 'button', onClick: onContinue }, 'Finish the coding task'),
        createElement('button', { type: 'button', onClick: () => { setSolution('const digitSum = (n) => 42; // the reference'); onRevealed?.(); } }, 'Show the solution'),
        solution && createElement('pre', null, solution));
    },
  };
});

const BACKEND = { schemaVersion: 1, baseTrack: 'backend', specialization: null };
const signInAs = (preference: unknown = null) => {
  auth.value = {
    ...auth.value,
    user: { id: 'user-1', user_metadata: preference ? { devquiz_learning_preference_v1: preference } : {} },
    isAuthenticated: true,
  };
};
afterEach(() => {
  auth.value = { ...auth.value, user: null, isAuthenticated: false };
  saves.calls.length = 0;
  saves.hold = null;
  closeUpgradeSheet();
  setTrackValue('fullstack');
});

beforeAll(() => {
  // The Learn map measures its canvas; jsdom has no layout to measure.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});

const TODAY = masteryDayKey();
const DAYS_AGO = (n: number) => masteryDayKey(new Date(Date.now() - n * 86_400_000));
const level = (n: number) => ({ level: n, title: `Level ${n} title`, difficulty: 1 as const, questionCount: 8 });
const levels = (count: number) => Array.from({ length: count }, (_, i) => level(i + 1));
const STRUCTURE = {
  topics: ['javascript', 'html', 'css', 'git'],
  structure: {
    javascript: { levels: levels(25), checkpoints: [] },
    html: { levels: levels(6), checkpoints: [] },
    css: { levels: levels(6), checkpoints: [] },
    git: { levels: levels(15), checkpoints: [] },
  },
} as unknown as RoadmapStructure;
const FREE = { tier: 'free', source: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, inGrace: false, validUntil: null };
/** A mastered level passed on three earlier days: nothing due, nothing done today. */
const MASTERED = { passed: true, bestPct: 100, passDays: [DAYS_AGO(20), DAYS_AGO(15), DAYS_AGO(10)], mastered: true, masteredAt: DAYS_AGO(10), lastPassDay: DAYS_AGO(10) };
const QUESTION = { id: 'q-1', tags: [], introduction: '', question: 'Which option is first?', options: ['Option A', 'Option B'], category: 'javascript', difficulty: 1 };
const PLAYABLE = { kind: 'level', topic: 'javascript', ref: 1, title: 'Level 1 title', passPct: 75, sessionId: 'session-1', questions: [QUESTION] };

interface Answers {
  progress?: unknown;
  unlocked?: string[];
  playable?: unknown;
  answer?: () => Response;
  complete?: () => Response;
  placement?: unknown;
  skillCheck?: () => Response;
  structure?: unknown;
}
/** Every read and write the Learn screens make; counts the level fetches. */
function answer(options: Answers = {}) {
  const seen = { levelFetches: 0, skillChecks: 0 };
  server.use(
    http.get('*/api/quiz/roadmap', ({ request }) => {
      const params = new URL(request.url).searchParams;
      const resource = params.get('resource');
      if (resource === 'progress') return HttpResponse.json({ data: options.progress ?? {}, extra: { unlocked: options.unlocked ?? [] } });
      if (resource === 'placement') return HttpResponse.json(options.placement as never);
      if (resource === 'learning-path-catalog') return HttpResponse.json({ versions: {}, paths: [] });
      if (params.get('level')) {
        seen.levelFetches += 1;
        return HttpResponse.json((options.playable ?? PLAYABLE) as never);
      }
      return HttpResponse.json((options.structure ?? STRUCTURE) as never);
    }),
    http.post('*/api/quiz/roadmap', ({ request }) => {
      const resource = new URL(request.url).searchParams.get('resource');
      if (resource === 'answer') return options.answer?.() ?? HttpResponse.json({ selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'Because it is first.' });
      if (resource === 'complete') return options.complete?.() ?? HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: true, applied: true, codingPending: [] });
      if (resource === 'skill-check') {
        seen.skillChecks += 1;
        return options.skillCheck?.() ?? HttpResponse.json({ applied: true, unlocked: [] });
      }
      return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
    }),
    http.get('*/api/user/*', ({ request }) => new URL(request.url).searchParams.get('op') === 'entitlement'
      ? HttpResponse.json(FREE)
      : HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
    // Anything else these screens touch (XP, the wallet): not part of the test.
    http.all('*/api/*', () => HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })),
  );
  return seen;
}

let visits = 0;
async function mountAt(path: string, page: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await act(async () => render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: path, key: `learn-visit-${++visits}` }]}>
        <LanguageProvider>{page}</LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await screen.findByRole('heading', { level: 1 });
}

describe('the plan', () => {
  it('keeps Today to the topics of a signed-in learner’s track', async () => {
    signInAs(BACKEND);
    answer();
    await mountAt('/today', <Today />);
    expect(await screen.findByText('JavaScript · Level 1')).toBeInTheDocument();
    expect(screen.queryByText('HTML · Level 1')).toBeNull();
    expect(screen.queryByText('CSS · Level 1')).toBeNull();
  });

  it('leaves a visitor’s Today as it was', async () => {
    answer();
    await mountAt('/today', <Today />);
    expect(await screen.findByText('HTML · Level 1')).toBeInTheDocument();
  });

  it('keeps a review of a level passed outside the track', async () => {
    signInAs(BACKEND);
    answer({ progress: { html: { levels: { '1': { passed: true, bestPct: 90, passDays: [DAYS_AGO(2)], mastered: false, lastPassDay: DAYS_AGO(2) } }, checkpoints: {} } } });
    await mountAt('/today', <Today />);
    expect(await screen.findByText('HTML · Level 1')).toBeInTheDocument();
    expect(screen.getByText('Due for review')).toBeInTheDocument();
    expect(screen.queryByText('HTML · Level 2')).toBeNull();
  });

  it('lists only the track’s topics on the Learn rail, and a topic with passed levels', async () => {
    signInAs(BACKEND);
    answer();
    await mountAt('/learn', <Roadmap />);
    expect(await screen.findByRole('radio', { name: /^JavaScript/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^HTML/ })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^CSS/ })).toBeNull();
  });

  it('keeps a topic with passed levels on the rail outside the track', async () => {
    signInAs(BACKEND);
    answer({ progress: { html: { levels: { '1': MASTERED }, checkpoints: {} } } });
    await mountAt('/learn', <Roadmap />);
    expect(await screen.findByRole('radio', { name: /^HTML/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /^CSS/ })).toBeNull();
  });

  it('lists every topic for a visitor', async () => {
    answer();
    await mountAt('/learn', <Roadmap />);
    expect(await screen.findByRole('radio', { name: /^HTML/ })).toBeInTheDocument();
  });

  it('draws only the track’s topics in the roadmap tree', async () => {
    signInAs(BACKEND);
    answer();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><RoadmapTree structure={STRUCTURE} track="fullstack" /></LanguageProvider></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.queryByText('HTML')).toBeNull();
  });

  it('saves the /roadmap track to the account when signed in', async () => {
    signInAs(BACKEND);
    answer();
    await mountAt('/roadmap', <CareerRoadmap />);
    fireEvent.click(screen.getByRole('radio', { name: 'Frontend' }));
    await waitFor(() => expect(saves.calls).toHaveLength(1));
    expect(saves.calls[0][0]).toBe('user-1');
    expect(saves.calls[0][1]).toMatchObject({ baseTrack: 'frontend', specialization: null });
    expect(await screen.findByText('Saved: Frontend')).toBeInTheDocument();
  });

  // The headline counted only the curated pillar areas, so Git, which every
  // track holds and the map draws, was left out: 0 / 37 instead of 0 / 52.
  it('counts every topic of the chosen track in the /roadmap headline', async () => {
    answer();
    await mountAt('/roadmap', <CareerRoadmap />);
    expect(await screen.findByText('0 / 52 learning-path levels passed')).toBeInTheDocument();
  });

  // The track was named three times and the same topics were listed under
  // every section that holds them (UX audit learn-16).
  it('names the /roadmap track once and lists each topic once, under the first section that holds it', async () => {
    answer();
    await mountAt('/roadmap', <CareerRoadmap />);
    await screen.findByText('0 / 52 learning-path levels passed');
    // The segment is the one track label: no badge, no "on the Fullstack track".
    expect(screen.getAllByText('Fullstack')).toHaveLength(1);
    expect(screen.queryByText(/Choose Frontend, Backend or Fullstack/)).toBeNull();
    const labels = [...document.querySelectorAll('.career-topic__label')].map((label) => label.textContent);
    expect(labels).toContain('Git');
    expect(new Set(labels).size).toBe(labels.length);
    const git = [...document.querySelectorAll('.career-topic')].find((row) => row.querySelector('.career-topic__label')?.textContent === 'Git')!;
    expect(git.closest('section')).toHaveAttribute('aria-labelledby', 'career-web-developer');
    expect(git).toHaveTextContent('Also in: Software Engineer');
    // "Also in" is a meta line in the name's column, not a pill that runs
    // under the bar and the count.
    expect(git.querySelector('.career-topic__name > .career-topic__also')).toHaveTextContent('Also in: Software Engineer');
    expect(git.querySelector('.ss-tag')).toBeNull();
    // The groups size to their content, one panel per section.
    expect(document.querySelectorAll('section .ss-panel.career-pillars').length).toBeGreaterThan(0);
  });

  // Math.round drew 199 of 200 levels as a finished, green 100%.
  it('shows 100% on /roadmap only once every level is passed', async () => {
    signInAs(BACKEND);
    const passed = Object.fromEntries(Array.from({ length: 199 }, (_, i) => [String(i + 1), MASTERED]));
    answer({
      structure: { topics: ['javascript'], structure: { javascript: { levels: levels(200), checkpoints: [] } } },
      progress: { javascript: { levels: passed, checkpoints: {} } },
    });
    await mountAt('/roadmap', <CareerRoadmap />);
    expect(await screen.findByText('199 / 200 learning-path levels passed')).toBeInTheDocument();
    expect(screen.getAllByText('99%').length).toBeGreaterThan(0);
    expect(screen.queryByText('100%')).toBeNull();
  });

  // Both choices land before React draws the disabled chooser, as two quick
  // clicks do: the second must not start a save that races the first.
  it('saves one /roadmap track at a time', async () => {
    signInAs(BACKEND);
    answer();
    await mountAt('/roadmap', <CareerRoadmap />);
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: 'Frontend' }));
      fireEvent.click(screen.getByRole('radio', { name: 'Backend' }));
    });
    expect(await screen.findByText('Saved: Frontend')).toBeInTheDocument();
    expect(saves.calls).toHaveLength(1);
    expect(saves.calls[0][1]).toMatchObject({ baseTrack: 'frontend' });
  });

  // A sign-out while the save was in flight still announced "Saved" to
  // whoever used the page next.
  it('announces nothing for a /roadmap track save once the account has signed out', async () => {
    signInAs(BACKEND);
    answer();
    let release = () => {};
    saves.hold = new Promise<void>((resolve) => { release = resolve; });
    await mountAt('/roadmap', <CareerRoadmap />);
    fireEvent.click(screen.getByRole('radio', { name: 'Frontend' }));
    await waitFor(() => expect(saves.calls).toHaveLength(1));
    act(() => { clearAccountData(); });
    await act(async () => { release(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('Saved: Frontend')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Backend' })).not.toBeDisabled();
  });

  it('only changes the view for a visitor', async () => {
    answer();
    await mountAt('/roadmap', <CareerRoadmap />);
    fireEvent.click(screen.getByRole('radio', { name: 'Backend' }));
    expect(saves.calls).toHaveLength(0);
  });
});

describe('the account’s record', () => {
  it('plans Today from the account, not from an empty browser copy', async () => {
    signInAs(BACKEND);
    answer({ progress: { javascript: { levels: { '1': MASTERED, '2': MASTERED, '3': MASTERED }, checkpoints: {} } } });
    await mountAt('/today', <Today />);
    expect(await screen.findByText('JavaScript · Level 4')).toBeInTheDocument();
    expect(screen.queryByText('JavaScript · Level 1')).toBeNull();
  });

  it('replaces this device’s unlocks with the account’s on sync', async () => {
    unlockExtraTopics(['react', 'nodejs']);
    answer({ unlocked: ['typescript'] });
    await syncProgressWithServer();
    expect(getExtraUnlocks()).toEqual(['typescript']);
  });

  // `new Set(...)` of an unlock list stored in another shape threw, and the
  // Learn page fell to its error screen with no way back but clearing storage.
  it('reads this device’s copies of another shape as empty instead of failing the page', async () => {
    localStorage.setItem('devquiz:roadmap:unlocks:v1', JSON.stringify({ react: true }));
    localStorage.setItem('devquiz:roadmap:v2', JSON.stringify(['javascript']));
    answer();
    await mountAt('/learn', <Roadmap />);
    expect(await screen.findByRole('radio', { name: /^JavaScript/ })).toBeInTheDocument();
    expect(getExtraUnlocks()).toEqual([]);
    expect(getRoadmapProgress()).toEqual({});
    localStorage.setItem('devquiz:roadmap:unlocks:v1', JSON.stringify(['react', 42, 'not-a-topic']));
    expect(getExtraUnlocks()).toEqual(['react']);
  });

  it('keeps the spaced-mastery days a completion returns', async () => {
    const progress = {
      html: {
        checkpoints: {},
        levels: {
          '1': MASTERED,
          '2': { passed: true, bestPct: 100, passDays: [DAYS_AGO(3), TODAY], mastered: false, lastPassDay: TODAY },
        },
      },
    };
    answer({ complete: () => HttpResponse.json({ correctAnswers: 8, totalQuestions: 8, percentage: 100, passed: true, applied: true, codingPending: [], progress }) });
    await completeRoadmapAttempt('session-1');
    // The runner then records the result on this device too.
    recordLevelResult('html', 2, 100);
    const stored = getRoadmapProgress().html!.levels as unknown as Record<string, Record<string, unknown>>;
    expect(stored['1']).toMatchObject({ mastered: true, masteredAt: MASTERED.masteredAt });
    expect(stored['2']).toMatchObject({ passed: true, lastPassDay: TODAY, passDays: [DAYS_AGO(3), TODAY] });
  });

  it('opens nothing on this device when the placement receipt cannot be applied', async () => {
    signInAs(BACKEND);
    let fail = true;
    const seen = answer({
      placement: { done: true, correct: 20, total: 20, difficulty: 5, unlockedPreview: ['typescript', 'react'], resultReceipt: 'receipt-1' },
      skillCheck: () => (fail
        ? HttpResponse.json({ error: { code: 'db_error', message: 'Could not apply assessment unlocks' } }, { status: 500 })
        : HttpResponse.json({ applied: true, unlocked: ['typescript'] })),
    });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start placement' }));
    expect(await screen.findByText('Your score could not be saved to your account, so no paths opened. Try again.', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(seen.skillChecks).toBe(1);
    expect(screen.queryByText('Every path is now open.')).toBeNull();
    // Try again applies the same receipt.
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(seen.skillChecks).toBe(2));
    await waitFor(() => expect(screen.queryByText(/could not be saved to your account/)).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Back to paths' }));
    expect(getExtraUnlocks()).toEqual(['typescript']);
  });

  // Back to paths after a sign-out on the result screen wrote the unlocks the
  // account that left had earned into this browser for whoever came next.
  it('opens nothing on this device from a placement of an account that has signed out', async () => {
    signInAs(BACKEND);
    answer({
      placement: { done: true, correct: 20, total: 20, difficulty: 5, unlockedPreview: ['typescript'], resultReceipt: 'receipt-1' },
      skillCheck: () => HttpResponse.json({ applied: true, unlocked: ['typescript'] }),
    });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start placement' }));
    const back = await screen.findByRole('button', { name: 'Back to paths' }, { timeout: 3000 });
    act(() => { clearAccountData(); });
    fireEvent.click(back);
    expect(getExtraUnlocks()).toEqual([]);
  });

  // Next disables itself on the question it opens, so focus fell to the page.
  it('moves focus to each placement question', async () => {
    const ask = (n: number) => ({ id: `p-${n}`, tags: [], introduction: '', question: `Placement question ${n}?`, options: ['Yes', 'No'], category: 'javascript', difficulty: 3 });
    answer({ placement: { done: false, round: 1, totalRounds: 4, difficulty: 3, asked: 0, total: 20, idkCountsAsMiss: true, placementToken: 'token-1', questions: [ask(1), ask(2)] } });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start placement' }));
    expect(await screen.findByText('Placement question 1?', {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(document.getElementById('placement-question')).toHaveFocus());
    fireEvent.click(screen.getByRole('radio', { name: /Yes/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Placement question 2?')).toBeInTheDocument();
    expect(document.getElementById('placement-question')).toHaveFocus();
  });

  // A second click on Finish before the page re-rendered sent the round
  // again, and the server's placement_round_used answer ended the placement.
  it('submits a placement round once when Finish is clicked twice', async () => {
    const ask = { id: 'p-1', tags: [], introduction: '', question: 'Placement question 1?', options: ['Yes', 'No'], category: 'javascript', difficulty: 3 };
    answer({ placement: { done: false, round: 4, totalRounds: 4, difficulty: 3, asked: 15, total: 16, idkCountsAsMiss: true, placementToken: 'token-4', questions: [ask] } });
    let rounds = 0;
    server.use(http.post('*/api/quiz/roadmap', ({ request }) => {
      if (new URL(request.url).searchParams.get('resource') !== 'placement') return undefined;
      rounds += 1;
      return rounds === 1
        ? HttpResponse.json({ done: true, correct: 12, total: 16, difficulty: 3, unlockedPreview: [], review: [] })
        : HttpResponse.json({ error: { code: 'placement_round_used', message: 'This placement round was already submitted. Start the placement again.' } }, { status: 409 });
    }));
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start placement' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Yes/ }, { timeout: 3000 }));
    const finish = screen.getByRole('button', { name: 'Finish' });
    act(() => {
      finish.click();
      finish.click();
    });
    expect(await screen.findByRole('heading', { name: 'Placement complete' }, { timeout: 3000 })).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(rounds).toBe(1);
    expect(screen.queryByText(/already submitted/)).toBeNull();
  });

  it('does not fall back to the score’s own unlocks after a failure', async () => {
    signInAs(BACKEND);
    answer({
      placement: { done: true, correct: 20, total: 20, difficulty: 5, unlockedPreview: ['typescript', 'react'], resultReceipt: 'receipt-1' },
      skillCheck: () => HttpResponse.json({ error: { code: 'db_error', message: 'Could not apply assessment unlocks' } }, { status: 500 }),
    });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start placement' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back to paths' }, { timeout: 3000 }));
    expect(getExtraUnlocks()).toEqual([]);
  });
});

describe('Premium on Today', () => {
  it('says Premium opens the next level when nothing free is left to start', async () => {
    signInAs(BACKEND);
    const allPassed = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [String(i + 1), MASTERED]));
    answer({ progress: { javascript: { levels: allPassed, checkpoints: {} }, dsa: { levels: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), MASTERED])), checkpoints: {} } } });
    await mountAt('/today', <Today />);
    expect(await screen.findByText('Premium opens your next level')).toBeInTheDocument();
    expect(screen.queryByText('Nothing is due today. A new plan is ready tomorrow.')).toBeNull();
    expect(screen.getByText(/Next on your path is Git · Level 1, which Premium opens/)).toBeInTheDocument();
    let request: ReturnType<typeof useUpgradeRequest> = null;
    function Probe() { request = useUpgradeRequest(); return null; }
    render(<Probe />);
    fireEvent.click(screen.getByRole('button', { name: 'See what Premium includes' }));
    expect(request).toMatchObject({ kind: 'learn-level' });
  });
});

describe('a level whose session cannot be used', () => {
  async function openLevelAndAnswer() {
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 }));
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
  }

  it('offers a fresh start when the session timed out', async () => {
    const seen = answer({ answer: () => HttpResponse.json({ error: { code: 'invalid_session', message: 'Learning session expired or invalid' } }, { status: 400 }) });
    await openLevelAndAnswer();
    expect(await screen.findByRole('heading', { name: 'This level timed out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start the level again' }));
    await waitFor(() => expect(seen.levelFetches).toBe(2));
  });

  it('offers a fresh start when the sign-in changed mid-level', async () => {
    answer({ answer: () => HttpResponse.json({ error: { code: 'session_owner_mismatch', message: 'This lesson was opened under a different sign-in. Start it again.' } }, { status: 409 }) });
    await openLevelAndAnswer();
    expect(await screen.findByRole('heading', { name: 'Your sign-in changed during this level' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start the level again' })).toBeInTheDocument();
  });

  it('passes a visitor’s level on its questions, keeps it on this device, and says when coding counts', async () => {
    answer({
      playable: { ...PLAYABLE, coding: [{ task: { id: 'js-digit-sum', title: 'Digit sum' }, session: 'coding-session-1' }] },
      complete: () => HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: true, applied: true, codingPending: [], codingUnverified: true }),
    });
    await openLevelAndAnswer();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish the coding task' }));
    expect(await screen.findByRole('heading', { name: 'Level complete' })).toBeInTheDocument();
    // Signing in replaces this device's progress with the account's, so the
    // copy no longer promises the pass is "checked and saved when you sign in".
    expect(screen.getByText('Coding tasks are not checked while you’re signed out. This pass stays on this device only, and signing in starts from your account’s progress instead.')).toBeInTheDocument();
    expect(screen.queryByText(/when you sign in/)).toBeNull();
    // The coding was not checked, so the screen does not say it passed.
    expect(screen.queryByText('All coding tasks passed.')).toBeNull();
    expect(screen.queryByText(/still to pass/)).toBeNull();
    expect(getRoadmapProgress().javascript?.levels['1']?.passed).toBe(true);
  });

  it('still holds a signed-in level until its coding task passes', async () => {
    signInAs();
    answer({
      playable: { ...PLAYABLE, coding: [{ task: { id: 'js-digit-sum', title: 'Digit sum' }, session: 'coding-session-1' }] },
      complete: () => HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: false, applied: true, codingPending: ['js-digit-sum'] }),
    });
    await openLevelAndAnswer();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish the coding task' }));
    expect(await screen.findByRole('heading', { name: 'Not passed' })).toBeInTheDocument();
    expect(screen.getByText('1 coding tasks still to pass')).toBeInTheDocument();
    expect(screen.queryByText(/Coding tasks are not checked while you’re signed out/)).toBeNull();
  });

  it('drops a level’s request when the learner leaves Learn while it loads', async () => {
    answer();
    let signal: AbortSignal | null = null;
    server.use(http.get('*/api/quiz/roadmap', ({ request }) => {
      if (!new URL(request.url).searchParams.get('level')) return undefined;
      signal = request.signal;
      return new Promise<Response>(() => {});
    }));
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    await waitFor(() => expect(signal).not.toBeNull());
    cleanup();
    await waitFor(() => expect(signal!.aborted).toBe(true));
  });

  // Two answer keys pressed before the first one re-rendered each sent an
  // answer for the same question.
  it('sends one answer when two keys land before the page re-renders', async () => {
    let answers = 0;
    answer({ answer: () => { answers += 1; return HttpResponse.json({ selectedIndex: 0, correctAnswer: 0, isCorrect: true, explanation: 'Because it is first.' }); } });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 }));
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }));
    });
    expect(await screen.findByText('Because it is first.')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(answers).toBe(1);
  });

  // An answer disabled the option that held focus, and Continue then removed
  // itself, so focus fell to the page each time.
  it('moves focus to Continue when an answer is revealed, then to the next question', async () => {
    const second = { ...QUESTION, id: 'q-2', question: 'Which option is second?' };
    answer({ playable: { ...PLAYABLE, questions: [QUESTION, second] } });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 }));
    const question = document.getElementById('lesson-question')!;
    expect(question).toHaveFocus();
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    const next = await screen.findByRole('button', { name: 'Continue' });
    await waitFor(() => expect(next).toHaveFocus());
    fireEvent.click(next);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull());
    expect(document.getElementById('lesson-question')).toHaveFocus();
    expect(screen.getByRole('radio', { name: /Option A/ })).not.toBeDisabled();
  });

  // Returning to the tab fires focus and visibilitychange together. Each
  // re-check found the coding task passed and completed the level, so the
  // pass was recorded, and its XP announced, twice.
  it('completes a level once when the coding re-checks land together', async () => {
    signInAs();
    let completions = 0;
    answer({
      playable: { ...PLAYABLE, coding: [{ task: { id: 'js-digit-sum', title: 'Digit sum' }, session: 'coding-session-1' }] },
      complete: () => {
        completions += 1;
        return HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: true, applied: true, codingPending: [] });
      },
    });
    server.use(http.post('*/api/quiz/roadmap', ({ request }) => (new URL(request.url).searchParams.get('resource') === 'attempt-status'
      ? HttpResponse.json({ completed: false, coding: [{ taskId: 'js-digit-sum', passed: true, revealed: false }] })
      : undefined)));
    await openLevelAndAnswer();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await screen.findByRole('button', { name: 'Finish the coding task' });
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('heading', { name: 'Level complete' })).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(completions).toBe(1);
    expect(screen.queryByRole('heading', { name: 'This level timed out' })).toBeNull();
  });

  // CODE-4: revealing a solution inside a level completed the attempt at once,
  // and the finish screen replaced the solution the learner had just paid for.
  it('keeps a revealed solution on screen until the learner finishes the level', async () => {
    signInAs();
    let completions = 0;
    answer({
      playable: { ...PLAYABLE, coding: [{ task: { id: 'js-digit-sum', title: 'Digit sum' }, session: 'coding-session-1' }] },
      complete: () => {
        completions += 1;
        return HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: false, applied: true, codingPending: ['js-digit-sum'] });
      },
    });
    await openLevelAndAnswer();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show the solution' }));
    expect(await screen.findByText(/the reference/)).toBeInTheDocument();
    // It points at the workbench's "Reference solution" block under the hints
    // (learn-reveal-message.test.tsx); a level has no Solution tab (C3-14).
    expect(screen.getByText(/Showing it ended this level attempt/)).toHaveTextContent(/^The reference solution is shown below\./);
    expect(screen.queryByText(/under the hints|Solution tab/)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completions).toBe(0);
    expect(screen.getByText(/the reference/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish the level' }));
    expect(await screen.findByRole('heading', { name: 'Not passed' })).toBeInTheDocument();
    expect(completions).toBe(1);
  });
});

// C5-6: the coding step read only this device's copy, so a draft saved in
// the Coding section (or on another device) never opened in a level, and
// what the learner ran there never reached the account.
describe('the coding step and the account draft', () => {
  const WITH_CODE = { ...PLAYABLE, coding: [{ task: { id: 'js-digit-sum', title: 'Digit sum' }, session: 'coding-session-1' }] };
  function drafts(draft: { code: string | null; updatedAt: string | null }, { refuseWith }: { refuseWith?: string } = {}) {
    const seen = { reads: 0, saves: [] as unknown[] };
    server.use(
      http.get('*/api/user/*', ({ request }) => {
        const params = new URL(request.url).searchParams;
        if (params.get('op') === 'entitlement') return HttpResponse.json(FREE);
        if (params.get('op') === 'coding-draft' && params.get('id') === 'js-digit-sum') {
          seen.reads += 1;
          return HttpResponse.json(draft);
        }
        return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
      }),
      http.post('*/api/user/*', async ({ request }) => {
        if (new URL(request.url).searchParams.get('op') !== 'coding-draft') return HttpResponse.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 });
        seen.saves.push(await request.json());
        if (refuseWith) return HttpResponse.json({ error: { code: 'draft_conflict', message: 'Saved since', updatedAt: refuseWith } }, { status: 409 });
        return HttpResponse.json({ ok: true });
      }),
    );
    return seen;
  }
  async function openCodingStep() {
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 }));
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    return screen.findByLabelText('Opened with');
  }

  it('opens the draft the account holds', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    const seen = drafts({ code: '// account draft from the section', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(await openCodingStep()).toHaveTextContent('// account draft from the section');
    expect(seen.reads).toBe(1);
    expect(screen.queryByText(/newer/)).toBeNull();
  });

  it('opens a newer copy on this device over the account draft, and says so', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    // Written here after the account draft this device loaded, which nothing has saved over since.
    localStorage.setItem('devshark:coding:draft:js-digit-sum', '// typed here after the last save');
    localStorage.setItem('devshark:coding:draft-time:js-digit-sum', JSON.stringify({ base: '2026-10-09T10:00:00.000Z' }));
    drafts({ code: '// account draft from the section', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(await openCodingStep()).toHaveTextContent('// typed here after the last save');
    expect(screen.getByText(/The code on this device is newer than the draft saved to your account/)).toBeInTheDocument();
  });

  // V3-1: the level weighed this device's clock against the server's and
  // deleted the copy that lost.
  it('opens a draft saved elsewhere since, keeps this device’s copy and opens it on request', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    localStorage.setItem('devshark:coding:draft:js-digit-sum', '// typed here, whatever this clock said');
    localStorage.setItem('devshark:coding:draft-time:js-digit-sum', JSON.stringify({ at: Date.parse('2026-10-09T23:00:00Z'), base: null }));
    drafts({ code: '// account draft from the section', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(await openCodingStep()).toHaveTextContent('// account draft from the section');
    expect(screen.getByText(/saved from somewhere else after this device last saw it/)).toBeInTheDocument();
    expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBe('// typed here, whatever this clock said');
    fireEvent.click(screen.getByRole('button', { name: 'Open the code from this device' }));
    expect(screen.getByLabelText('Opened with')).toHaveTextContent('// typed here, whatever this clock said');
    expect(screen.getByText(/The code from this device is open/)).toBeInTheDocument();
  });

  it('saves what the learner runs to the account as well as this device', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    const seen = drafts({ code: null, updatedAt: null });
    expect(await openCodingStep()).toHaveTextContent('the starter');
    fireEvent.click(screen.getByRole('button', { name: 'Run the code' }));
    await waitFor(() => expect(seen.saves).toEqual([{ id: 'js-digit-sum', code: '// written in the level', base: null }]));
    // The account holds it now, so the copy here goes, as in the Coding section.
    await waitFor(() => expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBeNull());
  });

  // Owner decision 5, in a level as in the Coding section.
  it('keeps what the learner types on this device a second later, without Run, and sends it nowhere', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    const seen = drafts({ code: '// account draft', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(await openCodingStep()).toHaveTextContent('// account draft');
    fireEvent.click(screen.getByRole('button', { name: 'Type in the editor' }));
    expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBeNull();
    await waitFor(() => expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBe('// typed in the level, not run'), { timeout: 3000 });
    expect(JSON.parse(localStorage.getItem('devshark:coding:draft-time:js-digit-sum') ?? 'null')).toEqual({ base: '2026-10-09T10:00:00.000Z' });
    expect(seen.saves).toEqual([]);
  });

  // Owner decision 10, in a level as in the Coding section.
  it('says so when another device saved the draft since, and opens that draft on request with this code kept', async () => {
    signInAs();
    answer({ playable: WITH_CODE });
    const seen = drafts({ code: '// account draft', updatedAt: '2026-10-09T10:00:00.000Z' }, { refuseWith: '2026-10-09T10:05:00.000001+00:00' });
    expect(await openCodingStep()).toHaveTextContent('// account draft');
    fireEvent.click(screen.getByRole('button', { name: 'Run the code' }));
    expect(await screen.findByText(/changed on another device since this page opened/)).toBeInTheDocument();
    expect(seen.saves).toEqual([{ id: 'js-digit-sum', code: '// written in the level', base: '2026-10-09T10:00:00.000Z' }]);
    expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBe('// written in the level');
    // The other device's draft, read when the learner asks for it.
    drafts({ code: '// from the other device', updatedAt: '2026-10-09T10:05:00.000001+00:00' });
    fireEvent.click(screen.getByRole('button', { name: 'Open the other draft' }));
    await waitFor(() => expect(screen.getByLabelText('Opened with')).toHaveTextContent('// from the other device'));
    fireEvent.click(screen.getByRole('button', { name: 'Open the code from this device' }));
    expect(screen.getByLabelText('Opened with')).toHaveTextContent('// written in the level');
  });

  it('opens this device’s copy for a visitor and asks the account for nothing', async () => {
    answer({
      playable: WITH_CODE,
      complete: () => HttpResponse.json({ correctAnswers: 1, totalQuestions: 1, percentage: 100, passed: true, applied: true, codingPending: [], codingUnverified: true }),
    });
    localStorage.setItem('devshark:coding:draft:js-digit-sum', '// a visitor’s code');
    const seen = drafts({ code: '// not theirs', updatedAt: '2026-10-09T10:00:00.000Z' });
    expect(await openCodingStep()).toHaveTextContent('// a visitor’s code');
    fireEvent.click(screen.getByRole('button', { name: 'Run the code' }));
    expect(localStorage.getItem('devshark:coding:draft:js-digit-sum')).toBe('// written in the level');
    expect(seen.reads).toBe(0);
    expect(seen.saves).toEqual([]);
  });
});

// UX audit U2 (learn-02, learn-03, learn-04, questions-01, questions-02): a
// level draws through the shared question parts.
describe('a level on the shared question parts', () => {
  const swimCtas = () => document.querySelectorAll('.ss-swim-cta');

  async function openLevel(playable: unknown = PLAYABLE, wrong = false) {
    answer({
      playable,
      answer: wrong
        ? () => HttpResponse.json({ selectedIndex: 1, correctAnswer: 0, isCorrect: false, explanation: 'The first option is first.' })
        : undefined,
    });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    return screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 });
  }

  it('keeps the intro and the questions in one 640px shell with the exit button in one place, and one primary', async () => {
    const start = await openLevel();
    const introShell = start.closest('.ss-question');
    expect(introShell).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Level 1 · Level 1 title' })).toBeInTheDocument();
    expect(screen.getByText('Before you start')).toBeInTheDocument();
    expect(swimCtas()).toHaveLength(1);
    const exitOnIntro = screen.getByRole('button', { name: 'Exit lesson' });
    expect(exitOnIntro.closest('.ss-question-header__tools')).not.toBeNull();
    fireEvent.click(start);
    const question = document.getElementById('lesson-question')!;
    expect(question.closest('.ss-question')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Exit lesson' }).closest('.ss-question-header__tools')).not.toBeNull();
    // Nothing to press before an answer: a press grades at once.
    expect(swimCtas()).toHaveLength(0);
  });

  it('keeps the hint line and every option in place on grading, marks the pick and the key in words, and puts the verdict under them', async () => {
    fireEvent.click(await openLevel(PLAYABLE, true));
    const hint = screen.getByText('Press 1–2 to answer');
    expect(hint).not.toHaveAttribute('data-hidden');
    const list = screen.getByRole('radiogroup');
    fireEvent.click(screen.getByRole('radio', { name: /Option B/ }));
    const verdict = await screen.findByText('Incorrect');
    // The hint keeps its line (hidden, not removed), so the answers above it
    // and the verdict below it do not move.
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveAttribute('data-hidden', 'true');
    expect(screen.getByRole('radio', { name: 'Option A, Correct answer' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Option B, Your pick' })).toBeInTheDocument();
    // In normal flow after the list, inside the same panel; never over it.
    const feedback = verdict.closest('.ss-question-feedback')!;
    expect(feedback).not.toBeNull();
    expect(list.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(feedback.closest('.ss-question__panel')).toBe(list.closest('.ss-question__panel'));
    expect(screen.getByText('The first option is first.')).toBeInTheDocument();
    // The one primary is the action row's SwimCta, and it takes focus.
    const next = screen.getByRole('button', { name: 'Finish' });
    expect(swimCtas()).toHaveLength(1);
    expect(next.closest('.ss-question-actions')).not.toBeNull();
    await waitFor(() => expect(next).toHaveFocus());
  });

  it('runs the skill check in the same shell: the round in the h1, the shared answer list and one primary', async () => {
    const ask = (n: number) => ({ id: `p-${n}`, tags: [], introduction: '', question: `Placement question ${n}?`, options: ['Yes', 'No'], category: 'javascript', difficulty: 3 });
    answer({ placement: { done: false, round: 1, totalRounds: 4, difficulty: 3, asked: 0, total: 20, idkCountsAsMiss: true, placementToken: 'token-1', questions: [ask(1), ask(2)] } });
    await mountAt('/learn', <Roadmap />);
    fireEvent.click(await screen.findByRole('button', { name: /Skill check/ }));
    const start = screen.getByRole('button', { name: 'Start placement' });
    expect(start.closest('.ss-question')).not.toBeNull();
    expect(swimCtas()).toHaveLength(1);
    fireEvent.click(start);
    await screen.findByText('Placement question 1?', {}, { timeout: 3000 });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Find your level · Round 1 of 4');
    expect(screen.getByRole('radiogroup').classList.contains('ss-answer-list')).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' }).closest('.ss-question-header__tools')).not.toBeNull();
    expect(swimCtas()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'I don’t know yet' }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('reports only its live questions, so the app shell hides its header and footer then (questions-07)', async () => {
    const seen: boolean[] = [];
    const onActiveChange = (active: boolean) => { seen.push(active); };
    answer({ playable: PLAYABLE });
    await mountAt('/learn', <Roadmap onActiveChange={onActiveChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue', description: /^Level 1 of \d+ · Level 1 title$/ }));
    const start = await screen.findByRole('button', { name: 'Start the level' }, { timeout: 3000 });
    // The intro keeps the chrome: nothing is live yet.
    expect(seen[seen.length - 1] ?? false).toBe(false);
    fireEvent.click(start);
    await waitFor(() => expect(seen[seen.length - 1]).toBe(true));
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await screen.findByRole('heading', { name: 'Level complete' });
    // The result brings the chrome back through the runner's passive effect.
    await waitFor(() => expect(seen[seen.length - 1]).toBe(false));
  });

  it('ends on a result with one primary in the shared action row', async () => {
    fireEvent.click(await openLevel());
    fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    const heading = await screen.findByRole('heading', { name: 'Level complete' });
    expect(heading.closest('.ss-question')).not.toBeNull();
    expect(swimCtas()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Try again' }).closest('.ss-question-actions__secondary')).not.toBeNull();
    // The score is text, so it keeps a text colour: the track colour
    // (JavaScript's yellow) is under 3:1 on the panel.
    const score = screen.getByText('100%');
    expect(score).toHaveAttribute('data-passed', 'true');
    expect(score.getAttribute('style')).toBeNull();
  });

  // UX audit learn-02: Continue sits under the verdict, so the page has
  // scrolled down to reach it; the next question must open at its top, with
  // its header and text in sight, and the intro takes focus on its h1.
  it('opens the intro on its h1 and the next question at its top when the page has scrolled past it', async () => {
    const scrolled: Element[] = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement) { scrolled.push(this); },
    });
    // The shell's top is above the screen, as after scrolling to Continue.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.classList.contains('ss-question') ? -300 : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    try {
      const second = { ...QUESTION, id: 'q-2', question: 'Which option is second?' };
      const start = await openLevel({ ...PLAYABLE, questions: [QUESTION, second] });
      // Focus moves in an effect after the intro paints; wait for it rather than
      // read it in the same tick (it lagged on a loaded CI runner).
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Level 1 · Level 1 title' })).toHaveFocus());
      fireEvent.click(start);
      fireEvent.click(screen.getByRole('radio', { name: /Option A/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(document.getElementById('lesson-question')).toHaveFocus());
      const shell = document.getElementById('lesson-question')!.closest('.ss-question');
      expect(scrolled[scrolled.length - 1]).toBe(shell);
    } finally {
      rect.mockRestore();
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
