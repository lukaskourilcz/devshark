// Roadmap ("Learn") structure — the single source of truth for the Duolingo-style
// learning path. Each topic has a series of ordered levels (easiest → hardest)
// with 8 questions each, plus a checkpoint after every 5 levels. A checkpoint is
// a big 40-question exam over those 5 levels; the learner must score
// CHECKPOINT_PASS% to unlock the next segment of levels.
//
// Topics can have different lengths: JS/TS/React run 25 levels (5 checkpoints),
// while Git runs 15 levels (3 checkpoints). Everything below derives per-topic
// counts from the level-title arrays, so adding a topic only means adding titles
// and its question seeds.
//
// The /api/quiz/roadmap endpoint reads this to build the level map and serve a
// level's or checkpoint's questions; the client renders the path from the same
// structure (fetched at runtime) so titles never drift out of sync.

import { QUESTIONS_PER_LEVEL, ROADMAP_LEVELS, difficultyForLevel } from './roadmap-build';
import { restoredQuestionIds } from './roadmap-questions-restored';
import { PARTS_PER_TOPIC, partRanges, type StepAvailability } from '../shared/progression';
import { levelLessonId } from './learn-lessons/levels';

export type RoadmapTopic =
  | 'javascript' | 'typescript' | 'react' | 'nextjs' | 'nodejs'
  | 'html' | 'css' | 'git' | 'dsa' | 'dsa-advanced' | 'algorithms'
  | 'abbreviations' | 'general' | 'ai' | 'cool-stuff'
  | 'databases' | 'system-design' | 'testing' | 'devops' | 'security';

// `abbreviations` and `testing` were retired as standalone paths (#177, #179).
// Their type members, id prefixes and level titles stay so the seed banks and
// every historical id still resolve; they are simply never offered.
export const ROADMAP_TOPICS: RoadmapTopic[] = [
  'javascript', 'typescript', 'react', 'nextjs', 'nodejs',
  'html', 'css', 'git', 'dsa', 'dsa-advanced', 'algorithms',
  'general', 'ai', 'cool-stuff',
  'databases', 'system-design', 'devops', 'security',
];

// Pass thresholds (percent). Levels are gentle; checkpoints are the real gate.
export const LEVEL_PASS = 75;
const CHECKPOINT_PASS = 85;

// A checkpoint sits after every Nth level.
export const LEVELS_PER_CHECKPOINT = 5;
// Upper bound on checkpoints across all topics (the longest topic is 25 levels).
// Used as a permissive validation bound; per-topic counts come from the helpers.
export const CHECKPOINT_COUNT = ROADMAP_LEVELS / LEVELS_PER_CHECKPOINT; // 5

// Id prefix used by each topic's question seeds (see lib/roadmap-questions-*.ts).
const ID_PREFIX: Record<RoadmapTopic, string> = {
  javascript: 'rm-js',
  typescript: 'rm-ts',
  react: 'rm-react',
  nextjs: 'rm-next',
  nodejs: 'rm-node',
  html: 'rm-html',
  css: 'rm-css',
  git: 'rm-git',
  dsa: 'rm-dsa',
  'dsa-advanced': 'rm-dsaa',
  algorithms: 'rm-algorithms',
  abbreviations: 'rm-abbr',
  general: 'rm-general',
  ai: 'rm-ai',
  'cool-stuff': 'rm-cool',
  databases: 'rm-db',
  'system-design': 'rm-sysdesign',
  testing: 'rm-testing',
  devops: 'rm-devops',
  security: 'rm-security',
};

