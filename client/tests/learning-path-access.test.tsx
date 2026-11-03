// Who may start a learning path, and what the path's screens offer when they
// may not: Premium opens the paths, a switched-off path offers nothing to
// resume, and the Profile picker never pauses a path the learner started on
// its own page. The picker's Sections step (#490) saves Software Engineer with
// the profile and keeps the FDE Premium refusal.
import type { ReactElement } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';

const lesson = (id: string, title: string) => ({
  id, kind: 'lesson', purpose: 'exercise', verification: 'self_reviewed', title: title, summary: title, competencies: [], estimatedMinutes: 5,
});
const pathManifest = (id: 'fde') => ({
  id, kind: 'role_specialization', version: 1, title: 'Forward Deployed Engineer',
  summary: '', outcomes: [], nonGoals: [], entryRequirement: id === 'fde' ? 'You ship code in one track and have integrated HTTP, a database or an API.' : '', competencies: id === 'fde' ? [{ id: 'integration', title: 'Integration and data' }, { id: 'handoff', title: 'Adoption and handoff' }, { id: 'python-reading', title: 'Python comprehension' }] : [], bridges: [],
  rubric: { version: 1, dimensions: [] }, diagnosticActivityId: id === 'fde' && state.diagnosticResults.length ? 'fde-diagnostic-check' : null, estimatedHours: { min: 1, max: 2 }, sources: [], reviewedOn: '2026-01-01',
  completionLabel: 'done',
  modules: [...(id === 'fde' && state.diagnosticResults.length ? [{
    id: 'fde-diagnostic', title: 'Optional diagnostic', optional: true, outcomes: [], competencies: [], dependsOn: [], lessons: [],
    activities: [{ ...lesson('fde-diagnostic-check', 'Diagnostic check'), kind: 'check', purpose: 'diagnostic' }], requires: [], estimatedMinutes: 10,
  }] : []), {
    id: `${id}-m01`, title: 'Module one', outcomes: [], competencies: [], dependsOn: [], lessons: [],
    activities: [{ ...lesson(`${id}-m01-l1-read`, `${state.readPrefix ? 'Read: ' : ''}${id} first lesson`), competencies: ['integration'] }], requires: [], estimatedMinutes: 10,
  }, ...(state.secondModule ? [{ id: `${id}-m02`, title: 'Module two', outcomes: [], competencies: [], dependsOn: [], lessons: [], activities: [lesson(`${id}-m02-l1-read`, `${id} second lesson`)], requires: [], estimatedMinutes: 10 }] : []), ...(id === 'fde' && state.shelf ? [{
    id: 'fde-ip01', title: 'Learning round', optional: true, shelf: 'interview-prep', outcomes: [], competencies: [], dependsOn: [], lessons: [],
    activities: [lesson('fde-ip01-l1', 'Interview lesson')], requires: [], estimatedMinutes: 10,
  }] : [])],
});
const inventory = { modules: 1, lessons: 1, checks: 0, codeExercises: 0, artifacts: 0, estimatedMinutes: 10, moduleChecks: 0, moduleCodeExercises: 0, finalChecks: 0, finalCodeExercises: 0, diagnosticChecks: 0, diagnosticCodeExercises: 0 };

const state = vi.hoisted(() => ({
  tier: 'premium' as 'premium' | 'free',
  availability: 'available',
  enrollments: [] as { enrollmentId: string; pathId: string; curriculumVersion: number; status: string }[],
  enrollmentsRead: 'loaded' as 'loaded' | 'loading' | 'failed',
  enrollmentRefetches: 0,
  progressLoaded: true,
  progressRequests: [] as string[],
  shelf: false,
  noArtifacts: false,
  secondModule: false,
  nextSecond: false,
  passedActivity: null as string | null,
  diagnosticResults: [] as { competencyId: string; state: 'demonstrated' | 'gap' | 'not_assessed'; score: number | null; assessedItems: number }[],
  metadata: {} as Record<string, unknown>,
  catalogFailed: false,
  saveFails: false,
  changes: [] as Record<string, unknown>[],
  saves: [] as unknown[][],
  sheet: vi.fn(),
  signIn: vi.fn(),
  guest: false,
  readPrefix: false,
  guidedComplete: false,
}));

