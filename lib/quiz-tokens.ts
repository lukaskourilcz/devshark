import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { isScopeSubject, type ScopeSubjectId } from '../shared/subject-catalog';
import { isLearningPathId, type LearningPathId } from '../shared/learning-paths';
import { isCodingTrack, type CodingTrack } from '../shared/coding-catalog';
import { PUZZLE_MAX_LINES } from '../shared/coding-puzzle';

const SECRET = process.env.SESSION_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
if (IS_PROD && (!SECRET || SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}

const TOKEN_TTL_MS = 60 * 60 * 1000;
/** A daily result's time runs from the learner's first sight of the day's
 * questions, which can be longer ago than one session lasts. The database
 * accepts up to a day. */
const DAILY_MAX_DURATION_MS = 24 * 60 * 60 * 1000;
/** A Learn level or part test. It lives as long as the attempt the answer
 * routine opens for it (two hours in record_roadmap_answer_v2 and the TS
 * fallback), so a level with coding tasks that runs past an hour can still be
 * completed; its coding sessions last three. */
const ROADMAP_TTL_MS = 2 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 3 * 60 * 60 * 1000;
const TOKEN_AAD = Buffer.from('shark-quiz-token:v2');
const TOKEN_KEY = createHash('sha256').update(SECRET || 'dev-only-not-for-production', 'utf8').digest();

const b64url = (buffer: Buffer): string => buffer.toString('base64url');
const fromB64url = (value: string): Buffer => Buffer.from(value, 'base64url');

interface SessionPayload {
  kind: 'quiz-session';
  questions: { questionId: string; correctAnswer: number }[];
  scope?: 'challenge' | 'daily' | 'roadmap' | 'assessment' | 'qotd';
  runId?: string;
  gradingVersion?: 2;
  subject?: ScopeSubjectId;
  date?: string;
  topic?: string;
  roadmapKind?: 'level' | 'checkpoint';
  ref?: number;
  attemptId?: string;
  /** Daily challenge: when this learner was first handed today's questions. */
  startedAt?: number;
  requiredLevelStart?: number;
  requiredLevelEnd?: number;
  /** Learn levels with coding tasks: the ids the completion gate checks. */
  codingTaskIds?: string[];
  /** The account a Learn, daily or Challenge session was issued to, or
   * null for a guest. */
  userId?: string | null;
  iat: number;
  exp: number;
}

interface ChallengeRunPayload {
  kind: 'challenge-run';
  runId: string;
  ranked: boolean;
  subject: ScopeSubjectId;
  topics?: string[];
  allTopics?: boolean;
  userId?: string | null;
  gradingVersion?: 2;
  iat: number;
  exp: number;
}

interface ScoreProofPayload {
  kind: 'score-proof';
  runId: string;
  questionId: string;
  subject: ScopeSubjectId;
  isCorrect: boolean;
  gradingVersion?: 2;
  iat: number;
  exp: number;
}

interface QuizResultReceiptPayload {
  kind: 'quiz-result';
  attemptId: string;
  userId: string;
  correct: number;
  total: number;
  breakdown: Record<string, { correct: number; total: number }>;
  outcomes: QuizResultOutcome[];
  subject: ScopeSubjectId;
  questXp: number;
  daily?: { date: string; durationMs: number };
  purpose: 'quiz' | 'challenge' | 'daily' | 'assessment';
  iat: number;
  exp: number;
}

/** One graded question on a result receipt. `xp` is what the question earned
 * (0 when wrong); receipts minted before migration 052 carry none, and the
 * stats routine then pays the fresh share of the quiz's XP instead. */
interface QuizResultOutcome {
  questionId: string;
  category: string;
  isCorrect: boolean;
  xp?: number;
}

// A single adaptive-placement round in flight. `history` carries the
// server-graded outcomes of every prior round and `items` the (hidden) answer
// key of the round currently being answered. The whole payload is sealed, so
// the browser can neither read the keys nor forge the running score; the server
// re-derives the score from `history` alone when it finalizes the placement.
interface PlacementOutcome {
  questionId: string;
  category: string;
  isCorrect: boolean;
}
interface PlacementItem {
  questionId: string;
  correctAnswer: number;
  category: string;
}
interface PlacementRunPayload {
  kind: 'placement-run';
  subject: ScopeSubjectId;
  attemptId: string;
  round: number;
  difficulty: number;
  history: PlacementOutcome[];
  items: PlacementItem[];
  iat: number;
  exp: number;
}

// One coding task in play. The attempt id is minted here so the verdict RPC
// can make a replayed submit a no-op; for system-design tasks the sealed key
// carries the shuffled answer positions the server grades against.
export interface CodingDesignKey {
  /** Code-ordering puzzle: the authored line id behind each presentation id,
   * `puzzle[i]` for `b{i+1}`. The browser never sees authored ids. */
  puzzle?: string[];
  /** Guided walkthrough: the correct option index per step, after shuffling. */
  steps?: number[];
  /** Drill: the correct option index (tradeoff/bottleneck) after shuffling. */
  correct?: number;
  /** Drill: the accepted estimate band. */
  band?: { min: number; max: number; answer: number };
  /** Drill: the correct order as indices into the shuffled step list. */
  order?: number[];
}
interface CodingSessionPayload {
  version?: string;
  kind: 'coding-session';
  taskId: string;
  track: CodingTrack;
  attemptId: string;
  userId: string | null;
  roadmapAttemptId?: string;
  key?: CodingDesignKey;
  iat: number;
  exp: number;
}

// One learning-path activity in flight. Everything the submit handler must not
// take from the request lives here instead: the owner, the enrollment, the
// activity, the curriculum and rubric versions, and the purpose the manifest
// assigned. For an objective check the sealed key carries the correct option
// index per question after shuffling, so the browser holds the questions
// without holding the answers.
interface LearningPathSessionPayload {
  version?: string;
  kind: 'learning-path-session';
  attemptId: string;
  enrollmentId: string;
  userId: string;
  pathId: LearningPathId;
  activityId: string;
  activityKind: 'lesson' | 'check' | 'code' | 'artifact';
  purpose: 'diagnostic' | 'exercise' | 'project';
  curriculumVersion: number;
  rubricVersion: number;
  answerKey?: number[];
  iat: number;
  exp: number;
}

// The GitHub App installation round trip. Bound to the user id so a callback
// cannot attach an installation to another account.
interface GithubConnectStatePayload {
  kind: 'github-connect';
  userId: string;
  iat: number;
  exp: number;
}

type TokenPayload =
  | SessionPayload
  | ChallengeRunPayload
  | ScoreProofPayload
  | QuizResultReceiptPayload
  | PlacementRunPayload
  | CodingSessionPayload
  | LearningPathSessionPayload
  | GithubConnectStatePayload;

function sealToken(payload: TokenPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return `v2.${b64url(iv)}.${b64url(ciphertext)}.${b64url(cipher.getAuthTag())}`;
}

function openToken(token: string): unknown | null {
  if (typeof token !== 'string' || token.length > 16_384) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v2') return null;
  try {
    const iv = fromB64url(parts[1]);
    const ciphertext = fromB64url(parts[2]);
    const tag = fromB64url(parts[3]);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;
    const decipher = createDecipheriv('aes-256-gcm', TOKEN_KEY, iv);
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function validLifetime(payload: { iat?: unknown; exp?: unknown }, maxTtl: number): boolean {
  const now = Date.now();
  return typeof payload.iat === 'number' && typeof payload.exp === 'number' &&
    payload.iat <= now + 60_000 && payload.exp >= now && payload.exp > payload.iat &&
    payload.exp - payload.iat <= maxTtl;
}

type SessionContext =
  | { subject: ScopeSubjectId }
  | { scope: 'challenge'; runId: string; subject: ScopeSubjectId; attemptId?: string; userId?: string | null; gradingVersion?: 2 }
  // A daily fetched signed in names its account (`userId`), and only that
  // account may submit it (api/quiz/submit.ts).
  | { scope: 'daily'; date: string; subject: ScopeSubjectId; attemptId?: string; startedAt?: number; userId?: string | null }
  // The public question of the day (#239): practice only, graded as if
  // signed out, whoever sends it.
  | { scope: 'qotd'; date: string; subject: ScopeSubjectId }
  | { scope: 'assessment'; subject: ScopeSubjectId }
  | {
      scope: 'roadmap';
      subject: ScopeSubjectId;
      topic: string;
      roadmapKind: 'level' | 'checkpoint';
      ref: number;
      attemptId?: string;
      requiredLevelStart?: number;
      requiredLevelEnd?: number;
      codingTaskIds?: string[];
      userId: string | null;
    };

export interface DecodedQuizSession {
  questions: { questionId: string; correctAnswer: number }[];
  scope?: 'challenge' | 'daily' | 'roadmap' | 'assessment' | 'qotd';
  runId?: string;
  /** Version 2 records strikes before returning a score proof. */
  gradingVersion?: 2;
  subject?: ScopeSubjectId;
  date?: string;
  topic?: string;
  roadmapKind?: 'level' | 'checkpoint';
  ref?: number;
  attemptId?: string;
  /** Daily challenge: when this learner was first handed the day's questions. */
  startedAt?: number;
  requiredLevelStart?: number;
  requiredLevelEnd?: number;
  codingTaskIds?: string[];
  /** Who the session was issued to. Challenge batches use null for a guest
   * and omit the field on batches sealed before the owner was recorded. */
  userId?: string | null;
  issuedAt: number;
}

export function encodeSession(data: SessionPayload['questions'], context?: SessionContext): string {
  const now = Date.now();
  const providedAttemptId = context && 'attemptId' in context ? context.attemptId : undefined;
  return sealToken({
    kind: 'quiz-session',
    questions: data,
    ...(context ?? {}),
    attemptId: providedAttemptId ?? b64url(randomBytes(18)),
    iat: now,
    exp: now + (context && 'scope' in context && context.scope === 'roadmap' ? ROADMAP_TTL_MS : TOKEN_TTL_MS),
  });
}

export function decodeSessionEnvelope(token: string): DecodedQuizSession | null {
  const payload = openToken(token) as Partial<SessionPayload> | null;
  if (!payload || payload.kind !== 'quiz-session' || !validLifetime(payload, payload.scope === 'roadmap' ? ROADMAP_TTL_MS : TOKEN_TTL_MS) || typeof payload.iat !== 'number') return null;
  if (!Array.isArray(payload.questions) || payload.questions.length === 0 || payload.questions.length > 50) return null;
  if (!payload.questions.every((question) => question && typeof question.questionId === 'string' && question.questionId.length > 0 && question.questionId.length <= 64 && Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer <= 25)) return null;
  if (payload.subject !== undefined && !isScopeSubject(payload.subject)) return null;
  if (typeof payload.attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId)) return null;
  const base: DecodedQuizSession = { questions: payload.questions, subject: payload.subject, attemptId: payload.attemptId, issuedAt: payload.iat };
  if (payload.scope === 'challenge') {
    if (typeof payload.runId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.runId) || !payload.subject) return null;
    const owner = payload.userId;
    if (owner !== undefined && owner !== null && (typeof owner !== 'string' || owner.length === 0 || owner.length > 128)) return null;
    const gradingVersion = payload.gradingVersion;
    if (gradingVersion !== undefined && (gradingVersion !== 2 || owner === undefined || payload.attemptId !== payload.runId)) return null;
    return { ...base, scope: 'challenge', runId: payload.runId, ...(owner !== undefined ? { userId: owner } : {}),
      ...(gradingVersion !== undefined ? { gradingVersion } : {}) };
  }
  if (payload.scope === 'daily') {
    if (!payload.subject || typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return null;
    const startedAt = payload.startedAt;
    if (startedAt !== undefined && (!Number.isInteger(startedAt) || startedAt > payload.iat || payload.iat - startedAt > DAILY_MAX_DURATION_MS)) return null;
    const dailyOwner = payload.userId;
    if (dailyOwner !== undefined && dailyOwner !== null && (typeof dailyOwner !== 'string' || dailyOwner.length === 0 || dailyOwner.length > 128)) return null;
    return { ...base, scope: 'daily', date: payload.date, ...(startedAt !== undefined ? { startedAt } : {}), userId: dailyOwner ?? null };
  }
  if (payload.scope === 'qotd') {
    if (!payload.subject || typeof payload.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) || payload.questions.length !== 1) return null;
    return { ...base, scope: 'qotd', date: payload.date };
  }
  if (payload.scope === 'assessment') {
    if (!payload.subject) return null;
    return { ...base, scope: 'assessment' };
  }
  if (payload.scope === 'roadmap') {
    const requiredStart = payload.requiredLevelStart;
    const requiredEnd = payload.requiredLevelEnd;
    const hasRequiredRange = requiredStart !== undefined || requiredEnd !== undefined;
    if (!payload.subject || typeof payload.topic !== 'string' || (payload.roadmapKind !== 'level' && payload.roadmapKind !== 'checkpoint') || !Number.isInteger(payload.ref) || (payload.ref ?? 0) < 1 || (payload.attemptId !== undefined && !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId)) || (hasRequiredRange && (!Number.isInteger(requiredStart) || !Number.isInteger(requiredEnd) || requiredStart! < 1 || requiredEnd! < requiredStart! || requiredEnd! > 100))) return null;
    const codingIds = payload.codingTaskIds;
    if (codingIds !== undefined && (!Array.isArray(codingIds) || codingIds.length > 5 || !codingIds.every((id) => typeof id === 'string' && /^[a-z0-9-]{3,64}$/.test(id)))) return null;
    const owner = payload.userId;
    if (owner !== undefined && owner !== null && (typeof owner !== 'string' || owner.length === 0 || owner.length > 128)) return null;
    return {
      ...base,
      scope: 'roadmap',
      topic: payload.topic,
      roadmapKind: payload.roadmapKind,
      ref: payload.ref,
      attemptId: payload.attemptId,
      ...(hasRequiredRange ? { requiredLevelStart: requiredStart, requiredLevelEnd: requiredEnd } : {}),
      ...(codingIds && codingIds.length > 0 ? { codingTaskIds: codingIds } : {}),
      userId: owner ?? null,
    };
  }
  return base;
}

