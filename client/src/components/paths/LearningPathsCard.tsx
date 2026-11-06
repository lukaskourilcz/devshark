// The Profile card that owns the track, the joined Learn sections and the
// specialization, and shows the learner's learning paths.
//
// Two operations, not one: saving the account preference and enrolling in a
// path are separate server calls, and either can fail on its own. The card
// says which one failed and offers to retry that one, because "saved" when
// only half of it landed is the kind of quiet lie that costs a learner their
// work later.
//
// The sections the card lists come from `learnerSections`: Web Developer with
// the track, Software Engineer from the saved opt-in, Forward Deployed Engineer
// with the specialization. Leaving Software Engineer saves an empty list, so
// its topics leave the plan (`planTopics`) while every passed level stays on
// the server.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/VStack';
import { Text } from '@astryxdesign/core/Text';
import { useAuth } from '../../lib/auth';
import { Kicker } from '../landing/LandingKit';
import { useT } from '../../i18n/LanguageContext';
import { friendlyError, isPremiumRequired } from '../../lib/api';
import { isBarred, useContentLocks } from '../../lib/contentLocks';
import { openUpgradeSheet } from '../../lib/upgradeSheet';
import { lazyShellPart } from '../../lib/routeRecovery';
import { ShellPartBoundary } from '../ShellPartBoundary';
import ErrorRetry from '../ErrorRetry';
import { useSubject } from '../../lib/subjects';
import { trackLabelKey, useTrack, type Track } from '../../lib/tracks';
import { learnerProfileOf, preferredLearningOf, profileGapsOf, saveLearningPreference } from '../../lib/trackPref';
import { pickerCopy, type PickerKey } from '../../i18n/translations.picker';
import PathPickerDialog, { type PathPickerResult } from '../PathPickerDialog';
import {
  changeEnrollment,
  entryFor,
  isOpen,
  learningPathKeys,
  pathHref,
  useEnrollments,
  usePathCatalog,
} from '../../lib/learningPaths';
import type { LearningPathId } from '../../../../shared/learning-paths';
import { FDE_SECTION_VISIBLE, isLearnSectionVisible, learnerSections, type LearnSectionId } from '../../../../shared/learn-sections';
import type { PathCatalogEntry } from '../../../../shared/learning-path-api';
import { MERCH_ENABLED } from '../../../../shared/rewards';
import './LearningPaths.css';
import { Button } from '@astryxdesign/core/Button';

// The reward's code stays out of the profile until a path is enrolled. Its
// boundary keeps the card when that code does not load, with a Retry.
const PathRewardClaim = lazyShellPart(() => import('./PathRewardClaim'));

const sectionName = (id: LearnSectionId) => pickerCopy(`profile.section.${id}` as PickerKey);

