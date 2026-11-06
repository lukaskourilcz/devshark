// "Roadmap" — an honest, market-grounded picture of what it takes to become a
// senior full-stack engineer, wired to the learner's actual progress on the
// devShark learning path. It deliberately separates "what devShark can teach
// you" (the five knowledge pillars, with live completion %) from "what only the
// real world can" (the Beyond list) so the page never over-promises.
//
// Redesigned on the Astryx design system: Astryx typography, tinted Cards, a
// SegmentedControl track chooser, ProgressBars and Badges — all logic, hooks and
// i18n preserved verbatim.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { VStack } from '@astryxdesign/core/VStack';
import { HStack } from '@astryxdesign/core/HStack';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Divider } from '@astryxdesign/core/Divider';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { SegmentedControl } from '@astryxdesign/core/SegmentedControl';
import { SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { useT } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import {
  useRoadmapProgress,
  passedLevelCount,
  syncProgressWithServer,
  useExtraUnlocks,
} from '../lib/roadmap';
import { roadmapStructureQuery, useRoadmapStructure } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import { enrollmentsQuery, pathCatalogQuery } from '../lib/learningPaths';
import { readOnce, settled, useFirstData } from '../lib/routeData';
import { useTrack, trackTopics, rankLabelKeyFor, trackLabelKey, trackBlurbKey, TRACK_ORDER, type Track } from '../lib/tracks';
import { preferredLearningOf, saveLearningPreference } from '../lib/trackPref';
import { eligibilityKeys, useInPlan, useLearnerSections } from '../lib/eligibility';
import { useContentLocks } from '../lib/contentLocks';
import { VISIBLE_LEARN_SECTIONS as LEARN_SECTIONS } from '../../../shared/learn-sections';
import { railEntries, sectionProgress } from './learn/sections';
import { useFdeOpenInSettings, useFdePathSteps } from './learn/useFdePathSteps';
import { learnText } from '../i18n/translations.learn';
import { categoryLabelKey, getCategoryHexColor } from '../lib/categories';
import { useSubject } from '../lib/subjects';
import type { RoadmapTopic } from '../types/quiz';
import { useTotalXp } from '../lib/xp';
import { levelForXp, getCareerRanks } from '../lib/leveling';
import RoadmapTree from './RoadmapTree';
import { LearnPageHeader } from './learn/LearnPageHeader';
import LoadingScreen from './LoadingScreen';
import ErrorRetry from './ErrorRetry';
import './DeepEndScreens.css';
import './CareerRoadmap.css';

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** Hold the page's first draw for the structure only (perf baseline #587
 * C25). It also waited for the 30 KB path catalogue and the account's
 * enrollments, which only the FDE group's figure reads; that figure says
 * "Loading…" in its own line until they land (useFdePathSteps). They start
 * beside the structure while the path may be open, and not at all while the
 * settings say it is closed (C06, C20). */
function useRoadmapFirstData() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const path = useFdeOpenInSettings();
  useFirstData(`roadmap ${user?.id ?? ''}`, () => {
    if (path === 'open' || path === 'unknown') {
      void queryClient.prefetchQuery({ ...pathCatalogQuery, retry: false });
      if (user) void queryClient.prefetchQuery({ ...enrollmentsQuery(user.id), retry: false });
    }
    return settled([readOnce(queryClient, roadmapStructureQuery)]);
  });
}

// Tinted Card variants cycle across the pillars so each knowledge area reads as
// its own category — adapts to light/dark automatically. The tint alone is the
// differentiator; pillar titles stay clean text.
// The pillars used to cycle through green, blue, teal and orange card
// backgrounds — five banners in four colours, one under the other. It read as a
// palette rather than as a page, and it said nothing: the colour was the
// pillar's position in an array, not anything about the pillar.
//
// They share one surface now, and the colour that remains is the colour that
// means something — each area's own topic accent on its dot, and the progress
// bar that turns when the area is finished. Deep End keeps its accents
// disciplined and its cards few; this is both.

interface Area {
  topic: RoadmapTopic;
  label: string;
}
interface Pillar {
  id: string;
  title: string;
  areas: Area[];
}

