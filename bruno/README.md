# devShark API - Bruno collection

A [Bruno](https://usebruno.com) collection of requests against the twelve
Vercel functions under `api/`. Bruno is a free, offline API client; the
requests are plain-text `.bru` files, so they version with the code and diff
in review.

## Usage

1. Install Bruno (desktop app or the `bru` CLI).
2. Open this folder as a collection.
3. Pick an environment (`Local` = `vercel dev` on :3000, or `Production`).
4. Run a request, or run a whole folder.

CLI:

```bash
# from the repo root
npx @usebruno/cli run bruno --env Local
```

## What the assertions codify

- **`Public/`** - endpoints that must serve anonymous traffic. Each asserts a
  `200` (or, for `Quiz Submit`, simply *not* `401`, since grading is public but
  needs a real session id).
- **`Auth required (expect 401)/`** - the security-relevant half. Every
  auth-gated endpoint (`flashcards`, `user/*`, `roadmap?resource=progress`,
  `play/*`) is hit **without** a Bearer token and asserts `res.status: eq 401`;
  `admin/*` answers 403 `forbidden` (`requireAdmin` in `lib/admin-auth.ts`),
  and its request asserts that. Run the folder before a deploy to catch a
  route that lost its guard. The launch suite exercises these requests against local Auth and PostgREST fixtures.
  Shop and room state accept guests. Cards is retired (410). Billing cancellation accepts signed email links and both webhooks authenticate the payment provider separately. Coding Reset uses the fresh guest `session` from GET `/api/quiz/roadmap?resource=coding-task&id=js-double-numbers` as its `codingSession` collection variable. Checkout lookup uses GET because starting checkout can be disabled globally.
- **`Public/Health.bru`** checks HTTP 200, a working grading runtime and the limiter's current mode. `dependencies.grading` is `ok` when the local QuickJS check passes, `unconfigured` when a production instance lacks its React snapshot ID, or `unavailable` when the local engine fails or misses its deadline. The collection requires `ok`. `dependencies.rateLimiter` is `configured` when Redis answers, `in-memory-fallback` when no Redis is configured locally, or `memory-fallback` when configured Redis cannot be reached. The latter fails this check.

To exercise the authenticated *happy path*, set a `token` var in your
environment (a Supabase access token) and add `auth: bearer` to a copy of the
request - kept out of the committed collection so no real token is stored here.