export const decodeSession = (token: string) => decodeSessionEnvelope(token)?.questions ?? null;

/** When a quiz session issued at `issuedAt` stops being gradable. Handlers
 * send it with the questions so the client can drop a saved quiz that has
 * run out instead of letting the learner answer it for nothing. */
export const quizSessionExpiresAt = (issuedAt: number): number => issuedAt + TOKEN_TTL_MS;

/** The time a daily result records: from the first time the learner was
 * handed the day's questions when that is known, else from this session. */
export function dailyDurationMs(session: Pick<DecodedQuizSession, 'startedAt' | 'issuedAt'>, now = Date.now()): number {
  return Math.min(DAILY_MAX_DURATION_MS, Math.max(0, now - (session.startedAt ?? session.issuedAt)));
}

/** Stable opaque claim id for one server-defined attempt; never exposes the source identifiers. */
export function stableAttemptId(...parts: string[]): string {
  return createHmac('sha256', TOKEN_KEY).update(parts.join('\u001f'), 'utf8').digest('base64url').slice(0, 32);
}

export function createChallengeRun(ranked = true, subject: ScopeSubjectId = 'webdev', evidence?: { topics: string[]; allTopics: boolean; userId: string | null; gradingVersion?: 2 }) {
  const now = Date.now();
  const runId = b64url(randomBytes(18));
  return { runId, ranked, subject, ...evidence, runToken: sealToken({ kind: 'challenge-run', runId, ranked, subject, ...evidence, iat: now, exp: now + CHALLENGE_TTL_MS }) };
}

