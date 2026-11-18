---
name: api-operation
description: Add or change an API operation inside devShark's twelve-handler budget. Use for any new `op=`, `action=` or `resource=` branch, rate limit, auth or Premium gate on a handler under `api/`, and for the launch-contract block that pins it.
---

# API Operation

Use with `shark-product-context`. Every rule below names the file it comes from; read that file before you rely on the rule. `/add-api-op <handler> <op>` (`.claude/commands/add-api-op.md`) scaffolds the three pieces this skill describes.

## The budget

- Keep exactly twelve physical TypeScript handlers under `api/` (CLAUDE.md, "Protected behavior"; AGENTS.md). `main()` in `scripts/test-launch-contracts.ts` enforces it: `assert.equal(apiFiles(join(process.cwd(), 'api')).length, 12, 'Vercel function budget must remain exactly 12')`. `apiFiles` counts every `.ts` file under `api/` recursively, so a helper module placed under `api/` breaks the count. Put helpers in `lib/`.
- A new endpoint is a `resource=` or `op=` branch inside an existing handler (`docs/product-architecture.md`, the paragraph that ends "so the twelve-handler budget is unchanged").
- `vercel.json` `functions` gives `api/**/*.ts` a 10 s `maxDuration` and `api/quiz/roadmap.ts` 45 s. Work that can run past 10 s (grading, sandboxes) belongs on `api/quiz/roadmap.ts`.

## Where an operation goes

Read the handler's `routeHandler` before you add a branch. Each one dispatches differently, and the route-level limit runs before the dispatch:

| Handler | Dispatch key | Route-level limit before dispatch | Add the branch |
|---|---|---|---|
| `api/user/[op].ts` | `op` (the path segment: the client calls `/api/user/<op>`, see `OP` in `client/src/lib/friends.ts`) | `limitUserWrite` for every non-GET except `billing-webhook` and `learning-path-draft`; `limitUserRead` for GETs in `LIMITED_READS` | an `if (op === '…') return …;` line before the `github-` and `friends-` prefix lines; anything else answers 404 `unknown_op` |
| `api/admin/[op].ts` | `op` in a `switch` | `RATE_LIMITS.admin`, then `requireAdmin` | a `case` before `default` (404 `unknown_op`) |
| `api/play/[action].ts` | `action` in a `switch` | an address bucket chosen by action (`playState`, `playCreate`, `playJoin`, `playMutation`), then the `features.multiplayer` switch | a `case`; the action takes its own `…PerUser` bucket |
| `api/quiz/roadmap.ts` | `resource`; `coding-` and `learning-path-` prefixes have their own blocks | none at route level; each branch limits itself | a `coding-` resource goes in the coding block with its own method check; a `learning-path-` resource goes in that block, whose handlers check their own methods (an unknown one answers 404 `not_found`); any other resource is a method and resource branch after both blocks, each with its own limit, as `answer`, `complete` and `eligibility` (`limitRead`) are |
| `api/quiz/questions.ts` | `resource` (GET only) | `enforceClassRateLimit(quizSessionAddress, quizSession)` before every resource except `marketing-source` | after the limit, as `resource === 'curation'` is |
| `api/quiz/challenge.ts` | the method, then `resource` | none at route level; the question batch takes the class limit itself | POST `complete` (any other POST answers 409 `automatic_score`); GET `leaderboard`; a GET with no resource or `assessment` serves the batch (`handleQuestionBatch`); any other GET resource answers 404 `unknown_resource`; other methods answer 405 with `Allow: GET, POST` |
| `api/quiz/submit.ts` | `resource=report` on POST, before the method check | `RATE_LIMITS.quizSubmit` for grading; `handleReport` takes `enforceClassRateLimit(questionReportAddress, questionReport)` itself | beside `handleReport` |
| `api/quiz/daily.ts` | the `qotd` query parameter | the class limit, after the `qotd` branch | beside `handleQuestionOfTheDay` |
| `api/leaderboard.ts` | `period` | `RATE_LIMITS.readAddress` | a period branch |
| `api/flashcards.ts` | the method alone | the flashcard pair on writes | prefer another handler |
| `api/settings.ts` | none (public GET, cached) | none | a new field in the body; `tests/fixtures/api-settings.json` must match it (`retiredSupportContracts` in `scripts/test-launch-contracts.ts`) |
| `api/health.ts` | none | none | add nothing |

