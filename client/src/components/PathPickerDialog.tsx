import { FDE_SECTION_VISIBLE } from '../../../shared/learn-section-ids';
// The learning-path picker: choose a base track, then the Learn sections
// beside it, then the profile answers that let the product describe a plan
// instead of a catalogue.
//
// The profile answers are required before practice is personalised, so they are
// asked here once rather than in a second form somewhere else. Goals, the
// experience answer and the study-time band are all the learner telling us how
// to talk to them: none of them opens a level, and the experience answer least
// of all — progression comes from server-verified evidence and nothing else.
//
// Three explicit steps (docs/learn-sections-fde-flagship-plan.md, section 5.5).
// The base track is the Web Developer focus the roadmap has always had. The
// second step is Sections: Software Engineer is an opt-in checkbox, free to
// join, because it runs beside the track and beside the specialization; the
// Forward Deployed Engineer specialization stays one of two exclusive cards,
// and "Continue without a specialization" is a first-class answer rather than
// a way out. DSA Foundations is a Learn topic of Software Engineer, not a path
// (E5, #496, retired the standalone path), so the picker never offers it.
//
// Redesigned on the Astryx design system: an Astryx Dialog whose options use
// the shared radio-card pattern. Arrow keys browse the exclusive options; the
// dialog advances only on an explicit Continue, so nobody is committed by
// keyboard navigation. Back returns to the previous step with the choices
// intact.

