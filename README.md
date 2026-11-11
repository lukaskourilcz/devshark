# devShark

devShark is a learning platform for web developers: guided Learn paths, quizzes, coding challenges, learning paths and a career roadmap across frontend, backend, databases, DevOps, testing, security, system design and AI.

devShark has been freemium since 25 September 2026. Every signed-in account gets HTML, CSS and JavaScript in full, React levels 1 to 12, DSA Foundations levels 1 to 5, the opening stages of every coding project and short path (stages 1, 2 and 3 of a ten-stage project, 1 and 2 of a FullStack app, level 1 of a short path), and a starter set of challenges, plus every quiz, the daily challenge, the Biggest Shark Challenge, multiplayer rooms, Shark Cards (questions saved to review later), the typing racer, leaderboards, streaks, friends and the coin shop. Premium costs 4.99 EUR a month or 59.88 EUR a year, before VAT, and opens every Learn topic and coding task, the FDE learning path once its switch is on, and redeeming coins for merchandise once it returns (merchandise is paused until next quarter behind `MERCH_ENABLED` in `shared/rewards.ts`). `shared/tiers.ts` holds both lists, the server answers locked content with 402, and Premium leaves grading, XP amounts, scores, streaks and rankings alone. Stripe checkout is built but switched off (`BILLING_ENABLED=false`); taking payments is the owner's decision (#221, [STRIPE_INTEGRATION_TODO.md](./STRIPE_INTEGRATION_TODO.md)). Until then Premium opens through a voucher code the owner creates in `/admin/vouchers` and a learner redeems on `/premium` (migration 045).