## The operation itself

Model a new op on `handleLeaderboardVisibility` in `api/user/[op].ts` and `handleFlashcards` in `api/flashcards.ts`:

1. Export the function and take the database client as a parameter (`db: SupabaseClient | null`), so a contract can call it with a stand-in.
2. Refuse other methods with `res.setHeader('Allow', '…')` and `jsonError(res, 405, 'method_not_allowed', 'Method not allowed')`.
3. Verify the caller with `requireAuthSub` or `requireAuthResult` from `lib/http.ts`; both send the 401 themselves and return null. Use `tryAuthOnce` for a route with a guest branch and `verifiedCallerId` when a guest is treated differently but not refused. Each verifies the token once per request (`verifyOnce`), so the route-level limit and the op share one `auth.getUser` call.
4. Never read the account from the body or query. `requireAuth` in `lib/auth.ts` trusts a client `user_id` only when Supabase is unconfigured and never in production; `scripts/test-verified-caller.ts` proves that a token for A with a `user_id` of B touches A's rows.
5. Answer `jsonError(res, 503, 'not_configured', …)` when the client is null.
6. Scope by subject where the data is per subject: `isScopeSubject` and `deploymentSubjectIds()`, else 400 `invalid_subject_scope` (`api/flashcards.ts`).
7. Wrap every Supabase call in `withTimeout` (5000 ms by default, `lib/http.ts`). It rejects with `UpstreamTimeoutError`, a `ServiceUnavailableError` with the code `upstream_timeout`. A `catch` in the op must rethrow it or answer it with 503 and its own code, as `api/flashcards.ts` does, never fold it into a 500. Answer a database error with `jsonError(res, 500, 'db_error', …)`. A routine a pending migration adds reads as missing through `isRpcMissing(error)`: fall back to the older routine, or answer 503 `migration_required` as `handleLeaderboardVisibility` does for its column.
8. Compute shared per-request values once with `requestMemo(key, compute)` (`lib/http.ts`).
9. `withRequestContext` sets `Cache-Control: private, no-store` on every answer before the handler runs (`lib/http.ts`; `docs/product-architecture.md`, "Caching"). An op about a person sets the same header itself after auth, `res.setHeader('Cache-Control', 'private, no-store')`, as `handleLeaderboardVisibility` does: a contract calls the op directly, outside `withRequestContext`, and can then assert the header. Only a public answer sets a cacheable header, as `api/settings.ts` does.
10. Return errors in the envelope `jsonError` builds, `{ error: { code, message, requestId } }`. A thrown `PremiumRequiredError` becomes 402 and a thrown `ServiceUnavailableError` (a timeout included) becomes 503 with its own code in `withRequestContext`, logged at level error; an escaped `AuthError` answers its own status (401 for a refused token, 503 or 504 when Supabase Auth is down or slow); any other throw becomes 500 `internal_error`. An op that answers the refusal itself sends the 402 envelope with `jsonPremiumRequired(res, error)` (`lib/http.ts`), as `refuseLocked` does in `lib/access.ts`. Log with `createLogger(route)` or `logEvent`, never the request body (the doc comment on `withRequestContext` in `lib/http.ts`: "without logging request bodies").
11. If the learner sees your new error code, map it in `CODE_KEYS` in `client/src/lib/api.ts` to an English key in `client/src/i18n/translations.ts`.
12. A GET or HEAD may be answered from the instance's token cache: a token Supabase Auth accepted within the last 60 s (`VERIFIED_TOKEN_TTL_MS` in `lib/auth.ts`) is trusted without another Auth call. Every other method asks Auth. A GET that grants, settles or writes something on the caller's behalf (the wallet, the admin API) calls `requireFreshAuth(req)` before anything verifies the request (`docs/product-architecture.md`, "Token checks across requests").
13. Load heavy modules on first call. In `api/user/[op].ts` and `api/quiz/roadmap.ts` an op family that pulls in the coding catalogue, a grader, TypeScript or Stripe is imported through `lazyExport` (`lib/http.ts`), never statically. `npm run test:performance` (`scripts/cold-start-contracts.ts`) fails when a handler loads one of them at import.
14. A public answer that is the same for every caller gets `s-maxage` and `stale-while-revalidate` so the CDN shares it, and its URL goes into `isPublicRead` in `client/src/lib/api.ts` so the browser sends it at once without a token. Take it out of that list the moment the handler reads the caller. An answer that depends on the caller stays `private, no-store`.