// Level titles per topic, in increasing difficulty. Index 0 is level 1. The
// length of each array defines how many levels the topic has.
const LEVEL_TITLES: Record<RoadmapTopic, string[]> = {
  "dsa-advanced": ["Heaps and priority queues", "Graph representation", "Breadth-first and depth-first search", "Shortest paths", "Topological sort and union-find", "Tries", "Backtracking", "Greedy algorithms", "Intervals", "Sliding window and two pointers", "One-dimensional dynamic programming", "Two-dimensional dynamic programming", "Bit manipulation", "Sorting algorithms and proofs", "Advanced review"],
  javascript: [
    'Values & Math', 'Strings', 'Booleans & Comparison', 'Arrays: Basics', 'Objects: Basics',
    'Array Iteration', 'Filter & Find', 'Reduce', 'Destructuring', 'Spread & Rest',
    'Functions & Scope', 'Closures', 'Hoisting & let/const', 'this & Context', 'Callbacks & HOFs',
    'Ternary & Short-circuit', 'Type Coercion', 'Truthy / Falsy', 'JSON & Objects', 'Optional & Nullish',
    'Promises', 'Async / Await', 'Sets & Maps', 'Edge Cases & Gotchas', 'Mixed Mastery',
  ],
  typescript: [
    'Basic Types', 'Type Inference', 'Function Types', 'Arrays & Tuples', 'Object Types',
    'Interfaces', 'Union Types', 'Literal Types', 'Optional & Readonly', 'Type Aliases',
    'Type Narrowing', 'Type Guards', 'Enums', 'Generics: Basics', 'Generic Constraints',
    'keyof & typeof', 'Indexed Access', 'Partial & Required', 'Pick & Omit', 'Record',
    'Mapped Types', 'Conditional Types', 'infer', 'Template Literals', 'Mixed Mastery',
  ],
  react: [
    'JSX Basics', 'Components', 'Props', 'Rendering Lists', 'Conditional Rendering',
    'useState: Basics', 'Event Handling', 'Updating State', 'State: Objects & Arrays', 'Derived State',
    'useEffect: Basics', 'Effect Dependencies', 'Cleanup Functions', 'useRef', 'Forms & Inputs',
    'Lifting State Up', 'useMemo', 'useCallback', 'useReducer', 'useContext',
    'Custom Hooks', 'Keys & Reconciliation', 'Performance Patterns', 'Common Pitfalls', 'Mixed Mastery',
  ],
  nextjs: [
    'Next.js Basics', 'Routing (App Router)', 'Pages & Layouts', 'Navigation & Links', 'Server & Client Components',
    'Data Fetching', 'Dynamic Routes', 'Rendering Strategies', 'Route Handlers', 'Server Actions',
    'Metadata & SEO', 'Styling', 'Images & Fonts', 'Loading & Errors', 'Middleware & Config',
  ],
  nodejs: [
    'Node Basics', 'Modules (CommonJS)', 'ES Modules', 'Globals & process', 'The Event Loop',
    'Path', 'File System', 'OS & Util', 'Events', 'Streams',
    'Buffers', 'HTTP Server', 'Callbacks & Promisify', 'Async / Await', 'Environment & CLI',
    'npm & package.json', 'Error Handling', 'Timers & Scheduling', 'Child Processes', 'Crypto',
    'Express: Basics', 'Express: Req & Res', 'Concurrency', 'Testing & Debugging', 'Mixed Mastery',
  ],
  git: [
    'Version Control Basics', 'Repositories', 'Staging & Status', 'Committing', 'History & Diffs',
    'Branches', 'Merging', 'Remotes', 'Push & Pull', 'Undoing Changes',
    'Stashing', 'Rebasing', 'Tags & .gitignore', 'Collaboration & PRs', 'Advanced Git',
  ],
  // Six levels each after #180. Accessibility runs through every HTML level
  // rather than sitting at the end as a vocabulary test, and CSS spends its
  // levels on the model the browser applies rather than on one library's
  // vocabulary.
  html: [
    'Structure & Semantics', 'Links, Buttons & Interaction', 'Forms',
    'Images, Media & Responsive Delivery', 'Real Content Structures', 'Inspect & Repair',
  ],
  css: [
    'Cascade, Inheritance & Selectors', 'Box Model, Flow & Overflow', 'Flexbox',
    'Grid & Responsive Layout', 'Positioning & Stacking', 'Maintainable, Accessible Styling',
  ],
  dsa: [
    'Complexity Basics', 'Big O and Growth', 'Arrays', 'Strings', 'Hash Maps and Sets',
    'Stacks', 'Queues', 'Singly Linked Lists', 'Recursion Foundations', 'Linear and Binary Search',
    'Basic Sorting', 'Trees', 'Binary Search Trees', 'Complexity in Practice', 'Foundation Review',
  ],
  algorithms: [
    'Ratios & Proportions', 'Modular Arithmetic', 'Combinatorics', 'Probability', 'Prime Numbers & Divisibility',
    'Algebraic Thinking', 'Bitwise Logic', 'Logic Puzzles', 'Recurrences & Growth', 'Problem Solving',
  ],
  abbreviations: [
    'Languages & Runtimes', 'Web Standards', 'APIs & Data Formats', 'Frontend Rendering', 'Build & Tooling',
    'Version Control & Workflow', 'Auth & Security', 'Networking', 'Databases & Storage', 'Cloud & Infra',
    'Architecture Patterns', 'Performance Metrics', 'Testing & Quality', 'DevOps & Containers', 'Acronym Mastery',
  ],
  general: [
    'How the Web Works', 'Clients & Servers', 'HTTP Methods', 'HTTP Status Codes', 'URLs & Routing',
    'How Browsers Render', 'How Code Runs', 'How Frameworks Work', 'Frontend vs Backend', 'APIs & Communication',
    'Caching & CDNs', 'Authentication Basics', 'Databases Overview', 'Deployment & Hosting', 'Performance & Optimization',
    // Testing Foundations, which replaced the standalone Testing path (#179).
    'What Tests Can Prove', 'Read a Meaningful Test', 'Make Checks Reliable', 'Verify a Change',
  ],
  ai: [
    'What is AI?', 'Machine Learning Basics', 'Neural Networks', 'What is an LLM?', 'Tokens & Tokenization',
    'Training Data & Datasets', 'Transformers & Attention', 'Prompting Basics', 'Context Windows', 'Embeddings & Vectors',
    'Sampling & Temperature', 'Hallucinations & Limitations', 'Fine-tuning & RAG', 'Using AI APIs', 'Chat Assistants & System Prompts',
    'Multimodal Models', 'AI Safety & Alignment', 'Bias & Ethics', 'AI Agents & Tool Use', 'The Modern AI Landscape',
  ],
  'cool-stuff': [
    'JavaScript: Birth & Names', 'JavaScript: Weird Parts', 'Birth of the Web', 'Internet Firsts', 'Famous Software Disasters',
    'The Original Bug', 'Worms, Viruses & Spam', 'Programming Pioneers', 'Language Naming & Lore', 'Esoteric Languages',
    'Mascots, Logos & Symbols', 'Hardware Marvels & Oddities', 'Gaming & Easter Eggs', 'Bizarre Tech Tales', 'Tech Trivia Mastery',
  ],
  databases: [
    'What is a Database?', 'Relational Basics', 'SQL SELECT Basics', 'Filtering & Sorting', 'Aggregations & GROUP BY',
    'Joins', 'Schema Design & Normalization', 'Keys & Constraints', 'Data Types & NULL', 'Indexing',
    'Transactions & ACID', 'Isolation & Locking', 'The N+1 Problem', 'NoSQL & When to Use It', 'Performance & Scaling',
  ],
  'system-design': [
    'System Design Basics', 'Client–Server & APIs', 'Scaling: Vertical vs Horizontal', 'Load Balancing', 'Caching',
    'Databases at Scale', 'Sharding & Partitioning', 'Message Queues & Async', 'Consistency & CAP', 'Rate Limiting',
    'CDNs & Edge', 'Failure Modes & Resilience', 'Observability & Monitoring', 'Trade-offs & Estimation', 'Designing Real Systems',
  ],
  testing: [
    'Why Test?', 'The Testing Pyramid', 'Unit Tests', 'Assertions & Matchers', 'Test Structure (AAA)',
    'Mocks, Stubs & Spies', 'Integration Tests', 'End-to-End Tests', 'Testing Async Code', 'Test Doubles & Fakes',
    'Coverage & What to Test', 'TDD', 'Flaky Tests & Isolation', 'Testing in CI', 'Testing Best Practices',
  ],
  devops: [
    'What is DevOps?', 'Version Control & Git Flow', 'CI Basics', 'CD & Deployment', 'Build Pipelines',
    'Containers & Docker', 'Container Orchestration', 'Infrastructure as Code', 'Cloud Fundamentals', 'Deploying to the Cloud',
    'Environments & Config', 'Observability & Logging', 'Monitoring & Alerting', 'Secrets & Security in CI', 'Reliability & SRE',
  ],
  security: [
    'Security Fundamentals', 'Authentication', 'Authorization', 'Passwords & Hashing', 'Sessions & Tokens (JWT)',
    'HTTPS & TLS', 'Injection (SQLi)', 'XSS', 'CSRF', 'OWASP Top 10',
    'Secrets Management', 'Secure Defaults & Headers', 'Dependency & Supply Chain', 'Data Protection & Privacy', 'Secure Design & Threat Modeling',
  ],
};

