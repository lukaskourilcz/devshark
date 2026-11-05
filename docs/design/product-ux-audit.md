# Product routes, states and UX findings

The route and state inventory design and QA work starts from, the standing rule for text on coloured fills, and the findings still open. Routes come from `client/src/App.tsx`; `docs/design/visual-qa-checklist.md` turns them into a QA matrix.

Every route follows the Epic U system (`DESIGN_RULES.md` §10–11, `docs/design/design-system.md`). The route shell sets the width: 1000px for `/`, `/profile`, `/play` and `/play/:code`, 1200px for `/coding/*`, uncapped for `/dev`, and 800px for every other route. Every control is 44px, one `SwimCta` md is the primary, and empty, gate and signed-out states are `StatePanel`. The "Keep / check" column names the shared parts each route draws through.

## Full-platform proposal review — 5 November 2026

The owner requested a new density, hierarchy and focus review after the Coding/Quiz redesign #599. The [interactive before/after HTML](../ux-review-platform-2026-11-05/index.html) contains 27 stable decisions, per-change comments and accept/revise/reject choices. [Research and scope](../ux-review-platform-2026-11-05/REVIEW.md) records native Uizze evidence, measured guest routes and labelled local fixtures; [QA](../ux-review-platform-2026-11-05/QA.md) distinguishes document validation from product acceptance.

These are proposals, not changes to the width/control contract above. The owner-approved Coding first fold is the calibration; original logo, Quiz topic pills/logos and the ocean/sharks stay. Review decisions must precede implementation. Detailed findings live in the linked review, not a second backlog here.

## Owner-comment revision — 5 November 2026

[Round-two HTML](../ux-review-platform-comments-2026-11-05/index.html) replaces the review queue with 11 consolidated topics covering all 16 commented IDs. Accepted items without comments and the rejected proposal are omitted. Before is the first proposal, After is its revision; unchanged accepted work remains the visual baseline. Shared comments apply across related screens without duplicate finding cards. [Scope](../ux-review-platform-comments-2026-11-05/REVIEW.md) and [document QA](../ux-review-platform-comments-2026-11-05/QA.md) record the comparison and separate feedback format. This round changes review documents only.

## Route and state inventory

