import { createHash } from 'node:crypto';
import { timedSupabaseFetch } from './request-timing';
import type { VercelRequest } from './vercel-types.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const IS_PROD =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production';

// A keyless client used only to validate access tokens via auth.getUser(jwt).
// No session is persisted; each call verifies the token against Supabase Auth,
// which works regardless of the project's JWT signing algorithm.
const authClient: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        global: { fetch: timedSupabaseFetch },
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export interface AuthResult {
  sub: string;
  payload: Record<string, unknown>;
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getBearer(req: VercelRequest): string | null {
  const raw = req.headers.authorization || req.headers.Authorization;
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

async function withAuthDeadline<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AuthError(504, 'auth_timeout', 'Authentication service timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Supabase Auth did not decide on the token, as opposed to refusing it: no
 * answer at all (supabase-js reports a network failure as an
 * `AuthRetryableFetchError` with status 0), a 5xx, its own rate limit (429), or
 * an answer it could not read (`AuthUnknownError`). Each is a 503, because a
 * 401 tells a signed-in learner their session ended. The browser reads the
 * same signs (`serverUnreachable` in client/src/lib/auth.tsx). */
export function authUndecided(error: { name?: string; status?: number }): boolean {
  if (error.name === 'AuthRetryableFetchError' || error.name === 'AuthUnknownError') return true;
  const { status } = error;
  return typeof status === 'number' && (status === 0 || status === 429 || status >= 500);
}

/** Token checks already asked for one request, by token. A route whose rate
 * limit keys by account verifies the caller before its handler does, and a
 * handler that reads `tryAuth` directly (not lib/http's `tryAuthOnce`) would
 * otherwise ask Supabase Auth a second time for the same token. Keyed by the
 * request object, so nothing outlives the request. A decided answer (the
 * account, or a refusal) is kept; anything else is asked again. */
const tokenChecks = new WeakMap<VercelRequest, Map<string, Promise<AuthResult>>>();

/* ── Accepted tokens, across requests (#587, server item 1) ──────────────
 *
 * Every signed-in request used to wait for one Supabase Auth round trip
 * before any other work: a Learn map visit makes four to six such requests
 * and a level about eleven, each with the same access token. So a token Auth
 * accepted is trusted again on this instance, without asking, for at most
 * VERIFIED_TOKEN_TTL_MS, and never past the token's own `exp`.
 *
 * The bounds, for the owner (docs/product-architecture.md, "Token checks"):
 *  - Only an acceptance is kept. A refusal (401), an outage (503) or a
 *    timeout (504) is asked again on the next request, so a session never
 *    ends, or stays ended, because of a cached answer.
 *  - Revocation. A session ended elsewhere (sign out everywhere, a password
 *    change, a ban, an admin role taken away) keeps working on an instance
 *    that accepted its token less than a minute before, until the minute is
 *    up. Auth itself accepts a stolen access token until its `exp` (one
 *    hour), so this widens nothing beyond that, only past Auth's own session
 *    check. The account's data reads the same as in the request that asked.
 *  - Reads only. Only a GET or HEAD request trusts an earlier acceptance;
 *    every other method (an answer, a completion, a claim, a purchase, a
 *    draft, any write) asks Auth itself. A write's own acceptance still
 *    renews the one reads use.
 *  - Exceptions among reads: privileged requests and GETs that may write
 *    account data (such as the wallet and a Learn coding level) call
 *    `requireFreshAuth` before verification. A deleted account's token is
 *    forgotten on the instance that deleted it (`forgetVerifiedToken`).
 *  - Only a JWT whose `exp` and `sub` can be read is kept, keyed by the
 *    SHA-256 of the token, so the token itself is never held as a key; at
 *    most VERIFIED_TOKEN_LIMIT entries, the oldest dropped first.
 * Requests on one instance that present the same token at the same time
 * share one Auth call. */
export const VERIFIED_TOKEN_TTL_MS = 60_000;
const VERIFIED_TOKEN_LIMIT = 2_000;
const acceptedTokens = new Map<string, { result: AuthResult; until: number }>();
const sharedChecks = new Map<string, Promise<AuthResult>>();
const freshRequests = new WeakSet<VercelRequest>();
/** The methods whose requests may trust an earlier acceptance: reads. */
const TRUSTING_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** This request asks Supabase Auth itself, whatever this instance accepted
 * before: for the admin API and for reads that grant something (every write
 * asks anyway, see above). Call it before anything verifies the request. */
export function requireFreshAuth(req: VercelRequest): void {
  freshRequests.add(req);
}

const tokenKey = (token: string) => createHash('sha256').update(token).digest('base64url');

/** Forget an accepted token on this instance (its account was deleted). */
export function forgetVerifiedToken(token: string | null): void {
  if (token) acceptedTokens.delete(tokenKey(token));
}

/** The `exp` (in ms) and `sub` of a JWT, read without checking the signature:
 * only ever used for a token Auth has just accepted. */
function jwtClaims(token: string): { exp: number; sub: string } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown; sub?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) && typeof payload.sub === 'string'
      ? { exp: payload.exp * 1000, sub: payload.sub }
      : null;
  } catch {
    return null;
  }
}

