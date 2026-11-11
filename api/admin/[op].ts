import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';
import { isRetiredTopic } from '../../shared/retired-content';
import { createServiceClient, jsonError, createLogger, ServiceUnavailableError, withTimeout, withRequestContext } from '../../lib/http';
import { adminSubject, requireAdmin } from '../../lib/admin-auth';
import { requireFreshAuth } from '../../lib/auth';
import { enforceRateLimit, RATE_LIMITS } from '../../lib/rate-limit';
import {
  listAdminQuestions,
  saveQuestion,
  setQuestionDeleted,
  resetQuestion,
  bulkHideByImportance,
  KNOWN_CATEGORIES,
} from '../../lib/questions-store';
import { loadSubjectQuestionBank } from '../../lib/question-bank-loader';
import { deploymentSubjectIds } from '../../lib/product-scope';
import type { Question } from '../../lib/quiz-data';
import { listReports, dismissReport, reportCounts } from '../../lib/reports-store';
import { listAuthEvents } from '../../lib/auth-events-store';
import { getGameSettings, saveGameSettings } from '../../lib/settings-store';
import { inspectQuestionQuality } from '../../lib/question-quality';
import { allReadiness, pathEnabledInEnv } from '../../lib/learning-paths/catalog';
import { handleAdminEntitlements } from '../../lib/entitlements';
import { handleAdminVouchers } from '../../lib/vouchers';
import { handleAdminUsers, handleAdminEmails } from '../../lib/admin-directory';

const log = createLogger('admin');
const supabase = createServiceClient();

const MAX_TEXT = 4000;
const MAX_OPTION = 2000;
const MAX_TAG = 60;
const MAX_TAGS = 20;
const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

/** Who made a change, for the audit trail every console write leaves in the
 * logs: the verified admin account, or the legacy password, which names
 * nobody. */
const actor = (req: VercelRequest): string => adminSubject(req) ?? 'legacy-password';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const boundedString = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

/** At most `max` characters, cut by code point: a cut by UTF-16 unit could
 * split an emoji and store half of it. */
const cutText = (text: string, max: number): string =>
  text.length <= max ? text : Array.from(text).slice(0, max).join('');

/** Postgres text and JSONB refuse U+0000 (22P05), so a question, a setting, a
 * voucher note or an id holding it failed the write and answered 500. The
 * values are walked, not the JSON text, so a question about escapes that
 * spells `\u0000` out still saves. */
