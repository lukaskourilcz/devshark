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

const REQUEST_ID = /^[A-Za-z0-9._:/-]{6,128}$/;

function headerId(req: VercelRequest, name: string): { sent: boolean; id: string | undefined } {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return { sent: value !== undefined, id: typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined };
}

/**
 * The id a request's logs and errors carry. Vercel sets x-vercel-id on every
 * request, and it wins: X-Request-Id is the caller's choice (the browser
 * sends none), and taking it first let a script stamp its log lines, the
 * admin audit lines among them, with another request's id. Where Vercel
 * sets none (local, Docker) the caller's id is kept. A well-formed caller id
 * that differs from the one chosen is returned as `clientRequestId`, for the
 * request line to log beside it.
 */
function incomingRequestIds(req: VercelRequest): { requestId: string; clientRequestId?: string } {
  const vercel = headerId(req, 'x-vercel-id');
  const client = headerId(req, 'x-request-id').id;
  if (!vercel.sent) return { requestId: client ?? randomUUID() };
  const requestId = vercel.id ?? randomUUID();
  return client && client !== requestId ? { requestId, clientRequestId: client } : { requestId };
}

/** The largest body a request may declare. The biggest legitimate one is a
 * learning-path submission or draft (64 kB, shared/learning-path-api.ts);
 * the platform itself accepts 4.5 MB. */
const MAX_BODY_BYTES = 256 * 1024;
/** The cap for the two signed webhooks, whose sender decides the size. */
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const WEBHOOK_OPS: ReadonlySet<string> = new Set(['billing-webhook', 'payment-webhook']);

/** The op a router serves, read for the body cap only: the query getter
 * parses the URL, and a cap must not fail the request. */
function requestOp(req: VercelRequest): string {
  try {
    const op = req.query?.op;
    return typeof op === 'string' ? op.toLowerCase() : '';
  } catch {
    return '';
  }
}

/**
 * Whether the request declares a body past its cap. Vercel's runtime has
 * already buffered the bytes, but parses them only when something reads
 * `req.body`, and every handler's own cap reads it first: a 4.5 MB quiz
 * submit cost the parse (80 ms for 1.8 MB of keys) before its answer count
 * was looked at. Refusing on Content-Length saves that parse. A request
 * without one passes on to the platform's limit.
 */
function oversizeBody(req: VercelRequest): boolean {
  const raw = req.headers?.['content-length'];
  const declared = Array.isArray(raw) ? raw[0] : raw;
  if (typeof declared !== 'string' || !/^\d{1,16}$/.test(declared)) return false;
  const cap = WEBHOOK_OPS.has(requestOp(req)) ? MAX_WEBHOOK_BODY_BYTES : MAX_BODY_BYTES;
  return Number(declared) > cap;
}

/**
 * Whether the request's body cannot be read. Vercel's Node runtime parses the
 * body on its first read, from a getter (@vercel/node `setLazyProp`), and
 * throws from that read: ApiError(400, 'Invalid JSON') for broken JSON and,
 * from the content-type parser, a TypeError for a malformed Content-Type, on
 * any method and for an empty body too. The getter keeps no failure, so
 * every later read throws again, and a handler, `requireAuth`'s local
 * fallback or the admin password check met it and answered 500. Reading it
 * once here costs nothing more: an empty body parses to '' or {} and a
 * handler reads the value this read leaves behind. Any other failure is
 * thrown on to the 500 path.
 */
function unreadableBody(req: VercelRequest): boolean {
  try {
    void req.body;
    return false;
  } catch (error) {
    if (error instanceof TypeError) return true;
    if (error && typeof error === 'object' && (error as { statusCode?: unknown }).statusCode === 400) return true;
    throw error;
  }
}

/** Give every handler/log/error a correlation id without logging request bodies. */
export function withRequestContext<T>(
  req: VercelRequest,
  res: VercelResponse,
  run: () => T,
): Promise<Awaited<T> | VercelResponse | void> {
  const { requestId, clientRequestId } = incomingRequestIds(req);
  res.setHeader('X-Request-Id', requestId);
  // Most answers are about the caller (stats, XP, a wallet, a room's host view
  // with its answers), so none is stored by a shared cache unless its handler
  // says so: the public boards, settings and structure set their own header,
  // which replaces this one.
  res.setHeader('Cache-Control', 'private, no-store');
  const started = Date.now();
  return requestContext.run({ requestId }, () => withServerTiming(res, async () => {
    // A body the request cannot hand over is the caller's fault: a warning,
    // never the 500 path's error.
    const refuseBody = (status: number, category: string, code: string, message: string) => {
      logEvent('request', {
        level: 'warn',
        method: req.method ?? 'UNKNOWN',
        path: req.url?.split('?')[0] ?? 'unknown',
        status,
        category,
      });
      return jsonError(res, status, code, message);
    };
    try {
      if (oversizeBody(req)) return refuseBody(413, 'too_large', 'too_large', 'The request body is too large');
      if (unreadableBody(req)) return refuseBody(400, 'invalid_body', 'bad_request', 'The request body is not valid JSON');
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
        ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
        method: req.method ?? 'UNKNOWN',
        path: req.url?.split('?')[0] ?? 'unknown',
        status: res.statusCode ?? 200,
        latency_ms: Date.now() - started,
      });
    }
  })) as Promise<Awaited<T> | VercelResponse | void>;
}

/** Production without a usable service-role key. An accidentally copied
 * public anon key counts as none: it cannot call the service-only learning
 * RPCs and turns a clear configuration failure into opaque database
 * permission errors. */