export function decodeChallengeRun(token: string): { runId: string; ranked: boolean; subject: ScopeSubjectId; topics: string[] | null; allTopics: boolean | null; userId?: string | null; gradingVersion?: 2 } | null {
  const payload = openToken(token) as Partial<ChallengeRunPayload> | null;
  if (!payload || payload.kind !== 'challenge-run' || !validLifetime(payload, CHALLENGE_TTL_MS) || typeof payload.runId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.runId) || typeof payload.ranked !== 'boolean' || !isScopeSubject(payload.subject)) return null;
  const topics = Array.isArray(payload.topics) && payload.topics.length > 0 && payload.topics.every(topic => typeof topic === 'string') ? payload.topics : null;
  if ((topics !== null) !== (typeof payload.allTopics === 'boolean')) return null;
  if (payload.userId !== undefined && payload.userId !== null && typeof payload.userId !== 'string') return null;
  if (payload.gradingVersion !== undefined && (payload.gradingVersion !== 2 || payload.userId === undefined)) return null;
  return { runId: payload.runId, ranked: payload.ranked, subject: payload.subject, topics, allTopics: topics ? payload.allTopics! : null,
    ...(payload.userId !== undefined ? { userId: payload.userId } : {}),
    ...(payload.gradingVersion !== undefined ? { gradingVersion: payload.gradingVersion } : {}) };
}

