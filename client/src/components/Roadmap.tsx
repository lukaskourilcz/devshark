import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Kicker } from './landing/LandingKit';
import { retirementOf } from '../../../shared/retired-content';
import { Text } from '@astryxdesign/core/Text';
import { Banner } from '@astryxdesign/core/Banner';
import { Button as AxButton } from '@astryxdesign/core/Button';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { AppToast } from './ui/AppToast';
import type {
  RoadmapTopic,
  RoadmapLevelMeta,
  RoadmapPlayable,
  RoadmapStructure,
  Question,
} from '../types/quiz';
import type { LearnRepeatXp } from '../../../shared/repeat-xp';
import {
  fetchRoadmapLevel,
  fetchRoadmapPartTest,
  applySkillCheckReceipt,
  recordLevelResult,
  recordPartTestResult,
  useRoadmapProgress,
  isLevelPassed,
  isPartLevelUnlocked,
  isPartTestUnlocked,
  isPartTestPassed,
  levelBestPct,
  partTestBestPct,
  passedLevelCount,
  partRanges,
  currentPart,
  isPathUnlocked,
  pathStatus,
  PARTS_PER_TOPIC,
  getRoadmapProgress,
  unlockExtraTopics,
  useExtraUnlocks,
  getExtraUnlocks,
  topicsFromAssessment,
  type PartRange,
} from '../lib/roadmap';
import { availabilityOf } from '../lib/roadmap';
import { useSubject, topicsForSubject, type SubjectId } from '../lib/subjects';
import {
  masteryState,
  isDueForReview,
  distinctPassDays,
  type MasteryState,
  type LevelMasteryEntry,
} from '../../../shared/mastery';
import type { PlacementReview } from '../../../shared/assessment';
import { useRoadmapStructure, useRoadmapStructureFirst } from '../lib/queries';
import { apiFetch } from '../lib/api';
import { announceLearnRepeat, awardLearningOutcome } from '../lib/xp';
import { computeLearningXp } from '../lib/leveling';
import { getCategoryHexColor, categoryLabelKey, onCategoryColorText } from '../lib/categories';
import { BRAND } from '../theme/MuiTheme';
import { useLanguage } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { learnText } from '../i18n/translations.learn';
import { LessonError, LessonReader, LessonRunner, LessonStage, loadLessonRunner, preloadLessonReader, preloadLessonRunner } from './learn/lessonParts';
import { prefetchLearnLesson } from './learn/lessonQuery';
import { useAuth } from '../lib/auth';
import { accountEpoch } from '../lib/accountData';
import { friendlyError, isPremiumRequired } from '../lib/api';
import { NO_PENDING, useInPlan, useLearnerSections, type PendingJoin } from '../lib/eligibility';
import { entryFor, isOpen, useEnrollments, usePathCatalog } from '../lib/learningPaths';
import { openSignIn } from '../lib/signInDialog';
import { learnerProfileOf } from '../lib/trackPref';
import { LEARN_SECTIONS, LEARN_SECTION_IDS, type LearnSectionId } from '../../../shared/learn-sections';
import {
  SECTION_KEY,
  SECTION_TOPIC_KEY,
  firstSelectable,
  railEntries,
  resolveSection,
  sectionGate,
  sectionProgress,
  sectionTopics,
  type RailEntry,
} from './learn/sections';
import { SectionHeader, SectionSwitcher, type JoinState } from './learn/SectionSwitcher';
import { CheckIcon, LockIcon, LockedNote, SectionEmpty, SectionRail } from './learn/SectionRail';
import { joinFde, joinSoftwareEngineer } from './learn/joinSection';
import { useFdePathSteps } from './learn/useFdePathSteps';
import { useMapReadsBesideHold } from './learn/mapReads';
import { useOnline } from './learn/useOnline';
import { nextLearnStep, type LearnStep as Active } from './learn/nextStep';
import { isBarred, useContentLocks, type NonCodingContent } from '../lib/contentLocks';
import { openUpgradeSheet } from '../lib/upgradeSheet';
import { gatedRef } from '../../../shared/tiers';
import { readJSON, readString, writeJSON, writeString } from '../lib/storage';
import { preloadCodeHighlighter, renderQuestion } from './CodeBlock';
import { hasCodeQuestions } from './learn/codeTopics';
import { DelayedQuoteLoader, revealWhenReady } from './learn/LevelLoader';
import { IconTile, BoltIcon, TrophyIcon } from './ui/icons';
import { SwimCta } from './landing/LandingKit';
import { lazyShellPart } from '../lib/routeRecovery';
import { ShellPartBoundary } from './ShellPartBoundary';
import { CategoryTag } from './ui/CategoryTag';
import {
  AnswerOptionList,
  ExitIcon,
  QuestionActions,
  QuestionHeader,
  QuestionIconButton,
  QuestionShell,
} from './question';
import ErrorRetry from './ErrorRetry';
import { localDayChangeTime } from '../lib/utcDay';
import './Roadmap.css';
import './DeepEndScreens.css';

// Keep path screens and their styles outside the normal topic chunk.
const PathShelf = lazyShellPart(() => import('./paths/PathShelf'));

// An open level's runner and a DSA level's reading load only when a level
// opens or the learner reaches for one (learn/lessonParts.tsx).
/** A step a press opens: an enabled level or part test on the map, or the
 * next-step card's action. A Premium node opens the upgrade sheet instead. */
const STEP_CONTROL = '.rm-path-canvas button:not([disabled]):not([aria-disabled="true"]), .rm-overview-card button';
/** A step whose level opens with a reading (`data-lesson`). */
const READING_STEP = '[data-lesson]';
/** A step of a topic whose questions carry code (`data-code`). */
const CODE_STEP = '[data-code]';
const savesData = (): boolean => (navigator as { connection?: { saveData?: boolean } }).connection?.saveData === true;
/**
 * The runner's code starts loading when the learner shows they are about to
 * open a step (perf baseline #587 C28): a mouse resting on it, keyboard focus,
 * or a press. It used to start on the click, beside the level's own request.
 * In a topic whose questions carry code the code highlighter starts with it;
 * it used to load as the first code question drew. A visitor who asked the
 * browser to save data loads both on the press only, as the route preloads
 * do (lib/routePreload.ts).
 */
function warmRunnerOnIntent(event: { type: string; target: EventTarget | null; nativeEvent: Event }): void {
  if (!(event.target instanceof Element) || !event.target.closest(STEP_CONTROL)) return;
  const press = event.type === 'pointerdown' || event.type === 'touchstart';
  if (event.type === 'pointerover' && (event.nativeEvent as PointerEvent).pointerType !== 'mouse') return;
  if (!press && savesData()) return;
  preloadLessonRunner();
  if (event.target.closest(CODE_STEP)) preloadCodeHighlighter();
  // Only DSA levels open with a reading (#587 C19).
  if (event.target.closest(READING_STEP)) preloadLessonReader();
}
const RUNNER_INTENT = {
  onPointerOver: warmRunnerOnIntent,
  onFocus: warmRunnerOnIntent,
  onPointerDown: warmRunnerOnIntent,
  onTouchStart: warmRunnerOnIntent,
} as const;

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// The roadmap topic list is scoped to the active subject (see subjects.ts);
// each subject exposes its own ordered set of Learn topics.
const TOPIC_KEY = 'devquiz:roadmap:topic';
const readSectionTopic = (section: LearnSectionId): string | null =>
  readJSON<Partial<Record<LearnSectionId, string>>>(SECTION_TOPIC_KEY, {})[section] ?? null;
const writeSectionTopic = (section: LearnSectionId, topic: string): void =>
  writeJSON(SECTION_TOPIC_KEY, { ...readJSON<Partial<Record<LearnSectionId, string>>>(SECTION_TOPIC_KEY, {}), [section]: topic });
const PART_KEY = 'devquiz:roadmap:part';
const CHECKPOINT_GOLD = BRAND.gold;
const CHECKPOINT_GRAD: [string, string] = ['#ffd54f', BRAND.gold];

// Per-topic path colour. The path takes its base hue from the chosen category
// (JavaScript → yellow, React → cyan, …) so each topic feels distinct, and
// each difficulty tier (1→5) shades the base slightly darker so the easy→hard
// progression is still readable inside one topic. `solid` drives borders/glows/
// connectors; `grad` is the [light, dark] fill gradient for completed nodes.
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function mix(hex: string, target: [number, number, number], ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(
    r * (1 - ratio) + target[0] * ratio,
    g * (1 - ratio) + target[1] * ratio,
    b * (1 - ratio) + target[2] * ratio,
  );
}
const lighten = (hex: string, ratio = 0.25) => mix(hex, [255, 255, 255], ratio);
const darken = (hex: string, ratio = 0.25) => mix(hex, [0, 0, 0], ratio);
function bandForCategory(topic: RoadmapTopic, difficulty: number) {
  const base = getCategoryHexColor(topic);
  // Difficulty tiers 1..5 → shade the base 0%/10%/20%/30%/40% darker.
  const tier = Math.min(5, Math.max(1, difficulty));
  const solid = tier === 1 ? base : darken(base, 0.10 * (tier - 1));
  return { solid, grad: [lighten(solid, 0.25), darken(solid, 0.20)] as [string, string] };
}

interface PlacedNode {
  i: number;
  kind: 'level' | 'test';
  key: string;
  cx: number;
  cy: number;
  half: number;
  accent: string;
  grad: [string, string];
  unlocked: boolean;
  passed: boolean;
  isCurrent: boolean;
  best: number;
  /** Spaced-mastery state of a level node (white / amber / green). */
  mastery?: MasteryState;
  /** Cleared-but-unmastered level whose spaced review is due. */
  due?: boolean;
  /** Distinct UTC days this level has been passed on (for the mastery tooltip). */
  masteryDays?: number;
  level?: RoadmapLevelMeta;
  /** Local 1-based number within the part (what the node displays). */
  displayNum?: number;
  /** For a test node: the part it ends and that part's global level range. */
  part?: number;
  range?: PartRange;
  prerequisite?: { kind: 'level'; ref: number; title: string } | { kind: 'test'; ref: number };
  unavailable?: boolean;
  /** Premium opens this step and the account holds the free plan: the node reads
   * "Premium", stays focusable and opens the upgrade sheet. */
  premium?: boolean;
  /** The topic is outside the learner's plan and this step was never passed. */
  outOfPlan?: boolean;
}

// Track an element's width so the path can lay itself out responsively. Uses a
// callback ref (not a mount effect) so measurement starts the moment the node
// actually attaches: the path container only mounts AFTER the structure finishes
// loading, so a one-shot mount effect would run while only the loading skeleton
// is on screen, see a null ref, and never re-measure — leaving width at 0 and
// the path empty. A callback ref re-runs whenever the element mounts/unmounts.
function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  return [ref, width] as const;
}

