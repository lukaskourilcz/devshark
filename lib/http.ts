// Shared helpers for the Vercel serverless API handlers.
//
// Every function under api/ is its own serverless entrypoint, which is why the
// same Supabase-client setup, JSON error shape, structured logging, timeout
// guard and auth check used to be copy-pasted into each file. They now live
// here so there is a single source of truth.

import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { timedSupabaseFetch, withServerTiming } from './request-timing';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AuthError, hasAuthorizationHeader, requireAuth, type AuthResult } from './auth';
import { SUBJECT_SCOPE_CATALOG } from '../shared/subject-catalog';
import { gatedRef, PREMIUM_REQUIRED, type GatedContent, type GatedKind, type PremiumRequiredBody } from '../shared/tiers';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
// The service-role key bypasses row-level security. Callers are always verified
// via requireAuth() and scoped to their own id, so using it server-side is safe.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ANON_KEY;
const IS_PROD =
  process.env.NODE_ENV === 'production' ||
  process.env.VERCEL_ENV === 'production';

// No browser session to persist or refresh in a serverless function.
const SERVER_SIDE_AUTH = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedSupabaseFetch } } as const;
const requestContext = new AsyncLocalStorage<{ requestId: string; memo?: Map<string, Promise<unknown>> }>();

function incomingRequestId(req: VercelRequest): string {
  const raw = req.headers['x-request-id'] ?? req.headers['x-vercel-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && /^[A-Za-z0-9._:/-]{6,128}$/.test(value)
    ? value
    : randomUUID();
}

/** Give every handler/log/error a correlation id without logging request bodies. */
export function withRequestContext<T>(
  req: VercelRequest,
  res: VercelResponse,
  run: () => T,
): Promise<Awaited<T> | VercelResponse | void> {
  const requestId = incomingRequestId(req);
  res.setHeader('X-Request-Id', requestId);
  // Most answers are about the caller (stats, XP, a wallet, a room's host view
  // with its answers), so none is stored by a shared cache unless its handler
  // says so: the public boards, settings and structure set their own header,
  // which replaces this one.
  res.setHeader('Cache-Control', 'private, no-store');
  const started = Date.now();
  return requestContext.run({ requestId }, () => withServerTiming(res, async () => {
    try {
      return await run();
    } catch (error) {
      // A refusal of locked content is an answer, not a failure.
      if (error instanceof PremiumRequiredError && !res.headersSent) return jsonPremiumRequired(res, error);
      if (error instanceof ServiceUnavailableError && !res.headersSent) {
        // A timeout or an unrecordable claim is still a failure monitoring
        // should see at level error, as the 500 path logs one.
        logEvent('request', {
          level: 'error',
          method: req.method ?? 'UNKNOWN',
          path: req.url?.split('?')[0] ?? 'unknown',
          status: 503,
          category: error.code,
        });
        return jsonError(res, 503, error.code, error.message);
      }
      // Log the status the caller gets: an escaped AuthError answers its own
      // 401 or 503, and a refused token is a warning, not a server fault.
      const status = error instanceof AuthError ? error.status : 500;
      logEvent('request', {
        level: status >= 500 ? 'error' : 'warn',
        method: req.method ?? 'UNKNOWN',
        path: req.url?.split('?')[0] ?? 'unknown',
        status,
        category: error instanceof AuthError ? error.code : error instanceof Error ? error.name : 'unknown',
      });
      if (res.headersSent) return;
      if (error instanceof AuthError) {
        return jsonError(res, error.status, error.code, error.message);
      }
      return jsonError(res, 500, 'internal_error', 'Internal error');
    } finally {
      logEvent('request', {
        method: req.method ?? 'UNKNOWN',
        path: req.url?.split('?')[0] ?? 'unknown',
        status: res.statusCode ?? 200,
        latency_ms: Date.now() - started,
      });
    }
  })) as Promise<Awaited<T> | VercelResponse | void>;
}

/**
 * Client for endpoints that read/write a user's own private rows. Prefers the
 * service-role key (bypasses RLS); falls back to the anon key for local dev.
 */
export function createServiceClient(): SupabaseClient | null {
  // Treat an accidentally copied public anon key as unconfigured. It cannot
  // call the service-only learning RPCs and otherwise turns a clear readiness
  // failure into opaque database permission errors.
  if (IS_PROD && (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === ANON_KEY
  )) return null;
  return SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, SERVER_SIDE_AUTH)
    : null;
}