export function encodeScoreProof(runId: string, questionId: string, subject: ScopeSubjectId, isCorrect: boolean, gradingVersion?: 2): string {
  const now = Date.now();
  return sealToken({ kind: 'score-proof', runId, questionId, subject, isCorrect, gradingVersion, iat: now, exp: now + CHALLENGE_TTL_MS });
}

export function decodeScoreProof(token: string): { runId: string; questionId: string; subject: ScopeSubjectId; isCorrect: boolean; gradingVersion?: 2 } | null {
  const payload = openToken(token) as Partial<ScoreProofPayload> | null;
  if (!payload || payload.kind !== 'score-proof' || !validLifetime(payload, CHALLENGE_TTL_MS) || typeof payload.runId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.runId) || typeof payload.questionId !== 'string' || payload.questionId.length === 0 || payload.questionId.length > 64 || !isScopeSubject(payload.subject) || typeof payload.isCorrect !== 'boolean') return null;
  if (payload.gradingVersion !== undefined && payload.gradingVersion !== 2) return null;
  return { runId: payload.runId, questionId: payload.questionId, subject: payload.subject, isCorrect: payload.isCorrect,
    ...(payload.gradingVersion !== undefined ? { gradingVersion: payload.gradingVersion } : {}) };
}

export interface QuizResultReceipt {
  attemptId: string;
  userId: string;
  correct: number;
  total: number;
  breakdown: Record<string, { correct: number; total: number }>;
  outcomes: QuizResultOutcome[];
  subject: ScopeSubjectId;
  questXp: number;
  daily?: { date: string; durationMs: number };
  purpose: 'quiz' | 'challenge' | 'daily' | 'assessment';
}