// Web Dev keeps its curated, market-framed pillars (copy in careerRoadmap.*).
function webdevPillars(t: TFn): Pillar[] {
  const area = (topic: RoadmapTopic): Area => ({
    topic,
    label: t(`careerRoadmap.area.${topic}.label` as TranslationKey),
  });
  const p = (id: string, areas: Area[]): Pillar => ({
    id,
    title: t(`careerRoadmap.pillar.${id}.title` as TranslationKey),
    areas,
  });
  return [
    p('foundations', [area('html'), area('css'), area('javascript'), area('typescript')]),
    p('frameworks', [area('react'), area('nextjs')]),
    p('backend', [area('nodejs'), area('general')]),
    p('cs', [area('dsa'), area('algorithms')]),
    p('production', [area('databases'), area('system-design'), area('testing'), area('devops'), area('security')]),
  ];
}

// The honest part: things a quiz app genuinely cannot give you. Seniority is
// mostly this list plus years of shipping.
const BEYOND: { id: string; labelKey: TranslationKey; detailKey: TranslationKey }[] = [
  { id: 'production', labelKey: 'careerRoadmap.beyond.production.label', detailKey: 'careerRoadmap.beyond.production.detail' },
  { id: 'communication', labelKey: 'careerRoadmap.beyond.communication.label', detailKey: 'careerRoadmap.beyond.communication.detail' },
  { id: 'leadership', labelKey: 'careerRoadmap.beyond.leadership.label', detailKey: 'careerRoadmap.beyond.leadership.detail' },
];

const SENIOR_RANK_TITLE = 'Senior Developer';

/** A whole percent, rounded as the section figures are (sectionProgress in
 * learn/sections.ts): 100 only once every level is passed, and at least 1 once
 * one is. Math.round showed 199 of 200 levels as a finished 100%. */
function pct(passed: number, total: number): number {
  if (total <= 0) return 0;
  const percent = Math.floor((100 * passed) / total);
  return percent === 0 && passed > 0 ? 1 : percent;
}