// Names for the early checkpoints; the final checkpoint of any topic is always
// the "Final Mastery Exam".
const CHECKPOINT_TITLES = ['Foundations Exam', 'Core Skills Exam', 'Intermediate Exam', 'Advanced Exam'];
const FINAL_CHECKPOINT_TITLE = 'Final Mastery Exam';

export interface RoadmapLevelMeta {
  /** 1-based level number. */
  level: number;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  questionCount: number;
  /** devShark code topics only: how many coding tasks close this level. */
  codingTasks?: number;
  /** Too few served questions to open. Kept on the map with its number so
   * progress records keep their meaning; never a prerequisite. */
  unavailable?: true;
  /** The lesson the level opens with, before its questions (#492). Reading it
   * is free, never gates the level and records nothing; served by
   * `?resource=lesson&id=` (lib/learn-lessons). */
  lessonId?: string;
}

export interface RoadmapCheckpointMeta {
  /** 1-based checkpoint number. */
  checkpoint: number;
  title: string;
  /** The level this checkpoint sits after (5, 10, 15, …). */
  afterLevel: number;
  questionCount: number;
  passPct: number;
  /** No available level in its segment, so nothing to examine. */
  unavailable?: true;
}

export interface RoadmapTopicStructure {
  levels: RoadmapLevelMeta[];
  checkpoints: RoadmapCheckpointMeta[];
}

