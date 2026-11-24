// The /roadmap "map": a curated, top-to-bottom path through the topics that
// actually matter for the chosen track (Frontend / Backend / Fullstack). The
// track is chosen on the page (CareerRoadmap) and passed in; the map flows from
// foundations at the top down to production concerns at the bottom. Every topic
// node is coloured by its brand/logo colour (matching the quiz + learn
// surfaces), carries a one-line "what you'll learn" detail, and branches into
// its 3 parts — each part pill reflects live progress and deep-links into
// /learn.

import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import type { RoadmapStructure, RoadmapTopic } from '../types/quiz';
import {
  useRoadmapProgress,
  useExtraUnlocks,
  isTopicUnlocked,
  passedLevelCount,
  partRanges,
  pathStatus,
  PARTS_PER_TOPIC,
  type PathStatus,
  type RoadmapProgress,
} from '../lib/roadmap';
import { tracksForActiveSubject, stageTitleKey, localizedTopicDetail, type Track } from '../lib/tracks';
import { categoryLabelKey, getCategoryHexColor, onCategoryColorText } from '../lib/categories';
import { useSubject } from '../lib/subjects';
import { useT } from '../i18n/LanguageContext';
import { useInPlan } from '../lib/eligibility';
import type { TranslationKey } from '../i18n/translations';
import './Roadmap.css';
import './RoadmapTree.css';

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