| Route | Auth | Primary goal and action | Major states | Component | Keep / check |
|---|---:|---|---|---|---|
| `/` | No | Understand the product; choose a learning action | first visit, returning learner, auth failure, home sample | `Home` | Keep `LandingKit` and technical copy; check the hero at 360–1440px. |
| `/today` | Optional | See what to do next | signed out, loading, nothing due, review cards, sections | `Today` | Signed-in sections load as their own chunks inside the route hold. |
| `/quiz` | Optional | Configure, answer, submit, review | setup, loading, active, restored, empty, submit error, graded | `Quiz` | `QuestionShell` and the shared question parts; `PageHeader` on the setup. Keep signed sessions and stable answer geometry; test short phones, code, the review grid, expiry and retry. |
| `/learn/:section?` | Optional | Pick a section and topic; complete levels and checkpoints | section preview, loading, no structure, locked, unavailable level, lesson, active level, grading, completion, failure, skill check | `Roadmap`, `learn/LessonRunner` | Three sections (`shared/learn-sections.ts`); verified grading; the Learn section page pattern; the level runner on `QuestionShell` and `AnswerOptionList`, its own chunk, loaded when a level opens. |
| `/learn/forward-deployed-engineer/path` | Optional | Work through the FDE path | switch off (preview), outline, signed out, enrolled, activity, Premium lock, paused, completed | `paths/*` | Path on only with `LEARNING_PATH_FDE_ENABLED`; free diagnostic and first module. |
| `/learn/big-o`, `/big-o` | No | Read the Big O introduction | reading | `BigOIntroduction`, `BigOPage` | Same lessons as DSA levels 1 and 2. |
| `/challenge` | Optional | Understand the rules; complete a fair timed run | intro, board loading/error, buffering, active, timeout, verified result, share | `Challenge` | `QuestionShell` and `AnswerOptionList`; the setup laid out like the Quiz setup; board-unavailable shown apart from empty. |
| `/typing` | Optional | Run a typing race | ready, racing, finished | `TypingRacer` | Shared fin/waterline racer; reduced motion. |
| `/daily`, `/daily/:date` | No | Answer the question of the day | today, a past day, a future day, checked, share | `DailyQuestionPage` | `QuestionShell` in the 640px column; answer stays sealed until a check; nothing is recorded. |
| `/play` | Sign-in to act | Host or join a free-for-all or classroom room | auth loading, signed out, create/join errors, room code | `Play` | `PageHeader`; Create is the one primary, Join turns primary only with a whole code; `StatePanel` sign-in gate; mobile form wrapping. |
| `/play/:code` | Yes | Participate, host, reconnect, finish | lobby, live, presenter, polling, stale (after three failed refreshes), expired room, result | `Play` | Realtime recovery and server timing; printable QR ticket; quiet timer announcements. |
| `/leaderboard` | No | Compare fair results, last 30 days first | skeleton, empty, error, offline with the last board, empty window, own row pinned, topic filter | `Leaderboard` | `PageHeader`, one 44px control row on the board; mobile cards and desktop table; rank as a number, no medal colours; long names. |
| `/collection` | Yes | Revisit saved questions and coding challenges | signed out, loading, empty, error, populated | `Collection` | `PageHeader`; shelf tabs are never filled; `StatePanel` for signed out and empty; replaces Cards in navigation; difficulty shown as text. |
| `/cards` | Yes | Review the saved-question deck | auth loading, signed out, loading, empty, error, remove error, deck | `Flashcards` | Kept for old links; the deck uses `QuestionActions`; optimistic rollback; keyboard and touch reveal. |
| `/shop` | Optional | See coins and their ledger; buy the crown or a streak protection | signed out, loading/sync, error, owned, unaffordable, at the protection cap | `Shop` | `StatePanel inline` for a visitor; Buy says how many coins are missing. Coins change what a learner owns, never scoring. Merchandise is off (`MERCH_ENABLED`). |
| `/roadmap` | Optional | Understand a practical developer path | empty progress, in progress, complete | `CareerRoadmap` | Developer-specific copy, distinct from `/learn`. `/roadmap/specializations/fde/*` redirects to the FDE path and `/roadmap/paths/dsa-foundations/*` to `/learn/software-engineer?topic=dsa`. |
| `/coding` | Optional | Pick a track; see passed counts and the next challenge | loading (no title until progress arrives), signed out, empty progress, populated, error with retry | `CodingHome` | Tier locks explained in words; no AI affordance; strip and track cards at 360px. |
| `/coding/:track` | Optional | Choose a task by difficulty and tier, or a short path | loading, locked tier, passed/revealed states, empty filter | `CodingTrackScreen` | Non-colour status glyphs; the difficulty filter. |
| `/coding/fullstack` | Optional | Choose a FullStack app or path | loading, populated | `FullStackScreen` | Stage lists by difficulty. |
| `/coding/:track/:taskId` | Optional | Write, run and submit; climb the hint ladder | loading, signed out, locked, running, verdict, hidden-test failure, reveal confirm, offline, draft restore, narrow-screen puzzle or waiting state | `CodingTaskScreen`, `CodingWorkbench`, `DesignRunner` | The coding workbench frame and `BriefZone`; Run and Submit at one y on every task. Server verdicts and sealed sessions; editor at 360px; focus moves to results after a run. |
| `/coding/review` | No | Redirects to `/coding` | redirect | `CodingReviewScreen` | Coding review is off. |
| `/settings/github` | Yes | Finish the GitHub App installation | working, sign-in needed, missing params, GitHub error, organisation request | `GithubSettingsPage` | `StatePanel` for every phase; always a way back to the profile; never loop on a failed finish. |
| `/profile` | Yes | Understand progress and next action; manage the account | auth loading, signed out, no progress, populated, sync error, delete confirm/failure, GitHub garden states | `Profile`, `GithubGardenCard` | `.ss-panel` card stock, the 'Your name' panel, settings rows; subject scope, privacy and deletion confirmation. |
| `/premium` | Optional | Compare Free and Premium; start checkout or manage billing; redeem a voucher | billing off, signed out, free, paying, complimentary grant, voucher grant, settings error; voucher: sign-in check, form, refused code, already redeemed, too many attempts, offline, unavailable, expired session, redeemed | `PremiumPage`, `PremiumVoucher` | Price before VAT with "VAT added at checkout"; no urgency; renewal, waiver and cancel links beside the buttons. While billing is off the voucher leads. |
| `/premium/checkout`, `/premium/success`, `/premium/cancel` | Checkout and success: yes; cancel: no | Buy, confirm, or cancel without signing in through an emailed link | checking, done, pending, expired, signed out; cancel: email step, check your email, link confirm, link expired or used, receipt, error | `PremiumCheckoutPage`, `PremiumSuccessPage`, `PremiumCancelPage` | Focus moves to each step heading; the link token leaves the address bar at once; never reveal whether an email has a subscription. |
| `/support` | No | Redirects to `/premium` | redirect | `Navigate` | Kept for old links. |
| `/auth/confirmed`, `/reset-password` | No | Confirm an email; set a new password | verifying, done, expired or used link, error | `AuthPages` | Verify only when the learner presses the button. |
| `/privacy`, `/terms` | No | Read the policies | reading | `PrivacyPage`, `TermsPage` | Reading hierarchy; 400% reflow. |
| `/classroom` | No | Understand hosting and joining | explanation, call to action | `ClassroomPage` | Authentic workflow, no fake screenshots. |
| `/topics/:slug` | No | Read a guide and enter practice | valid guide, unknown slug | `TopicLandingPage` | Authored intro, no answer leakage, SEO output. |
| `/dev` | Admin | Operate questions, triage, quality, learning paths, reports, logs, merchandise, vouchers and settings | auth checking, denied, loading, empty, error, unsaved, save/delete, voucher shown once | `DevPage` and `dev/*` | Dense, low-decoration control room; explicit status; never expose secrets or answer keys; a voucher code is listed by its first four characters. |
| `*` | No | Recover from a bad URL | not found | `NotFoundPage` | One clear route home; route title and focus. |

