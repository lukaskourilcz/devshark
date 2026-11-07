# devShark

An English developer-learning product (subject `webdev`) at https://devshark.app, built from one React/Vite client and twelve serverless handlers. devShark is freemium: every account gets HTML, CSS and JavaScript, React levels 1 to 12, DSA Foundations levels 1 to 5, the opening stages of every coding project (stages 1 to 3 of a ten-stage project) and a starter set of coding challenges. Premium (4.99 EUR a month or 59.88 EUR a year, before VAT) opens the rest. `shared/tiers.ts` holds that split, and `shared/launch-offer.ts` holds the launch offer, which shows only while its window, the billing setup and the coupon allow it. Stripe checkout is built but switched off; Premium opens today through vouchers. The server owns answers, grading, scores, XP and what each account may open. devShark ships no AI feature and makes no certification or hiring claims.

StudyShark, which once shared this code, lives in its own repository (`lukaskourilcz/studyshark`); nothing here builds or promotes it.

Content counts come from `shared/subject-catalog.ts`, `shared/coding-index.ts` and the review registries. `npm run content:snapshot` prints the authored, served, issued and free inventory. The system design coding tasks stay hidden until the owner decides to publish them.

## Learning features

- **Learn**, in three sections (`shared/learn-sections.ts`): Web Developer, Software Engineer and Forward Deployed Engineer. Guided levels with checkpoints, prerequisites and **spaced mastery**: a level is "cleared" on its first pass and "mastered" only after three correct passes on three separate days. DSA Foundations and DSA Advanced are Learn topics of Software Engineer; the old DSA path addresses redirect there.
- An auto-composed **Today** queue that folds carried-over work, due-for-review levels and new material into one daily plan.
- Solo quizzes, a daily challenge, the survival Biggest Shark Challenge, live multiplayer and classroom rooms, and leaderboards that rank the last 30 days by default.
- A public **question of the day** at `/daily`: one question a day from a track that rotates by date, checked on the server without an account and recorded nowhere. Each day has its own page (`/daily/<date>`) and share image.
- Share moments: the invite link after a first passed Learn level and after a Challenge run, a result card after a Challenge run, a finished Learn topic and a completed learning path, and a link-preview image per coding task.
- **Adaptive placement** that steps difficulty up and down over short rounds.
- **Forgiving streaks** (two free protections a month, spent on a missed day or in advance as a 48-hour shield) and a read-only **study advisor**.
- A **typing racer** and Shark Cards, the questions a learner saved to review.
- The **Forward Deployed Engineer** learning path, a role specialization on top of the learner's Fullstack, Frontend or Backend track: fourteen modules, a staged capstone and an interview-prep shelf. It grades through the existing server sandbox, keeps verified checks apart from self-reviewed writing, and shares the task and XP ledger with Coding, so a reused task cannot earn a second first-pass award. Production keeps it off until the owner sets `LEARNING_PATH_FDE_ENABLED=true`.
- **Coding** across JavaScript, TypeScript, React and Algorithms, labelled Easy, Medium or Hard and graded on the server (QuickJS sandbox, the TypeScript compiler, an isolated Vercel Sandbox for React). Hint ladders are authored and end in documentation. Every graded task carries a junior and a senior solution that open after a verified pass. Thirteen evolving projects and fifteen short paths hold the multi-stage work, three of them debugging paths built on `console.log` and tracing before fixing. Coding tasks also sit inside Learn levels, a signed-in learner can plan a **challenge run** (track, count, order) for a date and time, and the optional **GitHub garden** commits every passed task to the learner's own repository.
- **Premium and coins**: Premium opens every Learn topic, every coding task and the FDE path once it is on. Coins, earned from verified learning, buy the crown and streak protections for every account. Merchandise is paused behind `MERCH_ENABLED`. An invite link pays both friends coins.

## Tech stack

- **React** 19 with **React Router** 7: the client's interface and routes.
- **TanStack Query**: caches the client's server data.
- **Vite** 6: builds and serves the client; at build time it also writes the public page heads and draws the share images with **Satori** and **resvg** (dev-only packages).
- **TypeScript**: the client, the twelve API handlers and the shared code; its compiler also runs the type tests of TypeScript challenges.
- **Node.js 24**: the supported runtime, used by CI.
- **Vercel**: hosts the client and the twelve serverless functions (region `arn1`) and deploys from `main`.
- **Astryx** (`@astryxdesign/core` 0.1.6): the design system; the product's CSS tokens live in `client/src/styles/astryx-theme.css`.
- **Docker** and **GitHub Packages**: `ghcr.io/lukaskourilcz/devshark` runs the client and the twelve handlers in one Node container for local demos and self-hosting, and `@lukaskourilcz/coding-evaluator` publishes the Run-button evaluator to npm (`docs/packages.md`).
- **QuickJS**: a WebAssembly sandbox that runs submitted JavaScript and TypeScript on the server.
- **Vercel Sandbox**: an isolated VM, restored from a snapshot with no network, that runs React challenges in the self-hosted React harness.
- **CodeMirror**: the code editor in the browser.
- **Vitest**: the client's unit tests.
- **Playwright**: the responsive and browser checks in CI.
- **Supabase** (project in `eu-north-1`): Postgres, Auth, Row Level Security, RPCs and Realtime; scores and grading stay on the server. Preview deployments share the production project.
- **GitHub App (the garden)**: optional; commits passed coding tasks to the learner's own repository through installation tokens. No user token is stored, and the learner can disconnect from the profile.
- **Stripe** (built, switched off with `BILLING_ENABLED=false`): Checkout with Managed Payments, Billing and the Customer Portal. The server uses the `stripe` package; the checkout page loads Stripe.js from Stripe and mounts Stripe's payment iframe, so card data never reaches devShark. Stripe (as Link) is the seller of record. A payment changes which content an account may start, never grading or scores.
- **Spreadshop (sprd.net AG)**: prints and ships merchandise. Paused behind `MERCH_ENABLED`; the server reads the shop's monthly promotion when `SPREADSHOP_API_KEY` is set.
- **Resend**: optional; sends the cancellation page's confirmation link when `RESEND_API_KEY` is set. Without it, cancellation there needs sign-in.
- **Upstash Redis**: rate limiting on the API, with an in-memory fallback for local and preview use.
- **Sentry**: client and server error monitoring.
- **PostHog**: product analytics, loaded only after analytics consent.

## Third-party libraries

- `react-syntax-highlighter`, `devicon`: code and technology visuals.
- `quickjs-emscripten`, `typescript`, `@codemirror/*`, `sucrase`, `prettier`: grading, type checks, the editor, the React harness and formatting.
- `qrcode`, `motion`: sharing and restrained animation.
- `stripe`: server-side Checkout, the portal, webhook signature checks and subscription sync.

## Marketing

No marketing runs from this repository and nothing here posts to social media. The read-only marketing-source export (`lib/marketing/source.ts`) stays inactive because `DEVSHARK_MARKETING_EXPORT_SECRET` is not set in any environment. Shipped growth features are the UTM capture on the first pageview, `/daily`, the share images and referral links.