/** How many levels a topic has. */
export function topicLevelCount(topic: RoadmapTopic): number {
  return LEVEL_TITLES[topic].length;
}

/** How many checkpoints a topic has (one per 5 levels). */
function topicCheckpointCount(topic: RoadmapTopic): number {
  return Math.floor(topicLevelCount(topic) / LEVELS_PER_CHECKPOINT);
}

/** The question ids that make up a given topic/level (1-based level). */
export function levelQuestionIds(topic: RoadmapTopic, level: number): string[] {
  const start = (level - 1) * QUESTIONS_PER_LEVEL + 1;
  return [...Array.from({ length: QUESTIONS_PER_LEVEL }, (_, i) => `${ID_PREFIX[topic]}-${start + i}`), ...restoredQuestionIds(topic, level)];
}

/** The `lessonId` field of a level's metadata, or nothing. */
function lessonField(topic: RoadmapTopic, level: number): { lessonId?: string } {
  const lessonId = levelLessonId(topic, level);
  return lessonId ? { lessonId } : {};
}

/** Level metadata for one topic (titles, difficulty, count) — the path to render. */
export function topicLevels(topic: RoadmapTopic): RoadmapLevelMeta[] {
  return LEVEL_TITLES[topic].map((title, i) => ({
    level: i + 1,
    title,
    difficulty: difficultyForLevel(i + 1),
    questionCount: levelQuestionIds(topic, i + 1).length,
    ...lessonField(topic, i + 1),
  }));
}

