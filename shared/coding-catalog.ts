/** Pure coding-challenge catalogue data shared by browser and server code.
 *
 * Task bodies (prompts, starters, tests, hints) live under `lib/coding/tasks`
 * and reach the browser only through the API. Reference solutions and hidden
 * tests live under `lib/coding/solutions` and never leave the server. This
 * module owns the types, the track and tier vocabulary, the Easy/Medium/Hard
 * labels, the technique index, XP amounts, the difficulty ladder, the badge ids,
 * and the GitHub garden path rules, so every surface computes them the same way. */

import type { FailureCategory } from './coding-failure';
import type { PuzzleView } from './coding-puzzle';
import type { PublicItemReview } from './curation';
import { evolvingStage, isEvolvingCheckpoint } from './evolving';

export type CodingTrack = 'javascript' | 'typescript' | 'react' | 'system-design' | 'algorithms';
export type CodingTier = 1 | 2 | 3 | 4 | 5;
export type CodingVerify = 'tests' | 'checklist' | 'guided' | 'drill';

/** What the learner is asked to do, as opposed to how it is graded.
 *
 * `implement` writes code that is not there; `debug` starts from code that is
 * there and wrong. Both are usually graded by tests, so this is a separate
 * axis from `CodingVerify` — a filter, a label and an authoring decision, not a
 * second grading path. Absent means `implement`, so every existing task keeps
 * its meaning without being edited. */
const CODING_FORMATS = ['implement', 'debug'] as const;
export type CodingFormat = (typeof CODING_FORMATS)[number];
export const formatOf = (task: { format?: CodingFormat }): CodingFormat => task.format ?? 'implement';

export const CODING_TRACKS: readonly CodingTrack[] = ['javascript', 'typescript', 'react', 'system-design', 'algorithms'];
export const isCodingTrack = (value: unknown): value is CodingTrack =>
  typeof value === 'string' && (CODING_TRACKS as readonly string[]).includes(value);

/** The tracks the Coding section offers, and the only ones anything issues.
 *
 * System design is hidden until its tasks have been reviewed again (owner
 * decision, 9 Oct 2026; `NEEDED.md`): `lib/coding/active.ts` issues no task of
 * a track missing here, so no list, search, run, skip, Learn level, browser
 * index or share page holds one, the task resource answers 404 for it and
 * Submit refuses it. Its tasks, graders and sealed keys stay in `lib/coding`,
 * and `npm run test:coding` keeps proving them, for that review. Records
 * already earned against them stay in the database. `CODING_TRACKS` remains
 * the full authoring vocabulary. */
export const CODING_SECTION_TRACKS: readonly CodingTrack[] = ['javascript', 'typescript', 'react', 'algorithms'];
export const isCodingSectionTrack = (value: unknown): value is CodingTrack =>
  typeof value === 'string' && (CODING_SECTION_TRACKS as readonly string[]).includes(value);

/** Tracks whose `level` is a Learn level, and so worth naming to the learner.
 * System design carries no level at all. An `algorithms` task with topic
 * `algorithms` carries one only to order its challenges, and calling it
 * "Level 6" would claim a place in a curriculum the challenge is not part of.
 * The DSA Foundations tasks sit on the algorithms track with topic `dsa`
 * (and, from E4, `dsa-advanced`): their level is a DSA Learn level, so it is
 * named with that level. */
const LEARN_LEVEL_TRACKS: readonly CodingTrack[] = ['javascript', 'typescript', 'react'];
export const hasLearnLevel = (task: { track: CodingTrack; level: number; topic?: CodingTask['topic'] }): boolean =>
  task.level > 0 && (LEARN_LEVEL_TRACKS.includes(task.track)
    || task.topic === 'dsa'
    || task.topic === 'dsa-advanced');

/** The Learn topics whose levels seal coding tasks into a level attempt
 * (`levelCodingTasks` in `lib/coding/active.ts`, `api/quiz/roadmap.ts`).
 * E4 appends `dsa-advanced`. */
