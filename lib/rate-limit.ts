// Rate limiter for the Vercel serverless API.
//
// Two backends behind one entrypoint, `enforceRateLimit()`:
//
//   1. Upstash Redis (distributed) — used automatically when
//      UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set. This is the
//      real limit: it holds across every cold serverless instance, closing the
//      gap the in-memory limiter can't (a burst spread over many fresh
//      instances). Recommended for production.
//
//   2. In-memory token bucket (`checkRateLimit`) — the fallback used when
//      Upstash isn't configured, or if a Redis call fails so we never hard-fail
//      a request on the limiter. Buckets are keyed per (endpoint, caller): the
//      identity a handler passes, always `user:<verified id>`, or the client
//      IP when it passes none. A server-configured shared operation scope has
//      one bucket across callers (used only after integration verification).
//      They live in the module's Map, which persists
//      across warm invocations of the same instance. Not distributed, but
//      enough to blunt the "one script hammering one endpoint" abuse the app
//      cares about (leaderboard spam, report spam, admin-password guessing).
//
// Callers should prefer `await enforceRateLimit(...)`; `checkRateLimit()` stays
// exported for the fallback path and any sync call site.

import { isIP } from 'node:net';
import type { VercelRequest, VercelResponse } from './vercel-types.js';
import { jsonError, logEvent, ServiceUnavailableError, verifiedCallerId } from './http';
import { getBearer } from './auth';

interface Bucket {
  tokens: number;
  updatedAt: number;
  /** When the bucket is full again if nothing takes from it. */
  fullAt: number;
}

/** Per-endpoint bucket configuration. */
export interface RateLimitConfig {
  /** Max requests allowed in a full bucket. */
  capacity: number;
  /** Refill rate — tokens per second. */
  refillPerSecond: number;
  /** Namespace so different endpoints don't share buckets. */
  key: string;
  /** A server-configured operation budget shared across callers; never a user identity. */
  scope?: 'shared';
}

/**
 * How many people may legitimately share one public address inside one room.
 *
 * This is a statement about networks, not a product cap. A school class is
 * about thirty pupils and a school NATs all of them onto one address, so every
 * `play` bucket below that is keyed by address has to hold a whole class, or
 * a classroom round 429s its own participants. Thirty pupils, the teacher,
 * and one spare.
 *
 * The per-person limits are enforced separately, per verified account, so
 * raising these does not widen what any one learner may do.
 */
export const SHARED_NETWORK_SEATS = 32;