// Mastered levels carry a filled star; cleared-but-due levels carry a small
// review (circular-arrow) marker. Both pair the mastery colour with a distinct
// shape so status never rides on colour alone.
const StarIcon = ({ size = 20 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.6l2.82 6.1 6.68.78-4.94 4.53 1.32 6.59L12 17.9l-5.9 3.31 1.32-6.59L2.5 10.09l6.68-.78L12 2.6z" />
  </svg>
);
const ReviewIcon = ({ size = 12 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 4 21 9 16 9" />
    <path d="M20.4 13.5A8.5 8.5 0 1 1 18 6.3L21 9" />
  </svg>
);
const CodeIcon = ({ size = 10 }: { size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);
const StepArrowIcon = ({ dir, size = 15 }: { dir: 'up' | 'down' | 'hold'; size?: number }) => (
  <svg aria-hidden="true" focusable="false" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'up' && <><polyline points="6 14 12 8 18 14" /></>}
    {dir === 'down' && <><polyline points="6 10 12 16 18 10" /></>}
    {dir === 'hold' && <><line x1="6" y1="12" x2="18" y2="12" /></>}
  </svg>
);
// Build one part's ordered path: its levels, then a single end-of-part test.
type PathNode =
  | { type: 'level'; meta: RoadmapLevelMeta; range: PartRange }
  | { type: 'test'; part: number; range: PartRange };

function buildFullPath(levels: RoadmapLevelMeta[], ranges: PartRange[]): PathNode[] {
  return ranges.flatMap((range) => {
    const partNodes: PathNode[] = levels
      .slice(range.startLevel - 1, range.endLevel)
      .map((meta) => ({ type: 'level', meta, range }));
    if (range.size > 0) partNodes.push({ type: 'test', part: range.part, range });
    return partNodes;
  });
}

function variedConnector(x1: number, y1: number, x2: number, y2: number, index: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.max(1, Math.hypot(dx, dy));
  const amplitude = 4 + (index % 4) * 1.5;
  const direction = index % 2 === 0 ? 1 : -1;
  const mx = (x1 + x2) / 2 - (dy / length) * amplitude * direction;
  const my = (y1 + y2) / 2 + (dx / length) * amplitude * direction;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

// What to play after finishing `a`, within the active topic's part ranges: the
// next level in the part, then the part test, then the first level of the next
// part (which the just-passed test unlocks).
function nextAfter(a: Active, ranges: PartRange[]): Active | null {
  if (a.kind === 'level') {
    const r = ranges.find((x) => a.ref >= x.startLevel && a.ref <= x.endLevel);
    if (!r) return null;
    if (a.ref < r.endLevel) return { kind: 'level', ref: a.ref + 1 };
    return { kind: 'test', ref: r.part };
  }
  // Finished a part test → jump into the next part if there is one.
  const next = ranges[a.ref]; // ranges is 0-indexed; part a.ref's successor sits at index a.ref
  if (next && next.size > 0) return { kind: 'level', ref: next.startLevel };
  return null;
}

/** `onActiveChange` reports a level's live questions, so the app shell hides
 * its header and footer as it does for a Quiz or a Challenge run (UX audit
 * questions-07). */
function Roadmap({ onActiveChange }: { onActiveChange?: (active: boolean) => void } = {}) {
  // The account's progress and XP, and the path reads where they count,
  // start beside the hold rather than after the first draw (#587 C07, C08).
  useMapReadsBesideHold();
  useRoadmapStructureFirst({ plan: true, progress: true });
  const { t } = useLanguage();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const progress = useRoadmapProgress();
  const extraUnlocks = useExtraUnlocks();
  const extraUnlocksSet = useMemo(() => new Set(extraUnlocks), [extraUnlocks]);
  const [pathRef, pathWidth] = useElementWidth<HTMLDivElement>();
  const queryClient = useQueryClient();
  const online = useOnline();

  // Roadmap structure via TanStack Query — cached + de-duped with the /roadmap
  // tree, cancellable, with built-in loading/error state and retry.
  const structureQuery = useRoadmapStructure();
  const structure: RoadmapStructure | null = structureQuery.data ?? null;
  // The plan decides which nodes read "Premium". The map waits for it, so a
  // Premium account never sees a flash of locks; offline it reads as unknown
  // and nothing is drawn as locked (the server's 402 still opens the sheet).
  const levelCounts = useMemo(
    () => Object.fromEntries(Object.entries(structure?.structure ?? {}).map(([id, one]) => [id, one.levels.length])),
    [structure],
  );
  const { lockOf, loading: planLoading } = useContentLocks(levelCounts);
  const loadingStructure = structureQuery.isPending || planLoading;
  const structureError = structureQuery.error ? friendlyError(structureQuery.error) : null;
  // Topics for the active subject, in path order. The first is the default/
  // fallback landing topic.
  const [subject] = useSubject();
  const TOPICS = topicsForSubject(subject);

  // Which Learn section the address names (components/learn/sections.ts). An
  // address that does not name one, or names the wrong one for its ?topic, is
  // replaced with the one it resolves to, query and all.
  const { section: sectionParam } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const resolved = useMemo(
    () => resolveSection(sectionParam, location.search, readString(SECTION_KEY)),
    [sectionParam, location.search],
  );
  useEffect(() => {
    if (resolved.canonical) navigate(resolved.canonical, { replace: true });
  }, [resolved.canonical]); // eslint-disable-line react-hooks/exhaustive-deps
  // The section on screen. It follows the address except while a level or the
  // skill check is open (the effect after their state below).
  const [section, setSection] = useState<LearnSectionId>(resolved.section);

  // The server serves nothing new outside the learner's chosen track (403
  // not_in_plan), and keeps serving levels already passed whatever the plan
  // says. A join the session has not read back yet counts as planned, so
  // every reader of the plan on this page agrees the moment it lands.
  const [pending, setPending] = useState<PendingJoin>(NO_PENDING);
  const inPlan = useInPlan(pending);
  const { profile, hasPlan, members } = useLearnerSections(pending);
  const isMember = members.includes(section);
  useEffect(() => {
    if (pending === NO_PENDING) return;
    const saved = learnerProfileOf(user);
    if (!saved) return;
    const held = pending.sections.every((id) => saved.sections?.includes(id)) && (!pending.fde || saved.specialization === 'fde');
    if (held) setPending(NO_PENDING);
  }, [user, pending]);

  // Each section's rail: what the plan holds plus any topic with a passed
  // level, and, in a section the learner has not joined, the rest dimmed.
  const entriesBySection = useMemo(() => {
    const base = { liveTopics: TOPICS, inPlan, hasPlan, progress, extraUnlocks: extraUnlocksSet, lockOf };
    return Object.fromEntries(
      LEARN_SECTION_IDS.map((id) => [id, railEntries(id, { ...base, isMember: members.includes(id) })]),
    ) as Record<LearnSectionId, RailEntry[]>;
  }, [TOPICS, inPlan, hasPlan, progress, extraUnlocksSet, lockOf, members]);
  const entries = entriesBySection[section];
  const sectionHasOpen = entries.some((entry) => entry.state === 'open');

  // An old link to a path that no longer exists. It is answered rather than
  // redirected: the learner asked for something specific and deserves to know
  // where it went, and their history for it is untouched.
  const [retired] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('topic');
    return fromUrl ? retirementOf(fromUrl) ?? null : null;
  });
  const [topic, setTopic] = useState<RoadmapTopic>(() => {
    // A deep link (/learn?topic=…&part=…) wins over the topic last opened in
    // this section, then the last one overall. A locked or unlisted one falls
    // back to the section's first open topic, so the page lands somewhere
    // actionable. With nothing open it is the first entry, locked, and the
    // ?level deep link below opens nothing.
    const fromUrl = new URLSearchParams(window.location.search).get('topic');
    const initial = railEntries(resolved.section, {
      liveTopics: TOPICS, inPlan, hasPlan, isMember: members.includes(resolved.section),
      progress: getRoadmapProgress(), extraUnlocks: new Set(getExtraUnlocks()), lockOf,
    });
    const chosen = firstSelectable(initial, [fromUrl, readSectionTopic(resolved.section), readString(TOPIC_KEY), TOPICS[0]]);
    return (chosen ?? initial[0]?.topic ?? TOPICS[0]) as RoadmapTopic;
  });
  // A deep link's ?topic the first draw could not open: signed in, the
  // account's plan and progress can still be on their way when the map
  // draws, now that its public reads no longer wait for supabase-js and the
  // session (perf baseline #587 C10) and it draws without React's reveal
  // throttle (C04). It opens once they open it (the effect after landOn),
  // unless the learner has moved on first: picked a topic, switched section,
  // opened a step or joined. Before #587 the account's data was in by the
  // first draw, and the map landed on it at once.
  const lateDeepLink = useRef<string | null | undefined>(undefined);
  if (lateDeepLink.current === undefined) {
    const asked = new URLSearchParams(window.location.search).get('topic');
    lateDeepLink.current = asked && asked !== topic ? asked : null;
  }
  // Which of the topic's PARTS_PER_TOPIC parts is open in the path view.
  const [part, setPart] = useState<number>(() => {
    const fromUrl = parseInt(new URLSearchParams(window.location.search).get('part') ?? '', 10);
    if (Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= PARTS_PER_TOPIC) return fromUrl;
    const saved = parseInt(readString(PART_KEY) ?? '', 10);
    return Number.isInteger(saved) && saved >= 1 && saved <= PARTS_PER_TOPIC ? saved : 1;
  });

  // If the subject changes while this page is mounted, the current topic may no
  // longer belong to it — snap back to the subject's first topic.
  useEffect(() => {
    if (!(TOPICS as string[]).includes(topic)) {
      setTopic(TOPICS[0]);
      setPart(1);
    }
  }, [subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const [active, setActive] = useState<Active | null>(null);
  const [playable, setPlayable] = useState<RoadmapPlayable | null>(null);
  const [loadingLesson, setLoadingLesson] = useState(false);
  const [readingLessonId, setReadingLessonId] = useState<string | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);
  // When the level's wait began: its loader and the runner's code loader
  // after it are one wait (learn/LevelLoader.tsx).
  const [waitSince, setWaitSince] = useState(0);
  const lessonAbortRef = useRef<AbortController | null>(null);
  // Leaving Learn while a level loads drops its request too.
  useEffect(() => () => lessonAbortRef.current?.abort(), []);
  const learningXpBeforeAttemptRef = useRef(0);

  // Skill check (assessment) state. `open` controls the modal; the runner
  // owns its own in-progress state until the result screen reports back.
  const [skillCheckOpen, setSkillCheckOpen] = useState(false);
  // The control that opened the skill check, to take focus back on return:
  // the check replaces the map, so that control is gone while it runs.
  const skillCheckOpener = useRef<'row' | 'gate' | null>(null);
  const openSkillCheck = (from: 'row' | 'gate') => {
    setLockReason(null);
    skillCheckOpener.current = from;
    setSkillCheckOpen(true);
  };
  const [unlockSnack, setUnlockSnack] = useState<string | null>(null);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const inspectLock = (reason: string) => {
    // Astryx deliberately suppresses hover/focus tooltips after a touch tap.
    // Reuse the page's live toast for that pointer press; keyboard focus keeps
    // the contextual tooltip and receives no duplicate announcement.
    if (window.matchMedia('(hover: none)').matches) setLockReason(reason);
  };

  // The section follows the address, except while a level or the skill check
  // is open: Back, Forward or a nav click then change the address only, and
  // the section follows once the learner is back on the map.
  useEffect(() => {
    if (active !== null || skillCheckOpen) return;
    setSection(resolved.section);
    writeString(SECTION_KEY, resolved.section);
  }, [resolved.section, active, skillCheckOpen]);
  // The topic's full (global) level list, split into progression checkpoints.
  const topicStructure = structure?.structure[topic];
  const levels: RoadmapLevelMeta[] = topicStructure?.levels ?? [];
  const ranges = useMemo(() => partRanges(levels.length), [levels.length]);
  // Which steps the server will not open, read from the map it sent: the
  // unlock rules step over them rather than dead-ending behind them.
  const availability = useMemo(() => availabilityOf(topicStructure), [topicStructure]);
  const safePart = Math.min(Math.max(part, 1), Math.max(1, ranges.length));
  const topicColor = getCategoryHexColor(topic);
  // A topic outside the plan is on the rail only for the levels already
  // passed in it: those open for review, the rest stay shut.
  const topicInPlan = inPlan(topic);
  const continueStep = nextLearnStep({ topic, levels, ranges, progress, availability, inPlan: topicInPlan });
  const continueLevel = continueStep?.kind === 'level' ? levels.find((meta) => meta.level === continueStep.ref) : undefined;
  const continueTest = continueStep?.kind === 'test' ? ranges.find((range) => range.part === continueStep.ref) : undefined;

  // Keep the selected part on something the learner can actually open: if it's
  // locked (reset progress, switched topic, stale deep link) snap to the first
  // unlocked, incomplete part.
  useEffect(() => {
    if (ranges.length === 0) return;
    if (!isPathUnlocked(progress, topic, part, extraUnlocksSet, availability)) {
      setPart(currentPart(progress, topic, ranges, extraUnlocksSet, availability));
    }
  }, [topic, ranges, progress, extraUnlocksSet, part, availability]);

  // Show `next`, on the first unlocked, incomplete part of it.
  const landOn = (next: RoadmapTopic, remember: LearnSectionId | null) => {
    setTopic(next);
    const nextRanges = partRanges(structure?.structure[next]?.levels.length ?? 0);
    const p = currentPart(progress, next, nextRanges, extraUnlocksSet);
    setPart(p);
    if (remember) {
      writeString(TOPIC_KEY, next);
      writeSectionTopic(remember, next);
      writeString(PART_KEY, String(p));
    }
  };

  const selectTopic = (next: RoadmapTopic) => {
    setLockReason(null);
    // Locked and dimmed topics aren't tabbable; ignore if somehow invoked.
    if (!entries.some((entry) => entry.topic === next && entry.state === 'open')) return;
    lateDeepLink.current = null;
    landOn(next, section);
  };

  // A section, or a plan that arrived with the account, may not list the
  // topic on screen as open. Move to the section's remembered topic, else its
  // first open one. With nothing open the map area says what opens it, and
  // the topic stays as it was.
  useEffect(() => {
    if (active) return;
    if (entries.some((entry) => entry.topic === topic && entry.state === 'open')) return;
    const next = firstSelectable(entries, [readSectionTopic(section), readString(TOPIC_KEY), TOPICS[0]]);
    if (next) landOn(next as RoadmapTopic, null);
  }, [section, entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // The deep link's topic, once the account's plan and progress open it
  // (lateDeepLink above). It lands as the first draw would have: the part
  // the address or this device named is kept where it opens, and nothing is
  // remembered, as for any ?topic on arrival. A switch to another section
  // drops it.
  const arrivalSection = useRef(section);
  useEffect(() => {
    const asked = lateDeepLink.current;
    if (!asked) return;
    if (section !== arrivalSection.current) {
      lateDeepLink.current = null;
      return;
    }
    if (active || !entries.some((entry) => entry.topic === asked && entry.state === 'open')) return;
    lateDeepLink.current = null;
    setTopic(asked as RoadmapTopic);
  }, [section, entries, active]);

  /** Open another section, optionally on one of its topics. The old query is
   * dropped, so a ?topic of the section left behind cannot send the learner
   * back. */
  const switchSection = (id: LearnSectionId, nextTopic?: RoadmapTopic) => {
    setLockReason(null);
    lateDeepLink.current = null;
    if (nextTopic) landOn(nextTopic, id);
    navigate({ pathname: `/learn/${id}`, search: nextTopic ? `?topic=${nextTopic}` : '' });
  };

  // "Go to <prerequisite>" removes its own button: the section body remounts
  // under the new section. Focus goes to the topic it opened (else the open
  // section in the switcher) once that section is on screen.
  const sectionBodyRef = useRef<HTMLDivElement>(null);
  const focusOnArrival = useRef<LearnSectionId | null>(null);
  useEffect(() => {
    if (focusOnArrival.current !== section) return;
    focusOnArrival.current = null;
    (sectionBodyRef.current?.querySelector<HTMLElement>('.rm-topic-rail [role="radio"][aria-checked="true"]')
      ?? document.querySelector<HTMLElement>('.rm-section-switcher [role="radio"][aria-checked="true"]'))?.focus();
  }, [section, topic]);

  // Joining the section on screen (components/learn/joinSection.ts). The
  // state names the section it belongs to, so a switch during a save never
  // shows its result under another section.
  const [join, setJoin] = useState<(JoinState & { section: LearnSectionId }) | null>(null);
  // A join, and one the session has not read back yet, belong to the account
  // that made it. Kept across a sign-out, the next account on this page was
  // planned with sections it never joined and told it had joined them.
  const accountId = user?.id ?? null;
  const [joinAccount, setJoinAccount] = useState(accountId);
  if (joinAccount !== accountId) {
    setJoinAccount(accountId);
    setPending(NO_PENDING);
    setJoin(null);
  }
  // The saved line is said once: leaving the section drops it.
  useEffect(() => {
    setJoin((current) => (current?.status === 'saved' && current.section !== section ? null : current));
  }, [section]);
  const fdeOnScreen = section === 'forward-deployed-engineer';
  const pathCatalog = usePathCatalog(fdeOnScreen);
  const enrollments = useEnrollments(fdeOnScreen && isAuthenticated ? user?.id : undefined);
  const fdeEntry = entryFor(pathCatalog.data, 'fde');
  const fdeBarred = isBarred(lockOf({ kind: 'learning-path', pathId: 'fde' }));
  const fdePath = useFdePathSteps();
  // One join at a time. A ref, not only `join`: a second click can land
  // before "saving" re-renders, and each saved the plan (and enrolled) again.
  const joiningRef = useRef(false);
  const runJoin = async (id: LearnSectionId) => {
    if (!user || !profile || join?.status === 'saving' || joiningRef.current) return;
    joiningRef.current = true;
    lateDeepLink.current = null;
    const retryAfterSave = join?.section === id && join.status === 'error' && join.step === 'save';
    const started = { section: id, status: 'saving' as const };
    const epoch = accountEpoch();
    setJoin(started);
    let outcome: Awaited<ReturnType<typeof joinSoftwareEngineer>>;
    try {
      outcome = id === 'software-engineer'
        ? await joinSoftwareEngineer(user.id, profile, queryClient)
        : await joinFde({
          userId: user.id,
          profile,
          entry: fdeEntry,
          enrollment: enrollments.data?.enrollments.find((one) => one.pathId === 'fde'),
          barred: fdeBarred,
          queryClient,
          skipEnroll: retryAfterSave,
        });
    } finally {
      joiningRef.current = false;
    }
    // The account changed during the save: its outcome is not this page's.
    if (accountEpoch() !== epoch) {
      setJoin((current) => (current === started ? null : current));
      return;
    }
    if (outcome.ok) {
      setPending((current) => (id === 'software-engineer'
        ? { ...current, sections: [...current.sections, id] }
        : { ...current, fde: true }));
      setJoin({ section: id, status: 'saved' });
    } else if (outcome.step === 'premium') {
      // The upgrade sheet is open; nothing was saved.
      setJoin(null);
    } else {
      setJoin({ section: id, status: 'error', step: outcome.step });
    }
  };

  const selectPart = (p: number) => {
    if (!isPathUnlocked(progress, topic, p, extraUnlocksSet)) return;
    setPart(p);
    writeString(PART_KEY, String(p));
  };

  const onSkillCheckFinished = useCallback(
    (correct: number, verifiedUnlocks?: RoadmapTopic[]) => {
      // Signed in, only what the server applied opens anything: the runner
      // passes that list, empty when applying failed. The score's own tier
      // is the signed-out preview, which the server never sees.
      const granted = verifiedUnlocks ?? topicsFromAssessment(correct);
      const added = unlockExtraTopics(granted);
      setSkillCheckOpen(false);
      // Nothing new: the result screen already said so (roadmap.skillCheckLow).
      if (added.length > 0) {
        const labels = added.map((c) => t(categoryLabelKey(c))).join(', ');
        setUnlockSnack(t('roadmap.skillCheckUnlocked', { topics: labels }));
      }
    },
    [t],
  );

  const open = (a: Active, questions = false) => {
    setLockReason(null);
    lateDeepLink.current = null;
    preloadLessonRunner();
    if (hasCodeQuestions(topic)) preloadCodeHighlighter();
    const lessonId = a.kind === 'level' && !questions ? levels.find((level) => level.level === a.ref)?.lessonId : undefined;
    setReadingLessonId(lessonId ?? null);
    if (lessonId) {
      preloadLessonReader();
      // The lesson is asked for with the press, beside the reader's code.
      prefetchLearnLesson(queryClient, lessonId);
      lessonAbortRef.current?.abort();
      setActive(a);
      setPlayable(null);
      setLoadingLesson(false);
      setLessonError(null);
      return;
    }
    learningXpBeforeAttemptRef.current = computeLearningXp(getRoadmapProgress());
    lessonAbortRef.current?.abort();
    const controller = new AbortController();
    lessonAbortRef.current = controller;
    setActive(a);
    setPlayable(null);
    setLoadingLesson(true);
    setLessonError(null);
    const startedAt = Date.now();
    setWaitSince(startedAt);
    // The screen opens once the runner's code is in too, so a level answered
    // first does not swap its loader for the runner's own.
    const runner = loadLessonRunner().then(() => undefined, () => undefined);
    const req =
      a.kind === 'level'
        ? fetchRoadmapLevel(topic, a.ref, controller.signal)
        : fetchRoadmapPartTest(topic, a.ref, controller.signal);
    req
      .then(async (data) => {
        // A fast answer opens at once; a slow one keeps its loader up long
        // enough to read as a beat (learn/LevelLoader.tsx, #587 C05).
        await runner;
        await revealWhenReady(startedAt);
        if (controller.signal.aborted) return;
        // A part test comes back as a generic exam; give it a localized title.
        setPlayable(a.kind === 'test' ? { ...data, title: t('roadmap.partLabel', { n: a.ref }) } : data);
        setLoadingLesson(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        // Premium opens this step: the API client already opened the upgrade
        // sheet, so the learner stays on the map rather than an error screen.
        if (isPremiumRequired(err)) {
          setActive(null);
          setLoadingLesson(false);
          return;
        }
        setLessonError(friendlyError(err));
        setLoadingLesson(false);
      });
  };

  // A Premium step opens the upgrade sheet instead of a lesson.
  const stepContent = (a: Active): NonCodingContent =>
    a.kind === 'level' ? { kind: 'learn-level', topic, level: a.ref } : { kind: 'learn-part-test', topic, part: a.ref };
  const openOrUpgrade = (a: Active) => {
    const content = stepContent(a);
    // Outside the plan the server refuses the step before it asks about
    // Premium, so never offer Premium for it.
    const passedStep = a.kind === 'level' ? isLevelPassed(progress, topic, a.ref) : isPartTestPassed(progress, topic, a.ref);
    if (!inPlan(topic) && !passedStep) return;
    if (isBarred(lockOf(content))) openUpgradeSheet({ kind: content.kind, ref: gatedRef(content) });
    else open(a);
  };

  // Deep link from the Today plan (/learn?topic=…&level=…) opens that level's
  // lesson directly once the structure is known. Runs once per mount; when the
  // level isn't unlocked yet it just lands on the level's part instead of
  // opening it, so a stale link degrades gracefully.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current || !structure) return;
    const params = new URLSearchParams(window.location.search);
    const levelRaw = params.get('level');
    if (!levelRaw) return;
    // Never open a level of a topic other than the one on screen, nor of one
    // the rail does not show as open: with nothing open in the section (a
    // fresh device on /learn?topic=dsa&level=1), `topic` is the section's
    // first, locked entry and the map says what opens it. A topic the
    // account's data may still open (lateDeepLink) keeps the level for its
    // landing.
    const urlTopic = params.get('topic');
    if (urlTopic && urlTopic !== topic && lateDeepLink.current === urlTopic) return;
    autoOpenedRef.current = true;
    if (urlTopic && urlTopic !== topic) return;
    if (!entries.some((entry) => entry.topic === topic && entry.state === 'open')) return;
    const lvl = parseInt(levelRaw, 10);
    if (!Number.isInteger(lvl) || lvl < 1) return;
    if (!inPlan(topic) && !isLevelPassed(progress, topic, lvl)) return;
    const lvls = structure.structure[topic]?.levels ?? [];
    const range = partRanges(lvls.length).find((r) => lvl >= r.startLevel && lvl <= r.endLevel);
    if (!range) return;
    setPart(range.part);
    writeString(PART_KEY, String(range.part));
    if (isPartLevelUnlocked(progress, topic, range, lvl, availabilityOf(structure.structure[topic]))) {
      open({ kind: 'level', ref: lvl });
    }
  }, [structure, topic]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open the next item; when it lives in the next part, switch parts too.
  const openNext = (a: Active) => {
    if (a.kind === 'level') {
      const r = ranges.find((x) => a.ref >= x.startLevel && a.ref <= x.endLevel);
      if (r && r.part !== part) {
        setPart(r.part);
        writeString(PART_KEY, String(r.part));
      }
    }
    open(a);
  };

  // Back on the map, focus returns to the step the level was opened for:
  // the control that closed it is gone, and focus fell to the top of the page.
  const returnFocusTo = useRef<{ topic: RoadmapTopic; step: string } | null>(null);
  const exitLesson = () => {
    if (active) returnFocusTo.current = { topic, step: active.kind === 'level' ? `lvl-${active.ref}` : `test-${active.ref}` };
    lessonAbortRef.current?.abort();
    setActive(null);
    setPlayable(null);
    setLessonError(null);
    setLoadingLesson(false);
  };

  const handleFinished = (pct: number, repeatXp?: LearnRepeatXp) => {
    if (!active || !playable) return;
    // Learning XP is derived from progress, so measure it across the record to
    // reward only a NEW pass; replays/fails fall back to a small practice grant
    // in a signed-out browser only (no server route awards it).
    const before = learningXpBeforeAttemptRef.current;
    if (active.kind === 'level') recordLevelResult(topic, active.ref, pct, playable.passPct);
    else recordPartTestResult(topic, active.ref, pct, playable.passPct);
    awardLearningOutcome(computeLearningXp(getRoadmapProgress()) - before, isAuthenticated);
    // A signed-in replay that passed: its XP paid again, or the hour that
    // holds it back (migration 060), in a toast.
    if (isAuthenticated && repeatXp) void announceLearnRepeat(repeatXp);
  };

  // Lay the whole topic out as a serpentine: nodes flow left→right and gently
  // down, then wrap and flow back the other way. Positions are computed
  // analytically so the SVG connectors hit each node centre without measuring.
  const layout = useMemo(() => {
    if (!pathWidth || levels.length === 0) return null;
    const nodes = buildFullPath(levels, ranges);
    // Six nodes a row; under 480px three, since six columns on a phone left
    // each label wider than its column and overlapping the next one.
    const cols = pathWidth < 480 ? 3 : 6;
    const cellW = pathWidth / cols;
    // ROW_H must clear the accumulated within-row slope so the lowest node of a
    // row doesn't collide with the next row's start node (same column at a turn) —
    // including a taller test node and its two-line label.
    const ROW_H = 126;
    const SLOPE = 0;
    const BASE = 34;
    const LABEL_H = 42;
    // Node sizes (half is half of each): a level is 44px (50px when current),
    // a part test 52px, so every node is a 44px target on a mouse as well as
    // on a touch screen (UX audit learn-18).
    const placed: PlacedNode[] = nodes.map((node, i): PlacedNode => {
      const row = Math.floor(i / cols);
      const p = i % cols;
      const colVisual = row % 2 === 0 ? p : cols - 1 - p; // reverse odd rows
      const cx = colVisual * cellW + cellW / 2;
      const cy = BASE + row * ROW_H + p * SLOPE;
      if (node.type === 'test') {
        const passed = isPartTestPassed(progress, topic, node.part);
        const unavailable = availability.unavailableCheckpoints?.has(node.part) ?? false;
        const outOfPlan = !topicInPlan && !passed;
        const unlocked = !unavailable && !outOfPlan && isPartTestUnlocked(progress, topic, node.range, availability);
        const premium = !passed && !unavailable && !outOfPlan && isBarred(lockOf({ kind: 'learn-part-test', topic, part: node.part }));
        return {
          i, kind: 'test', key: `test-${node.part}`, cx, cy, half: 26,
          accent: CHECKPOINT_GOLD, grad: CHECKPOINT_GRAD, part: node.part, range: node.range,
          unlocked, passed, isCurrent: unlocked && !passed && !premium, unavailable, premium, outOfPlan,
          best: partTestBestPct(progress, topic, node.part),
        };
      }
      const meta = node.meta;
      const nodeRange = node.range;
      const band = bandForCategory(topic, meta.difficulty);
      const passed = isLevelPassed(progress, topic, meta.level);
      const unavailable = meta.unavailable === true;
      const outOfPlan = !topicInPlan && !passed;
      const unlocked = !unavailable && !outOfPlan && isPartLevelUnlocked(progress, topic, nodeRange, meta.level, availability);
      const premium = !passed && !unavailable && !outOfPlan && isBarred(lockOf({ kind: 'learn-level', topic, level: meta.level }));
      const isCurrent = unlocked && !passed && !premium;
      // Spaced mastery reads the stored level entry (migration-024 fields are
      // additive; older/guest rows without passDays resolve to "cleared").
      const entry = progress[topic]?.levels?.[String(meta.level)] as LevelMasteryEntry | undefined;
      const earlier = levels.filter((one) => one.level >= nodeRange.startLevel && one.level < meta.level && !availability.unavailableLevels?.has(one.level));
      const previous = earlier[earlier.length - 1];
      return {
        i, kind: 'level', key: `lvl-${meta.level}`, cx, cy, half: isCurrent ? 25 : 22,
        accent: band.solid, grad: band.grad, level: meta,
        displayNum: meta.level,
        unlocked, passed, isCurrent, unavailable, premium, outOfPlan,
        best: levelBestPct(progress, topic, meta.level),
        mastery: masteryState(entry),
        due: isDueForReview(entry),
        masteryDays: distinctPassDays(entry),
        prerequisite: previous ? { kind: 'level', ref: previous.level, title: previous.title }
          : nodeRange.part > 1 ? { kind: 'test', ref: nodeRange.part - 1 } : undefined,
      };
    });
    const rows = Math.ceil(nodes.length / cols);
    const height = BASE + (rows - 1) * ROW_H + (cols - 1) * SLOPE + 42 + LABEL_H;
    const segments = placed.slice(0, -1).map((a, i) => {
      const b = placed[i + 1];
      const done = a.passed && b.passed;
      const active = a.passed && b.isCurrent;
      return { x1: a.cx, y1: a.cy, x2: b.cx, y2: b.cy, color: done || active ? b.accent : null, active };
    });
    return { width: pathWidth, height, cellW, nodes: placed, segments };
  }, [pathWidth, levels, ranges, progress, topic, availability, lockOf, topicInPlan]);

  // The map lays its nodes out once it has measured itself, a render or two
  // after a level closes, so focus waits for the layout.
  useEffect(() => {
    const target = returnFocusTo.current;
    if (active !== null || !layout || !target) return;
    returnFocusTo.current = null;
    if (target.topic !== topic) return;
    sectionBodyRef.current?.querySelector<HTMLElement>(`.rm-path-canvas [data-step="${target.step}"] button`)?.focus();
  }, [active, layout, topic]);
  // Back on the map from the skill check (Cancel or the result's way back),
  // focus returns to the control that opened it, as it does after a level.
  useEffect(() => {
    const from = skillCheckOpener.current;
    if (skillCheckOpen || !from) return;
    skillCheckOpener.current = null;
    const selector = from === 'row' ? '.rm-skillcheck-cta' : '.rm-section-empty__actions > :last-child';
    sectionBodyRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [skillCheckOpen]);

  /* ──── skill check view ─────────────────────────────────────────────── */
  if (skillCheckOpen) {
    return (
      <SkillCheckRunner
        subject={subject}
        isAuthenticated={isAuthenticated}
        onCancel={() => setSkillCheckOpen(false)}
        onFinished={onSkillCheckFinished}
        t={t}
      />
    );
  }

  /* ──── lesson view ──────────────────────────────────────────────────── */
  // No Learn level passed yet in any topic: a pass now is the learner's first,
  // the moment the invite link is offered (#239).
  const noLevelPassedYet = (TOPICS as RoadmapTopic[]).every((one) => passedLevelCount(progress, one) === 0);
  if (active !== null) {
    if (readingLessonId) return <LessonReader key={readingLessonId} lessonId={readingLessonId} backLabel={t(categoryLabelKey(topic))} onStart={() => open(active, true)} onBack={exitLesson} />;
    if (loadingLesson) {
      return <DelayedQuoteLoader since={waitSince} quote={t('quiz.loadingQuote')} label={t('common.loading')} />;
    }
    if (lessonError || !playable) {
      return <LessonError message={lessonError ?? t('roadmap.error')} onRetry={() => open(active)} onExit={exitLesson} t={t} />;
    }
    const following = nextAfter(active, ranges);
    // Outside the plan the server serves only steps already passed (a replay),
    // so "Next" is offered there only when the next step is one of them.
    const next = following && (
      inPlan(topic)
      || (following.kind === 'level' ? isLevelPassed(progress, topic, following.ref) : isPartTestPassed(progress, topic, following.ref))
    ) ? following : null;
    const nextLabel = !next
      ? ''
      : next.kind === 'test'
        ? t('roadmap.toCheckpoint')
        : active.kind === 'test'
          ? t('roadmap.nextPart')
          : t('roadmap.nextLevel');
    return (
      <LessonStage since={waitSince} onExit={exitLesson} t={t}>
      <LessonRunner
        key={`${topic}-${active.kind}-${active.ref}`}
        playable={playable}
        skipIntro={active.kind === 'level' && !!levels.find((level) => level.level === active.ref)?.lessonId}
        firstLevelPass={noLevelPassedYet}
        topicCompleted={active.kind === 'test' && active.ref === ranges.length && ranges.every(range => isPartTestPassed(progress, topic, range.part))}
        topicColor={topicColor}
        hasNext={!!next}
        nextLabel={nextLabel}
        onExit={exitLesson}
        onFinished={handleFinished}
        onNext={() => next && openNext(next)}
        onReplay={() => open(active)}
        onActiveChange={onActiveChange}
        t={t}
      />
      </LessonStage>
    );
  }

  /* ──── map view ─────────────────────────────────────────────────────── */
  const sectionName = learnText(`learn.section.${section}`);
  // The FDE figure counts its path too (#489), and waits for the path's
  // answers rather than showing one number and then another.
  const switcherItems = LEARN_SECTIONS.map(({ id }) => {
    const path = id === 'forward-deployed-engineer' ? fdePath : null;
    return {
      id,
      name: learnText(`learn.section.${id}`),
      percent: loadingStructure || structureError || path?.pending
        ? null
        : sectionProgress(entriesBySection[id], progress, levelCounts, path?.steps ?? null).percent,
    };
  });
  const gate = sectionHasOpen ? null : sectionGate(entries, progress, extraUnlocksSet, members);
  // The skill check and what it opens: the count of locked topics and how to
  // open them sit here, beside the action they name (UX audit learn-07).
  const skillCheckRow = (
    <div className="rm-skillcheck-row">
      <div className="rm-skillcheck-copy">
        {!loadingStructure && <LockedNote entries={entries} t={t} />}
        <span>{t('roadmap.skillCheckSubtitle')}</span>
      </div>
      <button type="button" className="rm-skillcheck-cta" onClick={() => openSkillCheck('row')}>
        <BoltIcon size={15} /> {t('roadmap.skillCheckCta')}
      </button>
    </div>
  );
  // The section header offers the join as the one filled primary
  // (SectionHeader's `joinable`); the gate's action or the next-step card's
  // button under it then stays secondary.
  const headerJoins = section !== 'web-developer' && !authLoading && isAuthenticated && hasPlan && !isMember;
  const topicDone = passedLevelCount(progress, topic);
  const continueBarred = !!continueStep && isBarred(lockOf(continueStep.kind === 'level'
    ? { kind: 'learn-level', topic, level: continueStep.ref }
    : { kind: 'learn-part-test', topic, part: continueStep.ref }));
  // React and DSA open their first levels to every account: there Premium
  // starts at a level, not with the topic.
  const premiumFrom = !!continueLevel && continueBarred && continueLevel.level > 1 && !isBarred(lockOf({ kind: 'learn-level', topic, level: 1 }));
  const topicComplete = ranges.length > 0 && ranges.every((r) => isPartTestPassed(progress, topic, r.part));

  return (
    <div className="de-page">
      {/* One header in every auth state (UX audit learn-01): the h1 is
          always "Learn", the switcher below is the one place the section is
          named, and the section line under it is the one supporting line. */}
      <header className="rm-journey-heading">
        <Kicker as="h1" className="ss-section-title">{t('roadmap.title')}</Kicker>
      </header>

      {retired && (
        <div className="cd-note" role="status" style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px' }}>
            {t(`roadmap.retired.${retired.id}` as never)}
          </p>
          <p style={{ margin: 0 }}>{t('roadmap.retiredHistory')}</p>
        </div>
      )}

      <SectionSwitcher
        value={section}
        items={switcherItems}
        onActivate={(id) => switchSection(id)}
      />

      {/* Keyed by section: a switch fades the section in (rmTrackIn, none
          under reduced motion) and re-measures the map. */}
      <div key={section} ref={sectionBodyRef} className="rm-track-in rm-section-body" data-code={hasCodeQuestions(topic) ? '' : undefined} {...RUNNER_INTENT}>
        <SectionHeader
          section={section}
          name={sectionName}
          isMember={isMember}
          hasPlan={hasPlan}
          signedIn={isAuthenticated}
          authLoading={authLoading}
          online={online}
          join={join?.section === section ? join : null}
          onJoin={() => void runJoin(section)}
          onRetry={() => void runJoin(section)}
          onSignIn={() => openSignIn({ returnTo: `/learn/${section}` })}
          // The join enrols or resumes by the enrollment it finds, so it waits
          // for the account's enrollments as well as the catalogue.
          fde={fdeOnScreen ? { entryLoading: pathCatalog.isPending || enrollments.isLoading, pathOpen: isOpen(fdeEntry?.availability), barred: fdeBarred } : undefined}
          premiumLabel={t('premium.badge')}
          retryLabel={t('roadmap.retry')}
          deviceNote={t('register.deviceOnly')}
        />

        {LEARN_SECTIONS.find((one) => one.id === section)!.paths.length > 0 && (
          <Suspense fallback={<Skeleton width="100%" height={180} radius="rounded" />}>
            <ShellPartBoundary fallback={(retry, busy) => <ErrorRetry message={t('paths.error.catalog')} onRetry={retry} busy={busy} />}>
              <PathShelf pathIds={LEARN_SECTIONS.find((one) => one.id === section)!.paths} />
            </ShellPartBoundary>
          </Suspense>
        )}

        <SectionRail
          sectionName={sectionName}
          entries={entries}
          value={topic}
          onSelect={(value) => selectTopic(value as RoadmapTopic)}
          onInspect={inspectLock}
          loading={loadingStructure}
          loadingCount={sectionTopics(section, TOPICS).length}
          levelCounts={levelCounts}
          progress={progress}
          t={t}
        />

      {loadingStructure ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 24, marginTop: 16 }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} width={64} height={64} radius="rounded" index={i} />
          ))}
        </div>
      ) : structureError ? (
        <div style={{ textAlign: 'center', marginTop: 32 }}>
          <div style={{ marginBottom: 16, color: 'var(--ss-error)' }} role="alert">{structureError}</div>
          <AxButton variant="secondary" label={t('roadmap.retry')} onClick={() => structureQuery.refetch()} />
        </div>
      ) : !sectionHasOpen && (gate || !isMember) ? (
        gate ? (
          // The gate's own action row holds the skill check (UX audit
          // learn-09), so the separate skill-check row is not drawn here.
          <SectionEmpty
            kind="gate"
            prereq={gate.prereq}
            topic={gate.topic}
            onGo={() => {
              focusOnArrival.current = gate.prereqSection;
              switchSection(gate.prereqSection, gate.prereq as RoadmapTopic);
            }}
            onSkillCheck={() => openSkillCheck('gate')}
            quiet={headerJoins}
            t={t}
          />
        ) : (
          <>
            <SectionEmpty kind="notMember" name={sectionName} />
            {skillCheckRow}
          </>
        )
      ) : levels.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Banner status="info" title={t('roadmap.noLevels')} description={t('roadmap.noLevelsBody')} />
        </div>
      ) : (
        <>
          {/* Part selector — the topic is split into PARTS_PER_TOPIC shorter
              paths, each ending with a test; only one part shows at a time. */}
          <div role="radiogroup" aria-label={t('roadmap.partsAria')} style={{ display: 'none' }}>
            {ranges.map((r) => {
              const status = pathStatus(progress, topic, ranges, r.part, extraUnlocksSet, availability);
              const locked = status === 'locked';
              const selected = r.part === safePart;
              return (
                <Tooltip key={r.part} content={t('roadmap.partLockedHint', { n: r.part - 1 })} placement="above" isEnabled={locked}>
                  <span style={{ display: 'inline-flex' }}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={locked}
                      className="rm-part-pill"
                      data-selected={selected}
                      data-locked={locked}
                      data-complete={status === 'complete'}
                      onClick={() => selectPart(r.part)}
                      style={{ ['--rm-accent']: topicColor, ['--rm-on-accent']: onCategoryColorText(topic) } as CSSProperties}
                    >
                      {locked ? <LockIcon size={12} /> : status === 'complete' ? <CheckIcon size={14} /> : null}
                      {t('roadmap.partLabel', { n: r.part })}
                    </button>
                  </span>
                </Tooltip>
              );
            })}
          </div>

          {/* The next step, in one row (UX audit learn-06): the selected
              tile above already names the topic and its count, so the card
              says only what the tile does not, the next level, with the
              topic's progress as a 4px bar under it and Continue on the
              right. */}
          {/* A next level Premium opens says so once, here, and its button
              says what it does (UX audit learn-22): it opens the upgrade
              sheet, not a level. */}
          <div className="rm-overview-card" data-lesson={continueLevel && continueLevel.lessonId ? '' : undefined}>
            <span className="rm-overview-fin" aria-hidden="true" />
            <div className="rm-overview-copy">
              <p id="rm-overview-step" className="rm-overview-step">
                {continueStep
                  ? continueBarred
                    ? continueTest
                      ? learnText('learn.overview.premiumTest', { part: continueTest.part })
                      : premiumFrom && continueLevel
                      ? learnText('learn.overview.premiumFrom', { n: continueLevel.level, topic: t(categoryLabelKey(topic)) })
                      : learnText('learn.overview.premium', { topic: t(categoryLabelKey(topic)) })
                    : continueTest
                      ? learnText('learn.overview.nextTest', { part: continueTest.part, from: continueTest.startLevel, to: continueTest.endLevel })
                      : continueLevel && learnText('learn.overview.next', { n: continueLevel.level, total: levels.length, title: continueLevel.title })
                  : t('roadmap.progress', { done: topicDone, total: levels.length })}
              </p>
              <div
                role="progressbar"
                aria-label={t('roadmap.progress', { done: topicDone, total: levels.length })}
                aria-valuenow={Math.round(levels.length ? (topicDone / levels.length) * 100 : 0)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="rm-overview-progress"
              >
                <div style={{ height: '100%', width: `${levels.length ? (topicDone / levels.length) * 100 : 0}%`, backgroundColor: topicColor, borderRadius: 4, transition: 'width 0.5s ease' }} />
              </div>
            </div>
            {/* In a section the learner has not joined, a topic it shares
                with their plan is open here too, but the header's join is
                the screen's one primary, so this action is a secondary. */}
            {continueStep && (headerJoins ? (
              <AxButton
                variant="secondary"
                label={continueBarred ? learnText('learn.overview.seePremium') : t(continueStep.kind === 'test' ? 'roadmap.toCheckpoint' : 'roadmap.continue')}
                aria-describedby="rm-overview-step"
                onClick={() => openOrUpgrade(continueStep)}
              />
            ) : (
              <SwimCta
                label={continueBarred ? learnText('learn.overview.seePremium') : t(continueStep.kind === 'test' ? 'roadmap.toCheckpoint' : 'roadmap.continue')}
                describedBy="rm-overview-step"
                dir={-1}
                onClick={() => openOrUpgrade(continueStep)}
              />
            ))}
          </div>

          {/* Reads the node colours: white = not started, amber = cleared,
              green = mastered, plus the due-for-review marker. */}
          <MasteryLegend t={t} />

          {/* The path — a serpentine ribbon flowing left→right and gently down,
              then wrapping back, drawn through node centres with an SVG. */}
          <div className="rm-path-scroll">
          <div ref={pathRef} className="rm-path-canvas" style={{ position: 'relative', ...(layout ? { height: layout.height } : { minHeight: 220 }) }}>
            {layout && (
              <>
                <svg
                  aria-hidden
                  width={layout.width}
                  height={layout.height}
                  style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none' }}
                >
                  {layout.segments.map((s, i) => (
                    <path
                      key={i}
                      d={variedConnector(s.x1, s.y1, s.x2, s.y2, i)}
                      fill="none"
                      strokeWidth={7}
                      strokeLinecap="round"
                      className={s.active ? 'rm-flow' : undefined}
                      strokeDasharray={s.active ? '0.1 14' : undefined}
                      style={{ stroke: s.color ?? 'var(--color-border)' }}
                    />
                  ))}
                </svg>
                {layout.nodes.map((n) => (
                  <div
                    key={n.key}
                    data-step={n.key}
                    data-lesson={n.level?.lessonId ? '' : undefined}
                    style={{ position: 'absolute', transform: 'translateX(-50%)', left: n.cx, top: n.cy - n.half }}
                  >
                    <div className="rm-node" style={{ animationDelay: `${n.i * 0.025}s` }}>
                      {n.kind === 'test' ? (
                        <PartTestNode
                          part={n.part!}
                          range={n.range!}
                          accent={n.accent}
                          grad={n.grad}
                          unlocked={n.unlocked}
                          unavailable={n.unavailable ?? false}
                          passed={n.passed}
                          best={n.best}
                          isCurrent={n.isCurrent}
                          premium={n.premium ?? false}
                          outOfPlan={n.outOfPlan ?? false}
                          onInspect={inspectLock}
                          cellW={layout.cellW}
                          onClick={() => openOrUpgrade({ kind: 'test', ref: n.part! })}
                          t={t}
                        />
                      ) : (
                        <LevelNode
                          meta={n.level!}
                          displayNum={n.displayNum!}
                          accent={n.accent}
                          unlocked={n.unlocked}
                          unavailable={n.unavailable ?? false}
                          passed={n.passed}
                          best={n.best}
                          isCurrent={n.isCurrent}
                          mastery={n.mastery ?? 'notStarted'}
                          due={n.due ?? false}
                          masteryDays={n.masteryDays ?? 0}
                          prerequisite={n.prerequisite}
                          onInspect={inspectLock}
                          premium={n.premium ?? false}
                          outOfPlan={n.outOfPlan ?? false}
                          cellW={layout.cellW}
                          onClick={() => openOrUpgrade({ kind: 'level', ref: n.level!.level })}
                          t={t}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          </div>

          {topicComplete && (
            <div style={{ textAlign: 'center', marginTop: 24, fontWeight: 800, color: topicColor }}>
              {t('roadmap.allDone')}
            </div>
          )}

          {skillCheckRow}
        </>
      )}
      </div>

      <AppToast
        open={!!(lockReason || unlockSnack)}
        onClose={() => { setLockReason(null); setUnlockSnack(null); }}
        message={lockReason ?? unlockSnack ?? ''}
        autoHideDuration={lockReason ? 8000 : 4500}
      />
    </div>
  );
}

/* ──── mastery legend ───────────────────────────────────────────────────── */

// A compact key for the three spaced-mastery node states plus the due marker.
// Each swatch pairs its colour with a glyph so the legend is legible without
// relying on colour perception.
function MasteryLegend({ t }: { t: TFn }) {
  return (
    <div className="rm-legend" role="group" aria-label={t('mastery.legendTitle')}>
      <span className="rm-legend-title">{t('mastery.legendTitle')}</span>
      <span className="rm-legend-item">
        <span className="rm-legend-swatch" aria-hidden="true" />
        {t('mastery.notStarted')}
      </span>
      <span className="rm-legend-item">
        <span className="rm-legend-swatch rm-legend-swatch--cleared" aria-hidden="true"><CheckIcon size={11} /></span>
        {t('mastery.cleared')}
      </span>
      <span className="rm-legend-item">
        <span className="rm-legend-swatch rm-legend-swatch--mastered" aria-hidden="true"><StarIcon size={11} /></span>
        {t('mastery.mastered')}
      </span>
      <span className="rm-legend-item">
        <span className="rm-legend-swatch rm-legend-swatch--due" aria-hidden="true"><ReviewIcon size={10} /></span>
        {t('mastery.dueForReview')}
      </span>
    </div>
  );
}

/* ──── level node ───────────────────────────────────────────────────────── */

function LevelNode({
  meta, displayNum, accent, unlocked, unavailable, passed, best, isCurrent, mastery, due, masteryDays, premium, outOfPlan = false, prerequisite, onInspect, onClick, t, cellW,
}: {
  meta: RoadmapLevelMeta; displayNum: number; accent: string;
  unlocked: boolean; unavailable: boolean; passed: boolean; best: number; isCurrent: boolean;
  mastery: MasteryState; due: boolean; masteryDays: number;
  /** Premium opens this level: focusable, aria-disabled, "Premium" in text. */
  premium: boolean;
  /** Outside the learner's plan: shut, with the reason in its hint. */
  outOfPlan?: boolean;
  prerequisite?: PlacedNode['prerequisite'];
  onInspect: (reason: string) => void;
  onClick: () => void; t: TFn; cellW: number;
}) {
  if (premium) {
    return (
      <PremiumNode
        shape="level"
        label={t('premium.levelLabel', { n: displayNum, title: meta.title })}
        title={meta.title}
        cellW={cellW}
        onClick={onClick}
        t={t}
      />
    );
  }
  // Levels gate sequentially; the first available level of a part requires
  // the preceding part's test. An
  // unavailable level is a different thing from a locked one: nothing the
  // learner does opens it, and the path continues past it.
  const lockedHint = unavailable ? t('roadmap.unavailableHint') : outOfPlan ? t('roadmap.notInPlanHint')
    : prerequisite?.kind === 'level' ? learnText('learn.lock.previousLevel', { n: prerequisite.ref, title: prerequisite.title })
      : prerequisite?.kind === 'test' ? learnText('learn.lock.previousPart', { n: prerequisite.ref })
        : t('roadmap.lockedHint');
  // Spaced mastery: a passed level is "cleared" (amber) until it is mastered
  // (green). Soft fill + strong border/icon mirror the quiz feedback tokens so
  // contrast holds in light and dark; the glyph (check vs star) and the aria
  // text carry the status without relying on colour.
  const mastered = passed && mastery === 'mastered';
  const passedLine = mastered ? 'var(--ss-success)' : 'var(--ss-warning)';
  const passedFill = mastered ? 'var(--ss-success-soft)' : 'var(--ss-warning-soft)';
  const masteryText = mastered ? t('mastery.mastered') : t('mastery.cleared');
  const tip = !unlocked
    ? `${t('roadmap.levelLabel', { n: displayNum })}: ${meta.title}. ${lockedHint}`
    : mastered
      ? t('mastery.masteredTooltip', { days: masteryDays })
      : passed
        ? (due ? t('mastery.dueTooltip') : t('mastery.clearedTooltip', { time: localDayChangeTime() }))
        : '';
  const coding = (meta.codingTasks ?? 0) > 0;
  const label = unlocked
    ? `${t('roadmap.levelLabel', { n: displayNum })}: ${meta.title}${passed ? `, ${masteryText}${due ? `, ${t('mastery.dueForReview')}` : ''}, ${best}%` : ''}${coding ? `, ${t('coding.lesson.mapGlyph')}` : ''}`
    : `${t('roadmap.levelLabel', { n: displayNum })}: ${meta.title}, ${unavailable ? t('roadmap.unavailable') : t('roadmap.locked')}`;
  // Never wider than the cell, so neighbouring labels cannot overlap.
  const labelWidth = Math.min(cellW - 4, Math.max(72, Math.min(150, cellW - 10)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div className={isCurrent ? 'rm-bob' : undefined}>
        <Tooltip content={tip} placement="above" isEnabled={tip !== ''}>
          <button
            type="button"
            className={`rm-level-btn${unlocked ? '' : ' rm-unavailable-btn'}`}
            onClick={(event) => { if (unlocked) onClick(); else if (event.detail > 0) onInspect(tip); }}
            aria-disabled={!unlocked || undefined}
            aria-label={label}
            style={{
              position: 'relative', width: isCurrent ? 50 : 44, height: isCurrent ? 50 : 44, borderRadius: '50%',
              border: `2px solid ${passed ? passedLine : isCurrent ? accent : 'transparent'}`,
              background: passed ? passedFill : isCurrent ? 'var(--brand-accent-soft)' : 'var(--color-background-muted)',
              color: passed ? passedLine : unlocked ? accent : 'var(--color-text-disabled)',
              cursor: unlocked ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.86rem',
              boxShadow: isCurrent ? `0 0 0 5px ${accent}1f` : 'none',
              transition: 'transform 0.14s ease, box-shadow 0.2s ease',
              fontFamily: 'inherit',
            }}
          >
            {passed ? (mastered ? <StarIcon size={20} /> : <CheckIcon />) : unlocked ? displayNum : unavailable ? <span aria-hidden="true" style={{ fontSize: '0.95rem', fontWeight: 800 }}>…</span> : <LockIcon />}
            {isCurrent && <span className="rm-current-fin" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M3 18 Q 6 6 15 3 Q 17 11 21 18 Z" fill={accent} /></svg></span>}
            {due && <span className="rm-due-marker" aria-hidden="true"><ReviewIcon size={10} /></span>}
            {coding && unlocked && <span className="rm-code-marker" aria-hidden="true"><CodeIcon size={9} /></span>}
          </button>
        </Tooltip>
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          fontWeight: isCurrent ? 700 : 500,
          fontStyle: unavailable ? 'italic' : undefined,
          // Secondary, not disabled: the lock glyph says it is locked, and the
          // name still has to be readable (3.34:1 in light mode before).
          color: unlocked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          maxWidth: labelWidth,
          textAlign: 'center',
          lineHeight: 1.15,
          // Clamp to two lines so long titles don't overflow narrow columns.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {meta.title}
      </div>
    </div>
  );
}

/* ──── part-test (boss) node ────────────────────────────────────────────── */

function PartTestNode({
  part, range, accent, grad, unlocked, unavailable, passed, best, isCurrent, premium, outOfPlan = false, onInspect, onClick, t, cellW,
}: {
  part: number; range: PartRange; accent: string; grad: [string, string];
  unlocked: boolean; unavailable: boolean; passed: boolean; best: number; isCurrent: boolean;
  premium: boolean;
  outOfPlan?: boolean;
  onInspect: (reason: string) => void;
  onClick: () => void; t: TFn; cellW: number;
}) {
  const title = t('roadmap.partTestTitle', { n: part });
  if (premium) {
    return <PremiumNode shape="test" label={t('premium.partLabel', { title })} title={title} cellW={cellW} onClick={onClick} t={t} />;
  }
  const label = unlocked
    ? `${title}${passed ? ` — ${t('roadmap.passed')} ${best}%` : ''}`
    : `${title}: ${unavailable ? t('roadmap.unavailable') : t('roadmap.locked')}`;
  const labelWidth = Math.min(cellW - 4, Math.max(84, Math.min(160, cellW - 8)));
  const lockedHint = unavailable ? t('roadmap.unavailableHint') : outOfPlan ? t('roadmap.notInPlanHint')
    : learnText('learn.lock.testLevels', { from: range.startLevel, to: range.endLevel });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div className={isCurrent ? 'rm-bob' : undefined}>
        <Tooltip content={`${title}. ${lockedHint}`} placement="above" isEnabled={!unlocked}>
          <button
            type="button"
            className={`rm-test-btn${unlocked ? '' : ' rm-unavailable-btn'}${isCurrent ? ' rm-shimmer' : ''}`}
            onClick={(event) => { if (unlocked) onClick(); else if (event.detail > 0) onInspect(`${title}. ${lockedHint}`); }}
            aria-disabled={!unlocked || undefined}
            aria-label={label}
            style={{
              position: 'relative', width: 52, height: 52, borderRadius: '14px',
              border: `2px solid ${passed || isCurrent ? accent : `${accent}70`}`,
              background: passed
                ? `linear-gradient(150deg, ${grad[0]}, ${grad[1]})`
                : unlocked
                  ? `linear-gradient(150deg, ${grad[0]}38, ${grad[1]}24)`
                  : 'var(--color-background-surface)',
              color: passed ? '#3a2c00' : unlocked ? accent : 'var(--color-text-disabled)',
              cursor: unlocked ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: isCurrent ? `0 0 0 5px ${accent}20` : 'none',
              transition: 'transform 0.14s ease, box-shadow 0.2s ease',
              fontFamily: 'inherit',
            }}
          >
            {passed ? <CheckIcon size={30} /> : unlocked ? <TrophyIcon size={26} /> : <LockIcon size={22} />}
          </button>
        </Tooltip>
      </div>
      <div
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          color: unlocked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
          textAlign: 'center',
          lineHeight: 1.15,
          maxWidth: labelWidth,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </div>
    </div>
  );
}

/* ──── Premium node ─────────────────────────────────────────────────────── */

/** A level or part test that Premium opens, on a free account. It keeps its
 * place and title on the map, stays in the tab order with `aria-disabled`,
 * and opens the upgrade sheet. Premium is said once for the topic, on its
 * tile and in the next-step card (UX audit learn-22), so the node shows no
 * label of its own: the lock and the dashed edge mark it, and "Premium" is
 * in its accessible name ("Level 7: Union Types, Premium"). */
function PremiumNode({ shape, label, title, cellW, onClick, t }: {
  shape: 'level' | 'test'; label: string; title: string; cellW: number; onClick: () => void; t: TFn;
}) {
  const size = shape === 'test' ? 52 : 44;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <Tooltip content={t('premium.lockHint')} placement="above">
        <button
          type="button"
          className="rm-level-btn rm-premium-btn"
          aria-disabled="true"
          aria-label={label}
          onClick={onClick}
          style={{
            position: 'relative', width: size, height: size, borderRadius: shape === 'test' ? '14px' : '50%',
            border: '2px dashed var(--color-border)',
            background: 'var(--color-background-muted)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit',
          }}
        >
          <LockIcon size={shape === 'test' ? 22 : undefined} />
        </button>
      </Tooltip>
      <div
        style={{
          fontSize: '0.75rem',
          fontWeight: shape === 'test' ? 700 : 500,
          color: 'var(--color-text-secondary)',
          maxWidth: Math.min(cellW - 4, Math.max(72, Math.min(150, cellW - 10))),
          textAlign: 'center',
          lineHeight: 1.15,
          // Two lines, as every other node's title.
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {title}
      </div>
    </div>
  );
}

/* ──── adaptive placement runner ────────────────────────────────────────── */

// The skill-check is an adaptive placement: the server serves short rounds and
// steps difficulty up on a strong round, down on a weak one, converging on the
// learner's level over ~4 rounds. Grading and topic unlocks stay
// server-authoritative — this component only relays answers and applies the
// verified receipt. An answer of IDK_INDEX (-1), the "I don't know yet" option,
// is sent as an explicit miss.
type PlacementPhase = 'intro' | 'loading' | 'playing' | 'submitting' | 'result' | 'error';
type StepDir = 'up' | 'down' | 'hold';

const IDK_INDEX = -1;

interface PlacementRound {
  done: false;
  round: number;
  totalRounds: number;
  difficulty: number;
  asked: number;
  total: number;
  idkCountsAsMiss: boolean;
  placementToken: string;
  questions: Question[];
  lastRoundCorrect?: number;
  lastRoundSize?: number;
  review?: PlacementReview[];
}
interface PlacementDone {
  done: true;
  correct: number;
  total: number;
  difficulty: number;
  unlockedPreview: string[];
  resultReceipt?: string;
  review: PlacementReview[];
}
type PlacementResponse = PlacementRound | PlacementDone;

function SkillCheckRunner({
  subject,
  isAuthenticated,
  onCancel,
  onFinished,
  t,
}: {
  subject: SubjectId;
  isAuthenticated: boolean;
  onCancel: () => void;
  onFinished: (correct: number, verifiedUnlocks?: RoadmapTopic[]) => void;
  t: TFn;
}) {
  const [phase, setPhase] = useState<PlacementPhase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(4);
  const [total, setTotal] = useState(20);
  const [asked, setAsked] = useState(0);
  const [difficulty, setDifficulty] = useState(3);
  const [step, setStep] = useState<StepDir | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [correct, setCorrect] = useState(0);
  const [review, setReview] = useState<(PlacementReview & { question: Question })[]>([]);
  const [verifiedUnlocks, setVerifiedUnlocks] = useState<RoadmapTopic[] | undefined>();
  // Signed in, the receipt that could not be applied, kept for Try again.
  const [unapplied, setUnapplied] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  // The intro replaces the map, and the button that opened it is gone: its
  // title takes focus, as a round's question and the result's heading do.
  const introTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (phase === 'result') resultHeadingRef.current?.focus({ preventScroll: true });
    if (phase === 'intro') introTitleRef.current?.focus({ preventScroll: true });
  }, [phase]);
  // Next disables itself on the question it opens (nothing is picked yet), and
  // a new round replaces the whole view, so focus fell to the page. Each
  // question takes it instead, as a Learn level's do.
  const questionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'playing') questionRef.current?.focus({ preventScroll: true });
  }, [phase, qIndex, questions]);

  // Swap in a fetched round and reset the per-round answer sheet. `dir` drives
  // the stepping-up / stepping-down banner (null on the opening round).
  const applyRound = useCallback((res: PlacementRound, dir: StepDir | null) => {
    setToken(res.placementToken);
    setRound(res.round);
    setTotalRounds(res.totalRounds);
    setTotal(res.total);
    setAsked(res.asked);
    setDifficulty(res.difficulty);
    setQuestions(res.questions);
    setQIndex(0);
    setAnswers({});
    setStep(dir);
    setPhase('playing');
  }, []);

  // Apply the server-verified result. Grading + unlocks live on the server; the
  // receipt is only applied when signed in — guests get the local unlock tier
  // from `correct` back in the parent's onSkillCheckFinished.
  const applyReceipt = useCallback(async (receipt: string) => {
    setApplying(true);
    try {
      const applied = await applySkillCheckReceipt(receipt);
      setVerifiedUnlocks(applied.unlocked);
      setUnapplied(null);
    } catch {
      // Opening paths on this device alone would draw them as open while the
      // server refuses every level in them, so nothing opens; the result says
      // so and offers to try again while the receipt is still valid.
      setVerifiedUnlocks([]);
      setUnapplied(receipt);
    } finally {
      setApplying(false);
    }
  }, []);

  const finishFrom = useCallback(async (res: PlacementDone) => {
    setCorrect(res.correct);
    setUnapplied(null);
    if (isAuthenticated) {
      // Without a receipt the server verified nothing, so nothing opens.
      if (res.resultReceipt) await applyReceipt(res.resultReceipt);
      else setVerifiedUnlocks([]);
    } else {
      setVerifiedUnlocks(undefined);
    }
    setPhase('result');
  }, [isAuthenticated, applyReceipt]);

  // The account the placement ran for. Its result opens nothing on this
  // device once another account (or nobody) is signed in here.
  const epochRef = useRef(accountEpoch());
  const start = useCallback(async () => {
    epochRef.current = accountEpoch();
    setPhase('loading');
    setError(null);
    setVerifiedUnlocks(undefined);
    setReview([]);
    const startedAt = Date.now();
    try {
      const params = new URLSearchParams({ resource: 'placement', subject });
      const res = await apiFetch<PlacementResponse>(`/api/quiz/roadmap?${params}`);
      await revealWhenReady(startedAt);
      if (res.done) await finishFrom(res);
      else applyRound(res, null);
    } catch (err) {
      setError(friendlyError(err));
      setPhase('error');
    }
  }, [subject, applyRound, finishFrom]);

  // One submit per round. A ref, not only the phase: a second click on Next
  // or Finish can land before "submitting" re-renders, and the server answers
  // a round sent twice with placement_round_used, which ended the placement.
  const submittingRef = useRef(false);
  const submitRound = useCallback(async () => {
    if (!token || submittingRef.current) return;
    submittingRef.current = true;
    setPhase('submitting');
    setError(null);
    try {
      const res = await apiFetch<PlacementResponse>('/api/quiz/roadmap?resource=placement', {
        method: 'POST',
        body: JSON.stringify({ placementToken: token, answers }),
      });
      setReview((previous) => [...previous, ...(res.review ?? []).flatMap((item) => {
        const question = questions.find((one) => one.id === item.questionId);
        return question ? [{ ...item, question }] : [];
      })]);
      if (res.done) {
        await finishFrom(res);
      } else {
        const dir: StepDir = res.difficulty > difficulty ? 'up' : res.difficulty < difficulty ? 'down' : 'hold';
        applyRound(res, dir);
      }
    } catch (err) {
      setError(friendlyError(err));
      setPhase('error');
    } finally {
      submittingRef.current = false;
    }
  }, [token, answers, difficulty, questions, applyRound, finishFrom]);

  const current: Question | undefined = questions[qIndex];
  const roundSize = questions.length;
  const answered = current ? answers[current.id] != null : false;
  const roundComplete = roundSize > 0 && questions.every((q) => answers[q.id] != null);
  const isLastInRound = qIndex >= roundSize - 1;

  const pick = (idx: number) => {
    if (!current) return;
    setAnswers((prev) => ({ ...prev, [current.id]: idx }));
  };
  const goNext = () => {
    if (qIndex < roundSize - 1) setQIndex((i) => i + 1);
  };

  // The skill check's screens share the question screen's 640px shell,
  // header and action row (UX audit learn-03), with one SwimCta md each
  // (learn-04). Exit sits at the header's right on the intro and every round.
  const placementExit = <QuestionIconButton label={learnText('placement.cancel')} icon={<ExitIcon />} onClick={onCancel} />;

  if (phase === 'intro') {
    return (
      <QuestionShell
        questionId="placement-intro"
        focusable={false}
        stable={false}
        header={<QuestionHeader title={learnText('placement.kicker')} titleRef={introTitleRef} tools={placementExit} />}
        question={<p className="rm-placement-lead">{learnText('placement.subtitle')}</p>}
        actions={<QuestionActions primary={{ label: learnText('placement.start'), onClick: () => void start() }} />}
      />
    );
  }

  if (phase === 'loading' || phase === 'submitting') {
    return <DelayedQuoteLoader quote={t('quiz.loadingQuote')} label={learnText('placement.loading')} />;
  }

  if (phase === 'error') {
    return (
      <LessonError
        message={error ?? learnText('placement.error')}
        onRetry={() => void start()}
        onExit={onCancel}
        t={t}
      />
    );
  }

  if (phase === 'result') {
    const tier =
      correct >= 18
        ? 'roadmap.skillCheckPerfect'
        : correct >= 14
          ? 'roadmap.skillCheckSolid'
          : correct >= 10
            ? 'roadmap.skillCheckSome'
            : 'roadmap.skillCheckLow';
    const back = { label: t('roadmap.skillCheckBack'), onClick: () => onFinished(correct, accountEpoch() === epochRef.current ? verifiedUnlocks : []) };
    return (
      <QuestionShell
        questionId="placement-result"
        focusable={false}
        stable={false}
        question={
          <div className="rm-placement-result">
            <IconTile size={52}>
              <BoltIcon size={24} />
            </IconTile>
            <h1 ref={resultHeadingRef} tabIndex={-1} className="rm-finish-title">
              {learnText('placement.done')}
            </h1>
            <Text color="secondary" weight="bold">{t('roadmap.skillCheckResult', { correct, total })}</Text>
            {unapplied ? (
              <p role="alert" className="rm-placement-lead">{learnText('placement.applyFailed')}</p>
            ) : (
              <p className="rm-placement-lead">{t(tier as TranslationKey)}</p>
            )}
          </div>
        }
        actions={
          <>
            {/* One primary: Back to the map, or Try again while the receipt
                could not be applied. */}
            <QuestionActions
              primary={unapplied ? { label: t('roadmap.retry'), onClick: () => void applyReceipt(unapplied), disabled: applying } : back}
              secondary={
                <>
                  {unapplied && <AxButton variant="secondary" label={back.label} onClick={back.onClick} />}
                  <AxButton variant="ghost" label={learnText('placement.retry')} onClick={() => void start()} />
                </>
              }
            />
            <section className="rm-placement-review" aria-label={learnText('placement.review')}>
              <h2>{learnText('placement.review')}</h2>
              {review.map((item, index) => <article className="ss-info-card" key={item.questionId}>
                <h3>{index + 1}. {t(item.isCorrect ? 'quiz.correct' : 'quiz.incorrect')}</h3>
                {renderQuestion(item.question.question)}
                <p><strong>{learnText('placement.yourAnswer')}</strong> {item.question.options[item.selectedIndex] ?? learnText('placement.idkYet')}</p>
                <p><strong>{learnText('placement.correctAnswer')}</strong> {item.question.options[item.correctAnswer]}</p>
                <p>{item.explanation}</p>
              </article>)}
            </section>
          </>
        }
      />
    );
  }

  /* ── playing ── */
  if (!current) return null;
  // Overall progress across every round (asked = questions answered in prior
  // rounds), so the bar advances steadily toward the 20-question total.
  const answeredSoFar = asked + qIndex + (answered ? 1 : 0);
  const progressPct = total > 0 ? (answeredSoFar / total) * 100 : 0;
  const stepLabel = step === 'up' ? learnText('placement.steppingUp') : step === 'down' ? learnText('placement.steppingDown') : learnText('placement.holding');
  const stepHint = step === 'up' ? learnText('placement.steppingUpHint') : step === 'down' ? learnText('placement.steppingDownHint') : learnText('placement.converging');
  const primaryLabel = isLastInRound && round >= totalRounds ? learnText('placement.finish') : learnText('placement.next');
  const primaryDisabled = isLastInRound ? !roundComplete : !answered;
  const onPrimary = isLastInRound ? () => void submitRound() : goNext;
  const optionValue = answered && answers[current.id] >= 0 ? answers[current.id] : null;

  const roundLabel = learnText('placement.roundOf', { n: round, total: totalRounds });
  return (
    <QuestionShell
      ref={questionRef}
      questionId="placement-question"
      header={
        <QuestionHeader
          run={learnText('placement.kicker')}
          title={roundLabel}
          progress={{ value: progressPct, label: roundLabel }}
          status={<Text type="supporting" color="secondary">{qIndex + 1}/{roundSize}</Text>}
          meta={<CategoryTag category={current.category} />}
          tools={placementExit}
        />
      }
      question={
        <>
          {/* Between-round feedback: which way the difficulty just moved.
              role=status so assistive tech announces the shift when the round
              loads. Inside the question block, so the answers keep their y. */}
          {step && qIndex === 0 && (
            <div className="rm-step-banner" data-dir={step} role="status">
              <span className="rm-step-banner__glyph" aria-hidden="true"><StepArrowIcon dir={step} /></span>
              <strong>{stepLabel}</strong>
              <span className="rm-step-banner__hint">{stepHint}</span>
            </div>
          )}
          {renderQuestion(current.question)}
        </>
      }
      actions={<QuestionActions primary={{ label: primaryLabel, onClick: onPrimary, disabled: primaryDisabled }} />}
    >
      <AnswerOptionList
        options={current.options}
        value={optionValue}
        onChange={pick}
        labelledBy="placement-question"
      />
      {/* "I don't know yet" — an explicit miss (index -1), so an honest skip
          is offered instead of forcing a blind guess. Selecting it clears any
          option pick for this question. */}
      <button
        type="button"
        className="rm-idk-btn"
        data-selected={answers[current.id] === IDK_INDEX}
        aria-pressed={answers[current.id] === IDK_INDEX}
        onClick={() => pick(IDK_INDEX)}
      >
        {learnText('placement.idkYet')}
      </button>
      <p className="rm-idk-hint">{learnText('placement.idkYetHint')}</p>
    </QuestionShell>
  );
}

// /learn/big-o's page lives in its own module, so that route can load it
// without the map (#587 C17); App.tsx still reads it from here.
export { BigOIntroduction } from './learn/BigOIntroduction';

export default Roadmap;