import { useEffect, useId, useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { trackLabelKey, trackBlurbKey, TRACK_ORDER, type Track } from '../lib/tracks';
import { useSubject } from '../lib/subjects';
import { useT } from '../i18n/LanguageContext';
import { pickerCopy, type PickerKey } from '../i18n/translations.picker';
import { CheckCard, RadioCard, RadioCardGroup } from './ui/RadioCards';
import {
  EXPERIENCE_LEVELS,
  LEARNER_GOALS,
  MAX_LEARNER_GOALS,
  STUDY_TIMES,
  type ExperienceLevel,
  type LearnerGoal,
  type LearnerProfile,
  type RoleSpecializationId,
  type StudyTime,
} from '../../../shared/learning-paths';
import type { LearnSectionId } from '../../../shared/learn-sections';
import './paths/LearningPaths.css';

/** The specialization's two answers. `none` is a real choice, not a dismissal. */
type RoleChoice = RoleSpecializationId | 'none';
const ROLE_ORDER: RoleChoice[] = ['none', 'fde'];

/** The one section a learner joins by ticking it here (`OPT_IN_SECTIONS`). */
const SOFTWARE_ENGINEER: LearnSectionId = 'software-engineer';

export interface PathPickerResult {
  track: Track;
  specialization: RoleSpecializationId | null;
  /** The opt-in sections to save on the profile, sent in full: an empty list
   * leaves Software Engineer, where a missing one would keep the saved list. */
  sections: LearnSectionId[];
  goals: LearnerGoal[];
  experience: ExperienceLevel;
  studyTime: StudyTime;
}

/** The steps the picker asks, in order. */
const STEPS = ['track', 'sections', 'profile'] as const;
type Step = (typeof STEPS)[number];

const TITLE: Record<Step, PickerKey> = {
  track: 'home.pathDialogTitle',
  sections: 'paths.picker.sectionsTitle',
  profile: 'profile.picker.title',
};
const SUBTITLE: Record<Step, PickerKey> = {
  track: 'paths.picker.trackSubtitle',
  sections: 'paths.picker.sectionsSubtitle',
  profile: 'profile.picker.subtitle',
};
const FOOTNOTE: Record<Step, PickerKey> = {
  track: 'paths.picker.trackFootnote',
  sections: 'paths.picker.sectionsFootnote',
  profile: 'profile.picker.footnote',
};

const goalKey = (goal: LearnerGoal) => `profile.goal.${goal}` as PickerKey;
const experienceKey = (level: ExperienceLevel) => `profile.experience.${level}` as PickerKey;
const studyTimeKey = (band: StudyTime) => `profile.studyTime.${band}` as PickerKey;

export default function PathPickerDialog({
  open,
  onClose,
  current,
  currentSpecialization,
  currentProfile = null,
  fdeLocked = false,
  fdeEntryRequirement = null,
  onChoose,
  /** Set while the parent is saving, so the dialog cannot be double-submitted. */
  busy = false,
  /** A save that failed, shown in the dialog so the learner can retry here. */
  error = null,
}: {
  open: boolean;
  onClose: () => void;
  current: Track;
  currentSpecialization?: RoleSpecializationId | null;
  /** The profile already on the account, so an edit starts from the learner's
   * own answers rather than a blank form. */
  currentProfile?: LearnerProfile | null;
  /** The plan does not open this path: the option carries the Premium mark. */
  fdeLocked?: boolean;
  /** The FDE manifest's `entryRequirement`, the one text the path page shows
   * too. Absent while the catalog loads, and the card then shows none. */
  fdeEntryRequirement?: string | null;
  onChoose: (result: PathPickerResult) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const t = useT();
  const [subject] = useSubject();
  const ids = useId();
  const seLabelId = `${ids}-se-label`;
  const seBlurbId = `${ids}-se-blurb`;
  const roleLegendId = `${ids}-role-legend`;
  // The parts of a specialization card read after its name.
  const roleIds = (option: RoleChoice) => ({
    current: `${ids}-${option}-current`,
    premium: `${ids}-${option}-premium`,
    blurb: `${ids}-${option}-blurb`,
    entry: `${ids}-${option}-entry`,
  });

  const [step, setStep] = useState<Step>('track');
  const [track, setTrack] = useState<Track>(current);
  const [role, setRole] = useState<RoleChoice>(currentSpecialization ?? 'none');
  const [softwareEngineer, setSoftwareEngineer] = useState(false);
  const [goals, setGoals] = useState<LearnerGoal[]>([]);
  const [experience, setExperience] = useState<ExperienceLevel | null>(null);
  const [studyTime, setStudyTime] = useState<StudyTime | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('track');
    setTrack(current);
    setRole(currentSpecialization ?? 'none');
    setSoftwareEngineer(currentProfile?.sections?.includes(SOFTWARE_ENGINEER) ?? false);
    setGoals(currentProfile?.goals ?? []);
    setExperience(EXPERIENCE_LEVELS.includes(currentProfile?.experience as ExperienceLevel)
      ? (currentProfile!.experience as ExperienceLevel)
      : null);
    setStudyTime(STUDY_TIMES.includes(currentProfile?.studyTime as StudyTime)
      ? (currentProfile!.studyTime as StudyTime)
      : null);
  }, [open, current, currentSpecialization, currentProfile]);

  const index = Math.max(0, STEPS.indexOf(step));
  const isLast = index === STEPS.length - 1;
  // The final step is the only one that can commit, and only once the three
  // required answers are there. Nothing is guessed on the learner's behalf.
  const canCommit = goals.length > 0 && experience !== null && studyTime !== null;

  const toggleGoal = (goal: LearnerGoal) =>
    setGoals((current) => current.includes(goal)
      ? current.filter((one) => one !== goal)
      : current.length >= MAX_LEARNER_GOALS ? current : [...current, goal]);

  const commit = () =>
    onChoose({
      track,
      specialization: role === 'none' ? null : role,
      // Any other saved section id is kept as it was; only Software Engineer
      // is this step's to add or remove.
      sections: [
        ...(currentProfile?.sections ?? []).filter((one) => one !== SOFTWARE_ENGINEER),
        ...(softwareEngineer ? [SOFTWARE_ENGINEER] : []),
      ],
      goals,
      experience: (experience ?? 'unsure') as ExperienceLevel,
      studyTime: (studyTime ?? '15-30') as StudyTime,
    });

  return (
    <Dialog
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      purpose="form"
      width="min(560px, 94vw)"
    >
      <DialogHeader
        title={pickerCopy(TITLE[step])}
        subtitle={pickerCopy(SUBTITLE[step])}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      />

      {error && (
        <div style={{ padding: '0 16px' }}>
          <div className="lp-notice lp-notice--error" role="alert">
            <span className="lp-notice__glyph" aria-hidden="true">
              !
            </span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {step === 'track' && (
        <RadioCardGroup
          value={track}
          onChange={(value) => setTrack(value as Track)}
          label={pickerCopy('home.pathDialogTitle')}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, width: '100%' }}
        >
          {TRACK_ORDER.map((tk) => {
            const selected = tk === track;
            return (
              <RadioCard
                key={tk}
                value={tk}
                index={TRACK_ORDER.indexOf(tk)}
                label={t(trackLabelKey(subject, tk))}
                width="100%"
                style={selected ? { background: 'var(--brand-accent-soft)' } : undefined}
              >
                <VStack gap={0.5}>
                  <HStack gap={1} align="center" justify="between">
                    <Heading level={4}>{t(trackLabelKey(subject, tk))}</Heading>
                    {tk === current && <Badge variant="cyan" label={pickerCopy('home.pathCurrent')} />}
                  </HStack>
                  <Text type="supporting" color="secondary">
                    {t(trackBlurbKey(subject, tk))}
                  </Text>
                </VStack>
              </RadioCard>
            );
          })}
        </RadioCardGroup>
      )}
      {step === 'sections' && (
        <div className="lp-sections">
          {/* A section is an opt-in, not one of a set: Software Engineer runs
              beside any track and beside the specialization, so it is the
              shared check card rather than another exclusive radio card. */}
          <CheckCard
            checked={softwareEngineer}
            onChange={() => setSoftwareEngineer((joined) => !joined)}
            labelledBy={seLabelId}
            describedBy={seBlurbId}
            className="lp-sections__check"
            style={softwareEngineer ? { background: 'var(--brand-accent-soft)' } : undefined}
          >
            <span className="lp-sections__box" aria-hidden="true" />
            <VStack gap={1}>
              <Heading level={4} id={seLabelId}>{pickerCopy('profile.section.software-engineer')}</Heading>
              <span id={seBlurbId} className="lp-sections__blurb">
                <Text type="supporting" color="secondary">{pickerCopy('paths.picker.seBlurb')}</Text>
                <Text type="supporting" size="xsm" color="secondary">{pickerCopy('paths.picker.seFree')}</Text>
              </span>
            </VStack>
          </CheckCard>

          {FDE_SECTION_VISIBLE && (
          <RadioCardGroup
            value={role}
            onChange={(value) => setRole(value as RoleChoice)}
            labelledBy={roleLegendId}
            style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}
          >
            <span id={roleLegendId} className="lp-sections__legend">{pickerCopy('paths.picker.specializationLegend')}</span>
            {ROLE_ORDER.map((option) => {
              const selected = option === role;
              const label = pickerCopy(option === 'none' ? 'paths.picker.noneLabel' : 'profile.section.forward-deployed-engineer');
              const isCurrent = option === (currentSpecialization ?? 'none');
              const premium = option === 'fde' && fdeLocked;
              const entry = option === 'fde' && fdeEntryRequirement ? fdeEntryRequirement : null;
              const part = roleIds(option);
              // `label` names the card, so its marks and lines are wired in as
              // the description: the Premium mark is heard before the choice.
              const describedBy = [
                isCurrent && part.current,
                premium && part.premium,
                part.blurb,
                entry && part.entry,
              ].filter(Boolean).join(' ');
              return (
                <RadioCard
                  key={option}
                  value={option}
                  index={ROLE_ORDER.indexOf(option)}
                  label={label}
                  describedBy={describedBy}
                  width="100%"
                  style={selected ? { background: 'var(--brand-accent-soft)' } : undefined}
                >
                  <VStack gap={1}>
                    <HStack gap={1} align="center" justify="between">
                      <Heading level={4}>{label}</Heading>
                      {isCurrent && (
                        <span id={part.current}><Badge variant="cyan" label={pickerCopy('home.pathCurrent')} /></span>
                      )}
                      {premium && <span id={part.premium} className="ss-premium-label">{t('premium.badge')}</span>}
                    </HStack>
                    <Text type="supporting" color="secondary" id={part.blurb}>
                      {pickerCopy(option === 'none' ? 'paths.picker.noneBlurb' : 'paths.picker.fdeBlurb')}
                    </Text>
                    {entry && (
                      <Text type="supporting" size="xsm" color="secondary" id={part.entry}>
                        {pickerCopy('paths.picker.fdeEntry', { requirement: entry })}
                      </Text>
                    )}
                  </VStack>
                </RadioCard>
              );
            })}
          </RadioCardGroup>
          )}
        </div>
      )}
      {step === 'profile' && (
        <div style={{ padding: 16, width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <fieldset className="lp-fieldset">
            <legend>{pickerCopy('profile.picker.goalsLegend')}</legend>
            <Text type="supporting" size="xsm" color="secondary">
              {pickerCopy('profile.picker.goalsHint', { max: MAX_LEARNER_GOALS })}
            </Text>
            <div className="lp-checks">
              {LEARNER_GOALS.map((goal) => {
                const checked = goals.includes(goal);
                return (
                  <label key={goal} className="lp-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      // A full set stops accepting new answers but never blocks
                      // clearing one, so the learner is not stuck at the cap.
                      disabled={!checked && goals.length >= MAX_LEARNER_GOALS}
                      onChange={() => toggleGoal(goal)}
                    />
                    <span>{pickerCopy(goalKey(goal))}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <RadioCardGroup
            value={experience}
            onChange={(value) => setExperience(value as ExperienceLevel)}
            label={pickerCopy('profile.picker.experienceLegend')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
          >
            <Text type="supporting" weight="bold">{pickerCopy('profile.picker.experienceLegend')}</Text>
            <Text type="supporting" size="xsm" color="secondary">{pickerCopy('profile.picker.experienceHint')}</Text>
            {EXPERIENCE_LEVELS.map((level, i) => (
              <RadioCard key={level} value={level} index={i} label={pickerCopy(experienceKey(level))} width="100%">
                <Text>{pickerCopy(experienceKey(level))}</Text>
              </RadioCard>
            ))}
          </RadioCardGroup>

          <RadioCardGroup
            value={studyTime}
            onChange={(value) => setStudyTime(value as StudyTime)}
            label={pickerCopy('profile.picker.studyTimeLegend')}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
          >
            <Text type="supporting" weight="bold">{pickerCopy('profile.picker.studyTimeLegend')}</Text>
            <Text type="supporting" size="xsm" color="secondary">{pickerCopy('profile.picker.studyTimeHint')}</Text>
            {STUDY_TIMES.map((band, i) => (
              <RadioCard key={band} value={band} index={i} label={pickerCopy(studyTimeKey(band))} width="100%">
                <Text>{pickerCopy(studyTimeKey(band))}</Text>
              </RadioCard>
            ))}
          </RadioCardGroup>

          {!canCommit && (
            <Text type="supporting" size="xsm" color="secondary" role="status">
              {pickerCopy('profile.picker.incomplete')}
            </Text>
          )}
        </div>
      )}

      <div className="lp-actions" style={{ padding: '0 16px 16px' }}>
        {index > 0 && (
          <Button variant="ghost" onClick={() => setStep(STEPS[index - 1])} isDisabled={busy} label={pickerCopy('paths.picker.back')} />
        )}
        <Button variant="ghost" onClick={onClose} isDisabled={busy} label={pickerCopy('paths.picker.cancel')} />
        {isLast ? (
          <Button variant="primary" onClick={commit} isDisabled={busy || !canCommit} label={busy ? t('paths.picker.saving') : pickerCopy('paths.picker.save')} />
        ) : (
          <Button variant="primary" onClick={() => setStep(STEPS[index + 1])} isDisabled={busy} label={pickerCopy('paths.picker.continue')} />
        )}
      </div>

      <div style={{ padding: '0 16px 16px' }}>
        <Text type="supporting" size="xsm" color="secondary">
          {pickerCopy(FOOTNOTE[step])}
        </Text>
      </div>
    </Dialog>
  );
}