export const RATE_LIMITS = {
  admin: { key: 'admin_gate', capacity: 5, refillPerSecond: 1 },
  // Read-only export has one owner-controlled integration authority. Consume
  // this shared budget only after verifying its bearer, without learner Auth.
  marketingExport: { key: 'marketing_export', capacity: 20, refillPerSecond: 20 / 60, scope: 'shared' },
  // A quiz, review or due list, the daily challenge, the question of the day,
  // a Challenge batch and a placement start. Two tiers (`enforceClassRateLimit`):
  // this one is the caller's own, per account, per sealed Challenge run for a
  // guest's refill, or per address for any other guest; the address bucket
  // below holds a class, which used to share this one budget and refused
  // pupil twenty-one.
  quizSession: { key: 'quiz_session', capacity: 20, refillPerSecond: 20 / 60 },
  quizSessionAddress: { key: 'quiz_session_address', capacity: SHARED_NETWORK_SEATS * 20, refillPerSecond: (SHARED_NETWORK_SEATS * 20) / 60 },
  // Grading and the Challenge have two tiers, like `play` below. The address
  // buckets hold a class behind one NAT: a Challenge sends one submit per
  // question, so a class playing it at once spent the old one-person budget
  // in seconds, and grading's address bucket holds every seat answering at
  // its full Challenge rate (`challengeSubmitPerUser`), the fastest any
  // caller submits. Each caller is then bounded by a bucket of their own: a
  // signed-in caller's account, or, for a Challenge played without an
  // account, the run id sealed in its session or run token (`run:<runId>`),
  // with the same budget, so a class of guests is not held to one person's
  // rate. Any other caller without an account keeps the address rate these
  // endpoints had before the split.
  quizSubmit: { key: 'quiz_submit', capacity: SHARED_NETWORK_SEATS * 30, refillPerSecond: (SHARED_NETWORK_SEATS * 30) / 60 },
  quizSubmitPerUser: { key: 'quiz_submit_user', capacity: 12, refillPerSecond: 12 / 60 },
  // One Challenge answer per submit: a quick learner answers a question every
  // few seconds, which the twelve-a-minute quiz budget cut off.
  challengeSubmitPerUser: { key: 'challenge_submit_user', capacity: 30, refillPerSecond: 30 / 60 },
  quizSubmitAnonymous: { key: 'quiz_submit_anon', capacity: 12, refillPerSecond: 12 / 60 },
  challengeScore: { key: 'challenge_score', capacity: SHARED_NETWORK_SEATS * 3, refillPerSecond: (SHARED_NETWORK_SEATS * 10) / 3600 },
  challengeScorePerUser: { key: 'challenge_score_user', capacity: 3, refillPerSecond: 10 / 3600 },
  // A run can end after three quick answers, and a completion that failed is
  // sent again with the next one, so a learner's own budget is larger than
  // the twelve an hour one whole address used to share.
  challengeComplete: { key: 'challenge_complete', capacity: SHARED_NETWORK_SEATS * 12, refillPerSecond: (SHARED_NETWORK_SEATS * 12) / 3600 },
  challengeCompletePerUser: { key: 'challenge_complete_user', capacity: 30, refillPerSecond: 30 / 3600 },
  // A signed-in leaderboard read skips the CDN (it carries the learner's own
  // rank), so it gets a bucket; the anonymous board is cached and needs none.
  leaderboardPersonal: { key: 'leaderboard_personal', capacity: 30, refillPerSecond: 30 / 60 },
  // A question report, in two tiers like the writes below: the address bucket
  // holds a class behind one NAT, which used to share three reports and got
  // 429 on the fourth; `questionReport` is then the verified account's own,
  // or the address's for a reporter without one, the rate it had before.
  questionReport: { key: 'question_report', capacity: 3, refillPerSecond: 20 / 3600 },
  questionReportAddress: { key: 'question_report_address', capacity: SHARED_NETWORK_SEATS * 3, refillPerSecond: (SHARED_NETWORK_SEATS * 20) / 3600 },
  // Every write to `api/user/[op].ts`, in two tiers like play's: an address
  // backstop that holds a class behind one NAT, then `userMutation` keyed by
  // the verified account. A caller without an account keeps `userMutation` by
  // address, the rate it had before the split.
  userMutation: { key: 'user_mutation', capacity: 20, refillPerSecond: 20 / 60 },
  userMutationAddress: { key: 'user_mutation_address', capacity: SHARED_NETWORK_SEATS * 20, refillPerSecond: (SHARED_NETWORK_SEATS * 20) / 60 },
  flashcardMutation: { key: 'flashcard_mutation', capacity: 20, refillPerSecond: 20 / 60 },
  roadmapAnswer: { key: 'roadmap_answer', capacity: 80, refillPerSecond: 80 / 60 },
  roadmapComplete: { key: 'roadmap_complete', capacity: 12, refillPerSecond: 12 / 60 },
  // The three above are each a caller's own bucket (`enforceClassRateLimit`),
  // per account, or per address for a caller without one. These are their
  // address backstops: a class at the per-person rate.
  flashcardMutationAddress: { key: 'flashcard_mutation_address', capacity: SHARED_NETWORK_SEATS * 20, refillPerSecond: (SHARED_NETWORK_SEATS * 20) / 60 },
  roadmapAnswerAddress: { key: 'roadmap_answer_address', capacity: SHARED_NETWORK_SEATS * 80, refillPerSecond: (SHARED_NETWORK_SEATS * 80) / 60 },
  roadmapCompleteAddress: { key: 'roadmap_complete_address', capacity: SHARED_NETWORK_SEATS * 12, refillPerSecond: (SHARED_NETWORK_SEATS * 12) / 60 },
  // Play has two tiers (ported by hand from fa884b7). The address buckets
  // hold a whole class behind one NAT; each is paired with a bucket keyed by
  // the caller's verified account (`user:<id>`) at the rate the address bucket
  // used to carry, which is what bounds one learner.
  //
  // A host opens one room per round, but several teachers in one school share
  // one address, so the address bucket holds a handful of concurrent rooms.
  playCreate: { key: 'play_create', capacity: 20, refillPerSecond: 20 / 60 },
  // A class arrives at once: one join each, plus retries on a bad code.
  playJoin: { key: 'play_join', capacity: SHARED_NETWORK_SEATS + 16, refillPerSecond: (SHARED_NETWORK_SEATS + 16) / 60 },
  // Every seat on the 4 s Realtime fallback poll in `Play.tsx`, 15 reads a
  // minute each. With Realtime up, each answer's broadcast makes every client
  // read state again, and a full class outruns this bucket; coalescing those
  // reads in `Play.tsx` is the fix for that, not a larger bucket.
  playState: { key: 'play_state', capacity: SHARED_NETWORK_SEATS * 15 + 120, refillPerSecond: (SHARED_NETWORK_SEATS * 15 + 120) / 60 },
  // One answer per seat per question, a brisk round being a few questions a
  // minute, plus the host's heartbeat and controls.
  playMutation: { key: 'play_mutation', capacity: SHARED_NETWORK_SEATS * 5 + 40, refillPerSecond: (SHARED_NETWORK_SEATS * 5 + 40) / 60 },
  // Per verified account: the values the address buckets carried before the
  // split, so no individual may do more than before.
  playCreatePerUser: { key: 'play_create_user', capacity: 5, refillPerSecond: 5 / 60 },
  playJoinPerUser: { key: 'play_join_user', capacity: 12, refillPerSecond: 12 / 60 },
  playStatePerUser: { key: 'play_state_user', capacity: 60, refillPerSecond: 60 / 60 },
  playMutationPerUser: { key: 'play_mutation_user', capacity: 30, refillPerSecond: 30 / 60 },
  // A classroom host's answer distribution. The presenter view polls it every
  // 1.5 s (`Play.tsx`), 40 reads a minute, beside its own state reads, so it
  // does not share `playStatePerUser` (fa884b7 charged it there). It had no
  // limit before the split; this holds two presenter windows.
  playDistributionPerUser: { key: 'play_distribution_user', capacity: 90, refillPerSecond: 90 / 60 },
  // `state` is the one play action a caller without an account may complete:
  // anyone holding the six-character code can read it. Signed out, it keeps
  // the address rate it had before the split, so the class-sized `playState`
  // buys an anonymous caller nothing.
  playStateAnonymous: { key: 'play_state_anon', capacity: 60, refillPerSecond: 60 / 60 },
  accountDelete: { key: 'account_delete', capacity: 2, refillPerSecond: 2 / 3600 },
  accountDeleteAddress: { key: 'account_delete_address', capacity: SHARED_NETWORK_SEATS * 2, refillPerSecond: (SHARED_NETWORK_SEATS * 2) / 3600 },
  aiExplanation: { key: 'ai_explanation', capacity: 3, refillPerSecond: 5 / 3600 },
  // Coding tasks, in two tiers like the Learn buckets above: the caller's own
  // bucket, then a class-sized address backstop. A task load used to share
  // `quizSession`. A draft save is a write to `api/user/[op].ts` and takes
  // `userMutation`'s two tiers there.
  codingTask: { key: 'coding_task', capacity: 20, refillPerSecond: 20 / 60 },
  codingReveal: { key: 'coding_reveal', capacity: 10, refillPerSecond: 10 / 3600 },
  codingTaskAddress: { key: 'coding_task_address', capacity: SHARED_NETWORK_SEATS * 20, refillPerSecond: (SHARED_NETWORK_SEATS * 20) / 60 },
  codingRevealAddress: { key: 'coding_reveal_address', capacity: SHARED_NETWORK_SEATS * 10, refillPerSecond: (SHARED_NETWORK_SEATS * 10) / 3600 },
  // A coding Submit is limited per task (owner decision, 9 October 2026):
  // thirty in ten minutes for one caller on one task, what one caller had for
  // every task together before, so a learner moving on to the next task
  // starts with a full bucket. Beneath it a ceiling per caller across every
  // task, 120 in ten minutes (a Submit every five seconds), which no learner
  // working through tasks meets and which bounds what one account or one
  // guest address can spend on graders and React sandboxes. Both are keyed by
  // the account, or by the address for a guest (`enforcePerItemRateLimit`).
  // The address backstop holds a class at the per-task rate, as before.
  codingSubmit: { key: 'coding_submit_task', capacity: 30, refillPerSecond: 30 / 600 },
  codingSubmitCeiling: { key: 'coding_submit', capacity: 120, refillPerSecond: 120 / 600 },
  codingSubmitAddress: { key: 'coding_submit_address', capacity: SHARED_NETWORK_SEATS * 30, refillPerSecond: (SHARED_NETWORK_SEATS * 30) / 600 },
  githubConnect: { key: 'github_connect', capacity: 10, refillPerSecond: 10 / 3600 },
  githubSync: { key: 'github_sync', capacity: 6, refillPerSecond: 6 / 3600 },
  // Choosing the garden's repository reads every page of the installation's
  // repositories from GitHub (up to ten calls), so a script could spend the
  // installation's GitHub budget through it. A learner picks once or twice.
  githubRepo: { key: 'github_repo', capacity: 10, refillPerSecond: 10 / 600 },
  // Learning paths: starting an activity is cheap, submitting one runs the
  // sandbox, and a draft autosave fires while the learner types. These four
  // are keyed by the verified account (`user:<id>`), because a class works
  // through one address. A submit is limited per activity, like a coding
  // Submit per task, beneath a ceiling per account across every activity.
  learningPathStart: { key: 'learning_path_start', capacity: 30, refillPerSecond: 30 / 600 },
  learningPathSubmit: { key: 'learning_path_submit_activity', capacity: 30, refillPerSecond: 30 / 600 },
  learningPathSubmitCeiling: { key: 'learning_path_submit', capacity: 120, refillPerSecond: 120 / 600 },
  learningPathDraft: { key: 'learning_path_draft', capacity: 60, refillPerSecond: 60 / 600 },
  learningPathEnroll: { key: 'learning_path_enroll', capacity: 10, refillPerSecond: 10 / 600 },
  // Their address backstops, taken before the token is verified: a whole class
  // behind one NAT at the per-account rate, so only a flood from one address
  // meets them.
  learningPathStartAddress: { key: 'learning_path_start_address', capacity: SHARED_NETWORK_SEATS * 30, refillPerSecond: (SHARED_NETWORK_SEATS * 30) / 600 },
  learningPathSubmitAddress: { key: 'learning_path_submit_address', capacity: SHARED_NETWORK_SEATS * 30, refillPerSecond: (SHARED_NETWORK_SEATS * 30) / 600 },
  learningPathDraftAddress: { key: 'learning_path_draft_address', capacity: SHARED_NETWORK_SEATS * 60, refillPerSecond: (SHARED_NETWORK_SEATS * 60) / 600 },
  // Billing (#221). Checkout, the portal and the success-page lookup are keyed
  // by account (the `identity` argument); the public cancellation page by
  // address. The Stripe webhook has no limit: its signature is the gate.
  billingCheckout: { key: 'billing_checkout', capacity: 10, refillPerSecond: 10 / 60 },
  billingPortal: { key: 'billing_portal', capacity: 10, refillPerSecond: 10 / 60 },
  billingSession: { key: 'billing_session', capacity: 20, refillPerSecond: 20 / 60 },
  billingCancel: { key: 'billing_cancel', capacity: 5, refillPerSecond: 5 / 3600 },
  // Opening and confirming the emailed link of the cancellation page.
  billingCancelLink: { key: 'billing_cancel_link', capacity: 10, refillPerSecond: 10 / 3600 },
  // An invite code is bound once, at sign-up (#228); keyed by account.
  referralClaim: { key: 'referral_claim', capacity: 5, refillPerSecond: 5 / 3600 },
  // Premium vouchers (migration 045). A code can be guessed, so every attempt
  // counts, a success included: five an hour per account, and ten an hour per
  // address, so two people behind one router each keep their five.
  voucherRedeem: { key: 'voucher_redeem', capacity: 5, refillPerSecond: 5 / 3600 },
  voucherRedeemAddress: { key: 'voucher_redeem_address', capacity: 10, refillPerSecond: 10 / 3600 },
  // Reads a script can drive (`limitRead` below): the wallet, badges and a
  // friend lookup, the Learn map, plan and steps, and a leaderboard read the
  // CDN did not answer. Two tiers like the writes: an address backstop that
  // holds a class behind one NAT, then the verified account's own. A guest
  // has the address tier alone. Generous: nobody reading at a person's pace
  // meets either.
  readAddress: { key: 'read_address', capacity: SHARED_NETWORK_SEATS * 60, refillPerSecond: (SHARED_NETWORK_SEATS * 60) / 60 },
  readPerUser: { key: 'read_user', capacity: 120, refillPerSecond: 120 / 60 },
  // The GitHub garden's address backstops. githubConnect and githubSync above
  // are keyed by the verified account (`user:<id>`), so each learner keeps
  // the budget one whole address used to share (a connect is a start and a
  // finish, so five an hour); these hold a class connecting behind one NAT.
  githubConnectAddress: { key: 'github_connect_address', capacity: SHARED_NETWORK_SEATS * 10, refillPerSecond: (SHARED_NETWORK_SEATS * 10) / 3600 },
  githubSyncAddress: { key: 'github_sync_address', capacity: SHARED_NETWORK_SEATS * 6, refillPerSecond: (SHARED_NETWORK_SEATS * 6) / 3600 },
  githubRepoAddress: { key: 'github_repo_address', capacity: SHARED_NETWORK_SEATS * 10, refillPerSecond: (SHARED_NETWORK_SEATS * 10) / 600 },
} satisfies Record<string, RateLimitConfig>;