export default function RoadmapTree({ structure, track }: { structure: RoadmapStructure | null; track: Track }) {
  const t = useT();
  const [subject] = useSubject();
  const progress = useRoadmapProgress();
  const extraUnlocks = useExtraUnlocks();
  const extraSet = useMemo(() => new Set(extraUnlocks), [extraUnlocks]);
  // Signed in, the server serves nothing new outside the learner's plan; a
  // topic with passed levels stays reachable for review.
  const inPlan = useInPlan();
  const reachable = (family: RoadmapTopic) => inPlan(family) || passedLevelCount(progress, family) > 0;

  const def = tracksForActiveSubject()[track];
  const levelCountOf = (family: RoadmapTopic): number =>
    structure?.structure?.[family]?.levels.length ?? 0;

  // Only what the learner can actually open is drawn. A stage with nothing open
  // yet disappears with its connector rather than leaving a gap in the path.
  const visibleStages = def.stages
    .map((stage, index) => ({
      stage,
      index,
      topics: stage.topics.filter((family) => isTopicUnlocked(progress, family, extraSet) && reachable(family)),
    }))
    .filter((entry) => entry.topics.length > 0);
  const hiddenCount = def.stages.reduce((total, stage) => total + stage.topics.length, 0)
    - visibleStages.reduce((total, entry) => total + entry.topics.length, 0);

  return (
    // The map: stages flow top → bottom. Keyed by track so switching tracks
    // remounts and gently re-animates the new path into place.
    <div key={track} className="rm-track-in rm-map">
      {/* One row per stage (UX audit learn-17): the label column on the left
          holds the stage's number, its name and the connector down to the next
          stage, and its topic cards sit on the right, so a stage with one
          topic is one card tall instead of a centred card in an empty row.
          Stages are numbered as drawn: a hidden stage leaves no gap. */}
      <ol className="rm-map__stages">
        {visibleStages.map(({ stage, index, topics }, position) => (
          <li key={stage.title} className="rm-stage">
            <div className="rm-stage__label">
              <span aria-hidden="true" data-stage-dot className="rm-stage__dot">{position + 1}</span>
              <span className="rm-stage__title">{t(stageTitleKey(subject, track, index))}</span>
            </div>
            <div className="rm-stage__topics">
              {topics.map((family) => (
                <TopicCard
                  key={family}
                  family={family}
                  levelCount={levelCountOf(family)}
                  progress={progress}
                  extraSet={extraSet}
                  inPlan={inPlan(family)}
                  t={t}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>

      {/* Locked paths are not shown as dimmed teasers: a learner should see the
          plan they are actually on, plus one honest sentence about the rest. */}
      {hiddenCount > 0 && (
        <p className="rm-more-note" role="status">
          {t('roadmap.morePathsLater')}
        </p>
      )}
    </div>
  );
}

/** One topic node: colour-matched header, a detail line, and its 3 part pills. */
function TopicCard({
  family, levelCount, progress, extraSet, inPlan, t,
}: {
  family: RoadmapTopic;
  levelCount: number;
  progress: RoadmapProgress;
  extraSet: Set<RoadmapTopic>;
  /** Outside the plan, only parts with passed levels open, for review. */
  inPlan: boolean;
  t: TFn;
}) {
  const color = getCategoryHexColor(family);
  const unlocked = isTopicUnlocked(progress, family, extraSet);
  const ranges = partRanges(levelCount);
  const complete =
    ranges.length > 0 &&
    ranges.every((r) => pathStatus(progress, family, ranges, r.part, extraSet) === 'complete');
  const detail = localizedTopicDetail(t, family);

  return (
    <div
      style={{
        minWidth: 0,
        borderRadius: 8,
        border: `1px solid ${complete ? color : unlocked ? 'var(--color-border)' : 'transparent'}`,
        borderTop: `3px solid ${color}`,
        backgroundColor: 'var(--color-background-surface)',
        boxShadow: unlocked ? `0 1px 6px ${color}22` : 'none',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4.8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div aria-hidden style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
        <div style={{ fontSize: '0.875rem', fontWeight: 700, color: unlocked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', lineHeight: 1.2 }}>
          {t(categoryLabelKey(family))}
        </div>
        {complete && (
          <svg aria-hidden viewBox="0 0 24 24" style={{ width: 16, height: 16, marginLeft: 'auto', color: 'var(--ss-success-strong)' }}>
            <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {detail && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.4, minHeight: 32 }}>
          {detail}
        </div>
      )}

      <div style={{ display: 'flex', gap: 4, marginTop: 'auto', paddingTop: 2 }}>
        {(ranges.length > 0 ? ranges.map((r) => r.part) : Array.from({ length: PARTS_PER_TOPIC }, (_, i) => i + 1)).map((part) => {
          const opened: PathStatus = ranges.length > 0 ? pathStatus(progress, family, ranges, part, extraSet) : 'locked';
          const status: PathStatus = !inPlan && opened === 'available' ? 'locked' : opened;
          return <PartPill key={part} family={family} part={part} status={status} color={color} t={t} />;
        })}
      </div>
    </div>
  );
}

// A part cell stays a 31px cell to look at and takes a press across 44px
// (UX audit learn-18): this transparent layer reaches past the cell's top and
// bottom by half the difference, as the compact controls' ::before does in
// app-shell.css. Inside the link, so a press on it is a press on the cell; at
// 44px or taller (a touch screen) it adds nothing.
const PART_HIT_AREA: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 'calc((100% - var(--ss-control-height)) / 2)',
  bottom: 'calc((100% - var(--ss-control-height)) / 2)',
};
const hitArea = <span className="rm-part-pill__hit" aria-hidden="true" style={PART_HIT_AREA} />;

function PartPill({
  family, part, status, color, t,
}: {
  family: RoadmapTopic; part: number; status: PathStatus; color: string; t: TFn;
}) {
  const locked = status === 'locked';
  const complete = status === 'complete';
  const filled = complete;
  const stateLabel = t(
    complete ? 'roadmapTree.complete' : status === 'in-progress' ? 'roadmapTree.inProgress' : locked ? 'roadmapTree.locked' : 'roadmapTree.available',
  );
  const style: CSSProperties = {
    flex: 1,
    textAlign: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
    lineHeight: 1.4,
    padding: '6px 4px',
    borderRadius: 6,
    border: `1.5px solid ${locked ? 'var(--color-border)' : color}`,
    backgroundColor: filled ? color : status === 'in-progress' ? `${color}24` : 'transparent',
    color: filled ? onCategoryColorText(family) : locked ? 'var(--color-text-disabled)' : 'var(--color-text-primary)',
    textDecoration: 'none',
    cursor: locked ? 'default' : 'pointer',
    // Flex, so the number stays centred when a touch screen raises the pill
    // to 44px (app-shell.css).
    display: 'flex',
    // Holds the hit area below.
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const label = t('roadmapTree.partPill', { n: part });
  const title = `${t(categoryLabelKey(family))} · ${label} — ${stateLabel}`;
  if (locked) {
    // A disabled control, not an image: keyboard users can still reach it and
    // hear why it's inert.
    return (
      <Tooltip content={title} placement="above">
        <div role="button" aria-disabled="true" tabIndex={0} className="rm-part-pill" style={style} aria-label={title}>{part}{hitArea}</div>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={title} placement="above">
      <Link to={`/learn?topic=${family}&part=${part}`} className="rm-part-pill" style={style} aria-label={title}>
        {part}{hitArea}
      </Link>
    </Tooltip>
  );
}
