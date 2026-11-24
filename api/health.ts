import type { VercelRequest, VercelResponse } from '../lib/vercel-types.js';
import { jsonError, logEvent, serviceClientOrNull, withRequestContext } from '../lib/http';
import { createGradingReadiness } from '../lib/grading-readiness';
import { rateLimiterMode } from '../lib/rate-limit';

// Null without Supabase, or in production without a usable service-role key:
// the probe then answers 503 instead of failing to load as the handlers do.
const service = serviceClientOrNull();

type DependencyStatus = 'ok' | 'down' | 'unconfigured';

const gradingReadiness = createGradingReadiness(async (deadline) => {
  const [{ runInQuickJS }, { healthVariant }, { newQuickJSWASMModuleFromVariant }] = await Promise.all([
    import('../lib/coding/sandbox'),
    import('../lib/coding/quickjs-variant'),
    import('quickjs-emscripten'),
  ]);
  if (performance.now() >= deadline) return false;
  const engine = await newQuickJSWASMModuleFromVariant(healthVariant());
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) return false;
  let disposed = true;
  const result = await runInQuickJS(
    { code: '', calls: ['1 + 1'], expectations: [2], deadlineMs: remainingMs },
    () => { disposed = false; },
    engine,
  );
  return disposed && !result.timedOut && result.codeError === null && result.results[0]?.pass === true;
});

/** Read one row of `table` on the service connection within 1.5 s. A check
 * that fails is logged with its reason, whether the read threw or answered an
 * error, so the 503 a monitor sees has a line in the logs saying why. */
async function dependencyStatus(dependency: string, table: string, column: string): Promise<DependencyStatus> {
  if (!service) return 'unconfigured';
  const deadline = AbortSignal.timeout(1_500);
  let reason: string;
  try {
    // Closing the probe must release its HTTP connection as well as its
    // waiting callers. A later probe can then try without piling up reads.
    const { error } = await service.from(table).select(column).limit(1).abortSignal(deadline);
    if (!error) return 'ok';
    reason = error.code || 'query_error';
  } catch (error) {
    reason = error instanceof Error ? error.message : 'unknown';
  }
  logEvent('health', { level: 'error', category: 'dependency_check', dependency, reason: deadline.aborted ? 'upstream_timeout' : reason });
  return 'down';
}

// The probe is public, uncached and not rate limited, so a flood of it was a
// flood of database reads: two per request. Requests that arrive while a check
// is running share its answer instead of starting their own. Nothing is kept
// after it settles, so every answer is still a fresh check.
let running: Promise<[DependencyStatus, DependencyStatus]> | null = null;

/** The database and service-role checks, run together (a monitor waits for
 * the slower one only, not their sum: up to 1.5 s while the database hangs). */
function checkDependencies(): Promise<[DependencyStatus, DependencyStatus]> {
  running ??= Promise.all([
    dependencyStatus('database', 'user_stats', 'id'),
    dependencyStatus('service_role', 'quiz_submissions', 'grade_key'),
  ]).finally(() => {
    running = null;
  });
  return running;
}

/**
 * GET /api/health
 *
 * Liveness + readiness probe. Returns:
 *   { ok, status, dependencies: { database, serviceRole, rateLimiter, grading }, ts: ISO }
 *
 * `rateLimiter` is the limiter's live mode (lib/rate-limit.ts
 * `rateLimiterMode`): `configured` when Upstash answers a PING,
 * `memory-fallback` when it is configured and does not, and
 * `in-memory-fallback` without Upstash. It does not change the status code,
 * which stays the database checks'.
 *
 * Grading checks a fixed expression in this function's QuickJS runtime and,
 * in production, the presence of the React runner snapshot configuration.
 * The separate live grading monitor exercises actual submissions.
 *
 * Status code reflects readiness so a plain uptime monitor (UptimeRobot,
 * Better Stack) alerts without body parsing:
 *   • 200 — healthy: Supabase reachable, or intentionally unconfigured
 *           (e.g. a preview deploy without DB env). `ok: true`.
 *   • 503 — degraded: Supabase is configured but unreachable. `ok: false`,
 *           `Retry-After: 30`. This is the case a monitor must catch.
 *
 * Previously this always returned 200, so downtime looked healthy — the whole
 * point of pointing a monitor here was defeated.
 */
async function routeHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return jsonError(res, 405, 'method_not_allowed', 'Method not allowed');
  }
  // Private learning tables intentionally grant nothing to anonymous callers.
  // Readiness checks run on the server's authorized connection too; requiring
  // an anonymous SELECT would report a healthy, private database as down.
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
  const [[supabaseStatus, privilegedStatus], rateLimiter, grading] = await Promise.all([
    checkDependencies(),
    rateLimiterMode(),
    gradingReadiness(!isProduction || Boolean(process.env.REACT_RUNNER_SNAPSHOT_ID)),
  ]);
  const degraded = supabaseStatus === 'down' || privilegedStatus === 'down' ||
    (isProduction && (supabaseStatus === 'unconfigured' || privilegedStatus === 'unconfigured'));
  res.setHeader('Cache-Control', 'no-store');
  if (degraded) res.setHeader('Retry-After', '30');
  res.status(degraded ? 503 : 200).json({
    ok: !degraded,
    status: degraded ? 'degraded' : 'healthy',
    dependencies: {
      database: supabaseStatus === 'ok' ? 'ok' : 'unavailable',
      serviceRole: privilegedStatus === 'ok' ? 'ok' : 'unavailable',
      rateLimiter,
      grading,
    },
    ts: new Date().toISOString(),
  });
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  return withRequestContext(req, res, () => routeHandler(req, res));
}
