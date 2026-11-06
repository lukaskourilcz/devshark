import { describe, expect, it } from 'vitest';
import {
  firstSelectable,
  railEntries,
  resolveSection,
  sectionGate,
  sectionProgress,
  pathSteps,
  type RailContext,
} from '../src/components/learn/sections';
import { NO_PENDING, withPendingJoin } from '../src/lib/eligibility';
import { isTopicInPlan, type VerifiedProgress } from '../../shared/progression';
import { SUBJECT_SCOPE_CATALOG } from '../../shared/subject-catalog';
import type { LearnerProfile } from '../../shared/learning-paths';
import type { LearnSectionId } from '../../shared/learn-sections';

const LIVE = SUBJECT_SCOPE_CATALOG.webdev.topics;

const passed = (count: number) => ({
  levels: Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), { passed: true }])),
});

const frontend: LearnerProfile = {
  schemaVersion: 2, baseTrack: 'frontend', specialization: null,
  goals: ['level-up'], experience: 'some', studyTime: '15-30', updatedAt: null,
};
const backend: LearnerProfile = { ...frontend, baseTrack: 'backend' };

function ctx(profile: LearnerProfile | null, section: LearnSectionId, members: LearnSectionId[], progress: VerifiedProgress = {}): RailContext {
  return {
    liveTopics: LIVE,
    inPlan: (topic) => isTopicInPlan(profile, 'webdev', topic),
    hasPlan: profile !== null,
    isMember: members.includes(section),
    progress,
    extraUnlocks: new Set(),
    lockOf: () => 'open',
  };
}

const stateOf = (entries: ReturnType<typeof railEntries>) => Object.fromEntries(entries.map((entry) => [entry.topic, entry.state]));

describe('resolveSection', () => {
  it('lands on Web Developer with nothing to go on, and names it in the URL', () => {
    expect(resolveSection(undefined, '', null)).toEqual({ section: 'web-developer', canonical: '/learn/web-developer' });
  });

  it('remembers the last section on this device', () => {
    expect(resolveSection(undefined, '', 'software-engineer')).toEqual({ section: 'software-engineer', canonical: '/learn/software-engineer' });
    expect(resolveSection(undefined, '', 'nope').section).toBe('web-developer');
  });

  it('opens the first section that lists a deep-linked topic, keeping the query', () => {
    expect(resolveSection(undefined, '?topic=dsa', 'forward-deployed-engineer')).toEqual({ section: 'software-engineer', canonical: '/learn/software-engineer?topic=dsa' });
    expect(resolveSection(undefined, '?topic=git', null).section).toBe('web-developer');
    expect(resolveSection(undefined, '?topic=ai&level=3', null)).toEqual({ section: 'web-developer', canonical: '/learn/web-developer?topic=ai&level=3' });
  });

  it('falls back to the stored section for a topic no section lists', () => {
    expect(resolveSection(undefined, '?topic=cool-stuff', 'software-engineer')).toEqual({ section: 'software-engineer', canonical: '/learn/software-engineer?topic=cool-stuff' });
  });

  it('treats an unknown section like none', () => {
    expect(resolveSection('foo', '?part=2', null)).toEqual({ section: 'web-developer', canonical: '/learn/web-developer?part=2' });
    expect(resolveSection('react', '', 'software-engineer').section).toBe('software-engineer');
  });

  it('moves a section URL to the section of its topic, and leaves a matching one alone', () => {
    expect(resolveSection('software-engineer', '?topic=react&level=3', null)).toEqual({ section: 'web-developer', canonical: '/learn/web-developer?topic=react&level=3' });
    expect(resolveSection('software-engineer', '?topic=git', null)).toEqual({ section: 'software-engineer', canonical: null });
    expect(resolveSection('forward-deployed-engineer', '', 'web-developer')).toEqual({ section: 'web-developer', canonical: '/learn/web-developer' });
  });
});