/**
 * Client for endpoints that only touch public data (leaderboards, health) or
 * accept anonymous writes (question reports). Always uses the anon key.
 */
export function createAnonClient(): SupabaseClient | null {
  return SUPABASE_URL && ANON_KEY
    ? createClient(SUPABASE_URL, ANON_KEY, SERVER_SIDE_AUTH)
    : null;
}

/** Send the app's standard `{ error: { code, message } }` JSON error response.
 * `detail` adds fields a client acts on (a 409's stored time). */
export function jsonError(res: VercelResponse, status: number, code: string, message: string, detail?: Record<string, unknown>) {
  return res.status(status).json({
    error: { ...detail, code, message, ...(requestContext.getStore()?.requestId ? { requestId: requestContext.getStore()!.requestId } : {}) },
  });
}

/** Thrown for content the caller's tier does not open (`lib/access.ts`).
 * `jsonPremiumRequired` and `withRequestContext` answer it with HTTP 402. */
export class PremiumRequiredError extends Error {
  readonly kind: GatedKind;
  readonly ref: string;
  constructor(content: GatedContent) {
    super('Premium opens this');
    this.name = 'PremiumRequiredError';
    this.kind = content.kind;
    this.ref = gatedRef(content);
  }
}

/** Thrown where going on would be unsafe while a service is down, such as a
 * one-time claim that could not be recorded (lib/rate-limit.ts `claimOnce`).
 * `withRequestContext` answers it with HTTP 503 and its code. */
export class ServiceUnavailableError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.code = code;
  }
}

/** HTTP 402 in the standard error envelope, naming what was refused. */
export function jsonPremiumRequired(res: VercelResponse, error: PremiumRequiredError) {
  const requestId = requestContext.getStore()?.requestId;
  const body: PremiumRequiredBody = {
    error: { code: PREMIUM_REQUIRED, message: error.message, kind: error.kind, ref: error.ref, ...(requestId ? { requestId } : {}) },
  };
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(402).json(body);
}

/** Compute a value once per request: a second call with the same key inside
 * the same request gets the first promise back. Outside a request context
 * (scripts, tests) it simply computes. */
export function requestMemo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const store = requestContext.getStore();
  if (!store) return compute();
  store.memo ??= new Map();
  const existing = store.memo.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = compute();
  store.memo.set(key, pending);
  // A failure is not remembered: the next caller in the request tries again.
  pending.catch(() => store.memo?.delete(key));
  return pending;
}

/** The names of a module's exports that are async functions. */
type AsyncExport<M> = { [K in keyof M]: M[K] extends (...args: never[]) => Promise<unknown> ? K : never }[keyof M];

/** A stand-in for one of a module's async functions that loads the module on
 * its first call. A router serves many ops from one function, and a module
 * only some of them need (a grader, the coding catalogue, Stripe) used to
 * evaluate on every cold start before the first answer, whichever op it was
 * (#587, server items 3 and 4). The module is loaded once and kept, as a
 * static import is; a module that fails to load rejects the call, which the
 * request context answers with 500. Call sites read exactly as before. */
export function lazyExport<M, K extends AsyncExport<M>>(load: () => Promise<M>, name: K): M[K] {
  const call = async (...args: unknown[]) => {
    const fn = (await load())[name] as unknown as (...rest: unknown[]) => Promise<unknown>;
    return fn(...args);
  };
  return call as unknown as M[K];
}

/** Emit one structured single-line JSON log entry (Vercel ingests this natively). */
export function logEvent(route: string, event: Record<string, unknown>) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    route,
    ...(requestContext.getStore()?.requestId ? { request_id: requestContext.getStore()!.requestId } : {}),
    ...event,
  }));
}

/** A logEvent bound to a fixed route, e.g. `const log = createLogger('quiz/submit')`. */
export function createLogger(route: string) {
  return (event: Record<string, unknown>) => logEvent(route, event);
}

/** A Supabase call that did not settle in time (`withTimeout`). The database
 * is busy or unreachable, which is the service being unavailable rather than
 * a fault in the request or the handler, so `withRequestContext` (and every
 * handler that answers a `ServiceUnavailableError` itself) answers 503
 * `upstream_timeout`, which a client may retry, instead of 500. */
