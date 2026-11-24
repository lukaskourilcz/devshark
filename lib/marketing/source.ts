/** Server-only producer for OwnDashboard's marketing-source/1 contract. */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Question } from '../quiz-data';
import { getEffectiveQuestions, getFreshMarketingQuestions } from '../questions-store';
import { questionEligibility, registryEntryFor } from '../curation';
import { PRIVATE_CATEGORIES } from '../quiz-runtime';
import { isRetiredTopic } from '../../shared/retired-content';
import { subjectForCategory } from '../../shared/subject-catalog';
import { ACTIVE_CODING_TASKS, CODING_SOURCE_VERSIONS } from '../coding/active';
import { CODING_TASKS, summarize } from '../coding/catalog';
import { difficultyOf, type CodingTask } from '../../shared/coding-catalog';
import { pickQuestionOfTheDay } from '../daily-question';
import { isIsoDate, qotdAvailability, utcToday, qotdPath } from '../../shared/daily-question';
import { jsonError } from '../http';
import type { VercelRequest, VercelResponse } from '../vercel-types';
import { enforceRateLimit, RATE_LIMITS } from '../rate-limit';

type SourceContent = {
  title: string; body: string; category: string; difficulty: string | null;
  code: string | null; options: string[]; answer: string | null; explanation: string | null;
  evidence: { url: string; title: string; excerpt: string; checkedAt: string }[];
  image: null;
};
export type SourcePacket = {
  schemaVersion: 'marketing-source/1'; brand: 'devshark'; kind: 'question' | 'coding-task';
  sourceId: string; sourceRevision: string; contentHash: string; canonicalUrl: string;
  locale: 'en'; observedAt: string; expiresAt: string | null; eligible: boolean;
  eligibilityReason: string; content: SourceContent;
};
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
};
export const hashContent = (content: unknown): string => createHash('sha256').update(canonicalJson(content)).digest('hex');
const ORIGIN = 'https://devshark.app';

function packet(kind: SourcePacket['kind'], id: string, content: SourceContent, eligible: boolean, reason: string, version: unknown, now: string, path: string): SourcePacket {
  // Hold an oversized or malformed authored item; truncating an answer changes its meaning.
  if (!id || `${kind}:${id}`.length > 200 ||
      (content.answer !== null && typeof content.answer !== 'string') ||
      (content.explanation !== null && typeof content.explanation !== 'string') ||
      !content.title || content.title.length > 300 || !content.body || content.body.length > 30000 ||
      content.category.length > 100 || (content.code?.length ?? 0) > 12000 ||
      content.options.length > 10 || content.options.some((o) => typeof o !== 'string' || o.length > 2000) ||
      (content.answer?.length ?? 0) > 6000 || (content.explanation?.length ?? 0) > 12000 ||
      (kind === 'question' && (content.options.length < 2 || !content.answer || !content.explanation))) {
    throw new Error('marketing_source_unavailable');
  }
  const contentHash = hashContent(content);
  return { schemaVersion: 'marketing-source/1', brand: 'devshark', kind, sourceId: `${kind}:${id}`,
    sourceRevision: hashContent({ contentHash, eligible, reason, version }), contentHash,
    canonicalUrl: `${ORIGIN}${path}`, locale: 'en', observedAt: now, expiresAt: null,
    eligible, eligibilityReason: reason, content };
}

export function questionPacket(input: { question: Question; deleted: boolean; updatedAt: string | null }, now: string): SourcePacket | null {
  const q = input.question;
  if (subjectForCategory(q.category) !== 'webdev' || (PRIVATE_CATEGORIES as string[]).includes(q.category)) return null;
  const eligibility = questionEligibility(q);
  const reason = input.deleted ? 'deleted' : isRetiredTopic(q.category) ? 'retired-topic' : eligibility.reason;
  const eligible = !input.deleted && !isRetiredTopic(q.category) && eligibility.active;
  const code = /```[^\n]*\n([\s\S]*?)```/.exec(`${q.introduction}\n${q.question}`)?.[1] ?? null;
  const content: SourceContent = { title: q.question.split('\n')[0].slice(0, 300), body: [q.introduction, q.question].filter(Boolean).join('\n\n'),
    category: q.category, difficulty: String(q.difficulty), code, options: [...q.options],
    answer: q.options[q.correctAnswer] ?? null, explanation: q.explanation || null, evidence: [], image: null };
  return packet('question', q.id, content, eligible, reason, { editedAt: input.updatedAt, review: registryEntryFor(q.id), importance: q.importance ?? null }, now, `/quiz?categories=${encodeURIComponent(q.category)}`);
}

export function codingPacket(task: CodingTask, active: boolean, now: string): SourcePacket {
  // Explicit allowlist. Tests, drills, hints, approaches and solutions are absent.
  // No coding answer/explanation is approved for marketing in v1.
  const content: SourceContent = { title: task.title, body: [task.prompt, ...(task.previousRequirements ?? [])].join('\n\n'),
    category: task.track, difficulty: difficultyOf(task), code: task.starter, options: [], answer: null,
    explanation: null, evidence: [], image: null };
  const reason = active ? (summarize(task).free ? 'active-free' : 'active-premium') : 'not-issued';
  return packet('coding-task', task.id, content, active, reason, { authoredVersion: CODING_SOURCE_VERSIONS.get(task.id) ?? null, review: registryEntryFor(task.id), tier: task.tier, level: task.level, focus: task.focus }, now,
    `/coding/${task.track}/${encodeURIComponent(task.id)}`);
}