const buckets = new Map<string, Bucket>();

// Trim the buckets that have refilled completely, so a long-running instance
// can't slowly leak memory. Only a full bucket may go: a missing one starts
// full, so dropping one still refilling would hand its caller the rest of the
// budget early. Dropping any bucket idle ten minutes with a token left gave a
// voucher guesser four tries every ten minutes instead of five an hour.
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanup = Date.now();
function maybeCleanup(now: number): void {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [k, b] of buckets) {
    if (b.fullAt <= now) buckets.delete(k);
  }
}

function storeBucket(key: string, config: RateLimitConfig, tokens: number, now: number): void {
  buckets.set(key, { tokens, updatedAt: now, fullAt: now + ((config.capacity - tokens) / config.refillPerSecond) * 1000 });
}

/**
 * Extract the client IP from headers Vercel sets. Falls back to a stable
 * bucket key when nothing is available, which just means the whole
 * unknown-IP population shares one bucket — safe under abuse, mildly noisy
 * for legit users behind a shared proxy.
 */
function clientIp(req: VercelRequest): string {
  const address = addressKey(forwardedAddress(req));
  // An account's bucket is `user:<id>`. No address starts that way, but the
  // header is whatever the client sent where no proxy overwrites it, so such
  // a value is moved out of that namespace rather than reach an account's
  // bucket.
  return address.startsWith('user:') ? `ip:${address}` : address;
}