export default function CareerRoadmap() {
  useRoadmapFirstData();
  const t = useT();
  const progress = useRoadmapProgress();
  const totalXp = useTotalXp();
  // Shared (cached, de-duped with /learn) roadmap structure for level counts.
  const structureQuery = useRoadmapStructure();
  const structure = structureQuery.data ?? null;
  // The chosen track drives this whole page — map, pillars and headline %.
  const [track, setTrack] = useTrack();
  const [subject] = useSubject();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [savingTrack, setSavingTrack] = useState(false);
  const [trackNotice, setTrackNotice] = useState<string | null>(null);

  // Signed in, the track is the plan on the account, the one the server holds
  // Learn and Today to (a topic outside it answers 403 not_in_plan). Changing
  // it here changes it there too, or the map would show one track while every
  // level of it was refused. Signed out, it only chooses what the map shows.
  // The chooser is disabled while a save runs, but that reaches React a
  // render after the click: a second choice in between started a second save
  // that could land first and leave the account on the other track.
  const savingRef = useRef(false);
  const chooseTrack = async (next: Track) => {
    if (savingRef.current) return;
    setTrack(next);
    setTrackNotice(null);
    if (!user) return;
    savingRef.current = true;
    setSavingTrack(true);
    const epoch = accountEpoch();
    try {
      const saved = await saveLearningPreference(user.id, {
        schemaVersion: 1,
        baseTrack: next,
        specialization: preferredLearningOf(user)?.specialization ?? null,
      });
      // The account signed out during the save (as Learn's section join
      // checks): its outcome is not this page's to announce.
      if (accountEpoch() !== epoch) return;
      if (saved.ok) await queryClient.invalidateQueries({ queryKey: eligibilityKeys.all });
      setTrackNotice(saved.ok
        ? t('profile.pathSaved', { track: t(trackLabelKey(subject, next)), role: '' })
        : t('paths.picker.saveFailed'));
    } finally {
      savingRef.current = false;
      setSavingTrack(false);
    }
  };
  const pillars = useMemo(() => webdevPillars(t), [t]);

  const pageTitle = t('roadmapPage.title');
  const headerBody = t('careerRoadmap.headerBody');

  // Sync account progress so the percentages are accurate even on a fresh device.
  useEffect(() => {
    syncProgressWithServer().catch(() => {});
  }, []);

  const levelsFor = (topic: RoadmapTopic): number => structure?.structure?.[topic]?.levels.length ?? 0;
  const inPlan = useInPlan();
  const { hasPlan, members } = useLearnerSections();
  const extraUnlocks = useExtraUnlocks();
  // Kept per structure, as on /learn: useContentLocks memoises its content index on
  // this object, and a fresh one each render rebuilt the index and lockOf.
  const levelCounts = useMemo(
    () => Object.fromEntries(Object.entries(structure?.structure ?? {}).map(([topic, data]) => [topic, data.levels.length])),
    [structure],
  );
  const extraUnlocksSet = useMemo(() => new Set(extraUnlocks), [extraUnlocks]);
  const { lockOf } = useContentLocks(levelCounts);
  const fde = useFdePathSteps();
  const sectionGroups = LEARN_SECTIONS.map((section) => {
    const entries = railEntries(section.id, {
      liveTopics: Object.keys(levelCounts), inPlan, hasPlan, isMember: members.includes(section.id),
      progress, extraUnlocks: extraUnlocksSet, lockOf,
    });
    const shown = new Set(entries.map((entry) => entry.topic));
    const grouped = pillars.map((pillar) => ({ ...pillar, areas: pillar.areas.filter((area) => shown.has(area.topic)) }))
      .filter((pillar) => pillar.areas.length > 0);
    const covered = new Set(grouped.flatMap((pillar) => pillar.areas.map((area) => area.topic)));
    const extra = entries.filter((entry) => !covered.has(entry.topic as RoadmapTopic)).map((entry) => ({
      topic: entry.topic as RoadmapTopic, label: t(categoryLabelKey(entry.topic)),
    }));
    if (extra.length) grouped.push({ id: 'other', title: learnText('career.section.topics'), areas: extra });
    const figure = sectionProgress(entries, progress, levelCounts, section.id === 'forward-deployed-engineer' ? fde.steps : null);
    return { section, pillars: grouped, figure };
  });
  // A topic is listed once (UX audit learn-16), under the first section that
  // holds it, with the other sections that hold it as a small "Also in" tag;
  // the section's progress figure still counts every topic it holds.
  const sectionsOfTopic = new Map<RoadmapTopic, (typeof LEARN_SECTIONS)[number]['id'][]>();
  for (const { section, pillars: sectionPillars } of sectionGroups) {
    for (const area of sectionPillars.flatMap((pillar) => pillar.areas)) {
      const ids = sectionsOfTopic.get(area.topic) ?? [];
      if (!ids.includes(section.id)) ids.push(section.id);
      sectionsOfTopic.set(area.topic, ids);
    }
  }
  const groups = sectionGroups.map((group) => ({
    ...group,
    pillars: group.pillars
      .map((pillar) => ({
        ...pillar,
        areas: pillar.areas
          .filter((area) => sectionsOfTopic.get(area.topic)?.[0] === group.section.id)
          .map((area) => ({ ...area, alsoIn: (sectionsOfTopic.get(area.topic) ?? []).slice(1) })),
      }))
      .filter((pillar) => pillar.areas.length > 0),
  }));

  // Aggregate completion across every topic of the chosen track, the stages
  // the map below draws. The pillars name only the curated areas, so counting
  // through them left Git and AI & LLMs, which every track holds, out of it.
  const overall = useMemo(() => {
    let passed = 0;
    let total = 0;
    for (const topic of trackTopics(track)) {
      const count = levelsFor(topic);
      total += count;
      passed += Math.min(passedLevelCount(progress, topic), count);
    }
    return { passed, total, pct: pct(passed, total) };
  }, [progress, structure, track]); // eslint-disable-line react-hooks/exhaustive-deps

  const info = levelForXp(totalXp);
  const rankKeys = rankLabelKeyFor(info.rank, track);
  const rankTitle = t(rankKeys.key, rankKeys.vars);
  const seniorRank = getCareerRanks().find((r) => r.title === SENIOR_RANK_TITLE);
  const reachedSenior = seniorRank ? totalXp >= seniorRank.minXp : false;
  const xpToSenior = seniorRank ? Math.max(0, seniorRank.minXp - totalXp) : 0;

  if (structureQuery.isPending) return <LoadingScreen label={t('common.loading')} />;
  if (structureQuery.error && !structure) {
    return <ErrorRetry message={t('roadmap.error')} onRetry={() => void structureQuery.refetch()} />;
  }

  return (
    // The route shell sets the 800px column (UX audit learn-15): no width of
    // its own, and the Learn page header, as on /learn and Big O.
    <div className="career-roadmap">
      <VStack gap={4}>
        <LearnPageHeader title={pageTitle} lead={headerBody} />

        {/* Track chooser — drives the headline %, the map and the pillars below. */}
        <VStack gap={1.5} align="center">
          <Text type="label" color="secondary">
            {t('careerRoadmap.chooseTrack')}
          </Text>
          <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
            <SegmentedControl
              value={track}
              onChange={(v) => void chooseTrack(v as Track)}
              label={t('careerRoadmap.chooseTrack')}
              size="lg"
              isDisabled={savingTrack}
              disabledMessage={t('paths.picker.saving')}
            >
              {TRACK_ORDER.map((tk) => (
                <SegmentedControlItem key={tk} value={tk} label={t(trackLabelKey(subject, tk))} />
              ))}
            </SegmentedControl>
          </div>
          <Text type="supporting" color="secondary" justify="center">
            {t(trackBlurbKey(subject, track))}
          </Text>
          <div role="status" aria-live="polite">
            {trackNotice && (
              <Text type="supporting" size="xsm" color="secondary" justify="center">
                {trackNotice}
              </Text>
            )}
          </div>
        </VStack>

        {/* Where you are now — the headline stat for the chosen track. */}
        <div className="ss-raised ss-pop" style={{ display: 'flex', width: '100%' }}>
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-container)', width: '100%' }}>
          <Card variant="muted" padding={5} width="100%">
          <VStack gap={2}>
            {/* The segment above is the only track label (learn-16). */}
            <Text type="label" color="secondary">
              {t('careerRoadmap.progressTitle')}
            </Text>

            <HStack gap={2} align="end" wrap="wrap">
              <Text type="display-1" color="accent" weight="bold">
                {overall.pct}%
              </Text>
              <div style={{ flex: '1 1 200px', minWidth: 0, paddingBottom: 8 }}>
                <Text type="supporting" color="secondary">
                  {t('careerRoadmap.progressCaption', {
                    passed: overall.passed,
                    total: overall.total || '…',
                  })}
                </Text>
              </div>
            </HStack>

            <ProgressBar
              label={t('careerRoadmap.progressTitle')}
              value={overall.pct}
              variant="accent"
              isLabelHidden
            />

            <HStack gap={1} align="center" wrap="wrap">
              <Badge variant="neutral" label={rankTitle} />
              <Text type="supporting" size="xsm" color="secondary">
                {reachedSenior
                  ? t('careerRoadmap.seniorReached')
                  : t('careerRoadmap.xpToSenior', { xp: xpToSenior.toLocaleString() })}
              </Text>
            </HStack>
          </VStack>
        </Card>
        </div>
        </div>

        {/* The full roadmap as a dependency tree, each topic branched into its 3
            parts, coloured by the learner's live progress. */}
        <div className="ss-raised" style={{ display: 'flex', width: '100%' }}>
        <Card variant="default" padding={5} width="100%">
          <VStack gap={2}>
            <VStack gap={0.5}>
              <Heading level={2}>
                {t('roadmapPage.treeTitle')}
              </Heading>
              <Text type="supporting" color="secondary">
                {t('roadmapPage.treeIntro')}
              </Text>
            </VStack>
            <RoadmapTree structure={structure} track={track} />
          </VStack>
        </Card>
        </div>

        {/* The pillars, filtered to the chosen track (empty pillars are hidden).
            One shared CTA up top instead of repeating it under every pillar. */}
        {groups.map(({ section, pillars: sectionPillars, figure }) => (
        <section key={section.id} aria-labelledby={`career-${section.id}`} style={{ width: '100%' }}>
          <VStack gap={2}>
            <HStack justify="between" align="center" gap={1} wrap="wrap">
              {/* A text-colour heading with the accent arrow, not the
                  browser's blue link (learn-15). */}
              <Heading level={2} id={`career-${section.id}`}>
                <Link className="career-section__link" to={`/learn/${section.id}`}>
                  {learnText(`learn.section.${section.id}`)}
                </Link>
              </Heading>
              <Text type="supporting" color="secondary">
                {section.id === 'forward-deployed-engineer' && fde.pending
                  ? t('common.loading')
                  : learnText('career.section.progress', { passed: figure.passed, total: figure.total })}
              </Text>
            </HStack>
            <Text type="supporting" color="secondary">{learnText(`learn.section.line.${section.id}`)}</Text>
            {/* One compact list per section (learn-16): a pillar heading, then
                one 44px row per topic with its levels and bar. The groups
                size to their content (align-items: start). */}
            {sectionPillars.length > 0 ? (
              <div className="ss-panel career-pillars">
                {sectionPillars.map((pillar) => {
                  const areas = pillar.areas;
                  let pPassed = 0;
                  let pTotal = 0;
                  for (const area of areas) {
                    pTotal += levelsFor(area.topic);
                    pPassed += Math.min(passedLevelCount(progress, area.topic), levelsFor(area.topic));
                  }
                  const pPct = pct(pPassed, pTotal);
                  return (
                    <div key={pillar.id} className="career-pillar">
                      <div className="career-pillar__head">
                        <Heading level={3}>{pillar.title}</Heading>
                        <Badge variant={pPct === 100 ? 'success' : 'neutral'} label={`${pPct}%`} />
                      </div>
                      <ul className="career-topics">
                        {areas.map((area) => {
                          const total = levelsFor(area.topic);
                          const passed = Math.min(passedLevelCount(progress, area.topic), total);
                          const aPct = pct(passed, total);
                          return (
                            <li key={area.topic} className="career-topic">
                              <span className="career-topic__name">
                                <span aria-hidden className="career-topic__dot" style={{ backgroundColor: getCategoryHexColor(area.topic) }} />
                                <span className="career-topic__label">{area.label}</span>
                                {area.alsoIn.length > 0 && (
                                  <span className="career-topic__also">
                                    {t('careerRoadmap.alsoIn', { sections: area.alsoIn.map((id) => learnText(`learn.section.${id}`)).join(', ') })}
                                  </span>
                                )}
                              </span>
                              <span className="career-topic__bar">
                                <ProgressBar label={area.label} value={aPct} variant={aPct === 100 ? 'success' : 'accent'} isLabelHidden />
                              </span>
                              <span className="career-topic__count">
                                {total ? t('careerRoadmap.areaLevels', { passed, total }) : '—'}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Text type="supporting" color="secondary">{t('careerRoadmap.allListedAbove')}</Text>
            )}
          </VStack>
        </section>
        ))}

        {/* The honest gap: what engineering seniority takes beyond this app. */}
        <div className="ss-raised" style={{ display: 'flex', width: '100%' }}>
        <Card variant="muted" padding={5} width="100%">
          <VStack gap={1.5}>
            <Heading level={2}>{t('careerRoadmap.beyondTitle')}</Heading>
            <Text type="supporting" color="secondary">
              {t('careerRoadmap.beyondIntro')}
            </Text>
            <Divider variant="subtle" />
            <VStack gap={1.5}>
              {BEYOND.map((b) => (
                <HStack key={b.id} gap={1.5} align="start">
                  <span aria-hidden style={{ color: 'var(--brand-accent)', fontWeight: 700, lineHeight: 1.4 }}>○</span>
                  <VStack gap={0}>
                    <Text type="body" weight="semibold">{t(b.labelKey)}</Text>
                    <Text type="supporting" size="xsm" color="secondary">{t(b.detailKey)}</Text>
                  </VStack>
                </HStack>
              ))}
            </VStack>
          </VStack>
        </Card>
        </div>

        <Text type="supporting" size="xsm" color="secondary" justify="center">
          {t('careerRoadmap.footer')}
        </Text>
      </VStack>
    </div>
  );
}