export const LEARN_CODING_TOPICS = ['javascript', 'typescript', 'react', 'dsa', 'dsa-advanced'] as const;
export type LearnCodingTopic = (typeof LEARN_CODING_TOPICS)[number];
export const isLearnCodingTopic = (topic: string): topic is LearnCodingTopic =>
  (LEARN_CODING_TOPICS as readonly string[]).includes(topic);

/** Tier ids, used as translation-key suffixes (`coding.tier.<id>`). */
export const CODING_TIERS: Record<CodingTier, string> = {
  1: 'foundations',
  2: 'fluency',
  3: 'combine',
  4: 'interview',
  5: 'capstone',
};
export const isCodingTier = (value: unknown): value is CodingTier =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5;

/* ──── Difficulty labels ─────────────────────────────────────────────────
 * Easy, Medium and Hard are what a learner reads on every listed challenge.
 * They are a projection of the tier ladder, not a second ladder: `tierUnlocked`,
 * `CODING_TASK_XP` and the badge rules keep reading the tier, and nothing
 * opens, locks or pays by label. The ids double as translation-key suffixes
 * (`coding.difficulty.<id>`). */
export const CODING_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof CODING_DIFFICULTIES)[number];
export const isDifficulty = (value: unknown): value is Difficulty =>
  typeof value === 'string' && (CODING_DIFFICULTIES as readonly string[]).includes(value);

/** A standalone task's label: tiers 1 and 2 are Easy, 3 is Medium, 4 and 5 are Hard. */
export const TIER_DIFFICULTY: Record<CodingTier, Difficulty> = { 1: 'easy', 2: 'easy', 3: 'medium', 4: 'hard', 5: 'hard' };

/** Where Easy and Medium end in a stage list, by its length: the last Easy
 * position and the last Medium position, one-based. Every project stage and
 * short-path level is tier 2 today, so a milestone's label comes from how far
 * along its path it sits. Five-level paths split 2/2/1, ten-stage projects
 * 3/4/3 and the twelve-stage FullStack apps 4/5/3. A checkpoint reads no band:
 * see `difficultyOf`. */
export const STAGE_DIFFICULTY_BANDS: Readonly<Record<number, readonly [number, number]>> = {
  5: [2, 4],
  10: [3, 7],
  12: [4, 9],
};

/** The label of the stage at zero-based `index` in a path of `length` stages.
 * A length with no authored band splits into rough thirds; the content test
 * requires a band for every length the catalogue actually uses. */
export function stageDifficulty(index: number, length: number): Difficulty {
  const [easyLast, mediumLast] = STAGE_DIFFICULTY_BANDS[length]
    ?? [Math.ceil(length / 3), length - Math.floor(length / 3)];
  const position = index + 1;
  return position <= easyLast ? 'easy' : position <= mediumLast ? 'medium' : 'hard';
}

/** Whether an authored label agrees with the tier it overrides. An Easy task
 * cannot sit at tier 3 or above, and a Hard task cannot sit at tier 1 or 2;
 * Medium fits any tier. `npm run test:coding` refuses an override that fails. */
export const difficultyFitsTier = (difficulty: Difficulty, tier: CodingTier): boolean =>
  difficulty === 'easy' ? tier <= 2 : difficulty === 'hard' ? tier >= 3 : true;

/** The label for a task or summary. An authored `difficulty` wins (the index
 * carries the resolved one); otherwise a project milestone or path level reads
 * its position, and a standalone task or a checkpoint reads its tier.
 *
 * A checkpoint is the five-minute step a project inserts before a milestone,
 * and it stays that size wherever it sits, so its label comes from the task
 * and not from its place in the list (owner decision, 9 Oct 2026): the
 * position bands called the last checkpoint of each project Hard and the
 * middle ones Medium. */
export function difficultyOf(task: { id: string; tier: CodingTier; difficulty?: Difficulty }): Difficulty {
  if (task.difficulty) return task.difficulty;
  const stage = evolvingStage(task.id);
  if (stage && !isEvolvingCheckpoint(task.id)) return stageDifficulty(stage.index, stage.challenge.stages.length);
  return TIER_DIFFICULTY[task.tier];
}

/** One runtime assertion: `call` is evaluated against the learner's code and
 * compared with `expected` by deep equality. Async calls are awaited. */