/**
 * The bucket key for an address. One IPv6 subscriber holds a whole /64 and can
 * pick any address in it, so keyed per address every request could come from
 * a fresh bucket: the admin gate, a guest's grading budget and every address
 * backstop would hold nothing. An IPv6 address counts as its /64, the way an
 * IPv4 household counts as its one public address, and an IPv4 address written
 * as IPv6 (`::ffff:192.0.2.1`) as that IPv4 address. Anything else is kept.
 */
export function addressKey(address: string): string {
  const bare = address.split('%')[0];
  if (isIP(bare) !== 6) return address;
  const lower = bare.toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(lower);
  if (mapped) return mapped[1];
  const [head, tail] = lower.split('::');
  const headGroups = head ? head.split(':') : [];
  let groups = headGroups;
  if (tail !== undefined) {
    const tailGroups = tail ? tail.split(':') : [];
    // An embedded IPv4 address fills the last two groups.
    const tailWidth = tailGroups.length + (tailGroups.at(-1)?.includes('.') ? 1 : 0);
    groups = [...headGroups, ...Array<string>(8 - headGroups.length - tailWidth).fill('0'), ...tailGroups];
  }
  return `${groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16)).join(':')}::/64`;
}

function forwardedAddress(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).split(',')[0].trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real;
  return req.socket?.remoteAddress ?? 'unknown';
}

