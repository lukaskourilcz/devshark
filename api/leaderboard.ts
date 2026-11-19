import type { VercelRequest, VercelResponse } from '../lib/vercel-types.js';
import {
  createServiceClient,
  jsonError,
  createLogger,
  withTimeout,
  isRpcMissing,
  STATS_CATEGORIES,
  withRequestContext,
  ServiceUnavailableError,
} from '../lib/http';
import {
  defaultDeploymentCategories,
  isDeploymentCategory,
  validateCategoryScope,
} from '../lib/product-scope';
import { AuthError, tryAuth } from '../lib/auth';
import { enforceRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { sendPublicJson } from '../lib/public-json';

// Public responses are served by this scoped API, but leaderboard RPCs are
// service-only so callers cannot bypass deployment/category validation through
// the Supabase Data API. Every routine names a learner through
// board_display_name() (migration 064): their sharkname, or the account name
// they chose for boards (user_handles.leaderboard_name_mode). Only the picture
// still follows user_stats.show_on_leaderboards (049); a learner with no
// sharkname row is null and the client shows "Learner".
const supabase = createServiceClient();

const logEvent = createLogger('leaderboard');

// The windowed boards (migration 040). 30 days is the default board; 7 days
// costs nothing extra to serve as well. (Weekly leagues were dropped, #208.)
const WINDOW_DAYS: Readonly<Record<string, number>> = { '30d': 30, '7d': 7 };
const WINDOW_MIN_ANSWERS = 5;

// The row counts a board is served at. Any other `limit` is rounded up to the
// next of these (200 at most), so a query string varied to get past the CDN
// meets the same few boards, and the read limit in the handler bounds how
// often that can happen.
const LIMIT_STEPS = [10, 25, 50, 100, 200] as const;
function boardLimit(raw: unknown): number {
  const asked = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(asked)) return 100;
  return LIMIT_STEPS.find((step) => step >= asked) ?? 200;
}