export interface CallTest {
  call: string;
  expected: unknown;
  label?: string;
  edge?: boolean;
  async?: boolean;
  /** What the Results row prints in place of `call`, when `call` carries its
   * fixtures or probe source inline (the DSA Foundations checks). Display
   * only: every runner executes `call`. */
  shown?: string;
}

/** One TypeScript type-level assertion, appended as a single line. A line marked
 * `rejects` passes only when the compiler refuses it. */
export interface TypeTest {
  code: string;
  label?: string;
  rejects?: boolean;
}

export interface CodingApiNote {
  method: string;
  url: string;
  note: string;
}

/** A guided system-design walkthrough: five questions in interview order. */
export interface GuidedDesignStep {
  key: string;
  title: string;
  prompt: string;
  options: string[];
  /** Index into `options`. Server-only in playable payloads. */
  correct: number;
  explanation: string;
}
export interface GuidedDesign {
  scenario: string;
  brief: string;
  steps: GuidedDesignStep[];
  /** The whole answer said out loud; shown after the walkthrough. */
  reference: string;
  passMark: number;
}

export type DesignDrillFormat = 'estimate' | 'tradeoff' | 'bottleneck' | 'sequence';
export interface DesignDrill {
  format: DesignDrillFormat;
  scenario: string;
  prompt: string;
  explanation: string;
  /** estimate */
  unit?: string;
  answer?: number;
  min?: number;
  max?: number;
  /** tradeoff / bottleneck */
  options?: string[];
  correct?: number;
  /** sequence: steps in the correct order */
  steps?: string[];
  /** sequence: other orders that are also right, each a permutation of the
   * authored step indices (`[0, 1, 3, 2, 4]` lets steps 3 and 4 swap). Graded
   * on the server only; the browser never sees them. */
  acceptedOrders?: number[][];
}

export interface CodingTask {
  /** Stable slug with the track prefix: `js-double-numbers`, `ts-typed-slug`,
   * `react-counter`, `sd-url-shortener`, `dd-qps-basic`, `alg-two-sum`. */
  id: string;
  /** interview-prepper id (`j12`, `t3`, `r7`, `c2`, `s1`, `d4`) for the progress import. */
  legacyId?: string;
  track: CodingTrack;
  /** Learn topic the task belongs to; system design tasks carry no Learn level.
   * Algorithms tasks carry topic `algorithms`, a topic of its own, so an
   * interview-prep challenge can never be drawn into a Learn level's quota.
   * The DSA Foundations tasks sit on the algorithms track with topic `dsa`
   * and fill the DSA Learn levels; `dsa-advanced` is reserved for E4. */
  topic: 'javascript' | 'typescript' | 'react' | 'system-design' | 'algorithms' | 'dsa' | 'dsa-advanced';
  /** Learn level 1–25 (index into LEVEL_TITLES). 0 for system design. */
  level: number;
  tier: CodingTier;
  /** An authored label, only where the derived one would mislead. It must fit
   * the tier (see `difficultyFitsTier`); absent means `difficultyOf` derives it. */
  difficulty?: Difficulty;
  /** Technique tags from CODING_TECHNIQUES. */
  focus: string[];
  title: string;
  prompt: string;
  starter: string;
  previousRequirements?: string[];
  references?: { title: string; url: string }[];
  skeleton?: string;
  hints: string[];
  approach?: string[];
  verify: CodingVerify;
  /** What the learner does. Absent means `implement`. */
  format?: CodingFormat;
  tests?: CallTest[];
  typeTests?: TypeTest[];
  /** React: Testing Library suite source for `/App.test.js`. */
  suite?: string;
  /** React checklist tasks: what the learner confirms before submitting. */
  checklist?: string[];
  api?: CodingApiNote;
  design?: GuidedDesign;
  drill?: DesignDrill;
  /** Authored hints for the way this task is usually got wrong, keyed by
   * failure category (see `shared/coding-failure.ts`). They are shown after a
   * failed run instead of the generic ladder rung, and they are versioned with
   * the task because they are part of its content. A category left out falls
   * back to the curated default for that category. */
  failureHints?: Partial<Record<FailureCategory, string>>;
  /** The mistake this task is built around, when there is one. Used only when
   * the run proves nothing more specific — never to override evidence. */
  pitfall?: FailureCategory;
  estimatedMinutes: number;
}