## Text on coloured fills (finding P1.3)

No text on a coloured fill uses a fixed white:

- On the accent, text uses `--brand-on-accent`, and Astryx's `--color-on-accent` follows it, so an Astryx primary button, checked box or selected radio in dark mode reads at 6.69:1.
- Topic-coloured buttons take `textOnColor()` from `client/src/lib/categories.ts`, which picks white or the ocean ink `#0b141b` (falling back to black on a mid-tone neither reaches 4.5:1 on), and `hoverFilterOn()` darkens a fill under white text and lightens one under dark text, so no topic drops below 5.2:1 on hover.
- The XP toast's fill is `--ss-success-strong`, with `--ss-on-success-strong` for its text. The `/dev` score badges use `textOnColor()`.

`tests/browser/on-accent.spec.ts` checks the chip, the stage dots, the HTML, CSS and JavaScript start buttons, the toast and the `/learn` topic rail in both themes with axe's `color-contrast` rule and a measured ratio. `client/tests/on-color-text.test.ts` covers every category colour and the token pairs. A locked topic's pill stays at `opacity: 0.6`; WCAG 1.4.3 exempts it as a disabled radio.

## Open findings

- The owner items Epic U left open (legal wording, the VAT caption, kept exceptions to one primary, the billing steps' Astryx primaries, the Profile's phone length) are listed in the status section of `docs/design/ux-audit.md`.
- `LoadingScreen` and `ErrorRetry` still carry a small adapter for MUI-style `sx` spacing props.
- `/dev` → Question bank colours its review states with fixed hex values (`DevQuestions.tsx`) instead of the semantic tokens.
- Multiplayer state refresh grows roughly with the square of the room size. A fix needs a forward API and RPC design inside the existing handlers.
- Not re-checked since the July 2026 audit: clipping of multiline answers in the active quiz on short viewports, bounded user-readable states for slow or failed sign-in, and the remaining serial requests on Profile. Since 23 October 2026 the streak card, the advisor and the leaderboard-name card start their reads beside the stats read; any further consolidation belongs in the existing user handler, not a thirteenth function.

## Strengths to keep

- Central sources of truth: `client/product-catalog.ts`, `shared/subject-catalog.ts`, `client/src/lib/products.ts` and `client/src/lib/subjects.ts`. Product identity refuses any product but devShark.
- Server-issued encrypted sessions, one-time grading claims, result receipts, atomic XP, streak and progression writes, product and subject validation, RLS and service-role isolation.
- Real content counts from `SUBJECT_SCOPE_CATALOG`, checked by `npm run test:launch`, and an on-demand question bank.
- One-screen shell, internal main scroll, bottom-waterline clearance, skip link, route titles and route focus.
- Astryx primitives, `SharkFin`, `LandingKit`, `CategoryGlyph`, `RadioCards`, dialogs, toasts and query helpers.
- A click draws the next page once. The route boundary sits outside the keyed route box, links preload their page on intent (`lib/routePreload.ts`) only for the paths its routes serve, and only on a left mouse press while the browser asks to save data, and Coding, Today, Learn, Roadmap, Rewards, Premium, Leaderboard and the Challenge hold their first render for the reads that decide it (`lib/routeData.ts`, at most 1.2s).
- A page whose code fails to load shows `RouteErrorBoundary` inside the shell; Try again re-renders or reloads, and offline it waits for the connection (`tests/browser/route-errors.spec.ts`).
- Lazy routes, lazy Prism languages, a lazy Learn level runner, a code editor that loads only when a path's code activity renders, Prettier only while the coding editor is on screen, consent-gated analytics, optional Sentry and build-time CSS purging.
- The Realtime polling fallback and server-side match timing.

## Rejected rewrites

- No new UI library, state manager, icon library, localization mechanism, product or subject registry, footer list, runtime image API, Express server, native app or extra Vercel handler.
- No mechanical rename of `react-express-quiz-app`, legacy storage keys, migrations or compatibility values.
- No generated factual diagrams, equations, code, product UI, testimonials, metrics or people.