/**
 * Consume one token from the (endpoint, caller) bucket. Returns true if
 * allowed, or false + writes a 429 response with a Retry-After header.
 *
 * Pass `identity`, `user:<id>` built from a verified token, to bucket per
 * account instead of per address: a classroom round has thirty callers behind
 * one address. The `user:` prefix keeps it apart from every address
 * (`clientIp` never returns one that starts so), so one handler can hold an
 * address bucket and an account bucket at once.
 */
export function checkRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  config: RateLimitConfig,
  identity?: string,
): boolean {
  const now = Date.now();
  maybeCleanup(now);

  const key = `${config.key}:${config.scope === 'shared' ? 'shared' : identity ?? clientIp(req)}`;
  const b = buckets.get(key) ?? { tokens: config.capacity, updatedAt: now, fullAt: now };
  const elapsedSeconds = (now - b.updatedAt) / 1000;
  const refilled = Math.min(config.capacity, b.tokens + elapsedSeconds * config.refillPerSecond);

  if (refilled < 1) {
    const retryAfter = Math.ceil((1 - refilled) / config.refillPerSecond);
    storeBucket(key, config, refilled, now);
    res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
    jsonError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    return false;
  }

  storeBucket(key, config, refilled - 1, now);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Distributed backend (Upstash Redis), lazily wired                          */
/* -------------------------------------------------------------------------- */

// `@upstash/ratelimit` + `@upstash/redis` are optional deps: present in
// package.json, but the limiter must not hard-depend on them at build time so
// the app keeps working (on the in-memory path) if they're absent or the env
// vars aren't set. Hence the lazy, guarded, cached import below.

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const LIMITER_DEADLINE_MS = 500;

/** `true` when the distributed limiter has been configured via env vars. */
export function isDistributedRateLimitEnabled(): boolean {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

// One Ratelimit instance per config.key (per warm instance). `null` marks a
// backend that failed to initialise, so we don't retry the import every call.
type UpstashLimiter = { limit: (id: string) => Promise<{ success: boolean; reset: number }> };
const limiterCache = new Map<string, UpstashLimiter | null>();
let redisClient: unknown | null | undefined; // undefined = not tried yet

async function getUpstashLimiter(config: RateLimitConfig): Promise<UpstashLimiter | null> {
  if (!isDistributedRateLimitEnabled()) return null;
  if (limiterCache.has(config.key)) return limiterCache.get(config.key) ?? null;

  try {
    // Optional deps: `@ts-ignore` covers the "package not installed" case, and
    // the `as any` casts keep the block from hard-coupling to Upstash's types
    // (which may or may not be resolvable at typecheck time).
    // @ts-ignore — optional dependency, resolved at runtime in production
    const Ratelimit = ((await import('@upstash/ratelimit')) as any).Ratelimit;
    // @ts-ignore — optional dependency, resolved at runtime in production
    const Redis = ((await import('@upstash/redis')) as any).Redis;

    if (redisClient === undefined) {
      redisClient = new Redis({
        url: UPSTASH_URL as string,
        token: UPSTASH_TOKEN as string,
        // Abort the fetch as well as the caller's wait. A disconnected
        // response can be ambiguous, so never retry a bucket mutation.
        signal: () => AbortSignal.timeout(LIMITER_DEADLINE_MS),
        retry: { retries: 0 },
      });
    }

    // Map the token-bucket config onto a sliding window: `capacity` requests
    // per (capacity / refillPerSecond) seconds — i.e. the time it takes an
    // empty bucket to refill to full — which preserves the intended budget.
    const windowSeconds = Math.max(1, Math.round(config.capacity / config.refillPerSecond));
    const limiter = new Ratelimit({
      redis: redisClient,
      limiter: Ratelimit.slidingWindow(config.capacity, `${windowSeconds} s`),
      prefix: `rl:${config.key}`,
      analytics: false,
      timeout: 0, // Use our deadline and local fallback for every failure.
    }) as UpstashLimiter;

    limiterCache.set(config.key, limiter);
    return limiter;
  } catch {
    // Package missing or init failed — record the miss and fall back forever.
    limiterCache.set(config.key, null);
    return null;
  }
}

async function withLimiterDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('rate_limit_timeout')), LIMITER_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// After Upstash fails, this instance keeps to its in-memory buckets for a
// while instead of asking again. A hung Upstash otherwise held every request
// for the whole deadline once per bucket it takes (two or three per request),
// and a Redis that refuses every call cost each bucket a round trip for
// nothing.
const LIMITER_PAUSE_MS = 15_000;
let limiterPausedUntil = 0;

/**
 * Enforce a rate limit, preferring the distributed Upstash backend and falling
 * back to the in-memory token bucket. Returns true if the request may proceed,
 * or false after writing a 429 (+ Retry-After) response.
 *
 *   if (!(await enforceRateLimit(req, res, { key: 'admin_gate', capacity: 5, refillPerSecond: 1 }))) return;
 */
export async function enforceRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  config: RateLimitConfig,
  /** Who the bucket belongs to, such as `user:<id>`; the client IP when omitted. */
  identity?: string,
): Promise<boolean> {
  if (Date.now() < limiterPausedUntil) return checkRateLimit(req, res, config, identity);
  const limiter = await getUpstashLimiter(config);
  if (!limiter) return checkRateLimit(req, res, config, identity);

  try {
    const id = config.scope === 'shared' ? 'shared' : identity ?? clientIp(req);
    const { success, reset } = await withLimiterDeadline(limiter.limit(id));
    if (success) return true;

    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    jsonError(res, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    return false;
  } catch {
    // Redis unreachable mid-request — never hard-fail on the limiter; fall back
    // to the in-memory bucket so the endpoint stays available.
    const now = Date.now();
    if (now >= limiterPausedUntil) {
      limiterPausedUntil = now + LIMITER_PAUSE_MS;
      logEvent('rate-limit', { level: 'warn', reason: 'distributed_fallback' });
    }
    return checkRateLimit(req, res, config, identity);
  }
}

/* -------------------------------------------------------------------------- */
/* Two tiers for a class behind one address                                   */
/* -------------------------------------------------------------------------- */

/* The caller's token is checked while the address bucket answers (#587,
 * server item 2). The prelude used to be three round trips in series, the
 * address bucket, Supabase Auth, the account bucket, before any handler work;
 * for a Learn answer that was three of its four. The address bucket still
 * decides first: the account bucket is taken only after it admitted the
 * request, and a refused request answers 429 whatever the token check says.
 *
 * What the old order also bought was that an address flood refused by its
 * bucket never reached Supabase Auth. That holds again after the first
 * refusal: an address its bucket refused on this instance has its token
 * checked only after the bucket admits it, for a minute
 * (REFUSED_ADDRESS_HOLD_MS). Until that first refusal every request was
 * admitted, and was checked under the old order too. A read whose token
 * Auth accepted is not asked again for a minute either (lib/auth.ts). */
const REFUSED_ADDRESS_HOLD_MS = 60_000;
const REFUSED_ADDRESS_LIMIT = 10_000;
const refusedAddresses = new Map<string, number>();

/** Start the caller's token check now, unless there is no token or this
 * address was refused by `address` lately; null when it waits. */
function callerCheckDuringAddressBucket(req: VercelRequest, address: RateLimitConfig): Promise<string | null> | null {
  if (!getBearer(req)) return null;
  const key = `${address.key}:${clientIp(req)}`;
  const until = refusedAddresses.get(key);
  if (until !== undefined) {
    if (until > Date.now()) return null;
    refusedAddresses.delete(key);
  }
  return verifiedCallerId(req);
}

function noteAddressRefused(req: VercelRequest, address: RateLimitConfig): void {
  const now = Date.now();
  if (refusedAddresses.size >= REFUSED_ADDRESS_LIMIT) {
    for (const [key, until] of refusedAddresses) if (until <= now) refusedAddresses.delete(key);
    while (refusedAddresses.size >= REFUSED_ADDRESS_LIMIT) refusedAddresses.delete(refusedAddresses.keys().next().value!);
  }
  refusedAddresses.set(`${address.key}:${clientIp(req)}`, now + REFUSED_ADDRESS_HOLD_MS);
}

/** The address tier, with the caller's token checked meanwhile: the verified
 * caller's id (null for none) once the address bucket admitted the request,
 * or `false` after it sent the 429. */
async function admitAddressThenCaller(req: VercelRequest, res: VercelResponse, address: RateLimitConfig): Promise<string | null | false> {
  const caller = callerCheckDuringAddressBucket(req, address);
  if (!(await enforceRateLimit(req, res, address))) {
    noteAddressRefused(req, address);
    return false;
  }
  return caller ?? verifiedCallerId(req);
}

/**
 * The address tier of a route whose handler checks the caller and takes the
 * caller's own bucket itself (a coding Submit, a learning-path start, submit
 * or draft save): the same bucket as `enforceRateLimit(req, res, address)`,
 * with the caller's token checked while it answers, as in
 * `enforceClassRateLimit`. The check is remembered for the request, so the
 * handler's `requireAuthSub` or `verifiedCallerId` reads it instead of asking
 * Supabase Auth after the bucket (#587, server item 2). A refused request
 * answers 429 whatever the token says, and an address refused on this
 * instance has its token checked only after the bucket admits it, for a
 * minute. Returns false after sending the 429.
 */
export async function enforceAddressRateLimit(req: VercelRequest, res: VercelResponse, address: RateLimitConfig): Promise<boolean> {
  return (await admitAddressThenCaller(req, res, address)) !== false;
}

/**
 * Enforce a limit in two tiers, for a route a class uses at once. A school
 * puts thirty pupils behind one address, so a bucket keyed by address alone
 * and sized for one person refused pupil twenty-one.
 *
 * `address` is keyed by the client address and holds a class; it is taken
 * before the credentials are read, so a flood from one address meets it
 * first (the token is checked meanwhile, see above). `perCaller` is the caller's own: keyed by the verified account
 * (`user:<id>`), or, for a caller without one, by `sealedGuest` when the
 * handler holds an id the server sealed for it (a Challenge run,
 * `run:<runId>`), and otherwise by address, the rate the route had before the
 * split. No one person may do more than before, and guests without a sealed
 * run still share their address's budget.
 *
 * The credentials are verified once per request (`verifiedCallerId`); the
 * handler's own `requireAuthSub`, `requireAuthResult` or `tryAuthOnce` reads
 * that result. Returns false after sending the 429.
 */
export async function enforceClassRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  address: RateLimitConfig,
  perCaller: RateLimitConfig,
  sealedGuest?: `run:${string}`,
): Promise<boolean> {
  const callerId = await admitAddressThenCaller(req, res, address);
  if (callerId === false) return false;
  return enforceRateLimit(req, res, perCaller, callerId ? `user:${callerId}` : sealedGuest);
}