export type ExportQuery = { limit: number; cursor?: string; sourceId?: string; daily?: string };
export function datedDailyPacket(source: SourcePacket, date: string): SourcePacket {
  const canonicalUrl = `${ORIGIN}${qotdPath(date)}`;
  return { ...source, canonicalUrl, sourceRevision: hashContent({ sourceRevision: source.sourceRevision, date, canonicalUrl }) };
}
export function parseExportQuery(query: VercelRequest['query']): ExportQuery {
  const allowed = new Set(['resource', 'limit', 'cursor', 'sourceId', 'daily']);
  if (Object.keys(query).some((key) => !allowed.has(key)) || Object.values(query).some((v) => typeof v !== 'string')) throw new Error('bad_request');
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (['cursor', 'sourceId', 'daily'].some((key) => query[key] !== undefined && !query[key]) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50 || (query.sourceId && query.daily) ||
      ((query.sourceId || query.daily) && query.cursor) || (query.cursor?.length ?? 0) > 1000 ||
      (query.sourceId && !/^(question|coding-task):[^:]{1,180}$/.test(String(query.sourceId)))) throw new Error('bad_request');
  return { limit, cursor: query.cursor as string | undefined, sourceId: query.sourceId as string | undefined, daily: query.daily as string | undefined };
}

export function pagePackets(packets: SourcePacket[], query: ExportQuery) {
  const sorted = [...packets].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const snapshot = hashContent(sorted.map((p) => [p.sourceId, p.sourceRevision]));
  let offset = 0;
  if (query.cursor) {
    let cursor: { snapshot?: string; after?: string };
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { throw new Error('bad_request'); }
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).length !== 2 ||
        typeof cursor.snapshot !== 'string' || typeof cursor.after !== 'string') throw new Error('bad_request');
    if (cursor.snapshot !== snapshot) throw new Error('source_snapshot_changed');
    offset = sorted.findIndex((p) => p.sourceId === cursor.after) + 1;
    if (offset === 0) throw new Error('bad_request');
  }
  const page = sorted.slice(offset, offset + query.limit);
  return { packets: page, snapshot, nextCursor: offset + page.length < sorted.length
    ? Buffer.from(JSON.stringify({ snapshot, after: page.at(-1)!.sourceId })).toString('base64url') : null };
}

export function authorizedExport(headers: VercelRequest['headers'], secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || typeof headers.authorization !== 'string') return false;
  const supplied = headers.authorization.startsWith('Bearer ') ? headers.authorization.slice(7) : '';
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}

export async function handleMarketingSource(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Authorization');
  // Integration bearer is not a learner credential; do not forward it to Auth.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.quizSessionAddress))) return;
  if (!process.env.DEVSHARK_MARKETING_EXPORT_SECRET || process.env.DEVSHARK_MARKETING_EXPORT_SECRET.length < 32) return jsonError(res, 503, 'marketing_not_configured', 'Marketing source export is not configured');
  if (!authorizedExport(req.headers, process.env.DEVSHARK_MARKETING_EXPORT_SECRET)) return jsonError(res, 401, 'unauthorized', 'Invalid marketing integration');
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.marketingExport))) return;
  let query: ExportQuery;
  try { query = parseExportQuery(req.query); } catch { return jsonError(res, 400, 'bad_request', 'Invalid marketing source query'); }
  const now = new Date().toISOString();
  try {
    const questions = await getFreshMarketingQuestions();
    const questionPackets = questions.map((q) => questionPacket(q, now)).filter((p): p is SourcePacket => p !== null);
    const activeIds = new Set(ACTIVE_CODING_TASKS.map((task) => task.id));
    if (query.sourceId) {
      const found = questionPackets.find((p) => p.sourceId === query.sourceId) ??
        (() => { const task = CODING_TASKS.find((t) => `coding-task:${t.id}` === query.sourceId); return task ? codingPacket(task, activeIds.has(task.id), now) : undefined; })();
      if (!found) return jsonError(res, 410, 'source_removed', 'This source is no longer available; invalidate dependent drafts');
      return res.json({ packets: [found], nextCursor: null });
    }
    if (query.daily) {
      const date = query.daily === 'today' ? utcToday() : query.daily;
      if (!isIsoDate(date) || qotdAvailability(date) !== 'open') return jsonError(res, 400, 'bad_request', 'Daily date is not available');
      const active = new Set(questionPackets.filter((p) => p.eligible).map((p) => p.sourceId));
      const picked = pickQuestionOfTheDay(questions.map((q) => q.question).filter((q) => active.has(`question:${q.id}`)), date);
      // A serving instance may still hold its 15-second quiz cache. Hold a
      // mismatched daily rather than linking a different current question.
      const served = pickQuestionOfTheDay(await getEffectiveQuestions('webdev'), date);
      if (!picked || !served || picked.question.id !== served.question.id ||
          hashContent(picked.question) !== hashContent(served.question)) throw new Error('marketing_source_unavailable');
      const source = picked && questionPackets.find((p) => p.sourceId === `question:${picked.question.id}`);
      if (!source) throw new Error('marketing_source_unavailable');
      return res.json({ packets: [datedDailyPacket(source, date)], date, nextCursor: null });
    }
    return res.json(pagePackets([...questionPackets, ...ACTIVE_CODING_TASKS.map((task) => codingPacket(task, true, now))], query));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'source_snapshot_changed') return jsonError(res, 409, code, 'Source snapshot changed; restart pagination');
    if (code === 'bad_request') return jsonError(res, 400, code, 'Invalid source cursor');
    return jsonError(res, 503, 'marketing_source_unavailable', 'Current source eligibility could not be verified');
  }
}