function serviceKeyMissingInProduction(): boolean {
  return IS_PROD && (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === ANON_KEY);
}

const SERVICE_KEY_MISSING = 'SUPABASE_SERVICE_ROLE_KEY is not set (or is the anon key) in production: every handler that writes is disabled';
let reportedMissingServiceKey = false;

/**
 * The service-role client, or null where the deploy has no Supabase or, in
 * production, no usable service-role key. Only api/health.ts takes it this
 * way: it reports that deploy as degraded (503, serviceRole unavailable)
 * instead of failing to load.
 */
export function serviceClientOrNull(): SupabaseClient | null {
  if (serviceKeyMissingInProduction()) return null;
  return SUPABASE_URL && SERVICE_KEY
    ? createClient(SUPABASE_URL, SERVICE_KEY, SERVER_SIDE_AUTH)
    : null;
}

/**
 * Client for endpoints that read/write a user's own private rows. Prefers the
 * service-role key (bypasses RLS); falls back to the anon key for local dev.
 * Null where no Supabase is configured.
 *
 * In production with a Supabase URL and no usable service-role key it logs
 * one error line and throws, so the function that calls it at load fails to
 * start with a message naming the variable. It used to return null, and the
 * deploy answered every request 503 not_configured with no log line saying
 * why.
 */
export function createServiceClient(): SupabaseClient | null {
  if (SUPABASE_URL && serviceKeyMissingInProduction()) {
    if (!reportedMissingServiceKey) {
      reportedMissingServiceKey = true;
      logEvent('http', { level: 'error', category: 'configuration', reason: 'service_role_key_missing' });
    }
    throw new Error(SERVICE_KEY_MISSING);
  }
  return serviceClientOrNull();
}

/** Send the app's standard `{ error: { code, message } }` JSON error response.
 * `detail` adds fields a client acts on (a 409's stored time). */
export function jsonError(res: VercelResponse, status: number, code: string, message: string, detail?: Record<string, unknown>) {
  return res.status(status).json({
    error: { ...detail, code, message, ...(requestContext.getStore()?.requestId ? { requestId: requestContext.getStore()!.requestId } : {}) },
  });
}

/** The message a handler answers with (400) for text `unstorableText` finds. */
export const UNSTORABLE_TEXT_MESSAGE = 'Text cannot contain a NUL (U+0000) character or an unpaired surrogate';

// A UTF-16 high surrogate with no low one after it, or a low one with no high
// one before it. Without the `u` flag the pattern reads code units, which is
// what a JavaScript string holds.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Whether `value` holds text Postgres text and JSONB cannot store: U+0000
 * (22P05) or a lone UTF-16 surrogate. A JSON body can carry `"\ud800"`;
 * JSON.stringify sends it on as that escape and Postgres refuses the whole
 * argument (22P02, "Unicode low surrogate must follow a high surrogate"),
 * which handlers answered with 500. Walks strings, arrays and plain objects,
 * their keys included: the values, never the JSON text, so code that spells
 * `\u0000` out still saves. A container nested deeper than `depth` counts as
 * unstorable, so nothing past the bound reaches the database unchecked.
 */
export function unstorableText(value: unknown, depth = 8): boolean {
  if (typeof value === 'string') return value.includes('\u0000') || LONE_SURROGATE.test(value);
  if (value === null || typeof value !== 'object') return false;
  if (depth <= 0) return true;
  if (Array.isArray(value)) return value.some((one) => unstorableText(one, depth - 1));
  return Object.entries(value).some(([key, one]) => unstorableText(key, depth) || unstorableText(one, depth - 1));
}

/** The longest query value `queryString` hands a handler. No parameter the
 * API reads (a topic, a room code, a date, an id) comes near it. */
export const MAX_QUERY_STRING = 256;

/**
 * One query parameter as a single string: undefined when the request does
 * not carry it, null when it cannot be one value. `?x=a&x=b` arrives as an
 * array, and `String(array)` or `.split()` on it served or crashed a request
 * the URL does not describe; a value past `MAX_QUERY_STRING` characters is
 * null too. A handler answers null with 400.
 */
export function queryString(req: Pick<VercelRequest, 'query'>, name: string): string | undefined | null {
  const query = req.query ?? {};
  if (!Object.hasOwn(query, name) || query[name] === undefined) return undefined;
  const value = query[name];
  return typeof value === 'string' && value.length <= MAX_QUERY_STRING ? value : null;
}

/** Nine digits at most, nothing around them: below 2^31, so Postgres
 * integer holds every value that passes. */
const QUERY_INT = /^\d{1,9}$/;

/**
 * One query parameter as a whole number from `min` to `max`: undefined when
 * the request does not carry it, null for anything else. `parseInt` read
 * `1.9`, `1abc` and `?x=1&x=2` as 1 and served level 1; this refuses a
 * fraction, an exponent, a sign, a space, trailing junk, an empty value, an
 * array and a number outside the bounds. A handler answers null with 400.
 */
export function queryInt(
  req: Pick<VercelRequest, 'query'>,
  name: string,
  bounds: { min: number; max: number },
): number | undefined | null {
  const value = queryString(req, name);
  if (value === undefined || value === null) return value;
  if (!QUERY_INT.test(value)) return null;
  const n = Number(value);
  return n >= bounds.min && n <= bounds.max ? n : null;
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
  const write = event.level === 'error' ? console.error : event.level === 'warn' ? console.warn : console.log;
  write(JSON.stringify({
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
