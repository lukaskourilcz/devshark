import { freshStoredAccessToken, getSupabaseSession, hasStoredSession, mayHaveSession } from './supabaseClient';
import { translateStatic } from '../i18n/LanguageContext';
import type { TranslationKey } from '../i18n/translations';
import { openUpgradeSheet } from './upgradeSheet';
import { PREMIUM_REQUIRED, type GatedKind } from '../../../shared/tiers';

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  status: number;
  code?: string;
  /** The rest of the server's `error` (a 409 draft_conflict's `updatedAt`). */
  detail?: Record<string, unknown>;
  constructor(message: string, status: number, code?: string, detail?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type Options = RequestInit & {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Refuse to send this request with any other account's session. */
  expectedUserId?: string;
};

// Attach the current user's Supabase access token to API requests so the
// server can verify identity. Read directly from the Supabase session, which
// is refreshed and persisted by the supabase-js client. A visitor without a
// session sends no token and never downloads that client
// (lib/supabaseClient.ts); for a returning visitor whose download is still
// running, the same four-second limit covers it.
//
// A session stored in this browser whose token cannot be read (a refresh
// slower than the limit, a refresh that failed offline, a download that
// failed) is still a signed-in learner, not a guest. Sent without the token,
// the request would be answered as a guest's: a quiz graded under nobody's
// name with its one-time claim spent, a Learn step refused as someone else's,
// Premium content locked. So nothing is sent, and the caller gets a retryable
// `auth_unavailable`. Only a browser with no stored session sends no token.
const TOKEN_READ_LIMIT_MS = 4_000;

async function getAccessToken(expectedUserId?: string): Promise<string | null> {
  if (!mayHaveSession()) return null;
  // A stored token supabase-js would hand out unchanged goes at once, without
  // the download (lib/supabaseClient.ts, freshStoredAccessToken).
  const stored = freshStoredAccessToken(undefined, expectedUserId);
  if (stored) return stored;
  let timer: number | undefined;
  let session: Awaited<ReturnType<typeof getSupabaseSession>> = null;
  try {
    session = await Promise.race([
      getSupabaseSession(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('auth_timeout')), TOKEN_READ_LIMIT_MS);
      }),
    ]);
  } catch {
    session = null;
  } finally {
    window.clearTimeout(timer);
  }
  if (session?.access_token) {
    return !expectedUserId || session.user?.id === expectedUserId ? session.access_token : null;
  }
  // supabase-js removes a session it can no longer refresh; one it keeps is
  // waiting for the network.
  if (hasStoredSession()) {
    throw new ApiError(translateStatic('error.authUnavailable'), 0, 'auth_unavailable');
  }
  return null;
}

/**
 * Reads whose handler never looks at the caller: the same answer for a guest
 * and for every account, verified by no token, and cached publicly by the CDN
 * (docs/product-architecture.md, "Caching"). They go out at once, without the
 * token, so a signed-in visit no longer holds them behind the supabase-js
 * download and the session read (perf baseline #587 C10), and the CDN sees the
 * same request a guest's is. Only GETs of exactly these addresses, as the
 * client writes them, qualify; a handler that starts reading the caller must
 * leave this list.
 *
 *   /api/settings                               game settings (api/settings.ts)
 *   /api/quiz/roadmap                           the Learn map (no topic, level, test or resource)
 *   /api/quiz/roadmap?resource=learning-path-catalog   the published path manifests
 *   /api/quiz/roadmap?resource=lesson&id=…      a Learn level's lesson
 *   /api/quiz/roadmap?resource=coding-brief&id=…  a coding task's brief (#587 C23)
 */
// Written short (plain groups, `\d`, the method matched without case): it
// ships in the first download, and the brief's address was added to it
// without making that download larger (check:bundle).
const PUBLIC_READ = /^\/api\/(settings|quiz\/roadmap(\?resource=(learning-path-catalog|(lesson|coding-brief)&id=[a-z\d-]+))?)$/;
export const isPublicRead = (url: string, method?: string): boolean =>
  (!method || /^get$/i.test(method)) && PUBLIC_READ.test(url);

/** The server refused locked content; the upgrade sheet is already open. */
export const isPremiumRequired = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 402 && err.code === PREMIUM_REQUIRED;