/* -------------------------------------------------------------------------- */
/* Per task, beneath a ceiling                                                */
/* -------------------------------------------------------------------------- */

/**
 * Enforce a limit kept per caller and per item (a coding task, a learning-path
 * activity), beneath a ceiling per caller across every item. The caller is the
 * verified account (`user:<id>`), or the client address for a caller without
 * one, as in `enforceClassRateLimit`. The item's bucket is taken first, so a
 * submit refused on one task spends nothing of the ceiling, and another task
 * starts with its own full bucket. Returns false after sending the 429.
 */
export async function enforcePerItemRateLimit(
  req: VercelRequest,
  res: VercelResponse,
  perItem: RateLimitConfig,
  ceiling: RateLimitConfig,
  item: string,
): Promise<boolean> {
  const callerId = await verifiedCallerId(req);
  const caller = callerId ? `user:${callerId}` : clientIp(req);
  if (!(await enforceRateLimit(req, res, perItem, `${caller}|${item}`))) return false;
  return enforceRateLimit(req, res, ceiling, caller);
}

/* -------------------------------------------------------------------------- */
/* Work in flight                                                             */
/* -------------------------------------------------------------------------- */

// A bucket counts requests; it does not count how many of them one caller has
// running at once. A guest's whole grading budget arrived together, thirty
// runaway submits that held every grader thread of the instance while other
// learners' submits waited behind them. The grader threads belong to one
// instance, so this count does too.