/** Checkpoint metadata for one topic. */
export function topicCheckpoints(topic: RoadmapTopic): RoadmapCheckpointMeta[] {
  const count = topicCheckpointCount(topic);
  const levelCount = topicLevelCount(topic);
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const isFinal = n * LEVELS_PER_CHECKPOINT === levelCount;
    return {
      checkpoint: n,
      // "Final" only when the checkpoint really ends the topic. A topic whose
      // level count is not a multiple of five has levels after its last
      // checkpoint, and calling that one final would promise an end it is not.
      title: isFinal ? FINAL_CHECKPOINT_TITLE : CHECKPOINT_TITLES[i] ?? `Checkpoint ${n}`,
      afterLevel: n * LEVELS_PER_CHECKPOINT,
      questionCount: QUESTIONS_PER_LEVEL * LEVELS_PER_CHECKPOINT, // 40
      passPct: CHECKPOINT_PASS,
    };
  });
}

/* ──── dynamic ("live") structure ───────────────────────────────────────────
 * The functions above describe the *authored* path (a fixed N levels × 8). The
 * served set is smaller: the owner can hide a question from /dev, and the
 * content audit's eligibility gate withholds anything retired, quarantined,
 * edited since its review or never reviewed. The builders below take a
 * predicate for which question ids are actually served and recompute the path
 * from the surviving set.
 *
 * Levels keep their authored membership. Question `rm-js-41` belongs to level
 * 6 whether or not `rm-js-40` survives, because the level's title is its
 * objective and the coding tasks attached to it are keyed by its number: the
 * previous behaviour of repacking survivors eight at a time slid questions
 * across level boundaries and put "Closures" material under the "Functions &
 * Scope" title. A level with fewer survivors is served with fewer questions.
 * A level with fewer than `MIN_LEVEL_QUESTIONS` is *unavailable*: it is still
 * on the map with its number, so progress records keep their meaning, but it
 * cannot be opened, it is never a prerequisite, and its questions are not
 * drawn into the segment's checkpoint or part test — the shared progression
 * rules step over it. That is the honest "not enough reviewed content" state
 * the audit asks for, rather than a thin level pretending to be a full one.
 * The static functions are kept for the build scripts (integrity checks),
 * which always want the full authored set.
 * ─────────────────────────────────────────────────────────────────────────── */

/** The fewest served questions a level may open with. Below this a level is
 * marked unavailable rather than served as a two-question lesson. Three is
 * the smallest count at which the 75% pass mark still means something (a
 * miss fails the level, as it would with eight). */
export const MIN_LEVEL_QUESTIONS = 3;

export interface LiveTopic {
  levels: RoadmapLevelMeta[];
  checkpoints: RoadmapCheckpointMeta[];
  /** levelIds[level - 1] = the served question ids of that authored level.
   * Empty for an unavailable level. */
  levelIds: string[][];
  /** The levels that cannot be opened, for the progression rules. */
  unavailableLevels: Set<number>;
  /** The authored five-level checkpoints with no available level to examine. */
  unavailableCheckpoints: Set<number>;
  /** The part tests with no available level to examine. */
  unavailableParts: Set<number>;
}

/** Recompute a topic's levels/checkpoints from the questions that are served. */
export function buildLiveTopic(topic: RoadmapTopic, exists: (id: string) => boolean): LiveTopic {
  const levelCount = topicLevelCount(topic);
  const titles = LEVEL_TITLES[topic];

  const levels: RoadmapLevelMeta[] = [];
  const levelIds: string[][] = [];
  const unavailableLevels = new Set<number>();
  for (let l = 1; l <= levelCount; l++) {
    const served = levelQuestionIds(topic, l).filter(exists);
    const available = served.length >= MIN_LEVEL_QUESTIONS;
    if (!available) unavailableLevels.add(l);
    levelIds.push(available ? served : []);
    levels.push({
      level: l,
      title: titles[l - 1],
      difficulty: difficultyForLevel(l),
      questionCount: available ? served.length : 0,
      ...(available ? {} : { unavailable: true }),
      ...lessonField(topic, l),
    });
  }

  const checkpointCount = Math.floor(levelCount / LEVELS_PER_CHECKPOINT);
  const checkpoints: RoadmapCheckpointMeta[] = [];
  const unavailableCheckpoints = new Set<number>();
  for (let n = 1; n <= checkpointCount; n++) {
    const afterLevel = n * LEVELS_PER_CHECKPOINT;
    const isFinal = afterLevel === levelCount;
    let questionCount = 0;
    for (let l = afterLevel - LEVELS_PER_CHECKPOINT + 1; l <= afterLevel; l++) {
      questionCount += levelIds[l - 1].length;
    }
    if (questionCount === 0) unavailableCheckpoints.add(n);
    checkpoints.push({
      checkpoint: n,
      title: isFinal ? FINAL_CHECKPOINT_TITLE : CHECKPOINT_TITLES[n - 1] ?? `Checkpoint ${n}`,
      afterLevel,
      questionCount,
      passPct: CHECKPOINT_PASS,
      ...(questionCount === 0 ? { unavailable: true } : {}),
    });
  }
  const unavailableParts = new Set<number>();
  for (const range of partRanges(levelCount)) {
    let served = 0;
    for (let l = range.startLevel; l <= range.endLevel; l++) served += levelIds[l - 1]?.length ?? 0;
    if (range.size <= 0 || served === 0) unavailableParts.add(range.part);
  }
  return { levels, checkpoints, levelIds, unavailableLevels, unavailableCheckpoints, unavailableParts };
}