vi.mock('../src/lib/auth', () => ({
  useAuth: () => (state.guest
    ? { user: null, isAuthenticated: false, isLoading: false }
    : { user: { id: 'user-1', user_metadata: state.metadata }, isAuthenticated: true, isLoading: false }),
}));
vi.mock('../src/lib/signInDialog', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/signInDialog')>(),
  openSignIn: state.signIn,
}));
vi.mock('../src/lib/entitlement', () => ({
  useEntitlement: () => ({ tier: state.tier, signedIn: true, loading: false, failed: false, data: null, refetch: () => {} }),
}));
vi.mock('../src/lib/upgradeSheet', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/upgradeSheet')>(),
  openUpgradeSheet: state.sheet,
}));
vi.mock('../src/lib/trackPref', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/trackPref')>(),
  saveLearningPreference: vi.fn(async (...args: unknown[]) => {
    state.saves.push(args);
    return state.saveFails ? { ok: false, reason: 'network', message: 'network' } : { ok: true, preference: args[1] };
  }),
}));
vi.mock('../src/lib/learningPaths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/learningPaths')>();
  const progressFor = (pathId: string) => ({
    enrollment: null, modules: state.passedActivity ? [{ moduleId: `${pathId}-m02`, activities: [{ activityId: state.passedActivity, state: 'verified_pass' }] }] : [], competencies: pathId === 'fde' ? state.diagnosticResults : [], recommendedBridges: [], guidedComplete: state.guidedComplete,
    // FDE's modules require three written pieces; `noArtifacts` stands in for
    // a path with none.
    artifacts: pathId === 'fde' && !state.noArtifacts ? { submitted: 1, total: 3 } : { submitted: 0, total: 0 },
    dueActivityIds: [], nextActivityId: `${pathId}-m0${state.nextSecond ? 2 : 1}-l1-read`,
  });
  return {
    ...actual,
    usePathCatalog: () => (state.catalogFailed ? { isLoading: false, isError: true, refetch: () => {}, data: undefined } : {
      isLoading: false, isError: false, refetch: () => {},
      data: {
        paths: (['fde'] as const).map((id) => ({
          manifest: pathManifest(id), availability: state.availability, inventory: { ...inventory, artifacts: state.noArtifacts ? 0 : 3 },
        })),
        versions: {},
      },
    }),
    useEnrollments: () => (state.enrollmentsRead === 'loading'
      ? { data: undefined, isPending: true, error: null, refetch: () => {} }
      : state.enrollmentsRead === 'failed'
        ? { data: undefined, isPending: false, error: new Error('down'), refetch: () => { state.enrollmentRefetches += 1; } }
        : { data: { enrollments: state.enrollments.map((one) => ({ baseTrackAtEnrollment: null, startedAt: '', updatedAt: '', ...one })) } }),
    usePathProgress: (_user: string | undefined, enrollmentId: string | undefined) => {
      const enrollment = state.enrollments.find((one) => one.enrollmentId === enrollmentId);
      return { data: enrollment && state.progressLoaded ? progressFor(enrollment.pathId) : undefined };
    },
    pathProgressQuery: (_user: string | undefined, enrollmentId: string | undefined) => ({
      queryKey: ['learning-path', 'progress', 'test', enrollmentId ?? ''],
      queryFn: () => (state.progressRequests.push(enrollmentId ?? ''), state.progressLoaded
        ? Promise.resolve(progressFor(state.enrollments.find((one) => one.enrollmentId === enrollmentId)!.pathId))
        : new Promise(() => {})),
      staleTime: Infinity,
    }),
    changeEnrollment: vi.fn(async (input: Record<string, unknown>) => {
      state.changes.push(input);
      return { enrollments: [] };
    }),
  };
});

// 'dsa-foundations' is the retired path (E5, #496): its stored rows are not
// deleted, so a test may still hand one to the client.
const enrolled = (pathId: 'fde' | 'dsa-foundations', status = 'active') => ({ enrollmentId: `ENROLL-${pathId}-0000000000`, pathId, curriculumVersion: 1, status });

beforeAll(async () => {
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  // The screens' code, compiled once up front rather than inside the first
  // test's time budget. Imported here, after the fixtures the mocks read.
  await Promise.all([
    import('../src/i18n/LanguageContext'),
    import('../src/components/paths/LearningPathScreens'),
    import('../src/components/paths/PathShelf'),
    import('../src/components/paths/PathResumeSection'),
    import('../src/components/paths/LearningPathsCard'),
    import('../src/components/paths/PathRewardClaim'),
  ]);
}, 60_000);
beforeEach(() => {
  state.tier = 'premium';
  state.availability = 'available';
  state.enrollments = [];
  state.enrollmentsRead = 'loaded';
  state.enrollmentRefetches = 0;
  state.progressLoaded = true;
  state.progressRequests = [];
  state.shelf = false;
  state.noArtifacts = false;
  state.secondModule = false;
  state.nextSecond = false;
  state.passedActivity = null;
  state.diagnosticResults = [];
  state.metadata = {};
  state.catalogFailed = false;
  state.saveFails = false;
  state.changes.length = 0;
  state.saves.length = 0;
  state.sheet.mockReset();
  state.signIn.mockReset();
  state.guest = false;
  state.readPrefix = false;
  state.guidedComplete = false;
  server.use(http.get('*/api/user/learning-path-reward', () => HttpResponse.json({ eligible: false, claimed: false, orderId: null })));
});