Production: [devShark](https://devshark.app) deploys from `main` to the Vercel project `react-express-app` (functions in `arn1`), with the Supabase project `rvlybcjdpafwyeuojvhl` (`eu-north-1`) for data and identity. Preview deployments share the production Supabase project.

StudyShark, the general-subject product that shared this code, moved to its own repository (`lukaskourilcz/studyshark`) on 2026-09-24. This repository builds devShark only; a build configured for any other product fails.

The web experience uses the Deep End shark identity across the landing page, Learn, Quiz, Challenge, Play, Profile, Flashcards, the career roadmap, dialogs, progress indicators, and the `/dev` control room. It ships in English only, with light and dark themes, keyboard navigation, reduced motion, and responsive mobile/desktop layouts.

Current content comes from `shared/subject-catalog.ts`, `shared/coding-index.ts` and the content audit registries. Run `npm run content:snapshot` for the authored, served, issued and free counts; the registries include every stage of an evolving project and every level of a short path. The system design tasks were reviewed and fixed in #558 and stay hidden until the owner decides to publish them (#391). The DSA Foundations tasks on Algorithms also sit on DSA Learn levels.

## What the app can do

- Guided Learn paths with short levels, checkpoints, adaptive skill checks, prerequisites, saved progress, and server-observed grading — plus spaced mastery (a level goes cleared → mastered over three separate days) and an auto-composed "Today" queue that folds unfinished work, due-for-review levels, and new material into one daily plan.
- Configurable solo quizzes with category, difficulty, and question-count selection; weighted sampling; shuffled answers; bookmarks; question reporting; keyboard controls; and a two-column desktop review.
- A deterministic daily challenge and the timed Biggest Shark Challenge with leaderboards.
- A public **question of the day** at `/daily` (and `/daily/<date>` for each day): one question a day, from a track that rotates by date (`shared/daily-question.ts`), with a server-graded "Check answer" that records nothing for anyone, and its own share image per day.
- Sharing at the moment of success: the invite link after a first passed Learn level and after each Challenge run, and a result card to share or download (the numbers on screen and the date; never a name) after a Challenge run, a finished Learn topic and a completed learning path (`ResultShareActions.tsx`). Every coding task and every day of the question of the day has its own link-preview image, drawn at build time (`client/src/og/ogImages.ts`).
- Live free-for-all matches and host-led classroom rooms using Supabase Realtime with polling recovery, server-side timing, and QR sharing.
- 30-day, all-time, daily and per-topic leaderboards; forgiving streaks (two free protections a month, spent on a missed day or in advance as a 48-hour shield); verified XP; ranks; and coins, earned from verified XP and milestones, that buy the crown and streak protections for every account and merchandise for Premium.
- A read-only study advisor that names your weakest areas from your own results, and a touch-typing racer (accuracy-gated, WPM earns stars, private on-device best).
- A Coding section across JavaScript, TypeScript, React and an Algorithms interview track (system design stays hidden pending the owner's decision): server-graded submissions (QuickJS sandbox, real TypeScript type tests, an isolated Vercel Sandbox for React), authored hint ladders ending in documentation, three debugging paths that teach the console as a tool, Easy, Medium and Hard labels projected from the tier ladder, coding tasks inside Learn levels, and an optional GitHub garden that commits every passed task to the learner's own repository.
- One optional learning path, graded through the existing server sandbox: the **Forward Deployed Engineer** role specialization that sits on top of the chosen Fullstack/Frontend/Backend track. Its guided loop is fourteen modules, M01 Customer discovery to M14 Codify the pattern, then the staged capstone C01; M02 completes with any nine of its twelve cases (migration 066). An optional interview-practice shelf (IP01–IP04) sits beside the loop and never counts toward completion. The diagnostic and M01 are free; the rest is Premium. Production keeps the path switched off until the owner sets `LEARNING_PATH_FDE_ENABLED=true`; the release verification (#510) is recorded in `docs/release-acceptance.md`. Verified checks stay visibly apart from self-reviewed writing. Verified code uses the same canonical task and XP ledger as Coding, so a reused task cannot earn a second first-pass award. The path claims no certification. DSA Foundations (growth classes, arrays, maps, stacks, queues, linked lists, recursion, search, sorting, trees) is a Learn topic of the Software Engineer section; the standalone DSA path retired in #496 and its old addresses redirect to that topic.
- Shark Cards: a question a learner missed, saved under its explanation and reviewed later as a card with the answer, the explanation and a link to its Learn level.
- Google sign-in through Supabase Auth, cross-device progress, profile settings, and permanent account deletion.
- Premium billing through Stripe Checkout, the Customer Portal and a two-step cancellation page, built and switched off; merchandise printed and shipped by Spreadshop (sprd.net AG), paused behind `MERCH_ENABLED`; and invite links that pay both friends coins once the invited one passes a first Learn level.
- Sentry monitoring and PostHog analytics. Every optional integration is gated and disabled by default. devShark ships no AI feature.
- An owner-only `/admin` workspace with Users, Vouchers and Emails: accounts and sign-ins, Premium end dates, redeemed vouchers, editable voucher limits and actual automatic-email previews.
- A role-gated `/dev` control room for question CRUD/overrides, importance tuning, quality checks, report triage, auth logs, feature and coin settings, and the merchandise quotes, monthly caps and fulfilment queue.

Correct answers are not sent with unanswered questions. Quiz and learning sessions use authenticated AES-256-GCM envelopes, submissions are claimed once in Postgres, result receipts are idempotent, and competitive/progression mutations are performed through service-only APIs and atomic database functions.

## Tech stack

| Layer | Current implementation |
|---|---|
| Web client | React 19.2, TypeScript 5.9, Vite 6.4, React Router 7.18 |
| Design and motion | Astryx Design 0.1.6, product CSS tokens, Motion 12 |
| Server state | TanStack Query 5.101 |
| Backend | 12 Vercel Node/TypeScript serverless handlers |
| Data and identity | Supabase Postgres, Auth, Row Level Security, RPCs, Realtime |
| Rate limiting | Upstash Redis when configured; bounded in-memory fallback for local/preview use |
| Payments | Stripe 22 on the server only (Checkout, Billing, Customer Portal), off until `BILLING_ENABLED=true` |
| Observability | Sentry 10 and PostHog, both opt-in |
| Other client capabilities | QR generation, lazy Prism syntax highlighting, Web Share/download fallbacks |

Node.js **24** is the supported runtime and the one CI uses (`engines` accepts 22–24). Vercel serves `api/` and the Vite SPA.

## Architecture

```text
React/Vite SPA
  ├─ Supabase Auth session + Realtime room channels
  └─ authenticated /api requests
       └─ 12 Vercel functions
            ├─ product and subject validation
            ├─ request limits, timeouts, structured errors/logs
            ├─ encrypted quiz/learning session verification
            └─ service-role calls to Supabase
                 ├─ RLS-protected tables
                 └─ atomic scoring/progression/leaderboard RPCs
```

Static questions are merged with cached `/dev` overrides. The product is always devShark and the subject always `webdev`; `VITE_PRODUCT`/`VITE_LOCK_SUBJECT` may name them, and any other value fails the build.

## Repository map

```text
api/                         12 Vercel handlers
  admin/[op].ts              admin question, report, log, quality, settings operations
  play/[action].ts           create/join/state/control/answer/distribution/heartbeat
  quiz/*.ts                  questions, submit, daily, challenge, roadmap (+ coding tasks)
  user/[op].ts               stats, XP, streaks, auth events, account deletion, coding progress, GitHub garden
client/src/                  React application, design system, stores, i18n
client/src/coding/           coding workbench, editor, runner worker, React harness hook
client/sandbox/              self-hosted React grading iframe
lib/                         server auth, tokens, bank loaders, stores, rate limits
lib/learning-paths/          learning-path catalogue, content and grading
lib/marketing/               the read-only marketing-source export (inactive)
lib/coding/                  coding catalogue, solutions (server-only), sandbox, grading
lib/billing/                 Stripe checkout, portal, webhook, subscription sync, public cancellation
lib/rewards/                 coins, invitations, merchandise orders, the Spreadshop promotion
lib/github-app.ts            GitHub App JWT, installation tokens, garden commits
shared/                      product and subject registry, coding catalogue types and browser index
supabase/supabase-schema*.sql         baseline plus migrations through 066
docs/                        product architecture, release acceptance, runbooks, content audits
packages/coding-evaluator/   the Run-button evaluator, published as an npm package (docs/packages.md)
docker/                      the Node server and handler bundler behind the container image
scripts/test-launch-contracts.ts
scripts/test-coding-content.ts        content contract: solutions proven, payloads answer-free, difficulty labels, Easy-band coverage matrix
scripts/test-harness.ts               React sandbox protocol check, driven in a real browser
scripts/import-interview-prepper-progress.ts   one-time owner import
```

## Local development

Prerequisites: Node 24, npm, Vercel CLI, and a Supabase project.

```sh
npm run install:all
cp client/.env.example client/.env.local
npm run dev
```

`npm run dev` starts `vercel dev` on port 3000 so the SPA and `/api` routes behave like production. For UI-only work, run `npm run dev --prefix client`.

Before a release:

```sh
npm ci
npm ci --prefix client
npm audit --omit=dev
npm audit --omit=dev --prefix client
npm run typecheck:api
npm run test:launch
npm run build
git diff --check
```

Before merging, run the CI checks locally with `npm run ci:parity` (`--fast`, `--only <steps>`, `--list`). `main` merges only through a pull request with the `verify` and `sql` jobs of `.github/workflows/quality.yml` green.

### Docker and packages

The same product runs in one container: `docker build -t devshark .` then
`docker run -p 3000:3000 -e SESSION_SECRET=<32+ characters> devshark`. The image and the
`@lukaskourilcz/coding-evaluator` npm package are published to GitHub Packages;
[docs/packages.md](docs/packages.md) covers both, including a local Supabase.

## Required configuration

Copy [client/.env.example](./client/.env.example) and configure secrets in Vercel, never in committed files.

Production requires:

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and server equivalents where used.
- `SUPABASE_SERVICE_ROLE_KEY` — server only.
- `SESSION_SECRET` — at least 32 random bytes.
- `VITE_PRODUCT=devshark`, `VITE_LOCK_SUBJECT=webdev`, `PRODUCT_ID=devshark` and `PRODUCT_SUBJECT=webdev` (or leave them unset; they may not name anything else).
- `ADMIN_EMAILS` or Supabase `app_metadata.role=admin` for `/admin` and `/dev`.
- Google OAuth origins and callback URLs for every production domain.
- All migrations through **`supabase/supabase-schema-066.sql`**, in numeric order.

Strongly recommended for a public deployment:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- An external monitor for `GET /api/health`.
- `VITE_SENTRY_DSN` and/or `VITE_PUBLIC_POSTHOG_KEY` only after privacy configuration is approved.

The FDE learning path is off unless the deployment says otherwise: set `LEARNING_PATH_FDE_ENABLED=true` to open it. It opens only when its switch is on, its content validates and migration 026 is installed; anything else is previewable and says which of the three is missing. `LEARNING_PATH_DSA_ENABLED` belonged to the retired DSA path and is no longer read; remove it from a deployment that still sets it.

Selling Premium needs `BILLING_ENABLED=true` plus `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_ANNUAL` and `STRIPE_MANAGED_PAYMENTS`; `STRIPE_COUPON_LAUNCH` adds the launch offer. [STRIPE_INTEGRATION_TODO.md](./STRIPE_INTEGRATION_TODO.md) lists the configured resources and the gates before sales open. `RESEND_API_KEY` with `RESEND_FROM` belongs with them: the public cancellation page emails its single-use confirmation link through Resend, and without it only someone signed in with the subscription's address can cancel there. `STRIPE_PRICE_PREMIUM_LEGACY` lists earlier Premium Prices after a price change. `SPREADSHOP_API_KEY` with `SPREADSHOP_SHOP_ID` (the monthly shop promotion) is optional. The GitHub garden needs `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` (PEM or base64), `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` (the app's OAuth client, used once per connect to check the installation belongs to the learner); without all five the profile reports the garden as not enabled.

## API surface

The twelve physical handlers multiplex related operations to stay within the deployment budget. The two routers load each family of operations on its first call, so a new instance starts without the coding catalogue, the graders or TypeScript; `docs/product-architecture.md` ("Deployment" and "Sign-in, caching and limits") has what each one loads, caches and checks:

| Handler | Purpose |
|---|---|
| `/api/quiz/questions` | Standard/review question sessions |
| `/api/quiz/submit` | One-time grading, result proofs, and reports |
| `/api/quiz/daily` | UTC daily session; the public question of the day (`?qotd=<date|today>`) |
| `/api/quiz/challenge` | Challenge batches, scoring, completion, leaderboard |
| `/api/quiz/roadmap` | Structure (the public Learn map, shared by the CDN for a minute), attempts, answers, completion, adaptive placement, the progress read (the retired progress PUT answers 405); coding tasks (a free task's brief is a public read the CDN shares for an hour, apart from the caller's part), submissions, reports, and reveals; the learning-path catalogue (shared by the CDN for five minutes), activity start and submit |
| `/api/play/[action]` | Multiplayer and classroom lifecycle |
| `/api/leaderboard` | 30-day, all-time, daily, and category boards |
| `/api/flashcards` | Shark Cards: save, list and remove the questions a learner saved |
| `/api/user/[op]` | Stats, category stats, XP, streaks, badges, streak freezes, the retired card packs (410), study advisor, auth events, deletion; the plan (`entitlement`), voucher redemption (`voucher`), Stripe checkout, portal, webhook and public cancellation; the coin wallet, shop, orders, invitations and merchandise fulfilment; coding progress and drafts; learning preference, path enrollment, progress and drafts; GitHub garden connection, repository, sync, disconnect |
| `/api/admin/[op]` | Role-gated control-room operations, including manual Premium grants (`entitlements`) and Premium vouchers (`vouchers`) |
| `/api/settings` | Public safe configuration |
| `/api/health` | Database, service-role migration, and limiter readiness |

## Database and operations

Apply `supabase/supabase-schema.sql`, then numbered migrations in order through 066 (each file's header says what it adds; `docs/release-acceptance.md` records how each was verified). Migration 023 adds the one-time submission ledger, subject-scopes multiplayer and flashcards, hardens service-only functions and leaderboard identity, makes roadmap answer recording atomic, enforces complete attempts/prerequisites, adds retention helpers, and adds production indexes. Migration 024 adds the daily-habit backing — spaced-mastery pass tracking inside verified roadmap completion, freeze-aware streaks, server-synced badges, Shark Cards, and a hint cache — additively and idempotently. Migration 025 adds coding progress, attempts, drafts, the per-level coding gate, and the GitHub garden connection and commit queue, with the service-only `record_coding_verdict` and `record_coding_reveal` functions.

`npm run test:harness` drives the built React sandbox in headless Chromium and asserts the postMessage contract the workbench depends on: one `ready`, one `done` per run, tokens that keep a superseded run from settling, compile and render errors reported as such, and the fetch stub answering in place of the network. It needs an existing client build and a Chromium (set `CHROME_BIN` if it is not on a usual path); with no browser available it prints a notice and exits 0.

The one-time import of interview-prepper history is `npm run import:interview-prepper -- --input export.json --user-id <id> [--apply]`; it reads a Firestore export, maps the old challenge ids to devShark task ids, and writes passed tasks and attempts without XP or scheduled reviews.

After deployment, schedule `public.purge_expired_learning_data()` with Supabase Cron or another owner-controlled job. Back up before migrations and follow [docs/backup-restore.md](./docs/backup-restore.md).

Operational instructions are in [docs/launch-runbook.md](./docs/launch-runbook.md). Owner actions are tracked in [NEEDED.md](./NEEDED.md). Current and projected infrastructure costs are in [scaling.md](./scaling.md).

## Product principles

- `shared/tiers.ts` alone decides what the free tier and Premium open. Premium, coins, cosmetics and merchandise change which content a learner may start, never grading, explanations, XP amounts, scores, ranks or leaderboards; a streak protection changes a streak's day count and nothing else.
- The server owns answers, scoring, progression, and public identity labels.
- Anonymous local learning remains useful; account-backed competitive and classroom features require sign-in.
- devShark ships no AI feature. Coding hints are authored and end in documentation links.
- Native/Expo work is out of scope; the web app stays responsive and accessible.

## Learn sections

Learn is organised into Web Developer, Software Engineer and Forward Deployed Engineer (`shared/learn-sections.ts`). The base track supplies Web Developer, Software Engineer is an opt-in section, and FDE follows the specialization. Topics shared by sections keep one progress record. Each `/learn/:section` route has a public preview; FDE’s path lives at `/learn/forward-deployed-engineer/path`. Inventory is derived from the manifest with `pathInventory`, and current content counts come from `npm run content:snapshot`.

DSA Foundations and DSA Advanced each contain fifteen Learn levels in Software Engineer. Advanced uses the first five Foundations levels as its prerequisite and requires Premium for graded levels and part tests.

## Marketing source export

`GET /api/quiz/questions?resource=marketing-source` (`lib/marketing/source.ts`) is a read-only, paginated export of English question and coding-task sources for an external marketing tool. It answers only a caller that presents `DEVSHARK_MARKETING_EXPORT_SECRET`. No Vercel environment sets that secret, so the export answers 503 and is inactive. This repository holds no social publishing credentials and posts nothing. `npm run test:marketing` checks the producer and its handler against a local database stand-in.