describe('railEntries', () => {
  it('dims what a Frontend learner has not joined, and keeps planned topics', () => {
    const entries = railEntries('software-engineer', ctx(frontend, 'software-engineer', ['web-developer']));
    expect(stateOf(entries)).toEqual({
      dsa: 'locked', 'dsa-advanced': 'dimmed', algorithms: 'dimmed', 'system-design': 'dimmed', devops: 'dimmed',
      security: 'dimmed', databases: 'dimmed', git: 'locked', general: 'locked',
    });
    const withJs = railEntries('software-engineer', ctx(frontend, 'software-engineer', ['web-developer'], { javascript: passed(5) }));
    expect(stateOf(withJs)).toMatchObject({ dsa: 'open', git: 'open', general: 'open', algorithms: 'dimmed' });
  });

  it('never dims a topic with a passed level', () => {
    const entries = railEntries('software-engineer', ctx(frontend, 'software-engineer', ['web-developer'], { algorithms: passed(1) }));
    expect(stateOf(entries).algorithms).not.toBe('dimmed');
  });

  it('dims nothing without a saved plan', () => {
    for (const section of ['web-developer', 'software-engineer', 'forward-deployed-engineer'] as const) {
      const entries = railEntries(section, ctx(null, section, []));
      expect(entries.some((entry) => entry.state === 'dimmed')).toBe(false);
    }
    expect(railEntries('software-engineer', ctx(null, 'software-engineer', [])).map((entry) => entry.topic))
      .toEqual(['dsa', 'dsa-advanced', 'algorithms', 'system-design', 'devops', 'security', 'databases', 'git', 'general']);
  });

  it('hides from a member what the plan leaves out, as the page always did', () => {
    const topics = railEntries('web-developer', ctx(backend, 'web-developer', ['web-developer'])).map((entry) => entry.topic);
    expect(topics).not.toContain('html');
    expect(topics).not.toContain('css');
    expect(topics).toContain('nodejs');
  });

  it('opens the section the moment a join is pending', () => {
    const joined = withPendingJoin(frontend, { sections: ['software-engineer'], fde: false });
    const se = railEntries('software-engineer', ctx(joined, 'software-engineer', ['web-developer', 'software-engineer']));
    expect(se.some((entry) => entry.state === 'dimmed')).toBe(false);
    expect(se.map((entry) => entry.topic)).toHaveLength(9);
    const wd = railEntries('web-developer', ctx(joined, 'web-developer', ['web-developer', 'software-engineer']));
    expect(wd.map((entry) => entry.topic)).toContain('nodejs');

    const fde = withPendingJoin(frontend, { sections: [], fde: true });
    expect(fde?.specialization).toBe('fde');
    const rail = railEntries('forward-deployed-engineer', ctx(fde, 'forward-deployed-engineer', ['web-developer', 'forward-deployed-engineer']));
    expect(rail.some((entry) => entry.state === 'dimmed')).toBe(false);
    expect(rail.map((entry) => entry.topic)).toContain('ai');
    expect(withPendingJoin(frontend, NO_PENDING)).toBe(frontend);
  });

  it('keeps a shared topic in every section that lists it', () => {
    const se = railEntries('software-engineer', ctx(null, 'software-engineer', [])).map((entry) => entry.topic);
    const web = railEntries('web-developer', ctx(null, 'web-developer', [])).map((entry) => entry.topic);
    expect(se).toEqual(expect.arrayContaining(['git', 'databases', 'dsa']));
    expect(web).toEqual(expect.arrayContaining(['git', 'databases']));
  });

  it('marks a topic Premium from its first level, never a dimmed one', () => {
    const base = ctx(frontend, 'software-engineer', ['web-developer'], { javascript: passed(5) });
    const entries = railEntries('software-engineer', {
      ...base,
      lockOf: (content) => (content.kind === 'learn-level' && content.topic !== 'dsa' ? 'locked' : 'open'),
    });
    expect(entries.find((entry) => entry.topic === 'git')?.premium).toBe(true);
    expect(entries.find((entry) => entry.topic === 'dsa')?.premium).toBe(false);
    expect(entries.find((entry) => entry.topic === 'algorithms')?.premium).toBe(false);
  });
});