export function encodeQuizResultReceipt(input: Omit<QuizResultReceipt, 'attemptId'> & { attemptId?: string }): string {
  const now = Date.now();
  const attemptId = input.attemptId ?? b64url(randomBytes(18));
  return sealToken({ kind: 'quiz-result', ...input, attemptId, iat: now, exp: now + TOKEN_TTL_MS });
}

export function decodeQuizResultReceipt(token: string): QuizResultReceipt | null {
  const payload = openToken(token) as Partial<QuizResultReceiptPayload> | null;
  if (!payload || payload.kind !== 'quiz-result' || !validLifetime(payload, TOKEN_TTL_MS)) return null;
  if (typeof payload.attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId) || typeof payload.userId !== 'string' || payload.userId.length === 0 || payload.userId.length > 128) return null;
  if (!Number.isInteger(payload.correct) || !Number.isInteger(payload.total) || payload.total! <= 0 || payload.total! > 50 || payload.correct! < 0 || payload.correct! > payload.total!) return null;
  if (!payload.breakdown || typeof payload.breakdown !== 'object' || Array.isArray(payload.breakdown) || !Array.isArray(payload.outcomes) || payload.outcomes.length === 0 || payload.outcomes.length > 50 || !isScopeSubject(payload.subject) || !Number.isInteger(payload.questXp) || payload.questXp! < 0 || payload.questXp! > 10_000 || !['quiz', 'challenge', 'daily', 'assessment'].includes(payload.purpose ?? '')) return null;
  if (payload.daily !== undefined && (!payload.daily || typeof payload.daily.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.daily.date) || !Number.isInteger(payload.daily.durationMs) || payload.daily.durationMs < 0 || payload.daily.durationMs > DAILY_MAX_DURATION_MS)) return null;
  const breakdown: QuizResultReceipt['breakdown'] = {};
  for (const [category, value] of Object.entries(payload.breakdown)) {
    const item = value as { correct?: unknown; total?: unknown };
    if (!/^[a-z0-9-]{1,50}$/.test(category) || !item || !Number.isInteger(item.correct) || !Number.isInteger(item.total) || (item.total as number) <= 0 || (item.total as number) > 50 || (item.correct as number) < 0 || (item.correct as number) > (item.total as number)) return null;
    breakdown[category] = { correct: item.correct as number, total: item.total as number };
  }
  const outcomes: QuizResultReceipt['outcomes'] = [];
  for (const value of payload.outcomes) {
    if (!value || typeof value.questionId !== 'string' || value.questionId.length === 0 || value.questionId.length > 64 || typeof value.category !== 'string' || !/^[a-z0-9-]{1,50}$/.test(value.category) || typeof value.isCorrect !== 'boolean') return null;
    if (value.xp !== undefined && (!Number.isInteger(value.xp) || value.xp < 0 || value.xp > 100)) return null;
    outcomes.push({
      questionId: value.questionId,
      category: value.category,
      isCorrect: value.isCorrect,
      ...(value.xp !== undefined ? { xp: value.xp } : {}),
    });
  }
  return { attemptId: payload.attemptId, userId: payload.userId, correct: payload.correct!, total: payload.total!, breakdown, outcomes, subject: payload.subject, questXp: payload.questXp!, purpose: payload.purpose!, ...(payload.daily ? { daily: payload.daily } : {}) };
}