## Premium gates

- `shared/tiers.ts` says what each tier opens; the server refuses with 402 and the client mirrors it (CLAUDE.md, "Protected behavior").
- Call `refuseLocked(res, userId, content, { cleared })` from `lib/access.ts` where the learner starts the content. It sends the 402, or 503 `entitlement_unavailable` when the tier cannot be read, and returns true; return at once when it does. Free content costs no query, and a guest holds the free tier (the header comment of `lib/access.ts`).
- A file that imports `shared/tiers` or `lib/access`, or calls `refuseLocked` or `resolveTier`, must be listed in `tierReaders` in `tierContracts()` (`scripts/test-launch-contracts.ts`). `lib/coding/grade.ts`, `api/leaderboard.ts`, `api/quiz/submit.ts`, `api/play/[action].ts`, `api/quiz/daily.ts` and `api/quiz/challenge.ts` grade or rank and must never read a tier.

## Rate limits

- An entry in `RATE_LIMITS` (`lib/rate-limit.ts`) is `{ key, capacity, refillPerSecond }`; the object `satisfies Record<string, RateLimitConfig>`. The `key` is a unique snake_case bucket namespace. Write a comment above the entry that says why the number is what it is, as the existing entries do.
- Pick the limit in this order:
  1. The route-level limit already covers the op (a write to `api/user/[op].ts`, a play action, a questions resource, an admin op). Add no entry.
  2. A GET a script can drive takes `limitRead` (`RATE_LIMITS.readAddress`, then `readPerUser`). In `api/user/[op].ts` add the op to `LIMITED_READS`.
  3. Expensive, guessable or third-party work gets its own pair: `<name>Address` sized `SHARED_NETWORK_SEATS * n` for a class behind one NAT, and `<name>` for the caller, taken with `enforceClassRateLimit(req, res, RATE_LIMITS.<name>Address, RATE_LIMITS.<name>)`. Per-item work (a task, an activity) uses `enforcePerItemRateLimit`.
- An identity passed to `enforceRateLimit` is `` `user:${verifiedId}` ``, or `` `run:${runId}` `` for a guest's sealed Challenge run. `main()` in `scripts/test-launch-contracts.ts` scans every `enforceRateLimit(req, res, RATE_LIMITS.x, identity)` call under `api/` and `lib/` for that shape.
- Upstash holds the limit across instances when its two variables are set; the in-memory bucket is the fallback (the header comment of `lib/rate-limit.ts`). The contracts run on the fallback.

## The launch-contract block

`scripts/test-launch-contracts.ts` asserts handler source text, so a new op needs a block there or in a sibling module it imports (`productCleanupContracts` in `scripts/product-cleanup-contracts.ts`, `vercelRoutingContracts` in `scripts/vercel-routing-contract.ts`). The template is in [references/contract-block.md](references/contract-block.md). A block holds three parts, all modelled on `leaderboardVisibilityContracts()`:

1. **Placement.** `route.indexOf('<the exact dispatch line>')` lands after the route-level limit line. The assertion matches text byte for byte, so the dispatch line in the handler and in the contract must be identical.
2. **Behaviour against a stand-in.** Call the exported op with a fake `db`, a `mockResponse()`, and `user_id` in the query. `scripts/launch-test-env.ts` removes the Supabase variables, so `requireAuth` takes that `user_id` as the caller. Assert 401 for a guest, 405 with `Allow`, 400 for a bad body on a write, the 200 body, and the `cache-control` header the op sets (step 9).
3. **The limit.** Spend `RATE_LIMITS.<name>.capacity` tokens from one account, assert the next answers 429, and assert a second account still passes.

Register the block with `await <name>Contracts();` in `main()` beside `await leaderboardVisibilityContracts();`. An op that reads or writes one account's rows also gets a case in `scripts/test-verified-caller.ts` ("a token for A with a user_id of B acts for A").

Before you edit near an existing branch, grep the contracts for the line: `grep -n "api/user/\[op\].ts" scripts/test-launch-contracts.ts`. `leaderboardVisibilityContracts()` and `identityContracts()` pin the `limitUserWrite` line and their dispatch lines; the leaderboard block pins `api/leaderboard.ts` cache headers and `RATE_LIMITS.leaderboardPersonal`; the AI guard pins that `api/quiz/submit.ts` routes no `explanation` or `hint` resource; no file under `api/` may write `user_activity_days` or call `add_activity_day`.

## CSP hosts

- A server-side fetch from an op needs no CSP change. A browser request to a new origin does.
- The app's CSP is the first header route in `vercel.json` (`src` `^/(?!assets/coding-worker/|sandbox/).*$`). Add the exact host to `connect-src`, and to `script-src` or `frame-src` for an embed, and add it to `APP_POLICY` in `scripts/check-security.mjs` in the same commit.
- `scripts/check-security.mjs` holds the app policy as `APP_POLICY`, directive by directive, and fails when `vercel.json` adds, drops or repeats a directive or a source, or when `script-src` lacks the hash of an inline script in `client/index.html`. Whatever the table says, it refuses a source that lets every host in (`*`, a bare scheme such as `https:`, or `scheme://*`; `OPEN_SOURCE_EXCEPTIONS` names the one left, `img-src https:`), an unsafe keyword other than `'unsafe-inline'` in `style-src`, and a PostHog host in any policy. The sandbox frame stays network-less.
- `npm run check:security -- --dist` checks every inline script of the built pages against the policy each page is served with. `-- --url=<deployment>` compares nine deployed paths with the status and headers `vercel.json` gives them; a preview needs a share link (`?_vercel_share=<token>`, from the Vercel MCP `get_access_to_vercel_url`) or `VERCEL_AUTOMATION_BYPASS_SECRET`.
- `consentContracts()` in `scripts/test-launch-contracts.ts` fails when `vercel.json` names `googletagmanager`, `google-analytics`, `connect.facebook.net` or `facebook.com/tr`, and while `MARKETING_LOADERS` in `client/src/lib/marketingTags.ts` is not the empty array. It checks no other host. Marketing tags go through `MARKETING_LOADERS` behind consent (CLAUDE.md, "Protected behavior").

## Validation

```sh
npm run typecheck:api
npm run typecheck:scripts
npm run test:launch
npm run check:security
npm run test:performance
git diff --check
```

- `typecheck:api` proves `api/`, `lib/` and `shared/` compile under `tsconfig.json` (strict). It does not read `scripts/`.
- `typecheck:scripts` proves the contract block compiles (`tsconfig.scripts.json` includes `scripts/**/*.ts`). `test:launch` bundles with esbuild, which strips types without checking them.
- `test:launch` runs `scripts/test-launch-contracts.ts` (the handler count, placement, behaviour and limit blocks, `vercelRoutingContracts`), `scripts/test-play-rooms.ts` and `scripts/test-verified-caller.ts`.
- `check:security` proves the `vercel.json` CSP and security headers still hold.
- `test:performance` runs `scripts/test-settings-cache.ts` and `scripts/test-request-timing.ts`: the settings cache and the `Server-Timing` wrapper every handler runs inside.

Report each command's real result. A command you did not run is "not run", never a pass.
