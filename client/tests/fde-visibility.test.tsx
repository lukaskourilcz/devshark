import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../src/i18n/LanguageContext';
import PathPickerDialog from '../src/components/PathPickerDialog';
import { resolveSection } from '../src/components/learn/sections';
import { FDE_SECTION_VISIBLE, LEARN_SECTIONS, VISIBLE_LEARN_SECTIONS, learnTopicHref } from '../../shared/learn-sections';
import { PUBLIC_PAGES } from '../src/lib/publicMetadata';
import { premiumIncludes } from '../src/components/PremiumFacts';
import { buildToday } from '../src/lib/today';
import type { LearnerProfile } from '../../shared/learning-paths';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});

describe('the owner hold on FDE', () => {
  it('publishes only Web and Software while retaining the FDE curriculum identity', () => {
    expect(FDE_SECTION_VISIBLE).toBe(false);
    expect(VISIBLE_LEARN_SECTIONS.map(section => section.id)).toEqual(['web-developer', 'software-engineer']);
    expect(LEARN_SECTIONS.find(section => section.id === 'forward-deployed-engineer')?.paths).toEqual(['fde']);
    expect(PUBLIC_PAGES.some(page => page.path.includes('forward-deployed-engineer'))).toBe(false);
    expect(premiumIncludes(true)).not.toContain('premium.sheet.include5');
  });

  it('does not restore a hidden section from a stale preference or a deep-linked topic', () => {
    expect(resolveSection(undefined, '', 'forward-deployed-engineer')).toEqual({ section: 'web-developer', canonical: '/learn/web-developer' });
    expect(resolveSection('forward-deployed-engineer', '?topic=nodejs', null)).toEqual({ section: 'web-developer', canonical: '/learn/web-developer?topic=nodejs' });
    expect(resolveSection(undefined, '?topic=ai', null).section).toBe('web-developer');
    expect(learnTopicHref('ai')).toBe('/learn/web-developer');
    expect(learnTopicHref('dsa')).toBe('/learn/software-engineer?topic=dsa');
  });

  it('does not recommend an FDE-only topic from a legacy plan', () => {
    const plan = buildToday({}, 'webdev', { today: '2026-11-06', topicOrder: ['ai'], extraUnlocks: ['ai'], inPlan: topic => topic === 'ai' });
    expect(plan.items.some(item => item.topic === 'ai')).toBe(false);
  });

  it('keeps a hidden saved specialization when the learner edits the visible section choice', () => {
    const profile: LearnerProfile = { schemaVersion: 2, baseTrack: 'frontend', specialization: 'fde', sections: [], goals: ['level-up'], experience: 'some', studyTime: '30-60', updatedAt: null };
    const choose = vi.fn();
    render(<MemoryRouter><LanguageProvider><PathPickerDialog open onClose={() => {}} current="frontend" currentSpecialization="fde" currentProfile={profile} onChoose={choose} /></LanguageProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('radiogroup', { name: 'Specialization' })).not.toBeInTheDocument();
    expect(screen.queryByText('Forward Deployed Engineer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Software Engineer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ specialization: 'fde', sections: ['software-engineer'] }));
    expect(profile.specialization).toBe('fde');
    expect(profile.sections).toEqual([]);
  });
});