/** A real UTC calendar day in YYYY-MM-DD. The shape alone let 2026-02-30
 * through to the routine, whose date cast then failed with a 500. Postgres
 * has no year 0, which JavaScript's calendar does. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  if (!supabase) {
    return jsonError(res, 503, 'not_configured', 'Leaderboard backend is not configured');
  }
  // What reaches the function is a read the CDN did not answer: a signed-in
  // board, or a URL nobody asked for in the last minute. A script varying the
  // query string would make every read one of those.
  if (!(await enforceRateLimit(req, res, RATE_LIMITS.readAddress))) return;

  // A parameter repeated in the query string arrives as an array, which names
  // no period and no date.
  const period = req.query.period === undefined ? 'global' : typeof req.query.period === 'string' ? req.query.period || 'global' : '';
  const dateParam = req.query.date === undefined ? new Date().toISOString().slice(0, 10) : typeof req.query.date === 'string' ? req.query.date || new Date().toISOString().slice(0, 10) : '';
  const limit = boardLimit(req.query.limit);

  try {
    if (Object.prototype.hasOwnProperty.call(WINDOW_DAYS, period)) {
      return await windowBoard(req, res, period, limit);
    }

    if (period === 'month') {
      return await monthBoard(req, res, limit);
    }

    if (period === 'global') {
      // Per-subject (platform) scoping: ?categories=a,b,c sums each user's
      // dated activity (user_activity_days, no window, migration 049) over
      // exactly those categories, so it counts what the 30-day board counts.
      // The client sends the active subject's category set; subjects are
      // disjoint, so the result is that platform's own all-time board.
      const catRaw = typeof req.query.categories === 'string' ? req.query.categories : '';
      const requested = catRaw
        ? catRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : defaultDeploymentCategories();
      const scope = validateCategoryScope(requested.slice(0, 64));
      if (!scope.ok) {
        return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
      }
      const cats = scope.categories.filter((category) => STATS_CATEGORIES.has(category));
      if (cats.length === 0) return jsonError(res, 400, 'bad_request', 'Invalid categories');
      const { data, error } = await withTimeout(
        supabase.rpc('subject_leaderboard', { p_categories: cats, p_limit: limit }),
      );
      if (error) {
        if (isRpcMissing(error)) {
          return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-020.sql to enable per-subject leaderboards');
        }
        logEvent({ status: 500, error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not load leaderboard');
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return sendPublicJson(req, res, { period: 'global', categories: cats, entries: data });
    }

    if (period === 'category') {
      const category = (req.query.category as string) || '';
      if (!STATS_CATEGORIES.has(category) || !isDeploymentCategory(category)) {
        return jsonError(res, 400, 'bad_request', 'Invalid category');
      }
      const minParam = parseInt(req.query.min_attempts as string, 10);
      const minAttempts = Number.isFinite(minParam)
        ? Math.min(Math.max(minParam, 1), 100)
        : 5;
      const { data, error } = await withTimeout(
        supabase.rpc('category_leaderboard', {
          p_category: category,
          p_limit: limit,
          p_min_attempts: minAttempts,
        }),
      );
      if (error) {
        if (isRpcMissing(error)) {
          return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-005.sql');
        }
        logEvent({ status: 500, error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not load category leaderboard');
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return sendPublicJson(req, res, { period: 'category', category, min_attempts: minAttempts, entries: data });
    }

    if (period === 'daily') {
      if (!isCalendarDate(dateParam)) {
        return jsonError(res, 400, 'bad_request', 'date must be YYYY-MM-DD');
      }
      const catRaw = typeof req.query.categories === 'string' ? req.query.categories : '';
      const requested = catRaw
        ? catRaw.split(',').map((value) => value.trim()).filter(Boolean)
        : defaultDeploymentCategories();
      const scope = validateCategoryScope(requested.slice(0, 64));
      if (!scope.ok) {
        return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
      }
      const { data, error } = await withTimeout(
        supabase.rpc('daily_leaderboard_v2', {
          p_date: dateParam,
          p_subject: scope.subject,
          p_limit: limit,
        }),
      );
      if (error) {
        if (isRpcMissing(error)) {
          return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-022.sql to enable subject-scoped daily leaderboards');
        }
        logEvent({ status: 500, error: error.message });
        return jsonError(res, 500, 'db_error', 'Could not load daily leaderboard');
      }
      res.setHeader('Cache-Control', 'public, s-maxage=60');
      return sendPublicJson(req, res, { period: 'daily', date: dateParam, subject: scope.subject, entries: data });
    }

    return jsonError(res, 400, 'bad_request', 'period must be "30d", "7d", "month", "global", "daily", or "category"');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    // A board routine that timed out is the database busy for a moment,
    // which the client may retry: 503, as every other handler answers it.
    if (err instanceof ServiceUnavailableError) {
      logEvent({ status: 503, error: message });
      return jsonError(res, 503, err.code, err.message);
    }
    logEvent({ status: 500, error: message });
    return jsonError(res, 500, 'internal_error', 'Internal error');
  }
}

/**
 * A rolling window over user_activity_days: correct answers, then fewer
 * answers, the same rule as the all-time board. `category` narrows it to one
 * topic; without it every category this deployment writes is counted.
 *
 * Anonymous requests get the shared board and stay cacheable. A request that
 * presents a Bearer token, or asks with `me=1`, is personal: it adds the
 * caller's own line and is never stored by a shared cache. `me=1` gives the
 * personal variant its own URL, so a CDN copy of the anonymous board cannot be
 * served in its place. An expired or unverifiable token still gets the board;
 * it just gets no `me`, because a public read is no place to fail a session.
 */
async function windowBoard(req: VercelRequest, res: VercelResponse, period: string, limit: number) {
  const days = WINDOW_DAYS[period];
  const categoryRaw = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  const category = categoryRaw || null;
  if (category && (!STATS_CATEGORIES.has(category) || !isDeploymentCategory(category))) {
    return jsonError(res, 400, 'bad_request', 'Invalid category');
  }

  const personal = hasBearer(req) || req.query.me === '1';
  res.setHeader('Vary', 'Authorization');
  if (personal && !(await enforceRateLimit(req, res, RATE_LIMITS.leaderboardPersonal))) return;

  const userId = await verifiedViewer(req);

  const [board, mine] = await Promise.all([
    withTimeout(
      supabase!.rpc('window_leaderboard', {
        p_days: days,
        p_limit: limit,
        p_category: category,
        p_min_answers: WINDOW_MIN_ANSWERS,
        p_viewer: userId,
      }),
    ),
    userId
      ? withTimeout(
          supabase!.rpc('window_leaderboard_rank', {
            p_user: userId,
            p_days: days,
            p_category: category,
            p_min_answers: WINDOW_MIN_ANSWERS,
          }),
        )
      : Promise.resolve(null),
  ]);

  const failure = board.error ?? mine?.error ?? null;
  if (failure) {
    if (isRpcMissing(failure)) {
      return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-040.sql to enable the 30-day leaderboard');
    }
    logEvent({ status: 500, error: failure.message });
    return jsonError(res, 500, 'db_error', 'Could not load leaderboard');
  }

  const body: Record<string, unknown> = {
    period,
    days,
    category,
    min_answers: WINDOW_MIN_ANSWERS,
    entries: board.data ?? [],
  };
  if (personal) {
    const row = (Array.isArray(mine?.data) ? mine!.data[0] : null) as
      | { rank?: unknown; correct?: unknown; answered?: unknown; accuracy_pct?: unknown }
      | null;
    body.me = userId
      ? {
          rank: typeof row?.rank === 'number' ? row.rank : null,
          correct: Number(row?.correct ?? 0),
          answered: Number(row?.answered ?? 0),
          accuracy_pct: Number(row?.accuracy_pct ?? 0),
        }
      : null;
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    // Every shared board is cached for a minute and never served stale past
    // it, so a learner who switches their name off leaves every board within
    // about a minute (049).
    res.setHeader('Cache-Control', 'public, s-maxage=60');
  }
  return personal ? res.json(body) : sendPublicJson(req, res, body);
}