const inFlight = new Map<string, number>();

/** How much of one scope's work a caller may have running at once. */
export interface InFlightLimits {
  /** The piece of work this is: a coding task or a learning-path activity. */
  item: string;
  /** At most this many of the caller's on that item. */
  perItem: number;
  /** At most this many of the caller's across every item: the ceiling. */
  perCaller: number;
}

/**
 * Admit one more piece of `scope`'s work for this caller while fewer than
 * `limits.perItem` are running on its item and fewer than `limits.perCaller`
 * on all its items, on this instance. The caller is `identity` (`user:<id>`),
 * or the client address when it is omitted. Returns the function that ends the
 * work, which must be called once it is done, or null when either count is
 * full; the handler then answers 429 with a Retry-After.
 */
export function enterInFlight(req: VercelRequest, scope: string, limits: InFlightLimits, identity?: string): (() => void) | null {
  const callerKey = `${scope}:${identity ?? clientIp(req)}`;
  const itemKey = `${callerKey}|${limits.item}`;
  if ((inFlight.get(itemKey) ?? 0) >= limits.perItem || (inFlight.get(callerKey) ?? 0) >= limits.perCaller) return null;
  for (const key of [itemKey, callerKey]) inFlight.set(key, (inFlight.get(key) ?? 0) + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    for (const key of [itemKey, callerKey]) {
      const left = (inFlight.get(key) ?? 1) - 1;
      if (left > 0) inFlight.set(key, left);
      else inFlight.delete(key);
    }
  };
}