export interface PlacementRunState {
  subject: ScopeSubjectId;
  attemptId: string;
  round: number;
  difficulty: number;
  history: PlacementOutcome[];
  items: PlacementItem[];
}

function sanitizePlacementOutcomes(input: unknown, limit: number): PlacementOutcome[] | null {
  if (!Array.isArray(input) || input.length > limit) return null;
  const out: PlacementOutcome[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.questionId !== 'string' || o.questionId.length === 0 || o.questionId.length > 64) return null;
    if (typeof o.category !== 'string' || !/^[a-z0-9-]{1,50}$/.test(o.category)) return null;
    if (typeof o.isCorrect !== 'boolean') return null;
    out.push({ questionId: o.questionId, category: o.category, isCorrect: o.isCorrect });
  }
  return out;
}

function sanitizePlacementItems(input: unknown, limit: number): PlacementItem[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > limit) return null;
  const out: PlacementItem[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (typeof o.questionId !== 'string' || o.questionId.length === 0 || o.questionId.length > 64) return null;
    if (!Number.isInteger(o.correctAnswer) || (o.correctAnswer as number) < 0 || (o.correctAnswer as number) > 25) return null;
    if (typeof o.category !== 'string' || !/^[a-z0-9-]{1,50}$/.test(o.category)) return null;
    out.push({ questionId: o.questionId, correctAnswer: o.correctAnswer as number, category: o.category });
  }
  return out;
}

export function encodePlacementRun(state: PlacementRunState): string {
  const now = Date.now();
  return sealToken({ kind: 'placement-run', ...state, iat: now, exp: now + TOKEN_TTL_MS });
}

export function decodePlacementRun(token: string): PlacementRunState | null {
  const payload = openToken(token) as Partial<PlacementRunPayload> | null;
  if (!payload || payload.kind !== 'placement-run' || !validLifetime(payload, TOKEN_TTL_MS)) return null;
  if (!isScopeSubject(payload.subject)) return null;
  if (typeof payload.attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId)) return null;
  if (!Number.isInteger(payload.round) || payload.round! < 1 || payload.round! > 12) return null;
  if (!Number.isInteger(payload.difficulty) || payload.difficulty! < 1 || payload.difficulty! > 5) return null;
  const history = sanitizePlacementOutcomes(payload.history, 50);
  if (history === null) return null;
  const items = sanitizePlacementItems(payload.items, 20);
  if (items === null) return null;
  return {
    subject: payload.subject,
    attemptId: payload.attemptId,
    round: payload.round!,
    difficulty: payload.difficulty!,
    history,
    items,
  };
}

/* ── coding sessions ───────────────────────────────────────────────────── */

const CODING_TTL_MS = 3 * 60 * 60 * 1000;
const GITHUB_CONNECT_TTL_MS = 10 * 60 * 1000;