/**
 * This month's XP (migration 056): the learners with the most verified XP in
 * the current calendar month (UTC) for the active subject, ranked the way the
 * month's top three are paid. Equal XP shares a place, and the rows arrive
 * with their ranks. `categories` names the subject, as on the daily board.
 * Personal and cacheable exactly like the windowed boards: a Bearer token or
 * `me=1` adds the learner's own line and is never stored by a shared cache.
 */
async function monthBoard(req: VercelRequest, res: VercelResponse, limit: number) {
  const catRaw = typeof req.query.categories === 'string' ? req.query.categories : '';
  const requested = catRaw
    ? catRaw.split(',').map((value) => value.trim()).filter(Boolean)
    : defaultDeploymentCategories();
  const scope = validateCategoryScope(requested.slice(0, 64));
  if (!scope.ok) {
    return jsonError(res, 400, 'invalid_subject_scope', 'Categories must belong to this deployment and one subject');
  }

  const personal = hasBearer(req) || req.query.me === '1';
  res.setHeader('Vary', 'Authorization');
  if (personal && !(await enforceRateLimit(req, res, RATE_LIMITS.leaderboardPersonal))) return;

  const userId = await verifiedViewer(req);
  // The server names the month, so the board and its label always agree.
  const month = new Date().toISOString().slice(0, 7);

  const [board, mine] = await Promise.all([
    withTimeout(
      supabase!.rpc('month_xp_leaderboard', {
        p_subject: scope.subject,
        p_limit: limit,
        p_viewer: userId,
        p_month: month,
      }),
    ),
    userId
      ? withTimeout(supabase!.rpc('month_xp_leaderboard_rank', { p_user: userId, p_subject: scope.subject, p_month: month }))
      : Promise.resolve(null),
  ]);

  const failure = board.error ?? mine?.error ?? null;
  if (failure) {
    if (isRpcMissing(failure)) {
      return jsonError(res, 503, 'rpc_missing', 'Run supabase/supabase-schema-056.sql to enable the monthly board');
    }
    logEvent({ status: 500, error: failure.message });
    return jsonError(res, 500, 'db_error', 'Could not load leaderboard');
  }

  const body: Record<string, unknown> = { period: 'month', month, subject: scope.subject, entries: board.data ?? [] };
  if (personal) {
    const row = (Array.isArray(mine?.data) ? mine!.data[0] : null) as { rank?: unknown; xp?: unknown } | null;
    body.me = userId ? { rank: typeof row?.rank === 'number' ? row.rank : null, xp: Number(row?.xp ?? 0) } : null;
    res.setHeader('Cache-Control', 'private, no-store');
  } else {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
  }
  return personal ? res.json(body) : sendPublicJson(req, res, body);
}

/** The account a Bearer token verifies, or null: a public read is no place to
 * fail a session, so an expired or unverifiable token still gets the board. */
async function verifiedViewer(req: VercelRequest): Promise<string | null> {
  if (!hasBearer(req)) return null;
  try {
    return (await tryAuth(req))?.sub ?? null;
  } catch (error) {
    if (!(error instanceof AuthError)) throw error;
    return null;
  }
}

function hasBearer(req: VercelRequest): boolean {
  const raw = req.headers.authorization;
  return typeof raw === 'string' && /^Bearer\s+\S/i.test(raw);
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
