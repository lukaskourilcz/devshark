---
name: section-code-audit
description: Audit and fix the code behind one product area (a Learn section such as Web Developer, Software Engineer or Forward Deployed Engineer, or Quiz, Play, Profile, Leaderboard) before users arrive. Covers how to split the area, what to look for, how to fix and commit, and the checks to run without browser tests. Learned from the FDE (#563), Web Developer (#564), Software Engineer (#565), Quiz/Play/Profile/Leaderboard (#566), sign-in and sandboxes (#570), rewards and billing (#568) and site and plumbing (#569) audits of 22–23 October 2026, and from the performance and cost audit of the three Learn paths (#587: #590, #591 and the final walk) of 24 October 2026.
---

# Section code audit

Use this when the owner asks for a code review of one area with "find and fix it now". The goal is code that does not break at launch and is faster where it matters. It is not a redesign: keep every API shape, grading rule, tier gate, XP amount and piece of reviewed content as it is unless a bug forces a change, and then change both sides together.

## 1. Map the area before you start

List every file the area owns, then split them into **four disjoint groups** so parallel agents never edit the same file. For one Learn section, split by layer:

| Group | What it holds |
|---|---|
| server-handlers | the `lib/` handler module(s) and only the area's branches in `api/*` routers, plus the SQL it calls (read-only) |
| server-core | grading, validation, the public projection (`catalog`-style allowlists), shared types in `shared/` |
| client-screens | the big screen components, their data hooks in `client/src/lib/`, the area's routes and lazy imports in `client/src/App.tsx` |
| client-parts | smaller views, cards, dialogs, CSS, canvas/share/export helpers |

An area made of several products splits by product instead, as Quiz, Play, Profile and Leaderboard did, and then needs a last round for the shared files (`lib/http.ts`, `lib/rate-limit.ts`, `App.tsx`) that no single group owned.

Area maps known today (check them, files move):

- **FDE**: `lib/learning-paths/*` (not `content/`, `solutions/`), `shared/learning-path*.ts`, `shared/learn-section*.ts`, `lib/learn-lessons/*.ts`, `client/src/components/paths/*`, `client/src/lib/learningPaths.ts`, `learningPathWorkspace.ts`, `pathPortfolio.ts`, `shareCard.ts`, `client/src/components/learn/LessonBody.tsx`.
- **Web Developer** (topics html, css, javascript, typescript, react, nextjs, nodejs, databases, git, general): `api/quiz/roadmap.ts` (Learn levels and the map), `lib/roadmap.ts`, `lib/questions-store.ts`, `lib/quiz-tokens.ts`, `shared/progression.ts`, `shared/tiers.ts` (read, gate logic only), `client/src/components/Roadmap.tsx` (the map), `client/src/components/learn/*` (`LessonRunner.tsx` runs a level), `client/src/lib/roadmap.ts`, and the coding section (`lib/coding/handlers.ts`, `practice-handlers.ts`, `grade.ts`, `client/src/coding/*`, `client/src/components/coding/*`). Question banks `lib/roadmap-questions-*.ts` are content: leave them alone.
- **Software Engineer** (dsa, dsa-advanced, algorithms, system-design, devops, security, databases, git, general): the Web Developer code above, plus `lib/coding/complexity.ts`, `lib/coding/puzzles.ts`, `client/src/coding/CodePuzzle.tsx`, `DesignRunner.tsx` (system design is hidden; review it, do not unhide it), `client/src/components/ui/LessonFigure.tsx` with `shared/lesson-figures.ts`, and `/roadmap` (`client/src/components/CareerRoadmap.tsx`, `client/src/lib/tracks.ts`). The DSA and algorithms tasks (`lib/coding/tasks/dsa*.ts`, `algorithms.ts`) are content. Review only what Web Developer did not already cover.
- **Quiz**: `api/quiz/submit.ts`, `questions.ts`, `challenge.ts`, `daily.ts`, `api/flashcards.ts`, `lib/reports-store.ts`, `lib/concept-review.ts`, `lib/challenge-store.ts`; in the client `Quiz.tsx`, `Challenge.tsx`, `DailyQuestionPage.tsx`, `Today.tsx`, `TypingRacer.tsx`, `Flashcards.tsx`, `PendingQuizResults.tsx`, `client/src/lib/pendingQuizReceipts.ts`, `pendingQuizReplay.ts`, `xp.ts`.
- **Play**: `api/play/[action].ts`, `client/src/components/Play.tsx`, `client/src/lib/realtime.ts` (Classroom rooms included).
- **Profile**: `api/user/[op].ts`, `lib/friends-handlers.ts`, `lib/leaderboard-identity.ts`, `lib/settings-store.ts`, `Profile.tsx`, `FriendsPanel.tsx`, `SharknameCard.tsx`, `client/src/lib/leaderboardVisibility.ts`.
- **Leaderboard**: `api/leaderboard.ts`, `client/src/components/Leaderboard.tsx`, `client/src/lib/utcDay.ts`.
- **Sign-in and accounts** (#570): `lib/auth.ts`, `access.ts`, `entitlements.ts`, `admin-auth.ts`, `auth-events-store.ts`, `topic-grants.ts`, the `authevent` and `delete-account` ops of `api/user/[op].ts`; in the client `auth.tsx`, `emailAuth.ts`, `authLanding.ts`, `authReturn.ts`, `signInDialog.ts`, `supabase*.ts`, `accountData.ts`, `entitlement.ts`, `client/src/components/auth/*`, `AuthButton.tsx`, `SignInButton.tsx`, `RegisterPromptSnackbar.tsx`.
- **Grading sandboxes** (#570): `lib/coding/sandbox.ts`, `react-runner.ts`, `react-isolated.ts`, `react-learner.ts`, `realm-lockdown.ts`, `quickjs-variant.ts`; `client/src/coding/runner/*`, `useReactHarness.ts`. Run `node scripts/build-react-runner.mjs` after changing anything the React guest bundles, or `test:grading-integrity` reads a stale `lib/coding/generated/` bundle.
- **Rewards and billing** (#568): `lib/rewards/*`, `lib/vouchers.ts`, `shared/rewards.ts`, `lib/billing/*`; `Shop.tsx`, `client/src/lib/shop.ts`, `rewards.ts`, `rewardsShop.ts`, `referral.ts`, `streakFreezes.ts`, `voucher.ts`, `Referral*.tsx`, `PremiumVoucher.tsx`, `Collection.tsx`, `PremiumPage.tsx`, `PremiumBillingPages.tsx`, `UpgradeSheet*.tsx`, `LaunchOffer.tsx`, `PremiumCheckoutButton.tsx`, `PlanLine.tsx`, `client/src/lib/billing.ts`, `launchOffer.ts`, `stripeCheckoutForm.ts`. Never change prices, plans, the launch offer or whether checkout is open (#221).
- **Admin and `/dev`** (#569): `api/admin/[op].ts`, `client/src/components/dev/*`, `devApi.ts`, `triageApi.ts`.
- **Public site** (#569): `Home.tsx`, `client/src/components/landing/*`, `TopicLandingPage.tsx`, `topics/TopicArticle.tsx`, `PublicInfoPages.tsx`, `LegalPages.tsx`, `BrandFooter.tsx`, `DailyStaticArticle.tsx`, `landingTopics.ts`, `publicMetadata.ts`, `routeHead.ts`.
- **Consent, analytics, monitoring and the GitHub garden** (#569): `consent.ts`, `analytics.ts`, `marketing*.ts`, `posthogClient.ts`, `sentry.ts`, `sentry-sdk.ts`, `CookieConsent*.tsx`, `lib/marketing/source.ts`, `lib/github-*.ts`, `GithubGardenCard.tsx`, `GithubSettingsPage.tsx`.
- **Shared plumbing** (#569): `lib/rate-limit.ts`, `lib/http.ts`, `request-timing.ts`, `api/health.ts`, `api/settings.ts`, `client/src/lib/store.ts`, `storage.ts`, `queryClient.ts`, `api.ts`, `routePreload.ts`, `routeRecovery.ts`, `client/vite.config.ts`, `vercel.json`, and a read-only pass over the SQL in `supabase/`.

Several areas can run at once on separate branches and worktrees (three did on 23 October). Give each branch a list of files it must not touch, collect every item an agent left because "the file belongs to another branch", and run one small leftovers round after the branches merge (#571 did that for twelve items).

Read `CLAUDE.md`, the area's tests (`client/tests/*`, `scripts/*contracts*.ts`, `scripts/test-*.ts`) and the SQL the handlers call before changing anything.

## 2. What to look for (each one was found real in these audits)

**Server: failures and status codes**
- Timeouts: `withTimeout` rejects with `UpstreamTimeoutError` (503 `upstream_timeout`). A handler's own catch-all must answer it as 503 (the `caughtError` helpers in `api/user/[op].ts` and `api/play/[action].ts`) or rethrow it, never turn it into 500. An Auth outage keeps its 503 or 504, because a 401 tells a signed-in learner their session ended.
- Races on unique keys: two enrols or two first draft saves at once hit `23505` and answered 500. Map the conflict to the existing row or a 409 (`draft_conflict`), or 503 `draft_busy` when the other save is still running. For a new row (a room code), insert and retry on `23505` instead of reading first.
- Bounds the SQL checks again with a raise: a revision over 1,000,000, a `pg_column_size` limit or a huge practice position became 500. Check or clamp every bound before the call, and map the routine's raise to 400 or 413.
- Read errors treated as "nothing there": a failed passed-tasks read re-offered finished work, a failed draft read looked like no draft, a failed room read answered 404. Answer 503, or log it with the request id and flag it (`draftUnavailable: true` on a path start). A failed read that feeds a write must skip the write: a review-state read that returned `[]` reset every concept to its first stage. A failed settings read serves the last good copy.
- An attempt that expired mid-request answers 409 `invalid_session`, and a one-time claim the database cannot take answers 503 `claim_unavailable`, never 500. Check auth before `claimOnce`: a refused token used up a placement round.
- Rate limits for writes a class makes together: a class-sized address bucket plus a per-account bucket through `enforceClassRateLimit` (`questionReportAddress`, `questionReport`), or a class behind one NAT shares one person's budget.

- Auth outages: supabase-js reports a dropped connection as `AuthRetryableFetchError` with status 0, and Auth's own 429 or an unreadable answer as other errors. Answer them 503 `auth_unavailable`, never 401 (it tells a signed-in learner their session ended) and never 403 at the admin gate. Verify a token at most once per request (`tryAuthOnce`, memoised in `lib/auth.ts`).
- Entitlement and cleared-content reads fail closed and say so: a failed read answers 503 `entitlement_unavailable`, never 402 (a lapsed learner is shown the upgrade sheet for work they passed) and never "not Premium" on an admin screen. A "cleared" callback that cannot read throws; `assertOpen` turns the throw into 503.
- Routine errors: never answer with Postgres's raw message. Map each named raise (`unknown_order` 404, `order_not_cancellable` 409) and answer anything else 500 with the generic body, logging the message.
- Admin writes log the admin account that made them (`by`: the verified admin id; the shared admin password was retired on 24 November 2026).

**Server: untrusted input**
- Postgres text and JSONB refuse U+0000, so a draft, Shark Card or report holding it answered 500. Walk the values (not the JSON text, which would also catch code that spells `\u0000` out) and answer 400. Cut user text by code points (`Array.from`), not UTF-16 units, so an emoji is not split.
- `NaN` passes every range test, and a fractional index never matches. Check `Number.isFinite` and `Number.isInteger` on thresholds, weights, answer indexes, figure levels and field caps, and refuse an option index past the options.
- Query parameters can arrive as arrays (`?categories=a&categories=b`): read only a single string or refuse it; `.split()` on an array throws.
- Arrays from the client: refuse entries of the wrong type with 400 (topic ids, puzzle line ids) instead of acting on the rest. Where free text is expected, keep string entries only, never `String(entry)` (`[{}]` became `"[object Object]"`).
- Webhook signatures: compare bytes, and check the length before `timingSafeEqual`; a 64-character non-ASCII header made it throw a `RangeError` and answer 500, which the provider retries forever. A signed body that is not a JSON object answers 400. An unknown `op` value answers 400 instead of falling through to the default action (a misspelt `equip` bought the crown).
- Paged provider lists (Stripe subscriptions, GitHub installation repositories): read every page up to a sane cap; a live subscription behind 20 expired ones was missed.
- Lookups by id on plain objects: use `Object.hasOwn` or a `Map`, or `constructor` and `__proto__` resolve to Object members (`puzzleFor('constructor')`).
- Calendar dates: `2026-02-30` and year 0 parse in JavaScript and fail in Postgres. Booleans: refuse anything but `true` or `false`. Ids: refuse one longer than any real id before it reaches the database.

**Server: speed**
- Independent sequential awaits: run them with `Promise.all` *after* the ownership check, and keep any ordering that guards correctness (read after grading when concurrent submits must see each other). Start the reads a request needs while its one-time claim is taken, but grade only after the claim.
- Reads that a later RPC already returns under its lock: take the value from the RPC (the first pass from `complete_verified_roadmap_attempt_v2`).
- Work repeated per request or per call: cache pure, content-only results in a `WeakMap` keyed by the object or readonly list (the path validator, the coding ladder's tiers). Do not cache anything a test mutates in place. Compute an expensive sort key once before the sort.
- Verify a token once per request: reuse the result the class rate limit already has.
- Public responses the same for every caller: `max-age` alone keeps them out of the CDN. Add `s-maxage` and `stale-while-revalidate` when no caller data is in them (the Learn map: `public, max-age=60, s-maxage=60, stale-while-revalidate=300`).
- Analysers over learner input (the complexity estimator): build no `RegExp` per input name, share one step budget across every pass, memoise per node, and answer "unknown" when the budget runs out. An uncertain answer must never lower XP. Snapshot every authored solution's report before and after a change to prove nothing else moved.
- Fields, tokens or requests nothing reads: grep for a reader and remove both sides if there is none. The sealed `answerProof` cost up to fifty AES-GCM seals per submit; the progress PUT wrote nothing and answers 405 now.

**Server: integrity**
- Never let a response, log or projection carry answer keys, hidden tests or reference solutions.
- Shuffles that can return the answer: a dealt puzzle must never start solved. Redraw, and test the identity shuffle.
- Hardcoded copies of shared constants (a `0.8` threshold): import the constant.

**Client: lost work and account changes**
- Debounced autosaves dropped on unmount, or sent to the activity just opened instead of the one left. Flush on unmount through a latest-callback ref, and route by the id the view was opened with.
- Drafts kept across a voluntary sign-out leak to the next account; drafts wiped on an *involuntary* sign-out lose work. Keep per-account copies on session expiry only, check `accountEpoch()` before any late write, send or announcement (a quiz grade, an XP sync, a Challenge reward), and register the flush with `beforeAccountChange`. Re-read a coding task when the learner signs out on it, so the editor does not keep their code.
- Device copies and stored progress: check the shape before use (`new Set(object)` crashed the Learn page), and never delete a device copy because the server answered "unknown".

**Client: late, double and stale actions**
- Late responses must not change the screen the learner moved to. Use a token, ref or sequence number per request, abort fetches in effect cleanup, and let only the latest read draw (a lookup answered after the search box changed, an older XP sync).
- Double submits: guard Start, Pause, Claim, Submit, Reveal, Next, level completion (focus and visibilitychange can fire together), friend actions and confirm dialogs with a ref, not only a disabled state. `isPending` reaches React a task later than the second click. Keep a row busy until the read that removes it lands.
- Effects keyed on objects that auth replaces on every token refresh (`user`): depend on `user.id`.
- Server state bound straight to a checkbox or select snaps back until the re-read lands: keep a local value and send saves from a queue.
- Realtime and polling: every subscribe returns a working unsubscribe, keep one poll in flight, and key a room component by code and account so moving between rooms remounts it.
- Dates that roll over: a page left open overnight moves to the new UTC day at midnight and when the tab is visible again (`useUtcDay` in `client/src/lib/utcDay.ts`).
- Controlled inputs bound to the URL: React Router updates the URL in a transition, so a search box controlled by it dropped keystrokes. Keep local state and write the URL after.

**Client: accounts and caches**
- Empty the query cache when the account changes, *before* the new account's first render (in `clearAccountData`), not in an effect after it: several keys (`['rewards','wallet']`, `['concept-due']`) carry no account id.
- While the stored session is restored, `isAuthenticated` is false: show Loading, not "Sign in to …" (the wallet, the invite link, Shark Cards).
- A session that replaces another without a sign-out is an account change too. An email link opened while another account is signed in must not act on the signed-in account.
- Consent: send analytics events when they are captured (a batch queued before a withdrawal was sent after it), identify once per consent yes, and scrub Sentry errors, breadcrumbs and traces of query strings, e-mail addresses, tokens and request data.

**Client: states**
- Do not offer "Start" while the enrollment list or the open run is loading or failed. Show a paused enrollment as paused, offer Try again when an activity fails to open, and say a sealed attempt expired instead of re-dealing it.
- Empty data: a trace with no frames threw and replaced the lesson with the error boundary.
- An offline copy belongs to its own tab or board, never the previous one.

**Client: focus and accessibility**
- No page-wide `aria-live` (screen readers re-read everything). A live region mounted with its words is not announced: keep it on the page and change its text. If the region wraps a visible card, let the region carry the card's styles while it has words (an empty wrapper around an absolutely positioned card has no box, and browser checks see it as hidden; this broke the Challenge release spec once).
- Move focus to the opened item, each revealed hint, each new question and the verdict. When a control disables or re-inserts itself (Next on the last step, a moved list item, Submit replaced by the verdict, an answer at time up), move focus to the nearest control that still works.
- Destructive buttons ask first: Reset uses the workbench's inline confirmation and returns focus to Reset; Remove friend uses `BrandedConfirmDialog` and moves focus to the list heading.
- Every button is at least 44px tall. Tabs take one Tab stop and arrow keys. Enter in a lone input submits, as a form would.
- Keyboard shortcuts ignore keys from forms and dialogs inside the screen and never act on a hidden editor.
- Long code tokens wrap at 200 % text and 360 px. End a drag on `pointercancel`.

**Client: loading and bundle**
- Load heavy parts with `lazyShellPart` + `Suspense` + `ShellPartBoundary`, the boundary inside `Suspense` as its doc comment says, and mind React's 300 ms reveal hold (section 3). A static import of the editor pulled CodeMirror (about 173 kB gzip) into a screen that rarely needs it; the Learn level runner, a path's code editor and Prettier now load only when shown.
- Helpers only lazy screens use must not live in a module the main chunk imports, and strings or defaults nothing reads still ship. Measure with `check:bundle`: the waiting-result sender loads only when a result waits.
- Route preload matchers (`routes(...)` in `App.tsx`) match only the paths their routes serve. Skip intent preloads and idle warm-ups when `navigator.connection.saveData` is set, except a left mouse press.
- Stop a browser run or worker when the learner leaves. Memoise heavy, pure children (`LessonView`, rich-text parsing) only where they re-render per keystroke, with stable inputs.
- Canvas and downloads: `roundRect` is missing before Safari 16 and Firefox 112, so fall back to `arcTo`; zero the canvas after export (iOS caps canvas memory); attach the anchor before `click()` and revoke the object URL later.
- Head tags: write `og:url` beside the canonical on client navigation, and read a trailing slash as the same route.

- Shell growth: fixes in modules every page loads (`store.ts`, `queryClient.ts`, `auth.tsx`, `consent.ts`) add bytes. Win them back by moving code only one screen uses into its own module (`rewardsShop.ts`, the lazily loaded `RegisterPromptCard.tsx`, Sentry's init options in `sentry-sdk.ts`), and measure each move: some "trims" grow the gzip size.

## 3. Performance and cost

What the paths audit (#587) measured and fixed. Use it when the owner asks for an area to be faster or cheaper, and keep the rules at the top of this skill: no behaviour, grading, tier, XP or price changes, and every bound written down for the owner.

- **Measure before and after with the same tools.** The baseline harness lives outside the repository in `devshark-perf/`: `server/tools/measure-roundtrips.ts` runs the real handlers in-process against Auth, PostgREST and Upstash stand-ins that answer after 25 ms and counts waves (calls one after another), `measure-coldstart.mjs` and `measure-firstcall.mjs` time each handler's import and first request as CommonJS (what `@vercel/node` ships; an ESM bundle hoists lazy imports and hides the gain), `baseline/client-tools/measure-client.mjs` and `final/tools/walk.mjs` load every page with 120 ms API fixtures at 1280 and 390 px. Run main and the branch in the same session, take the median of three passes, and call anything under about 80 ms noise. In the repository, every answer's `Server-Timing` carries `db_http` and `auth_http` call counts, and `npm run test:performance` pins the cold-start, prelude, round-trip and cache contracts.
- **The token check is the most expensive line.** Every signed-in request used to ask Supabase Auth (`getUser`, one round trip). Reads now trust an acceptance on the same instance for 60 s (`VERIFIED_TOKEN_TTL_MS`); writes, the wallet, admin, billing and deletion still ask (`requireFreshAuth`). Never extend the trust to a write, and write the bound into `docs/product-architecture.md` and `NEEDED.md`.
- **Prelude order.** Check the token while the address bucket answers, then take the caller's bucket: two waves where there were three. The address bucket still decides first, and an address it refused is checked only after its bucket for a minute. `scripts/test-prelude.ts` pins the order.
- **Lazy heavy imports.** A router serves every op from one function, so one static import of the coding catalogue, a grader, TypeScript or Stripe made every op's cold start pay for it (`api/quiz/roadmap.ts` imported in 325 ms; 100 ms once they were lazy). Import op families through `lazyExport` (`lib/http.ts`), load TypeScript on first use, and keep `/api/settings` free of handler modules. `scripts/cold-start-contracts.ts` fails when a handler loads one at import.
- **CDN `s-maxage` only for caller-independent answers.** The Learn map, the path catalogue (`s-maxage=300`), a lesson and a free task's brief are the same for every caller and the CDN shares them. Split an answer when only part of it is per caller (`coding-brief` apart from `coding-state`). Anything that reads the caller stays `private, no-store`.
- **Public reads without the session.** The browser sends the public reads (`isPublicRead` in `client/src/lib/api.ts`) at once, with no token, instead of waiting for supabase-js. A handler that starts reading the caller must leave that list.
- **React's 300 ms reveal throttle.** React commits a Suspense boundary that leaves its fallback no sooner than 300 ms after the last fallback any boundary showed or hid. So a screen drawn through `lazy` + `Suspense` can wait up to 300 ms with its code and data in hand. Start the first page in a transition (`useFirstPageTransition`), and draw parts whose code may already be in from state (`useWorkbench`, the lesson reader) rather than by suspending.
- **Load heavy client tools on intent.** The TypeScript compiler, Prettier, CodeMirror and the React sandbox now load when the learner points at, focuses or presses what needs them, not when the page opens; Sentry loads after the load event and Motion's features never under reduced motion. Start them on the earliest real signal (the last question of a level, the catalogue saying an activity is code) so the wait is gone by the time it matters, and skip idle warm-ups under `saveData`.
- **Reads that wait for nothing.** Start a screen's reads before it renders, beside the hold that waits for the first of them, and skip reads whose answer nothing on the screen shows (the path catalogue while the path is off, approach comparisons after a fresh pass). A short freshness window (progress and the map's XP, one minute; the plan on tab return, five minutes) saves a read per return; each one is an owner trade-off.

## 4. How to work

- Run it as a workflow: four reviewers in parallel on the disjoint groups, each followed by a skeptic that tries to refute every commit and repairs or reverts with *new* commits, then one checks agent. Then a second, smaller round for the issues the first round listed as "not fixed" but that are real. Check the scariest-sounding "not fixed" items yourself first: in the FDE audit, a reported token/attempt TTL mismatch turned out to be 3 h on both sides.
- One fix per commit, right after its cheapest relevant check passes. Message: `fix|perf|refactor|test(<area>): <what and why>`. Agents share the worktree, so commit with `git commit -m … -- <paths>` and never `git add -A`, stash, reset, rebase or push. The owner wants many real commits; never pad.
- Agents that share a worktree can cross commit messages (one commit carried another's message in #568). Before pushing, compare each commit's files with its message; fix a wrong message with `git filter-branch --msg-filter` on the unpushed range, never by rewriting pushed history.
- A CI job that hits its time limit is not always the code: in #568 and #569 GitHub's cache restore stalled for ten minutes before `test:coding` began. Compare the step timestamps with a recent `main` run, then rerun the failed jobs.
- Behaviour fixes get a regression test in the area's existing test file, and the test must fail on the old code.
- Do not edit SQL migrations, reviewed content (`lib/learning-paths/content`, `solutions`, `lib/roadmap-questions-*`, `lib/coding/tasks`, `lib/coding/solutions`), tier gating, XP or copy meaning. Report DB issues that need a migration.
- Comments count: `scripts/test-learning-paths.ts` and `test-launch-contracts.ts` fail if any file under `client/src` *mentions* `lib/learning-paths`, even in a comment.

## 5. Checks (no browser or e2e)

```bash
export PATH=/private/tmp/devshark-codex-node24/node_modules/.bin:$PATH   # Node 24
npm run -s ci:parity -- --only typecheck:api,typecheck:scripts,typecheck:tooling,check:unused,check:security,test:paths,test:path-authority,test:launch,test:client,build,check:bundle --log-dir artifacts/<area>-review
git diff --check origin/main...HEAD
```

Add the area's own suites (`test:coding`, `test:coding-auth`, `test:grading-integrity`, `test:billing` and so on) when the area touches them. Compare `check:bundle` with main's number: the initial load must not grow. On this 8-CPU machine a load average around 15 makes vitest time out; rerun a failing file alone before believing it. Then push, open one PR, wait for `verify` and `sql`, merge with a merge commit and record the result in `docs/release-acceptance.md`.

## 6. Finish

List what was fixed, what was left and why, and add the real open items to `NEEDED.md` (`[owner:ai]` for agent work, `[owner:me]` for decisions).