export interface CodingSession {
  /** Missing only on legacy tokens; submit refuses these before grading. */
  version?: string;
  taskId: string;
  track: CodingSessionPayload['track'];
  attemptId: string;
  userId: string | null;
  roadmapAttemptId?: string;
  key?: CodingDesignKey;
  issuedAt: number;
}

export function encodeCodingSession(input: Omit<CodingSession, 'attemptId' | 'issuedAt'> & { attemptId?: string }): string {
  const now = Date.now();
  return sealToken({
    kind: 'coding-session',
    ...(input.version ? { version: input.version } : {}),
    taskId: input.taskId,
    track: input.track,
    attemptId: input.attemptId ?? b64url(randomBytes(18)),
    userId: input.userId,
    ...(input.roadmapAttemptId ? { roadmapAttemptId: input.roadmapAttemptId } : {}),
    ...(input.key ? { key: input.key } : {}),
    iat: now,
    exp: now + CODING_TTL_MS,
  });
}

const isAttemptVersion = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const isIndexList = (value: unknown, max: number): value is number[] =>
  Array.isArray(value) && value.length <= max && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 25);

export function decodeCodingSession(token: string): CodingSession | null {
  const payload = openToken(token) as Partial<CodingSessionPayload> | null;
  if (!payload || payload.kind !== 'coding-session' || !validLifetime(payload, CODING_TTL_MS) || typeof payload.iat !== 'number') return null;
  if (typeof payload.taskId !== 'string' || !/^[a-z0-9-]{3,64}$/.test(payload.taskId)) return null;
  // The track vocabulary lives in one place. A list written out here drifts
  // the moment a track is added: the Algorithms track shipped with this line
  // still naming four, so every Algorithms session sealed correctly and then
  // failed to open, and every submit came back as an expired session.
  if (!isCodingTrack(payload.track)) return null;
  if (payload.version !== undefined && !isAttemptVersion(payload.version)) return null;
  if (typeof payload.attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId)) return null;
  if (payload.userId !== null && (typeof payload.userId !== 'string' || payload.userId.length === 0 || payload.userId.length > 128)) return null;
  if (payload.roadmapAttemptId !== undefined && (typeof payload.roadmapAttemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.roadmapAttemptId))) return null;
  let key: CodingDesignKey | undefined;
  if (payload.key !== undefined) {
    const k = payload.key as Record<string, unknown>;
    if (!k || typeof k !== 'object') return null;
    key = {};
    if (k.puzzle !== undefined) {
      // The authored line ids behind the presentation ids, one per line.
      if (!Array.isArray(k.puzzle) || k.puzzle.length === 0 || k.puzzle.length > PUZZLE_MAX_LINES ||
          !k.puzzle.every((id) => typeof id === 'string' && /^[a-z]{1,2}$/.test(id))) return null;
      key.puzzle = k.puzzle as string[];
    }
    if (k.steps !== undefined) { if (!isIndexList(k.steps, 10)) return null; key.steps = k.steps; }
    if (k.correct !== undefined) { if (!Number.isInteger(k.correct) || (k.correct as number) < 0 || (k.correct as number) > 25) return null; key.correct = k.correct as number; }
    if (k.order !== undefined) { if (!isIndexList(k.order, 12)) return null; key.order = k.order; }
    if (k.band !== undefined) {
      const b = k.band as Record<string, unknown>;
      if (!b || typeof b.min !== 'number' || typeof b.max !== 'number' || typeof b.answer !== 'number' || !Number.isFinite(b.min) || !Number.isFinite(b.max) || !Number.isFinite(b.answer)) return null;
      key.band = { min: b.min, max: b.max, answer: b.answer };
    }
  }
  return {
    ...(payload.version ? { version: payload.version } : {}),
    taskId: payload.taskId,
    track: payload.track!,
    attemptId: payload.attemptId,
    userId: payload.userId ?? null,
    ...(payload.roadmapAttemptId ? { roadmapAttemptId: payload.roadmapAttemptId } : {}),
    ...(key ? { key } : {}),
    issuedAt: payload.iat,
  };
}

export function encodeGithubConnectState(userId: string): string {
  const now = Date.now();
  return sealToken({ kind: 'github-connect', userId, iat: now, exp: now + GITHUB_CONNECT_TTL_MS });
}