/** What the section list needs: no bodies, no tests. Generated into
 * `shared/coding-index.ts` from the task files. */
export interface CodingTaskSummary {
  id: string;
  track: CodingTrack;
  /** The Learn topic, present only where it differs from the track: the DSA
   * Foundations tasks (`dsa`) on the algorithms track. */
  topic?: CodingTask['topic'];
  level: number;
  tier: CodingTier;
  /** The resolved label (`difficultyOf`), written into the index at build time. */
  difficulty: Difficulty;
  focus: string[];
  title: string;
  verify: CodingVerify;
  /** Absent means `implement`; the section reads it to offer a format filter. */
  format?: CodingFormat;
  estimatedMinutes: number;
  /** On the free tier. Projected from `shared/tiers.ts` by
   * `npm run build:coding-index`; absent means Premium. */
  free?: true;
}

/** What the browser receives to play a task: everything except the answers. */
export interface PlayableCodingTask extends CodingTaskSummary {
  /** The version of this brief, plus the machine evidence behind it. A coding
   * task's solution is executed against its own grader by the content
   * contract, which is evidence that it is solvable exactly as specified and
   * is not evidence that it has no defects. */
  review?: PublicItemReview;
  legacyId?: string;
  prompt: string;
  previousRequirements?: string[];
  references?: { title: string; url: string }[];
  starter: string;
  skeleton?: string;
  hints: string[];
  approach?: string[];
  tests?: CallTest[];
  typeTests?: TypeTest[];
  suite?: string;
  checklist?: string[];
  api?: CodingApiNote;
  /** The authored failure hints travel with the playable task so the Run
   * button can show the same line the server would. They are teaching text,
   * not answer material: none of them names an input or an expected value. */
  failureHints?: Partial<Record<FailureCategory, string>>;
  pitfall?: FailureCategory;
  /** The code-ordering puzzle for narrow screens, lines already shuffled. The
   * accepted orders are not here and never leave the server. */
  puzzle?: PuzzleView;
  design?: {
    scenario: string;
    brief: string;
    passMark: number;
    steps: { key: string; title: string; prompt: string; options: string[] }[];
  };
  drill?: {
    format: DesignDrillFormat;
    scenario: string;
    prompt: string;
    unit?: string;
    options?: string[];
    steps?: string[];
  };
}

/** The technique index shown on the Coding home. Ids double as `focus` tags
 * and as translation-key suffixes (`coding.focus.<id>`). */