export async function apiFetch<T>(url: string, opts: Options = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, expectedUserId, ...rest } = opts;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }

  try {
    // Inside the try, so a token that cannot be read settles like any other
    // failure: the timer and the abort listener are released below.
    const token = isPublicRead(url, rest.method) ? null : await getAccessToken(expectedUserId);
    if (expectedUserId && !token) throw new ApiError(translateStatic('error.cancelled'), 0, 'cancelled');
    const res = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });

    if (!res.ok) {
      let body: { error?: { code?: string; message?: string; kind?: GatedKind; ref?: string } } = {};
      try {
        body = await res.json();
      } catch {
        // non-JSON body, keep default
      }
      // Locked content, in one place: whatever asked, the learner sees the
      // upgrade sheet rather than an error, even from a stale client.
      if (res.status === 402 && body?.error?.code === PREMIUM_REQUIRED) {
        openUpgradeSheet({ kind: body.error.kind, ref: body.error.ref, fromResponse: true });
      }
      // Without a server message (an HTML 404 page, a proxy error) the learner
      // gets the generic copy, never a bare status text such as "Not Found".
      throw new ApiError(
        body?.error?.message || translateStatic('error.generic'),
        res.status,
        body?.error?.code,
        body?.error,
      );
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const timedOut = reason instanceof Error && reason.message === 'timeout';
      throw new ApiError(
        timedOut ? 'Request timed out. Try again.' : 'Request was cancelled.',
        0,
        timedOut ? 'timeout' : 'cancelled',
      );
    }
    throw new ApiError(
      err instanceof Error ? err.message : 'Network error',
      0,
      'network',
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

// Error codes with dedicated user-facing copy in the i18n dictionaries.
// timeout/cancelled are minted client-side in apiFetch above; the play codes
// have a single, unambiguous meaning so the dictionary copy fits every caller.
const CODE_KEYS: Partial<Record<string, TranslationKey>> = {
  timeout: 'error.timeout',
  cancelled: 'error.cancelled',
  // Minted in getAccessToken above, and the server's answer when it cannot
  // reach the sign-in service: either way nothing was recorded.
  auth_unavailable: 'error.authUnavailable',
  too_few_questions: 'error.tooFewQuestions',
  finished: 'error.matchFinished',
  rate_limited: 'error.rateLimited',
  not_configured: 'error.serviceUnavailable',
  migration_required: 'error.serviceUnavailable',
  step_unavailable: 'error.stepUnavailable',
  task_retired: 'error.taskRetired',
  premium_required: 'error.premiumRequired',
  entitlement_unavailable: 'error.entitlementUnavailable',
  billing_unavailable: 'error.billingUnavailable',
  billing_disabled: 'error.billingDisabled',
  already_premium: 'error.alreadyPremium',
  no_billing_account: 'error.noBillingAccount',
  bad_email: 'error.badEmail',
  billing_conflict: 'error.billingConflict',
  // Learning paths. One attempt takes one result, and a sealed session
  // expires; either way a new attempt is the way on.
  idempotency_conflict: 'error.pathAttemptUsed',
  session_expired: 'error.pathAttemptExpired',
  attempt_expired: 'error.pathAttemptExpired',
  enrollment_paused: 'error.pathPaused',
  path_unavailable: 'error.pathUnavailable',
  // Learn refusals for a signed-in learner (403, and 409 at completion). Left
  // to the status fallback they read "You need to sign in to do that."
  not_in_plan: 'roadmap.notInPlanHint',
  topic_locked: 'error.topicLocked',
  prerequisite_not_met: 'error.prerequisiteNotMet',
  // An evolving challenge's later stage, sent before the earlier ones passed.
  stage_locked: 'error.stageLocked',
  // The grader's threads could not take a Submit (429 or 503): nothing was
  // graded or recorded, and another Submit is the way on.
  grader_busy: 'coding.verdict.graderUnavailable',
};

// friendlyError runs in the api layer (no React context), so it resolves the
// shared dictionaries via translateStatic. Server messages for unmapped error
// codes fall through as-is (English).
export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const codeKey = err.code ? CODE_KEYS[err.code] : undefined;
    if (codeKey) return translateStatic(codeKey);
    if (err.status === 0) return translateStatic('error.network');
    if (err.status >= 500) return translateStatic('error.server');
    if (err.status === 401 || err.status === 403) return translateStatic('error.signIn');
    return err.message;
  }
  return translateStatic('error.generic');
}