describe('sectionProgress', () => {
  const counts = { git: 10, general: 10, dsa: 10, html: 10, css: 10, javascript: 10, typescript: 10, react: 20, nextjs: 10, algorithms: 10, 'system-design': 10, devops: 10, security: 10, databases: 10, nodejs: 10 };

  it('counts a shared topic in every section that lists it', () => {
    const progress = { git: passed(3) };
    const wd = sectionProgress(railEntries('web-developer', ctx(null, 'web-developer', [], progress)), progress, counts);
    const se = sectionProgress(railEntries('software-engineer', ctx(null, 'software-engineer', [], progress)), progress, counts);
    expect(wd.passed).toBe(3);
    expect(se.passed).toBe(3);
  });

  it('rounds down, and waits for the level counts', () => {
    const progress = { dsa: passed(1) };
    const entries = railEntries('software-engineer', ctx(null, 'software-engineer', [], progress));
    expect(sectionProgress(entries, progress, counts).percent).toBe(1);
    expect(sectionProgress(entries, progress, {}).percent).toBeNull();
  });

  it('shows a passed level as at least 1%, and nothing passed as 0%', () => {
    const progress = { git: passed(1) };
    const entries = railEntries('software-engineer', ctx(null, 'software-engineer', [], progress));
    const many = Object.fromEntries(Object.keys(counts).map((topic) => [topic, 40]));
    expect(sectionProgress(entries, progress, many)).toMatchObject({ passed: 1, percent: 1 });
    expect(sectionProgress(entries, {}, many).percent).toBe(0);
  });

  it('leaves dimmed topics out of the denominator', () => {
    const progress = { git: passed(10), general: passed(10), dsa: passed(10) };
    const entries = railEntries('software-engineer', ctx(frontend, 'software-engineer', ['web-developer'], progress));
    expect(sectionProgress(entries, progress, counts)).toEqual({ passed: 30, total: 30, percent: 100 });
  });
});

describe('sectionGate', () => {
  it('names JavaScript for a fresh learner on Software Engineer', () => {
    const entries = railEntries('software-engineer', ctx(null, 'software-engineer', []));
    expect(sectionGate(entries, {}, new Set(), [])).toEqual({ prereq: 'javascript', topic: 'dsa', prereqSection: 'web-developer' });
  });

  it('walks down a locked prerequisite and names Node.js once JavaScript is through', () => {
    const progress = { javascript: passed(5) };
    const entries = railEntries('software-engineer', ctx(null, 'software-engineer', [], progress)).filter((entry) => ['system-design', 'devops', 'databases'].includes(entry.topic));
    expect(sectionGate(entries, progress, new Set(), ['web-developer'])).toEqual({ prereq: 'nodejs', topic: 'system-design', prereqSection: 'web-developer' });
    const fresh = railEntries('software-engineer', ctx(null, 'software-engineer', [])).filter((entry) => entry.topic === 'databases');
    expect(sectionGate(fresh, {}, new Set(), [])?.prereq).toBe('javascript');
  });

  it('says nothing when a topic is open, or when nothing is locked', () => {
    const progress = { javascript: passed(5) };
    expect(sectionGate(railEntries('software-engineer', ctx(null, 'software-engineer', [], progress)), progress, new Set(), [])).toBeNull();
    const dimmedOnly = railEntries('software-engineer', ctx(frontend, 'software-engineer', ['web-developer'])).filter((entry) => entry.state === 'dimmed');
    expect(sectionGate(dimmedOnly, {}, new Set(), ['web-developer'])).toBeNull();
  });
});

describe('firstSelectable', () => {
  it('keeps a preferred open topic, else takes the first open one', () => {
    const progress = { javascript: passed(5) };
    const entries = railEntries('software-engineer', ctx(null, 'software-engineer', [], progress));
    expect(firstSelectable(entries, [null, 'git'])).toBe('git');
    expect(firstSelectable(entries, ['system-design'])).toBe('dsa');
    expect(firstSelectable(railEntries('software-engineer', ctx(null, 'software-engineer', [])), [])).toBeNull();
  });
});


describe('path evidence in section progress', () => {
  it('counts recorded loop evidence and leaves optional and interview work out', () => {
    const activity = (id: string) => ({ id, kind: 'lesson' as const, purpose: 'exercise' as const, verification: 'self_reviewed' as const, title: id, summary: id, competencies: [], estimatedMinutes: 1 });
    const modules = [
      { activities: [activity('lesson'), activity('check'), activity('code')] },
      { optional: true, activities: [activity('bridge')] },
      { optional: true, shelf: 'interview-prep' as const, activities: [activity('interview')] },
    ] satisfies Parameters<typeof pathSteps>[0];
    const progress = { modules: [{ activities: [
      { activityId: 'lesson', state: 'self_reviewed' },
      { activityId: 'check', state: 'verified_pass' },
      { activityId: 'code', state: 'needs_revision' },
      { activityId: 'bridge', state: 'verified_pass' },
      { activityId: 'interview', state: 'verified_pass' },
    ] }] } as Parameters<typeof pathSteps>[1];
    const steps = pathSteps(modules, progress);
    expect(steps).toEqual({ passed: 2, total: 3 });
    expect(sectionProgress([], {}, {}, steps)).toEqual({ passed: 2, total: 3, percent: 66 });
    expect(pathSteps(modules, undefined)).toEqual({ passed: 0, total: 3 });
  });
});
