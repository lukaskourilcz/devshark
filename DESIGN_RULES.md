# Design Rules — devShark "Deep End v2"

## Apple application design

The application uses [apple-design](https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md)
through the existing Astryx and Deep End components. `html[data-design='apple']`
defines system typography, rounded materials, quiet elevation and translucent
chrome. These rules replace the paper stock and textured-dialog treatments
below. Preserve the Deep End blue-green background in dark mode. Brand geometry,
accent, content and access rules still follow the existing sources.
`client/src/main.tsx` sets the attribute before the first paint, and
[the design system](docs/design/design-system.md#apple-layer) lists what the
layer styles. Keep the pill shape to buttons, the header nav links, tags,
compact filters such as the topic pills, small inline toggles and compact
segmented controls; cards, panels, inputs, radio cards, drawer links and
dialogs use the radius tokens.

These rules govern every visual change in this codebase. They come from the
`Deep End v2` design. Read them before touching any component, style file, or
brand mark. The design tokens
themselves live in `client/src/styles/astryx-theme.css` (the `--ss-*` custom
properties) — this file is the *behavioural* contract that sits on top of them.

## 1. The fin baseline rule (non-negotiable)

In ANY hover effect that reveals a shark fin — ghost-fin backgrounds,
swim-through fins, fade-in fins — the fin's **visual base must TOUCH the bottom
edge of its container**, never float above it.

The fin glyph (the V9 clean fin in a 24-unit box, from `SharkFin.tsx`) has a
straight base on `y=18`, so **25% of the box is empty below the base**. Its tip
points left, so the fin faces right: mirror it (`scaleX(-1)`) only when it
travels left. The wave cut belongs to the logo (`BrandLogo.tsx`) and the
standalone `SharkFin wave` symbol. To make the base ride the bottom edge, sink the fin downward by
`size × 0.25`:

- a `58px` fin needs `bottom: -15px` (58 × 0.25 ≈ 14.5)
- a `40px` fin needs `bottom: -10px`
- a `20px` fin needs `bottom: -5px`

Fins may be cropped by `overflow: hidden` past the sides or the bottom, but the
base always rides the bottom edge like a waterline. A fin floating in the middle
of a button or card is a bug.

## 2. One accent variable

The whole kit reads a **single** accent variable. Never hard-code the accent's
hex. Fins, waterlines, kickers, selected states, progress and primary CTAs all
read `var(--brand-accent)` (and `var(--brand-accent-soft)` for tints).
`ColorModeContext` writes these from `client/src/lib/subjects.ts`:

| Product  | Accent    | Bright (dark) |
|----------|-----------|---------------|
| devShark | `#2d7a2d` | `#4caf50`     |

## 3. Fin reveals — never animate `background-position`

Fin reveals fade in via an `opacity` transition (≈0.35s) on a child element.
**Never** animate `background-position` to "drift" a fin in — it reads as jitter.
Interactive buttons use `generateFinHover` through `FinButton` or `SwimCta`.
Generate once per mounted button: fade, swim, rise, dive, or diagonal entrance;
randomize direction, size, opacity and duration. Animate only an absolutely
positioned decorative child with opacity and transforms. Crop it with
`overflow: hidden`, keep labels above it, and preserve the same variant across
rerenders. Keyboard focus receives the same effect; disabled buttons do not.
Reduced-motion mode shows a static fin without transitions.
Fins never enter from above. Their baseline stays at or below the component's
bottom edge: emergence starts below it, and dives travel diagonally downward.

## 4. The wave-variation rule

`generateWaterline()` assigns progress waves a stable randomized wavelength,
amplitude, direction, speed and phase. Coding track decoration opts into zero,
one or two fins with varied sizes and separated positions. These decorative
fins sit in the water; the accent fill and numeric label still show real
progress. Quiz and typing progress keep their fin at the progress endpoint.

Every wavy connector gets **its own** amplitude, phase and wavelength — no two
waves in a path are the same tile. A roadmap path, a set of level connectors, a
row of ticks: vary `amp` / `dir` / `wavelength` per segment so the path reads as
living water, not a repeated stamp. (See `pathWave` in `landing/LandingKit.tsx`, used by
`Home.tsx`, for the reference implementation.)

### 4a. The waterline bank

The short decorative underline — the tick under a kicker, the full-width rule,
the line under a review heading — is one 24×6 tile, and it has **eight**
variants rather than one. They share a bounding box, a stroke weight and a
smooth style; only amplitude, phase and crest spacing differ. Variant 1 is the
mark as it has always looked.

- The tiles are `--ss-wave-1` … `--ss-wave-8` in `astryx-theme.css`, each with a
  `.ss-wave-vN` class that sets `--ss-wave` **on that element**. `--ss-wave`
  itself still defaults to variant 1, so anything that has not opted in is
  unchanged and changing the global does not flatten every instance to one wave.
- A variant is chosen per component **instance** by `useWaveVariant()`
  (`client/src/lib/waveBank.ts`), from React's `useId`. That is stable across
  rerenders, interactions and resizes, identical on both sides of hydration, and
  contains no `Math.random`. Siblings get consecutive ids and the selector steps
  by three, so neighbours never match and all eight are used before any repeat.
  Pass a number to pin one for a preview or a test.
- Render a kicker with `<Kicker>` and a rule with `<WaterlineRule>`
  (`components/landing/LandingKit.tsx`). Do not write `className="ss-kicker"`
  by hand: an instance that bypasses the component silently gets variant 1 and
  the repetition comes back.

**What the bank does not touch.** The animated fin waterline
(`WaterlineProgress` in `SharkFin.tsx`) has its own geometry and its own
motion. The roadmap and landing connectors (the topic preview in
`client/src/components/Home.tsx`) already vary per segment under rule 4
above. The dialog surface reads `--ss-wave` as a background texture rather
than as an underline. None of the three is part of this bank, and none of
them should be routed through it.

The variants are decoration: no accessible name, no focus target, nothing read
out, and no animation — so the reduced-motion rules in section 5 have nothing
new to cover.

## 5. Motion respects `prefers-reduced-motion`

All motion (fin drifts, swims, bobs, card lifts, pop-ins) must **freeze** under
`prefers-reduced-motion: reduce`, keeping only opacity fades. Follow the
existing convention in `app-shell.css` / `astryx-theme.css`: guard every
`@keyframes`-driven class with a `@media (prefers-reduced-motion: reduce)` block
that sets `animation: none` (and neutralises any hover `transform`).

Motion's `m` elements (`client/src/lib/motion.tsx`) go one step further: a
page that opens under reduced motion loads no Motion features and marks
`<html data-motion="off">`, so they appear at their final opacity at once,
without the fade (perf audit #587, an owner trade-off in `NEEDED.md`).

## 6. Cards don't lift on the fin-school hover

On the topic cards (the "fin schools" hero effect), the card itself does **not**
move — no lift, no tilt. The waterline fading in and the fins gliding across it
carry the entire effect. (`.ss-lift` is a *separate*, opt-in affordance for
plain clickable cards; don't combine it with a fin-school hover.)

## 7. Reuse the brand primitives

- Logo: `client/src/components/BrandLogo.tsx` (the approved October 2026 bold
  wordmark with a vertically centred V9 fin; accent “dev”, ink/white “Shark”). Fin glyph / swimming fin / waterline:
  `client/src/components/SharkFin.tsx`. Both read the kit geometry from
  `brandGeometry.ts`; never redraw the fin. The approved wordmark outlines live
  in `client/src/assets/brand/devshark-wordmark.svg`. See `docs/brand/brand-guidelines.md`.
- Kicker + waterline tick: the `<Kicker>` component (`landing/LandingKit.tsx`),
  which applies `.ss-kicker` and one of the eight waves. The rule is
  `<WaterlineRule>` from the same file.
- Card stock (hairline border, 2px bottom edge, one ink shadow): `.ss-panel`
  / `.ss-raised` / `.ss-lift`.
- Topic logos: `CategoryGlyph` in `components/ui/techIcons.tsx` (bundles only
  the devicons it imports — never pull the whole icon set or a CDN URL).
- Paper grain + wave tile: the `--ss-grain` / `--ss-wave` data-URIs.
- New copy becomes new English keys in `i18n/translations.ts`; devShark ships
  English only, with no second language. Never hard-code user-visible English
  in a component. Copy that only one lazy route reads may sit in that route's
  own dictionary (`translations.learn.ts`, `translations.paths.ts` and the
  others the `route-and-chunk` skill lists), which keeps it off the first
  download.

## 8. Shared loading and motion vocabulary

Extend the existing motion system, not a screen-specific animation library.
Durations live in `astryx-theme.css`: `--ss-motion-feedback` (160ms),
`--ss-motion-reveal` (350ms), `--ss-motion-ambient` (2400ms), and the two
directional `--ss-motion-swim-*` tokens. Ambient keyframes live once in
`app-shell.css`; components must not inject duplicate style tags.

- Page/data loading uses `LoadingScreen`: branded swimming fin, visible
  status text from `t()`, one polite live region. `QuoteLoader` is the study-mode
  variation using the same fin. Never invent an unlabelled spinner or fake
  percentage for an unknown duration.
- A navigation never blanks the page. The route `Suspense` boundary in
  `App.tsx` sits outside the keyed route box, so the current page stays until
  the next one can draw whole; the nav marks the destination at once and the
  waiting page fades back (`aria-busy`) only after 200ms. The route loader is
  for the first page of a visit. Links preload their page on hover, focus and
  first touch (`lib/routePreload.ts`), and only for a path one of the
  `<Route>`s in `App.tsx` serves, so a deeper address that draws the 404 page
  fetches no chunk. A browser that asks to save data preloads only on a left
  mouse press, since the click that follows loads the same code. A page whose first render depends
  on account or structure data holds it with `useFirstData`
  (`lib/routeData.ts`, capped at 1.2s, and not at all offline) instead of
  drawing defaults and redrawing. The page's own query of a held read
  spreads `HELD_READ`, so a read that failed in the hold draws its error with
  the page instead of a loading state first. A section that keeps a chunk of
  its own, such as Today's signed-in sections or the roadmap's optional
  paths, is a `lazyPart`: the page's hold loads its code with its reads, so it draws with
  the page instead of under it a beat later, and a failed part is retried
  like a page. A signed-out visitor never waits for account data. Never mount
  a route's `Suspense` boundary inside an element keyed by the path: a fresh
  boundary shows its fallback even in a transition.
- The route box is keyed by `routeBoxKey` (`lib/routePreload.ts`): the path,
  except that `/learn` and every `/learn/<section>` share one key. A Learn
  section switch therefore remounts nothing: the box, its `RouteErrorBoundary`
  and route focus stay, and focus stays on the switcher. A replace inside one
  box (`/learn` resolving to its section) logs no pageview, and a nav link to
  the box on screen (Learn on `/learn/<section>`) replaces rather than pushes.
- A page that fails keeps the shell. `RouteErrorBoundary` sits inside the
  route `Suspense` and inside the keyed route box; outside the `Suspense`,
  catching would remount it and bring the blank beat back. Its panel is the
  root error screen's card and copy. Routed pages are `lazyPage`, not `lazy`:
  React.lazy keeps a failed load for good (`lib/routeRecovery.ts`). Do not
  reload on `vite:preloadError`: a preload started by a hover fires it too.
- The shell's first frame has its final geometry. A placeholder takes the
  exact box of what replaces it; a larger or smaller one moves everything
  under it when the chunk lands. The header knows at its first render whether
  a session may exist: a signed-out visitor gets `SignInButton`, which ships
  with the shell, and the lazy account widget with its 56px placeholder is for
  a session. On a desktop that widget sits in `.ss-account-slot`, as wide as
  the widget can grow, so the centred nav stands still when it arrives. The
  footer renders inside the route `Suspense`, after the keyed box, so it
  arrives with the first page instead of sitting under the first-load
  loader. It keeps its own box (`--ss-width-chrome`,
  the header's 1168px), never the route width. `tests/browser/first-load.spec.ts` holds the page's code
  back and fails when the header, `<main>` or the footer moves.
- A shell part that fails keeps the shell too. A lazy part outside the route
  boundary (the account widget, the upgrade sheet, the sign-in dialog) is a `lazyShellPart` inside
  a `ShellPartBoundary`, which sits inside the part's `Suspense` for the same
  reason the route boundary does. Its fallback is quiet and keeps the part's
  box: the account retry stands in the widget's 56px row, and a sheet that
  fails closes with a toast. Nothing reloads unless the learner presses: a
  press that meets the same chunk failure again reloads through
  `reloadOnPress` (`lib/routeRecovery.ts`), and only while the browser is
  online and the server answers. The Coding workbench's Try again and a
  second sign-in press after a failed supabase-js download follow the same
  rule, and so does a second press for the upgrade sheet or the sign-in
  dialog: that reload opens it in the next document. A 402 nobody pressed
  for never reloads.
- A part inside a page that loads its own code and is not in the page's hold
  (the Learn level runner, which loads when a level opens, and the coding
  workbench inside it, the friends tab, a path's reward, a path activity's
  code editor, the code highlighter) fails alone. It is a `lazyShellPart` inside a
  `ShellPartBoundary`, and its fallback keeps the page: `ErrorRetry` in the
  part's place, or plain code for a code block. Nothing here uses `lazy`.
- Motion's features chunk can fail too. `lib/motion.tsx` then marks
  `<html data-motion="off">`, and `app-shell.css` shows every `m` element
  (each carries `data-m`) at full opacity with no transform. So every `m`
  element must end visible and untransformed; one that ends hidden needs a
  rule of its own.
- In-place mutations keep their control visible, disable duplicate actions,
  and use an action/status label from `t()`. Do not replace a whole editor
  with a page loader during submission or draft saving.
- Use `SwimCta` for a screen's one prominent action outside the homepage too
  (coding Submit, the Coding home's next challenge, collection practice). Use
  `FadeFinCta` for a quieter fin, such as an evolving project's or path's row
  action, labelled Start, Continue or Review by its progress.
  Keyboard focus gets the same affordance as hover; disabled actions do not
  swim. Keep a native button and an accessible name.
- Reduced motion freezes all travel and ambient loops; opacity alone may
  reveal a fin. Feedback must remain understandable without animation.
- Test narrow widths, both themes, keyboard focus, disabled
  controls, slow responses, failure/retry and reduced motion.

## 9. Scrollbars

App scrollbars keep a stable gutter and a transparent track. Shared delegated
activity handling (`lib/scrollbarActivity.ts`) reveals only the active scroll
container's themed thumb, then hides it after 1.1 seconds idle. WebKit thumbs
are 4px; Firefox uses its native thin width. Scrolling and keyboard navigation
also reveal the thumb; forced-colors mode keeps it visible. Do not add
per-component scrollbar rules.

## 10. One button scale, one page width per route

The UX audit of 23 October 2026 (Epic U, #572) found 28, 32, 36, 41 and 44px
buttons on one mouse and 21 page max-widths. These rules keep them out. The
tokens, the route map and the component catalogue are in
[the design system](docs/design/design-system.md#page-widths). Each rule names
the check that holds it; "Review" means no automated check exists and a
reviewer or the visual QA pass holds it.

**`npm run check:design`** (`scripts/check-design-contract.mjs`, run by
`check:public` in CI) fails on four things: a pixel `max-width` of 560px or more
in `client/src`, an Astryx `Button` or `IconButton` with `size="sm"`, a button
selector under 44px (36px inside `.ss-compact`) and a 'Log in' string in
`client/src/i18n`. An intended exception goes into
`scripts/design-contract-allowlist.json` with its reason; an entry that matches
nothing fails, so the list only shrinks. `scripts/test-design-contract.mjs`
proves each rule fails on a bad sample.

- **The shell picks the page width.** `pageMaxWidth` assigns wide (1200px) to operational learning routes: Coding, Learn, Quiz, Challenge, Today, Profile, Play, Typing, Cards, Collection, Shop, Leaderboard and Career. Public home stays standard (1000px); public/auth/billing and unknown routes stay narrow (800px); `/dev` is uncapped. No page-local max-width. Shared horizontal gutters are 64px above 700px and 26px below, from `--ss-page-gutter`.
  Check: `check:design`, `client/tests/page-width.test.tsx`, `page-own-width.test.ts`.
- **Question columns are 880px.** Use `--ss-width-question` inside the wide shell. Auth, billing, checkout, StatePanel and lobbies keep `--ss-width-task` (640px). Longer content scrolls rather than shrinking text.
  Check: `client/tests/question-shell.test.tsx`, `info-page.test.tsx`.
- **The chrome does not move.** The header and footer share
  `--ss-width-chrome` (1168px) on every route.
  Check: `tests/browser/first-load.spec.ts`.
- **Every control is 44px on every pointer.** `--ss-control-height` is the
  floor for Astryx buttons, segmented items and text fields, set once in
  `app-shell.css`. Only controls inside `.ss-compact` (a component's own
  toolbar) are `--ss-control-height-compact` (36px) on a fine pointer, each
  with a 44px hit area. A control the app draws smaller (a map cell) extends
  its target to 44px with a transparent layer. No `size="sm"` on a page or a
  card; a Retry inside a banner or a Remove on a list row is the only small
  button, and each is allowlisted.
  Check: `check:design` (small-button, button-height),
  `client/tests/touch-and-motion.test.ts`,
  `client/tests/profile-card-actions.test.ts`.
- **Page actions share one type.** 44px, 20px inline padding, 16px/600 text,
  pill: `.ss-action`, or any button in `.ss-info-actions`, `.ss-auth__actions`
  or `.ss-state-panel__actions`.
  Check: `info-page.test.tsx`.
- **One filled primary per screen**, and it is `SwimCta` md (44px). Every other
  action is Astryx secondary or ghost. The primary is never the smallest
  control in its row. A second task's button turns primary only once its own
  input is complete (Join on `/play` with a whole code). A row of buttons that
  switches the view is never filled: the open one is secondary with
  `aria-current`, the rest ghost.
  Check: `question-actions.test.tsx`, `touch-and-motion.test.ts` (coding
  Submit), `learn-section-layout.test.ts`; Review elsewhere.
- **Icon buttons are 44×44** with a 20px glyph, a tooltip and an
  `aria-label`. Icons in one row share one drawing (`CoinsIcon`, not the
  filled `CoinIcon`, in the header).
  Check: `question-header.test.tsx`, `coins-icon.test.tsx`.
- **A control group's label sits above it**, never as a suffix, at the
  default size, so a form has one control height. Review.
- **One coding frame wherever a task opens** (U3, #575). `/coding`, a Learn
  level's coding phase and a path's code activity share the workbench frame:
  from 1024px one row of `--cd-frame-h`, `BriefZone` capped at
  `--cd-brief-cap`, the editor from `--cd-editor-min`, one 44px action row at
  its foot. Run and Submit (`SwimCta` md) keep their words at every width;
  Format and Reset sit in the editor's `.ss-compact` toolbar; below 1024px
  Hint, Solution, Skip and Report fold into one "More actions" menu. Never give
  a task's brief, editor or actions a size of their own.
  Check: `client/tests/coding-frame-hosts.test.tsx`, `brief-zone.test.tsx`,
  `coding-workbench-state.test.tsx`, `tests/browser/coding-workbench.spec.ts`.
- **One operational header.** An operational page's title is `PageHeader`
  (`components/ui/PageHeader.tsx`): optional `<Kicker>`, an ink `h1` at
  `display-3`, one lead line, 8px apart. Do not hand-build an `h1` or add a
  second header component. A public page keeps the editorial `Page` header
  (every `Page` h1 at one x and one y); a Learn-area page that is not a
  section uses `LearnPageHeader`.
  Check: `page-header.test.tsx`, `info-page.test.tsx`,
  `learn-page-header.test.tsx`.
- **One section-title size.** A public section `h2` takes `.ss-section-title`;
  no section sets its own heading size.
  Check: `home-sections.test.tsx`, `premium-page.test.tsx`.
- **One state panel.** A sign-in gate, an empty shelf or a callback state is
  `StatePanel` (`components/ui/StatePanel.tsx`); when one part of a drawn
  screen waits for sign-in it is `StatePanel inline`. The sign-in action is
  its `signIn` prop, one "Sign in" that opens the dialog. Do not build a gate
  card or a sign-in button by hand. A money screen never shows a placeholder
  number for a visitor, and a button the visitor cannot use yet reads "Sign in
  to …" and opens sign-in instead of sitting disabled.
  Check: `state-panel.test.tsx`, `play-gates.test.tsx`.
- **One panel per subject on the Profile** (U6, #578). Every Profile card is
  `.ss-panel` with 24px padding and a `<Kicker as="h2">`. The names live in one
  'Your name' panel with 'Friends see' and 'Leaderboards show' saved apart.
  Account actions are settings rows whose title never repeats the button. The
  banner does not repeat the footer's appearance and sound controls.
  Check: `profile-layout.test.tsx`, `sharkname-card.test.tsx`.
- **A Learn section names itself once** (U4, #576). The h1 is 'Learn' in every
  auth state; the switcher is the only place the section's name appears. A
  locked topic carries one lock signal, and Premium is said once per topic,
  on its tile and in the next-step row ('See Premium'). An empty section sits
  on the column's left edge. While the header offers the join, the join is the
  one `SwimCta`.
  Check: `learn-section-layout.test.ts`, `tests/browser/learn-sections.spec.ts`.
- **A Learn link is the accent with a 1px underline** (`.learn-link`), never
  the browser's blue. Check: `learn-page-header.test.tsx`.
- **A list is hairline rows, not a card per row.** A summary on request goes
  below what it sums up, as one closed disclosure (`.lp-disclosure`). A row in
  its default state says nothing about it. A secondary form that is not the
  page's task is one row. Check: `coding-lists-layout.test.ts`; Review
  elsewhere.
- **Say each fact once per screen, no kicker that repeats the `h1`, and the
  sign-in verb is "Sign in".** Check: `check:design` (sign-in-verb); Review
  for repetition.

## 11. One question system

The same audit (U2, #574) found five question widths, two answer designs and
the main action in a different place on every runner. A question screen is
built from the shared parts in `client/src/components/question/`
([the design system](docs/design/design-system.md#question-screens) lists
their props), never drawn again by hand.

- **One shell.** `QuestionShell` is the `--ss-width-task` column with one
  `.ss-panel` and no accent edge. A runner sets no width, card or `flex: 1` of
  its own. The question block keeps `--ss-question-block-min` and scrolls past
  `--ss-question-block-max`, so the answers start at one y; on a phone the tag
  row keeps two lines (`--ss-question-tags-min`).
  Check: `question-shell.test.tsx`.
- **One answer list.** `AnswerOptionList`: 48px rows 8px apart, a 26px chip,
  the brand accent for the selection (never a track colour). A graded row
  says what it is in a ✓ or ✕ as well as colour, in a 20px slot every row
  keeps, so grading never rewraps a row; "Correct answer" and "Your pick" are
  in the accessible name.
  Check: `answer-option-list.test.tsx`, `daily-question.test.tsx`.
- **One action row.** `QuestionActions` sits 16px under the panel:
  secondaries left, the one `SwimCta` md right; on a phone the primary is the
  last row at full width. When grading moves focus to the primary, the page
  scrolls the least that shows it and never past the top of the answers.
  Check: `question-actions.test.tsx`.
- **One header with the screen's h1.** `QuestionHeader` names the run in the
  `h1` ("Quiz · Question 3 of 10"), with progress and status on the first row
  and tags plus 44px icon buttons (hint, report, exit) on the second. The
  question text and code span the panel.
  Check: `question-header.test.tsx`.
- **One keyboard hint, on a reserved line.** `QuestionHint`, on a desktop with
  a fine pointer only. Grading hides its words, never its line.
  Check: `question-hint.test.tsx`.
- **Feedback under the answers, never over them.** `QuestionFeedback` sits in
  normal flow below the list, inside the panel, and takes focus. Nothing on a
  question screen is positioned over the answers.
  Check: `question-feedback.test.tsx`.
- **A live run hides the site chrome.** An active Quiz, Challenge run or Learn
  level reports it through `onActiveChange`; setup, intro, result and error
  screens bring the chrome back. The run's `QuestionHeader` carries an Exit
  icon button that asks first.
  Check: `challenge-run.test.tsx`, `learn-plan.test.tsx`.
- **A setup screen is laid out like the Quiz setup.** One `--ss-width-task`
  column: `PageHeader`, one panel with the choices and a Select all / Deselect
  all link on their label row, then the one `SwimCta` md. Anything else sits
  under the panel as a short list. Check: `challenge-relaxed.test.tsx`.
- **A card deck is a question screen too.** Shark Cards keep the route column
  but use the shared header and the one `QuestionActions` row (Previous and
  Next together on the left). Face down the primary is "Show the answer";
  turned, Got it, in the same place.
  Check: `shark-cards.test.tsx`.
- **A run's other screens share its shell.** A Learn level's intro and
  result, the restart screens and every skill-check screen render inside
  `QuestionShell`, so the exit button does not move. A track colour may tint
  confetti and the result's icon tile, never text or a button.
  Check: `learn-plan.test.tsx`.
- **One copy home.** The parts' words are `question.*` keys in
  `translations.question.ts`, loaded only by the question chunks.
  Check: `question-copy.test.ts`.