export function decodeGithubConnectState(token: string): { userId: string } | null {
  const payload = openToken(token) as Partial<GithubConnectStatePayload> | null;
  if (!payload || payload.kind !== 'github-connect' || !validLifetime(payload, GITHUB_CONNECT_TTL_MS)) return null;
  if (typeof payload.userId !== 'string' || payload.userId.length === 0 || payload.userId.length > 128) return null;
  return { userId: payload.userId };
}

/* ── learning-path attempt sessions ────────────────────────────────────── */

const LEARNING_PATH_TTL_MS = 3 * 60 * 60 * 1000;

export interface LearningPathSession {
  version?: string;
  attemptId: string;
  enrollmentId: string;
  userId: string;
  pathId: LearningPathId;
  activityId: string;
  activityKind: LearningPathSessionPayload['activityKind'];
  purpose: LearningPathSessionPayload['purpose'];
  curriculumVersion: number;
  rubricVersion: number;
  answerKey?: number[];
  issuedAt: number;
  expiresAt: number;
}

export function encodeLearningPathSession(
  input: Omit<LearningPathSession, 'issuedAt' | 'expiresAt'> & { ttlMs?: number },
): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + Math.min(input.ttlMs ?? LEARNING_PATH_TTL_MS, LEARNING_PATH_TTL_MS);
  return {
    token: sealToken({
      kind: 'learning-path-session',
      ...(input.version ? { version: input.version } : {}),
      attemptId: input.attemptId,
      enrollmentId: input.enrollmentId,
      userId: input.userId,
      pathId: input.pathId,
      activityId: input.activityId,
      activityKind: input.activityKind,
      purpose: input.purpose,
      curriculumVersion: input.curriculumVersion,
      rubricVersion: input.rubricVersion,
      ...(input.answerKey ? { answerKey: input.answerKey } : {}),
      iat: now,
      exp: expiresAt,
    }),
    expiresAt,
  };
}

/** Decodes without trusting anything: a tampered or expired token, a foreign
 * kind, or an out-of-range field all return null rather than a partial
 * session the caller might use. */
export function decodeLearningPathSession(token: string): LearningPathSession | null {
  const payload = openToken(token) as Partial<LearningPathSessionPayload> | null;
  if (!payload || payload.kind !== 'learning-path-session' || !validLifetime(payload, LEARNING_PATH_TTL_MS)) return null;
  if (typeof payload.attemptId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.attemptId)) return null;
  if (typeof payload.enrollmentId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.enrollmentId)) return null;
  if (typeof payload.userId !== 'string' || payload.userId.length < 8 || payload.userId.length > 128) return null;
  if (!isLearningPathId(payload.pathId)) return null;
  if (payload.version !== undefined && !isAttemptVersion(payload.version)) return null;
  if (typeof payload.activityId !== 'string' || !/^[a-z0-9-]{3,96}$/.test(payload.activityId)) return null;
  if (!['lesson', 'check', 'code', 'artifact'].includes(payload.activityKind ?? '')) return null;
  if (!['diagnostic', 'exercise', 'project'].includes(payload.purpose ?? '')) return null;
  if (!Number.isInteger(payload.curriculumVersion) || payload.curriculumVersion! < 1 || payload.curriculumVersion! > 999) return null;
  if (!Number.isInteger(payload.rubricVersion) || payload.rubricVersion! < 1 || payload.rubricVersion! > 999) return null;
  let answerKey: number[] | undefined;
  if (payload.answerKey !== undefined) {
    if (!Array.isArray(payload.answerKey) || payload.answerKey.length > 60 ||
        !payload.answerKey.every((index) => Number.isInteger(index) && index >= 0 && index <= 25)) return null;
    answerKey = payload.answerKey;
  }
  return {
    attemptId: payload.attemptId,
    ...(payload.version ? { version: payload.version } : {}),
    enrollmentId: payload.enrollmentId,
    userId: payload.userId,
    pathId: payload.pathId,
    activityId: payload.activityId,
    activityKind: payload.activityKind!,
    purpose: payload.purpose!,
    curriculumVersion: payload.curriculumVersion!,
    rubricVersion: payload.rubricVersion!,
    ...(answerKey ? { answerKey } : {}),
    issuedAt: payload.iat!,
    expiresAt: payload.exp!,
  };
}