function rememberAccepted(key: string, token: string, result: AuthResult): void {
  const claims = jwtClaims(token);
  const now = Date.now();
  if (!claims || claims.sub !== result.sub || claims.exp <= now) return;
  if (acceptedTokens.size >= VERIFIED_TOKEN_LIMIT) {
    for (const [one, entry] of acceptedTokens) if (entry.until <= now) acceptedTokens.delete(one);
    while (acceptedTokens.size >= VERIFIED_TOKEN_LIMIT) acceptedTokens.delete(acceptedTokens.keys().next().value!);
  }
  acceptedTokens.delete(key);
  acceptedTokens.set(key, { result, until: Math.min(now + VERIFIED_TOKEN_TTL_MS, claims.exp) });
}

/** A copy, so no request can change what another one reads. */
const copyOf = (result: AuthResult): AuthResult => ({ sub: result.sub, payload: structuredClone(result.payload) });

async function askAuth(client: SupabaseClient, token: string): Promise<AuthResult> {
  const { data, error } = await withAuthDeadline(client.auth.getUser(token));
  if (error || !data?.user?.id) {
    if (error && authUndecided(error)) {
      throw new AuthError(503, 'auth_unavailable', 'Authentication service is unavailable');
    }
    throw new AuthError(401, 'invalid_token', 'Token verification failed');
  }
  return { sub: data.user.id, payload: data.user as unknown as Record<string, unknown> };
}

/** The decision for `token`: this instance's acceptance while it holds, a
 * check already under way for the same token, or a new Auth call. */
async function decideToken(client: SupabaseClient, req: VercelRequest, token: string): Promise<AuthResult> {
  const key = tokenKey(token);
  const fresh = freshRequests.has(req) || !TRUSTING_METHODS.has(String(req.method ?? '').toUpperCase());
  if (!fresh) {
    const accepted = acceptedTokens.get(key);
    if (accepted && accepted.until > Date.now()) return copyOf(accepted.result);
    if (accepted) acceptedTokens.delete(key);
    const shared = sharedChecks.get(key);
    if (shared) return copyOf(await shared);
  }
  const check = askAuth(client, token);
  if (!fresh) sharedChecks.set(key, check);
  try {
    const result = await check;
    rememberAccepted(key, token, result);
    return copyOf(result);
  } catch (error) {
    // A refusal ends whatever this instance accepted before.
    if (error instanceof AuthError && error.status === 401) acceptedTokens.delete(key);
    throw error;
  } finally {
    if (sharedChecks.get(key) === check) sharedChecks.delete(key);
  }
}

function verifyTokenOnce(client: SupabaseClient, req: VercelRequest, token: string): Promise<AuthResult> {
  let checks = tokenChecks.get(req);
  if (!checks) tokenChecks.set(req, (checks = new Map()));
  const existing = checks.get(token);
  if (existing) return existing;
  const pending = decideToken(client, req, token);
  checks.set(token, pending);
  pending.catch((error: unknown) => {
    if (!(error instanceof AuthError && error.status === 401)) checks.delete(token);
  });
  return pending;
}

/**
 * Verify the caller's Supabase access token and return the verified subject
 * (the Supabase user id / UUID).
 *
 * In production this is strictly required. Outside production, if Supabase env
 * vars are missing the helper falls back to trusting a client-supplied
 * `user_id` (in body or query) so local dev continues to work — but it logs a
 * warning and never accepts that fallback when NODE_ENV=production.
 */
export async function requireAuth(req: VercelRequest): Promise<AuthResult> {
  const token = getBearer(req);

  if (authClient) {
    if (!token) throw new AuthError(401, 'missing_token', 'Missing Bearer token');
    return verifyTokenOnce(authClient, req, token);
  }

  if (IS_PROD) {
    throw new AuthError(503, 'auth_not_configured', 'Authentication is not configured');
  }

  const body = (req.body || {}) as { user_id?: unknown; host_id?: unknown };
  const fallback =
    (typeof body.user_id === 'string' && body.user_id) ||
    (typeof body.host_id === 'string' && body.host_id) ||
    (typeof req.query.user_id === 'string' && req.query.user_id) ||
    (typeof req.query.host_id === 'string' && req.query.host_id);
  if (!fallback) throw new AuthError(401, 'missing_token', 'Missing Bearer token');

  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      msg: 'requireAuth_dev_fallback',
      note: 'Trusting client-supplied user_id because Supabase env vars are not set. Configure Supabase env vars in production.',
    }),
  );
  return { sub: fallback, payload: { sub: fallback } };
}

/**
 * The verified account's email, only once Supabase has confirmed it
 * (`email_confirmed_at`); null otherwise. An unconfirmed address proves
 * nothing: anyone can sign up with someone else's and hold that session until
 * the link is clicked. So anything granted by address (the admin allow-list,
 * the owner's paths and private categories) reads it here, as billing does.
 */
export function confirmedEmail(payload: Record<string, unknown>): string | null {
  const email = payload.email;
  const confirmedAt = payload.email_confirmed_at;
  return typeof email === 'string' && email.length > 0 && typeof confirmedAt === 'string' && confirmedAt.length > 0
    ? email
    : null;
}

/**
 * Verify auth, but return null on failure instead of throwing. Useful for
 * routes that have both authenticated and unauthenticated branches.
 */
export async function tryAuth(req: VercelRequest): Promise<AuthResult | null> {
  // A genuinely anonymous request has no credentials and is allowed to take
  // the public branch. Presented-but-invalid credentials are not anonymous:
  // propagate the typed 401/503 so callers never pretend a broken session was
  // a successful guest action and then lose the learner's progress.
  if (!getBearer(req)) return null;
  return requireAuth(req);
}
