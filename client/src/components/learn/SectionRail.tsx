// A Learn section's topic rail, and what the map area says when nothing in
// the section is open yet.
//
// The rail is the radiogroup the Learn page always had. A locked topic stays
// listed with one lock signal (UX audit learn-07): the lock glyph on its
// second line, plus "Premium" where Premium opens it; "Locked" is in its
// accessible name only. A topic outside the plan because the learner has not
// joined the section is dimmed with "Not in your plan" (the header holds the
// join action). Neither is selectable; arrows can focus either to explain
// its exact prerequisite without opening it. A shared
// topic says which other sections list it; its progress line is the same
// record wherever it appears. How many topics are still locked, and how to
// open them, is said once, beside the skill check (`LockedNote`).

import type { CSSProperties } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { RadioCard, RadioCardGroup } from '../ui/RadioCards';
import { CategoryGlyph } from '../ui/techIcons';
import { SwimCta } from '../landing/LandingKit';
import { categoryLabelKey, getCategoryHexColor, onCategoryColorText } from '../../lib/categories';
import type { TranslationKey } from '../../i18n/translations';
import { learnText } from '../../i18n/translations.learn';
import { LEVELS_TO_UNLOCK_NEXT, TOPIC_PREREQS, passedLevelCount, type VerifiedProgress } from '../../../../shared/progression';
import type { RailEntry } from './sections';

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export const LockIcon = ({ size = 18 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/** The passed-step tick of the Learn map and a level's result. */
export const CheckIcon = ({ size = 22 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/** Columns for `count` tiles: as many rows as five a row needs, with the
 * tiles shared evenly across them (ten: 5 + 5, eight: 4 + 4, six: 3 + 3). */
export function railColumns(count: number): number {
  if (count <= 0) return 5;
  const rows = Math.ceil(count / 5);
  return Math.ceil(count / rows);
}

const railStyle = (count: number) => ({ ['--rm-rail-cols']: railColumns(count) } as CSSProperties);

export function SectionRail({
  sectionName,
  entries,
  value,
  onSelect,
  onInspect,
  loading,
  loadingCount,
  levelCounts,
  progress,
  t,
}: {
  sectionName: string;
  entries: readonly RailEntry[];
  value: string;
  onSelect: (topic: string) => void;
  onInspect?: (reason: string) => void;
  loading: boolean;
  loadingCount: number;
  levelCounts: Readonly<Record<string, number>>;
  progress: VerifiedProgress;
  t: TFn;
}) {
  if (loading) {
    return (
      <div className="rm-topic-rail" aria-busy="true" style={railStyle(loadingCount)}>
        {Array.from({ length: loadingCount }).map((_, i) => (
          <Skeleton key={i} width="100%" height={56} radius="rounded" index={i} />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Radiogroup semantics (not tabs: there is no tabpanel wiring), so
          assistive technology announces "N of M selected". */}
      {/* Only an open topic reads as chosen: with nothing open in the
          section, no card is checked. */}
      <RadioCardGroup value={entries.some((entry) => entry.topic === value && entry.state === 'open') ? value : null} onChange={(next) => onSelect(String(next))} label={t('roadmap.topicsAria')} orientation="horizontal" className="rm-topic-rail" style={railStyle(entries.length)}>
        {entries.map((entry, index) => {
          const { topic, state, premium } = entry;
          const color = getCategoryHexColor(topic);
          const label = t(categoryLabelKey(topic));
          const name = [
            state === 'open' ? label
              : state === 'locked' ? `${label} — ${t('roadmap.locked')}`
                : learnText('learn.rail.notJoinedAria', { topic: label, section: sectionName }),
            premium ? t('premium.badge') : null,
          ].filter(Boolean).join(', ');
          const missing = (TOPIC_PREREQS[topic] ?? []).filter((prereq) => passedLevelCount(progress, prereq) < LEVELS_TO_UNLOCK_NEXT);
          const reason = state === 'dimmed'
            ? learnText('learn.rail.notJoinedReason', { section: sectionName })
            : state === 'locked'
              ? [learnText('learn.rail.prerequisiteReason', {
                count: LEVELS_TO_UNLOCK_NEXT,
                topics: missing.map((prereq) => t(categoryLabelKey(prereq))).join(', '),
                topic: label,
              }), premium ? learnText('learn.rail.premiumReason') : null].filter(Boolean).join(' ')
              : '';
          return (
            <Tooltip key={topic} content={reason} placement="above" isEnabled={reason !== ''}>
              <RadioCard
                value={topic}
                index={index}
                unavailable={state !== 'open'}
                onUnavailable={(event) => { if (event.detail > 0) onInspect?.(reason); }}
                label={name}
                className={state === 'dimmed' ? 'rm-topic-pill rm-topic-pill--dimmed' : 'rm-topic-pill'}
                padding={2.5}
                style={{ ['--rm-accent']: color, ['--rm-on-accent']: onCategoryColorText(topic) } as CSSProperties}
                data-locked={state === 'locked'}
              >
                {/* Constant white chip under the logo: the selected pill fills
                    with the topic's own colour, which used to swallow a
                    same-coloured glyph. */}
                <span className="rm-topic-glyph">
                  <CategoryGlyph category={topic} color={color} size={20} />
                </span>
                <span className="rm-topic-text">
                  <span className="rm-topic-name">{label}</span>
                  <span className="rm-topic-progress">
                    {state === 'locked' && <span className="rm-topic-lock" aria-hidden><LockIcon size={13} /></span>}
                    {premium && <span className="ss-premium-label">{t('premium.badge')}</span>}
                    {/* Without the structure (its request failed) the level
                        count is unknown: an open topic shows no figure. */}
                    {state === 'open'
                      ? levelCounts[topic] === undefined ? null : <span className="rm-topic-count">{t('roadmap.progress', { done: passedLevelCount(progress, topic), total: levelCounts[topic] })}</span>
                      : state === 'dimmed' ? learnText('learn.rail.notJoined') : null}
                  </span>
                </span>
              </RadioCard>
            </Tooltip>
          );
        })}
      </RadioCardGroup>
    </>
  );
}

/** How much of the section is still closed, and how to open it, for the
 * skill-check row: the explanation sits beside the action it names (UX audit
 * learn-07). Dimmed topics are not counted: the join action opens them. */
export function LockedNote({ entries, t }: { entries: readonly RailEntry[]; t: TFn }) {
  const locked = entries.filter((entry) => entry.state === 'locked').length;
  if (locked === 0) return null;
  const reachable = entries.filter((entry) => entry.state !== 'dimmed').length;
  return (
    <p className="rm-topic-locked-note">
      <LockIcon size={13} />
      <span>
        {t('roadmap.topicsLockedCount', { locked, total: reachable })}{' '}
        {t('roadmap.topicsLockedHowTo', { count: LEVELS_TO_UNLOCK_NEXT })}
      </span>
    </p>
  );
}

/** The map area of a section with nothing open: which topic to pass to open
 * it, or, for a section the learner has not joined, that it is not in the
 * plan (the header holds the one action). It sits in the page's column on its
 * left edge, with no card of its own (UX audit learn-09). A gate ends on the
 * one row of next steps: the prerequisite as the primary and the skill check
 * beside it, so the page drops its separate skill-check row here. When the
 * header already offers the join, the prerequisite is a secondary, so the
 * screen keeps one filled primary. */
export function SectionEmpty(props:
  | { kind: 'gate'; prereq: string; topic: string; onGo: () => void; onSkillCheck: () => void; quiet?: boolean; t: TFn }
  | { kind: 'notMember'; name: string }) {
  if (props.kind === 'notMember') {
    return (
      <div className="rm-section-empty">
        <h2 className="rm-section-empty__title">{learnText('learn.notJoined.title', { name: props.name })}</h2>
        <p>{learnText('learn.notJoined.body')}</p>
      </div>
    );
  }
  const { prereq, topic, onGo, onSkillCheck, quiet = false, t } = props;
  const prereqLabel = t(categoryLabelKey(prereq));
  const goLabel = learnText('learn.empty.action', { prereq: prereqLabel });
  return (
    <div className="rm-section-empty">
      <h2 className="rm-section-empty__title">{learnText('learn.empty.title')}</h2>
      <p>{learnText('learn.empty.body', { count: LEVELS_TO_UNLOCK_NEXT, prereq: prereqLabel, topic: t(categoryLabelKey(topic)) })}</p>
      <div className="rm-section-empty__actions">
        {quiet
          ? <Button variant="secondary" label={goLabel} onClick={onGo} />
          : <SwimCta label={goLabel} onClick={onGo} />}
        <Button variant="secondary" label={learnText('learn.empty.skillCheck')} onClick={onSkillCheck} />
      </div>
    </div>
  );
}