export const CODING_TECHNIQUE_GROUPS = {
  loops: ['for', 'while', 'do-while', 'for-of', 'for-in', 'nested-loops', 'two-pointer'],
  'array-methods': ['map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every', 'includes', 'indexOf', 'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'sort', 'flat', 'forEach', 'concat', 'join'],
  strings: ['strings', 'split', 'regex'],
  objects: ['objects', 'destructuring', 'spread', 'map-set', 'json'],
  functions: ['functions', 'closures', 'higher-order', 'recursion', 'callbacks'],
  async: ['promises', 'async-await', 'timers', 'fetch', 'abort'],
  types: ['annotations', 'interfaces', 'unions', 'literal-types', 'tuples', 'optional', 'readonly', 'narrowing', 'type-guards', 'generics', 'constraints', 'keyof', 'utility-types', 'record'],
  hooks: ['useState', 'useEffect', 'useRef', 'useReducer', 'useContext', 'useMemo', 'custom-hook', 'effect-cleanup'],
  rendering: ['jsx', 'lists-keys', 'conditional', 'forms', 'events', 'derived-state', 'accessibility', 'pagination'],
  design: ['estimation', 'tradeoff', 'bottleneck', 'sequence', 'scoping', 'data-model', 'request-flow', 'failure', 'scale', 'caching', 'queues', 'auth', 'networking'],
} as const;
export type CodingTechniqueGroup = keyof typeof CODING_TECHNIQUE_GROUPS;
/** @public Authoring adapter: scripts/port-interview-prepper.mjs reads this from its generated module. */
export const CODING_TECHNIQUES: readonly string[] = Object.values(CODING_TECHNIQUE_GROUPS).flat();
const TECHNIQUE_GROUP = new Map<string, CodingTechniqueGroup>();
for (const [group, tags] of Object.entries(CODING_TECHNIQUE_GROUPS)) {
  for (const tag of tags) TECHNIQUE_GROUP.set(tag, group as CodingTechniqueGroup);
}
export const techniqueGroup = (tag: string): CodingTechniqueGroup | undefined => TECHNIQUE_GROUP.get(tag);
export const isCodingTechnique = (tag: string): boolean => TECHNIQUE_GROUP.has(tag);

/** Loop and array-method tags the confidence badges count. */
const LOOP_TAGS: readonly string[] = CODING_TECHNIQUE_GROUPS.loops;
const METHOD_TAGS: readonly string[] = CODING_TECHNIQUE_GROUPS['array-methods'];

/** Base XP for a verified pass. Level XP in Learn is 50 × difficulty,
 * so a foundation task is worth half a level. */
export const CODING_TASK_XP: Record<CodingTier, number> = { 1: 25, 2: 25, 3: 25, 4: 25, 5: 25 };

/** Learn levels of the `javascript` topic that count as the foundations.
 * Clearing them opens JavaScript tier 3, and no other track's. */
export const CODING_FOUNDATION_LEVELS = 10;

export interface CodingProgressSummary {
  /** Passed task ids (revealed tasks are not passed). */
  passed: ReadonlySet<string>;
}

export interface CodingLadderInput {
  track: CodingTrack;
  tier: CodingTier;
  progress: CodingProgressSummary;
  /** Task summaries for the same track, to count what each tier holds. */
  tasks: readonly CodingTaskSummary[];
  /** Highest contiguous cleared `javascript` Learn level (0 when none). */
  javascriptLevelsCleared: number;
}

/** The ids each tier of each track counts, per task list, computed once.
 * `evolvingStage` scans every project for one id, and a practice run or the
 * section list asks the ladder about every task, so recounting the list on
 * each question cost about 40 ms per pass over the catalogue. The lists are
 * readonly catalogues, so a list is keyed by identity. */
const LADDER_TIERS = new WeakMap<readonly CodingTaskSummary[], Map<string, string[]>>();
const ladderTier = (tasks: readonly CodingTaskSummary[], track: CodingTrack, tier: CodingTier): readonly string[] => {
  let tiers = LADDER_TIERS.get(tasks);
  if (!tiers) {
    tiers = new Map();
    for (const task of tasks) {
      if (evolvingStage(task.id)) continue;
      const key = `${task.track}:${task.tier}`;
      const ids = tiers.get(key);
      if (ids) ids.push(task.id);
      else tiers.set(key, [task.id]);
    }
    LADDER_TIERS.set(tasks, tiers);
  }
  return tiers.get(`${track}:${tier}`) ?? [];
};

const tierPassRatio = (tier: CodingTier, input: CodingLadderInput): number => {
  const inTier = ladderTier(input.tasks, input.track, tier);
  if (inTier.length === 0) return 0;
  let passed = 0;
  for (const id of inTier) if (input.progress.passed.has(id)) passed += 1;
  return passed / inTier.length;
};

/** Tracks that are practised rather than progressed through, so none of their
 * tiers is ever gated. System design is taught in Learn and drilled here;
 * `algorithms` is interview preparation a learner comes to with a date in the
 * diary, where a locked tier would withhold the very challenge they came for.
 * Both still grade, award XP and record history exactly like any other task. */
const UNLADDERED_TRACKS: readonly CodingTrack[] = ['system-design', 'algorithms'];

/** The difficulty ladder. Tiers 1 and 2 are always open; 3 opens after a
 * clean sweep of tiers 1–2 in that track, and JavaScript's also after the
 * JavaScript Learn foundations (owner decision, 9 October 2026: the Learn
 * levels teach JavaScript, so they open no other track); 4 after 80 % of
 * tier 3; 5 (React capstones) after 80 % of tier 4. The unladdered tracks
 * have no ladder: every one of their challenges is open. The task page, a
 * practice run, a skip's suggestion and the browser all ask this one rule. */
export function tierUnlocked(input: CodingLadderInput): boolean {
  if (UNLADDERED_TRACKS.includes(input.track)) return true;
  switch (input.tier) {
    case 1:
    case 2:
      return true;
    case 3:
      return (input.track === 'javascript' && input.javascriptLevelsCleared >= CODING_FOUNDATION_LEVELS) ||
        (tierPassRatio(1, input) >= 1 && tierPassRatio(2, input) >= 1);
    case 4:
      return tierPassRatio(3, input) >= 0.8;
    case 5:
      return input.track === 'react' && tierPassRatio(4, input) >= 0.8;
    default:
      return false;
  }
}

/** Why a tier is locked, as a translation-key suffix (`coding.lock.<reason>`).
 * JavaScript tier 3 names both ways in (`foundations`); every other track's
 * names the sweep alone (`sweep`). */
export function tierLockReason(input: CodingLadderInput): 'foundations' | 'sweep' | 'tier3' | 'tier4' | null {
  if (tierUnlocked(input)) return null;
  if (input.tier === 3) return input.track === 'javascript' ? 'foundations' : 'sweep';
  if (input.tier === 4) return 'tier3';
  return 'tier4';
}

/** Cosmetic badge ids for the coding tracks (labels in the i18n tables). */
export const CODING_BADGE_IDS = ['loop-shark', 'method-shark', 'typed-shark', 'hooked-shark', 'capstone-shark'] as const;
export type CodingBadgeId = (typeof CODING_BADGE_IDS)[number];

/** The badge conditions, computed from passed task ids and the task index. */
export function eligibleCodingBadges(passed: ReadonlySet<string>, tasks: readonly CodingTaskSummary[]): CodingBadgeId[] {
  const allPassed = (subset: CodingTaskSummary[]) => subset.length > 0 && subset.every((task) => passed.has(task.id));
  const withTag = (tags: readonly string[]) => (task: CodingTaskSummary) => task.focus.some((tag) => tags.includes(tag));
  const earned: CodingBadgeId[] = [];
  if (allPassed(tasks.filter((t) => t.track === 'javascript' && t.tier <= 2 && withTag(LOOP_TAGS)(t)))) earned.push('loop-shark');
  if (allPassed(tasks.filter((t) => t.track === 'javascript' && t.tier <= 2 && withTag(METHOD_TAGS)(t)))) earned.push('method-shark');
  if (allPassed(tasks.filter((t) => t.track === 'typescript' && t.tier <= 3))) earned.push('typed-shark');
  if (allPassed(tasks.filter((t) => t.track === 'react' && t.tier <= 3))) earned.push('hooked-shark');
  if (allPassed(tasks.filter((t) => t.track === 'react' && t.tier === 5))) earned.push('capstone-shark');
  return earned;
}

/* ──── GitHub garden paths ─────────────────────────────────────────────── */

const TRACK_PREFIX: Record<CodingTrack, string[]> = {
  javascript: ['js-'],
  typescript: ['ts-'],
  react: ['react-'],
  'system-design': ['sd-', 'dd-'],
  algorithms: ['alg-'],
};
const TRACK_EXTENSION: Record<CodingTrack, string> = {
  javascript: 'js',
  typescript: 'ts',
  react: 'jsx',
  'system-design': 'md',
  algorithms: 'js',
};

/** `javascript/04-queue-with-push-shift.js`: one folder per track, one file per task. */
export function gardenPathFor(task: Pick<CodingTaskSummary, 'id' | 'track' | 'level'>): string {
  const prefix = TRACK_PREFIX[task.track].find((p) => task.id.startsWith(p)) ?? '';
  const slug = task.id.slice(prefix.length);
  const order = String(Math.max(0, Math.min(99, task.level))).padStart(2, '0');
  return `${task.track}/${order}-${slug}.${TRACK_EXTENSION[task.track]}`;
}

export const isCodingTaskId = (value: unknown): value is string =>
  typeof value === 'string' && /^(js|ts|react|sd|dd|alg)-[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 64;