export default function LearningPathsCard() {
  const t = useT();
  const [subject] = useSubject();
  const { user, isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const [track, setTrack] = useTrack();
  const catalog = usePathCatalog(FDE_SECTION_VISIBLE);
  const enrollments = useEnrollments(FDE_SECTION_VISIBLE && isAuthenticated ? user?.id : undefined);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The Learn page's "Choose your plan" links to /profile#learning-plan. The
  // card sits below the fold on a phone, and lazy routes mount after the
  // browser's own hash jump, so bring it into view and focus it here.
  const anchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash !== '#learning-plan') return;
    anchorRef.current?.scrollIntoView({ block: 'start' });
    anchorRef.current?.focus({ preventScroll: true });
  }, []);

  const preference = useMemo(() => preferredLearningOf(user), [user]);
  const profile = useMemo(() => learnerProfileOf(user), [user]);
  const gaps = useMemo(() => profileGapsOf(user), [user]);
  // A signed-out visitor owes nothing: there is no account to personalise yet.
  const needsProfile = isAuthenticated && gaps.length > 0;
  const { lockOf } = useContentLocks();

  const fdeEntry = entryFor(catalog.data, 'fde');

  const enrollmentFor = useCallback(
    (pathId: LearningPathId) => enrollments.data?.enrollments.find((one) => one.pathId === pathId),
    [enrollments.data],
  );
  const barred = useCallback(
    (pathId: LearningPathId) => isBarred(lockOf({ kind: 'learning-path', pathId })),
    [lockOf],
  );

  // What the learner has chosen is the account preference or a path they are
  // running, whichever says so: a path started from its own page is chosen
  // here too, so saving the picker does not pause it.
  const fdeActive = enrollmentFor('fde')?.status === 'active';
  const specialization = preference?.specialization ?? (fdeActive ? 'fde' : null);
  const sections = learnerSections({ specialization, sections: profile?.sections }).filter(isLearnSectionVisible);

  const apply = useCallback(
    async (result: PathPickerResult) => {
      setBusy(true);
      setDialogError(null);
      setNotice(null);
      // The local track changes first so the roadmap reflects the choice even
      // if the account save fails; the failure is then reported, not hidden.
      setTrack(result.track);

      // Enrollment comes before the preference. Premium opens the paths, so a
      // path the plan does not open is left out of the saved preference rather
      // than recorded as the learner's role or path without the access to take
      // it; the upgrade sheet says why once the picker closes.
      const refused: LearningPathId[] = [];
      const follow = async (
        pathId: LearningPathId,
        entry: PathCatalogEntry | undefined,
        wants: boolean,
        wasChosen: boolean,
        baseTrack?: PathPickerResult['track'],
      ) => {
        // The plan decides before the catalog does: a path the plan does not
        // open is refused even while the catalog is loading or unavailable.
        // Enrollment is free under the current contract. A choice
        // the account already held is not asked about again.
        if (wants && !wasChosen && barred(pathId)) {
          refused.push(pathId);
          return;
        }
        if (!entry || !isOpen(entry.availability)) return;
        const existing = enrollmentFor(pathId);
        if (wants) {
          // Running already, or paused on its own page and left chosen here:
          // saving the picker changes neither.
          if (existing && (existing.status === 'active' || wasChosen)) return;
          if (barred(pathId)) return;
          try {
            await changeEnrollment({
              pathId,
              curriculumVersion: entry.manifest.version,
              ...(baseTrack ? { baseTrack } : {}),
              action: existing ? 'resume' : 'enroll',
            });
          } catch (error) {
            if (!isPremiumRequired(error)) throw error;
            refused.push(pathId);
          }
        } else if (existing && existing.status === 'active') {
          // Choosing none pauses it and keeps every result.
          await changeEnrollment({ pathId, curriculumVersion: entry.manifest.version, action: 'pause' });
        }
      };
      try {
        if (FDE_SECTION_VISIBLE) await follow('fde', fdeEntry, result.specialization === 'fde', specialization === 'fde', result.track);
        await queryClient.invalidateQueries({ queryKey: learningPathKeys.enrollments(user?.id) });
      } catch (error) {
        setBusy(false);
        setDialogError(`${pickerCopy('paths.picker.enrollFailed')} ${friendlyError(error)}`);
        return;
      }

      const savedSpecialization = refused.includes('fde') ? preference?.specialization ?? null : result.specialization;
      // Joining a section is free, so the sections are saved as chosen. The
      // full list goes every time: an empty one is how Software Engineer is
      // left, where leaving the field out would keep the saved list.
      const saved = await saveLearningPreference(
        user?.id ?? null,
        { schemaVersion: 1, baseTrack: result.track, specialization: savedSpecialization },
        {
          goals: result.goals,
          experience: result.experience,
          studyTime: result.studyTime,
          sections: result.sections,
        },
      );
      if (!saved.ok) {
        setBusy(false);
        // Only the track and the specialization are cached on the device, so the
        // message promises no more than that.
        setDialogError(saved.reason === 'not_signed_in' ? t('paths.signInToRecord') : pickerCopy('paths.picker.accountSaveFailed'));
        return;
      }

      // The plan changed, so anything derived from it — what is eligible, what
      // Today offers — is stale until it is refetched.
      await queryClient.invalidateQueries({ queryKey: ['eligibility'] });

      setBusy(false);
      setOpen(false);
      const added = learnerSections({ specialization: savedSpecialization, sections: result.sections })
        .filter((id) => id !== 'web-developer' && isLearnSectionVisible(id));
      const savedLine = t('profile.pathSaved', {
        track: t(trackLabelKey(subject, result.track)),
        role: added.map((id) => ` + ${sectionName(id)}`).join(''),
      });
      // The refused specialization is named in the notice as well as in the
      // upgrade sheet, which opens once, after the picker closes.
      setNotice(refused.includes('fde') ? `${savedLine}. ${pickerCopy('profile.fdeRefused')}` : savedLine);
      if (refused.length > 0) openUpgradeSheet({ kind: 'learning-path', ref: refused[0] });
    },
    [barred, enrollmentFor, fdeEntry, preference, queryClient, setTrack, specialization, subject, t, user?.id],
  );

  const activePaths = (FDE_SECTION_VISIBLE ? [fdeEntry] : []).filter(Boolean).map((entry) => {
    const manifest = entry!.manifest;
    const enrollment = enrollmentFor(manifest.id);
    return { manifest, entry: entry!, enrollment };
  });

  return (
    // The stock of every Profile card (UX audit social-account-17): .ss-panel,
    // 24px padding and a Kicker h2, so its title is no longer the weakest
    // text on the page.
    <div className="ss-panel lp-plan-anchor" id="learning-plan" ref={anchorRef} tabIndex={-1} style={{ padding: 24, width: '100%' }}>
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Kicker as="h2">{pickerCopy('profile.pathTitle')}</Kicker>
          <Text type="supporting" color="secondary">
            {pickerCopy('profile.pathHelp')}
          </Text>
        </VStack>

        {needsProfile && (
          <div className="lp-notice lp-notice--info" role="status">
            <span className="lp-notice__glyph" aria-hidden="true">!</span>
            <span>{pickerCopy('profile.completePrompt')}</span>
          </div>
        )}

        <div className="lp-profile-choice">
          <div className="lp-profile-choice__summary">
            <Text className="lp-profile-choice__value">{t(trackLabelKey(subject, track as Track))}</Text>
            <Text type="supporting" size="xsm" color="secondary" className="lp-profile-choice__value">
              {pickerCopy('profile.sectionsJoined', { sections: sections.map(sectionName).join(' · ') })}
            </Text>
          </div>
          <Button variant="secondary" onClick={() => setOpen(true)} label={needsProfile ? pickerCopy('profile.completeAction') : pickerCopy('profile.pathChoose')} />
        </div>

        {profile && !needsProfile && (
          <dl className="lp-profile-inventory">
            <dt>{pickerCopy('profile.inventory.goals')}</dt>
            <dd>{profile.goals.map((goal) => pickerCopy(`profile.goal.${goal}` as PickerKey)).join(' · ')}</dd>
            <dt>{pickerCopy('profile.inventory.experience')}</dt>
            <dd>{pickerCopy(`profile.experience.${profile.experience}` as PickerKey)}</dd>
            <dt>{pickerCopy('profile.inventory.studyTime')}</dt>
            <dd>{pickerCopy(`profile.studyTime.${profile.studyTime}` as PickerKey)}</dd>
          </dl>
        )}

        {notice && (
          <div className="lp-notice lp-notice--info" role="status">
            <span className="lp-notice__glyph" aria-hidden="true">
              ✓
            </span>
            <span>{notice}</span>
          </div>
        )}

        <ul className="lp-activities">
          {activePaths.map(({ manifest, entry, enrollment }) => (
            <li key={manifest.id}>
              <Link className="lp-activity" to={pathHref(manifest.id)}>
                <span className="lp-activity__kind">
                  {t('paths.kicker.role')}
                </span>
                {/* The status is a second line under the role name, so the
                    row never wraps it onto a line of its own (UX audit
                    social-account-18). */}
                <span className="de-role-text">
                <span className="lp-activity__title">{manifest.title}</span>
                <span className="lp-activity__minutes">
                  {/* A short state that fits its slot: closed, resume a paused
                      enrollment, in progress, or start; with the Premium mark
                      when the plan does not open the path. */}
                  {!isOpen(entry.availability)
                    ? t('roadmap.unavailable')
                    : enrollment
                      ? t(enrollment.status === 'paused' ? 'paths.action.resume' : 'paths.state.in_progress')
                      : t('paths.action.start')}
                  {isOpen(entry.availability) && barred(manifest.id) && (
                    <> <span className="ss-premium-label">{t('premium.badge')}</span></>
                  )}
                </span>
                </span>
              </Link>
              {/* Only ever visible once the server says the path is finished,
                  so a learner mid-path is not shown a prize they cannot take,
                  and never while merchandise is paused (MERCH_ENABLED). */}
              {MERCH_ENABLED && enrollment && (
                <Suspense fallback={null}>
                  <ShellPartBoundary fallback={(retry, busy) => <ErrorRetry message={t('paths.rewardLoadFailed')} onRetry={retry} busy={busy} />}>
                    <PathRewardClaim pathId={manifest.id} />
                  </ShellPartBoundary>
                </Suspense>
              )}
            </li>
          ))}
        </ul>
      </VStack>

      <PathPickerDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setDialogError(null);
        }}
        current={track as Track}
        currentSpecialization={specialization}
        currentProfile={profile}
        fdeLocked={barred('fde')}
        fdeEntryRequirement={fdeEntry?.manifest.entryRequirement}
        onChoose={(result) => void apply(result)}
        busy={busy}
        error={dialogError}
      />
    </div>
  );
}