function holdsNul(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((one) => holdsNul(one, depth + 1));
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  // An admin is checked against Supabase Auth on every request, never against
  // a token this instance accepted earlier (lib/auth.ts, "Accepted tokens"):
  // a role taken away or a session ended elsewhere is refused at once.
  requireFreshAuth(req);
  // Anti-brute-force: at most ~1 auth attempt per second per IP, small burst.
  // Runs before password check so wrong guesses count toward the budget.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.admin))) return;
  // Prefer a verified Supabase admin/allowlist identity. The old shared
  // password is available in production only when explicitly enabled.
  if (!(await requireAdmin(req, res))) return;

  const op = String(req.query.op || '').toLowerCase();
  if (holdsNul(req.body)) {
    return jsonError(res, 400, 'bad_request', 'Text cannot contain a NUL (U+0000) character');
  }
  try {
    switch (op) {
      case 'users':
        return await handleAdminUsers(req, res, supabase);
      case 'emails':
        return await handleAdminEmails(req, res);
      case 'questions':
        return await listQuestions(req, res);
      case 'save':
        return await saveQuestionOp(req, res);
      case 'delete':
        return await deleteQuestionOp(req, res);
      case 'bulkhide':
        return await bulkHideOp(req, res);
      case 'reset':
        return await resetQuestionOp(req, res);
      case 'reports':
        return await reportsOp(req, res);
      case 'logs':
        return await logsOp(req, res);
      case 'settings':
        return await settingsOp(req, res);
      case 'quality':
        return await qualityOp(req, res);
      case 'learning-paths':
        return await learningPathsOp(req, res);
      case 'entitlements':
        return await handleAdminEntitlements(req, res, supabase);
      case 'vouchers':
        return await handleAdminVouchers(req, res, supabase);
      default:
        return jsonError(res, 404, 'unknown_op', `Unknown admin op: ${op}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    // A Supabase call that timed out (lib/http.ts `UpstreamTimeoutError`) is
    // the database busy for a moment, which the console may retry: 503 with
    // its code, as every handler answers it, never 500.
    if (err instanceof ServiceUnavailableError) {
      log({ op, status: 503, error: message });
      return jsonError(res, 503, err.code, err.message);
    }
    if (message === 'not_configured') {
      log({ op, status: 503, error: message });
      return jsonError(res, 503, 'not_configured', 'Admin backend (Supabase) is not configured');
    }
    log({ op, level: 'error', status: 500, error: message });
    return jsonError(res, 500, 'internal_error', 'Internal error');
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}

/**
 * Learning-path content readiness.
 *
 * Read-only, and deliberately so: publishing authority stays with code review.
 * This reports what the validator found, the real inventory derived from the
 * manifest, and whether the deployment switch is on — three separate facts, so
 * an operator can tell "content incomplete" apart from "switched off". No
 * request can mark an invalid curriculum ready.
 */
async function learningPathsOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const paths = allReadiness().map((readiness) => ({
    pathId: readiness.pathId,
    version: readiness.version,
    contentReady: readiness.contentReady,
    enabledInEnv: pathEnabledInEnv(readiness.pathId),
    inventory: readiness.inventory,
    issues: readiness.issues,
  }));
  log({ op: 'learning-paths', status: 200, paths: paths.length });
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ paths });
}

async function qualityOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // `?categories=a&categories=b` arrives as an array, which was read as no
  // filter at all and scanned (or, on POST, stored) the whole bank.
  if (req.query.categories !== undefined && typeof req.query.categories !== 'string') {
    return jsonError(res, 400, 'bad_request', 'categories must be one comma-separated list');
  }
  const rawCategories = typeof req.query.categories === 'string'
    ? req.query.categories.split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  const categorySet = new Set(rawCategories.filter((value) => (KNOWN_CATEGORIES as string[]).includes(value)));
  const questions = (await listAdminQuestions()).filter((question) => categorySet.size === 0 || categorySet.has(question.category));
  const issues = inspectQuestionQuality(questions);
  const enabled = process.env.QUESTION_QUALITY_ASSISTANT_ENABLED === 'true';

  if (req.method === 'POST') {
    if (!enabled) {
      return jsonError(res, 409, 'feature_disabled', 'Enable QUESTION_QUALITY_ASSISTANT_ENABLED to store suggestions');
    }
    if (!supabase) return jsonError(res, 503, 'not_configured', 'Suggestion storage is not configured');
    let stored = 0;
    for (let offset = 0; offset < issues.length; offset += 250) {
      const batch = issues.slice(offset, offset + 250).map((issue) => ({
        question_id: issue.questionId,
        question_hash: issue.questionHash,
        source: 'deterministic',
        kind: issue.kind,
        content: { severity: issue.severity, message: issue.message, suggestion: issue.suggestion },
        status: 'pending',
      }));
      const result = await withTimeout(
        supabase.from('question_quality_suggestions').upsert(batch, {
          onConflict: 'question_id,question_hash,source,kind',
          ignoreDuplicates: true,
        }),
        5000,
      );
      if (result.error) return jsonError(res, 500, 'db_error', 'Could not store quality suggestions');
      stored += batch.length;
    }
    log({ op: 'quality', status: 200, by: actor(req), scanned: questions.length, issues: issues.length, stored });
    return res.json({ enabled, scanned: questions.length, issues, stored });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({ enabled, scanned: questions.length, issues });
}

async function listQuestions(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const [questions, counts] = await Promise.all([listAdminQuestions(), reportCounts()]);
  res.setHeader('Cache-Control', 'no-store');
  // A retired section is not offered as somewhere to publish. Existing
  // questions in one still load and still save — the category stays valid,
  // it is simply no longer a choice.
  return res.json({
    questions,
    categories: KNOWN_CATEGORIES.filter((category) => !isRetiredTopic(category)),
    reportCounts: counts,
  });
}

const bankIds = new WeakMap<readonly Question[], ReadonlySet<string>>();

/** Whether a save or delete may name this id: a custom question's own
 * (`dev-…`) or one of the bank's. Any other id wrote an override row for a
 * question that does not exist, which no listing shows and nothing removes. */
async function knownQuestionId(id: string): Promise<boolean> {
  if (id.startsWith('dev-')) return true;
  // Keyed by each subject's bank, the array the loader keeps for the life of
  // the process (the deployment bank is a new flat() copy on every call).
  const banks = await Promise.all(deploymentSubjectIds().map((subject) => loadSubjectQuestionBank(subject)));
  return banks.some((bank) => {
    let ids = bankIds.get(bank);
    if (!ids) {
      ids = new Set(bank.map((question) => question.id));
      bankIds.set(bank, ids);
    }
    return ids.has(id);
  });
}

function unknownQuestion(res: VercelResponse) {
  return jsonError(res, 404, 'unknown_question', 'No question in the bank has this id');
}

async function saveQuestionOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const b = (req.body || {}) as Record<string, unknown>;

  const question = boundedString(b.question, MAX_TEXT);
  if (!question) return jsonError(res, 400, 'bad_request', 'question is required');

  // Every option is checked, none dropped: `correctIndex` points into the list
  // as sent, so leaving out one invalid option before the correct one would
  // store a different option as the answer.
  const options = Array.isArray(b.options) ? b.options : [];
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return jsonError(res, 400, 'bad_request', `Provide ${MIN_OPTIONS}–${MAX_OPTIONS} non-empty options`);
  }
  if (!options.every((o): o is string => typeof o === 'string' && o.length > 0 && o.length <= MAX_OPTION)) {
    return jsonError(res, 400, 'bad_request', `Every option must be text of 1–${MAX_OPTION} characters`);
  }

  const correctIndex =
    typeof b.correctIndex === 'number' && Number.isInteger(b.correctIndex) ? b.correctIndex : -1;
  if (correctIndex < 0 || correctIndex >= options.length) {
    return jsonError(res, 400, 'bad_request', 'correctIndex is out of range');
  }

  const category = typeof b.category === 'string' && (KNOWN_CATEGORIES as string[]).includes(b.category)
    ? b.category
    : null;
  if (!category) return jsonError(res, 400, 'bad_request', 'invalid category');

  const difficulty = typeof b.difficulty === 'number' ? b.difficulty : 1;

  // Optional per-question importance override (1–10); omit to keep the score.
  const importance =
    typeof b.importance === 'number' && Number.isInteger(b.importance) && b.importance >= 1 && b.importance <= 10
      ? b.importance
      : undefined;

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= MAX_TAG).slice(0, MAX_TAGS)
    : [];

  const explanation = typeof b.explanation === 'string' ? cutText(b.explanation, MAX_TEXT) : '';
  const introduction = typeof b.introduction === 'string' ? cutText(b.introduction, MAX_TEXT) : '';
  const id = boundedString(b.id, 64) ?? undefined;
  if (id !== undefined && !(await knownQuestionId(id))) return unknownQuestion(res);

  const saved = await saveQuestion({
    id,
    question,
    options,
    correctIndex,
    explanation,
    introduction,
    category,
    tags,
    difficulty,
    importance,
  });
  log({ op: 'save', status: 200, by: actor(req), id: saved.id, created: !id });
  return res.json({ ok: true, id: saved.id });
}

async function deleteQuestionOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const b = (req.body || {}) as { id?: unknown; deleted?: unknown };
  const id = boundedString(b.id, 64);
  if (!id) return jsonError(res, 400, 'bad_request', 'id is required');
  if (!(await knownQuestionId(id))) return unknownQuestion(res);
  // `deleted: false` restores a soft-deleted base question; default is delete.
  const deleted = b.deleted === false ? false : true;
  await setQuestionDeleted(id, deleted);
  log({ op: 'delete', status: 200, by: actor(req), id, deleted });
  return res.json({ ok: true });
}

async function bulkHideOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const b = (req.body || {}) as { maxImportance?: unknown };
  const max =
    typeof b.maxImportance === 'number' && Number.isInteger(b.maxImportance) && b.maxImportance >= 1 && b.maxImportance <= 10
      ? b.maxImportance
      : null;
  if (max === null) return jsonError(res, 400, 'bad_request', 'maxImportance must be an integer 1–10');
  const hidden = await bulkHideByImportance(max);
  log({ op: 'bulkhide', status: 200, by: actor(req), max, hidden });
  return res.json({ ok: true, hidden });
}

async function resetQuestionOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const b = (req.body || {}) as { id?: unknown };
  const id = boundedString(b.id, 64);
  if (!id) return jsonError(res, 400, 'bad_request', 'id is required');
  await resetQuestion(id);
  log({ op: 'reset', status: 200, by: actor(req), id });
  return res.json({ ok: true });
}

async function reportsOp(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const reports = await listReports();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ reports });
  }
  if (req.method === 'POST') {
    const b = (req.body || {}) as { id?: unknown };
    // A report's id is a UUID column: anything else failed the cast (22P02)
    // and answered 500.
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null;
    if (!id) return jsonError(res, 400, 'bad_request', 'id must be a report id');
    await dismissReport(id);
    log({ op: 'reports', status: 200, by: actor(req), dismissed: id });
    return res.json({ ok: true });
  }
  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}

// Auth events log (registrations + logins) for the Logs tab.
async function logsOp(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  const events = await listAuthEvents(200);
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ events });
}

async function settingsOp(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    const settings = await getGameSettings();
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ settings });
  }
  if (req.method === 'POST') {
    const b = (req.body || {}) as { settings?: unknown };
    const settings = await saveGameSettings(b.settings ?? b);
    log({ op: 'settings', status: 200, by: actor(req) });
    return res.json({ settings });
  }
  res.setHeader('Allow', 'GET, POST');
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
}