async function mount(path: string, route: string, element: () => Promise<ReactElement>) {
  const { LanguageProvider } = await import('../src/i18n/LanguageContext');
  const view = await element();
  await act(async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <LanguageProvider>
            <Routes><Route path={route} element={view} /></Routes>
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
const overview = (pathId: 'fde') => mount('/p', '/p', async () => {
  const { PathOverview } = await import('../src/components/paths/LearningPathScreens');
  return <PathOverview pathId={pathId} />;
});

describe('the path page', () => {
  it('shows distinct diagnostic states and assessed counts, with a reachable retake link', async () => {
    state.enrollments = [enrolled('fde')];
    state.diagnosticResults = [
      { competencyId: 'integration', state: 'gap', score: 0.3333, assessedItems: 3 },
      { competencyId: 'handoff', state: 'demonstrated', score: 1, assessedItems: 3 },
      { competencyId: 'python-reading', state: 'not_assessed', score: null, assessedItems: 0 },
    ];
    await overview('fde');
    const report = screen.getByRole('region', { name: 'Diagnostic overview' });
    expect(within(report).getByText(/Worth practising/)).toHaveTextContent('33% · Items assessed: 3');
    expect(within(report).getByText(/Demonstrated in this check/)).toHaveTextContent('100% · Items assessed: 3');
    const unknown = within(report).getByText(/Not assessed/);
    expect(unknown).toHaveTextContent('Python comprehension');
    expect(unknown).not.toHaveTextContent('0%');
    expect(within(report).getByRole('link', { name: 'Open the diagnostic' })).toHaveAttribute('href', '/learn/forward-deployed-engineer/path/fde-diagnostic?activity=fde-diagnostic-check');
  });

  it('keeps old unassessed diagnostic results readable when access is paused, without an active start link', async () => {
    state.availability = 'disabled';
    state.enrollments = [enrolled('fde', 'paused')];
    state.diagnosticResults = [{ competencyId: 'integration', state: 'not_assessed', score: null, assessedItems: 0 }];
    await overview('fde');
    const report = screen.getByRole('region', { name: 'Diagnostic overview' });
    expect(within(report).getByText(/Not assessed/)).not.toHaveTextContent('0%');
    expect(within(report).getByText(/Results without per-question evidence/)).toBeInTheDocument();
    expect(within(report).queryByRole('link', { name: 'Open the diagnostic' })).toBeNull();
  });

  it('a paused path lists its activities without links and offers Resume', async () => {
    state.enrollments = [enrolled('fde', 'paused')];
    await overview('fde');
    expect(screen.getByText(/This path is paused/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /fde first lesson/ })).toBeNull();
  });

  it('on the free plan, Start enrolls in the taster without an upgrade', async () => {
    state.tier = 'free';
    await overview('fde');
    const actions = document.querySelector('.lp-head__actions') as HTMLElement;
    expect(within(actions).queryByText('Premium')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start this path' })); });
    expect(state.sheet).not.toHaveBeenCalled();
    expect(state.changes).toHaveLength(1);
  });

  it('marks the second module Premium after lapse', async () => {
    state.tier = 'free'; state.enrollments = [enrolled('fde')]; state.secondModule = true; state.nextSecond = true;
    await overview('fde');
    fireEvent.click(screen.getByRole('button', { name: 'Continue where you left off' }));
    expect(state.sheet).toHaveBeenCalledWith({ kind: 'learning-path-activity', ref: 'fde:fde-m02-l1-read' });
  });

  it('says Premium once on a module whose every activity Premium opens, in its head, not on each row', async () => {
    state.tier = 'free'; state.enrollments = [enrolled('fde')]; state.secondModule = true;
    await overview('fde');
    const second = screen.getByRole('link', { name: 'Module two' }).closest('section') as HTMLElement;
    expect(second.querySelector('.lp-module__meta')!.textContent).toBe('Premium 10 min');
    const link = within(second).getByRole('link', { name: /fde second lesson/ });
    // The row keeps the word for a screen reader, and draws no label of its own.
    expect(link).toHaveAccessibleName(/Premium$/);
    expect(link.querySelector('.ss-premium-label')).toBeNull();
    // The open first module says nothing about Premium.
    const first = screen.getByRole('link', { name: 'Module one' }).closest('section') as HTMLElement;
    expect(within(first).queryByText('Premium')).toBeNull();
  });

  it('starting the role specialization records the base track it sits above', async () => {
    const { setTrackValue } = await import('../src/lib/tracks');
    setTrackValue('backend');
    await overview('fde');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start this path' })); });
    await waitFor(() => expect(state.changes).toHaveLength(1));
    expect(state.changes[0]).toMatchObject({ pathId: 'fde', action: 'enroll', baseTrack: 'backend' });
  });

  it('a switched-off path offers no Continue and no activity links, but can still be paused', async () => {
    state.availability = 'disabled';
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    expect(screen.queryByRole('button', { name: 'Continue where you left off' })).toBeNull();
    expect(screen.queryByRole('link', { name: /fde first lesson/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('says the written pieces the learner reviews are required to complete the path', async () => {
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const progress = screen.getByRole('heading', { name: 'Where you are' }).closest('section') as HTMLElement;
    expect(within(progress).getByText('Written pieces you review yourself')).toBeInTheDocument();
    expect(within(progress).getByText('1 of 3 submitted')).toBeInTheDocument();
    expect(within(progress).getByText(/^All 3 are required to complete the path\./)).toBeInTheDocument();
    expect(within(progress).queryByText('Portfolio self-reviewed')).toBeNull();
  });

  // UX audit learn-14: the card names the guided path and its state, and the
  // 'not a certification' disclaimer is said once, in the non-goals list.
  it('labels the line Guided path with its state, without repeating the disclaimer', async () => {
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const card = screen.getByRole('heading', { name: 'Where you are' }).closest('section') as HTMLElement;
    const line = within(card).getByText('Guided path').parentElement as HTMLElement;
    expect(line).toHaveTextContent('Guided path◐In progress');
    expect(card).not.toHaveTextContent(/certification|completed/i);
  });

  it('says Completed once the server marks the guided path complete', async () => {
    state.guidedComplete = true;
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const card = screen.getByRole('heading', { name: 'Where you are' }).closest('section') as HTMLElement;
    expect(within(card).getByText('Guided path').parentElement).toHaveTextContent('Guided path✓Completed');
  });

  it('shows no written-piece line on a path without any', async () => {
    state.noArtifacts = true;
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    await screen.findByRole('heading', { name: 'Where you are' });
    expect(screen.queryByText('Written pieces you review yourself')).toBeNull();
    expect(screen.queryByText(/are required to complete the path/)).toBeNull();
  });

  it('offers no Start while the account\'s enrollments are still loading', async () => {
    state.enrollmentsRead = 'loading';
    await overview('fde');
    expect(screen.queryByRole('button', { name: 'Start this path' })).toBeNull();
    // The stacked hero keeps its action row meanwhile, so the page below does
    // not move down when Start or Continue arrives.
    expect(document.querySelector('.lp-head > .lp-head__actions')).toHaveAttribute('aria-busy', 'true');
  });

  it('a double click on Start sends one enrollment', async () => {
    await overview('fde');
    const start = screen.getByRole('button', { name: 'Start this path' });
    await act(async () => { fireEvent.click(start); fireEvent.click(start); });
    await waitFor(() => expect(state.changes).toHaveLength(1));
  });

  // UX audit learn-10: the hero stacks in every state, with one action row
  // under the inventory and one filled primary in it.
  it('stacks one action row under the hero, with one filled primary and Pause beside it', async () => {
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const header = document.querySelector('.lp-head') as HTMLElement;
    const actions = header.lastElementChild as HTMLElement;
    expect(actions).toHaveClass('lp-head__actions');
    expect(header.querySelector('.lp-head__text')!.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.querySelectorAll('.ss-swim-cta')).toHaveLength(1);
    expect(within(actions).getByRole('button', { name: 'Continue where you left off' })).toHaveClass('ss-swim-cta');
    expect(within(actions).getByRole('button', { name: 'Pause' })).not.toHaveClass('ss-swim-cta');
    expect(document.querySelectorAll('.lp-page .ss-swim-cta')).toHaveLength(1);
  });

  it('says what the four kinds of activity are for under the Modules heading, not in the hero', async () => {
    await overview('fde');
    const note = screen.getByText(/^Lessons explain the idea/);
    expect(note.closest('header')).toBeNull();
    expect(note.closest('section')).toBe(screen.getByRole('heading', { level: 2, name: 'Modules' }).closest('section'));
  });

  it('offers a guest Sign in to start as the one primary, and nothing to press on a closed path', async () => {
    state.guest = true;
    await overview('fde');
    const signIn = within(document.querySelector('.lp-head__actions') as HTMLElement).getByRole('button', { name: 'Sign in to start' });
    expect(signIn).toHaveClass('ss-swim-cta');
    fireEvent.click(signIn);
    expect(state.signIn).toHaveBeenCalledWith({ returnTo: '/learn/forward-deployed-engineer/path' });
    expect(screen.queryByText(/Sign in to record graded work/)).toBeNull();
  });

  it('draws no empty action row for a guest on a closed path', async () => {
    state.guest = true;
    state.availability = 'disabled';
    await overview('fde');
    expect(screen.getByText(/not open yet on this deployment/)).toBeInTheDocument();
    expect(document.querySelector('.lp-head__actions')).toBeNull();
  });

  // UX audit learn-11: the evidence board follows the modules, closed, and
  // the delivery loop stays above them.
  it('puts the delivery loop above the modules and the closed evidence board below them', async () => {
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const modules = screen.getByRole('heading', { level: 2, name: 'Modules' }).closest('section') as HTMLElement;
    const loop = screen.getByRole('region', { name: 'The delivery loop' });
    const board = screen.getByRole('region', { name: 'Competency evidence' });
    expect(loop.compareDocumentPosition(modules) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(modules.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((board.querySelector('details') as HTMLDetailsElement).open).toBe(false);
  });

  // UX audit learn-12: the kind column says 'Read' once, a row says nothing
  // until a state is recorded, and the hub's rows are one line.
  it('drops the kind prefix the row already shows and draws a state only once there is one', async () => {
    state.readPrefix = true;
    state.secondModule = true;
    state.passedActivity = 'fde-m02-l1-read';
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const modules = screen.getByRole('heading', { level: 2, name: 'Modules' }).closest('section') as HTMLElement;
    const first = within(modules).getByRole('link', { name: /fde first lesson/i });
    expect(first.querySelector('.lp-activity__kind')).toHaveTextContent('Read');
    expect(first.querySelector('.lp-activity__title')).toHaveTextContent(/^Fde first lesson$/);
    expect(first).not.toHaveTextContent('Not started');
    expect(first.querySelector('.lp-activity__state')).toBeNull();
    expect(first).toHaveClass('lp-activity--compact');
    expect(first.querySelector('.lp-activity__summary')).toBeNull();
    const passed = within(modules).getByRole('link', { name: /fde second lesson/ });
    expect(passed.querySelector('.lp-activity__state [aria-hidden="true"]')).toHaveTextContent('✓');
    expect(within(passed).getByText('Verified pass')).toHaveClass('ss-sr-only');
  });

  it('after Premium lapses, the first module stays open', async () => {
    state.tier = 'free';
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const modules = screen.getByRole('heading', { level: 2, name: 'Modules' }).closest('section') as HTMLElement;
    expect(within(modules).getByRole('link', { name: /fde first lesson/ })).toBeInTheDocument();
    expect(state.sheet).not.toHaveBeenCalled();
  });
});

describe('the module page status', () => {
  const modulePage = (moduleId: string) => mount(`/p/${moduleId}`, '/p/:moduleId', async () => {
    const { ModuleWorkspace } = await import('../src/components/paths/LearningPathScreens');
    return <ModuleWorkspace pathId="fde" />;
  });
  // B14 (#510): an untouched module, or one seen before enrolling, said
  // "In progress".
  it('says Not started before any evidence', async () => {
    state.secondModule = true;
    state.enrollments = [enrolled('fde')];
    await modulePage('fde-m02');
    expect(await screen.findByText('Not started', { selector: '.lp-head__status' })).toBeInTheDocument();
  });
  it('says In progress once an activity of the module has evidence', async () => {
    state.secondModule = true;
    state.passedActivity = 'fde-m02-l1-read';
    state.enrollments = [enrolled('fde')];
    await modulePage('fde-m02');
    expect(await screen.findByText('In progress', { selector: '.lp-head__status' })).toBeInTheDocument();
  });
  it('claims no missing enrollment while the list loads', async () => {
    state.enrollmentsRead = 'loading';
    await modulePage('fde-m01');
    await screen.findByRole('heading', { level: 1, name: 'Module one' });
    expect(screen.queryByText('Start this path to open its activities.')).toBeNull();
  });
  it('says the evidence could not be loaded, with a retry, when the enrollments fail', async () => {
    state.enrollmentsRead = 'failed';
    await modulePage('fde-m01');
    await screen.findByRole('heading', { level: 1, name: 'Module one' });
    expect(screen.queryByText('Start this path to open its activities.')).toBeNull();
    expect(screen.getByText(/Your evidence could not be loaded/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button'));
    expect(state.enrollmentRefetches).toBe(1);
  });
  it('a paused enrollment lists its activities without links and leads to Resume instead of opening one the server refuses', async () => {
    state.enrollments = [enrolled('fde', 'paused')];
    await mount('/p/fde-m01?activity=fde-m01-l1-read', '/p/:moduleId', async () => {
      const { ModuleWorkspace } = await import('../src/components/paths/LearningPathScreens');
      return <ModuleWorkspace pathId="fde" />;
    });
    await screen.findByRole('heading', { level: 1, name: 'Module one' });
    expect(screen.getByText(/This path is paused/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Resume' })).toHaveAttribute('href', '/learn/forward-deployed-engineer/path');
    expect(screen.queryByRole('link', { name: /fde first lesson/ })).toBeNull();
    expect(document.querySelector('.lp-workspace')).toBeNull();
  });
  it('keeps each row\'s summary on the module page and drops the kind prefix there too', async () => {
    state.readPrefix = true;
    state.enrollments = [enrolled('fde')];
    await modulePage('fde-m01');
    const row = await screen.findByRole('link', { name: /fde first lesson/i });
    expect(row).not.toHaveClass('lp-activity--compact');
    expect(row.querySelector('.lp-activity__title')).toHaveTextContent(/^Fde first lesson$/);
    expect(row.querySelector('.lp-activity__summary')).toBeInTheDocument();
  });
  it('after Premium lapses, a locked module\'s primary asks for Premium instead of opening the activity', async () => {
    state.tier = 'free';
    state.secondModule = true;
    state.enrollments = [enrolled('fde')];
    await modulePage('fde-m02');
    const actions = await waitFor(() => document.querySelector('.lp-head__actions') as HTMLElement);
    expect(within(actions).getByText('Premium')).toBeInTheDocument();
    fireEvent.click(within(actions).getByRole('button', { name: 'Start module' }));
    expect(state.sheet).toHaveBeenCalledWith({ kind: 'learning-path-activity', ref: 'fde:fde-m02-l1-read' });
  });
  it('offers no primary to a learner who has not enrolled', async () => {
    await modulePage('fde-m01');
    await screen.findByRole('heading', { level: 1, name: 'Module one' });
    expect(document.querySelector('.lp-head__actions')).toBeNull();
  });
  it('says Not started to a learner who has not enrolled', async () => {
    state.secondModule = true;
    await modulePage('fde-m02');
    expect(await screen.findByText('Not started', { selector: '.lp-head__status' })).toBeInTheDocument();
  });
});

describe('the interview-prep shelf', () => {
  const modulesSection = () => screen.getByRole('heading', { level: 2, name: 'Modules' }).closest('section') as HTMLElement;

  it('lists a shelf module under Interview prep, apart from the loop, marked Optional', async () => {
    state.shelf = true;
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const shelf = screen.getByRole('region', { name: 'Interview prep' });
    expect(within(shelf).getByText('Learning round')).toBeInTheDocument();
    expect(within(shelf).getByText('Optional practice for interview rounds. It does not count toward completing the path.')).toBeInTheDocument();
    expect(within(shelf).getByText('Optional')).toBeInTheDocument();
    expect(within(shelf).getAllByRole('link', { name: /Interview lesson/ })[0]).toBeInTheDocument();
    expect(within(modulesSection()).queryByText('Learning round')).toBeNull();
    // The module's Premium mark and its minutes read as two words, not one.
    expect(shelf.querySelector('.lp-module__meta')!.textContent).toBe('Premium 10 min');
    expect(screen.queryByRole('heading', { name: 'Optional: placement and bridges' })).toBeNull();
  });

  it('sits between the loop and the placement and bridge modules, which keep their own section', async () => {
    state.shelf = true;
    state.enrollments = [enrolled('fde')];
    state.diagnosticResults = [{ competencyId: 'integration', state: 'gap', score: 0.3333, assessedItems: 3 }];
    await overview('fde');
    const shelf = screen.getByRole('region', { name: 'Interview prep' });
    const optional = screen.getByRole('heading', { name: 'Optional: placement and bridges' }).closest('section') as HTMLElement;
    expect(within(optional).getByText('Optional diagnostic')).toBeInTheDocument();
    expect(within(optional).queryByText('Learning round')).toBeNull();
    expect(modulesSection().compareDocumentPosition(shelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shelf.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no shelf on a path without one', async () => {
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    expect(screen.queryByRole('region', { name: 'Interview prep' })).toBeNull();
  });

  it('after Premium lapses, the shelf is browsable and an unpassed activity asks for Premium', async () => {
    state.shelf = true;
    state.tier = 'free';
    state.enrollments = [enrolled('fde')];
    await overview('fde');
    const shelf = screen.getByRole('region', { name: 'Interview prep' });
    expect(within(shelf).getByText('Learning round')).toBeInTheDocument();
    fireEvent.click(within(shelf).getByRole('link', { name: /Interview lesson/ }));
    expect(state.sheet).toHaveBeenCalledWith({ kind: 'learning-path-activity', ref: 'fde:fde-ip01-l1' });
  });
});

describe('the Learn path shelf', () => {
  it.each([
    ['available', null, 'Open path'],
    ['available', 'active', 'Continue path'],
    ['available', 'paused', 'Resume path'],
    ['disabled', 'active', 'View outline'],
  ] as const)('offers %s / %s as the actual %s link', async (availability, status, action) => {
    state.availability = availability;
    state.enrollments = status ? [enrolled('fde', status)] : [];
    await mount('/r', '/r', async () => {
      const { default: PathShelf } = await import('../src/components/paths/PathShelf');
      return <PathShelf pathIds={['fde']} />;
    });
    const link = screen.getByRole('link', { name: `${action}: Forward Deployed Engineer` });
    expect(link).toHaveTextContent(action);
    expect(link).toHaveAttribute('href', '/learn/forward-deployed-engineer/path');
    expect(state.changes).toEqual([]);
  });

  it('opens path enrollment on the free tier', async () => {
    state.tier = 'free';
    await mount('/r', '/r', async () => {
      const { default: PathShelf } = await import('../src/components/paths/PathShelf');
      return <PathShelf pathIds={['fde']} />;
    });
    expect(screen.queryByText('Premium')).toBeNull();
  });

  // UX audit learn-01: the section switcher names the section, so the card
  // says what it is and keeps the path's name in its link's name only.
  it('offers a real path action and names the path in its link', async () => {
    state.tier = 'free';
    await mount('/r', '/r', async () => {
      const { default: PathShelf } = await import('../src/components/paths/PathShelf');
      return <PathShelf pathIds={['fde']} />;
    });
    const heading = await screen.findByRole('heading', { level: 3 });
    expect(heading.textContent).toMatch(/^Guided path( outline)?$/);
    const card = heading.closest('section')!;
    const link = within(card).getByRole('link');
    expect(link).toHaveAccessibleName(/^(Open path|View outline): Forward Deployed Engineer$/);
    expect(link).toHaveAttribute('href', '/learn/forward-deployed-engineer/path');
    expect(screen.queryByText('Role')).toBeNull();
  });
});

describe('Today', () => {
  const today = () => mount('/t', '/t', async () => {
    const { PathResumeSection } = await import('../src/components/paths/PathResumeSection');
    return <PathResumeSection />;
  });

  it('offers the next step of the running path under the Learning paths heading', async () => {
    state.enrollments = [enrolled('fde')];
    await today();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Learning paths' })).toBeInTheDocument());
    expect(screen.queryByText('Skill path')).toBeNull();
    expect(screen.getByRole('link', { name: /fde first lesson/ })).toBeInTheDocument();
  });

  it('offers nothing, and asks for no progress, for a stored enrollment of the retired DSA path', async () => {
    const retired = enrolled('dsa-foundations');
    state.enrollments = [enrolled('fde'), retired];
    await today();
    await waitFor(() => expect(screen.getByRole('link', { name: /fde first lesson/ })).toBeInTheDocument());
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /dsa-foundations/ })).toBeNull();
    expect(state.progressRequests).toEqual([enrolled('fde').enrollmentId]);
    expect(state.progressRequests).not.toContain(retired.enrollmentId);
  });

  it('offers the free next step after Premium lapses', async () => {
    state.tier = 'free';
    state.enrollments = [enrolled('fde')];
    await today();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByRole('heading', { name: 'Learning paths' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /fde first lesson/ })).toBeInTheDocument();
  });

  it('offers nothing for a switched-off path', async () => {
    state.availability = 'disabled';
    state.enrollments = [enrolled('fde')];
    await today();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws no empty heading while progress loads', async () => {
    state.progressLoaded = false;
    state.enrollments = [enrolled('fde')];
    await today();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('the Profile picker', () => {
  const profile = {
    // A record saved before E5 (#496) may still list skill paths; the picker
    // never sends the retired field back.
    schemaVersion: 2, baseTrack: 'frontend', specialization: null, skillPaths: ['retired-skill-path'],
    goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: '2026-09-01T00:00:00Z',
  };
  const signedInWith = (saved: Record<string, unknown>) => {
    state.metadata = {
      devquiz_learning_preference_v1: { schemaVersion: 1, baseTrack: saved.baseTrack, specialization: saved.specialization },
      devquiz_learner_profile_v2: saved,
    };
  };
  const card = () => mount('/profile', '/profile', async () => {
    const { default: LearningPathsCard } = await import('../src/components/paths/LearningPathsCard');
    return <LearningPathsCard />;
  });
  const press = async (name: string) => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
  };
  const openPicker = () => press('Choose your path');
  /** Track, then Sections, then the profile answers, which are already saved. */
  const walkToSave = async () => {
    await openPicker();
    for (let step = 0; step < 2; step += 1) await press('Continue');
  };
  const savedAnswers = () => state.saves[0] as [unknown, { specialization: unknown }, Record<string, unknown>];

  it('keeps the paths a learner started on their own pages when the picker is saved', async () => {
    // The account said "no specialization", then the learner started FDE from
    // its path page.
    signedInWith(profile);
    state.enrollments = [enrolled('fde')];
    await card();
    await walkToSave();
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    // Choosing FDE keeps the running enrollment, and no skill paths are sent:
    // E5 (#496) retired them.
    expect(state.changes).toEqual([]);
    const [, preference, answers] = savedAnswers();
    expect(preference.specialization).toBe('fde');
    expect(answers).not.toHaveProperty('skillPaths');
  });

  it('offers Software Engineer and the FDE card on the Sections step, and no DSA toggle', async () => {
    state.tier = 'free';
    signedInWith(profile);
    await card();
    await openPicker();
    await press('Continue');
    expect(screen.getByRole('heading', { name: 'Add a section?' })).toBeInTheDocument();
    const se = screen.getByRole('checkbox', { name: 'Software Engineer' });
    expect(se).not.toBeChecked();
    expect(se).toHaveAccessibleDescription(/Free to join\./);
    expect(screen.queryByRole('checkbox', { name: /DSA/ })).toBeNull();
    const group = screen.getByRole('radiogroup', { name: 'Specialization' });
    expect(within(group).getByRole('radio', { name: 'Continue without a specialization' })).toHaveAttribute('aria-checked', 'true');
    const fde = within(group).getByRole('radio', { name: 'Forward Deployed Engineer' });
    expect(within(fde).queryByText('Premium')).toBeNull();
    expect(within(fde).getByText(/^devShark’s flagship section/)).toBeInTheDocument();
    // The requirement is the manifest's, word for word.
    expect(within(fde).getByText('Before you start: You ship code in one track and have integrated HTTP, a database or an API.')).toBeInTheDocument();
    // The name is the label alone, so the Premium mark, the flagship line and
    // the requirement reach a screen reader as the description.
    expect(fde).toHaveAccessibleDescription(/^devShark’s flagship section.*Before you start: You ship code/);
    expect(within(group).getByRole('radio', { name: 'Continue without a specialization' }))
      .toHaveAccessibleDescription(/^Current Stay with the foundations/);
  });

  it('while the catalog is unavailable, a free account can save its FDE preference without inventing an enrollment', async () => {
    state.tier = 'free';
    state.catalogFailed = true;
    signedInWith(profile);
    await card();
    await openPicker();
    await press('Continue');
    const fde = screen.getByRole('radio', { name: 'Forward Deployed Engineer' });
    expect(fde).toHaveAccessibleDescription(/^devShark’s flagship section/);
    // No catalog, no requirement: the card shows nothing rather than a copy.
    expect(within(fde).queryByText(/^Before you start:/)).toBeNull();
    await act(async () => { fireEvent.click(fde); });
    await press('Continue');
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    expect(state.changes).toEqual([]);
    expect(savedAnswers()[1].specialization).toBe('fde');
    expect(state.sheet).not.toHaveBeenCalled();
  });

  it('an account save that fails promises only what the device keeps', async () => {
    state.saveFails = true;
    signedInWith(profile);
    await card();
    await walkToSave();
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your track and specialization are kept on this device. Your sections and answers are not saved to your account yet. Try again.',
    );
  });

  it('a picker key with no words reads as the key, as t() does, and never throws', async () => {
    const { pickerCopy } = await import('../src/i18n/translations.picker');
    type Key = Parameters<typeof pickerCopy>[0];
    expect(pickerCopy('profile.goal.something-new' as Key)).toBe('profile.goal.something-new');
    expect(pickerCopy('profile.goal.something-new' as Key, { max: 3 })).toBe('profile.goal.something-new');
    expect(pickerCopy('profile.picker.goalsHint', { max: 3 })).toBe('Pick up to 3.');
  });

  it('saving the picker writes the Software Engineer section with the profile', async () => {
    signedInWith(profile);
    await card();
    expect(screen.getByText('Sections: Web Developer')).toBeInTheDocument();
    await openPicker();
    await press('Continue');
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Software Engineer' })); });
    await press('Continue');
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    const [, preference, answers] = savedAnswers();
    expect(preference.specialization).toBeNull();
    expect(answers).toEqual({ goals: ['level-up'], experience: 'some', studyTime: '30-60', sections: ['software-engineer'] });
    // Joining is free: nothing enrols and nothing asks for Premium.
    expect(state.changes).toEqual([]);
    expect(state.sheet).not.toHaveBeenCalled();
    expect(screen.getByText(/^Saved: \w+ \+ Software Engineer$/)).toBeInTheDocument();
  });

  it('removing Software Engineer saves an empty list, so its topics leave the plan and nothing else changes', async () => {
    const joined = { ...profile, sections: ['software-engineer'] };
    signedInWith(joined);
    await card();
    expect(screen.getByText('Sections: Web Developer · Software Engineer')).toBeInTheDocument();
    await openPicker();
    await press('Continue');
    const se = screen.getByRole('checkbox', { name: 'Software Engineer' });
    expect(se).toBeChecked();
    await act(async () => { fireEvent.click(se); });
    await press('Continue');
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    const [, , answers] = savedAnswers();
    // Sent, not left out: a missing field would keep the saved list.
    expect(answers.sections).toEqual([]);
    // The plan is the only thing that changes. The save is the one write: no
    // enrollment moves and nothing asks the server to drop progress, so every
    // passed level stays where it is.
    expect(state.changes).toEqual([]);
    const { planTopics } = await import('../../shared/progression');
    const before = planTopics(joined as Parameters<typeof planTopics>[0]);
    const after = planTopics({ ...joined, sections: answers.sections } as Parameters<typeof planTopics>[0]);
    // The Frontend plan already holds DSA, Git and General; these four come
    // only with the section.
    for (const topic of ['algorithms', 'system-design', 'devops', 'security']) {
      expect(before).toContain(topic);
      expect(after).not.toContain(topic);
    }
    expect(after).toEqual(planTopics(profile as Parameters<typeof planTopics>[0]));
  });

  it('arrow keys browse without advancing, Continue advances and Back keeps every choice', async () => {
    signedInWith(profile);
    await card();
    await openPicker();
    const tracks = screen.getAllByRole('radio');
    const chosen = tracks.find((one) => one.getAttribute('aria-checked') === 'true')!;
    const next = tracks[(tracks.indexOf(chosen) + 1) % tracks.length];
    await act(async () => { fireEvent.keyDown(chosen, { key: 'ArrowDown' }); });
    expect(next).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Choose your learning path' })).toBeInTheDocument();
    await press('Continue');
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Software Engineer' })); });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('radio', { name: 'Continue without a specialization' }), { key: 'ArrowDown' });
    });
    expect(screen.getByRole('radio', { name: 'Forward Deployed Engineer' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Add a section?' })).toBeInTheDocument();
    await press('Back');
    expect(screen.getByRole('radio', { name: next.getAttribute('aria-label')! })).toHaveAttribute('aria-checked', 'true');
    await press('Continue');
    expect(screen.getByRole('checkbox', { name: 'Software Engineer' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Forward Deployed Engineer' })).toHaveAttribute('aria-checked', 'true');
  });

  it('on the free plan, choosing FDE enrolls in its taster and saves both chosen sections', async () => {
    state.tier = 'free';
    signedInWith(profile);
    await card();
    await openPicker();
    await press('Continue');
    const fde = screen.getByRole('radio', { name: 'Forward Deployed Engineer' });
    expect(within(fde).queryByText('Premium')).toBeNull();
    await act(async () => { fireEvent.click(fde); });
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Software Engineer' })); });
    await press('Continue');
    await press('Save');
    await waitFor(() => expect(state.saves).toHaveLength(1));
    expect(state.changes).toHaveLength(1);
    expect(state.changes[0]).toMatchObject({ pathId: 'fde', action: 'enroll' });
    const [, preference, answers] = savedAnswers();
    expect(preference.specialization).toBe('fde');
    expect(answers.sections).toEqual(['software-engineer']);
    expect(state.sheet).not.toHaveBeenCalled();
  });

  // Owner decision 10: merchandise is paused until next quarter, so a finished
  // path shows no package and the card never asks the server for one.
  it('shows no package for a finished path while merchandise is paused, and never asks for one', async () => {
    let asked = 0;
    server.use(http.get('*/api/user/learning-path-reward', () => {
      asked += 1;
      return HttpResponse.json({ eligible: true, claimed: false, orderId: null });
    }));
    state.enrollments = [enrolled('fde')];
    await card();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(screen.getAllByText('Forward Deployed Engineer').length).toBeGreaterThan(0);
    expect(screen.queryByText('Your package is ready to claim')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Claim the package' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/package|t-shirt|merch/i);
    expect(asked).toBe(0);
  });
});

// The claim form itself, dormant while merchandise is paused but kept working
// for when it returns.
describe('the package claim', () => {
  const claimCard = async (pathId = 'fde') => {
    const { LanguageProvider } = await import('../src/i18n/LanguageContext');
    const { PathRewardClaim } = await import('../src/components/paths/PathRewardClaim');
    const tree = (id: string) => <LanguageProvider><PathRewardClaim pathId={id} /></LanguageProvider>;
    let view!: ReturnType<typeof render>;
    await act(async () => { view = render(tree(pathId)); });
    return { switchTo: (id: string) => act(async () => { view.rerender(tree(id)); }) };
  };
  const openForm = async () => {
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Claim the package' })); });
  };
  const claimForm = () => screen.getByRole('button', { name: 'Claim it' }).closest('form') as HTMLFormElement;

  it('sends one claim for a double press, and keeps the confirmation when the read after it fails', async () => {
    let reads = 0;
    const claims: unknown[] = [];
    let answer!: () => void;
    server.use(
      http.get('*/api/user/learning-path-reward', () => {
        reads += 1;
        return reads === 1 ? HttpResponse.json({ eligible: true, claimed: false, orderId: null }) : HttpResponse.json({ error: { code: 'db_error' } }, { status: 500 });
      }),
      http.post('*/api/user/learning-path-reward', async ({ request }) => {
        claims.push(await request.json());
        await new Promise<void>((resolve) => { answer = resolve; });
        return HttpResponse.json({ claimed: true, orderId: 'order-1' });
      }),
    );
    await claimCard();
    await openForm();
    await act(async () => {
      fireEvent.submit(claimForm());
      fireEvent.submit(claimForm());
    });
    await waitFor(() => expect(claims).toHaveLength(1));
    await act(async () => { answer(); });
    await waitFor(() => expect(reads).toBe(2));
    expect(await screen.findByText('Package claimed. You will hear from us when it ships.')).toBeInTheDocument();
    expect(claims).toHaveLength(1);
  });

  it('lets a slow read for the path before answer nothing for the path shown now', async () => {
    let releaseFirst!: () => void;
    server.use(http.get('*/api/user/learning-path-reward', async ({ request }) => {
      const pathId = new URL(request.url).searchParams.get('pathId');
      if (pathId === 'fde') {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        return HttpResponse.json({ eligible: true, claimed: true, orderId: 'order-1' });
      }
      return HttpResponse.json({ eligible: false, claimed: false, orderId: null });
    }));
    const { switchTo } = await claimCard('fde');
    await waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    await switchTo('other');
    await act(async () => { releaseFirst(); await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.queryByText('Package claimed. You will hear from us when it ships.')).toBeNull();
  });
});