export class UpstreamTimeoutError extends ServiceUnavailableError {
  constructor() {
    super('upstream_timeout', 'The service took too long to answer. Try again in a moment.');
    this.name = 'UpstreamTimeoutError';
  }
}

/** Reject with `UpstreamTimeoutError` if the Supabase call hasn't settled
 * within `ms`, so a hung upstream can't hang the request. */
export function withTimeout<T>(p: PromiseLike<T>, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new UpstreamTimeoutError()), ms);
    Promise.resolve(p).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** True when a Supabase error means the RPC isn't installed yet (a schema
 * migration is pending). PostgREST, which every `.rpc()` goes through, reports
 * a routine missing from its schema cache as PGRST202 ("Could not find the
 * function public.x(...) in the schema cache"). Postgres itself says
 * "function … does not exist" (42883), which is what arrives when an installed
 * routine calls one that is not. Both mean the same thing to a caller. 42883
 * is also Postgres's code for "operator does not exist", a bug in an installed
 * routine rather than a missing one, so that code counts only with the word
 * "function" in its message. */
export function isRpcMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  if (error.code === 'PGRST202') return true;
  if (error.code === '42883') return /\bfunction\b/i.test(message);
  return /could not find the function/i.test(message) || /function .* does not exist/i.test(message);
}

/** The caller's credentials, verified at most once per request. A route that
 * keys its rate limit by account verifies the token before the handler it
 * dispatches to does, and a second `auth.getUser` round trip for the same
 * token would buy nothing. A refused token is remembered as refused. */
function verifyOnce(req: VercelRequest): Promise<AuthResult | AuthError> {
  const header = req.headers.authorization || req.headers.Authorization;
  return requestMemo(`auth:${typeof header === 'string' ? header : ''}`, () =>
    requireAuth(req).catch((error: unknown) => {
      if (error instanceof AuthError) return error;
      throw error;
    }));
}

/** The verified caller's id, or null for a caller without valid credentials.
 * Sends nothing: for a route that treats a signed-out caller differently
 * rather than refusing it. */
export async function verifiedCallerId(req: VercelRequest): Promise<string | null> {
  const outcome = await verifyOnce(req).catch(() => null);
  return outcome && !(outcome instanceof AuthError) ? outcome.sub : null;
}

/** `tryAuth` (lib/auth.ts), verified at most once per request: null for a
 * caller who presented no credentials, the verified caller otherwise, and
 * refused credentials throw their AuthError as `tryAuth`'s do. A route whose
 * rate limit already verified the caller (`enforceClassRateLimit`) reads that
 * result here instead of asking Supabase Auth again. */
export async function tryAuthOnce(req: VercelRequest): Promise<AuthResult | null> {
  if (!hasAuthorizationHeader(req)) return null;
  const outcome = await verifyOnce(req);
  if (outcome instanceof AuthError) throw outcome;
  return outcome;
}

/**
 * Verify the caller and return the whole verified result (subject id plus the
 * token claims). Use this instead of `requireAuthSub` when the handler also
 * needs a claim such as the email, so the token is only verified once. On
 * failure this sends the error response itself and returns null.
 */
export async function requireAuthResult(
  req: VercelRequest,
  res: VercelResponse,
): Promise<AuthResult | null> {
  try {
    const outcome = await verifyOnce(req);
    if (outcome instanceof AuthError) {
      jsonError(res, outcome.status, outcome.code, outcome.message);
      return null;
    }
    return outcome;
  } catch {
    jsonError(res, 500, 'internal_error', 'Auth failed');
    return null;
  }
}

/**
 * Verify the caller and return their subject id (Supabase user id). On failure
 * this sends the error response itself and returns null, so handlers can write:
 *
 *   const sub = await requireAuthSub(req, res);
 *   if (!sub) return;
 */
export async function requireAuthSub(
  req: VercelRequest,
  res: VercelResponse,
): Promise<string | null> {
  return (await requireAuthResult(req, res))?.sub ?? null;
}

// Categories that count toward stats and leaderboards.
export const STATS_CATEGORIES: ReadonlySet<string> = new Set(
  Object.values(SUBJECT_SCOPE_CATALOG).flatMap((subject) => [...subject.categories]),
);