/* -------------------------------------------------------------------------- */
/* One-time claims                                                            */
/* -------------------------------------------------------------------------- */

// A sealed token can be replayed as often as its lifetime allows. Where a
// replay would leak something (a placement round answered again with other
// options reports a different score), the handler claims the token's id once:
// the first claim wins, every later one is refused. Upstash holds the claim
// across instances (SET NX with an expiry). Where Upstash is configured (in
// production it is), a claim it cannot record is not a claim: this instance's
// memory knows nothing of the others, so a replay sent to another instance
// would be graded again. The request is refused with 503 instead
// (`ServiceUnavailableError`). Only without Upstash, as in local development,
// does a per-instance map hold the claim.

type OnceStore = { set: (key: string, value: string, opts: { nx: true; ex: number }) => Promise<unknown> };
let onceStore: Promise<OnceStore | null> | null = null;
const localClaims = new Map<string, number>();

function getOnceStore(): Promise<OnceStore | null> {
  if (!isDistributedRateLimitEnabled()) return Promise.resolve(null);
  onceStore ??= (async () => {
    try {
      // @ts-ignore — optional dependency, resolved at runtime in production
      const Redis = ((await import('@upstash/redis')) as any).Redis;
      return new Redis({ url: UPSTASH_URL as string, token: UPSTASH_TOKEN as string }) as OnceStore;
    } catch {
      return null;
    }
  })();
  return onceStore;
}

/** Claim `key` for `ttlSeconds`. True for the first caller, false while the
 * claim stands. Throws `ServiceUnavailableError` when Upstash is configured
 * and does not record the claim. */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  if (isDistributedRateLimitEnabled()) {
    const store = await getOnceStore();
    try {
      if (!store) throw new Error('once_store_unavailable');
      return (await withLimiterDeadline(store.set(`once:${key}`, '1', { nx: true, ex: ttlSeconds }))) === 'OK';
    } catch {
      throw new ServiceUnavailableError('claim_unavailable', 'This could not be checked right now. Try again in a minute.');
    }
  }
  const now = Date.now();
  if ((localClaims.get(key) ?? 0) > now) return false;
  if (localClaims.size >= 10_000) {
    for (const [claimed, until] of localClaims) if (until <= now) localClaims.delete(claimed);
  }
  localClaims.set(key, now + ttlSeconds * 1000);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The read limit for a GET a script can drive, in the two tiers of
 * `RATE_LIMITS.readAddress` and `readPerUser`. The account is verified once
 * per request (lib/http.ts), so the handler's own check that follows costs
 * nothing more. Returns false after sending the 429.
 */
export async function limitRead(req: VercelRequest, res: VercelResponse): Promise<boolean> {
  const callerId = await admitAddressThenCaller(req, res, RATE_LIMITS.readAddress);
  if (callerId === false) return false;
  return callerId ? enforceRateLimit(req, res, RATE_LIMITS.readPerUser, `user:${callerId}`) : true;
}