/** The availability the shared progression rules read, from a live topic.
 * Checkpoints mean part tests here, because those are the exams the learner
 * sits and the numbers the progress record stores. */
export function liveAvailability(live: LiveTopic): StepAvailability {
  return {
    levelCount: live.levels.length,
    unavailableLevels: live.unavailableLevels,
    unavailableCheckpoints: live.unavailableParts,
  };
}

/** The unavailable parts of a live structure entry as sent to the browser,
 * derived the same way the server derives them so the two agree. */
export function unavailablePartsOf(levels: readonly RoadmapLevelMeta[]): number[] {
  const out: number[] = [];
  for (const range of partRanges(levels.length)) {
    const anyAvailable = levels.slice(range.startLevel - 1, range.endLevel).some((level) => !level.unavailable);
    if (range.size <= 0 || !anyAvailable) out.push(range.part);
  }
  return out;
}

/** The full live structure for every topic, given the surviving-id predicate. */
export function liveRoadmapStructure(
  exists: (id: string) => boolean,
): Record<RoadmapTopic, RoadmapTopicStructure> {
  const out = {} as Record<RoadmapTopic, RoadmapTopicStructure>;
  for (const topic of ROADMAP_TOPICS) {
    const live = buildLiveTopic(topic, exists);
    out[topic] = { levels: live.levels, checkpoints: live.checkpoints };
  }
  return out;
}

export function isRoadmapTopic(value: unknown): value is RoadmapTopic {
  return typeof value === 'string' && (ROADMAP_TOPICS as string[]).includes(value);
}

export function isValidLevel(topic: RoadmapTopic, level: number): boolean {
  return Number.isInteger(level) && level >= 1 && level <= topicLevelCount(topic);
}

/* ──── parts ("learning paths" split) ──────────────────────────────────────
 * Each topic is presented to the learner as PARTS_PER_TOPIC shorter, sequential
 * "parts" instead of one long path — every part ends with its own test. The
 * split itself lives in shared/progression.ts, because the unlock rules the
 * server enforces and the map the browser draws both read it; this module
 * re-exports it for the API and adds the test size.
 * ─────────────────────────────────────────────────────────────────────────── */

/** @public Compatibility facade for roadmap API/authoring imports; values remain owned by the shared/build modules. */
export { PARTS_PER_TOPIC, partSizes, partRanges, type PartRange } from '../shared/progression';
// A part's end-of-part test uses the same gate the old checkpoints did.
export const PART_TEST_PASS = CHECKPOINT_PASS;
// Max questions sampled into a part test. A part spans 2–9 levels (× 8), so the
// test is a focused exam over the part rather than its whole question pool.
export const PART_TEST_SIZE = 20;

export function isValidPart(part: number): boolean {
  return Number.isInteger(part) && part >= 1 && part <= PARTS_PER_TOPIC;
}

/** @public Compatibility facade for roadmap API/authoring imports; values remain owned by the shared/build modules. */
export { ROADMAP_LEVELS, QUESTIONS_PER_LEVEL };
